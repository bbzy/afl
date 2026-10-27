# AFL skill scope

The [AFL skill](../skills/afl/SKILL.md) documents language rules, project conventions and recommended expression patterns. It does not prescribe a universal conversion or acceptance workflow.

- AFL describes shared business logic across languages; the Agent maintains native code and implementation associations.
- The skill explains syntax, types, documentation, dependencies, crates, impls, presets and core/edge boundaries.
- The Agent chooses description granularity and owns meaning and task-specific execution.
- Single-language code remains native; it does not require an AFL mirror.
- Material inventories, repeated review rounds and target builds are task-dependent, not prerequisites for every use of the skill.

For shared behavior changes, update the corresponding AFL, update affected native implementations and maintain association entries. Native-only refactoring can leave AFL unchanged. See the [language specification](language.md).
