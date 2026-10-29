import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/vscode");
const fixtureDirectory = process.argv[3];
const vscode_executable = process.argv[4] || undefined;
const project_root = path.dirname(path.dirname(suiteDirectory));
const version = JSON.parse(
  fs.readFileSync(path.join(project_root, "package.json"), "utf8"),
).version;
const temporary_root = process.env.TEMP_DIR ?? "";
const run_root =
  temporary_root === ""
    ? path.join(project_root, ".test-artifacts", "vscode-e2e")
    : fs.realpathSync(temporary_root);
fs.mkdirSync(run_root, { recursive: true });
const fixture = fixtureDirectory;
console.log("VS Code E2E artifacts and logs: " + String(fixture) + "");
fs.mkdirSync(path.join(fixture, "workspace/app"), { recursive: true });
fs.mkdirSync(path.join(fixture, "workspace/core"), { recursive: true });
fs.mkdirSync(path.join(fixture, "driver"), { recursive: true });
fs.writeFileSync(
  path.join(fixture, "workspace/app/main.afl"),
  "use dep::core::lib::show\nfn main() {\n    value: i32 = show(1)\n}",
);
fs.writeFileSync(
  path.join(fixture, "workspace/app/config.toml"),
  "[dep]\ncore = '../core'",
);
fs.writeFileSync(
  path.join(fixture, "workspace/core/lib.afl"),
  "extern fn show(a: i32) -> i32 [\n desc = [Display number]\n a = [Input number]\n return = [Displayed number]\n]",
);
fs.writeFileSync(path.join(fixture, "workspace/core/config.toml"), "[dep]");
fs.mkdirSync(path.join(fixture, "specs"), { recursive: true });
fs.writeFileSync(
  path.join(fixture, "specs/config.toml"),
  '[dep]\ncore = "../workspace/core"',
);
fs.writeFileSync(
  path.join(fixture, "specs/lib.afl"),
  "use dep::core::lib::show\nfn scenario() { missing_test() }",
);
fs.mkdirSync(path.join(fixture, "workspace/edge"), { recursive: true });
fs.mkdirSync(path.join(fixture, "workspace/ios-edge"), { recursive: true });
fs.mkdirSync(path.join(fixture, "workspace/presets"), { recursive: true });
fs.writeFileSync(
  path.join(fixture, "workspace/config.toml"),
  'preset_dir = "presets"\n[project]\n[preset.android]\ncore = ["core"]\nedge = ["edge"]',
);
fs.writeFileSync(
  path.join(fixture, "workspace/presets/ios.toml"),
  'core = ["../core"]\nedge = ["../ios-edge"]',
);
fs.writeFileSync(
  path.join(fixture, "workspace/edge/config.toml"),
  '[dep]\ncore = "../core"',
);
fs.writeFileSync(
  path.join(fixture, "workspace/edge/lib.afl"),
  "impl dep::core::lib::show\nfn show(value: i32) -> i32 [\n    value = [Input]\n    return = [Displayed value]\n] { value }",
);
fs.cpSync(
  path.join(fixture, "workspace/edge/config.toml"),
  path.join(fixture, "workspace/ios-edge/config.toml"),
  { recursive: true },
);
fs.cpSync(
  path.join(fixture, "workspace/edge/lib.afl"),
  path.join(fixture, "workspace/ios-edge/lib.afl"),
  { recursive: true },
);
fs.writeFileSync(
  path.join(fixture, "workspace/app/highlighting.afl"),
  'class Counter [desc = [A counter]] {\n    value: i32 = 10000 [desc = [Current count]]\n}\nstruct Gift [desc = [Gift protocol]] {\n    "gift-id": string [desc = [Gift identity]]\n    note?: string? [desc = [Optional note]]\n}\nfn highlight(sample: i32?) -> i32? [\n    sample = [Incoming value]\n    return = [Computed value]\n] {\n    text: string = "hello"\n    pattern: string = r#"\\d+\\.\\d+"#\n    template: string = r##"first "#, [ \\n\nraw_literal_body"##\n    optional: string? = null\n    handler: fn(i32) -> i32 = [Create a transform callback]\n    [Reverse [nested] input]\n    r#[Raw if true text]#\n    if true { sample + 1 } else { 0 }\n}',
);
fs.writeFileSync(
  path.join(fixture, "driver/package.json"),
  JSON.stringify({
    contributes: { languages: [{ id: "swig", extensions: [".tpl"] }] },
    name: "afl-test-driver",
    publisher: "afl-tests",
    version: "0.0.0",
    engines: { vscode: "^1.100.0" },
    main: "./activate.cjs",
    activationEvents: ["onStartupFinished"],
  }),
);
fs.cpSync(
  path.join(project_root, "demo/implementations"),
  path.join(fixture, "workspace/associations"),
  { recursive: true },
);
fs.mkdirSync(path.join(fixture, "native-project"), { recursive: true });
fs.cpSync(
  path.join(fixture, "workspace/associations/native/Counter.kt"),
  path.join(fixture, "native-project/Counter.kt"),
  { recursive: true },
);
fs.writeFileSync(
  path.join(fixture, "workspace/associations/kotlin.toml"),
  fs
    .readFileSync(
      path.join(fixture, "workspace/associations/kotlin.toml"),
      "utf8",
    )
    .replaceAll("native/Counter.kt", "../../native-project/Counter.kt"),
);
const suite = path.join(suiteDirectory, "../dist/vscode/vscode-e2e.suite.cjs");
fs.cpSync(suite, path.join(fixture, "driver/suite.cjs"), { recursive: true });
fs.copyFileSync(
  path.join(project_root, "tests/dist/vscode/vscode-e2e.activate.cjs"),
  path.join(fixture, "driver/activate.cjs"),
);
const launcher = path.join(
  suiteDirectory,
  "../dist/vscode/vscode-e2e.launcher.cjs",
);
const execution = run(process.execPath, [
  launcher,
  project_root,
  fixture,
  version,
  vscode_executable ?? "",
]);
fs.writeFileSync(path.join(fixture, "host-stdout.log"), execution.stdout);
fs.writeFileSync(path.join(fixture, "host-stderr.log"), execution.stderr);
if (execution.exit_code !== 0) {
  throw new Error(
    {
      msg:
        "VS Code E2E failed; see " +
        String(fixture) +
        ".\\n" +
        String(execution.stdout) +
        "\\n" +
        String(execution.stderr) +
        "",
    }.msg,
  );
}
const launch = JSON.parse(
  fs.readFileSync(path.join(fixture, "launch.json"), "utf8"),
);
assert.deepEqual(launch.count, 1);
const stages = fs
  .readFileSync(path.join(fixture, "stages.jsonl"), "utf8")
  .trimEnd()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
assert.deepEqual(
  stages.map((item) => item.mode),
  [
    "command",
    "associations",
    "language",
    "persist",
    "restore",
    "cleared",
    "failure",
  ],
);
assert.deepEqual(
  [...new Set(stages.map((item) => item.appPid))],
  [launch.appPid],
);
assert.deepEqual([...new Set(stages.map((item) => item.hostPid))].length, 6);
for (const mode of ["command", "associations", "language", "failure"]) {
  const observed = JSON.parse(
    fs.readFileSync(path.join(fixture, "" + String(mode) + ".json"), "utf8"),
  );
  assert(
    !observed.activeBefore,
    "" + String(mode) + " must start with an inactive AFL extension",
  );
}
const associations = JSON.parse(
  fs.readFileSync(path.join(fixture, "associations.json"), "utf8"),
);
assert.deepEqual(associations.tplLanguage, "swig");
assert.deepEqual(associations.nativeTargets.length, 1);
assert.deepEqual(associations.trace.results.length, 2);
assert.deepEqual(associations.shiftedLine, 4);
assert(associations.nativeOverlayErrors.includes("AFL4202"));
assert(associations.deleted.includes("AFL4202"));
assert.deepEqual(associations.recreated, []);
assert(associations.impact.implementations.length >= 2);
const language = JSON.parse(
  fs.readFileSync(path.join(fixture, "language.json"), "utf8"),
);
assert.deepEqual(language.extensionVersion, version);
assert(language.extensionPath.startsWith(path.join(fixture, "extensions")));
assert(language.active);
assert.deepEqual(language.language, "afl");
assert.deepEqual(language.definition, [language.coreUri]);
assert(language.hover.replaceAll("&nbsp;", " ").includes("Display number"));
assert.deepEqual(language.signature, "a: i32");
assert(language.references.length >= 1);
assert(language.completions.includes("show"));
assert(language.unsavedErrors.includes("AFL3203"));
assert(language.dirty);
assert(language.diskUnchanged);
assert.deepEqual(language.recoveredErrors, []);
assert.deepEqual(language.formatted, "fn messy() {\n  call()\n}\n");
assert(language.formatBufferUntouched);
assert.deepEqual(language.nullableDefinition, [language.nullableTypeUri]);
assert(language.nullableHover.includes("Counter?"));
assert(language.nullableCompletions.includes("value"));
assert.deepEqual(language.nullableErrors, []);
assert.deepEqual(language.callbackSignature, "fn(i32) -> i32");
assert.deepEqual(language.callbackReference, [language.coreUri]);
assert(language.callbackErrors.includes("AFL3207"));
assert.deepEqual(language.defaultDefinition, [language.coreUri]);
assert(
  language.defaultHover
    .replaceAll("&nbsp;", " ")
    .includes("value: i32 = 10000"),
);
assert(language.removedDefaultErrors.includes("AFL3302"));
assert.deepEqual(language.defaultRecoveredErrors, []);
assert(language.defaultReferenceErrors.includes("AFL3203"));
assert.deepEqual(language.rawActiveParameter, 1);
assert.deepEqual(language.rawCompletions, []);
assert.deepEqual(language.rawDefinitions, []);
assert.deepEqual(language.afterRawDefinition, [language.coreUri]);
assert(language.rawStringErrors.includes("AFL1001"));
assert(language.rawDescriptionErrors.includes("AFL1001"));
assert.deepEqual(language.rawRecoveredErrors, []);
assert.deepEqual(language.structDefinition, [language.nullableTypeUri]);
assert(
  language.structHover.replaceAll("&nbsp;", " ").includes("note?: string?"),
);
assert.deepEqual(language.structCompletions, ["note"]);
assert(language.structFieldKind);
assert(language.structSymbolKind);
assert(language.structChildKinds);
assert(language.structRequiredErrors.includes("AFL3302"));
assert.deepEqual(language.structRecoveredErrors, []);
assert.deepEqual(language.forMemberDefinition, [language.nullableTypeUri]);
assert.deepEqual(language.forBindingLine, 3);
assert.deepEqual(language.forCompletions, ["value"]);
assert(language.forErrors.includes("AFL3208"));
assert.deepEqual(language.forRecoveredErrors, []);
assert(language.forIndexDefinition);
assert(language.forIndexHover.replaceAll("&nbsp;", " ").includes("index: i32"));
assert(language.forIndexReference);
assert(language.forIndexCompletions.includes("index"));
assert.deepEqual(language.forIndexedMember, [language.nullableTypeUri]);
assert(language.forIndexedErrors.includes("AFL3208"));
assert.deepEqual(language.forIndexedRecovered, []);
assert(language.assertFunctionKind);
assert(
  language.assertHover
    .replaceAll("&nbsp;", " ")
    .replaceAll("\\", "")
    .includes("fn assert(condition: bool)"),
);
assert.deepEqual(language.assertSignature, "fn assert(condition: bool)");
assert.deepEqual(language.assertParameter, "condition: bool");
assert.deepEqual(language.assertBuiltinDefinition, []);
assert.deepEqual(language.assertBuiltinReferences, []);
assert(language.assertArgumentDefinition);
assert(language.assertErrors.includes("AFL3206"));
assert.deepEqual(language.assertRecovered, []);
assert(
  language.assertSyntax.some(
    (token) =>
      token.c === "assert" && token.t.includes("entity.name.function.afl"),
  ),
);
assert.deepEqual(language.linkDefinition, [language.coreUri]);
assert(language.linkHover.replaceAll("&nbsp;", " ").includes("Display number"));
assert(language.linkLocalDefinition);
assert(language.linkReferences);
assert.deepEqual(language.linkRawDefinitions, []);
assert.deepEqual(language.linkRawCompletions, []);
assert(language.linkCompletions.includes("display"));
assert(language.linkErrors.includes("AFL3203"));
assert(language.linkSyntaxErrors.includes("AFL1006"));
assert.deepEqual(language.linkRecovered, []);
assert(
  language.linkSyntax.some(
    (token) =>
      token.c === "display" && token.t.includes("markup.underline.link.afl"),
  ),
);
assert.deepEqual(language.linkAndroidImplementation, [language.edgeUri]);
assert.deepEqual(language.linkIosImplementation, [language.iosEdgeUri]);
assert.deepEqual(language.closerLine, 2);
assert.deepEqual(language.closerRelatedLine, 0);
assert(language.closerMessage.includes("method body"));
assert(language.closerLaterSymbol);
assert.deepEqual(language.feedbackRecovered, []);
assert(language.unionHover.includes("camera"));
assert.deepEqual(language.unionDefinitionLine, 0);
assert(language.unionSymbolKind);
assert(language.sortingSignature.includes("key: fn(Frame) -> K"));
assert.deepEqual(language.numericSignature, "fn round(value: f64) -> f64");
assert(language.unionErrors.includes("AFL3209"));
assert.deepEqual(language.groupedDefinition, [language.coreUri]);
assert(language.groupedCompletion.includes("show"));
assert(
  language.inheritedHover.replaceAll("&nbsp;", " ").includes("Input number"),
);
assert.deepEqual(language.inheritedErrors, []);
assert(language.unsupportedDenied.includes("AFL4101"));
assert(language.unsupportedAccepted.includes("AFL4103"));
assert.deepEqual(language.unsupportedNoImplementation, []);
assert(language.unsupportedRevoked.includes("AFL4101"));
assert(
  language.feedbackSyntax.some(
    (token) => token.c === "Mode" && token.t.includes("entity.name.type.afl"),
  ),
);
assert.deepEqual(language.whenDefinition, [language.coreUri]);
assert(language.whenLocalDefinition);
assert(language.whenCompletions.includes("chosen"));
assert.deepEqual(language.whenSignature, "a: i32");
assert.deepEqual([...language.collectionCompletions].sort(), [
  "add",
  "clear",
  "contains",
  "get",
  "index_of",
  "insert",
  "len",
  "remove",
  "remove_at",
  "set",
  "sort",
  "sort_by",
  "sorted",
  "sorted_by",
]);
assert.deepEqual([...language.setCompletions].sort(), [
  "add",
  "clear",
  "contains",
  "len",
  "remove",
]);
assert.deepEqual([...language.mapCompletions].sort(), [
  "clear",
  "contains_key",
  "get",
  "keys",
  "len",
  "remove",
  "set",
  "values",
]);
assert(language.collectionMethodKind);
assert(
  language.collectionHover
    .replaceAll("&nbsp;", " ")
    .replaceAll("\\", "")
    .includes("fn list<Counter>.get(index: i32) -> Counter"),
);
assert.deepEqual(language.collectionSignature, [
  "key: string",
  "value: Counter?",
]);
assert.deepEqual(language.collectionActiveParameter, 1);
assert.deepEqual(language.collectionDefinition, [language.nullableTypeUri]);
assert.deepEqual(language.collectionBuiltinDefinition, []);
assert(language.collectionErrors.includes("AFL3204"));
assert(language.collectionArgumentErrors.includes("AFL3206"));
assert.deepEqual(language.collectionRecoveredErrors, []);
assert(
  !(
    language.collectionSyntax.filter(
      (token) =>
        token.c === "get" && token.t.includes("entity.name.function.afl"),
    ).length === 0
  ),
);
assert(language.whenErrors.includes("AFL1004"));
assert.deepEqual(language.whenRecoveredErrors, []);
assert(
  !(
    language.whenSyntax.filter(
      (token) => token.c === "when" && token.t.includes("keyword.control.afl"),
    ).length === 0
  ),
);
assert(
  !(
    language.whenSyntax.filter(
      (token) =>
        token.c === "->" && token.t.includes("keyword.operator.branch.afl"),
    ).length === 0
  ),
);
for (const word of ["for", "in"]) {
  assert(
    !(
      language.forSyntax.filter(
        (token) => token.c === word && token.t.includes("keyword.control.afl"),
      ).length === 0
    ),
  );
}
assert(language.configErrors.includes("AFL3002"));
assert(language.specErrors.includes("AFL3203"));
assert.deepEqual(language.specRecovered, []);
assert.deepEqual(language.specDefinition, [language.coreUri]);
assert(language.specConfigErrors.includes("AFL3004"));
assert(language.showLogs);
assert.deepEqual(language.implementation, [language.edgeUri]);
assert(language.presetErrors.includes("AFL4101"));
assert.deepEqual(language.presetRecovered, []);
assert(
  !(
    language.implSyntax.filter(
      (token) =>
        token.c === "impl" && token.t.includes("keyword.control.import.afl"),
    ).length === 0
  ),
);
assert(
  !(
    language.syntax.filter(
      (token) =>
        token.c === "?" &&
        token.t.includes("keyword.operator.type.nullable.afl"),
    ).length === 0
  ),
);
for (const expected of [
  { text: "struct", scope: "storage.type.struct.afl" },
  { text: "Gift", scope: "entity.name.type.struct.afl" },
  { text: "gift-id", scope: "string.quoted.double.afl" },
  { text: "Counter", scope: "entity.name.type.class.afl" },
  { text: "10000", scope: "constant.numeric.afl" },
  { text: "highlight", scope: "entity.name.function.afl" },
  { text: "i32", scope: "support.type.primitive.afl" },
  { text: "sample", scope: "variable.parameter.afl" },
  { text: "Incoming", scope: "comment.block.documentation.afl" },
  { text: "Raw", scope: "comment.block.documentation.raw.afl" },
  { text: "hello", scope: "string.quoted.double.afl" },
  { text: "raw_literal_body", scope: "string.quoted.double.raw.afl" },
  { text: "null", scope: "constant.language.null.afl" },
]) {
  const matches = language.syntax.filter(
    (token) =>
      token.c.includes(expected.text) && token.t.includes(expected.scope),
  );
  assert(
    !(matches.length === 0),
    "Missing editor token: " + String(expected.text) + "",
  );
  for (const token of matches) {
    for (const color of [token.r.dark_plus, token.r.light_plus]) {
      assert(color.includes("#"));
      assert(
        !color.startsWith("default:"),
        "No theme color for " + String(expected.text) + "",
      );
    }
  }
}
const persisted = JSON.parse(
  fs.readFileSync(path.join(fixture, "persist.json"), "utf8"),
);
assert.deepEqual(persisted.implementation, [language.iosEdgeUri]);
const restored = JSON.parse(
  fs.readFileSync(path.join(fixture, "restore.json"), "utf8"),
);
assert.deepEqual(restored.implementation, [language.iosEdgeUri]);
assert.deepEqual(
  [...restored.cleared].sort(),
  [...[language.edgeUri, language.iosEdgeUri]].sort(),
);
const cleared = JSON.parse(
  fs.readFileSync(path.join(fixture, "cleared.json"), "utf8"),
);
assert.deepEqual(
  [...cleared.implementation].sort(),
  [...[language.edgeUri, language.iosEdgeUri]].sort(),
);
assert.deepEqual(
  language.secondaryAfterParentClear,
  persisted.secondaryImplementation,
);
assert.deepEqual(language.parentAfterSecondaryClear, [language.iosEdgeUri]);
assert.deepEqual(
  restored.secondaryImplementation,
  persisted.secondaryImplementation,
);
assert.deepEqual(
  cleared.secondaryImplementation,
  persisted.secondaryImplementation,
);
assert(
  persisted.secondaryImplementation[0].endsWith("/secondary/edge/lib.afl"),
);
const command = JSON.parse(
  fs.readFileSync(path.join(fixture, "command.json"), "utf8"),
);
assert.deepEqual(command.documentsBefore, 0);
assert(command.active);
assert(command.checked);
const failure = JSON.parse(
  fs.readFileSync(path.join(fixture, "failure.json"), "utf8"),
);
assert(failure.activationFailed);
assert(failure.showLogs);
assert(failure.checkFailureHandled);
for (const mode of ["language", "command", "failure"]) {
  const text = fs.readFileSync(
    path.join(fixture, "" + String(mode) + ".log"),
    "utf8",
  );
  assert(text.includes("Activating AFL extension"));
  if (mode === "failure") {
    assert(text.includes("AFL language server failed to start"));
    assert(text.includes("AFL project check failed"));
  } else {
    assert(text.includes("Language server ready"));
    assert(text.includes("Project check completed"));
  }
}
console.log(
  "Real VS Code " +
    String(language.version) +
    " checks passed in one window and one app process: all 7 scenarios, cold activation, TextMate, navigation, diagnostics, formatting, preset restoration across reloads and startup failure logs.",
);
