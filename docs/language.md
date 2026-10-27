# AFL language specification

AFL represents business logic shared across multiple native languages. The Agent owns meaning and native behavior; the checker validates AFL structure, explicit relationships and implementation associations. Single-language implementation details stay in native projects.

## Shared logic changes

For shared behavior changes, update the corresponding AFL contract or logic, inspect current dependents and associated native locations, then update each affected implementation and its association entries. Native-only refactoring does not require duplicating implementation details in AFL. The Agent must read the relevant native code and run its native checks; AFL alone cannot prove implementation equivalence.

## Current availability

A crate may declare `[crate]` with `id = "core_ui"`. IDs begin with a lowercase letter and contain lowercase letters, digits, underscores or hyphens; loaded crate IDs must be unique. Named declarations and members have stable `afl://<id>/<module.afl>#<Name or Type.member>` addresses, independent of machine directories, offsets and dependency aliases. Module paths and quoted field names use canonical URI encoding. Locals and parameters retain snapshot identities only.

The CLI checks syntax, documentation, explicit dependencies, AFL signatures and preset completeness. The editor adds navigation, completion, hover, signatures, outlines and AFL formatting. Native associations use saved or open snapshots without native parsing. No templates, scaffolds or generation engine are supported.

Selected core crates must not depend directly or indirectly on selected edge crates. Associations do not grant dependency access or create imports. Scoped AFL references resolve only within the owning crate and its direct dependencies.

## Confirmed function syntax

- Declare functions with `fn name(...)` and `name: type` input parameters. Declare result parameters with `-> name: type`, supporting one named result such as `-> sum: i32` or multiple named results such as `-> sum: i32, msg: string`. Only a single result may omit its name as `-> type`, the anonymous shorthand. Put an implementation, when present, in `{}`.
- Put documentation in a square-bracket block `[...]` after the signature and before the implementation block. The documentation follows the result declarations when present, otherwise the input parameter list. Write fields as `field = [description text]` or `field = r#[raw description]#`, separated by newlines; documentation fields are not body statements.
- Method descriptions use the documentation keyword `desc`; this field is required for methods without an AFL implementation and optional for methods with an implementation. Parameter and return descriptions remain required even when the method has an implementation; explicit impl contracts can supply these through inheritance as described below. Omit the entire documentation block when no documentation fields are required, as for an implemented `main` without parameters or a return value.
- Document input parameters and named result parameters using their actual names, such as `a`, `b`, `sum` or `msg`. An anonymous single result declared with `-> type` uses the documentation keyword `return`. An input or result parameter named `desc` or `return` uses the backtick-escaped field name `` `desc` `` or `` `return` `` to distinguish it from a documentation keyword.
- Backticks mark an ordinary identifier, preserving its name, and can be used in parameter declarations, expression references and documentation field names. Do not wrap documentation field names in double underscores or use `param_` aliases.
- For a method without an AFL implementation, end the declaration after its documentation block and omit the entire implementation block. AFL no longer uses `...` as an implementation marker. This form applies to both ordinary and external methods. An Agent can still generate a target implementation from an ordinary method's documented contract.
- Primitive built-in types require no import or declaration lookup; use the complete list below.
- Newlines separate statements. Function calls can span lines; newlines inside their parentheses do not separate statements.

## Primitive built-in types

The first version includes these 16 primitive built-in types:

| Category | Types | Meaning |
| --- | --- | --- |
| Boolean | `bool` | `true` or `false` |
| Signed integers | `i8`, `i16`, `i32`, `i64`, `i128` | Signed integers with the indicated bit widths |
| Unsigned integers | `u8`, `u16`, `u32`, `u64`, `u128` | Unsigned integers with the indicated bit widths |
| Floating point | `f32`, `f64` | 32-bit and 64-bit floating-point numbers |
| Character | `char` | One Unicode scalar value |
| String | `string` | Unicode text |
| Any | `any` | A value of any type |

- Use these types without `use` imports, project definitions or `extern` declarations.
- Use `any` for parameters, results, properties or local variables whose concrete type is unrestricted.
- Numeric names and bit widths follow the Rust-style scheme, and `char` represents a Unicode scalar value. Preserve the type information when choosing representations in the target language, within AFL's existing syntax, documentation and explicit-dependency checking scope.
- Represent text uniformly with `string`. AFL does not distinguish Rust's `str`, `String` or their ownership forms; choose the concrete target-language representation as part of conversion.
- Leave `isize` and `usize` for platform-layer design. They are not included in the current generic primitive built-ins.
- For a method without return values, omit the entire `->` return declaration. The first version does not introduce `void` or the `()` type.
- Use the collection and nullable types described below.

## Nullable types

- Write `T?` for a value of `T` or `null`. A plain `T` expresses a non-null contract. All type positions support the suffix: parameters, anonymous/named results, properties, locals and collection arguments, including built-ins, defined/external classes or structs and `any?`.
- Put at most one `?` after each complete type. `list<User?>`, `list<User>?` and `list<User?>?` respectively allow null elements, a null list, or both. Nested forms such as `map<string, list<User?>?>?` are supported; `T??` is invalid. Resolve the underlying types and validate their argument counts normally.
- `null` is a built-in literal and reserved word, not a declared type. It needs no import or external declaration. Escape a program entity named `null` with backticks. `any` leaves the concrete non-null type unrestricted; `any?` also allows null.
- Use null in assignments, arguments, initializers, explicit returns and tail expressions. Use `== null` or `!= null` with existing `if` expressions/statements; describe more complex handling as needed.
- Nullability alone does not make parameters or object fields optional. An object field may be omitted when it is marked optional in a struct or declares a default, such as `message: string? = null [desc = [Optional message]]`. No local or named result is automatically initialized to null. Keep required documentation and return arity rules; null is one value, while a no-result function omits `->`. An empty collection is distinct from null.
- Match nullable markers at every level of `impl` signatures, alongside the existing core/edge class correspondence. A mismatch produces `AFL3404`.
- The checker validates structure and explicit dependencies, without general assignment compatibility or control-flow null-safety analysis. A known nullable class still supports member validation, navigation and completion; queries retain the nullable type label. The Agent owns correct null handling in native implementations.
- No safe-call, null-coalescing, forced-unwrapping or default-argument syntax is added.

## Built-in collection types

In addition to the primitive built-ins, the first version provides these three collection types:

| Type | Meaning | Example |
| --- | --- | --- |
| `list<T>` | An ordered list that permits duplicate elements and access by position | `list<i32>` |
| `set<T>` | Unique elements with no specified iteration order | `set<string>` |
| `map<K, V>` | A key-value mapping with unique keys and no specified iteration order | `map<string, i32>` |

- Write type arguments in angle brackets. `list` and `set` each take one element type `T`; `map` takes a key type `K` and a value type `V`, separated by a comma.
- Allow nested collection types and `any` as type arguments, such as `list<any>`, `list<list<i32>>`, `map<string, any>` and `map<string, list<User>>`.
- Collection types themselves are built in and require no import, project definition or external declaration. Resolve type arguments recursively using the existing type lookup rules. For example, `User` in `map<string, list<User>>` must resolve to a definition or external declaration; an unresolved type is a dependency error.
- Represent binary data with `list<u8>` when appropriate.
- Initialize collections with braces as described below, or create them through descriptions. Use the built-in methods below for basic operations; operations that are easier to describe may still use prose.
- Fixed-length arrays, queues and stacks can be added later as needed.

## Built-in collection methods

Use ordinary `receiver.method(...)` calls, with no import or external declaration. Type parameters come from the receiver:

- All three collections: `len() -> i32`, `clear()`.
- `list<T>`: `get(index: i32) -> T`, `set(index: i32, value: T)`, `index_of(value: T) -> i32?`, `contains(value: T) -> bool`, `add(value: T)`, `insert(index: i32, value: T)`, `remove(value: T)`, `remove_at(index: i32)`.
- `set<T>`: `contains(value: T) -> bool`, `add(value: T)`, `remove(value: T)`.
- `map<K, V>`: `contains_key(key: K) -> bool`, `get(key: K) -> V?`, `set(key: K, value: V)`, `remove(key: K)`, `keys() -> list<K>`, `values() -> list<V>`.

Methods without an arrow have no result. List `add` appends; `insert` inserts before a position. Indices are zero-based: get/set/remove_at require `0 <= index < len()`, while insert permits `index == len()`. List remove deletes the first matching element; index_of returns the first position or null. Set add ignores existing elements. Map set inserts or overwrites. Remove does nothing when the element/key is absent; clear removes all contents.

Map get returns null for absent keys, preserving a single nullable marker when V is already nullable. Use contains_key to distinguish absence from a stored null. Keys and values are separate snapshot lists with unspecified order and no promised index correspondence. Structural changes to a snapshot do not alter the map, and later map changes do not update the snapshot; deep copies of object elements are not required. Use `for key, value in mapping` for paired entries.

Give receivers explicit collection types; prose and any do not supply methods. Keep ordinary local declaration rules, e.g. `item: Item = items.get(0)`. Results preserve element, nullable, nested collection and callback types; bound method references also work as callbacks. Methods cannot be overwritten. Square brackets remain descriptions, with no indexing syntax.

The checker validates method existence, argument/result counts and existing initializer/callback contracts, without adding general argument type compatibility checks. The Agent handles bounds, equality, null safety and mutation during iteration. Use for/if with these methods, or prose, for business-condition searches and removals. LSP completion, hover and signature help instantiate method types; built-in methods have no AFL source definitions or source reference locations.

## Callback types and function references

- Use `fn()` for a callback without inputs or results, `fn(i32, string) -> bool` for two inputs and one result, and `fn() -> (i32, string)` for two results. Omit `->` when there are no results; `-> ()` is invalid.
- Function types contain only types, not parameter variables. Describe their input/output meanings, invocation timing and repetition in the containing parameter/property documentation. Actual function declarations retain named parameters, named multiple results and required documentation.
- Function types can appear in every type position, including collections and other callback inputs/results. Parenthesized multiple results delimit the callback signature; they do not introduce tuple values or tuple types.
- Use `fn()?` for an optional no-result callback, `fn() -> string?` for a nullable result, and `(fn() -> string)?` for an optional callback with a result. Parenthesize a complete result-bearing callback type before adding its nullable suffix.
- Pass a declared or defined function by name, including imported aliases. `object.method` is a callback bound to that receiver; only the method's explicit parameters appear in its signature.
- Invoke parameters, locals, properties and expression results with known function types using ordinary calls, such as `handler(1)`, `actions.on_save()` or `create_handler()()`. Untyped prose and `any` do not supply a callable signature. Existing argument/result count and explicit-dependency rules apply.
- When a declared callback type receives a known function or callback value, match input/result counts and types recursively, ignoring parameter names. An incompatible signature or a known non-function value produces `AFL3207`. Match function types inside `impl` recursively, including core/edge class correspondence and nullable markers; mismatches use `AFL3404`.
- Keep the existing semantic boundary: no general expression compatibility, null-safety or dynamic target analysis. Descriptions and null retain their existing treatment; the outer nullable state of callback values is handled by the Agent, while nullable input/result types participate in signature matching.
- Describe closure capture and implementation with existing prose, for example `handler: fn() = [Create a callback that saves the current editor contents]`. There is no anonymous function body or capture-list syntax.
- A function reference navigates to its definition/declaration; calling a callback variable navigates to that variable or parameter, without inferring the eventual runtime target. Signature help and return-member navigation use the declared callback type. Unmarked prose does not create symbol references; explicit description links follow the rules below.

## Simple expressions and lexical rules

Keep expressions and lexical rules simple. Use them to connect inputs, calls and outputs, with basic calculations and conditions. Express complex business processing in description statements and choose implementation detail according to the task.

| Purpose | Supported forms |
| --- | --- |
| Literals | Decimal integers such as `123`, decimals such as `1.5`, strings such as `"text"` or `r#"text"#`, characters such as `'a'`, `true`, `false` and `null` |
| Object and collection initialization | Use `{field: value}`, `{value, value}` or `{key: value}` according to the declared target type, as described below |
| References and calls | `value`, `self.name`, `foo(a, b)` and `obj.foo(a)` |
| Arithmetic | `+`, `-`, `*`, `/`, `%` and unary minus |
| Comparison | `==`, `!=`, `<`, `<=`, `>` and `>=` |
| Logic | `&&`, `\|\|` and `!` |
| Grouping | Parentheses that make combinations explicit, such as `(a + b) * 2` |

- Names use English letters, digits and underscores and must not start with a digit. Apply the existing backtick escaping rule when a name matches a keyword.
- Use ordinary decimal notation for integers and decimals. Program strings use double quotes and characters use single quotes; documentation and description statements retain their established bracketed text forms.
- Ordinary program string and character literals cannot span lines. Their supported escapes are `\n`, `\r`, `\t`, `\0`, `\\`, `\"` and `\'`; description text has its own separate escape rules.
- Use `r#"text"#` for a raw string value, including in property defaults, assignments, arguments, returns and object/collection initializers. Its type remains `string`. For example, `pattern: string = r#"\d+\.\d+"#` preserves the backslashes.
- Both raw strings and raw descriptions start with contiguous `r`, at least one `#` and their opening delimiter: a quote for strings or a bracket for descriptions. End with the corresponding closing delimiter and the same number of hashes. Increase the count when the content contains the terminator, as in `r##"contains "# inside"##` or `r##[contains ]# inside]##`.
- Raw content may span lines and preserves whitespace, indentation and line endings, including CRLF. Do not process escapes, interpolation or bracket nesting. Zero-hash raw forms and whitespace within a prefix are not supported; missing or malformed delimiters are syntax errors. The identifier `r` remains available.
- String contents are opaque text, including keywords, punctuation and apparent calls. A raw string follows ordinary value-declaration rules, including explicit types for new local variables; raw descriptions follow the description rules below.
- Use fixed conventional precedence, from highest to lowest: member access and calls, unary `!` and minus, multiplication/division/remainder, addition/subtraction, ordering comparisons, equality comparisons, `&&`, then `||`. Use parentheses to make complex groupings explicit.
- Newlines separate statements. Function calls may span lines; newlines within their call parentheses do not separate statements.
- Explicit references in expressions must resolve to definitions or declarations under the existing dependency rules.
- Logical negation produces `bool`; unary minus preserves its operand's numeric type. These result shapes do not add general operand compatibility checks or evaluate expressions.

## Description text

- Use bracketed text for every description: the ordinary form `[description text]` or the raw form `r#[raw description]#`. Both forms apply to documentation for functions, classes, properties, input parameters, named results and anonymous results, as well as standalone statements and descriptions on the right side of variable assignments in method bodies.
- Keep the outer documentation block and field names. Write fields such as `desc = [Method description]`, `value = [Input description]` and `sum = [Result description]`; an anonymous single result uses `return = [Result description]`.
- Both forms support single-line and multiline descriptions. Newlines inside description text belong to the text and do not separate documentation fields or statements.
- Write documentation fields using description text. Use `"hello world"` or `r#"hello world"#` for a definite program string value; string literals cannot replace documentation descriptions.
- In ordinary descriptions, unescaped square brackets may nest in balanced pairs. Preserve inner brackets as description text; nesting only determines the outer description boundary. For example, `[Read arr[0]]` contains the text `Read arr[0]`.
- Ordinary descriptions recognize only three escapes: `\[` for `[`, `\]` for `]`, and `\\` for a backslash. Preserve other content literally, so `\n` remains two characters; use actual newlines for multiline descriptions.
- Raw descriptions use `r#[text]#` with at least one hash. Increase matching hash counts to include a shorter terminator, as in `r##[text containing ]#]##`. Preserve unmatched brackets, quotes and backslashes without escape or nesting processing.
- Once inside an ordinary description, retain ordinary bracket nesting even for text resembling a raw prefix. The former `[[[...]]]` form now means an ordinary nested description; migrate old raw descriptions to `r#[...]#` with enough hashes for their content.
- An unclosed ordinary or raw description is a syntax error. To include a raw terminator in the content, increase the hash count on both delimiters.

## Explicit description links

- In ordinary descriptions, write `{@name}` to link a declaration, for example `[Follow the contract of {@show_button}]`. Unmarked prose remains free text and is not searched for dependencies.
- Use visible names/import aliases, relative module paths, `crate::` paths or `dep::` paths, such as `{@dep::core::ui::show_button}`. Qualified paths use the declaring crate's existing dependency mapping; links do not import names or create dependencies from preset membership.
- Link members using `{@Type.method}`, `{@value.field}` or `{@dep::core::ui::Type.method}`. Chained members use declared types; prose does not supply a receiver type.
- Function documentation sees module names, input and named result parameters, and `self` for member methods. Body links follow lexical scope and declaration order. Class, struct and property documentation uses module scope; write `Type.member` for members. A description does not declare bindings, and an assignment's description cannot refer to its newly introduced variable.
- Keep each link on one line. Spaces and tabs around names and `::` or `.` are allowed. Escape keyword identifiers with backticks, e.g. ``{@`return`}``. Links contain symbol paths only, with no calls, operators or type arguments. Malformed, empty or unclosed links produce `AFL1006`; unresolved targets use existing dependency diagnostics.
- Links are indexed references, not calls or implementations. They do not replace `impl` or satisfy preset coverage. Their markers remain in the description text without evaluation or interpolation.
- Raw descriptions (`r#[...]#`) and program strings remain opaque, even when they contain `{@...}`. Use raw descriptions to show literal markers. Ordinary description escapes remain unchanged; a backslash does not escape a link marker.
- CLI/LSP supports definition, references, hover and completion inside explicit links. Implementation queries on linked core externs honor the selected preset. Built-in types/functions and collection methods have hover information but no invented AFL source locations. Ordinary prose and raw text remain outside symbol completion.

## Local variables and results

- When initializing a local variable with an ordinary expression, use `name: type = expression`, such as `result: i32 = a`, without `let`. Ordinary variables are mutable; use `const` for a binding that cannot be reassigned.
- When the right side is a description, the variable type is optional: `adder = [Create an Adder with base set to 10]` or `adder = r#[Create an Adder with base set to 10]#`. This declares the variable if its name is not already declared, or assigns it if it is. An explicit type is also allowed, as in `adder: Adder = [Create the object with base set to 10]`.
- The name outside the brackets introduces the declaration. Do not infer types or dependencies from the prose; other names mentioned inside it do not become declarations.
- Existing variables can be reassigned with `name = expression`. Except for declarations initialized by descriptions as above, assignment targets must resolve to declarations.
- Local variables have block scope and cannot shadow currently visible local bindings, including input and result parameters. Names in separate sibling blocks can repeat. A description-initialized variable or `any` requires an explicit class or struct type before structured member access; do not infer that type from prose.
- Declare multiple receiving variables together with comma-separated `name: type` entries, as in `total: i32, message: string = add_with_message(1, 2)`. Each new variable has its own explicit type.
- Assign results to existing variables with `a, b = foo()`, as in `total, message = add_with_message(3, 4)`. Every receiving variable must resolve to a declaration. Results match receiving variables by position; the receiving names need not match the method's result parameter names.
- Explicit result forms use a single `return`, such as `return a + b` or `return a, b`; a comma-separated result list does not require parentheses. A final expression or expression list, such as `a + b` or `a, b`, can also provide results.
- Named returns support both a single result, `-> sum: i32`, and multiple results, `-> sum: i32, msg: string`.
- Named results are writable result parameters. Their names and types are already declared in the method body by the signature, so assign to or reference them directly without redeclaring them. Callers receive the outputs in signature order.
- Input and named result parameters must have distinct names. Documentation fields must match the declaration: missing required fields, blank descriptions, duplicates and extra fields are errors. Class properties and methods must also have distinct names.
- After assigning named result parameters, end the method body directly. Normal completion returns their current values; no final `sum`, `sum, msg` or `return` is required.
- For either a single named result or multiple named results, use a bare `return` to exit early. It returns the current values of the named result parameters in signature order, without repeating their names after `return`.
- Document each result parameter with its own name in the same square-bracket block as the input documentation, such as `sum = [Sum of the inputs]` and `msg = [Completion message]`. Apply the existing backtick escaping rule to names that match keywords.
- Anonymous returns are shorthand available only for a single result: write `-> type`, document it with `return = [description]`, and provide its value with `return expression` or the final expression of the method body.
- Document named results in their own fields. Do not collect multiple result descriptions in a shared `return` field or use field paths such as `return.first`.

For example:

```afl
fn add_with_message(a: i32, b: i32) -> sum: i32, msg: string [
    a = [First input]
    b = [Second input]
    sum = [Sum of the inputs]
    msg = [Completion message]
] {
    sum = a + b
    msg = "Addition complete"
}
```

## Conditional branches and if expressions

- Write conditional branches as `if condition { ... }`. Parentheses around the condition are optional; braces around branch bodies are required.
- Support consecutive `else if` branches. The final `else` is optional when the conditional is used as a standalone statement.
- Branches can contain variable declarations, assignments and method calls, including assignments to declared named result parameters.
- An `if` can also be an expression in an assignment or variable initializer. The selected branch's final expression supplies the value of the entire `if` expression, as in `x = if a > b { a } else { b }`.
- An `if` used for its value must have a final `else` branch. An `else if` chain alone does not satisfy this requirement. A standalone conditional statement may omit the final `else`.

## Conditional when expressions

- Use `when { condition -> { body } ... else -> { fallback } }` for multiple conditions. Separate branches with newlines; every branch requires `->` and a braced body. At least one branch is required. Conditions use existing expressions, and the first true branch is selected in source order without fallthrough.
- An `else` branch is optional for a standalone statement, but required whenever the result is used, just like `if` (`AFL1004`). It must be unique and last; a when containing only else is valid. Without a matching condition or else, a standalone when does nothing.
- Branch tail expressions provide the result. Reuse existing result-count and expected initializer/callback rules, including multiple results such as `a, b = when { ... }`. Assignments, calls, returns, defaults and collection elements can all use when values.
- Each branch has its own block scope and supports declarations, calls, descriptions and nested control flow. `return` exits the function; `break` and `continue` act on the enclosing innermost loop, not on when. Property defaults still cannot return from a function.
- `when` is a keyword. This is conditional selection, without subject matching, destructuring, case labels or exhaustiveness analysis. The checker validates structure and explicit dependencies, not condition meaning, overlap or reachability. Navigation, references, completion and signature help reuse the same branch scopes as if.

## For collection traversal

- Use `for item in collection { ... }` for `list<T>` and `set<T>`. A list also supports `for index, item in collection { ... }`: the first binding is its zero-based `i32` index, and the second retains the element type. Binding names are freely chosen; a single list binding still receives the element.
- Use `for key, value in collection { ... }` for `map<K, V>`. Lists require one or two bindings, sets exactly one, and maps exactly two. Indexes correspond to list positions; `continue` advances to the next item and its index, without renumbering only the processed items. This adds no destructuring, bracket indexing, range operators or built-in `range`.
- Bindings are declared by `for`; their types come from the collection, without repeated type annotations or separate documentation. They are visible only inside the loop body and follow existing local-name collision rules. Resolve the collection expression before introducing bindings.
- The iterable may be a variable, member, call or expression with a known collection type. Neither `any`, untyped descriptions nor a standalone null literal supplies such a type. Give description-created collections explicit types. List traversal preserves order; set and map traversal have unspecified order.
- Bodies require braces and support ordinary statements, descriptions and nested loops. `break` and `continue` act on the innermost loop; `return` exits the containing function. The `for` statement itself has no value.
- `for` and `in` are keywords; escape same-named entities with backticks. Invalid collection types or binding counts produce `AFL3208`. Loop bindings support CLI/LSP navigation, references and completion. Nullable collection/element contracts remain visible; null handling and mutation during traversal remain the Agent's responsibility.

## While loops

- Write loops as `while condition { ... }`. Parentheses around the condition are optional; braces around the loop body are required.
- Check the condition before each iteration and exit the loop when it is no longer satisfied.
- Use `break` inside a loop body to exit the innermost enclosing loop.
- Use `continue` inside a loop body to skip the remaining statements in the current iteration and check that loop's condition again.

## Natural language statements

- Write a standalone description statement in a method body as `[natural language description]` or `r#[raw description]#`, for example `[Reverse arr]`. Write the text directly inside the brackets, without string quotes or documentation field names.
- The statement describes functionality to perform at that point in the flow. Mix it with declarations, assignments, calls and returns, including inside `if` branches and `while` loop bodies.
- Choose the description granularity needed for the task. When generating a target implementation, turn the described action into code. AFL does not validate the meaning of the text or whether an implementation matches it.
- Use the syntactic position to distinguish bracket forms: a block following a declaration contains documentation fields, standalone text in a method body is a description statement, and a description on the right side of a variable assignment describes its value or how to produce it. Both ordinary and raw descriptions work in these positions.
- The checker checks the statement's syntax boundaries without parsing ordinary prose as identifiers or inferring dependencies from it. Explicit references in structured AFL and `{@...}` links still need corresponding definitions or declarations.
- Description statements are part of an AFL implementation. A method body consisting only of description statements still counts as an implementation: `desc` is optional, while input and result documentation remains required.

```afl
fn normalize(value: i32) -> i32 [
    value = [Input integer]
    return = [A nonnegative integer after processing]
] {
    result: i32 = value
    [Make result nonnegative]
    result
}
```

## Confirmed class and property syntax

- Declare classes as `class Name [...] { ... }`. Place the documentation after the class name and the properties and `fn` member methods inside the braces. A class requires `desc` in its documentation block.
- Declare each property as `name: type [...]` or `name: type = expression [...]` for a default value. Both the type and the property's own `desc` remain required. Place the documentation after the type or default expression.
- Use defaults for structured values, such as `timeout_us: i64 = 10000 [desc = [Timeout in microseconds]]`. Defaults support existing literals, references, calls, simple expressions, nested object/collection initializers and nonempty descriptions. The declared property type supplies the initializer's expected type; the expression must produce one value, and a value-producing `if` requires a final `else`.
- Resolve default expressions in the declaring module, including its imports. They do not implicitly declare `self` or other property variables; `self` belongs to member methods. Branch-local variables retain block scope. A property default cannot contain `return`.
- Defaults are checked even when unused or explicitly overridden. Their AST expressions and explicit dependencies are retained; the checker does not evaluate values or verify general type compatibility or initialization order. Implement the default behavior when generating the target project.
- External properties may also specify default contracts. `impl` matches property names and types without comparing default expressions or requiring both sides to repeat a default; the Agent must preserve the contract.
- A `desc` describes the declaration to which its documentation block is attached. The position after a class name, property type or default expression, or method signature determines that attachment.
- Member methods implicitly declare `self` with the enclosing class as its type. Access properties through expressions such as `self.base`. The implicit `self` needs neither an explicit parameter nor parameter documentation.
- Member methods follow the existing function-documentation rules: `desc` is optional with an implementation and required without one; parameter and return descriptions remain required. Place the documentation after the method signature and before its implementation block.

## Pure data structs

- Use `struct Name [desc = [Data contract]] { ... }` for pure data. Only fields are allowed; there are no methods or constructors. Use `class` for functionality with properties and methods. Existing classes remain supported.
- Declare fields as `name: type [desc = [Meaning]]`, optionally with `= expression` before the documentation. The struct and every field require `desc`; field types are required. Reuse property default expressions, module scope and dependency checks.
- Field names may be identifiers, escaped identifiers or ordinary/raw string literals, such as `"gift-id": string`. Compare decoded names exactly: `name`, `"name"` and `r#"name"#` are the same key and cannot be declared twice. String keys may contain Unicode, punctuation or be empty.
- Distinguish optional presence from nullable values: `note?: string` may be missing; `note: string?` must be present but may be null; `note?: string?` allows both. A field without a default stays missing when omitted; do not silently fill it with null. A declared default applies on omission, including an optional field with a default; an explicit value overrides it. Class properties and function parameters do not gain optional-name syntax.
- Initialize a struct using braces and its declared target type. Keys must be declared field identifiers or string literals, not computed expressions. Reject duplicate keys, unknown keys and missing required fields without defaults. Nest named structs and use the existing collection types. Use `map<string, T>` for runtime keys; use `any` or `any?` when values have no fixed shape.
- Identifier-shaped keys support ordinary member access regardless of their declaration spelling; escape keyword members with backticks. Describe access or modification for other keys such as `gift-id`; no indexing or quoted member-access syntax is added. Navigation and references include literal keys in struct initializers, while dot completion only suggests valid identifiers.
- Structs are named types in every existing type position, including nullable types, nested collections and callback signatures. They follow existing imports, aliases and default export rules. They are not anonymous schemas or automatic JSON validators. Describe serialization and validation expectations; the Agent chooses their target implementation. Keep portable contracts in core and platform-specific data in edge.
- Boundary data can use `extern struct`. A module-level `impl path::Name` requires a same-name ordinary struct, covering every declared field, including optional fields. Match names, types and optional markers; do not compare defaults. Extra edge fields are allowed but are not exposed to core. Struct correspondence applies recursively in signatures; unrelated same-shaped structs do not match automatically. Preset coverage includes each selected core extern struct.
- The checker validates structure and explicit dependencies, without general value type compatibility, missing-field access analysis, ABI or runtime semantics. CLI/LSP outlines distinguish `struct` and `field`; AST structs store fields in `properties`, with `optional` and quoted-name metadata.

## Object and collection initialization

- Initialize objects and collections with braces. Determine the type from existing declarations, such as local variables, named results, properties and collection type arguments. Array examples use the existing `list<T>` type.

| Target type | Initializer form | Example |
| --- | --- | --- |
| An object of a declared class or struct | `{field: value, field: value}` | `adder: Adder = {base: 10}` |
| `list<T>` | `{value, value}` | `numbers: list<i32> = {1, 2, 3}` |
| `set<T>` | `{value, value}` | `names: set<string> = {"Alice", "Bob"}` |
| `map<K, V>` | `{key: value, key: value}` | `counts: map<string, i32> = {"Alice": 2, "Bob": 1}` |

- Separate entries with commas. Trailing commas and multiline initializers are allowed; newlines inside initializer braces do not separate statements.
- Object field names refer to declared properties and follow the identifier and backtick rules; struct keys also support string literals. Map keys are values or expressions; quote string keys using program string syntax, such as `"Alice"`.
- An object initializer must provide each required field without a default; optional struct fields may be omitted. Properties with defaults may be omitted or explicitly overridden, and every field may appear at most once. Missing required, duplicate and unknown fields are errors. Use `{}` for an object with no required fields lacking defaults. Collection checking validates shape and explicit references without evaluating element or key equality.
- Values can use existing literals, explicit references and simple expressions, or nested brace initializers. Determine nested types from the corresponding property or collection type argument, as in `rows: list<list<i32>> = {{1, 2}, {3, 4}}`.
- Use `{}` for an empty list, set or map, distinguished by the target type, such as `names: set<string> = {}`. Initializer braces express field or element values; braces in method-body and control-flow positions remain statement blocks.
- Types, properties and explicit expression references in initializers must resolve under the existing dependency rules.
- AFL does not define constructors or class-name constructor calls. Class declarations continue to describe properties and ordinary member methods.
- Object creation can also use an ordinary or raw description, such as `adder = [Create an Adder with base set to 10]`. This can declare and initialize a variable with an optional type, without a preceding uninitialized declaration. Implement the concrete initialization in the target language.
- Treat `[xxx = yyy]` as description text. The equals sign and names inside it remain ordinary text; do not parse it as an AFL assignment or variable declaration.
- Use `name = [description]` to introduce a variable for the created object or assign an existing variable or named result parameter. Later references in structured AFL must still resolve to declarations or definitions; prose itself does not introduce checker-visible declarations.
- For example, declare a local variable with `created = [Create an Adder with base set to the input base]`, then use `adder = created` to assign a named result declared by `-> adder: Adder`.

## Confirmed external declaration syntax

- Use `extern class Name [...] { ... }` for external classes and `extern fn name(...) [...]` for standalone external functions, placing any return type before the documentation block. `extern` marks a boundary outside the current AFL description scope.
- External classes reuse ordinary property and member-method syntax. Their members inherit external status without repeating `extern`.
- Every external method, including a member of an external class and a standalone `extern fn`, consists only of its signature and documentation block and must omit the implementation block.
- Use the same square-bracket documentation blocks and field rules: classes and properties require their own `desc`; external methods require `desc` and a corresponding description for each parameter and return value.
- Every referenced external type or member must have a matching declaration. An external class declaration does not implicitly declare arbitrary members.
- An absent implementation does not make an ordinary method external; external status comes from `extern` on the function or its enclosing class.

## Module paths and imports

- An ordinary `.afl` file forms a module named after the file without its extension, such as `math.afl` forming the module `math`.
- Use `use path::symbol` at file level to import a function or class. Ordinary relative paths start from the importing file's directory and can refer to files alongside it or descend into subdirectories.
- Write directory levels explicitly with `::`. For example, `use math::add` refers to `add` in the current directory's `math.afl`, and `use features::report::calculate` refers to `calculate` in its `features/report.afl`.
- Prefix a path with `crate::` to start from the current crate's root directory, such as `use crate::math::add`. Files in subdirectories can use this form to reference other modules in the same crate.
- Both forms resolve downward from their respective starting points. Do not use `super` or `..` to navigate upward. Resolution is independent of the CLI's working directory.
- Without an alias, use the imported symbol's original name directly, such as calling `add(1, 2)` or using an imported class name in a type position. Use `as` to choose an alias as described below.
- Each import must resolve to a module and a corresponding symbol definition or external declaration. A missing module or symbol is a dependency error.
- These path forms describe imports within one crate. Use the `dep::` form below for imports from other crates.

## Dependency imports

- Use `use dep::dependency_name::module_path::symbol` to import a function or class from another crate, such as `use dep::core::math::add`.
- The `dep::` prefix identifies the dependency namespace. Each dependency name must be explicitly mapped to one crate; do not infer it from directory names.
- Resolve the module path after the dependency name downward from the target crate's root. The example imports `add` from `math.afl` in dependency `core`'s root, after which `add` can be used directly.
- An undeclared dependency, a dependency that cannot be located as a unique crate, a missing module or a missing symbol is a dependency error.
- Resolve dependency names through the owning crate's `config.toml` using the configuration rules below.

## Import aliases and top-level name collisions

- Use `use path::symbol as alias` to choose the importing file's name for a function or class, such as `use dep::core::math::add as core_add`.
- Ordinary relative paths, `crate::` paths and `dep::` paths all support `as`.
- Without `as`, an import introduces the symbol's original name. With `as`, that import introduces only the alias; call the example with `core_add(1, 2)`. Aliases apply only within the importing file and leave the source module's symbol name unchanged.
- Every file-level name must be unique, including imported names and functions, classes or structs defined or declared in the file. Report collisions between imports, between an import and a local definition or declaration, and between file-level definitions or declarations.
- Check collisions using the name introduced into the current file: the alias when `as` is present, otherwise the original symbol name. Import symbols with the same original name from different modules under distinct aliases.

## Default exports

- Functions and classes defined or externally declared at file level are exported by default. Import them from other files or crates through module paths without an export list or visibility modifiers.
- Declared class properties and methods are accessible by default. AFL does not distinguish public, private or protected access levels.
- `lib.afl` identifies a library crate and can directly define functions, classes and structs. Keep `lib` in the module path when referring to its symbols, such as `use dep::core::lib::add_three`.
- Definitions in other library modules are also exported by default. For example, `use dep::core::math::add` directly imports `add` from `math.afl` without requiring it to be listed in `lib.afl`.
- Apply the existing import and dependency rules: introduce names with `use`, and reference other crates through explicitly configured `dep::` paths. Explicit references must resolve to definitions or declarations, and file-level names must remain unique.

## Crate configuration

- Give each crate its own `config.toml` in the crate root. All modules in that crate use this configuration.
- Use a TOML `[dep]` table mapping dependency names to string paths of target crate roots. A crate without dependencies can keep an empty `[dep]` table.
- Resolve relative paths from the directory containing that `config.toml`, independently of the CLI's working directory. Configuration paths may use `..` to locate other crates; AFL `use` module paths still resolve downward from their designated starting points.
- Keep dependency mappings local to each crate. Do not inherit them from the project container or a consuming crate. When following references into a dependency crate, resolve that crate's `dep::` imports using its own `config.toml`.
- Require each crate's `config.toml`; an absent `[dep]` table means no dependencies. Dependency names must be AFL identifiers and paths must be nonempty strings. Reject crate dependency cycles; mutually importing modules are allowed because declarations are collected before resolving imports. Imported names are not automatically re-exported definitions.
- An unconfigured dependency name, an invalid path or a target directory that violates the crate layout rules must produce a checker error.
- Configuration does not establish the crate type. Continue to use `main.afl` or `lib.afl` to identify the root and type.

For example, `app/config.toml` can reference a crate alongside `app`:

```toml
[dep]
core = "../core"
```

Files in `app` can then use `use dep::core::math::add`.

## Test specifications

Describe what needs testing in ordinary AFL: scenarios, inputs, boundary conditions and expected outcomes. Use existing functions, calls and descriptions; there is no test keyword, special test method type or AFL test runner.

Associate the specifications in the tested crate's own `config.toml`:

```toml
[test]
crates = ["../tests/core-behavior", "../tests/core-boundaries"]
```

- The containing crate is the tested object. The `[test]` table contains only `crates`, a list of test specification crate paths relative to this configuration. An omitted table or an empty list is valid; a present table requires the list.
- Each nonempty string must resolve to a valid, non-nested crate root outside the tested crate. Reject self-links, conflicting entries and duplicate canonical paths, including aliases. Specifications are ordinary crates, commonly using `lib.afl`; no `core-test` or `edge-test` type is needed.
- Directly selected crates load their specifications and those specifications' configured dependencies for checks and queries. A selected source file selects its owning crate; a directory selects the crates found by its scan. A preset directly selects its listed core and edge crates.
- Crates loaded only as dependencies or specifications do not automatically expand or validate their own `[test]` associations. Select such a crate directly to check its test configuration. Ordinary TOML and dependency checks still apply.
- An association does not import symbols or create a dependency edge. A specification calling its tested crate still needs its own `[dep]` and `use`. That normal dependency back to the tested crate does not make the test association a dependency cycle.
- Presets continue to select core/edge combinations, with test requirements belonging to each crate independently. Specification crates are not automatically given core or edge roles; their external declarations do not create additional preset coverage obligations.
- The checker validates configuration, syntax, documentation and explicit dependencies. It does not execute tests, assess coverage or interpret expected outcomes. Use the descriptions at the granularity appropriate to the task.

## Built-in assertions

Use predeclared `assert(condition: bool)` for expectations that fit an expression:

```afl
fn addition_examples() {
    result: i32 = 2 + 3
    assert(result == 5)
}
```

- No user definition, import, dependency mapping, extern declaration or impl is needed. A false condition means assertion failure and must fail the current test when used in a test. Implement the appropriate native or test-framework assertion; AFL does not execute it or decide test success. Keep complex expectations in ordinary descriptions.
- This is a function with exactly one argument and no result, available in every AFL module without requiring a `[test]` association. There is no new keyword, type, test runtime or preset coverage requirement. Use existing calls, including multiline calls. There is no message argument or `assert_eq` variant; express equality in the condition.
- Ordinary visible locals, module definitions and imports take precedence over the built-in name. Object members named `assert` remain ordinary members. Built-ins are not module exports and cannot be imported through a module path.
- The function can be passed or stored as `fn(bool)` and follows existing callback checks. Argument/result counts and explicit references are checked. General value-type compatibility and condition evaluation remain outside the checker; preserve the boolean contract when generating code.
- LSP provides function completion, hover and signature help. The built-in has no source definition or source reference locations, and does not appear in document symbols. References inside conditions and calls through callback variables retain ordinary navigation.

## Project roots

An AFL project root has an empty `[project]` table in its `config.toml`. The marker has no fields. It identifies a project independently of its presets and crate entry files: a project may have no presets, contain several crates, or itself be one crate. Keep top-level settings such as `preset_dir` before all TOML table headers.

Preset operations, explicit CLI `--project` queries and editor project operations require this marker. Add `[project]` to existing project configurations to migrate them. Ordinary file, crate and selected-path checks remain available without a marker. A missing or nonempty marker produces `AFL4003`; malformed TOML produces `AFL4001`.

Projects may nest. A project's ordinary source scan excludes nested project roots; explicit dependencies and preset selections may still reference their crates. This does not permit nested crates. VS Code discovers marked roots only within opened workspace folders, never by ascending beyond them. Manually chosen external roots establish additional discovery boundaries. The nearest marked root owns a file. Project discovery reads configurations; analysis is loaded when a project is used. Unsaved configurations participate, and an already recognized boundary is retained during incomplete TOML edits.

## Project presets

- Use the project root's `config.toml` to select core/edge combinations. Keep each crate's own `config.toml` and `[dep]` mappings; a preset neither creates a crate nor changes its entry-point rules.
- Define an inline preset with `[preset.name]`. Optionally set a top-level `preset_dir` to load standalone preset files as well. Each standalone file contains the preset fields directly and takes its name from the filename without `.toml`.
- Resolve every path relative to the TOML file containing it. Scan only `.toml` files directly inside the configured preset directory, without recursion. An absent `preset_dir` means no directory discovery; a missing configured directory, unreadable file or invalid content is an error.
- Require unique names across inline and standalone presets. Reject duplicates instead of applying precedence. Standalone files cannot define further presets or a `preset_dir`; the first version has no inheritance, overrides or default selection.
- Each preset has `core` and `edge` lists of valid crate-root paths. Require at least one core crate; edge may be empty when no external capability needs adaptation. Reject duplicate crate selections and a crate appearing in both roles within one preset. Other presets may reuse those crates. Roles come from these lists, not directory names.
- Preset membership does not import symbols, add dependency mappings or make crates inherit root dependencies. Keep existing `use` and per-crate `[dep]` rules.

For example, root `config.toml` can contain:

```toml
preset_dir = "presets"

[project]

[preset.android]
core = ["core"]
edge = ["edge-android"]
```

The same project's `presets/ios.toml` can contain:

```toml
core = ["../core"]
edge = ["../edge-ios"]
```

Unless the preset explicitly permits an unsupported capability difference as described below, the completeness check validates selected crates and their configured dependencies, then requires every external capability of the selected core crates to have one provider: a selected AFL edge implementation with a matching AFL signature, or a registered native association. Native signatures are not checked. Missing, duplicate or incompatible implementations are errors. Standalone crate checks still allow bodyless extern boundaries, and edge SDK declarations remain external endpoints. Use `impl` to identify implementations of standalone extern functions, external classes and external structs, including class/struct correspondence in signature matching. Preset membership alone does not establish implementation relationships.

## Native implementation associations

A preset can set `implementations = "android.toml"`, relative to its declaring configuration. The optional association file maps stable AFL symbols to native files, opaque symbol descriptions and one-based line ranges. See the [association protocol](implementations.md) for schema, coverage and migration details.

```toml
[[implementation]]
afl = "afl://shared/cache.afl#Cache.get"
file = "../../android/src/Cache.kt"
symbol = "example.Cache.get"
line = 42
end_line = 68
```

`file` is relative to the association file; `end_line` is inclusive and defaults to `line`. Unknown fields, unresolved AFL addresses, unreadable files, invalid ranges and exact duplicate entries are errors. A configured preset requires classes, structs, standalone functions and methods in selected crates and dependencies to have associations. Fields, constants, type aliases and locals do not require separate coverage. Selected `impl` contracts and implementations share coverage; native associations can register extern providers. Conflicting unsupported/provider combinations remain errors. Multiple locations remain one native provider.

A native association verifies neither the existence/signature of the opaque native symbol nor behavioral consistency. The Agent maintains mappings and validates native code using its own toolchain. No hash manifest or historical snapshot is maintained. Plain presets without association files retain ordinary AFL checks.

`extern type ThreadIdentity [desc = [Thread identity]]` describes an opaque platform type. It cannot be constructed, implemented with AFL `impl` or marked unsupported. Native type choices remain the Agent's responsibility.

## Implementation declarations

- At edge module level, write `impl path::symbol` to declare that this module provides an implementation of the referenced external declaration. For standalone functions, the target must be an `extern fn`, not an ordinary function.
- Resolve the path using existing module rules. A `dep::dependency::module::symbol` path uses the edge crate's own `[dep]` mapping; preset membership does not replace it.
- Require a same-original-name ordinary function in the current module, with corresponding input and result counts, order and types. Parameter and result names may differ; each declaration's documentation must match its own names.
- `impl` does not import a local name, so it does not collide with the ordinary function and needs no `as` alias to avoid a collision. Continue using `use` for ordinary dependency usage.
- The ordinary implementation follows existing function rules and may contain an AFL body or only a signature and documented contract for native implementation. An external declaration cannot serve as this ordinary implementation.
- The `impl` path identifies the external declaration being implemented. Do not infer this relationship from prose, import aliases or globally matching names. Declaration and implementation modules need not have the same path.
- Preset checks require one provider per core external capability unless it is explicitly accepted as unsupported. A provider can be a selected edge's AFL `impl` or a registered native association. AFL implementations must match the contract signature; native signatures are not checked. Standalone crate checks validate written impl targets, structure and signatures without requiring every core capability to have an implementation. These checks do not validate semantic equivalence.
- External classes, members and custom types in signatures follow the matching rules in the next section.

For a core `ui.afl` declaring `show_button(label: string, position: string)`, the edge design is:

```afl
impl dep::core::ui::show_button

fn show_button(label: string, position: string) [
    label = [Button text]
    position = [Description of the button position]
] {
    [Create an Android button and place it according to position]
}
```

## External class implementations

- Reuse a module-level `impl path::ClassName`. The target must be an `extern class`; require a same-original-name ordinary `class` in the current module. Another external class cannot serve as its implementation.
- Cover every property and method declared by the external class. Match members by name, independently of declaration order, and require the same member kind: property to property, method to method.
- Require corresponding property types and method input/result counts, order and types. Parameter and result names may differ, with documentation matching each declaration's own names.
- When matching function or method input/result types and property types, treat references resolving to the same type definition or declaration as the same type, regardless of import aliases. Also recognize a core external class and its edge implementation class linked by `impl` in the selected preset as corresponding types. No additional type mapping syntax or configuration is needed.
- Match collections recursively by collection kind and type arguments; for example, element types in `list<Button>` use the same class correspondence. Do not match independent class declarations solely by name or member structure.
- Match built-in signature types by name, including `any`; do not apply implicit numeric conversions or use `any` to replace a different declared signature type.
- Allow extra implementation properties and methods for platform details. Core can rely only on members in its own external declaration; completeness checking does not expose the edge class's additional members to core.
- One class-level `impl` covers the entire class and its members. Do not introduce per-member `impl` declarations or split one external class's implementation across modules.
- A core external class can be provided by a selected edge's AFL implementation class or registered native associations, or explicitly accepted as unsupported. For an AFL implementation class, report missing members, mismatched member kinds and incompatible signatures. Native associations require class and method coverage but do not validate native members or signatures. Report missing or conflicting providers at preset level.
- Ordinary implementation methods may have an AFL body or only a signature and required documented contract. External methods remain bodyless. These rules add no behavior validation, natural language analysis or general expression type checking.

For example, an edge module can write `impl dep::core::ui::Button` and define an ordinary `class Button`. If the external class declares `text: string` and `show(position: string)`, the implementation must provide both; it may additionally declare `native_view: any` and describe using that object to display the button. A core `create_button() -> Button` returning the external class and its edge implementation returning the local class have corresponding return types through that same `impl`.

## AFL crates and entry points

- A directory outside every existing crate can be a crate root. Identify its crate type by the entry files directly inside it, regardless of the directory's name.
- A directory containing `main.afl` without `lib.afl` is an executable crate root. Its entry function is `main` in `main.afl`.
- A directory containing `lib.afl` without `main.afl` is a library crate root. Reference definitions in `lib.afl` and its other modules using the default export rules.
- If a directory contains both `main.afl` and `lib.afl`, it has a crate type conflict that the checker must report as an error. Do not select one entry or accept both crate types in that directory.
- A directory containing neither entry file is not itself a crate root. Inside a crate it can organize modules; outside every crate it can serve as a project container.
- Crates must not nest. If a subdirectory at any depth beneath a crate root contains `main.afl` or `lib.afl`, the checker must report a nesting error rather than treat that directory as another crate.
- All ordinary `.afl` modules within a crate belong to the same root, and every module's `crate::` refers to that unique root.
- A project container outside every crate and without either entry file can organize multiple crates whose roots do not contain one another, such as `app/main.afl` alongside `core/lib.afl`.
- `bin/` and `lib/` are ordinary directory names. They do not determine artifact types or constrain where crates may be placed.

## Core and edge conventions

- `core` expresses common functionality and external capabilities independently of a specific language or platform. `edge`, also written in AFL, supplies the language/platform adaptation.
- Core declares a boundary capability with a bodyless `extern fn` or `extern class`. Edge provides an ordinary `fn` or `class` and identifies the external declaration through `impl`. Its descriptions and control flow explain the adaptation.
- `use` introduces a dependency for use; `impl` declares an implementation relationship; a preset selects a core/edge combination. These have distinct roles, as defined above.
- SDK declarations can remain external endpoints. Explicit calls and type references must resolve to AFL definitions or declarations; operations mentioned only in prose do not create dependencies. Real SDK compatibility is outside the AFL checker's scope.

## Recommended usage

- Use structured signatures, types and references for relationships that should be navigable and statically checked. Use descriptions for actions that are easier to express in words. Choose detail according to the task; AFL imposes no fixed description granularity.
- Give a description-created value an explicit class or struct type when later code needs structured member access or member completion. Neither prose nor `any` supplies inferred members.
- Use external declarations to express the chosen boundary of an AFL project. A boundary does not require recursively representing the external library or SDK implementation.
- Keep core capabilities meaningful across platforms; place platform API choices and adaptation details in edge. Renaming a platform-specific operation alone does not make the capability platform-independent.
- Use ordinary crate checks while working on standalone crates, and select a preset when checking a particular core/edge combination. Interpret success within the checker's structural scope.

## Checking

### Formatting

Use `afl format <files-or-directories>` for AFL, or `--check` to report differences without writing. `--indent-width 1..16` defaults to four spaces; `--tabs` selects tabs. CLI and editor formatting share the same core. Formatting preserves descriptions, raw text, literals and parse structure; invalid syntax cancels writes. Traversal skips dependency/build directories and nested symlinks, and does not follow AFL dependencies. Native files and TOML are not formatted.

Use the `afl` command installed from the CLI npm package:

```text
npm install --global /path/to/afl-cli-<version>.tgz
afl check <selected-paths...> --json
afl check <project-directory> --preset <name> --json
```

The CLI requires Node.js 22 or newer and bundles runtime dependencies. Ensure the installed command is on the Agent's PATH. The VS Code extension includes its LSP server; no separate LSP package is needed.

For a source checkout, build this tool repository first, then invoke its CLI from any working directory:

```text
node <afl-tool-root>/packages/cli/dist/afl.js check <selected-paths...> --json
```

The selected files' complete owning crates and configured dependencies are checked. Use structured diagnostics and exit code together: 0 means completed AFL checks without errors, 1 means AFL errors, and 2 means invalid input or I/O failure. Diagnostics identify syntax, documentation, name, member, initializer, dependency, impl and preset errors. Call and result counts are checked; general expression type compatibility, definite assignment and behavior remain the Agent's responsibility.

## Symbol queries

The same CLI exposes the LSP's shared symbol index without starting a server:

```text
afl symbols <selected-paths...> --json
afl definition <file.afl> --line N --column N --json
afl references <file.afl> --line N --column N --project <directory> --json
afl implementations <file.afl> --line N --column N --project <directory> --preset <name> --json
```

- Position queries select a symbol by its source position; inputs are one-based lines and UTF-16 columns. JSON ranges are zero-based, with exclusive ends, matching LSP diagnostics. Add one to a JSON line/character when passing it to `--line`/`--column`.
- Without `--project`, position queries cover the file's owning crate and configured dependencies. To find uses in consuming crates, select a directory containing those crates with `--project`. File arguments remain relative to the working directory. Position queries with `--preset` also require `--project`; `symbols` accepts a project directory and `--preset` directly.
- JSON includes `scope` (inputs, indexed files, crate roots, preset and test associations), `results` and `diagnostics`. `scope.tests` contains `{target, crates}` associations using absolute paths; indexed files include loaded specifications. Location results contain `uri`, absolute `path`, `range` and source-line `text`. Symbols also contain names, signatures, full declaration ranges, name `selectionRange` and nested `children`.
- `references` includes explicit reads, writes, imports, aliases, impl paths and parameter documentation field names. Add `--include-declaration` to include the original declaration. Explicit `{@...}` links in ordinary descriptions are indexed. Unmarked prose, raw descriptions and ordinary value literals are not indexed as references; declared string field names and literal keys in struct initializers are indexed.
- Queries use saved files. Exit code 0 includes an empty result; 1 reports AFL errors with potentially partial results; 2 reports invocation or I/O failure. Read scope and diagnostics when interpreting results. Source text remains the place to understand descriptions and behavior.

## Repairing diagnostics

Fix the reported structural error before investigating dependent errors. A mismatched method-body closer identifies the opening brace through related information. Member methods provide `self` implicitly; omit it from the parameter list. An `impl` does not require importing its same-named external target; remove an unnecessary `use`, or alias it when you separately need that external name. Missing-documentation diagnostics show the exact field form to add.

## Inherited implementation documentation

Explicit implementations may omit documentation fields supplied by the implemented extern. Local fields override inherited fields; inputs and results map by position and class/struct members map by name. Added members still need their own documentation. This also applies to bodyless ordinary implementations. Keep platform-specific behavior in local descriptions. Multiple distinct extern targets for one local implementation require explicit documentation to avoid choosing an ambiguous source. Signature matching remains required. Inherited links resolve at their original declarations and are not copied into the implementation source. Full project checks resolve inheritance; parsing alone defers missing-field checks for impl candidates.

## String literal unions

Declare finite string contracts with `type Mode = "camera" | "image" | "video"`, optionally followed by `[desc = [...]]`. Values are distinct ordinary/raw string literals. These types support imports, aliases, nullable markers, collections and signatures. This is not arbitrary type aliasing or a data-carrying enum.

Known literals and union values are checked in assignments, initializers, arguments, results and equality comparisons; `AFL3209` lists allowed values. Runtime strings, any, descriptions and unknown expressions still require Agent validation. Impl signatures compare allowed sets and nullable markers. Keep state/mode/log-level contracts in core when they are platform independent. Type declarations have navigation and hover; their strings are values, not separate member symbols.

## Numeric operations

Use predeclared `min(a, b)`, `max(a, b)` and `abs(value)` for numeric values; they preserve the numeric type. min/max require the same numeric type for explicitly typed operands. Integer literals, including negative and parenthesized literals, can use the operand/context type; decimal literals can use a floating-point operand/context type. `round(value)` returns f64 rounded to the nearest integer value, with exact halves away from zero. `to_int(value)` returns i64 truncated toward zero; require finite input and a representable result. `to_float(value)` explicitly converts to f64.

`/` means f64 division even for integer inputs: `5 / 2` is 2.5. Use `to_int(a / b)` for truncating integer division. `%` uses a quotient truncated toward zero; a nonzero remainder has the dividend's sign. Implement these contracts explicitly when the target language differs. AFL checks known operand kinds and argument counts but does not calculate values, execute assertions or verify overflow/zero-divisor conditions.

## List sorting

Use `items.sort()` for stable ascending sorting in place, or `items.sorted()` for a new sorted list. Natural ordering requires non-null numbers, characters or strings (including string unions). For objects use `items.sort_by(key)` or `items.sorted_by(key)`, where an existing function/callback has type `fn(T) -> K` and K is a non-null numeric, character or string key. Equal keys retain source order. Strings compare by Unicode scalar order without locale collation. These operations are ascending; express other ordering policies in descriptions. set/map have no sorting methods.

## Grouped imports

Use `use crate::frames::{NativeFrame, FrameSource as Source}` to import several symbols from one module. Multiline groups and a trailing comma are allowed. This is equivalent to separate use declarations, with the same dependency and name-conflict checks. Groups contain direct symbols only: no nested groups, wildcards, empty groups or grouped impl declarations.

## Unsupported platform capabilities

An edge may declare an explicit capability difference without placeholder classes:

```afl
unsupported dep::core::panel::ControlPanel [
    desc = [This platform has no interactive panel]
    fallback = [Do not instantiate the panel or register its callbacks; keep processing without interactive controls]
]
```

Both fields are required. This resolves an existing extern function/class/struct and preserves dependency checks. The preset must explicitly permit it with `allow_unsupported = ["core/panel.afl::ControlPanel"]`; the source file path is relative to that preset TOML and must be in a selected core. No wildcard permissions are supported. Without permission the preset remains incomplete. Conflicting impl/unsupported providers are errors. An accepted difference appears as informational `AFL4103`, not a fake implementation. Ordinary crate checks validate the declaration without requiring a preset. Implement the documented fallback; AFL does not prove calls are guarded or turn unsupported capabilities into silent no-ops.


## Static properties and constants

Use `static count: i32 = 0 [desc = [Shared count]]` inside a class for shared mutable state. Ordinary classes require an initializer; extern classes may omit it. No module mutable variables, local static declarations or static methods are introduced.

Use `const NAME: type = expression` at module level, in classes or in local blocks. Each declaration introduces one explicitly typed, initialized binding. Module/class constants require desc documentation; local constants have no declaration documentation block. Class constants are automatically shared: do not write static const. Structs remain instance data only. Escape const/static as identifiers with backticks.

Const forbids reassignment of the binding, including aliases imported through use/as, multiple assignment targets and prose assignment (AFL3212). It does not require compile-time evaluation or deep-freeze objects/collections. Existing calls, initializers and descriptions are allowed. Mutating an object's properties or calling collection mutation methods does not rebind the constant.

Access class shared members through Type.member; access instance members through an object or self (AFL3213 for wrong receivers). Shared members are excluded from object initializer fields and cannot be overridden there. Description links Type.member still navigate any declared member. Module constants export normally; local constants follow declaration order and existing block scope rules. Initializers of module constants and class members use module scope without self. The Agent owns initialization order, cycles, concurrency and lifetime.

Extern classes can declare static properties and initialized constants. Impl compares static/const markers alongside property types and optional markers (AFL3404), without comparing initializers. No extern const declaration is added. CLI/LSP expose constant symbols and const/static signatures, with type/instance-aware completion and ordinary navigation.

## Trace and impact

`afl trace NATIVE_FILE [--line N [--column N]] --project DIR [--preset NAME] --json` resolves native locations back to AFL. `afl impact CHANGED_FILES --project DIR [--preset NAME] --json` follows current explicit AFL references and returns native/test locations to inspect. No preset means aggregate configured associations. Impact cannot infer native dependencies, historical deletions or semantic effects. Unassociated inputs are reported explicitly. See the [association protocol](implementations.md).
