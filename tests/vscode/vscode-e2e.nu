use ../support.nu run-test

def main [--vscode-executable: path] {
  run-test "vscode/vscode-e2e" ($vscode_executable | default "")
}
