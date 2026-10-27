use ../support.nu temporary-directory
use std/assert

def main [] {
  let root = ($env.FILE_PWD | path dirname | path dirname)
  let cli = ($root | path join packages/cli/bin/afl.mjs)
  let fixture = (temporary-directory "unsupported")
  try {
    mkdir ($fixture | path join core) ($fixture | path join edge)
    '[dep]' | save ($fixture | path join core/config.toml)
    "[dep]\ncore = '../core'" | save ($fixture | path join edge/config.toml)
    'extern class Panel [desc = [Control panel]] {
 fn open() [desc = [Show panel]]
}' | save ($fixture | path join core/lib.afl)
    let edge = 'unsupported dep::core::lib::Panel [
 desc = [This platform has no panel]
 fallback = [Do not instantiate the panel or register its callbacks; keep processing without interactive controls]
]'
    $edge | save ($fixture | path join edge/lib.afl)
    let preset = '[project]
[preset.ohos]
core = ["core"]
edge = ["edge"]
allow_unsupported = ["core/lib.afl::Panel"]'
    let cases = [
      {name: allowed, config: $preset, source: $edge, code: AFL4103, exit: 0}
      {name: not_allowed, config: ($preset | str replace 'allow_unsupported = ["core/lib.afl::Panel"]' ''), source: $edge, code: AFL4101, exit: 1}
      {name: unknown_target, config: ($preset | str replace 'lib.afl::Panel' 'lib.afl::Missing'), source: $edge, code: AFL4001, exit: 1}
      {name: wrong_file, config: ($preset | str replace 'core/lib.afl::Panel' 'edge/lib.afl::Panel'), source: $edge, code: AFL4001, exit: 1}
      {name: missing_file, config: ($preset | str replace 'lib.afl::Panel' 'missing.afl::Panel'), source: $edge, code: AFL4001, exit: 1}
      {name: missing_fallback, config: $preset, source: 'unsupported dep::core::lib::Panel [desc = [No panel]]', code: AFL2001, exit: 1}
      {name: missing_reason, config: $preset, source: 'unsupported dep::core::lib::Panel [fallback = [Skip panel]]', code: AFL2001, exit: 1}
      {name: ordinary_target, config: $preset, source: ($edge | str replace 'lib::Panel' 'lib::Other'), code: AFL3102, exit: 1}
      {name: duplicate, config: $preset, source: ($edge + "\n" + $edge), code: AFL3411, exit: 1}
      {name: conflict, config: $preset, source: ($edge + "\nimpl dep::core::lib::Panel\nclass Panel { fn open() {} }"), code: AFL3411, exit: 1}
      {name: dependency_preserved, config: $preset, source: ($edge | str replace 'dep::core' 'dep::missing'), code: AFL3101, exit: 1}
      {name: description_link, config: $preset, source: ($edge | str replace 'no panel' 'no panel; contract {@dep::core::lib::Panel}'), code: AFL4103, exit: 0}
    ]
    for case in $cases {
      $case.config | save --force ($fixture | path join config.toml)
      $case.source | save --force ($fixture | path join edge/lib.afl)
      let run = (^node $cli check $fixture --preset ohos --json | complete)
      assert equal $run.exit_code $case.exit $"($case.name): ($run.stdout)($run.stderr)"
      assert ($case.code in ($run.stdout | from json | get diagnostics.code)) $case.name
    }
    $preset | save --force ($fixture | path join config.toml)
    $edge | save --force ($fixture | path join edge/lib.afl)
    let definition = (^node $cli definition ($fixture | path join edge/lib.afl) --line 1 --column 30 --project $fixture --preset ohos --json | complete)
    assert equal $definition.exit_code 0 $definition.stderr
    assert equal ($definition.stdout | from json | get results | length) 1
    let implementations = (^node $cli implementations ($fixture | path join core/lib.afl) --line 1 --column 14 --project $fixture --preset ohos --json | complete)
    assert equal $implementations.exit_code 0 $implementations.stderr
    assert equal ($implementations.stdout | from json | get results) []
    let standalone = (^node $cli check ($fixture | path join edge) --json | complete)
    assert equal $standalone.exit_code 0 $standalone.stderr
    assert equal ($standalone.stdout | from json | get diagnostics) []
    print $"Unsupported capabilities passed: ($cases | length) preset/config cases, standalone validation, references and no fake implementation."
  } finally { rm --recursive --force $fixture }
}
