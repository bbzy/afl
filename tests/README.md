# Tests

Run `npm test` for the standard suites. Tests are grouped by responsibility:

- `language/`: parsing, checking, formatting and language features.
- `project/`: crate discovery, dependencies, presets and implementation associations.
- `cli/`: command output, navigation queries and entry points.
- `lsp/`: editor services, protocol handling and project snapshots.
- `vscode/`: extension integration, highlighting and real-window scenarios.
- `release/`: packaged CLI, skill and extension validation.

Test cases, assertions, mocks and helpers live in standalone TypeScript files.
`*.test.ts` contains each suite; `*.cts` is used where a CommonJS host is required
by VS Code or Node's preload mechanism. Tests use Node's strict assertions.
LSP clients and editor hosts remain separate processes where isolation matters.

Nushell only drives execution. `run.nu` preserves the standard suite order, and
`support.nu` prepares temporary directories, invokes compiled suites, propagates
failures and cleans up. E2E artifacts are retained for inspection. The small
`.nu` files preserve existing individual-suite entry points.

`npm run build` compiles and checks test sources through `tests/tsconfig.json`,
with output and source maps in ignored `tests/dist/`. Individual suites can then
run with `nu --no-config-file`, for example:

```sh
nu --no-config-file tests/language/parser.nu
```

Use `npm run test:package` for release artifacts and `npm run test:e2e` for the
isolated VS Code window. Linux E2E requires a display session, such as Xvfb.

`fixtures/` contains focused language and project inputs, rather than user-facing
examples. Parser, formatter, highlighting and project checks cover both these
fixtures and the complete examples in `demo/`.
