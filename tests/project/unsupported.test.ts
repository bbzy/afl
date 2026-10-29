import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/project");
const fixtureDirectory = process.argv[3];
const root = path.dirname(path.dirname(suiteDirectory));
const cli = path.join(root, "packages/cli/bin/afl.mjs");
const fixture = fixtureDirectory;
try {
  fs.mkdirSync(path.join(fixture, "core"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "edge"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "core/config.toml"), "[dep]");
  fs.writeFileSync(
    path.join(fixture, "edge/config.toml"),
    "[dep]\ncore = '../core'",
  );
  fs.writeFileSync(
    path.join(fixture, "core/lib.afl"),
    "extern class Panel [desc = [Control panel]] {\n fn open() [desc = [Show panel]]\n}",
  );
  const edge =
    "unsupported dep::core::lib::Panel [\n desc = [This platform has no panel]\n fallback = [Do not instantiate the panel or register its callbacks; keep processing without interactive controls]\n]";
  fs.writeFileSync(path.join(fixture, "edge/lib.afl"), edge);
  const preset =
    '[project]\n[preset.ohos]\ncore = ["core"]\nedge = ["edge"]\nallow_unsupported = ["core/lib.afl::Panel"]';
  const cases = [
    { name: "allowed", config: preset, source: edge, code: "AFL4103", exit: 0 },
    {
      name: "not_allowed",
      config: preset.replace('allow_unsupported = ["core/lib.afl::Panel"]', ""),
      source: edge,
      code: "AFL4101",
      exit: 1,
    },
    {
      name: "unknown_target",
      config: preset.replace("lib.afl::Panel", "lib.afl::Missing"),
      source: edge,
      code: "AFL4001",
      exit: 1,
    },
    {
      name: "wrong_file",
      config: preset.replace("core/lib.afl::Panel", "edge/lib.afl::Panel"),
      source: edge,
      code: "AFL4001",
      exit: 1,
    },
    {
      name: "missing_file",
      config: preset.replace("lib.afl::Panel", "missing.afl::Panel"),
      source: edge,
      code: "AFL4001",
      exit: 1,
    },
    {
      name: "missing_fallback",
      config: preset,
      source: "unsupported dep::core::lib::Panel [desc = [No panel]]",
      code: "AFL2001",
      exit: 1,
    },
    {
      name: "missing_reason",
      config: preset,
      source: "unsupported dep::core::lib::Panel [fallback = [Skip panel]]",
      code: "AFL2001",
      exit: 1,
    },
    {
      name: "ordinary_target",
      config: preset,
      source: edge.replace("lib::Panel", "lib::Other"),
      code: "AFL3102",
      exit: 1,
    },
    {
      name: "duplicate",
      config: preset,
      source: edge + ("\n" + edge),
      code: "AFL3411",
      exit: 1,
    },
    {
      name: "conflict",
      config: preset,
      source:
        edge + "\nimpl dep::core::lib::Panel\nclass Panel { fn open() {} }",
      code: "AFL3411",
      exit: 1,
    },
    {
      name: "dependency_preserved",
      config: preset,
      source: edge.replace("dep::core", "dep::missing"),
      code: "AFL3101",
      exit: 1,
    },
    {
      name: "description_link",
      config: preset,
      source: edge.replace(
        "no panel",
        "no panel; contract {@dep::core::lib::Panel}",
      ),
      code: "AFL4103",
      exit: 0,
    },
  ];
  for (const testCase of cases) {
    fs.writeFileSync(path.join(fixture, "config.toml"), testCase.config);
    fs.writeFileSync(path.join(fixture, "edge/lib.afl"), testCase.source);
    const executionResult = run(process.execPath, [
      cli,
      "check",
      fixture,
      "--preset",
      "ohos",
      "--json",
    ]);
    assert.deepEqual(
      executionResult.exit_code,
      testCase.exit,
      "" +
        String(testCase.name) +
        ": " +
        String(executionResult.stdout) +
        "" +
        String(executionResult.stderr) +
        "",
    );
    assert(
      JSON.parse(executionResult.stdout)
        .diagnostics.map((item) => item.code)
        .includes(testCase.code),
      testCase.name,
    );
  }
  fs.writeFileSync(path.join(fixture, "config.toml"), preset);
  fs.writeFileSync(path.join(fixture, "edge/lib.afl"), edge);
  const definition = run(process.execPath, [
    cli,
    "definition",
    path.join(fixture, "edge/lib.afl"),
    "--line",
    1,
    "--column",
    30,
    "--project",
    fixture,
    "--preset",
    "ohos",
    "--json",
  ]);
  assert.deepEqual(definition.exit_code, 0, definition.stderr);
  assert.deepEqual(JSON.parse(definition.stdout).results.length, 1);
  const implementations = run(process.execPath, [
    cli,
    "implementations",
    path.join(fixture, "core/lib.afl"),
    "--line",
    1,
    "--column",
    14,
    "--project",
    fixture,
    "--preset",
    "ohos",
    "--json",
  ]);
  assert.deepEqual(implementations.exit_code, 0, implementations.stderr);
  assert.deepEqual(JSON.parse(implementations.stdout).results, []);
  const standalone = run(process.execPath, [
    cli,
    "check",
    path.join(fixture, "edge"),
    "--json",
  ]);
  assert.deepEqual(standalone.exit_code, 0, standalone.stderr);
  assert.deepEqual(JSON.parse(standalone.stdout).diagnostics, []);
  console.log(
    "Unsupported capabilities passed: " +
      String(cases.length) +
      " preset/config cases, standalone validation, references and no fake implementation.",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
