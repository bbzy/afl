# Tests

Run `npm test` for the standard suites. Tests are grouped by responsibility:

- `language/`: parsing, checking, formatting and language features.
- `project/`: crate discovery, dependencies, presets and implementation associations.
- `cli/`: command output, navigation queries and entry points.
- `lsp/`: editor services, protocol handling and project snapshots.
- `vscode/`: extension integration, highlighting and real-window scenarios.
- `release/`: packaged CLI, skill and extension validation.

`run.nu` preserves the standard suite order; `support.nu` provides temporary
directories. Individual suites can also run with `nu --no-config-file` after
`npm run build`. Use `npm run test:package` for release artifacts and
`npm run test:e2e` for the isolated VS Code window.

`fixtures/` contains focused language and project inputs, rather than user-facing
examples. Parser, formatter, highlighting and project checks cover both these
fixtures and the complete examples in `demo/`.
