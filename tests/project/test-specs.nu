use ../support.nu temporary-directory
use std/assert

def write-files [root: path, files: record] {
  for item in ($files | transpose path text) {
    let destination = ($root | path join $item.path)
    mkdir ($destination | path dirname)
    $item.text | save --force $destination
  }
}

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let cli = ($project_root | path join "packages/cli/dist/afl.js")
  let fixture = (temporary-directory "test-specs")
  let base = {
    "core/config.toml": '[test]
crates = ["../spec"]'
    "core/lib.afl": "fn operation() {}"
    "spec/config.toml": '[dep]
core = "../core"'
    "spec/lib.afl": 'use dep::core::lib::operation
fn behavior() [desc = [Describe the expected observable behavior]] {
    operation()
    [The operation completes successfully]
}'
  }
  let cases = [
    {name: valid, files: {}, code: null}
    {name: file_input, files: {}, select: "core/lib.afl", code: null}
    {name: test_back_dependency, files: {}, select: spec, code: null}
    {name: omitted, files: {"core/config.toml": "[dep]", "spec/lib.afl": "fn bad() { missing() }"}, code: null}
    {name: empty, files: {"core/config.toml": "[test]\ncrates = []", "spec/lib.afl": "fn bad() { missing() }"}, code: null}
    {name: table_required, files: {"core/config.toml": "test = []"}, code: AFL3004}
    {name: crates_required, files: {"core/config.toml": "[test]"}, code: AFL3004}
    {name: list_required, files: {"core/config.toml": '[test]
crates = "../spec"'}, code: AFL3004}
    {name: string_required, files: {"core/config.toml": "[test]\ncrates = [1]"}, code: AFL3004}
    {name: empty_path, files: {"core/config.toml": '[test]
crates = [" "]'}, code: AFL3004}
    {name: unknown_field, files: {"core/config.toml": '[test]
crates = ["../spec"]
core = "core"'}, code: AFL3004}
    {name: duplicate, files: {"core/config.toml": '[test]
crates = ["../spec", "../spec/."]'}, code: AFL3004}
    {name: missing, files: {"core/config.toml": '[test]
crates = ["../absent"]'}, code: AFL3004}
    {name: file_target, files: {"core/config.toml": '[test]
crates = ["../spec/lib.afl"]'}, code: AFL3004}
    {name: not_a_crate, files: {"core/config.toml": '[test]
crates = ["../ordinary"]', "ordinary/notes.afl": ""}, code: AFL3004}
    {name: conflicting_entries, files: {"spec/main.afl": "fn main() {}"}, code: AFL3004}
    {name: nested_target, files: {"core/config.toml": '[test]
crates = ["../spec/child"]', "spec/child/lib.afl": ""}, code: AFL3004}
    {name: self_target, files: {"core/config.toml": '[test]
crates = ["."]'}, code: AFL3004}
    {name: missing_test_config, files: {}, remove: "spec/config.toml", code: AFL3001}
    {name: no_implicit_dependency, files: {"spec/config.toml": "[dep]"}, code: AFL3101}
    {name: test_source_error, files: {"spec/lib.afl": "fn behavior() { missing() }"}, code: AFL3203}
    {name: test_documentation_error, files: {"spec/lib.afl": "fn behavior()"}, code: AFL2001}
    {name: test_syntax_error, files: {"spec/lib.afl": "fn behavior() {"}, code: AFL1002}
    {name: test_dependency_error, files: {"spec/config.toml": '[dep]
core = "../absent"'}, code: AFL3002}
    {name: real_dependency_cycle, files: {"core/config.toml": '[dep]
spec = "../spec"
[test]
crates = ["../spec"]'}, code: AFL3003}
    {name: dependency_tests_not_inherited, files: {
      "core/config.toml": '[dep]
support = "../support"
[test]
crates = ["../spec"]'
      "support/lib.afl": ""
      "support/config.toml": '[test]
crates = ["../absent"]'
    }, code: null}
    {name: specification_tests_not_inherited, files: {"spec/config.toml": '[dep]
core = "../core"
[test]
crates = ["../absent"]'}, code: null}
    {name: directly_selected_spec_tests, files: {"spec/config.toml": '[dep]
core = "../core"
[test]
crates = ["../absent"]'}, select: spec, code: AFL3004}
    {name: shared_specification, files: {"other/lib.afl": "", "other/config.toml": '[test]
crates = ["../spec"]'}, select: ".", code: null}
    {name: tests_not_in_preset_schema, files: {"config.toml": '[project]
[preset.android]
core = ["core"]
edge = []
test = ["spec"]'}, select: ".", preset: android, code: AFL4001}
    {name: preset_owner_tests, files: {
      "core/lib.afl": "extern fn operation() [desc = [External operation]]"
      "spec/lib.afl": "extern fn prepare() [desc = [Test preparation boundary]]"
      "edge/lib.afl": "impl dep::core::lib::operation\nfn operation() {}"
      "edge/config.toml": '[dep]
core = "../core"
[test]
crates = ["../edge-spec"]'
      "edge-spec/lib.afl": "fn adaptation() [desc = [Describe platform behavior]]"
      "edge-spec/config.toml": "[dep]"
      "config.toml": '[project]
[preset.android]
core = ["core"]
edge = ["edge"]'
    }, select: ".", preset: android, code: null}
  ]
  try {
    for case in $cases {
      let root = ($fixture | path join $case.name)
      write-files $root ($base | merge $case.files)
      if ($case | get -o remove) != null { rm ($root | path join $case.remove) }
      let selected = ($root | path join ($case | get -o select | default core))
      let args = if ($case | get -o preset) == null { [] } else { [--preset $case.preset] }
      let execution = (do { cd $fixture; ^node $cli check $selected ...$args --json | complete })
      let result = ($execution.stdout | from json)
      assert equal $execution.stderr ""
      assert equal $result.status complete
      if $case.code == null {
        assert equal $execution.exit_code 0 $"($case.name): ($execution.stdout)"
        assert equal $result.diagnostics []
      } else {
        assert equal $execution.exit_code 1 $"($case.name): ($execution.stdout)"
        assert ($case.code in ($result.diagnostics | get code)) $"($case.name): ($execution.stdout)"
      }
    }

    let root = ($fixture | path join valid)
    let queried = (^node $cli symbols ($root | path join core) --json | complete)
    assert equal $queried.exit_code 0
    let scope = ($queried.stdout | from json | get scope)
    assert equal ($scope.files | length) 2
    assert equal ($scope.tests | length) 1
    assert equal ($scope.tests.0.target | path expand) ($root | path join core)
    assert equal ($scope.tests.0.crates | each {|path| $path | path expand }) [($root | path join spec)]
    let references = (^node $cli references ($root | path join core/lib.afl) --line 1 --column 4 --json | complete)
    assert equal $references.exit_code 0
    assert equal ($references.stdout | from json | get results | length) 2

    # Canonical aliases cannot duplicate a specification, and explicit links
    # outside directory scans remain valid association targets.
    ^ln -s ($root | path join spec) ($root | path join alias)
    '[test]
crates = ["../spec", "../alias"]' | save --force ($root | path join core/config.toml)
    let duplicate = (^node $cli check ($root | path join core) --json | complete)
    assert equal $duplicate.exit_code 1
    assert ("AFL3004" in ($duplicate.stdout | from json | get diagnostics.code))
    $base."core/config.toml" | save --force ($root | path join core/config.toml)

    # Host overlays exercise unsaved test paths, missing crate recovery and
    # canonical association metadata without changing disk contents.
    let bridge = r#'
      import {readFileSync, realpathSync} from "node:fs";
      import {join} from "node:path";
      import {pathToFileURL} from "node:url";
      const [repo, input] = process.argv.slice(1), root = realpathSync(input);
      const {loadProject} = await import(pathToFileURL(join(repo, "packages/checker/dist/node.js")));
      const {LanguageService} = await import(pathToFileURL(join(repo, "packages/checker/dist/index.js")));
      const uri = path => pathToFileURL(join(root, path)).href;
      const service = new LanguageService();
      const config = {uri: uri("core/config.toml"), text: '[test]\ncrates = ["../new-spec"]'};
      const missing = await loadProject([join(root, "core")], [config]);
      const recovered = await loadProject([join(root, "core")], [config,
        {uri: uri("new-spec/lib.afl"), text: "fn scenario() [desc = [Expected behavior]]"},
        {uri: uri("new-spec/config.toml"), text: "[dep]"},
      ]);
      const initial = await loadProject([join(root, "core")]);
      service.update(initial.documents, initial);
      const removed = await loadProject([join(root, "core")], [{...config, text: "[test]\ncrates = []"}]);
      const updated = service.update(removed.documents, removed);
      const presetRoot = join(root, "../preset_owner_tests");
      const metadata = await loadProject([presetRoot], [], {presetsOnly: true});
      console.log(JSON.stringify({missingCodes: missing.diagnostics.map(item => item.code),
        watchedMissing: missing.watchedFiles.includes(join(root, "new-spec/lib.afl")),
        recoveredDiagnostics: recovered.diagnostics, recoveredTests: recovered.tests,
        recoveredFiles: recovered.documents.map(item => item.uri),
        updated, removedOutline: service.documentSymbols(uri("spec/lib.afl")),
        diskConfig: readFileSync(join(root, "core/config.toml"), "utf8"),
        metadataTests: metadata.tests, metadataFiles: metadata.documents,
      }));
    '#
    mkdir ($root | path join new-spec)
    let execution = (^node --input-type=module -e $bridge $project_root $root | complete)
    assert equal $execution.exit_code 0 $execution.stderr
    let result = ($execution.stdout | from json)
    assert ("AFL3004" in $result.missingCodes)
    assert $result.watchedMissing
    assert equal $result.recoveredDiagnostics []
    assert equal ($result.recoveredFiles | length) 2
    assert ($result.recoveredTests.0.crates.0 | str ends-with "/new-spec/")
    assert $result.updated
    assert equal $result.removedOutline []
    assert equal $result.diskConfig $base."core/config.toml"
    assert equal $result.metadataTests []
    assert equal $result.metadataFiles []
    print $"Test specification checks passed: ($cases | length) CLI cases, queries, aliases, overlays and association scope."
  } finally { rm --recursive --force $fixture }
}
