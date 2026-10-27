use std/assert
use ./support.nu temporary-directory

def main [] {
  let fixture = (temporary-directory "afl-test-support")
  try {
    let configured = ($fixture | path join "configured temp")
    let fallback = ($fixture | path join "fallback")
    mkdir $configured $fallback
    with-env {TEMP_DIR: $configured, TMPDIR: $fixture} {
      let first = (temporary-directory "first" $fallback)
      let second = (temporary-directory "second" $fallback)
      assert equal ($first | path dirname) $configured
      assert equal ($second | path dirname) $configured
      assert ($first != $second)
      assert ($first | path exists)
      rm -r $first $second
    }
    with-env {TEMP_DIR: "", TMPDIR: $fixture} {
      let explicit = (temporary-directory "fallback" $fallback)
      let system = (temporary-directory)
      assert equal ($explicit | path dirname) $fallback
      assert equal ($system | path dirname) $fixture
      rm -r $explicit $system
    }
    print "PASS test fixtures: TEMP_DIR precedence, spaces, unique directories and fallback paths"
  } catch {|error|
    rm -rf $fixture
    error make $error
  }
  rm -r $fixture
}
