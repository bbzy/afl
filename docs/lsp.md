# AFL editor protocol

The VS Code extension is a thin client of the bundled LSP server. AFL provides diagnostics, definitions, references, implementations, hover, completion, signature help, outlines and formatting. Native implementation locations come from [association files](implementations.md); native languages retain their own language services.

Projects have an empty `[project]` marker. Discovery stays within workspace folders or manually selected roots and respects nested projects. Each project keeps its own preset. `AFL: Select Preset` changes the selection; `No preset` or `AFL: Check Project` clears it and aggregates configured associations for queries. Source diagnostics remain structurally scoped.

Initialize with `initializationOptions: {projects: [{projectUri, preset?}], activeDocumentUri?}` to restore selections before analysis. `afl/projectContext` accepts `{documentUri?}` and returns `{projects, aliases, activeProjectUri?}`. `afl/projectsChanged` publishes the same state after refresh. Directory URIs are canonical and end in `/`; display aliases preserve editor identity.

Execute commands:

- `afl.listPresets`: `[projectUri]`, returns `{presets: [{name, uri, implementations?}], diagnostics}`.
- `afl.checkPreset`: `[projectUri, preset]`, selects and checks that preset.
- `afl.checkProject`: `[projectUri?]`, clears the preset and checks the project.
- `afl.traceGenerated`: `[nativeFileUri, line, column]`, reverses associations using the current editor snapshot. Coordinates are positive and one-based. This existing protocol ID backs **AFL: Trace Implementation**.
- `afl.queryImpact`: `[projectUri, presetOrUndefined, changedFileUri]`, returns current AFL graph impact and associated native/test locations. This backs **AFL: Show Implementation Impact**. No baseline argument is accepted.

Check commands return project state with `selectedProjectUri`, independently of concurrent editor focus. The extension retains its existing command IDs `afl.traceGeneration` and `afl.generationImpact` for keybinding compatibility; these commands no longer perform generation queries.

Open AFL, TOML and associated native snapshots override disk contents. Requests await the latest analysis; superseded asynchronous loads cannot mutate published services. Diagnostics carry open document versions and clear when files leave the selection. Mapping and native edits, file deletion/recreation and preset changes refresh validation and navigation.

Clients should advertise dynamic watched-file registration and relative pattern support. AFL registers `{**/*.afl,**/*.toml}` for roots and shallow `*` watchers for explicit native/missing paths and directory existence. Clients without watcher support must send file events or request another check. Native file contents are never parsed. `textDocument/formatting` is registered only for AFL; TOML and native files are ignored.

Run `tests/lsp/lsp.nu`, `tests/lsp/lsp-projects.nu` and `tests/project/associations.nu` after building. `tests/vscode/vscode-e2e.nu` exercises the installed VSIX in one isolated real window, including cold activation, association navigation, unsaved native snapshots, external file watchers, preset persistence and failure recovery.
