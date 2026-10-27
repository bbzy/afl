# AFL formatting

`afl format PATH` formats AFL files. `--check` reports differences without writing; `--indent-width N` accepts 1..16 spaces (default 4), and `--tabs` selects tabs. Editor Format Document and format-on-save use the same formatter and editor indentation settings.

Formatting preserves descriptions, raw text, literals and parse structure. Syntax errors cancel writes. Directory traversal skips build/dependency directories and child symbolic links, does not load AFL dependencies, and ignores non-AFL files. Explicit symbolic links are rejected. The CLI validates selected snapshots before publication, preserves permissions and checks file identity to prevent replacements from redirecting writes.

Native files, TOML and former `.tpl` templates are not formatted. Template syntax and formatting have been removed.
