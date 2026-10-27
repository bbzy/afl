# Run the supported repository suites in their established order.
def main [] {
  for suite in [
    test-support
    project/associations
    language/format
    language/parser
    language/diagnostic-quality
    vscode/highlighting
    language/checker
    lsp/editor
    language/grouped-imports
    language/structs
    language/string-unions
    language/opaque-types
    language/static-constants
    language/for
    language/when
    language/collection-methods
    language/sorting
    language/assert
    language/numeric
    language/description-links
    project/project
    project/project-roots
    project/preset
    project/impl-docs
    project/unsupported
    project/test-specs
    cli/query
    project/symbol-paths
    vscode/vscode-presets
    lsp/lsp
    lsp/lsp-projects
    cli/smoke
  ] {
    ^nu --no-config-file ($env.FILE_PWD | path join $"($suite).nu")
    if $env.LAST_EXIT_CODE != 0 {
      exit $env.LAST_EXIT_CODE
    }
  }
}
