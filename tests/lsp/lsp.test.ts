import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/lsp");
const fixtureDirectory = process.argv[3];
const project_root = path.dirname(path.dirname(suiteDirectory));
const fixture = fixtureDirectory;
const main_source =
  'use dep::core::lib::Adder as Remote\nuse dep::core::lib::combine as join\nfn main() {\n    value: Remote = {base: 10}\n    value.{|member|}add(1, 2)\n    message: string = join("😀", {|arg|}value.{|property|}base)\n}\n';
const core_source =
  "class {|class|}Adder [desc = [An adder]] {\n    {|property|}base: i32 [desc = [Starting value]]\n    fn {|method|}add(a: i32, b: i32) -> i32 [\n        a = [First input]\n        b = [Second input]\n        return = [Sum]\n    ] { self.base + a + b }\n}\nextern fn combine(a: string, b: i32) -> string [\n    desc = [Combine text and a number]\n    a = [Text input]\n    b = [Number input]\n    return = [Combined text]\n]\n";
try {
  fs.mkdirSync(path.join(fixture, "app"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "external/core"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "app/main.afl"),
    main_source.replace(new RegExp("\\{\\|[A-Za-z_0-9]+\\|\\}", "g"), ""),
  );
  fs.writeFileSync(
    path.join(fixture, "external/core/lib.afl"),
    core_source.replace(new RegExp("\\{\\|[A-Za-z_0-9]+\\|\\}", "g"), ""),
  );
  fs.writeFileSync(
    path.join(fixture, "app/config.toml"),
    '[dep]\ncore = "../external/core"',
  );
  fs.writeFileSync(path.join(fixture, "external/core/config.toml"), "[dep]");
  const preload = path.join(suiteDirectory, "../dist/lsp/lsp.preload.cjs");
  fs.cpSync(preload, path.join(fixture, "preload.cjs"), { recursive: true });
  const bridge = path.join(suiteDirectory, "../dist/lsp/lsp-client.js");
  for (const transport of ["stdio", "ipc"]) {
    for (const item of [
      "missing-core",
      "alias",
      "other",
      "loading",
      "absent-spec",
    ]) {
      fs.rmSync(path.join(fixture, item), { recursive: true, force: true });
    }
    const execution = run(
      process.execPath,
      [
        bridge,
        path.join(project_root, "packages/lsp/bin/afl-lsp.mjs"),
        fixture,
        transport,
      ],
      { input: JSON.stringify({ main: main_source, core: core_source }) },
    );
    if (execution.exit_code !== 0) {
      throw new Error(
        {
          msg:
            "" + String(execution.stdout) + "" + String(execution.stderr) + "",
        }.msg,
      );
    }
    const result = JSON.parse(execution.stdout);
    assert.deepEqual(result.initialize.capabilities.textDocumentSync.change, 2);
    assert(result.initialize.capabilities.definitionProvider);
    assert.deepEqual(result.definition.uri, result.coreUri);
    assert.deepEqual(result.definition.range.start, result.coreMarks.method);
    assert.deepEqual(result.initialDiagnostics.version, 1);
    assert.deepEqual(result.initialDiagnostics.diagnostics, []);
    assert(result.hover.contents.value.includes("First input"));
    assert.deepEqual(result.signature.activeParameter, 1);
    assert.deepEqual(
      result.signature.signatures[0].parameters[1].documentation.value,
      "Number input",
    );
    assert.deepEqual(result.references.length, 3);
    if (transport === "stdio") {
      assert.deepEqual(
        result.outline[0].children.map((item) => item.name),
        ["base", "add"],
      );
    } else {
      assert.deepEqual(
        result.outline.map((item) => item.name),
        ["Adder", "base", "add", "combine"],
      );
      assert.deepEqual(result.outline[1].containerName, "Adder");
    }
    assert.deepEqual(result.incremental.version, 2);
    assert(
      result.incremental.diagnostics
        .map((item) => item.code)
        .includes("AFL3204"),
    );
    assert.deepEqual(
      result.completion.map((item) => item.label),
      ["add", "base"],
    );
    assert.deepEqual(result.completion[0].textEdit.newText, "add");
    assert(result.incompleteDiagnostics.includes("AFL1002"));
    assert(!result.staleVersions.includes(5));
    assert.deepEqual(result.latestAfterStale.version, 6);
    assert.deepEqual(result.latestAfterStale.diagnostics, []);
    assert.deepEqual(result.afterStale, result.definition);
    assert(result.missingDependency.includes("AFL3002"));
    assert.deepEqual(result.missingDefinition, null);
    assert(result.recoveredDefinition.uri.endsWith("/missing-core/lib.afl"));
    assert.deepEqual(result.recoveredConfig, []);
    assert(result.unfinishedConfig.includes("AFL3001"));
    assert.deepEqual(result.removedResourceNotes, ["AFL3001"]);
    assert.deepEqual(result.resRemoved, []);
    assert.deepEqual(result.resRemovalDefinition, result.definition);
    assert.deepEqual(result.configClosedDefinition, result.definition);
    assert.deepEqual(result.created, ["AFL3203"]);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.changedDefinition, null);
    assert(result.changedDependency.includes("AFL3204"));
    assert.deepEqual(result.unreadable, ["AFL9001"]);
    assert.deepEqual(result.failureMain, []);
    assert.deepEqual(result.readableAgain, []);
    assert.deepEqual(result.nullableDefinition, result.definition);
    assert.deepEqual(result.nullableDiagnostics, []);
    assert(result.nullableOutline.map((item) => item.name).includes("absent"));
    assert(result.nullableHover.contents.value.includes("string?"));
    assert.deepEqual(
      result.callbackSignature.signatures[0].label,
      "fn(string, i32) -> string",
    );
    assert.deepEqual(result.callbackSignature.activeParameter, 1);
    assert.deepEqual(result.callbackDefinition.uri, result.coreUri);
    assert.deepEqual(result.callbackDiagnostics, []);
    assert.deepEqual(result.specDefinition.uri, result.coreUri);
    assert.deepEqual(result.specDefinition.range.start, result.coreMarks.class);
    assert.deepEqual(result.specInitial, []);
    assert.deepEqual(result.specDiskError, ["AFL3203"]);
    assert.deepEqual(result.specOverlay, []);
    assert.deepEqual(result.specClosed, ["AFL3203"]);
    assert.deepEqual(result.specMissing, ["AFL3004"]);
    assert.deepEqual(result.specUnloaded, []);
    assert.deepEqual(result.specRecovered, []);
    assert.deepEqual(result.specConfigClosed, []);
    assert.deepEqual(result.aliasDefinition.uri, result.aliasUri);
    assert(result.aliasHover.contents.value.includes("Starting value"));
    assert.deepEqual(result.workspaceDefinition, result.definition);
    assert.deepEqual(result.changedWorkspace, ["AFL3203"]);
    assert.deepEqual(result.clearedWorkspace, []);
    assert.deepEqual(result.untitled, ["AFL3203"]);
    assert.deepEqual(result.clearedOther, ["AFL3203"]);
    assert.deepEqual(result.closedUntitled, []);
    assert(result.initialize.capabilities.implementationProvider);
    assert(result.initialize.capabilities.documentFormattingProvider);
    assert.deepEqual(
      result.formatted[0].newText,
      "fn main() {\r\n  call()\r\n}\r\n",
    );
    assert.deepEqual(result.formatted[0].range.end, { line: 1, character: 0 });
    assert.deepEqual(result.formattedAgain, []);
    assert.deepEqual(result.formatInvalid, []);
    assert.deepEqual(
      result.presets.presets.map((item) => item.name),
      ["android", "ios"],
    );
    assert.deepEqual(result.presets.diagnostics, []);
    assert.deepEqual(result.presetInitial, []);
    assert.deepEqual(result.implDefinition.uri, result.presetCoreUri);
    assert.deepEqual(result.implementation[0].uri, result.presetEdgeUri);
    assert(result.implRemoved.includes("AFL4101"));
    assert.deepEqual(result.implRestored, []);
    assert(result.presetOverlay.includes("AFL4101"));
    assert.deepEqual(result.presetConfigClosed, []);
    assert(result.standaloneOverlay.includes("AFL4101"));
    assert.deepEqual(result.standaloneClosed, []);
    assert(result.presetDiskChange.includes("AFL4101"));
    assert(result.presetDeleted.includes("AFL4002"));
    assert.deepEqual(result.presetRecreated, []);
    assert.deepEqual(result.presetRecoveredConfig, []);
    assert.deepEqual(result.presetCleared, []);
    assert.deepEqual(result.exit.code, 0);
    assert.deepEqual(result.stderr, "");
    console.log(
      "LSP protocol checks passed: queries, incremental edits, stale reads, configuration, file watches, aliases and lifecycle.",
    );
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
