# AFL diagnostics

Diagnostics contain `uri`, `code`, `severity`, `message` and `range`. JSON positions are zero-based UTF-16; CLI text positions are one-based.

| Code | Meaning |
| --- | --- |
| AFL1001 | Invalid character, unclosed text or invalid literal, including malformed raw boundaries |
| AFL1002 | Missing token or statement separator |
| AFL1003 | Invalid syntax combination or excessive nesting, including empty when or duplicate/nonfinal else |
| AFL1004 | Value-producing if/when lacks a final else |
| AFL1005 | break or continue outside a loop |
| AFL1006 | Empty, unclosed or malformed description link; links allow only a single-line symbol/member path |
| AFL2001 | Missing required documentation or empty description |
| AFL2002 | Duplicate documentation field |
| AFL2003 | Documentation field has no matching declaration |
| AFL2004 | Duplicate input, result, class member or struct field; quoted keys compare decoded names |
| AFL3000 | Invalid crate layout or executable entry |
| AFL3001 | Missing or invalid config.toml syntax/structure |
| AFL3002 | Invalid dependency directory |
| AFL3003 | Cyclic crate dependency |
| AFL3004 | Invalid selected-crate test specification, path or association |
| AFL3101 | Cannot resolve a module/dependency in use, impl or an explicit description link |
| AFL3102 | Target module has no matching definition or external declaration |
| AFL3201 | Top-level, import or visible-local name conflict |
| AFL3202 | Unresolved type or incorrect type-argument count |
| AFL3203 | Undeclared explicit variable/function/name |
| AFL3204 | Undeclared class/struct member or assignment to a method |
| AFL3205 | Member access lacks a known class, struct or built-in collection type |
| AFL3206 | Invalid call target or argument count |
| AFL3207 | Passed, assigned or returned callback does not match its declared signature |
| AFL3208 | For receiver is not a known list/set/map, or binding count does not match the collection |
| AFL3209 | Known value is outside a declared string union; message lists allowed values |
| AFL3210 | Numeric operation/division has an explicitly nonnumeric operand, or min/max operand types differ |
| AFL3211 | List elements lack a natural order; use non-null numeric/character/string values or a key function |
| AFL3212 | Reassignment of a constant, including imported aliases, class constants and multi-target assignment |
| AFL3213 | Instance access to class-shared members or type access to instance members |
| AFL3301 | Invalid initializer shape/key or missing known target type |
| AFL3302 | Missing required field without a default, or duplicate initialization; optional struct fields may be omitted |
| AFL3303 | Incorrect returned or received value count |
| AFL3401 | impl target is ordinary; it must be extern |
| AFL3402 | Current module lacks a same-named ordinary implementation of the required kind |
| AFL3403 | Duplicate impl for one target in a module |
| AFL3404 | Implementation input/result/property signature differs, including nested nullability, optional fields and static/const markers |
| AFL3405 | Implementation class/struct lacks a member or has the wrong member kind; optional external fields still need declarations |
| AFL3410 | unsupported target is not extern or not in selected core |
| AFL3411 | Duplicate unsupported or impl/unsupported conflict in one module |
| AFL4001 | Invalid preset configuration, directory, name or crate list |
| AFL4002 | Requested preset is missing or invalid |
| AFL4003 | Project config.toml is missing an empty `[project]` marker |
| AFL4101 | Selected core capability lacks a provider |
| AFL4102 | Selected core capability has conflicting providers |
| AFL4103 | Information: explicitly permitted unsupported capability, with reason and fallback; not an implementation |
| AFL4200 | Invalid or unreadable implementation association TOML/schema |
| AFL4201 | Unknown, ambiguous or out-of-scope AFL symbol association |
| AFL4202 | Unreadable native file or out-of-bounds association range |
| AFL4203 | Duplicate implementation association |
| AFL4204 | Missing required native association coverage |
| AFL9001 | Editor host cannot read or check the project |

Exit codes: 0 means successful checking/query, 1 means AFL/association errors, and 2 means invocation or I/O failure. Missing configuration is an AFL error; an unreadable user-selected path is an I/O failure.

The checker validates structure and explicit dependencies. Types support member lookup, initializer shape, impl matching and explicit callback signatures, not general expression compatibility, prose interpretation or behavior verification. Untyped descriptions and `any` do not supply members or callable signatures; provide an explicit type when needed.

Removed generation configuration (`[codegen]`, `codegen_pack`, `project_dir` and object-valued crate selections) produces migration diagnostics. Maintain native projects directly and register preset `implementations` files. Native symbol strings are opaque; file/range validation does not establish signature or behavioral correctness.

Recovery diagnostics for mismatched body delimiters point at the incorrect closer and include `relatedInformation` linking the opening brace. Recovery keeps displaced bracketed documentation opaque, preserves later declarations when their boundaries are known, and avoids reporting skipped text as a sequence of lexical errors. Common mistakes include concrete repairs: remove an explicit method `self` parameter, remove an unnecessary same-target import accompanying `impl`, or add the named missing documentation fields.
