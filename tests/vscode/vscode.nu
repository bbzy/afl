use ../support.nu run-test

def main [--extension-root: path] {
  run-test "vscode/vscode" ($extension_root | default "")
}
