# Shared counter

`shared/lib.afl` describes one counter contract and implementation. `native/Counter.kt` and `native/counter.py` are independently maintained native implementations. Their project presets point to association files containing separate class and method entries.

Run `afl check demo/implementations --preset kotlin --json` and repeat with `python`. Use `afl trace demo/implementations/native/Counter.kt --line 5 --project demo/implementations --json` for reverse navigation. No native compiler is required to check associations; use each native project's own toolchain to validate actual behavior.
