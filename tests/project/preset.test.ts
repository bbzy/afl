import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run, writeFiles } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/project");
const fixtureDirectory = process.argv[3];
const project_root = path.dirname(path.dirname(suiteDirectory));
const cli = path.join(project_root, "packages/cli/dist/afl.js");
const fixture = fixtureDirectory;
const core =
  "extern class Button [desc = [Button capability]] {\n    text: string [desc = [Label]]\n    fn clone() -> Button [desc = [Clone the button]\n        return = [New button]]\n}\nextern fn show(items: map<string, list<Button>>) -> list<Button> [\n    desc = [Display buttons]\n    items = [Buttons by group]\n    return = [Displayed buttons]\n]\nclass Shared [desc = [Shared data]] {}\n";
const edge =
  "impl dep::core::lib::show\nimpl dep::core::lib::Button\nclass Button [desc = [Platform button]] {\n    native_view: any [desc = [Platform handle]]\n    fn clone() -> result: Button [desc = [Clone platform button]\n        result = [New button]]\n    text: string [desc = [Label]]\n}\nfn show(groups: map<string, list<Button>>) -> buttons: list<Button> [\n    desc = [Display through the platform API]\n    groups = [Groups]\n    buttons = [Displayed buttons]\n]\n";
const config =
  'preset_dir = "presets"\n[project]\n[preset.android]\ncore = ["core"]\nedge = ["android"]';
const base = {
  "config.toml": config,
  "core/config.toml": "[dep]",
  "core/lib.afl": core,
  "android/config.toml": '[dep]\ncore = "../core"',
  "android/lib.afl": edge,
  "ios/config.toml": '[dep]\ncore = "../core"',
  "ios/lib.afl": edge,
  "presets/ios.toml": 'core = ["../core"]\nedge = ["../ios"]',
};
const nullable_core = core
  .replaceAll("list<Button>", "list<Button?>?")
  .replace("text: string", "text: string?")
  .replace("-> Button [", "-> Button? [");
const nullable_edge = edge
  .replaceAll("list<Button>", "list<Button?>?")
  .replace("text: string", "text: string?")
  .replace("result: Button [", "result: Button? [");
const cases = [
  {
    name: "property_default_contract",
    files: {
      "core/lib.afl": core.replace(
        "text: string",
        'text: string = "Default label"',
      ),
    },
    code: null,
  },
  { name: "valid", files: {}, code: null },
  {
    name: "callback_signature",
    files: {
      "core/lib.afl": core.replace(
        "items: map<string, list<Button>>",
        "items: fn(Button?) -> list<Button?>",
      ),
      "android/lib.afl": edge.replace(
        "groups: map<string, list<Button>>",
        "groups: fn(Button?) -> list<Button?>",
      ),
    },
    code: null,
  },
  {
    name: "callback_input_mismatch",
    files: {
      "core/lib.afl": core.replace(
        "items: map<string, list<Button>>",
        "items: fn(Button?) -> list<Button?>",
      ),
      "android/lib.afl": edge.replace(
        "groups: map<string, list<Button>>",
        "groups: fn(Button) -> list<Button?>",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "callback_result_mismatch",
    files: {
      "core/lib.afl": core.replace(
        "items: map<string, list<Button>>",
        "items: fn(Button?) -> list<Button?>",
      ),
      "android/lib.afl": edge.replace(
        "groups: map<string, list<Button>>",
        "groups: fn(Button?) -> set<Button?>",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "callback_property_mismatch",
    files: {
      "core/lib.afl": core.replace("text: string", "text: fn()"),
      "android/lib.afl": edge.replace("text: string", "text: fn(i32)"),
    },
    code: "AFL3404",
  },
  {
    name: "nullable_signature",
    files: { "core/lib.afl": nullable_core, "android/lib.afl": nullable_edge },
    code: null,
  },
  {
    name: "nullable_input_mismatch",
    files: {
      "core/lib.afl": nullable_core,
      "android/lib.afl": nullable_edge.replace(
        "map<string, list<Button?>?>",
        "map<string, list<Button?>?>?",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "nullable_element_mismatch",
    files: {
      "core/lib.afl": nullable_core,
      "android/lib.afl": nullable_edge.replace(
        "groups: map<string, list<Button?>?>",
        "groups: map<string, list<Button>?>",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "nullable_result_mismatch",
    files: {
      "core/lib.afl": nullable_core,
      "android/lib.afl": nullable_edge.replace(
        "buttons: list<Button?>?",
        "buttons: list<Button?>",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "nullable_property_mismatch",
    files: {
      "core/lib.afl": nullable_core,
      "android/lib.afl": nullable_edge.replace("text: string?", "text: string"),
    },
    code: "AFL3404",
  },
  {
    name: "nullable_method_mismatch",
    files: {
      "core/lib.afl": nullable_core,
      "android/lib.afl": nullable_edge.replace(
        "result: Button?",
        "result: Button",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "nullable_standalone_edge",
    select: "android",
    files: {
      "core/lib.afl": nullable_core,
      "android/lib.afl": nullable_edge.replace(
        "result: Button?",
        "result: Button",
      ),
    },
    code: "AFL3404",
  },
  { name: "standalone_preset", preset: "ios", files: {}, code: null },
  { name: "standalone_core", select: "core", files: {}, code: null },
  { name: "standalone_edge", select: "android", files: {}, code: null },
  {
    name: "missing_edge",
    files: {
      "config.toml": '[project]\n[preset.android]\ncore = ["core"]\nedge = []',
    },
    code: "AFL4101",
  },
  {
    name: "no_extern",
    files: {
      "core/lib.afl": "",
      "config.toml": '[project]\n[preset.android]\ncore = ["core"]\nedge = []',
    },
    code: null,
  },
  {
    name: "duplicate_implementation",
    files: {
      "config.toml":
        '[project]\n[preset.android]\ncore = ["core"]\nedge = ["android", "ios"]',
    },
    code: "AFL4102",
  },
  {
    name: "duplicate_crate",
    files: {
      "config.toml":
        '[project]\n[preset.android]\ncore = ["core", "./core"]\nedge = ["android"]',
    },
    code: "AFL4001",
  },
  {
    name: "conflicting_roles",
    files: {
      "config.toml":
        '[project]\n[preset.android]\ncore = ["core"]\nedge = ["core"]',
    },
    code: "AFL4001",
  },
  {
    name: "empty_core",
    files: {
      "config.toml": "[project]\n[preset.android]\ncore = []\nedge = []",
    },
    code: "AFL4001",
  },
  {
    name: "invalid_list",
    files: { "presets/ios.toml": 'core = ["../core"]\nedge = "../ios"' },
    code: "AFL4001",
  },
  {
    name: "duplicate_preset",
    files: {
      "presets/android.toml": 'core = ["../core"]\nedge = ["../android"]',
    },
    code: "AFL4001",
  },
  { name: "unknown_preset", preset: "absent", files: {}, code: "AFL4002" },
  {
    name: "invalid_toml",
    files: { "presets/ios.toml": "core = [" },
    code: "AFL4001",
  },
  {
    name: "invalid_root_toml",
    files: { "config.toml": "[preset" },
    code: "AFL4001",
  },
  {
    name: "missing_preset_directory",
    files: { "config.toml": config.replace('"presets"', '"missing"') },
    code: "AFL4001",
  },
  {
    name: "invalid_preset_directory",
    files: { "config.toml": "preset_dir = 42\n[project]" },
    code: "AFL4001",
  },
  {
    name: "recursive_preset",
    files: { "presets/ios.toml": 'preset_dir = "nested"' },
    code: "AFL4001",
  },
  {
    name: "nested_preset_table",
    files: {
      "presets/ios.toml": '[preset.ios]\ncore = ["../core"]\nedge = []',
    },
    code: "AFL4001",
  },
  {
    name: "scan_not_recursive",
    files: { "presets/nested/invalid.toml": "[" },
    code: null,
  },
  {
    name: "no_implicit_scan",
    files: {
      "config.toml": config.replace('preset_dir = "presets"', ""),
      "presets/ios.toml": "[",
    },
    code: null,
  },
  {
    name: "missing_crate",
    files: { "presets/ios.toml": 'core = ["../missing"]\nedge = []' },
    code: "AFL4001",
  },
  {
    name: "conflicting_entries",
    files: { "core/main.afl": "fn main() {}" },
    code: "AFL4001",
  },
  {
    name: "nested_selected_root",
    files: {
      "core/child/lib.afl": "",
      "presets/ios.toml": 'core = ["../core/child"]\nedge = []',
    },
    code: "AFL4001",
  },
  {
    name: "nested_source_crate",
    files: { "core/child/lib.afl": "" },
    code: "AFL3000",
  },
  {
    name: "sdk_boundary",
    files: {
      "android/sdk.afl": "extern fn platform_call() [desc = [SDK call]]",
    },
    code: null,
  },
  {
    name: "unselected_source",
    files: { "ios/bad.afl": "invalid AFL" },
    code: null,
  },
  {
    name: "no_implicit_dep",
    files: { "android/config.toml": "[dep]" },
    code: "AFL3101",
  },
  {
    name: "missing_module",
    files: {
      "android/lib.afl": edge.replace(
        "impl dep::core::lib::show",
        "impl dep::core::absent::show",
      ),
    },
    code: "AFL3101",
  },
  {
    name: "missing_target",
    files: {
      "android/lib.afl": edge.replace(
        "impl dep::core::lib::show",
        "impl dep::core::lib::missing",
      ),
    },
    code: "AFL3102",
  },
  {
    name: "use_is_not_impl",
    files: {
      "android/lib.afl": edge.replace(
        "impl dep::core::lib::show",
        "use dep::core::lib::show as external_show",
      ),
    },
    code: "AFL4101",
  },
  {
    name: "ordinary_target",
    files: { "core/lib.afl": core.replace("extern fn show", "fn show") },
    code: "AFL3401",
  },
  {
    name: "local_extern",
    files: { "android/lib.afl": edge.replace("fn show", "extern fn show") },
    code: "AFL3402",
  },
  {
    name: "local_wrong_name",
    files: { "android/lib.afl": edge.replace("fn show", "fn display") },
    code: "AFL3402",
  },
  {
    name: "local_import_only",
    files: {
      "android/lib.afl": "impl dep::core::lib::show\nuse dep::core::lib::show",
    },
    code: "AFL3402",
  },
  {
    name: "duplicate_impl",
    files: { "android/lib.afl": edge + "\nimpl dep::core::lib::show" },
    code: "AFL3403",
  },
  {
    name: "impl_alias_forbidden",
    files: {
      "android/lib.afl": edge.replace(
        "impl dep::core::lib::show",
        "impl dep::core::lib::show as other",
      ),
    },
    code: "AFL1002",
  },
  {
    name: "collection_mismatch",
    files: {
      "android/lib.afl": edge.replace(
        "groups: map<string, list<Button>>",
        "groups: map<i32, list<Button>>",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "input_count",
    files: {
      "android/lib.afl": edge.replace("groups: map<string, list<Button>>", ""),
    },
    code: "AFL3404",
  },
  {
    name: "result_count",
    files: { "android/lib.afl": edge.replace("-> buttons: list<Button>", "") },
    code: "AFL3404",
  },
  {
    name: "result_mismatch",
    files: {
      "android/lib.afl": edge.replace(
        "buttons: list<Button>",
        "buttons: set<Button>",
      ),
    },
    code: "AFL3404",
  },
  {
    name: "missing_property",
    files: { "android/lib.afl": edge.replace("text: string", "label: string") },
    code: "AFL3405",
  },
  {
    name: "property_type_mismatch",
    files: { "android/lib.afl": edge.replace("text: string", "text: any") },
    code: "AFL3404",
  },
  {
    name: "missing_method",
    files: { "android/lib.afl": edge.replace("fn clone", "fn copy") },
    code: "AFL3405",
  },
  {
    name: "member_kind_mismatch",
    files: {
      "android/lib.afl": edge.replace(
        "text: string [desc = [Label]]",
        "fn text() [desc = [Label]]",
      ),
    },
    code: "AFL3405",
  },
  {
    name: "unrelated_same_name",
    files: {
      "android/lib.afl": edge.replace("impl dep::core::lib::Button", ""),
    },
    code: "AFL3404",
  },
  {
    name: "class_split",
    files: {
      "android/other.afl":
        "impl dep::core::lib::Button\nclass Button [desc = [Partial button]] {}",
    },
    code: "AFL4102",
  },
];
try {
  for (const testCase of cases) {
    const root = path.join(fixture, testCase.name);
    writeFiles(root, { ...base, ...testCase.files });
    const args =
      (testCase.select ?? null) !== null
        ? [path.join(root, testCase.select)]
        : [root, "--preset", testCase.preset ?? "android"];
    const execution = (() => {
      const previousDirectory = process.cwd();
      try {
        process.chdir(fixture);
        return run(process.execPath, [cli, "check", ...args, "--json"]);
      } finally {
        process.chdir(previousDirectory);
      }
    })();
    const result = JSON.parse(execution.stdout);
    assert.deepEqual(execution.stderr, "");
    assert.deepEqual(
      result.status,
      "complete",
      "Loader failed in " +
        String(testCase.name) +
        ": " +
        String(execution.stdout) +
        "",
    );
    if (testCase.code === null) {
      assert.deepEqual(
        execution.exit_code,
        0,
        "Unexpected errors in " +
          String(testCase.name) +
          ": " +
          String(execution.stdout) +
          "",
      );
      assert.deepEqual(result.diagnostics, []);
    } else {
      assert.deepEqual(
        execution.exit_code,
        1,
        "Expected error in " +
          String(testCase.name) +
          ": " +
          String(execution.stdout) +
          "",
      );
      assert(
        result.diagnostics.map((item) => item.code).includes(testCase.code),
        "Missing " +
          String(testCase.code) +
          " in " +
          String(testCase.name) +
          ": " +
          String(execution.stdout) +
          "",
      );
    }
  }
  const result = await exercise([project_root, path.join(fixture, "valid")]);
  console.log(result);
  console.log("Preset checks passed: " + String(cases.length) + " CLI cases.");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

async function exercise(args: string[]) {
  const { readFileSync, realpathSync, symlinkSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const tool = args[0],
    root = realpathSync(args[1]),
    uri = (file) => pathToFileURL(join(root, file)).href;
  const { LanguageService, parseDocument } = await import(
    pathToFileURL(join(tool, "packages/checker/dist/index.js")).href
  );
  const { loadProject } = await import(
    pathToFileURL(join(tool, "packages/checker/dist/node.js")).href
  );
  const project = await loadProject([root], [], { preset: "android" });
  const service = new LanguageService();
  service.update(project.documents, project);
  assert.deepEqual(service.diagnostics, []);
  const edgeUri = uri("android/lib.afl"),
    coreUri = uri("core/lib.afl");
  const text = readFileSync(join(root, "android/lib.afl"), "utf8");
  assert.equal(
    parseDocument({ uri: edgeUri, text }).module.declarations[0].kind,
    "implementation",
  );
  assert.equal(
    service.definition(edgeUri, { line: 0, character: 23 }).uri,
    coreUri,
  );
  assert.equal(
    service.implementations(coreUri, { line: 0, character: 14 })[0].uri,
    edgeUri,
  );
  assert.equal(
    service.implementations(coreUri, { line: 2, character: 8 })[0].uri,
    edgeUri,
  );
  assert.equal(
    service.implementations(coreUri, { line: 1, character: 5 })[0].uri,
    edgeUri,
  );
  assert(
    service
      .references(coreUri, { line: 0, character: 14 }, false)
      .some((item) => item.uri === edgeUri && item.range.start.line === 1),
  );
  assert(
    !service
      .completion(coreUri, { line: 2, character: 0 })
      .some((item) => item.label === "native_view"),
  );
  const incomplete = "impl dep::core::lib::";
  service.update(
    project.documents.map((doc) =>
      doc.uri === edgeUri ? { ...doc, text: incomplete } : doc,
    ),
    project,
  );
  assert.deepEqual(
    service
      .completion(edgeUri, { line: 0, character: incomplete.length })
      .map((item) => item.label)
      .sort(),
    ["Button", "show"],
  );
  const swapped = { ...project, preset: { ...project.preset, edge: [] } };
  service.update(project.documents, swapped);
  assert(service.diagnostics.some((item) => item.code === "AFL4101"));
  assert.deepEqual(
    service.implementations(coreUri, { line: 0, character: 14 }),
    [],
  );
  const override = {
    uri: uri("presets/ios.toml"),
    text: 'core = ["../core"]\nedge = []',
  };
  const overlaid = await loadProject([root], [override], { preset: "ios" });
  service.update(overlaid.documents, overlaid);
  assert(service.diagnostics.some((item) => item.code === "AFL4101"));
  assert(
    overlaid.watchedFiles.some((path) => path.endsWith("/presets/ios.toml")),
  );
  assert(overlaid.watchedDirectories.some((path) => path.endsWith("/presets")));
  const sharedCore =
    readFileSync(join(root, "core/lib.afl"), "utf8") +
    "\nextern fn data(value: Shared) [desc = [Shared data]\nvalue = [Input]]";
  const sharedEdge =
    text +
    "\nuse dep::core::lib::Shared as Data\nimpl dep::core::lib::data\nfn data(input: Data) [desc = [Use shared data]\ninput = [Input]]";
  const shared = await loadProject(
    [root],
    [
      { uri: coreUri, text: sharedCore },
      { uri: edgeUri, text: sharedEdge },
    ],
    { preset: "android" },
  );
  service.update(shared.documents, shared);
  assert.deepEqual(service.diagnostics, []);
  const contract =
    "fn pair(first: i32, second: string) -> amount: i32, message: string [desc = [Pair]\nfirst = [Number]\nsecond = [Text]\namount = [Number result]\nmessage = [Text result]]";
  const renamed = contract
    .replaceAll("first", "a")
    .replaceAll("second", "b")
    .replaceAll("amount", "count")
    .replaceAll("message", "text");
  const pairCore =
    readFileSync(join(root, "core/lib.afl"), "utf8") + "\nextern " + contract;
  const pairEdge = text + "\nimpl dep::core::lib::pair\n" + renamed;
  for (const [replacement, valid] of [
    [renamed, true],
    [renamed.replace("a: i32, b: string", "a: string, b: i32"), false],
    [
      renamed.replace("count: i32, text: string", "count: string, text: i32"),
      false,
    ],
  ] as [string, boolean][]) {
    const project = await loadProject(
      [root],
      [
        { uri: coreUri, text: pairCore },
        { uri: edgeUri, text: pairEdge.replace(renamed, replacement) },
      ],
      { preset: "android" },
    );
    service.update(project.documents, project);
    if (valid) {
      assert.deepEqual(service.diagnostics, []);
    } else {
      assert(service.diagnostics.some((item) => item.code === "AFL3404"));
    }
  }
  const duplicate = {
    uri: uri("config.toml"),
    text: '[project]\n[preset.android]\ncore = ["core"]\nedge = ["android", "linked"]',
  };
  symlinkSync(join(root, "android"), join(root, "linked"));
  const aliased = await loadProject([root], [duplicate], { preset: "android" });
  assert(aliased.diagnostics.some((item) => item.code === "AFL4001"));
  return "Preset AST, navigation, completion, overlays, cache invalidation and canonical roots passed.";
}
