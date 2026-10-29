import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run, runQuery } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/cli");
const fixtureDirectory = process.argv[3];
const project_root = path.dirname(path.dirname(suiteDirectory));
const cli = path.join(project_root, "packages/cli/dist/afl.js");
const fixture = fixtureDirectory;
const project = path.join(fixture, "project with spaces");
try {
  const files = {
    "shared/config.toml": "[project]\n[dep]",
    "shared/lib.afl":
      "fn add(a: i32) -> i32 [\n    a = [Input]\n    return = [Same value]\n] {\n    a\n}\nclass Counter [desc = [Counter]] {\n    value: i32 [desc = [Current value]]\n    fn read() -> i32 [return = [Current value]] { self.value }\n}\nextern fn show() [desc = [Show the page]]\n",
    "app/config.toml": '[dep]\nshared = "../shared"',
    "app/main.afl":
      'use dep::shared::lib::add as total\nuse dep::shared::lib::Counter\n\nfn main() {\n    n: i32 = total(1)\n    counter: Counter = {value: n}\n    result: i32 = counter.read()\n    [Mention total and add only in prose]\n    marker: string = "total"\n    raw_marker: string = r##"total, )\ncounter.read "# stays text"##\n    r##[Mention total and ]# without a reference]##\n}\n',
    "app/other.afl": "fn add() {}",
    "other/config.toml": '[dep]\nshared = "../shared"',
    "other/main.afl":
      "use dep::shared::lib::add\nfn main() { n: i32 = add(2) }",
    "android/config.toml": '[dep]\nshared = "../shared"',
    "android/lib.afl":
      "impl dep::shared::lib::show\nfn show() { [Show using Android] }",
    "ios/config.toml": '[dep]\nshared = "../shared"',
    "ios/lib.afl":
      "impl dep::shared::lib::show\nfn show() { [Show using iOS] }",
    "config.toml":
      'preset_dir = "presets"\n[project]\n[preset.android]\ncore = ["shared"]\nedge = ["android"]',
    "presets/ios.toml": 'core = ["../shared"]\nedge = ["../ios"]',
  };
  for (const item of Object.entries(files).map(([key, value]) => ({
    path: key,
    text: value,
  }))) {
    const destination = path.join(project, item.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.text);
  }
  const shared = path.join(project, "shared/lib.afl");
  const app = path.join(project, "app/main.afl");
  const point = [app, "--line", "5", "--column", "14"];
  const declaration = [shared, "--line", "1", "--column", "4"];
  const definition = runQuery(cli, [...["definition"], ...point]);
  assert.deepEqual(definition.status, "complete");
  assert.deepEqual(definition.command, "definition");
  assert.deepEqual(definition.diagnostics, []);
  assert.deepEqual(definition.results.length, 1);
  assert.deepEqual(definition.results[0].path, shared);
  assert.deepEqual(definition.results[0].range, {
    start: { line: 0, character: 3 },
    end: { line: 0, character: 6 },
  });
  assert.deepEqual(definition.results[0].text, "fn add(a: i32) -> i32 [");
  assert(definition.results[0].uri.includes("%20"));
  assert.deepEqual(definition.scope.files.length, 3);
  assert.deepEqual(definition.scope.crates.length, 2);
  assert.deepEqual(definition.scope.preset, null);
  const alias = runQuery(cli, [
    "definition",
    app,
    "--line",
    "1",
    "--column",
    "30",
  ]);
  assert.deepEqual(alias.results, definition.results);
  const local = runQuery(cli, [...["references"], ...declaration]);
  assert.deepEqual(local.results, []);
  assert.deepEqual(local.scope.files, [shared]);
  const app_refs = runQuery(cli, [...["references"], ...point]);
  assert.deepEqual(
    app_refs.results
      .map((item) => item.range)
      .map((item) => item.start)
      .map((item) => item.line),
    [0, 0, 4],
  );
  assert(app_refs.results.every((item) => item.path === app));
  const all_refs = runQuery(cli, [
    ...["references"],
    ...[...declaration, ...["--project", project]],
  ]);
  assert.deepEqual(all_refs.results.length, 5);
  assert.deepEqual(
    [...new Set(all_refs.results.map((item) => item.path))].length,
    2,
  );
  const with_declaration = runQuery(cli, [
    ...["references"],
    ...[...declaration, ...["--project", project, "--include-declaration"]],
  ]);
  assert.deepEqual(with_declaration.results.length, 6);
  assert.deepEqual(
    with_declaration.results.filter((item) => item.path === shared).length,
    1,
  );
  assert.deepEqual(
    runQuery(cli, [
      ...["references"],
      ...[...declaration, ...["--project", project]],
    ]).results,
    all_refs.results,
  );
  const symbols = runQuery(cli, ["symbols", shared]);
  assert.deepEqual(
    symbols.results.map((item) => item.name),
    ["add", "Counter", "show"],
  );
  const counter = symbols.results.filter((item) => item.name === "Counter")[0];
  assert.deepEqual(
    counter.children.map((item) => item.name),
    ["value", "read"],
  );
  assert.deepEqual(counter.selectionRange.start, { line: 6, character: 6 });
  assert.deepEqual(counter.range.start, { line: 6, character: 0 });
  assert.deepEqual(counter.text, "class Counter [desc = [Counter]] {");
  const member = runQuery(cli, [
    "definition",
    app,
    "--line",
    "7",
    "--column",
    "27",
  ]);
  assert.deepEqual(member.results[0].path, shared);
  assert.deepEqual(member.results[0].range.start, { line: 8, character: 7 });
  const parameter = runQuery(cli, [
    "references",
    shared,
    "--line",
    "1",
    "--column",
    "8",
  ]);
  assert.deepEqual(
    parameter.results
      .map((item) => item.range)
      .map((item) => item.start)
      .map((item) => item.line),
    [1, 4],
  );
  const property = runQuery(cli, [
    "references",
    shared,
    "--line",
    "8",
    "--column",
    "5",
    "--project",
    project,
  ]);
  assert.deepEqual(property.results.length, 2);
  for (const position of [
    ["8", "15"],
    ["9", "24"],
    ["10", "29"],
    ["11", "1"],
    ["12", "20"],
    ["3", "1"],
  ]) {
    const empty = runQuery(cli, [
      "definition",
      app,
      "--line",
      position[0],
      "--column",
      position[1],
    ]);
    assert.deepEqual(empty.results, []);
  }
  const extern_point = [
    shared,
    "--line",
    "11",
    "--column",
    "11",
    "--project",
    project,
  ];
  const both = runQuery(cli, [...["implementations"], ...extern_point]);
  assert.deepEqual(both.results.length, 2);
  for (const preset of ["android", "ios"]) {
    const implementation = runQuery(cli, [
      ...["implementations"],
      ...[...extern_point, ...["--preset", preset]],
    ]);
    assert.deepEqual(implementation.results.length, 1);
    assert.deepEqual(
      implementation.results[0].path,
      path.join(project, preset, "lib.afl"),
    );
    assert.deepEqual(implementation.scope.preset, preset);
    assert.deepEqual(implementation.scope.files.length, 2);
    const outline = runQuery(cli, ["symbols", project, "--preset", preset]);
    assert.deepEqual(outline.scope, implementation.scope);
    const preset_refs = runQuery(cli, [
      ...["references"],
      ...[...extern_point, ...["--preset", preset]],
    ]);
    assert.deepEqual(preset_refs.results.length, 1);
  }
  const edge_demo = path.join(project_root, "demo/edge");
  const class_impl = runQuery(cli, [
    "implementations",
    path.join(edge_demo, "core/button.afl"),
    "--line",
    "3",
    "--column",
    "8",
    "--project",
    edge_demo,
    "--preset",
    "android",
  ]);
  assert.deepEqual(class_impl.results.length, 1);
  assert(class_impl.results[0].path.endsWith("android/button.afl"));
  const missing_preset = runQuery(
    cli,
    [...["implementations"], ...[...extern_point, ...["--preset", "missing"]]],
    1,
  );
  assert.deepEqual(missing_preset.results, []);
  assert(
    missing_preset.diagnostics.map((item) => item.code).includes("AFL4002"),
  );
  const outside = runQuery(
    cli,
    [
      ...["definition"],
      ...[...point, ...["--project", project, "--preset", "android"]],
    ],
    2,
  );
  assert(outside.message.includes("outside the selected"));
  const unicode = path.join(project, "app/unicode.afl");
  fs.writeFileSync(
    unicode,
    "use dep::shared::lib::add\nfn unicode() {\n    add([😀], add(1))\n}\n".replaceAll(
      "\n",
      "\r\n",
    ),
  );
  const unicode_definition = runQuery(
    cli,
    ["definition", unicode, "--line", "3", "--column", "15"],
    1,
  );
  assert.deepEqual(unicode_definition.results, definition.results);
  assert(
    unicode_definition.diagnostics.map((item) => item.code).includes("AFL3206"),
  );
  fs.rmSync(unicode, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(project, "app/broken.afl"),
    "fn broken() { missing() }",
  );
  const broken = runQuery(cli, [...["definition"], ...point], 1);
  assert.deepEqual(broken.results, definition.results);
  assert(broken.diagnostics.map((item) => item.code).includes("AFL3203"));
  fs.rmSync(path.join(project, "app/broken.afl"), {
    recursive: true,
    force: true,
  });
  fs.writeFileSync(
    path.join(project, "app/config.toml"),
    '[dep]\nshared = "../absent"',
  );
  const dependency = runQuery(cli, [...["definition"], ...point], 1);
  assert.deepEqual(dependency.results, []);
  assert(dependency.diagnostics.map((item) => item.code).includes("AFL3002"));
  fs.writeFileSync(
    path.join(project, "app/config.toml"),
    files["app/config.toml"],
  );
  const relative = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(project);
      return runQuery(cli, [
        "definition",
        "app/main.afl",
        "--line",
        "5",
        "--column",
        "14",
        "--project",
        ".",
      ]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(relative.results, definition.results);
  const defaultResult = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(path.join(project, "shared"));
      return runQuery(cli, ["symbols"]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(defaultResult.results, symbols.results);
  const explicit_project = runQuery(cli, [
    "symbols",
    "--project",
    path.join(project, "shared"),
  ]);
  assert.deepEqual(explicit_project.results, symbols.results);
  run("ln", ["-s", project, path.join(fixture, "alias")]);
  const symlink = runQuery(cli, [
    "definition",
    path.join(fixture, "alias/app/main.afl"),
    "--line",
    "5",
    "--column",
    "14",
  ]);
  assert.deepEqual(symlink.results, definition.results);
  const invalid = [
    ["definition"],
    ["definition", app],
    ["definition", app, shared, "--line", "1", "--column", "1"],
    ["definition", app, "--line", "0", "--column", "1"],
    ["definition", app, "--line", "-1", "--column", "1"],
    ["definition", app, "--line", "1.5", "--column", "1"],
    ["definition", app, "--line", "1e2", "--column", "1"],
    ["definition", app, "--line", "9007199254740993", "--column", "1"],
    ["definition", app, "--line", "999", "--column", "1"],
    ["definition", app, "--line", "1", "--column", "999"],
    ["definition", app, "--line", "1", "--column", "0"],
    ["definition", app, "--line", "1", "--column", "1", "--preset", "android"],
    ["definition", app, "--line", "1", "--column", "1", "--project", app],
    ["definition", app, "--line", "1", "--column", "1", "--project", ""],
    [
      "definition",
      app,
      "--line",
      "1",
      "--column",
      "1",
      "--include-declaration",
    ],
    [
      "definition",
      path.join(project, "app/config.toml"),
      "--line",
      "1",
      "--column",
      "1",
    ],
    ["definition", path.join(project, "app"), "--line", "1", "--column", "1"],
    [
      "definition",
      path.join(project, "missing.afl"),
      "--line",
      "1",
      "--column",
      "1",
    ],
    ["symbols", shared, "--line", "1"],
    ["symbols", shared, "--include-declaration"],
    ["symbols", shared, "--project", project],
    ["symbols", project, "--preset", ""],
    ["check", app, "--line", "1"],
  ];
  for (const args of invalid) {
    const error_result = runQuery(cli, args, 2);
    assert.deepEqual(error_result.status, "error");
    assert(!(error_result.message.length === 0));
  }
  const text = run(process.execPath, [cli, "definition", ...point]);
  assert.deepEqual(text.exit_code, 0);
  assert(text.stdout.includes("" + String(shared) + ":1:4"));
  assert(text.stdout.includes("Scope:"));
  const no_results = run(process.execPath, [cli, "references", ...declaration]);
  assert.deepEqual(no_results.exit_code, 0);
  assert(no_results.stdout.includes("No results in this scope."));
  const help = run(process.execPath, [cli, "--help"]);
  assert(help.stdout.includes("afl implementations"));
  console.log(
    "CLI queries passed: aliases, scope, members, presets, opaque prose, UTF-16, recovery, paths and invalid inputs.",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
