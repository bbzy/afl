# AFL CLI

The CLI reads current files on disk. It checks shared AFL logic and optional preset implementation associations without a native compiler or running editor. All commands accept `--json`; use `afl --help` for invocation details.

| Command | Result |
| --- | --- |
| `check [paths...] [--preset NAME]` | AFL diagnostics and selected preset association checks |
| `format [paths...] [--check] [--indent-width N] [--tabs]` | AFL formatting; no dependency traversal or native formatting |
| `symbols [paths...] [--project DIR] [--preset NAME]` | Declarations and members |
| `definition FILE --line N --column N` | Original AFL declaration |
| `references FILE --line N --column N` | Explicit AFL uses; optional `--include-declaration` |
| `implementations FILE --line N --column N` | AFL `impl` and associated native locations |
| `trace NATIVE_FILE [--line N [--column N]]` | Native associations and their AFL declarations |
| `impact CHANGED_FILES --project DIR [--preset NAME]` | Current AFL dependents, native implementations and related test specifications |

Position queries accept `--project DIR` and `--preset NAME`. Without a project, they load the owning crate and dependencies, not all consuming crates. Position queries using a preset require a project. `symbols` accepts positional paths or `--project`, not both. Trace searches ancestor project markers when `--project` is omitted; native files outside the project need it explicitly.

Input positions are one-based; JSON ranges are zero-based UTF-16 with exclusive ends. Association ranges have line-level granularity, so trace validates but does not filter by column. Query results include scope, diagnostics and potentially partial results. Exit codes are 0 for success, 1 for diagnostics or formatting differences under `--check`, and 2 for invocation/I/O errors.

Preset queries restrict associations; explicit project queries without a preset aggregate them. A plain check with no preset checks AFL without requiring native coverage. Trace and impact never modify files. They have no historical baseline or native dependency graph, and valid mappings do not prove native correctness. See the [association protocol](implementations.md).

The `generate` command and generation flags, including `--out`, `--dry-run` and `--baseline`, have been removed. Existing native outputs remain untouched.
