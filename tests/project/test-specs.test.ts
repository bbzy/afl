import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run, writeFiles } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/project");
const fixtureDirectory = process.argv[3];
const project_root = path.dirname(path.dirname(suiteDirectory));
const cli = path.join(project_root, "packages/cli/dist/afl.js");
const fixture = fixtureDirectory;
const base = {
  "core/config.toml": '[test]\ncrates = ["../spec"]',
  "core/lib.afl": "fn operation() {}",
  "spec/config.toml": '[dep]\ncore = "../core"',
  "spec/lib.afl":
    "use dep::core::lib::operation\nfn behavior() [desc = [Describe the expected observable behavior]] {\n    operation()\n    [The operation completes successfully]\n}",
};
const cases = [
  { name: "valid", files: {}, code: null },
  { name: "file_input", files: {}, select: "core/lib.afl", code: null },
  { name: "test_back_dependency", files: {}, select: "spec", code: null },
  {
    name: "omitted",
    files: {
      "core/config.toml": "[dep]",
      "spec/lib.afl": "fn bad() { missing() }",
    },
    code: null,
  },
  {
    name: "empty",
    files: {
      "core/config.toml": "[test]\ncrates = []",
      "spec/lib.afl": "fn bad() { missing() }",
    },
    code: null,
  },
  {
    name: "table_required",
    files: { "core/config.toml": "test = []" },
    code: "AFL3004",
  },
  {
    name: "crates_required",
    files: { "core/config.toml": "[test]" },
    code: "AFL3004",
  },
  {
    name: "list_required",
    files: { "core/config.toml": '[test]\ncrates = "../spec"' },
    code: "AFL3004",
  },
  {
    name: "string_required",
    files: { "core/config.toml": "[test]\ncrates = [1]" },
    code: "AFL3004",
  },
  {
    name: "empty_path",
    files: { "core/config.toml": '[test]\ncrates = [" "]' },
    code: "AFL3004",
  },
  {
    name: "unknown_field",
    files: {
      "core/config.toml": '[test]\ncrates = ["../spec"]\ncore = "core"',
    },
    code: "AFL3004",
  },
  {
    name: "duplicate",
    files: { "core/config.toml": '[test]\ncrates = ["../spec", "../spec/."]' },
    code: "AFL3004",
  },
  {
    name: "missing",
    files: { "core/config.toml": '[test]\ncrates = ["../absent"]' },
    code: "AFL3004",
  },
  {
    name: "file_target",
    files: { "core/config.toml": '[test]\ncrates = ["../spec/lib.afl"]' },
    code: "AFL3004",
  },
  {
    name: "not_a_crate",
    files: {
      "core/config.toml": '[test]\ncrates = ["../ordinary"]',
      "ordinary/notes.afl": "",
    },
    code: "AFL3004",
  },
  {
    name: "conflicting_entries",
    files: { "spec/main.afl": "fn main() {}" },
    code: "AFL3004",
  },
  {
    name: "nested_target",
    files: {
      "core/config.toml": '[test]\ncrates = ["../spec/child"]',
      "spec/child/lib.afl": "",
    },
    code: "AFL3004",
  },
  {
    name: "self_target",
    files: { "core/config.toml": '[test]\ncrates = ["."]' },
    code: "AFL3004",
  },
  {
    name: "missing_test_config",
    files: {},
    remove: "spec/config.toml",
    code: "AFL3001",
  },
  {
    name: "no_implicit_dependency",
    files: { "spec/config.toml": "[dep]" },
    code: "AFL3101",
  },
  {
    name: "test_source_error",
    files: { "spec/lib.afl": "fn behavior() { missing() }" },
    code: "AFL3203",
  },
  {
    name: "test_documentation_error",
    files: { "spec/lib.afl": "fn behavior()" },
    code: "AFL2001",
  },
  {
    name: "test_syntax_error",
    files: { "spec/lib.afl": "fn behavior() {" },
    code: "AFL1002",
  },
  {
    name: "test_dependency_error",
    files: { "spec/config.toml": '[dep]\ncore = "../absent"' },
    code: "AFL3002",
  },
  {
    name: "real_dependency_cycle",
    files: {
      "core/config.toml":
        '[dep]\nspec = "../spec"\n[test]\ncrates = ["../spec"]',
    },
    code: "AFL3003",
  },
  {
    name: "dependency_tests_not_inherited",
    files: {
      "core/config.toml":
        '[dep]\nsupport = "../support"\n[test]\ncrates = ["../spec"]',
      "support/lib.afl": "",
      "support/config.toml": '[test]\ncrates = ["../absent"]',
    },
    code: null,
  },
  {
    name: "specification_tests_not_inherited",
    files: {
      "spec/config.toml":
        '[dep]\ncore = "../core"\n[test]\ncrates = ["../absent"]',
    },
    code: null,
  },
  {
    name: "directly_selected_spec_tests",
    files: {
      "spec/config.toml":
        '[dep]\ncore = "../core"\n[test]\ncrates = ["../absent"]',
    },
    select: "spec",
    code: "AFL3004",
  },
  {
    name: "shared_specification",
    files: {
      "other/lib.afl": "",
      "other/config.toml": '[test]\ncrates = ["../spec"]',
    },
    select: ".",
    code: null,
  },
  {
    name: "tests_not_in_preset_schema",
    files: {
      "config.toml":
        '[project]\n[preset.android]\ncore = ["core"]\nedge = []\ntest = ["spec"]',
    },
    select: ".",
    preset: "android",
    code: "AFL4001",
  },
  {
    name: "preset_owner_tests",
    files: {
      "core/lib.afl": "extern fn operation() [desc = [External operation]]",
      "spec/lib.afl":
        "extern fn prepare() [desc = [Test preparation boundary]]",
      "edge/lib.afl": "impl dep::core::lib::operation\nfn operation() {}",
      "edge/config.toml":
        '[dep]\ncore = "../core"\n[test]\ncrates = ["../edge-spec"]',
      "edge-spec/lib.afl":
        "fn adaptation() [desc = [Describe platform behavior]]",
      "edge-spec/config.toml": "[dep]",
      "config.toml":
        '[project]\n[preset.android]\ncore = ["core"]\nedge = ["edge"]',
    },
    select: ".",
    preset: "android",
    code: null,
  },
];
try {
  for (const testCase of cases) {
    const root = path.join(fixture, testCase.name);
    writeFiles(root, { ...base, ...testCase.files });
    if ((testCase.remove ?? null) !== null) {
      fs.rmSync(path.join(root, testCase.remove), {
        recursive: true,
        force: true,
      });
    }
    const selected = path.join(root, testCase.select ?? "core");
    const args =
      (testCase.preset ?? null) === null ? [] : ["--preset", testCase.preset];
    const execution = (() => {
      const previousDirectory = process.cwd();
      try {
        process.chdir(fixture);
        return run(process.execPath, [
          cli,
          "check",
          selected,
          ...args,
          "--json",
        ]);
      } finally {
        process.chdir(previousDirectory);
      }
    })();
    const result = JSON.parse(execution.stdout);
    assert.deepEqual(execution.stderr, "");
    assert.deepEqual(result.status, "complete");
    if (testCase.code === null) {
      assert.equal(execution.exit_code, 0, execution.stdout);
      assert.deepEqual(result.diagnostics, []);
    } else {
      assert.deepEqual(
        execution.exit_code,
        1,
        "" + String(testCase.name) + ": " + String(execution) + "",
      );
      assert(
        result.diagnostics.map((item) => item.code).includes(testCase.code),
        "" + String(testCase.name) + ": " + String(execution) + "",
      );
    }
  }
  const root = path.join(fixture, "valid");
  const queried = run(process.execPath, [
    cli,
    "symbols",
    path.join(root, "core"),
    "--json",
  ]);
  assert.deepEqual(queried.exit_code, 0);
  const scope = JSON.parse(queried.stdout).scope;
  assert.deepEqual(scope.files.length, 2);
  assert.deepEqual(scope.tests.length, 1);
  assert.deepEqual(
    fs.realpathSync(scope.tests[0].target),
    path.join(root, "core"),
  );
  assert.deepEqual(
    scope.tests[0].crates.map((path) => fs.realpathSync(path)),
    [path.join(root, "spec")],
  );
  const references = run(process.execPath, [
    cli,
    "references",
    path.join(root, "core/lib.afl"),
    "--line",
    1,
    "--column",
    4,
    "--json",
  ]);
  assert.deepEqual(references.exit_code, 0);
  assert.deepEqual(JSON.parse(references.stdout).results.length, 2);
  run("ln", ["-s", path.join(root, "spec"), path.join(root, "alias")]);
  fs.writeFileSync(
    path.join(root, "core/config.toml"),
    '[test]\ncrates = ["../spec", "../alias"]',
  );
  const duplicate = run(process.execPath, [
    cli,
    "check",
    path.join(root, "core"),
    "--json",
  ]);
  assert.deepEqual(duplicate.exit_code, 1);
  assert(
    JSON.parse(duplicate.stdout)
      .diagnostics.map((item) => item.code)
      .includes("AFL3004"),
  );
  fs.writeFileSync(
    path.join(root, "core/config.toml"),
    base["core/config.toml"],
  );
  fs.mkdirSync(path.join(root, "new-spec"), { recursive: true });
  const execution = await exercise([project_root, root]);
  const result = execution;
  assert(result.missingCodes.includes("AFL3004"));
  assert(result.watchedMissing);
  assert.deepEqual(result.recoveredDiagnostics, []);
  assert.deepEqual(result.recoveredFiles.length, 2);
  assert(result.recoveredTests[0].crates[0].endsWith("/new-spec/"));
  assert(result.updated);
  assert.deepEqual(result.removedOutline, []);
  assert.deepEqual(result.diskConfig, base["core/config.toml"]);
  assert.deepEqual(result.metadataTests, []);
  assert.deepEqual(result.metadataFiles, []);
  console.log(
    "Test specification checks passed: " +
      String(cases.length) +
      " CLI cases, queries, aliases, overlays and association scope.",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

async function exercise(args: string[]) {
  const { readFileSync, realpathSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const [repo, input] = args,
    root = realpathSync(input);
  const { loadProject } = await import(
    pathToFileURL(join(repo, "packages/checker/dist/node.js")).href
  );
  const { LanguageService } = await import(
    pathToFileURL(join(repo, "packages/checker/dist/index.js")).href
  );
  const uri = (path) => pathToFileURL(join(root, path)).href;
  const service = new LanguageService();
  const config = {
    uri: uri("core/config.toml"),
    text: '[test]\ncrates = ["../new-spec"]',
  };
  const missing = await loadProject([join(root, "core")], [config]);
  const recovered = await loadProject(
    [join(root, "core")],
    [
      config,
      {
        uri: uri("new-spec/lib.afl"),
        text: "fn scenario() [desc = [Expected behavior]]",
      },
      { uri: uri("new-spec/config.toml"), text: "[dep]" },
    ],
  );
  const initial = await loadProject([join(root, "core")]);
  service.update(initial.documents, initial);
  const removed = await loadProject(
    [join(root, "core")],
    [{ ...config, text: "[test]\ncrates = []" }],
  );
  const updated = service.update(removed.documents, removed);
  const presetRoot = join(root, "../preset_owner_tests");
  const metadata = await loadProject([presetRoot], [], { presetsOnly: true });
  return {
    missingCodes: missing.diagnostics.map((item) => item.code),
    watchedMissing: missing.watchedFiles.includes(
      join(root, "new-spec/lib.afl"),
    ),
    recoveredDiagnostics: recovered.diagnostics,
    recoveredTests: recovered.tests,
    recoveredFiles: recovered.documents.map((item) => item.uri),
    updated,
    removedOutline: service.documentSymbols(uri("spec/lib.afl")),
    diskConfig: readFileSync(join(root, "core/config.toml"), "utf8"),
    metadataTests: metadata.tests,
    metadataFiles: metadata.documents,
  };
}
