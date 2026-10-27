use std/assert

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let checker = ($project_root | path join "packages/checker/dist/index.js")
  let adder = r#'
class Adder [desc = [An adder]] {
    base: i32 [desc = [Base value]]
    fn add(value: i32) -> i32 [
        value = [Input]
        return = [Sum]
    ] { self.base + value }
}
'#
  let pair = r#'
fn pair() -> sum: i32, msg: string [
    sum = [Sum]
    msg = [Message]
] {
    sum = 3
    msg = "ok"
}
'#
  let cases = [
    {name: "raw_literals", text: 'fn echo(text: string) -> string [text = [Text]
return = [Text]] { text }
fn main() {
value: string = echo(r#"if, ) { unknown()"#)
items: map<string, list<string>> = {r#"key"#: {r#"["#, r#"]"#}}
context = r#[missing_function() and unknown.field are prose]#
context = r##[Even ]# is just text]##
}', code: null}
    {name: "raw_literal_needs_type", text: 'fn main() { value = r#"Text"# }', code: "AFL3203"}
    {name: "raw_desc_not_call_argument", text: 'fn work(text: string) [text = [Text]] {}
fn main() { work(r#[Create text]#) }', code: "AFL1003"}
    {name: "raw_callback_value", text: 'fn main() { callback: fn() = r#"save"# }', code: "AFL3207"}
    {name: "raw_returns", text: 'fn text() -> string [return = r#[Unchanged text]#] { return r#"return"# }
fn empty() -> string [return = [Empty text]] { r#""# }
fn main() {}', code: null}
    {name: "default_does_not_fill_required", text: 'class Config [desc = [Config]] {
timeout: i64 = 10000 [desc = [Timeout]]
name: string [desc = [Name]]
}
fn main() { config: Config = {} }', code: "AFL3302"}
    {name: "default_omitted", prefix: ($adder | str replace 'base: i32' 'base: i32 = 10'), text: 'fn main() { x: Adder = {} }', code: null}
    {name: "default_override", prefix: ($adder | str replace 'base: i32' 'base: i32 = 10'), text: 'fn main() { x: Adder = {base: 20} }', code: null}
    {name: "default_duplicate_override", prefix: ($adder | str replace 'base: i32' 'base: i32 = 10'), text: 'fn main() { x: Adder = {base: 20, base: 30} }', code: "AFL3302"}
    {name: "default_unknown_override", prefix: ($adder | str replace 'base: i32' 'base: i32 = 10'), text: 'fn main() { x: Adder = {extra: 20} }', code: "AFL3301"}
    {name: "default_unknown_reference", prefix: ($adder | str replace 'base: i32' 'base: i32 = missing'), text: 'fn main() { x: Adder = {base: 20} }', code: "AFL3203"}
    {name: "default_self_unavailable", prefix: ($adder | str replace 'base: i32' 'base: i32 = self.base'), text: 'fn main() {}', code: "AFL3203"}
    {name: "default_callback", text: 'class Actions [desc = [Actions]] { click: fn() = save [desc = [Action]] }
fn save() {}
fn main() { actions: Actions = {}
actions.click() }', code: null}
    {name: "default_callback_mismatch", text: 'class Actions [desc = [Actions]] { click: fn() = wrong [desc = [Action]] }
fn wrong() -> i32 [return = [Value]] { 1 }
fn main() {}', code: "AFL3207"}
    {name: "default_call_arity", prefix: ($adder | str replace 'base: i32' 'base: i32 = get(1)'), text: 'fn get() -> i32 [return = [Value]] { 1 }
fn main() {}', code: "AFL3206"}
    {name: "default_result_arity", prefix: ($adder | str replace 'base: i32' 'base: i32 = pair()'), text: ($pair + 'fn main() {}'), code: "AFL3303"}
    {name: "default_nested_missing", prefix: $adder, text: 'class Config [desc = [Config]] { adder: Adder = {} [desc = [Adder]] }
fn main() {}', code: "AFL3302"}
    {name: "default_map_shape", text: 'class Config [desc = [Config]] { items: map<string, i32> = {1} [desc = [Items]] }
fn main() {}', code: "AFL3301"}
    {name: "default_if", text: 'class Config [desc = [Config]] { value: i32 = if true {
x: i32 = 1
x
} else { 2 } [desc = [Value]] }
fn main() { config: Config = {} }', code: null}
    {name: "default_if_branch_arity", text: 'class Config [desc = [Config]] { value: i32 = if true { 1, 2 } else { 3 } [desc = [Value]] }
fn main() {}', code: "AFL3303"}
    {name: "default_scope_isolation", text: 'class Config [desc = [Config]] {
value: i32 = if true { local: i32 = 1
local } else { 2 } [desc = [Value]]
next: i32 = local [desc = [Next]]
}
fn main() {}', code: "AFL3203"}
    {name: "default_extern_property", text: 'extern class Config [desc = [External config]] { value: i32 = 1 [desc = [Value]] }
fn main() { config: Config = {} }', code: null}
    {name: "default_plain_types_still_opaque", text: 'class Config [desc = [Config]] { value: i32 = "Agent owns semantics" [desc = [Value]] }
fn main() {}', code: null}
    {name: "typed_member", prefix: $adder, text: "fn main() { x: Adder = {base: 10}\n x.add(1) }", code: null}
    {name: "callback_reference", text: 'fn save() {}
fn show(callback: fn()) [callback = [Action]] { callback() }
fn main() { show(save) }', code: null}
    {name: "callback_signature_mismatch", text: 'fn wrong(x: i32) [x = [Input]] {}
fn show(callback: fn()) [callback = [Action]] {}
fn main() { show(wrong) }', code: "AFL3207"}
    {name: "callback_result_mismatch", text: 'fn wrong() -> string [return = [Text]] { "text" }
fn main() { callback: fn() -> i32 = wrong }', code: "AFL3207"}
    {name: "callback_non_function", text: 'fn main() { callback: fn() = 1 }', code: "AFL3207"}
    {name: "callback_class_not_constructor", prefix: $adder, text: 'fn main() { callback: fn() = Adder }', code: "AFL3207"}
    {name: "callback_unresolved", text: 'fn main() { callback: fn() = absent }', code: "AFL3203"}
    {name: "callback_unknown_type", text: 'fn main() { callback: fn(list<Missing?>) -> Missing = [Action] }', code: "AFL3202"}
    {name: "callback_prose", text: 'fn main() { callback: fn(i32) -> string = [Create callback]
text: string = callback(1) }', code: null}
    {name: "callback_untyped_prose", text: 'fn main() { callback = [Create callback]
callback() }', code: "AFL3206"}
    {name: "callback_call_arity", text: 'fn main() { callback: fn(i32) = [Action]
callback() }', code: "AFL3206"}
    {name: "callback_multiple_results", prefix: $pair, text: 'fn main() { callback: fn() -> (i32, string) = pair
sum: i32, message: string = callback() }', code: null}
    {name: "callback_result_arity", prefix: $pair, text: 'fn main() { callback: fn() -> (i32, string) = pair
sum: i32 = callback() }', code: "AFL3303"}
    {name: "callback_return_reference", text: 'fn save() {}
fn make() -> fn() [return = [Action]] { save }
fn main() { make()() }', code: null}
    {name: "callback_return_mismatch", text: 'fn wrong() -> i32 [return = [Value]] { 1 }
fn make() -> fn() [return = [Action]] { wrong }', code: "AFL3207"}
    {name: "callback_method_reference", prefix: $adder, text: 'fn main() { object: Adder = {base: 1}
callback: fn(i32) -> i32 = object.add
value: i32 = callback(2) }', code: null}
    {name: "callback_property", text: 'class Actions [desc = [Actions]] { click: fn() [desc = [Action]] }
fn save() {}
fn main() { actions: Actions = {click: save}
actions.click()
actions.click = save }', code: null}
    {name: "callback_property_mismatch", text: 'class Actions [desc = [Actions]] { click: fn() [desc = [Action]] }
fn main() { actions: Actions = {click: 1} }', code: "AFL3207"}
    {name: "callback_nullable_collection", text: 'fn save() {}
fn main() { callbacks: list<fn()?> = {save, null}
callback: fn()? = save
callback() }', code: null}
    {name: "callback_nested_signature", text: 'fn accept(callback: fn(i32?) -> string) [callback = [Transform]] {}
fn main() { higher: fn(fn(i32) -> string) = accept }', code: "AFL3207"}
    {name: "callback_plain_types_still_opaque", text: 'fn take(x: i32) [x = [Input]] {}
fn main() { take("Agent owns semantics") }', code: null}
    {name: "known_description", prefix: $adder, text: "fn main() { x: Adder = [Create it]\n x.add(1) }", code: null}
    {name: "nullable_member", prefix: $adder, text: "fn main() { x: Adder? = null\n x.add(1)\n x.base = 2 }", code: null}
    {name: "nullable_missing_member", prefix: $adder, text: "fn main() { x: Adder? = null\n x.missing() }", code: "AFL3204"}
    {name: "nullable_any_member", text: "fn main() { x: any? = null\n x.add(1) }", code: "AFL3205"}
    {name: "nullable_unknown_type", text: 'fn main() { x: map<string, list<Missing?>?>? = null }', code: "AFL3202"}
    {name: "nullable_generic_arity", text: 'fn main() { x: list<i32?, string?>? = null }', code: "AFL3202"}
    {name: "nullable_nested_initializer", prefix: $adder, text: 'fn main() { x: map<string, list<Adder?>?>? = {"items": {{base: 1}, null}, "absent": null} }', code: null}
    {name: "nullable_required_field", prefix: ($adder | str replace 'base: i32' 'base: i32?'), text: 'fn main() { x: Adder? = {} }', code: "AFL3302"}
    {name: "nullable_if_initializer", prefix: $adder, text: 'fn main() { x: Adder? = if true { null } else { {base: 1} }
x.base }', code: null}
    {name: "nullable_required_argument", text: 'fn work(x: string?) [x = [Optional value]] {}
fn main() { work() }', code: "AFL3206"}
    {name: "nullable_null_argument", text: 'fn work(x: string?) [x = [Optional value]] {}
fn main() { work(null) }', code: null}
    {name: "nullable_named_return", text: 'fn work() -> x: string? [x = [Optional value]] { x = null
return }', code: null}
    {name: "nullable_anonymous_return", text: 'fn work() -> string? [return = [Optional value]] { return null }', code: null}
    {name: "nullable_bare_return", text: 'fn work() -> string? [return = [Optional value]] { return }', code: "AFL3303"}
    {name: "null_no_type_semantics", text: 'fn main() { x: i32 = null }', code: null}
    {name: "unknown_member", text: "fn main() { x = [Create it]\n x.add(1) }", code: "AFL3205"}
    {name: "any_member", text: "fn main() { x: any = [Create it]\n x.add(1) }", code: "AFL3205"}
    {name: "missing_member", prefix: $adder, text: "fn main() { x: Adder = {base: 10}\n x.missing() }", code: "AFL3204"}
    {name: "method_assignment", prefix: $adder, text: "fn main() { x: Adder = {base: 10}\n x.add = 1 }", code: "AFL3204"}
    {name: "deep_member_chain", text: ("fn main() { missing" + (1..256 | each { ".field" } | str join) + " }"), code: "AFL1003"}
    {name: "missing_name", text: 'fn main() { x: i32 = missing }', code: "AFL3203"}
    {name: "implicit_local", text: 'fn main() { x = 1 }', code: "AFL3203"}
    {name: "prose_local", text: "fn main() { [x = 1]\n x = 2 }", code: "AFL3203"}
    {name: "description_reassignment", text: "fn main() { x = [First]\n x = [Second] }", code: null}
    {name: "scope_escape", text: "fn main() { if true { x: i32 = 1 }\n x = 2 }", code: "AFL3203"}
    {name: "scope_shadow", text: "fn main() { x: i32 = 1\n if true { x: i32 = 2 } }", code: "AFL3201"}
    {name: "sibling_scopes", text: "fn main() { if true { x: i32 = 1 } else { x: i32 = 2 } }", code: null}
    {name: "unknown_type", text: 'fn main() { x: Missing = [Value] }', code: "AFL3202"}
    {name: "nested_unknown_type", text: 'fn main() { x: map<string, list<Missing>> = {} }', code: "AFL3202"}
    {name: "generic_arity", text: 'fn main() { x: list<i32, string> = {} }', code: "AFL3202"}
    {name: "builtin_arity", text: 'fn main() { x: i32<string> = 1 }', code: "AFL3202"}
    {name: "constructor", prefix: $adder, text: 'fn main() { Adder() }', code: "AFL3206"}
    {name: "initializer_extra", prefix: $adder, text: 'fn main() { x: Adder = {base: 10, extra: 2} }', code: "AFL3301"}
    {name: "initializer_missing", prefix: $adder, text: 'fn main() { x: Adder = {} }', code: "AFL3302"}
    {name: "initializer_duplicate", prefix: $adder, text: 'fn main() { x: Adder = {base: 10, base: 20} }', code: "AFL3302"}
    {name: "initializer_reference", prefix: $adder, text: 'fn main() { x: Adder = {base: missing} }', code: "AFL3203"}
    {name: "initializer_any", text: 'fn main() { x: any = {} }', code: "AFL3301"}
    {name: "list_keyed", text: 'fn main() { x: list<i32> = {1: 2} }', code: "AFL3301"}
    {name: "map_unkeyed", text: 'fn main() { x: map<string, i32> = {1} }', code: "AFL3301"}
    {name: "map_expression_key", text: "fn main() { name: string = \"key\"\n x: map<string, i32> = {name: 1} }", code: null}
    {name: "map_key_reference", text: 'fn main() { x: map<string, i32> = {missing: 1} }', code: "AFL3203"}
    {name: "nested_initializer", prefix: $adder, text: 'fn main() { x: map<string, list<Adder>> = {"key": {{base: 1}}} }', code: null}
    {name: "no_type_semantics", text: 'fn main() { x: i32 = "Agent owns semantics" }', code: null}
    {name: "receive_pair", prefix: $pair, text: 'fn main() { a: i32, b: string = pair() }', code: null}
    {name: "initialize_after_pair", prefix: $pair, text: 'fn main() { a: i32, b: string, c: list<i32> = pair(), {1, 2} }', code: null}
    {name: "pair_arity", prefix: $pair, text: 'fn main() { a: i32 = pair() }', code: "AFL3303"}
    {name: "return_arity", text: 'fn work() -> i32 [return = [Value]] { return 1, 2 }', code: "AFL3303"}
    {name: "tail_arity", text: 'fn work() -> i32 [return = [Value]] { 1, 2 }', code: "AFL3303"}
    {name: "branch_arity", text: 'fn main() { x: i32 = if true { 1, 2 } else { 1 } }', code: "AFL3303"}
    {name: "empty_value_branch", text: 'fn main() { x: i32 = if true { 1 } else {} }', code: "AFL3303"}
    {name: "anonymous_bare_return", text: 'fn work() -> i32 [return = [Value]] { return }', code: "AFL3303"}
    {name: "named_bare_return", text: "fn work() -> x: i32 [x = [Value]] { x = 1\n return }", code: null}
    {name: "argument_count", text: "fn work(x: i32) [x = [Input]] {}\nfn main() { work() }", code: "AFL3206"}
    {name: "initializer_argument", prefix: $adder, text: "fn work(x: Adder) [x = [Input]] {}\nfn main() { work({base: 1}) }", code: null}
    {name: "recursion", text: 'fn main() { main() }', code: null}
    {name: "duplicate_top_level", text: "fn main() {}\nfn main() {}", code: "AFL3201"}
    {name: "unresolved_prose_ignored", text: 'fn main() { [missing.call(unknown) is prose] }', code: null}
    {name: "builtin_reserved", text: 'class i32 [desc = [Invalid name]] {}', code: "AFL3201"}
  ]
  let bridge = r#'
    import { readFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const { checkProject } = await import(pathToFileURL(process.argv[1]).href);
    console.log(JSON.stringify(JSON.parse(readFileSync(0, "utf8")).map(item => ({
      name: item.name,
      ...checkProject([{ uri: `file:///cases/${item.name}/lib.afl`, text: (item.prefix ?? "") + "\n" + item.text }]),
    }))));
  '#
  let execution = ($cases | to json | ^node --input-type=module -e $bridge $checker | complete)
  if $execution.exit_code != 0 { error make {msg: $execution.stderr} }
  let results = ($execution.stdout | from json)
  for case in $cases {
    let result = ($results | where name == $case.name | first)
    assert equal $result.status "complete"
    assert not ($result.diagnostics | any {|issue| $issue.code in ["AFL1001", "AFL1002"] }) $"Invalid fixture syntax: ($case.name)"
    if $case.code == null { assert equal $result.diagnostics [] $"Unexpected error: ($case.name)" } else {
      assert ($case.code in ($result.diagnostics | get code)) $"Missing ($case.code): ($case.name)"
    }
  }
  print $"Name and dependency checks passed: ($cases | length) focused cases."
}
