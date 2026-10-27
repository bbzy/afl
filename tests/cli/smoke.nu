use ../support.nu temporary-directory
use std/assert

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let cli = ($project_root | path join "packages" "cli" "dist" "afl.js")
  let cli_manifest = (open ($project_root | path join "packages" "cli" "package.json"))
  let fixture = (temporary-directory "smoke")

  try {
    let help = (^node $cli --help | complete)
    assert equal $help.exit_code 0
    assert ($help.stdout | str contains "afl check")

    let version = (^node $cli --version | complete)
    assert equal $version.exit_code 0
    assert equal ($version.stdout | str trim) $cli_manifest.version

    let installed_entry = (do {
      cd $project_root
      ^npm exec --offline -- afl --version | complete
    })
    assert equal $installed_entry.exit_code 0
    assert equal ($installed_entry.stdout | str trim) $cli_manifest.version

    # The npm launcher must give an actionable error in a not-yet-built checkout.
    mkdir ($fixture | path join "unbuilt" "bin")
    let unbuilt_launcher = ($fixture | path join "unbuilt" "bin" "afl.mjs")
    cp ($project_root | path join "packages" "cli" "bin" "afl.mjs") $unbuilt_launcher
    let unbuilt = (^node $unbuilt_launcher --help | complete)
    assert equal $unbuilt.exit_code 2
    assert ($unbuilt.stderr | str contains "npm run build")

    mkdir ($fixture | path join "nested dir") ($fixture | path join "node_modules")
    let first_source = ($fixture | path join "first.afl")
    "fn main() {}" | save ($fixture | path join "main.afl")
    "[dep]" | save ($fixture | path join "config.toml")
    "fn first() { missing_first() }" | save $first_source
    "fn second() { missing_second() }" | save ($fixture | path join "nested dir" "second.afl")
    "Ignored dependency source." | save ($fixture | path join "node_modules" "ignored.afl")
    "Unrelated file." | save ($fixture | path join "notes.txt")

    # Overlapping inputs must report each unresolved reference only once.
    let check = (^node $cli check $fixture $first_source --json | complete)
    assert equal $check.exit_code 1
    assert equal $check.stderr ""
    let result = ($check.stdout | from json)
    assert equal $result.status "complete"
    assert equal ($result.diagnostics | length) 2
    assert equal ($result.diagnostics | get uri | uniq | length) 2
    assert ($result.diagnostics | all {|item| $item.code == "AFL3203" })
    assert ($result.diagnostics | all {|item| $item.severity == "error" })
    assert ($result.diagnostics | get uri | all {|uri| $uri | str starts-with "file:///" })

    let text_check = (^node $cli check $first_source | complete)
    assert equal $text_check.exit_code 1
    assert ($text_check.stdout | str contains ":1:14 error AFL3203")

    let default_check = (do {
      cd $fixture
      ^node $cli check --json | complete
    })
    assert equal $default_check.exit_code 1
    assert equal ($default_check.stdout | from json) $result

    let missing = (^node $cli check ($fixture | path join "missing.afl") --json | complete)
    assert equal $missing.exit_code 2
    assert equal ($missing.stdout | from json | get status) "error"

    mkdir ($fixture | path join "empty")
    let empty = (^node $cli check ($fixture | path join "empty") --json | complete)
    assert equal $empty.exit_code 2
    assert equal ($empty.stdout | from json | get status) "error"

    let wrong_file = (^node $cli check ($fixture | path join "notes.txt") --json | complete)
    assert equal $wrong_file.exit_code 2
    assert equal ($wrong_file.stdout | from json | get status) "error"

    let unknown = (^node $cli unknown | complete)
    assert equal $unknown.exit_code 2
    assert ($unknown.stderr | str contains "Unknown command")

    let unknown_option = (^node $cli check --unknown | complete)
    assert equal $unknown_option.exit_code 2
    assert not ($unknown_option.stderr | is-empty)

    let extension = (^nu --no-config-file ($project_root | path join "tests" "vscode" "vscode.nu") | complete)
    if $extension.exit_code != 0 {
      error make {msg: $"VS Code adapter checks failed:\n($extension.stdout)($extension.stderr)"}
    }
    print $extension.stdout
    print "CLI smoke checks passed."
  } finally {
    rm --recursive --force $fixture
  }
}
