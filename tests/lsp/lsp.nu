use ../support.nu temporary-directory
use std/assert

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let fixture = (temporary-directory "lsp")
  let main_source = r#'use dep::core::lib::Adder as Remote
use dep::core::lib::combine as join
fn main() {
    value: Remote = {base: 10}
    value.{|member|}add(1, 2)
    message: string = join("😀", {|arg|}value.{|property|}base)
}
'#
  let core_source = r#'class {|class|}Adder [desc = [An adder]] {
    {|property|}base: i32 [desc = [Starting value]]
    fn {|method|}add(a: i32, b: i32) -> i32 [
        a = [First input]
        b = [Second input]
        return = [Sum]
    ] { self.base + a + b }
}
extern fn combine(a: string, b: i32) -> string [
    desc = [Combine text and a number]
    a = [Text input]
    b = [Number input]
    return = [Combined text]
]
'#
  try {
    mkdir ($fixture | path join "app") ($fixture | path join "external/core")
    $main_source | str replace --all --regex '\{\|[A-Za-z_0-9]+\|\}' '' | save ($fixture | path join "app/main.afl")
    $core_source | str replace --all --regex '\{\|[A-Za-z_0-9]+\|\}' '' | save ($fixture | path join "external/core/lib.afl")
    '[dep]
core = "../external/core"' | save ($fixture | path join "app/config.toml")
    "[dep]" | save ($fixture | path join "external/core/config.toml")
    # Deterministic slow/failing disk reads exercise the real server's async snapshots.
    let preload = r#'
      const fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path");
      const root = process.env.AFL_TEST_ROOT, read = fsp.readFile;
      fsp.readFile = async function(file, ...args) {
        if (String(file).endsWith("/external/core/lib.afl")) {
          if (fs.existsSync(path.join(root, "fail"))) {
            const error = new Error("Simulated unreadable dependency"); error.code = "EACCES"; error.path = String(file); throw error;
          }
          if (fs.existsSync(path.join(root, "pause"))) {
            const result = await read.call(this, file, ...args);
            fs.writeFileSync(path.join(root, "loading"), "");
            while (fs.existsSync(path.join(root, "pause"))) await new Promise(resolve => setTimeout(resolve, 5));
            return result;
          }
        }
        return read.call(this, file, ...args);
      };
      require("node:module").syncBuiltinESMExports();
    '#
    $preload | save ($fixture | path join "preload.cjs")
    let bridge = r#'
      import fs from "node:fs";
      import {join} from "node:path";
      import {pathToFileURL} from "node:url";
      import {spawn} from "node:child_process";
      const input = JSON.parse(fs.readFileSync(0, "utf8"));
      const root = fs.realpathSync(process.argv[2]), uri = file => pathToFileURL(join(root, file)).href;
      const mainUri = uri("app/main.afl"), coreUri = uri("external/core/lib.afl"), configUri = uri("app/config.toml");
      const position = (text, offset) => {
        const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
        return {line: lines.length - 1, character: lines.at(-1).length};
      };
      const marked = source => {
        let text = "", end = 0; const marks = {};
        for (const match of source.matchAll(/\{\|([A-Za-z_0-9]+)\|\}/g)) {
          text += source.slice(end, match.index); marks[match[1]] = position(text, text.length); end = match.index + match[0].length;
        }
        return {text: text + source.slice(end), marks};
      };
      const main = marked(input.main), core = marked(input.core);
      const ipc = process.argv[3] === "ipc";
      const child = spawn(process.execPath, ["--require", join(root, "preload.cjs"), process.argv[1], ipc ? "--node-ipc" : "--stdio"], {
        stdio: ipc ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"], env: {...process.env, AFL_TEST_ROOT: root},
      });
      const watchdog = setTimeout(() => { child.kill(); throw new Error("LSP test timed out"); }, 20000);
      let buffer = Buffer.alloc(0), nextId = 1, stderr = "";
      const requests = new Map(), notifications = [], registrations = [], latest = new Map(), waiters = new Set();
      const send = message => {
        const packet = {jsonrpc: "2.0", ...message};
        if (ipc) { child.send(packet); return; }
        const body = Buffer.from(JSON.stringify(packet));
        child.stdin.write(Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body]));
      };
      const notify = (method, params = {}) => send({method, params});
      const request = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++; requests.set(id, {resolve, reject}); send({id, method, params});
      });
      const wake = () => { for (const check of [...waiters]) check(); };
      const until = (predicate, label) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(check); reject(new Error("Timed out: " + label + "\n" + stderr)); }, 8000);
        function check() { if (predicate()) { clearTimeout(timer); waiters.delete(check); resolve(); } }
        waiters.add(check); check();
      });
      child.stderr.on("data", data => { stderr += data; });
      const accept = message => {
          if (message.method && message.id !== undefined) {
            if (message.method === "client/registerCapability") registrations.push(...message.params.registrations);
            send({id: message.id, result: null});
          } else if (message.id !== undefined) {
            const pending = requests.get(message.id); requests.delete(message.id);
            if (message.error) pending?.reject(new Error(JSON.stringify(message.error))); else pending?.resolve(message.result);
          } else {
            notifications.push(message);
            if (message.method === "textDocument/publishDiagnostics") latest.set(message.params.uri, message.params);
          }
          wake();
      };
      if (ipc) child.on("message", accept);
      child.stdout.on("data", data => {
        buffer = Buffer.concat([buffer, data]);
        for (;;) {
          const end = buffer.indexOf("\r\n\r\n"); if (end < 0) break;
          const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
          if (!Number.isFinite(length)) throw new Error("Non-protocol stdout");
          if (buffer.length < end + 4 + length) break;
          const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length)); buffer = buffer.subarray(end + 4 + length);
          accept(message);
        }
      });
      const exited = new Promise(resolve => child.on("exit", (code, signal) => { resolve({code, signal}); wake(); }));
      const query = (method, at, extra = {}, target = mainUri) => request("textDocument/" + method, {
        textDocument: {uri: target}, ...(at ? {position: at} : {}), ...extra,
      });
      const barrier = () => query("documentSymbol");
      const codes = target => (latest.get(target)?.diagnostics ?? []).map(item => item.code);
      const open = (target, text, languageId = "afl", version = 1) =>
        notify("textDocument/didOpen", {textDocument: {uri: target, text, languageId, version}});
      const change = (target, version, text) => notify("textDocument/didChange", {
        textDocument: {uri: target, version}, contentChanges: [{text}],
      });
      const close = target => notify("textDocument/didClose", {textDocument: {uri: target}});
      const watched = (target, type = 2) => notify("workspace/didChangeWatchedFiles", {changes: [{uri: target, type}]});
      const result = {};
      try {
        result.initialize = await request("initialize", {
          processId: process.pid, rootUri: uri("app"), workspaceFolders: [{uri: uri("app"), name: "app"}],
          capabilities: {textDocument: {documentSymbol: {hierarchicalDocumentSymbolSupport: !ipc}}, workspace: {workspaceFolders: true, didChangeWatchedFiles: {dynamicRegistration: true, relativePatternSupport: true}}},
        });
        notify("initialized");
        open(mainUri, main.text);
        const formatUri = "untitled:format.afl";
        open(formatUri, "fn main(){call()}\r\n");
        result.formatted = await query("formatting", null, {options: {tabSize: 2, insertSpaces: true}}, formatUri);
        change(formatUri, 2, result.formatted[0].newText);
        result.formattedAgain = await query("formatting", null, {options: {tabSize: 2, insertSpaces: true}}, formatUri);
        change(formatUri, 3, "fn broken(");
        result.formatInvalid = await query("formatting", null, {options: {tabSize: 2, insertSpaces: true}}, formatUri);
        close(formatUri);

        result.definition = await query("definition", main.marks.member);
        result.coreUri = coreUri; result.coreMarks = core.marks;
        result.initialDiagnostics = latest.get(mainUri);
        result.hover = await query("hover", main.marks.member);
        result.signature = await query("signatureHelp", main.marks.arg);
        result.references = await query("references", core.marks.property, {context: {includeDeclaration: false}}, coreUri);
        result.outline = await query("documentSymbol", null, {}, coreUri);
        await until(() => registrations.some(item => item.registerOptions.watchers.some(watcher => watcher.globPattern.baseUri === uri("external/core/"))), "external watcher");
        result.watchers = registrations.flatMap(item => item.registerOptions.watchers);

        // Incremental UTF-16 edit, after a non-BMP character, changes only a member.
        const propertyStart = main.marks.property;
        notify("textDocument/didChange", {textDocument: {uri: mainUri, version: 2}, contentChanges: [{
          range: {start: propertyStart, end: {...propertyStart, character: propertyStart.character + 4}}, text: "missing",
        }]});
        await barrier(); result.incremental = latest.get(mainUri);
        change(mainUri, 3, "use dep::core::lib::Adder as Remote\nfn main() {\n value: Remote = [创建]\n value.");
        result.completion = await query("completion", {line: 3, character: 7});
        result.incompleteDiagnostics = codes(mainUri);
        change(mainUri, 4, main.text); await barrier();

        // An obsolete read must never publish diagnostics for document version 5.
        fs.writeFileSync(join(root, "pause"), "");
        change(mainUri, 5, main.text.replace("value.add(1, 2)", "missing()"));
        const checkLoading = setInterval(wake, 5);
        try { await until(() => fs.existsSync(join(root, "loading")), "paused source read"); }
        finally { clearInterval(checkLoading); }
        change(mainUri, 6, main.text);
        fs.unlinkSync(join(root, "pause"));
        result.afterStale = await query("definition", main.marks.member);
        result.staleVersions = notifications.filter(item => item.method === "textDocument/publishDiagnostics" && item.params.uri === mainUri).map(item => item.params.version);
        result.latestAfterStale = latest.get(mainUri);

        open(configUri, "[dep]\ncore = \"../missing-core\"", "toml");
        await barrier(); result.missingDependency = codes(configUri);
        result.missingDefinition = await query("definition", main.marks.member);
        await until(() => registrations.some(item => item.registerOptions.watchers.some(w => w.globPattern.baseUri === uri("missing-core/"))), "missing dependency watcher");
        fs.mkdirSync(join(root, "missing-core"));
        fs.writeFileSync(join(root, "missing-core/lib.afl"), core.text);
        fs.writeFileSync(join(root, "missing-core/config.toml"), "[dep]");
        watched(uri("missing-core/lib.afl"), 1);
        result.recoveredDefinition = await query("definition", main.marks.member);
        result.recoveredConfig = codes(configUri);

        // An unfinished array/comment formerly hung the TOML parser at EOF.
        change(configUri, 2, "a=[1 #");
        await barrier(); result.unfinishedConfig = codes(configUri);
        change(configUri, 3, '[dep]\ncore = "../external/core"\n[res]\nsdk = 123');
        await barrier(); result.removedResourceNotes = codes(configUri);
        change(configUri, 4, '[dep]\ncore = "../external/core"');
        await barrier(); result.resRemoved = codes(configUri);
        result.resRemovalDefinition = await query("definition", main.marks.member);
        close(configUri);
        result.configClosedDefinition = await query("definition", main.marks.member);

        fs.writeFileSync(join(root, "app/extra.afl"), "fn extra() { missing_extra() }");
        watched(uri("app/extra.afl"), 1); await barrier(); result.created = codes(uri("app/extra.afl"));
        fs.unlinkSync(join(root, "app/extra.afl"));
        watched(uri("app/extra.afl"), 3); await barrier(); result.deleted = codes(uri("app/extra.afl"));
        fs.writeFileSync(join(root, "external/core/lib.afl"), core.text.replace("fn add(", "fn plus("));
        watched(coreUri); result.changedDefinition = await query("definition", main.marks.member);
        result.changedDependency = codes(mainUri);
        fs.writeFileSync(join(root, "external/core/lib.afl"), core.text); watched(coreUri); await barrier();

        fs.writeFileSync(join(root, "fail"), "");
        watched(coreUri); await barrier(); result.unreadable = codes(coreUri); result.failureMain = codes(mainUri);
        fs.unlinkSync(join(root, "fail")); watched(coreUri); await barrier(); result.readableAgain = codes(coreUri);

        const nullableText = main.text.replace("value: Remote", "value: Remote?") +
          '\nfn absent() -> string? [return = [No name]] { null }';
        change(mainUri, 7, nullableText);
        result.nullableDefinition = await query("definition", main.marks.member);
        result.nullableDiagnostics = codes(mainUri);
        result.nullableOutline = await query("documentSymbol", null);
        result.nullableHover = await query("hover", position(nullableText, nullableText.indexOf("absent")));
        const callback = marked('use dep::core::lib::combine\nfn main() {\n' +
          ' handler: fn(string, i32) -> string = {|reference|}combine\n handler("name", {|argument|}1)\n}');
        change(mainUri, 8, callback.text);
        result.callbackSignature = await query("signatureHelp", callback.marks.argument);
        result.callbackDefinition = await query("definition", callback.marks.reference);
        result.callbackDiagnostics = codes(mainUri);
        change(mainUri, 9, main.text); await barrier();

        // A crate's test specifications can live outside the workspace. TOML
        // overlays, file watchers and symbol queries must include those sources.
        const specUri = uri("external/spec/lib.afl");
        const specText = "use dep::core::lib::Adder\nfn scenario() [desc = [Describe expected behavior]]";
        fs.mkdirSync(join(root, "external/spec"), {recursive: true});
        fs.writeFileSync(join(root, "external/spec/lib.afl"), specText);
        fs.writeFileSync(join(root, "external/spec/config.toml"), '[dep]\ncore = "../core"');
        const testConfig = '[dep]\ncore = "../external/core"\n[test]\ncrates = ["../external/spec"]';
        open(configUri, testConfig, "toml");
        result.specDefinition = await query("definition", {line: 0, character: 21}, {}, specUri);
        result.specInitial = codes(specUri);
        await until(() => registrations.some(item => item.registerOptions.watchers.some(w => w.globPattern.baseUri === uri("external/spec/"))), "test specification watcher");
        fs.writeFileSync(join(root, "external/spec/lib.afl"), "fn scenario() { missing_test() }");
        watched(specUri); await barrier(); result.specDiskError = codes(specUri);
        open(specUri, specText); await barrier(); result.specOverlay = codes(specUri);
        close(specUri); await barrier(); result.specClosed = codes(specUri);
        change(configUri, 2, testConfig.replace('"../external/spec"', '"../absent-spec"'));
        await barrier(); result.specMissing = codes(configUri); result.specUnloaded = codes(specUri);
        await until(() => registrations.some(item => item.registerOptions.watchers.some(w => w.globPattern.baseUri === uri("absent-spec/"))), "missing test specification watcher");
        fs.mkdirSync(join(root, "absent-spec"));
        fs.writeFileSync(join(root, "absent-spec/lib.afl"), "fn scenario() [desc = [Expected behavior]]");
        fs.writeFileSync(join(root, "absent-spec/config.toml"), "[dep]");
        watched(uri("absent-spec/lib.afl"), 1); await barrier(); result.specRecovered = codes(configUri);
        close(configUri); await barrier(); result.specConfigClosed = codes(configUri);

        // Opened symlink URIs must round-trip diagnostics and locations.
        fs.symlinkSync(join(root, "external/core"), join(root, "alias"));
        const aliasUri = uri("alias/lib.afl");
        open(aliasUri, core.text);
        result.aliasDefinition = await query("definition", main.marks.member);
        result.aliasHover = await query("hover", core.marks.property, {}, aliasUri);
        result.aliasUri = aliasUri;
        close(aliasUri); await barrier();

        fs.writeFileSync(join(root, "app/config.toml"), fs.readFileSync(join(root, "app/config.toml"), "utf8").replace(/\n\[project\]\s*/gu, "") + "\n[project]\n");
        watched(configUri);
        close(mainUri);
        await request("workspace/executeCommand", {command: "afl.checkProject"});
        result.workspaceDefinition = await query("definition", main.marks.member);
        fs.mkdirSync(join(root, "other"));
        fs.writeFileSync(join(root, "other/main.afl"), "fn main() { unknown() }");
        fs.writeFileSync(join(root, "other/config.toml"), "[project]\n[dep]");
        notify("workspace/didChangeWorkspaceFolders", {event: {removed: [{uri: uri("app"), name: "app"}], added: [{uri: uri("other"), name: "other"}]}});
        await barrier(); result.changedWorkspace = codes(uri("other/main.afl")); result.clearedWorkspace = codes(mainUri);

        open("untitled:Scratch.afl", "fn main() { missing() }");
        await barrier(); result.untitled = codes("untitled:Scratch.afl"); result.clearedOther = codes(uri("other/main.afl"));
        close("untitled:Scratch.afl");
        await barrier(); result.closedUntitled = codes("untitled:Scratch.afl");

        // Explicit preset selection, live TOML overlays and implementation queries.
        const presetRoot = join(root, "presets-project");
        for (const part of ["core", "edge", "presets"]) fs.mkdirSync(join(presetRoot, part), {recursive: true});
        const presetCore = uri("presets-project/core/lib.afl"), presetEdge = uri("presets-project/edge/lib.afl");
        const presetConfig = uri("presets-project/config.toml"), standalonePreset = uri("presets-project/presets/ios.toml");
        const presetText = 'preset_dir = "presets"\n[project]\n[preset.android]\ncore = ["core"]\nedge = ["edge"]';
        const standaloneText = 'core = ["../core"]\nedge = ["../edge"]';
        const implementation = "impl dep::core::lib::display\nfn display() [desc = [Platform display]]";
        fs.writeFileSync(join(presetRoot, "config.toml"), presetText);
        fs.writeFileSync(join(presetRoot, "presets/ios.toml"), standaloneText);
        fs.writeFileSync(join(presetRoot, "core/config.toml"), "[dep]");
        fs.writeFileSync(join(presetRoot, "core/lib.afl"), "extern fn display() [desc = [Display]]");
        fs.writeFileSync(join(presetRoot, "edge/config.toml"), '[dep]\ncore = "../core"');
        fs.writeFileSync(join(presetRoot, "edge/lib.afl"), implementation);
        const presetCommand = (command, name) => request("workspace/executeCommand", {
          command, arguments: [uri("presets-project"), ...(name ? [name] : [])],
        });
        result.presets = await presetCommand("afl.listPresets");
        await presetCommand("afl.checkPreset", "android");
        result.presetCoreUri = presetCore; result.presetEdgeUri = presetEdge;
        result.presetInitial = codes(presetCore);
        result.implDefinition = await query("definition", {line: 0, character: 23}, {}, presetEdge);
        result.implementation = await query("implementation", {line: 0, character: 11}, {}, presetCore);
        open(presetEdge, implementation);
        change(presetEdge, 2, implementation.replace("impl dep::core::lib::display", ""));
        await barrier(); result.implRemoved = codes(presetCore);
        change(presetEdge, 3, implementation); await barrier(); result.implRestored = codes(presetCore);
        open(presetConfig, presetText.replace('edge = ["edge"]', 'edge = []'), "toml");
        await barrier(); result.presetOverlay = codes(presetCore);
        close(presetConfig); await barrier(); result.presetConfigClosed = codes(presetCore);
        await presetCommand("afl.checkPreset", "ios");
        open(standalonePreset, 'core = ["../core"]\nedge = []', "toml");
        await barrier(); result.standaloneOverlay = codes(presetCore);
        close(standalonePreset); await barrier(); result.standaloneClosed = codes(presetCore);
        fs.writeFileSync(join(presetRoot, "presets/ios.toml"), 'core = ["../core"]\nedge = []');
        watched(standalonePreset); await barrier(); result.presetDiskChange = codes(presetCore);
        fs.unlinkSync(join(presetRoot, "presets/ios.toml"));
        watched(standalonePreset, 3); await barrier(); result.presetDeleted = codes(presetConfig);
        fs.writeFileSync(join(presetRoot, "presets/ios.toml"), standaloneText);
        watched(standalonePreset, 1); await barrier(); result.presetRecreated = codes(presetCore);
        result.presetRecoveredConfig = codes(presetConfig);
        await request("workspace/executeCommand", {command: "afl.checkProject"});
        result.presetCleared = codes(presetCore);
        close(presetEdge);
        await request("shutdown"); notify("exit");
        result.exit = await exited; result.stderr = stderr;
        console.log(JSON.stringify(result));
      } finally {
        clearTimeout(watchdog);
        if (child.exitCode === null) child.kill();
      }
    '#
    for transport in ["stdio", "ipc"] {
      for item in ["missing-core", "alias", "other", "loading", "absent-spec"] {
        rm --recursive --force ($fixture | path join $item)
      }
      let execution = ({main: $main_source, core: $core_source} | to json |
        ^node --input-type=module -e $bridge ($project_root | path join "packages/lsp/bin/afl-lsp.mjs") $fixture $transport | complete)
      if $execution.exit_code != 0 { error make {msg: $"($execution.stdout)($execution.stderr)"} }
      let result = ($execution.stdout | from json)
      assert equal $result.initialize.capabilities.textDocumentSync.change 2
      assert $result.initialize.capabilities.definitionProvider
      assert equal $result.definition.uri $result.coreUri
      assert equal $result.definition.range.start $result.coreMarks.method
      assert equal $result.initialDiagnostics.version 1
      assert equal $result.initialDiagnostics.diagnostics []
      assert ($result.hover.contents.value | str contains "First input")
      assert equal $result.signature.activeParameter 1
      assert equal $result.signature.signatures.0.parameters.1.documentation.value "Number input"
      assert equal ($result.references | length) 3
      if $transport == "stdio" {
        assert equal ($result.outline.0.children | get name) ["base", "add"]
      } else {
        assert equal ($result.outline | get name) ["Adder", "base", "add", "combine"]
        assert equal $result.outline.1.containerName "Adder"
      }
      assert equal $result.incremental.version 2
      assert ("AFL3204" in ($result.incremental.diagnostics | get code))
      assert equal ($result.completion | get label) ["add", "base"]
      assert equal $result.completion.0.textEdit.newText "add"
      assert ("AFL1002" in $result.incompleteDiagnostics)
      assert not (5 in $result.staleVersions)
      assert equal $result.latestAfterStale.version 6
      assert equal $result.latestAfterStale.diagnostics []
      assert equal $result.afterStale $result.definition
      assert ("AFL3002" in $result.missingDependency)
      assert equal $result.missingDefinition null
      assert ($result.recoveredDefinition.uri | str ends-with "/missing-core/lib.afl")
      assert equal $result.recoveredConfig []
      assert ("AFL3001" in $result.unfinishedConfig)
      assert equal $result.removedResourceNotes [AFL3001]
      assert equal $result.resRemoved []
      assert equal $result.resRemovalDefinition $result.definition
      assert equal $result.configClosedDefinition $result.definition
      assert equal $result.created ["AFL3203"]
      assert equal $result.deleted []
      assert equal $result.changedDefinition null
      assert ("AFL3204" in $result.changedDependency)
      assert equal $result.unreadable ["AFL9001"]
      assert equal $result.failureMain []
      assert equal $result.readableAgain []
      assert equal $result.nullableDefinition $result.definition
      assert equal $result.nullableDiagnostics []
      assert ("absent" in ($result.nullableOutline | get name))
      assert ($result.nullableHover.contents.value | str contains "string?")
      assert equal $result.callbackSignature.signatures.0.label "fn(string, i32) -> string"
      assert equal $result.callbackSignature.activeParameter 1
      assert equal $result.callbackDefinition.uri $result.coreUri
      assert equal $result.callbackDiagnostics []
      assert equal $result.specDefinition.uri $result.coreUri
      assert equal $result.specDefinition.range.start $result.coreMarks.class
      assert equal $result.specInitial []
      assert equal $result.specDiskError [AFL3203]
      assert equal $result.specOverlay []
      assert equal $result.specClosed [AFL3203]
      assert equal $result.specMissing [AFL3004]
      assert equal $result.specUnloaded []
      assert equal $result.specRecovered []
      assert equal $result.specConfigClosed []
      assert equal $result.aliasDefinition.uri $result.aliasUri
      assert ($result.aliasHover.contents.value | str contains "Starting value")
      assert equal $result.workspaceDefinition $result.definition
      assert equal $result.changedWorkspace ["AFL3203"]
      assert equal $result.clearedWorkspace []
      assert equal $result.untitled ["AFL3203"]
      assert equal $result.clearedOther ["AFL3203"] # Unrelated untitled files do not unload a project.
      assert equal $result.closedUntitled []
      assert $result.initialize.capabilities.implementationProvider
      assert $result.initialize.capabilities.documentFormattingProvider
      assert equal $result.formatted.0.newText "fn main() {\r\n  call()\r\n}\r\n"
      assert equal $result.formatted.0.range.end {line: 1, character: 0}
      assert equal $result.formattedAgain []
      assert equal $result.formatInvalid []
      assert equal ($result.presets.presets | get name) [android ios]
      assert equal $result.presets.diagnostics []
      assert equal $result.presetInitial []
      assert equal $result.implDefinition.uri $result.presetCoreUri
      assert equal $result.implementation.0.uri $result.presetEdgeUri
      assert ("AFL4101" in $result.implRemoved)
      assert equal $result.implRestored []
      assert ("AFL4101" in $result.presetOverlay)
      assert equal $result.presetConfigClosed []
      assert ("AFL4101" in $result.standaloneOverlay)
      assert equal $result.standaloneClosed []
      assert ("AFL4101" in $result.presetDiskChange)
      assert ("AFL4002" in $result.presetDeleted)
      assert equal $result.presetRecreated []
      assert equal $result.presetRecoveredConfig []
      assert equal $result.presetCleared []
      assert equal $result.exit.code 0
      assert equal $result.stderr ""
      print "LSP protocol checks passed: queries, incremental edits, stale reads, configuration, file watches, aliases and lifecycle."
    }
  } finally {
    rm --recursive --force $fixture
  }
}
