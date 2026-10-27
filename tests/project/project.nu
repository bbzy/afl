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
  let fixture = (temporary-directory "project")
  let cases = [
    {name: "plain_library", files: {"lib.afl": "", "config.toml": "[dep]"}, select: ".", code: null}
    {name: "missing_config", files: {"lib.afl": ""}, select: ".", code: "AFL3001"}
    {name: "bad_config", files: {"lib.afl": "", "config.toml": "[dep"}, select: ".", code: "AFL3001"}
    {name: "removed_res_section", files: {"lib.afl": "", "config.toml": '[res]
sdk = "Legacy notes"'}, select: ".", code: "AFL3001"}
    {name: "removed_empty_res", files: {"lib.afl": "", "config.toml": "[res]"}, select: ".", code: "AFL3001"}
    {name: "removed_res_value", files: {"lib.afl": "", "config.toml": "res = []"}, select: ".", code: "AFL3001"}
    {name: "bad_dependency_value", files: {"lib.afl": "", "config.toml": "[dep]\ncore = 123"}, select: ".", code: "AFL3001"}
    {name: "bad_dependency_table", files: {"lib.afl": "", "config.toml": "dep = []"}, select: ".", code: "AFL3001"}
    {name: "missing_target", files: {"lib.afl": "", "config.toml": "[dep]\ncore = './missing'"}, select: ".", code: "AFL3002"}
    {name: "target_not_crate", files: {"lib.afl": "", "config.toml": "[dep]\ncore = './ordinary'", "ordinary/work.afl": ""}, select: ".", code: "AFL3002"}
    {name: "duplicate_toml", files: {"lib.afl": "", "config.toml": "[dep]\ncore = './a'\ncore = './b'"}, select: ".", code: "AFL3001"}
    {name: "orphan_module", files: {"work.afl": "fn work() {}"}, select: ".", code: "AFL3000"}
    {name: "entry_conflict", files: {"main.afl": "fn main() {}", "lib.afl": "", "config.toml": "[dep]"}, select: ".", code: "AFL3000"}
    {name: "nested_crate", files: {"lib.afl": "", "child/lib.afl": "", "config.toml": "[dep]"}, select: "child/lib.afl", code: "AFL3000"}
    {name: "missing_main", files: {"main.afl": "fn other() {}", "config.toml": "[dep]"}, select: ".", code: "AFL3000"}
    {name: "extern_main", files: {"main.afl": "extern fn main() [desc = [Entry]]", "config.toml": "[dep]"}, select: ".", code: "AFL3000"}
    {name: "missing_module", files: {"lib.afl": "use missing::work", "config.toml": "[dep]"}, select: ".", code: "AFL3101"}
    {name: "missing_symbol", files: {"lib.afl": "use math::missing", "math.afl": "fn work() {}", "config.toml": "[dep]"}, select: ".", code: "AFL3102"}
    {name: "unconfigured_dep", files: {"lib.afl": "use dep::core::lib::work", "config.toml": "[dep]"}, select: ".", code: "AFL3101"}
    {name: "whole_crate", files: {"lib.afl": "", "bad.afl": "fn work() { missing() }", "config.toml": "[dep]"}, select: "lib.afl", code: "AFL3203"}
    {name: "ignored_folders", files: {"main.afl": "fn main() {}", "config.toml": "[dep]", "node_modules/bad.afl": "not AFL", ".jj/bad.afl": "not AFL"}, select: ".", code: null}
    {name: "personal_directory_is_ordinary", files: {"main.afl": "fn main() {}", "config.toml": "[dep]", ".AGENT_GROUND/bad.afl": "fn bad() { missing() }"}, select: ".", code: "AFL3203"}
    {name: "explicit_ignored_file", files: {"main.afl": "fn main() {}", "config.toml": "[dep]", "node_modules/bad.afl": "fn bad() { missing() }"}, select: "node_modules/bad.afl", code: "AFL3203"}
    {name: "explicit_ignored_directory", files: {"main.afl": "fn main() {}", "config.toml": "[dep]", "node_modules/bad.afl": "fn bad() { missing() }"}, select: "node_modules", code: "AFL3203"}
    {name: "explicit_ignored_entry", files: {"main.afl": "fn main() {}", "config.toml": "[dep]", "node_modules/lib.afl": ""}, select: "node_modules/lib.afl", code: "AFL3000"}
    {name: "mutual_modules", files: {
      "lib.afl": "use other::b\nfn a() { b() }",
      "other.afl": "use lib::a\nfn b() { a() }",
      "config.toml": "[dep]"
    }, select: "other.afl", code: null}
    {name: "crate_path", files: {
      "lib.afl": "",
      "math.afl": "fn work() {}",
      "nested/part.afl": "use crate::math::work\nfn run() { work() }",
      "config.toml": "[dep]"
    }, select: "nested/part.afl", code: null}
    {name: "import_alias", files: {
      "lib.afl": "use math::work as imported\nfn work() { imported() }",
      "math.afl": "fn work() {}",
      "config.toml": "[dep]"
    }, select: ".", code: null}
    {name: "import_collision", files: {
      "lib.afl": "use math::work\nfn work() {}",
      "math.afl": "fn work() {}",
      "config.toml": "[dep]"
    }, select: ".", code: "AFL3201"}
    {name: "no_import_reexport", files: {
      "lib.afl": "use middle::work",
      "middle.afl": "use math::work",
      "math.afl": "fn work() {}",
      "config.toml": "[dep]"
    }, select: ".", code: "AFL3102"}
    {name: "cyclic_crates", files: {
      "a/lib.afl": "", "a/config.toml": "[dep]\nb = '../b'",
      "b/lib.afl": "", "b/config.toml": "[dep]\na = '../a'"
    }, select: "a", code: "AFL3003"}
    {name: "transitive_dependencies", files: {
      "app/main.afl": "use dep::core::lib::work\nfn main() { work() }",
      "app/config.toml": "dep = { core = '../core' }",
      "core/lib.afl": "use dep::support::lib::helper\nfn work() { helper() }",
      "core/config.toml": "[dep]\nsupport = '../support'",
      "support/lib.afl": "fn helper() {}", "support/config.toml": "[dep]"
    }, select: "app/main.afl", code: null}
    {name: "no_config_inheritance", files: {
      "app/main.afl": "use dep::core::lib::work\nfn main() { work() }",
      "app/config.toml": "[dep]\ncore = '../core'\nsupport = '../support'",
      "core/lib.afl": "use dep::support::lib::helper\nfn work() { helper() }",
      "core/config.toml": "[dep]",
      "support/lib.afl": "fn helper() {}", "support/config.toml": "[dep]"
    }, select: "app/main.afl", code: "AFL3101"}
    {name: "imported_member_type", files: {
      "app/main.afl": "use dep::core::lib::Holder as Remote\nfn main() { holder: Remote = [Create]\n text: string = holder.get().value }",
      "app/config.toml": "[dep]\ncore = '../core'",
      "core/lib.afl": "use model::Result\nclass Holder [desc = [Holder]] {\n fn get() -> Result [desc = [Read]\n return = [Result]]\n}",
      "core/model.afl": "class Result [desc = [Result]] { value: string [desc = [Text]] }",
      "core/config.toml": "[dep]"
    }, select: "app/main.afl", code: null}
  ]
  try {
    for case in $cases {
      let root = ($fixture | path join $case.name)
      write-files $root $case.files
      let selected = ($root | path join $case.select)
      let execution = (do { cd $fixture; ^node $cli check $selected --json | complete })
      assert equal $execution.stderr ""
      let result = ($execution.stdout | from json)
      assert equal $result.status "complete" $"Project load did not complete: ($case.name)"
      if $case.code == null {
        assert equal $result.diagnostics [] $"Unexpected diagnostic: ($case.name)"
        assert equal $execution.exit_code 0
      } else {
        assert equal $execution.exit_code 1 $"Expected AFL error exit status: ($case.name)"
        assert ($case.code in ($result.diagnostics | get code)) $"Missing ($case.code): ($case.name)"
      }
      if $case.name == "bad_config" {
        let range = ($result.diagnostics | where code == "AFL3001" | first | get range)
        assert equal $range.end.line 0
        assert ($range.end.character <= ($case.files."config.toml" | str length)) "TOML diagnostic extends past EOF"
      }
    }
    let demos = (^node $cli check ($project_root | path join "demo") ($project_root | path join "tests/fixtures") --json | complete)
    assert equal $demos.exit_code 0
    assert equal ($demos.stdout | from json | get diagnostics) []

    let linked = ($fixture | path join "ignored_folders")
    ^ln -s $linked ($linked | path join "loop")
    let check_link = (^node $cli check $linked --json | complete)
    assert equal $check_link.exit_code 0
    print $"Project checks passed: ($cases | length) fixtures, all demos, and symbolic-link traversal."
  } finally { rm --recursive --force $fixture }
}
