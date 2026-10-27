# Agent Friendly Language

AFL is an Agent-readable intermediate representation for business logic shared across languages. It combines structured contracts, explicit dependencies and natural-language descriptions. Use native code directly for work that needs only one language.

The Agent implements shared logic in each native project and maintains an association file linking AFL symbols to native files, symbols and lines. The checker validates AFL structure and association coverage. It does not parse native languages, generate code or prove behavioral equivalence.

```sh
npm ci
npm run build
npm run afl -- check demo/implementations --preset kotlin --json
npm run afl -- trace demo/implementations/native/Counter.kt --line 5 --project demo/implementations --json
npm run afl -- impact demo/implementations/shared/lib.afl --project demo/implementations --json
```

Development requires Node.js 22+, npm and Nushell. The CLI release bundles runtime dependencies. The VS Code extension bundles its LSP server and supplies diagnostics, navigation, completion, hover, signatures and AFL formatting.

```afl
fn add(a: i32, b: i32) -> sum: i32 [
    a = [First operand]
    b = [Second operand]
    sum = [Sum of the operands]
] {
    sum = a + b
}
```

Bodyless functions can describe behavior in documentation. Structured references and explicit `{@symbol}` description links are checked; unmarked prose remains the Agent's responsibility. AFL supports classes, structs, collections, nullable values, callbacks, imports, core/edge presets and test specification crates.

A project has an empty `[project]` marker in its root `config.toml`. A crate has its own configuration and one `main.afl` or `lib.afl` entry. Selecting crates in a preset does not create dependencies; each crate declares its own `[dep]` entries. Stable symbol addresses use the crate's unique `[crate].id`.

Read the [language specification](docs/language.md), [association protocol](docs/implementations.md), [CLI guide](docs/cli.md), [formatting guide](docs/formatting.md) and [editor protocol](docs/lsp.md). The [multilanguage example](demo/implementations/) contains independently maintained Kotlin and Python implementations.

Templates, scaffolds and deterministic code generation have been removed. Existing native projects and old generated outputs remain the owner's files; AFL does not modify them. See the [migration notes](docs/implementations.md#migration).

Run `npm test` for core, CLI and protocol tests, `npm run package` for the CLI archive, VSIX and AFL skill, and `npm run test:package` for artifact validation. `npm run test:e2e` tests the installed VSIX in one isolated VS Code window, reloading for cold activation and persistence scenarios. `npm run release` runs the complete release checks.
