# Shared language service

`@afl/checker` provides the parser, checker, symbol index, formatter and `LanguageService`. Hosts supply immutable `SourceDocument` snapshots with file URIs and text. The core has no CLI/editor or filesystem dependency. `@afl/checker/node` loads crates, configuration, test specifications and native association snapshots.

`LanguageService.update(documents, context)` reuses unchanged parses and rebuilds the reference index when AFL or context snapshots change. `checkProject` uses the same service, including association validation. The service exposes definition, references, implementations, hover, completion, signature help, document outlines, stable symbol resolution, reverse association trace and current graph impact.

Stable addresses use `afl://<crate-id>/<module.afl>#<Name or Type.member>`. Locals and parameters retain snapshot identity. Explicit AFL references and description links enter the graph; ordinary prose and native text do not.

`CheckContext.associations` contains parsed metadata, selected presets and native snapshots. Node loading resolves paths and watches missing files; the pure core resolves AFL symbols, validates ranges and coverage and joins selected `impl` relationships. Native symbol strings remain opaque. No native signature or semantic inference occurs. See [implementation associations](implementations.md).

The LSP owns discovery, overlays and cancellation. Cached services are published only after an entire asynchronous refresh is confirmed current, preventing discarded loads from mutating visible state. CLI and LSP query the same analyzed snapshots.
