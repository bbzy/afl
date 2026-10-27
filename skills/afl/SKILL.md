---
name: afl
description: Work on business logic shared across multiple native languages using AFL contracts, explicit dependencies, presets and Agent-maintained implementation associations.
---

# AFL shared logic workflow

Use AFL for behavior that needs implementations in multiple languages. Keep single-language code and implementation details in their native projects. Read the language reference in `references/language.md` when installed, or `docs/language.md` in the tool checkout.

1. Locate the shared AFL symbols, selected project presets and their `implementations` TOML files. Inspect associated native code before changing it; AFL alone does not contain native integration details.
2. For shared behavior changes, update the AFL contract/logic first, identify affected implementations with `afl impact`, then update each native implementation. Native-only refactoring can leave AFL unchanged.
3. Write native code directly using its project's conventions. Maintain associations in the same change when symbols/files/ranges move, change or disappear. No templates, scaffolds, target-language backends or generation commands are involved.
4. Run `afl check PROJECT --preset NAME --json` for each affected preset and the relevant native project's build/tests. Check both diagnostics and exit status. A successful AFL check does not verify native syntax, signatures, dependencies or behavior.

A preset may declare `implementations = "android.toml"`, relative to its configuration. Each association file contains entries like:

```toml
[[implementation]]
afl = "afl://shared/cache.afl#Cache.get"
file = "../../android/src/Cache.kt"
symbol = "example.Cache.get"
line = 42
end_line = 68
```

Paths are relative to the association file. Lines are one-based; optional `end_line` is inclusive and defaults to `line`. Native symbol descriptions are opaque. Multiple native locations may map one AFL symbol. Classes, structs, functions and methods in selected production crates and their dependencies require individual coverage in presets with associations; a class range does not cover all its methods. Explicitly accepted unsupported capabilities and their members are exempt. Associated test specification crates may have native mappings but do not require them. Fields and locals need no separate coverage. A selected AFL `impl` connects both sides without duplicate mapping. Never infer correctness from an in-bounds range alone. Read `references/implementations.md` when installed, or `docs/implementations.md` in the tool checkout, for the complete association protocol.

Use `afl implementations FILE --line N --column N --project DIR [--preset NAME] --json` to find native code. `afl trace NATIVE_FILE [--line N] --project DIR [--preset NAME] --json` reverses associations. `afl impact CHANGED_FILES --project DIR [--preset NAME] --json` reports current AFL dependents and native/test locations. It has no historical baseline or native dependency graph; inspect unassociated inputs and limitations.

Keep crate dependencies explicit and one-way. Core must not depend on selected edge crates. Use meaningful shared contracts and explicit `impl` or permitted `unsupported` declarations. Inherit implementation documentation where appropriate; do not duplicate shared behavior descriptions in multiple maintained layers. Use prose when it expresses intent more clearly, and structured names/types/references when the relationship needs checking or navigation.

Preserve existing native code, resources, build files and integration boundaries. Migrate legacy generation configuration to associations without deleting or regenerating old output directories. Old `[codegen]`, `codegen_pack`, `project_dir` and crate generation selections are unsupported.

Install a released CLI with `npm install --global /path/to/afl-cli-VERSION.tgz`. It requires Node.js 22 or newer and bundles runtime dependencies. From a built checkout, use `node packages/cli/dist/afl.js`. Use the shared installed skill and its bundled references for the matching release.
