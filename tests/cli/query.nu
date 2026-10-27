use ../support.nu temporary-directory
use std/assert

def run-query [cli: path, args: list<string>, expected: int = 0] {
  let execution = (^node $cli ...$args --json | complete)
  assert equal $execution.exit_code $expected $"($args | str join ' '): ($execution.stdout)($execution.stderr)"
  assert equal $execution.stderr ""
  $execution.stdout | from json
}

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let cli = ($project_root | path join "packages/cli/dist/afl.js")
  let fixture = (temporary-directory "query")
  let project = ($fixture | path join "project with spaces")
  try {
    let files = {
      "shared/config.toml": "[project]\n[dep]"
      "shared/lib.afl": 'fn add(a: i32) -> i32 [
    a = [Input]
    return = [Same value]
] {
    a
}
class Counter [desc = [Counter]] {
    value: i32 [desc = [Current value]]
    fn read() -> i32 [return = [Current value]] { self.value }
}
extern fn show() [desc = [Show the page]]
'
      "app/config.toml": '[dep]
shared = "../shared"'
      "app/main.afl": 'use dep::shared::lib::add as total
use dep::shared::lib::Counter

fn main() {
    n: i32 = total(1)
    counter: Counter = {value: n}
    result: i32 = counter.read()
    [Mention total and add only in prose]
    marker: string = "total"
    raw_marker: string = r##"total, )
counter.read "# stays text"##
    r##[Mention total and ]# without a reference]##
}
'
      "app/other.afl": 'fn add() {}'
      "other/config.toml": '[dep]
shared = "../shared"'
      "other/main.afl": 'use dep::shared::lib::add
fn main() { n: i32 = add(2) }'
      "android/config.toml": '[dep]
shared = "../shared"'
      "android/lib.afl": 'impl dep::shared::lib::show
fn show() { [Show using Android] }'
      "ios/config.toml": '[dep]
shared = "../shared"'
      "ios/lib.afl": 'impl dep::shared::lib::show
fn show() { [Show using iOS] }'
      "config.toml": 'preset_dir = "presets"
[project]
[preset.android]
core = ["shared"]
edge = ["android"]'
      "presets/ios.toml": 'core = ["../shared"]
edge = ["../ios"]'
    }
    for item in ($files | transpose path text) {
      let destination = ($project | path join $item.path)
      mkdir ($destination | path dirname)
      $item.text | save $destination
    }
    let shared = ($project | path join "shared/lib.afl")
    let app = ($project | path join "app/main.afl")
    let point = [$app --line "5" --column "14"]
    let declaration = [$shared --line "1" --column "4"]

    # Aliases resolve to their original definition, even when a same-named
    # function exists in another module; snippets come from the indexed file.
    let definition = (run-query $cli ([definition] ++ $point))
    assert equal $definition.status "complete"
    assert equal $definition.command "definition"
    assert equal $definition.diagnostics []
    assert equal ($definition.results | length) 1
    assert equal $definition.results.0.path $shared
    assert equal $definition.results.0.range {start: {line: 0, character: 3}, end: {line: 0, character: 6}}
    assert equal $definition.results.0.text 'fn add(a: i32) -> i32 ['
    assert ($definition.results.0.uri | str contains "%20")
    assert equal ($definition.scope.files | length) 3
    assert equal ($definition.scope.crates | length) 2
    assert equal $definition.scope.preset null
    let alias = (run-query $cli [definition $app --line "1" --column "30"])
    assert equal $alias.results $definition.results

    # Default scope only includes the owning crate and its dependencies.
    # Broader project scope finds consumers, preserving precise symbol identity.
    let local = (run-query $cli ([references] ++ $declaration))
    assert equal $local.results []
    assert equal $local.scope.files [$shared]
    let app_refs = (run-query $cli ([references] ++ $point))
    assert equal ($app_refs.results | get range.start.line) [0 0 4]
    assert ($app_refs.results | all {|item| $item.path == $app })
    let all_refs = (run-query $cli ([references] ++ $declaration ++ [--project $project]))
    assert equal ($all_refs.results | length) 5
    assert equal ($all_refs.results | get path | uniq | length) 2
    let with_declaration = (run-query $cli ([references] ++ $declaration ++ [--project $project --include-declaration]))
    assert equal ($with_declaration.results | length) 6
    assert equal ($with_declaration.results | where path == $shared | length) 1
    assert equal (run-query $cli ([references] ++ $declaration ++ [--project $project])).results $all_refs.results

    # Symbols retain class/member nesting and declaration ranges, not locals.
    let symbols = (run-query $cli [symbols $shared])
    assert equal ($symbols.results | get name) [add Counter show]
    let counter = ($symbols.results | where name == Counter | first)
    assert equal ($counter.children | get name) [value read]
    assert equal $counter.selectionRange.start {line: 6, character: 6}
    assert equal $counter.range.start {line: 6, character: 0}
    assert equal $counter.text 'class Counter [desc = [Counter]] {'
    let member = (run-query $cli [definition $app --line "7" --column "27"])
    assert equal $member.results.0.path $shared
    assert equal $member.results.0.range.start {line: 8, character: 7}
    let parameter = (run-query $cli [references $shared --line "1" --column "8"])
    assert equal ($parameter.results | get range.start.line) [1 4]
    let property = (run-query $cli [references $shared --line "8" --column "5" --project $project])
    assert equal ($property.results | length) 2

    # Descriptions and literals do not become dependencies; no match is success.
    for position in [["8" "15"] ["9" "24"] ["10" "29"] ["11" "1"] ["12" "20"] ["3" "1"]] {
      let empty = (run-query $cli [definition $app --line $position.0 --column $position.1])
      assert equal $empty.results []
    }

    # Explicit impl lookup respects inline and standalone presets, including
    # class members in the repository's real core/edge example.
    let extern_point = [$shared --line "11" --column "11" --project $project]
    let both = (run-query $cli ([implementations] ++ $extern_point))
    assert equal ($both.results | length) 2
    for preset in [android ios] {
      let implementation = (run-query $cli ([implementations] ++ $extern_point ++ [--preset $preset]))
      assert equal ($implementation.results | length) 1
      assert equal $implementation.results.0.path ($project | path join $preset "lib.afl")
      assert equal $implementation.scope.preset $preset
      assert equal ($implementation.scope.files | length) 2
      let outline = (run-query $cli [symbols $project --preset $preset])
      assert equal $outline.scope $implementation.scope
      let preset_refs = (run-query $cli ([references] ++ $extern_point ++ [--preset $preset]))
      assert equal ($preset_refs.results | length) 1
    }
    let edge_demo = ($project_root | path join "demo/edge")
    let class_impl = (run-query $cli [implementations ($edge_demo | path join "core/button.afl") --line "3" --column "8" --project $edge_demo --preset android])
    assert equal ($class_impl.results | length) 1
    assert ($class_impl.results.0.path | str ends-with "android/button.afl")
    let missing_preset = (run-query $cli ([implementations] ++ $extern_point ++ [--preset missing]) 1)
    assert equal $missing_preset.results []
    assert ("AFL4002" in ($missing_preset.diagnostics | get code))
    let outside = (run-query $cli ([definition] ++ $point ++ [--project $project --preset android]) 2)
    assert ($outside.message | str contains "outside the selected")

    # Position handling is one-based on input, zero-based UTF-16 in JSON,
    # including CRLF and non-BMP text preceding an explicit reference.
    let unicode = ($project | path join "app/unicode.afl")
    'use dep::shared::lib::add
fn unicode() {
    add([😀], add(1))
}
' | str replace --all (char nl) "\r\n" | save $unicode
    let unicode_definition = (run-query $cli [definition $unicode --line "3" --column "15"] 1)
    assert equal $unicode_definition.results $definition.results
    assert ("AFL3206" in ($unicode_definition.diagnostics | get code))
    rm $unicode

    # Recoverable source/config errors accompany query results with exit 1.
    "fn broken() { missing() }" | save ($project | path join "app/broken.afl")
    let broken = (run-query $cli ([definition] ++ $point) 1)
    assert equal $broken.results $definition.results
    assert ("AFL3203" in ($broken.diagnostics | get code))
    rm ($project | path join "app/broken.afl")
    '[dep]
shared = "../absent"' | save --force ($project | path join "app/config.toml")
    let dependency = (run-query $cli ([definition] ++ $point) 1)
    assert equal $dependency.results []
    assert ("AFL3002" in ($dependency.diagnostics | get code))
    $files."app/config.toml" | save --force ($project | path join "app/config.toml")

    # Paths with spaces, relative invocation from another cwd, and symlink
    # aliases all locate the same canonical sources.
    let relative = (do {
      cd $project
      run-query $cli [definition app/main.afl --line "5" --column "14" --project .]
    })
    assert equal $relative.results $definition.results
    let default = (do { cd ($project | path join shared); run-query $cli [symbols] })
    assert equal $default.results $symbols.results
    let explicit_project = (run-query $cli [symbols --project ($project | path join shared)])
    assert equal $explicit_project.results $symbols.results
    ^ln -s $project ($fixture | path join "alias")
    let symlink = (run-query $cli [definition ($fixture | path join "alias/app/main.afl") --line "5" --column "14"])
    assert equal $symlink.results $definition.results

    # Invalid invocations never masquerade as empty successful queries.
    let invalid = [
      [definition]
      [definition $app]
      [definition $app $shared --line "1" --column "1"]
      [definition $app --line "0" --column "1"]
      [definition $app --line "-1" --column "1"]
      [definition $app --line "1.5" --column "1"]
      [definition $app --line "1e2" --column "1"]
      [definition $app --line "9007199254740993" --column "1"]
      [definition $app --line "999" --column "1"]
      [definition $app --line "1" --column "999"]
      [definition $app --line "1" --column "0"]
      [definition $app --line "1" --column "1" --preset android]
      [definition $app --line "1" --column "1" --project $app]
      [definition $app --line "1" --column "1" --project ""]
      [definition $app --line "1" --column "1" --include-declaration]
      [definition ($project | path join "app/config.toml") --line "1" --column "1"]
      [definition ($project | path join app) --line "1" --column "1"]
      [definition ($project | path join "missing.afl") --line "1" --column "1"]
      [symbols $shared --line "1"]
      [symbols $shared --include-declaration]
      [symbols $shared --project $project]
      [symbols $project --preset ""]
      [check $app --line "1"]
    ]
    for args in $invalid {
      let error_result = (run-query $cli $args 2)
      assert equal $error_result.status error
      assert (not ($error_result.message | is-empty))
    }
    let text = (^node $cli definition ...$point | complete)
    assert equal $text.exit_code 0
    assert ($text.stdout | str contains $"($shared):1:4")
    assert ($text.stdout | str contains "Scope:")
    let no_results = (^node $cli references ...$declaration | complete)
    assert equal $no_results.exit_code 0
    assert ($no_results.stdout | str contains "No results in this scope.")
    let help = (^node $cli --help | complete)
    assert ($help.stdout | str contains "afl implementations")
    print "CLI queries passed: aliases, scope, members, presets, opaque prose, UTF-16, recovery, paths and invalid inputs."
  } finally {
    rm --recursive --force $fixture
  }
}
