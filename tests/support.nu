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
