# Keep test fixtures in the caller's temporary directory when one is configured.
export def temporary-directory [prefix: string = "afl-test", fallback: path = ""] {
  let directory = ($env.TEMP_DIR? | default "")
  let base = (if $directory != "" { $directory } else if $fallback != "" { $fallback } else { $env.TMPDIR? | default "" })
  if $base != "" {
    mktemp --directory --tmpdir-path ($base | path expand) $"($prefix).XXXXXX" | path expand
  } else {
    mktemp --directory | path expand
  }
}

# The TypeScript suite owns cases and assertions; this driver owns its environment.
export def run-test [suite: string, ...args: string] {
  const root = path self ..
  let fixture = (temporary-directory "afl-test")
  try {
    let module = ($root | path join "tests/dist" $"($suite).test.js")
    let entry = (if ($module | path exists) { $module } else { $root | path join "tests/dist" $"($suite).test.cjs" })
    ^node --enable-source-maps $entry $root $fixture ...$args
    let status = $env.LAST_EXIT_CODE
    if $status != 0 {
      error make {msg: $"Test suite ($suite) failed with exit code ($status)."}
    }
  } finally {
    if $suite != "vscode/vscode-e2e" {
      rm --recursive --force $fixture
    }
  }
}
