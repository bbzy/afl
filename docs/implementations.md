# Native implementation associations

AFL describes shared business logic implemented in multiple languages. The Agent reads the shared model, writes native code in each existing project, and records its locations. Single-language implementation details stay in native code. AFL has no target-language parser, compiler, template engine or scaffold manager.

A project preset can opt into associations:

```toml
[project]

[preset.android]
core = ["shared"]
edge = []
implementations = "android.toml"
```

`implementations` is a nonempty relative `.toml` path, resolved against the preset configuration. Crate entries in `core` and `edge` are directory strings. A preset without `implementations` retains ordinary AFL checking, including AFL `impl` coverage for core externs.

```toml
[[implementation]]
afl = "afl://shared/cache.afl#Cache.get"
file = "../../android/src/Cache.kt"
symbol = "example.Cache.get"
line = 42
end_line = 68
```

Each entry requires a stable AFL address, a relative native file path, a nonempty opaque symbol description and a positive one-based line number. `file` is relative to the association file. Optional `end_line` is inclusive and defaults to `line`. Locations span the complete specified lines; queries return zero-based UTF-16 ranges with exclusive character ends. Use `implementation = []` for an empty association file. Unknown fields are errors.

Multiple locations may implement one AFL symbol, including helpers or several native files. Exact duplicate entries are errors. Native files can live outside the AFL project, in any language. Association files never create AFL dependency edges.

Checking validates TOML/schema, unambiguous loaded AFL symbols, readable native files and in-bounds line ranges. A configured preset requires separate associations for classes, structs, standalone functions and methods in its selected crates and their dependencies. A class association alone does not cover its methods. Fields, constants, type aliases, parameters and local variables are not mandatory mappings; locals and parameters do not have stable addresses. Required symbols need a unique `[crate].id`.

The selected AFL `impl` relationship connects contract and implementation associations, including matched methods: mapping either side covers both. An association on an extern without a selected AFL implementation registers a native provider, without claiming signature or behavior verification. Multiple locations remain one provider. An unsupported capability cannot also have a native provider. Explicitly accepted unsupported declarations are exempt from native coverage. Test specification crates may have optional native associations; they are not production coverage requirements.

The Agent must update associations when implementations move, change or are deleted. A readable file and an in-bounds range do **not** prove that the named native symbol exists there or still implements the AFL contract. Native compilation and behavioral tests remain necessary in their owning projects.

## Queries and editing

```sh
afl check demo/implementations --preset kotlin --json
afl implementations demo/implementations/shared/lib.afl --line 4 --column 8 --project demo/implementations --preset kotlin --json
afl trace demo/implementations/native/Counter.kt --line 5 --project demo/implementations --json
afl impact demo/implementations/shared/lib.afl --project demo/implementations --json
```

`implementations` and Go to Implementation return AFL implementations and associated native locations. `trace` reverses associations from a native file, optionally filtering by line; columns are validated but associations have line-level granularity. Overlapping entries can return several AFL symbols. An external native file needs `--project`; otherwise trace searches ancestors for the project marker.

`impact` follows reverse explicit references in the **current AFL graph**, including member ownership and `impl` relationships. Native changes seed associated AFL symbols. Results contain declarations, associated native locations, related test specifications and their optional native locations, diagnostics, limitations and unassociated input paths. They do not identify historical changes, infer native dependencies or assert behavioral equivalence. Unknown paths remain explicitly unassociated; this is not proof that they have no effect.

A selected preset restricts associations. Explicit project queries without a preset aggregate configured associations and label native results with their preset. The editor reads open AFL, TOML and associated native snapshots, watches referenced files including missing paths, and discards stale loads. It does not format or parse native files.

## Migration

`generate`, packs, templates, scaffolds, managed output manifests and `impact --baseline` have been removed. Old `[codegen]`, `codegen_pack`, `project_dir` and object-valued crate selections produce migration diagnostics. Keep native projects and existing outputs intact, maintain code directly and replace generation configuration with association files. AFL neither adopts nor rewrites old output directories.
