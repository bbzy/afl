import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/vscode");
const fixtureDirectory = process.argv[3];
const extensionRootArgument = process.argv[4] || undefined;
const project_root = path.dirname(path.dirname(suiteDirectory));
const extensionRoot =
  extensionRootArgument ?? path.join(project_root, "packages/vscode");
const manifest = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"),
);
const fixture = fixtureDirectory;
try {
  fs.mkdirSync(path.join(fixture, "extension/dist"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "app"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "core"), { recursive: true });
  fs.cpSync(
    path.join(extensionRoot, "dist/extension.cjs"),
    path.join(fixture, "extension/dist/extension.cjs"),
    { recursive: true },
  );
  fs.cpSync(
    path.join(extensionRoot, "dist/server.cjs"),
    path.join(fixture, "extension/dist/server.cjs"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(fixture, "app/main.afl"),
    "use dep::core::lib::show\nfn main() {\n    value: i32 = show(1)\n}",
  );
  fs.writeFileSync(
    path.join(fixture, "app/config.toml"),
    "[project]\n[dep]\ncore = '../core'",
  );
  fs.writeFileSync(
    path.join(fixture, "core/lib.afl"),
    "extern fn show(a: i32) -> i32 [\n desc = [Display number]\n a = [Input number]\n return = [Displayed number]\n]",
  );
  fs.writeFileSync(path.join(fixture, "core/config.toml"), "[dep]");
  const bridge = path.join(suiteDirectory, "../dist/vscode/adapter-host.cjs");
  const execution = run(process.execPath, [bridge, fixture]);
  if (execution.exit_code !== 0) {
    throw new Error(
      {
        msg: "" + String(execution.stdout) + "" + String(execution.stderr) + "",
      }.msg,
    );
  }
  const result = JSON.parse(execution.stdout);
  assert.deepEqual(manifest.main, "./dist/extension.cjs");
  assert.deepEqual(result.initial, []);
  assert.deepEqual(result.providers, [
    "CompletionItem",
    "Definition",
    "DocumentSymbol",
    "Hover",
    "Implementation",
    "Reference",
    "SignatureHelp",
  ]);
  assert.deepEqual(result.definition.uri, result.coreUri);
  assert(result.hover.contents.value.includes("Display number"));
  assert.deepEqual(result.signature.activeParameter, 0);
  assert.deepEqual(
    result.signature.signatures[0].parameters[0].label,
    "a: i32",
  );
  assert.deepEqual(result.references.length, 2);
  assert.deepEqual(
    result.outline.map((item) => item.name),
    ["show"],
  );
  assert.deepEqual(
    result.completion.map((item) => item.label),
    ["show"],
  );
  assert(result.unsavedConfig.includes("AFL3002"));
  assert.deepEqual(result.restoredDefinition, result.definition);
  assert.deepEqual(result.created, ["AFL3203"]);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.untitled, ["AFL3203"]);
  assert.deepEqual(result.workspaceDefinition, result.definition);
  assert(result.logs.includes("Activating AFL extension"));
  assert(result.logs.includes("Language server ready"));
  assert(result.logs.includes("Project check completed"));
  assert(result.logs.includes("Language server stopped"));
  assert(result.logs.every((line) => !line.startsWith("ERROR:")));
  assert(
    result.channels.some(
      (channel) =>
        channel.name === "AFL" &&
        channel.options.log &&
        channel.shown &&
        channel.disposed,
    ),
  );
  assert(
    result.statuses.some(
      (item) =>
        item.id === "afl.preset" &&
        item.visible &&
        item.disposed &&
        item.text.includes("No preset"),
    ),
  );
  assert.deepEqual(result.cleaned, {
    diagnostics: true,
    providers: 0,
    commands: 0,
    watchers: true,
    listenersReturnedToBaseline: true,
  });
  console.log(
    "VS Code checks passed: portable bundles, real LSP client/server, providers, document sync, file watches and disposal.",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
