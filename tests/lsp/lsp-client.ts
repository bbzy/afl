import { spawn } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const root = fs.realpathSync(process.argv[3]),
  uri = (file) => pathToFileURL(join(root, file)).href;
const mainUri = uri("app/main.afl"),
  coreUri = uri("external/core/lib.afl"),
  configUri = uri("app/config.toml");
const position = (text, offset) => {
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
  return { line: lines.length - 1, character: lines.at(-1).length };
};
const marked = (source) => {
  let text = "",
    end = 0;
  const marks: Record<string, { line: number; character: number }> = {};
  for (const match of source.matchAll(/\{\|([A-Za-z_0-9]+)\|\}/g)) {
    text += source.slice(end, match.index);
    marks[match[1]] = position(text, text.length);
    end = match.index + match[0].length;
  }
  return { text: text + source.slice(end), marks };
};
const main = marked(input.main),
  core = marked(input.core);
const ipc = process.argv[4] === "ipc";
const child = spawn(
  process.execPath,
  [
    "--require",
    join(root, "preload.cjs"),
    process.argv[2],
    ipc ? "--node-ipc" : "--stdio",
  ],
  {
    stdio: ipc ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
    env: { ...process.env, AFL_TEST_ROOT: root },
  },
);
const watchdog = setTimeout(() => {
  child.kill();
  throw new Error("LSP test timed out");
}, 20000);
let buffer = Buffer.alloc(0),
  nextId = 1,
  stderr = "";
const requests = new Map(),
  notifications = [],
  registrations = [],
  latest = new Map(),
  waiters = new Set<() => void>();
const send = (message) => {
  const packet = { jsonrpc: "2.0", ...message };
  if (ipc) {
    child.send(packet);
    return;
  }
  const body = Buffer.from(JSON.stringify(packet));
  child.stdin.write(
    Buffer.concat([
      Buffer.from("Content-Length: " + body.length + "\r\n\r\n"),
      body,
    ]),
  );
};
const notify = (method, params = {}) => send({ method, params });
const request = (method, params = {}) =>
  new Promise<any>((resolve, reject) => {
    const id = nextId++;
    requests.set(id, { resolve, reject });
    send({ id, method, params });
  });
const wake = () => {
  for (const check of [...waiters]) {
    check();
  }
};
const until = (predicate, label) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(check);
      reject(new Error("Timed out: " + label + "\n" + stderr));
    }, 8000);
    function check() {
      if (predicate()) {
        clearTimeout(timer);
        waiters.delete(check);
        resolve();
      }
    }
    waiters.add(check);
    check();
  });
child.stderr.on("data", (data) => {
  stderr += data;
});
const accept = (message) => {
  if (message.method && message.id !== undefined) {
    if (message.method === "client/registerCapability") {
      registrations.push(...message.params.registrations);
    }
    send({ id: message.id, result: null });
  } else if (message.id !== undefined) {
    const pending = requests.get(message.id);
    requests.delete(message.id);
    if (message.error) {
      pending?.reject(new Error(JSON.stringify(message.error)));
    } else {
      pending?.resolve(message.result);
    }
  } else {
    notifications.push(message);
    if (message.method === "textDocument/publishDiagnostics") {
      latest.set(message.params.uri, message.params);
    }
  }
  wake();
};
if (ipc) {
  child.on("message", accept);
}
child.stdout.on("data", (data) => {
  buffer = Buffer.concat([buffer, data]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) {
      break;
    }
    const length = Number(
      /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1],
    );
    if (!Number.isFinite(length)) {
      throw new Error("Non-protocol stdout");
    }
    if (buffer.length < end + 4 + length) {
      break;
    }
    const message = JSON.parse(
      buffer.subarray(end + 4, end + 4 + length).toString(),
    );
    buffer = buffer.subarray(end + 4 + length);
    accept(message);
  }
});
const exited = new Promise((resolve) =>
  child.on("exit", (code, signal) => {
    resolve({ code, signal });
    wake();
  }),
);
const query = (method, at = undefined, extra = {}, target = mainUri) =>
  request("textDocument/" + method, {
    textDocument: { uri: target },
    ...(at ? { position: at } : {}),
    ...extra,
  });
const barrier = () => query("documentSymbol");
const codes = (target) =>
  (latest.get(target)?.diagnostics ?? []).map((item) => item.code);
const open = (target, text, languageId = "afl", version = 1) =>
  notify("textDocument/didOpen", {
    textDocument: { uri: target, text, languageId, version },
  });
const change = (target, version, text) =>
  notify("textDocument/didChange", {
    textDocument: { uri: target, version },
    contentChanges: [{ text }],
  });
const close = (target) =>
  notify("textDocument/didClose", { textDocument: { uri: target } });
const watched = (target, type = 2) =>
  notify("workspace/didChangeWatchedFiles", {
    changes: [{ uri: target, type }],
  });
const result: Record<string, any> = {};
try {
  result.initialize = await request("initialize", {
    processId: process.pid,
    rootUri: uri("app"),
    workspaceFolders: [{ uri: uri("app"), name: "app" }],
    capabilities: {
      textDocument: {
        documentSymbol: { hierarchicalDocumentSymbolSupport: !ipc },
      },
      workspace: {
        workspaceFolders: true,
        didChangeWatchedFiles: {
          dynamicRegistration: true,
          relativePatternSupport: true,
        },
      },
    },
  });
  notify("initialized");
  open(mainUri, main.text);
  const formatUri = "untitled:format.afl";
  open(formatUri, "fn main(){call()}\r\n");
  result.formatted = await query(
    "formatting",
    null,
    { options: { tabSize: 2, insertSpaces: true } },
    formatUri,
  );
  change(formatUri, 2, result.formatted[0].newText);
  result.formattedAgain = await query(
    "formatting",
    null,
    { options: { tabSize: 2, insertSpaces: true } },
    formatUri,
  );
  change(formatUri, 3, "fn broken(");
  result.formatInvalid = await query(
    "formatting",
    null,
    { options: { tabSize: 2, insertSpaces: true } },
    formatUri,
  );
  close(formatUri);

  result.definition = await query("definition", main.marks.member);
  result.coreUri = coreUri;
  result.coreMarks = core.marks;
  result.initialDiagnostics = latest.get(mainUri);
  result.hover = await query("hover", main.marks.member);
  result.signature = await query("signatureHelp", main.marks.arg);
  result.references = await query(
    "references",
    core.marks.property,
    { context: { includeDeclaration: false } },
    coreUri,
  );
  result.outline = await query("documentSymbol", null, {}, coreUri);
  await until(
    () =>
      registrations.some((item) =>
        item.registerOptions.watchers.some(
          (watcher) => watcher.globPattern.baseUri === uri("external/core/"),
        ),
      ),
    "external watcher",
  );
  result.watchers = registrations.flatMap(
    (item) => item.registerOptions.watchers,
  );

  // Incremental UTF-16 edit, after a non-BMP character, changes only a member.
  const propertyStart = main.marks.property;
  notify("textDocument/didChange", {
    textDocument: { uri: mainUri, version: 2 },
    contentChanges: [
      {
        range: {
          start: propertyStart,
          end: { ...propertyStart, character: propertyStart.character + 4 },
        },
        text: "missing",
      },
    ],
  });
  await barrier();
  result.incremental = latest.get(mainUri);
  change(
    mainUri,
    3,
    "use dep::core::lib::Adder as Remote\nfn main() {\n value: Remote = [创建]\n value.",
  );
  result.completion = await query("completion", { line: 3, character: 7 });
  result.incompleteDiagnostics = codes(mainUri);
  change(mainUri, 4, main.text);
  await barrier();

  // An obsolete read must never publish diagnostics for document version 5.
  fs.writeFileSync(join(root, "pause"), "");
  change(mainUri, 5, main.text.replace("value.add(1, 2)", "missing()"));
  const checkLoading = setInterval(wake, 5);
  try {
    await until(
      () => fs.existsSync(join(root, "loading")),
      "paused source read",
    );
  } finally {
    clearInterval(checkLoading);
  }
  change(mainUri, 6, main.text);
  fs.unlinkSync(join(root, "pause"));
  result.afterStale = await query("definition", main.marks.member);
  result.staleVersions = notifications
    .filter(
      (item) =>
        item.method === "textDocument/publishDiagnostics" &&
        item.params.uri === mainUri,
    )
    .map((item) => item.params.version);
  result.latestAfterStale = latest.get(mainUri);

  open(configUri, '[dep]\ncore = "../missing-core"', "toml");
  await barrier();
  result.missingDependency = codes(configUri);
  result.missingDefinition = await query("definition", main.marks.member);
  await until(
    () =>
      registrations.some((item) =>
        item.registerOptions.watchers.some(
          (w) => w.globPattern.baseUri === uri("missing-core/"),
        ),
      ),
    "missing dependency watcher",
  );
  fs.mkdirSync(join(root, "missing-core"));
  fs.writeFileSync(join(root, "missing-core/lib.afl"), core.text);
  fs.writeFileSync(join(root, "missing-core/config.toml"), "[dep]");
  watched(uri("missing-core/lib.afl"), 1);
  result.recoveredDefinition = await query("definition", main.marks.member);
  result.recoveredConfig = codes(configUri);

  // An unfinished array/comment formerly hung the TOML parser at EOF.
  change(configUri, 2, "a=[1 #");
  await barrier();
  result.unfinishedConfig = codes(configUri);
  change(configUri, 3, '[dep]\ncore = "../external/core"\n[res]\nsdk = 123');
  await barrier();
  result.removedResourceNotes = codes(configUri);
  change(configUri, 4, '[dep]\ncore = "../external/core"');
  await barrier();
  result.resRemoved = codes(configUri);
  result.resRemovalDefinition = await query("definition", main.marks.member);
  close(configUri);
  result.configClosedDefinition = await query("definition", main.marks.member);

  fs.writeFileSync(
    join(root, "app/extra.afl"),
    "fn extra() { missing_extra() }",
  );
  watched(uri("app/extra.afl"), 1);
  await barrier();
  result.created = codes(uri("app/extra.afl"));
  fs.unlinkSync(join(root, "app/extra.afl"));
  watched(uri("app/extra.afl"), 3);
  await barrier();
  result.deleted = codes(uri("app/extra.afl"));
  fs.writeFileSync(
    join(root, "external/core/lib.afl"),
    core.text.replace("fn add(", "fn plus("),
  );
  watched(coreUri);
  result.changedDefinition = await query("definition", main.marks.member);
  result.changedDependency = codes(mainUri);
  fs.writeFileSync(join(root, "external/core/lib.afl"), core.text);
  watched(coreUri);
  await barrier();

  fs.writeFileSync(join(root, "fail"), "");
  watched(coreUri);
  await barrier();
  result.unreadable = codes(coreUri);
  result.failureMain = codes(mainUri);
  fs.unlinkSync(join(root, "fail"));
  watched(coreUri);
  await barrier();
  result.readableAgain = codes(coreUri);

  const nullableText =
    main.text.replace("value: Remote", "value: Remote?") +
    "\nfn absent() -> string? [return = [No name]] { null }";
  change(mainUri, 7, nullableText);
  result.nullableDefinition = await query("definition", main.marks.member);
  result.nullableDiagnostics = codes(mainUri);
  result.nullableOutline = await query("documentSymbol", null);
  result.nullableHover = await query(
    "hover",
    position(nullableText, nullableText.indexOf("absent")),
  );
  const callback = marked(
    "use dep::core::lib::combine\nfn main() {\n" +
      ' handler: fn(string, i32) -> string = {|reference|}combine\n handler("name", {|argument|}1)\n}',
  );
  change(mainUri, 8, callback.text);
  result.callbackSignature = await query(
    "signatureHelp",
    callback.marks.argument,
  );
  result.callbackDefinition = await query(
    "definition",
    callback.marks.reference,
  );
  result.callbackDiagnostics = codes(mainUri);
  change(mainUri, 9, main.text);
  await barrier();

  // A crate's test specifications can live outside the workspace. TOML
  // overlays, file watchers and symbol queries must include those sources.
  const specUri = uri("external/spec/lib.afl");
  const specText =
    "use dep::core::lib::Adder\nfn scenario() [desc = [Describe expected behavior]]";
  fs.mkdirSync(join(root, "external/spec"), { recursive: true });
  fs.writeFileSync(join(root, "external/spec/lib.afl"), specText);
  fs.writeFileSync(
    join(root, "external/spec/config.toml"),
    '[dep]\ncore = "../core"',
  );
  const testConfig =
    '[dep]\ncore = "../external/core"\n[test]\ncrates = ["../external/spec"]';
  open(configUri, testConfig, "toml");
  result.specDefinition = await query(
    "definition",
    { line: 0, character: 21 },
    {},
    specUri,
  );
  result.specInitial = codes(specUri);
  await until(
    () =>
      registrations.some((item) =>
        item.registerOptions.watchers.some(
          (w) => w.globPattern.baseUri === uri("external/spec/"),
        ),
      ),
    "test specification watcher",
  );
  fs.writeFileSync(
    join(root, "external/spec/lib.afl"),
    "fn scenario() { missing_test() }",
  );
  watched(specUri);
  await barrier();
  result.specDiskError = codes(specUri);
  open(specUri, specText);
  await barrier();
  result.specOverlay = codes(specUri);
  close(specUri);
  await barrier();
  result.specClosed = codes(specUri);
  change(
    configUri,
    2,
    testConfig.replace('"../external/spec"', '"../absent-spec"'),
  );
  await barrier();
  result.specMissing = codes(configUri);
  result.specUnloaded = codes(specUri);
  await until(
    () =>
      registrations.some((item) =>
        item.registerOptions.watchers.some(
          (w) => w.globPattern.baseUri === uri("absent-spec/"),
        ),
      ),
    "missing test specification watcher",
  );
  fs.mkdirSync(join(root, "absent-spec"));
  fs.writeFileSync(
    join(root, "absent-spec/lib.afl"),
    "fn scenario() [desc = [Expected behavior]]",
  );
  fs.writeFileSync(join(root, "absent-spec/config.toml"), "[dep]");
  watched(uri("absent-spec/lib.afl"), 1);
  await barrier();
  result.specRecovered = codes(configUri);
  close(configUri);
  await barrier();
  result.specConfigClosed = codes(configUri);

  // Opened symlink URIs must round-trip diagnostics and locations.
  fs.symlinkSync(join(root, "external/core"), join(root, "alias"));
  const aliasUri = uri("alias/lib.afl");
  open(aliasUri, core.text);
  result.aliasDefinition = await query("definition", main.marks.member);
  result.aliasHover = await query("hover", core.marks.property, {}, aliasUri);
  result.aliasUri = aliasUri;
  close(aliasUri);
  await barrier();

  fs.writeFileSync(
    join(root, "app/config.toml"),
    fs
      .readFileSync(join(root, "app/config.toml"), "utf8")
      .replace(/\n\[project\]\s*/gu, "") + "\n[project]\n",
  );
  watched(configUri);
  close(mainUri);
  await request("workspace/executeCommand", { command: "afl.checkProject" });
  result.workspaceDefinition = await query("definition", main.marks.member);
  fs.mkdirSync(join(root, "other"));
  fs.writeFileSync(join(root, "other/main.afl"), "fn main() { unknown() }");
  fs.writeFileSync(join(root, "other/config.toml"), "[project]\n[dep]");
  notify("workspace/didChangeWorkspaceFolders", {
    event: {
      removed: [{ uri: uri("app"), name: "app" }],
      added: [{ uri: uri("other"), name: "other" }],
    },
  });
  await barrier();
  result.changedWorkspace = codes(uri("other/main.afl"));
  result.clearedWorkspace = codes(mainUri);

  open("untitled:Scratch.afl", "fn main() { missing() }");
  await barrier();
  result.untitled = codes("untitled:Scratch.afl");
  result.clearedOther = codes(uri("other/main.afl"));
  close("untitled:Scratch.afl");
  await barrier();
  result.closedUntitled = codes("untitled:Scratch.afl");

  // Explicit preset selection, live TOML overlays and implementation queries.
  const presetRoot = join(root, "presets-project");
  for (const part of ["core", "edge", "presets"]) {
    fs.mkdirSync(join(presetRoot, part), { recursive: true });
  }
  const presetCore = uri("presets-project/core/lib.afl"),
    presetEdge = uri("presets-project/edge/lib.afl");
  const presetConfig = uri("presets-project/config.toml"),
    standalonePreset = uri("presets-project/presets/ios.toml");
  const presetText =
    'preset_dir = "presets"\n[project]\n[preset.android]\ncore = ["core"]\nedge = ["edge"]';
  const standaloneText = 'core = ["../core"]\nedge = ["../edge"]';
  const implementation =
    "impl dep::core::lib::display\nfn display() [desc = [Platform display]]";
  fs.writeFileSync(join(presetRoot, "config.toml"), presetText);
  fs.writeFileSync(join(presetRoot, "presets/ios.toml"), standaloneText);
  fs.writeFileSync(join(presetRoot, "core/config.toml"), "[dep]");
  fs.writeFileSync(
    join(presetRoot, "core/lib.afl"),
    "extern fn display() [desc = [Display]]",
  );
  fs.writeFileSync(
    join(presetRoot, "edge/config.toml"),
    '[dep]\ncore = "../core"',
  );
  fs.writeFileSync(join(presetRoot, "edge/lib.afl"), implementation);
  const presetCommand = (command, name = undefined) =>
    request("workspace/executeCommand", {
      command,
      arguments: [uri("presets-project"), ...(name ? [name] : [])],
    });
  result.presets = await presetCommand("afl.listPresets");
  await presetCommand("afl.checkPreset", "android");
  result.presetCoreUri = presetCore;
  result.presetEdgeUri = presetEdge;
  result.presetInitial = codes(presetCore);
  result.implDefinition = await query(
    "definition",
    { line: 0, character: 23 },
    {},
    presetEdge,
  );
  result.implementation = await query(
    "implementation",
    { line: 0, character: 11 },
    {},
    presetCore,
  );
  open(presetEdge, implementation);
  change(
    presetEdge,
    2,
    implementation.replace("impl dep::core::lib::display", ""),
  );
  await barrier();
  result.implRemoved = codes(presetCore);
  change(presetEdge, 3, implementation);
  await barrier();
  result.implRestored = codes(presetCore);
  open(
    presetConfig,
    presetText.replace('edge = ["edge"]', "edge = []"),
    "toml",
  );
  await barrier();
  result.presetOverlay = codes(presetCore);
  close(presetConfig);
  await barrier();
  result.presetConfigClosed = codes(presetCore);
  await presetCommand("afl.checkPreset", "ios");
  open(standalonePreset, 'core = ["../core"]\nedge = []', "toml");
  await barrier();
  result.standaloneOverlay = codes(presetCore);
  close(standalonePreset);
  await barrier();
  result.standaloneClosed = codes(presetCore);
  fs.writeFileSync(
    join(presetRoot, "presets/ios.toml"),
    'core = ["../core"]\nedge = []',
  );
  watched(standalonePreset);
  await barrier();
  result.presetDiskChange = codes(presetCore);
  fs.unlinkSync(join(presetRoot, "presets/ios.toml"));
  watched(standalonePreset, 3);
  await barrier();
  result.presetDeleted = codes(presetConfig);
  fs.writeFileSync(join(presetRoot, "presets/ios.toml"), standaloneText);
  watched(standalonePreset, 1);
  await barrier();
  result.presetRecreated = codes(presetCore);
  result.presetRecoveredConfig = codes(presetConfig);
  await request("workspace/executeCommand", { command: "afl.checkProject" });
  result.presetCleared = codes(presetCore);
  close(presetEdge);
  await request("shutdown");
  notify("exit");
  result.exit = await exited;
  result.stderr = stderr;
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(watchdog);
  if (child.exitCode === null) {
    child.kill();
  }
}
