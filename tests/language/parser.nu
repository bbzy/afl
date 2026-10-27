use std/assert

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let checker = ($project_root | path join "packages/checker/dist/index.js")
  let bridge = r#'
    import { readFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const { parseDocument } = await import(pathToFileURL(process.argv[1]).href);
    const cases = JSON.parse(readFileSync(0, "utf8"));
    console.log(JSON.stringify(cases.map(item => ({
      name: item.name,
      ...parseDocument({ uri: item.name, text: item.text }),
    }))));
  '#
  let demos = ([...(glob ($project_root | path join "demo/**/*.afl")) ...(glob ($project_root | path join "tests/fixtures/**/*.afl"))] | each {|path|
    {name: $path, text: (open --raw $path)}
  })
  let cases = [
    {name: "raw_string", text: 'fn main() { value: string = r#"C:\tmp\n"# }', code: null}
    {name: "raw_empty_string", text: 'fn main() { value: string = r#""# }', code: null}
    {name: "raw_hashes", text: 'fn main() { value: string = r##"a "# and
  b \n"##
r##[a ]# and unmatched [ \]##
}', code: null}
    {name: "raw_crlf", text: "fn main() { value: string = r#\"a\r\n  b\"# }", code: null}
    {name: "raw_doc", text: 'fn work() [desc = r#[Keep ] [ \ " as text]#]', code: null}
    {name: "raw_doc_empty", text: 'fn work() [desc = r#[]#]', code: "AFL2001"}
    {name: "raw_assignment_empty", text: 'fn main() { value = r#[]# }', code: "AFL1003"}
    {name: "raw_string_not_doc", text: 'fn work() [desc = r#"Text"#]', code: "AFL1002"}
    {name: "raw_string_needs_hash", text: 'fn main() { value: string = r"Text" }', code: "AFL1002"}
    {name: "raw_desc_needs_hash", text: 'fn work() [desc = r[Text]]', code: "AFL1002"}
    {name: "raw_prefix_adjacent", text: 'fn main() { value: string = r# "Text"# }', code: "AFL1001"}
    {name: "raw_invalid_delimiter", text: "fn main() { value: string = r#'text'# }", code: "AFL1001"}
    {name: "raw_string_unclosed", text: 'fn main() { value: string = r##"Text"# }', code: "AFL1001"}
    {name: "raw_desc_unclosed", text: 'fn main() { r##[Text]# }', code: "AFL1001"}
    {name: "raw_string_extra_hash", text: 'fn main() { value: string = r#"Text"## }', code: "AFL1001"}
    {name: "raw_desc_extra_hash", text: 'fn main() { r#[Text]## }', code: "AFL1001"}
    {name: "raw_r_identifier", text: 'class r[desc = [R]] {}
fn main() { r: string = r#"Text"# }', code: null}
    {name: "old_raw_is_nested", text: 'fn main() { [[[words]]] }', code: null}
    {name: "raw_utf16", text: 'fn main() { r#"😀"# @ }', code: "AFL1001"}
    {name: "property_default", text: 'class Config [desc = [Config]] {
timeout_us: i64 = 10000 [desc = [Timeout]]
name: string [desc = [Name]]
}', code: null}
    {name: "property_default_prose", text: 'class Config [desc = [Config]] {
value: any = [Create a value] [desc = [Value]]
}', code: null}
    {name: "property_default_missing_doc", text: 'class Config [desc = [Config]] { value: i32 = 1 }', code: "AFL2001"}
    {name: "property_default_empty_prose", text: 'class Config [desc = [Config]] { value: any = [] [desc = [Value]] }', code: "AFL1003"}
    {name: "property_default_missing_value", text: 'class Config [desc = [Config]] { value: i32 = }', code: "AFL1002"}
    {name: "property_default_if_without_else", text: 'class Config [desc = [Config]] { value: i32 = if true { 1 } [desc = [Value]] }', code: "AFL1004"}
    {name: "property_default_return", text: 'class Config [desc = [Config]] { value: i32 = if true { return 1 } else { 2 } [desc = [Value]] }', code: "AFL1003"}
    {name: "description", text: 'fn main() { [Read arr[0], then \[literal\] and \\ slash] }', code: null}
    {name: "raw", text: 'fn main() { r#[ignore quotes " and unmatched [ { \\]# }', code: null}
    {name: "precedence", text: 'fn main() { x: i32 = 1 + 2 * 3 }', code: null}
    {name: "unicode", text: "fn main() { c: char = '😀' }", code: null}
    {name: "branch", text: 'fn main() { if true { [action] } }', code: null}
    {name: "nullable", text: 'fn work(items: list<User?>?) -> string? [items = [Optional users]
return = [Optional name]] { null }', code: null}
    {name: "escaped_null", text: 'fn main() { `null`: string? = null
`null` = "name" }', code: null}
    {name: "repeated_nullable", text: 'fn main() { x: string?? = null }', code: "AFL1002"}
    {name: "null_type", text: 'fn main() { x: null = null }', code: "AFL1002"}
    {name: "nullable_without_type", text: 'fn main() { x: ? = null }', code: "AFL1002"}
    {name: "nullable_without_initializer", text: 'fn main() { x: string? }', code: "AFL1002"}
    {name: "nullable_documentation", text: 'fn work(x: string?) {}', code: "AFL2001"}
    {name: "callback_type", text: 'fn work(callback: fn(i32, string?) -> (bool, User?), later: fn()?) -> (fn() -> string)? [callback = [Transform]
later = [Notify]
return = [Optional action]] { null }', code: null}
    {name: "callback_no_inputs", text: 'fn main() { callback: fn() = [Action]
callback() }', code: null}
    {name: "callback_empty_return", text: 'fn main() { callback: fn() -> () = [Action] }', code: "AFL1002"}
    {name: "callback_body", text: 'fn main() { callback: fn() = fn() {} }', code: "AFL1002"}
    {name: "callback_tuple_not_type", text: 'fn main() { pair: (i32, string) = [Pair] }', code: "AFL1002"}
    {name: "callback_missing_doc", text: 'fn work(callback: fn()) {}', code: "AFL2001"}
    {name: "missing_desc", text: 'fn absent()', code: "AFL2001"}
    {name: "missing_parameter", text: 'fn work(a: i32) {}', code: "AFL2001"}
    {name: "empty_doc", text: 'fn work() [desc = [   ]]', code: "AFL2001"}
    {name: "extra_doc", text: 'fn work() [extra = [Extra]] {}', code: "AFL2003"}
    {name: "duplicate_doc", text: "fn work() [desc = [One]\ndesc = [Two]]", code: "AFL2002"}
    {name: "duplicate_parameter", text: 'fn work(a: i32) -> a: i32 [a = [Value]] {}', code: "AFL2004"}
    {name: "extern_body", text: 'extern fn work() [desc = [Action]] {}', code: "AFL1003"}
    {name: "anonymous_multiple", text: 'fn work() -> i32, i32 [desc = [Action]]', code: "AFL1003"}
    {name: "if_value", text: 'fn main() { x: i32 = if true { 1 } }', code: "AFL1004"}
    {name: "if_assignment_receiver", text: 'fn main() { (if true { value }).field = 1 }', code: "AFL1004"}
    {name: "if_tail", text: 'fn work() -> i32 [return = [Value]] { if true { 1 } }', code: "AFL1004"}
    {name: "break", text: 'fn main() { break }', code: "AFL1005"}
    {name: "continue", text: 'fn main() { continue }', code: "AFL1005"}
    {name: "unclosed_desc", text: 'fn main() { [Unclosed', code: "AFL1001"}
    {name: "unclosed_raw", text: 'fn main() { r#[Unclosed ]', code: "AFL1001"}
    {name: "unclosed_literal", text: 'fn main() { "Unclosed', code: "AFL1001"}
    {name: "old_ellipsis", text: 'extern fn work() [desc = [Action]] ...', code: "AFL1002"}
    {name: "no_separator", text: 'fn main() { x: i32 = 1 x = 2 }', code: "AFL1002"}
    {name: "uninitialized", text: 'fn main() { x: i32 }', code: "AFL1002"}
    {name: "missing_close", text: 'fn main() {', code: "AFL1002"}
    {name: "invalid_target", text: 'fn main() { 1 = 2 }', code: "AFL1003"}
    {name: "char_width", text: "fn main() { x: char = 'ab' }", code: "AFL1001"}
    {name: "utf16", text: 'fn main() { "😀" @ }', code: "AFL1001"}
    {name: "crlf", text: "fn main() {\r\n @\r\n}", code: "AFL1001"}
  ] | append (["[" "]" "{" "}" "(" ")" "if" "else" "while" "return" "fn" "class" "-" "!" "," ":" "=" "true" "null"]
    | each {|content| [
      {name: ("raw_token_" + $content), text: ('fn main() { value: string = r#"' + $content + '"# }'), code: null}
      {name: ("string_token_" + $content), text: ('fn main() { value: string = "' + $content + '" }'), code: null}
    ] } | flatten)
  let execution = ($demos | append $cases | to json | ^node --input-type=module -e $bridge $checker | complete)
  if $execution.exit_code != 0 { error make {msg: $execution.stderr} }
  let results = ($execution.stdout | from json)
  for demo in $demos {
    let actual = ($results | where name == $demo.name | first)
    assert equal $actual.diagnostics [] $"Demo syntax failed: ($demo.name)"
  }
  for case in $cases {
    let actual = ($results | where name == $case.name | first)
    if $case.code == null {
      assert equal $actual.diagnostics [] $"Unexpected diagnostic: ($case.name)"
    } else {
      assert ($case.code in ($actual.diagnostics | get code)) $"Missing ($case.code): ($case.name)"
    }
  }
  let description = ($results | where name == "description" | first | get module.declarations.0.body.statements.0.values.0)
  let raw_string = ($results | where name == "raw_string" | first | get module.declarations.0.body.statements.0.values.0)
  assert equal $raw_string.literalType "string"
  assert $raw_string.raw
  assert equal $raw_string.value 'C:\tmp\n'
  let raw_source = ($cases | where name == "raw_string" | first | get text)
  assert equal ($raw_source | str substring $raw_string.start..<$raw_string.end) 'r#"C:\tmp\n"#'
  let raw_hashes = ($results | where name == "raw_hashes" | first | get module.declarations.0.body.statements)
  assert equal $raw_hashes.0.values.0.value "a \"# and\n  b \\n"
  assert $raw_hashes.1.values.0.raw
  assert equal $raw_hashes.1.values.0.text 'a ]# and unmatched [ \'
  assert equal ($results | where name == "raw_crlf" | first | get module.declarations.0.body.statements.0.values.0.value) "a\r\n  b"
  let old_raw = ($results | where name == "old_raw_is_nested" | first | get module.declarations.0.body.statements.0.values.0)
  assert not $old_raw.raw
  assert equal $old_raw.text "[[words]]"
  assert equal ($results | where name == "raw_utf16" | first | get diagnostics.0.range.start) {line: 0, character: 20}
  let properties = ($results | where name == "property_default" | first | get module.declarations.0.properties)
  assert equal $properties.0.initializer.kind "literal"
  assert equal $properties.0.initializer.value "10000"
  assert equal $properties.0.documentation.fields.0.value.text "Timeout"
  assert equal $properties.1.initializer? null
  assert equal $description.text 'Read arr[0], then [literal] and \ slash'
  let precedence = ($results | where name == "precedence" | first | get module.declarations.0.body.statements.0.values.0)
  assert equal $precedence.operator "+"
  assert equal $precedence.right.operator "*"
  let nullable = ($results | where name == "nullable" | first | get module.declarations.0)
  assert $nullable.parameters.0.type.nullable
  assert $nullable.parameters.0.type.arguments.0.nullable
  assert $nullable.results.0.type.nullable
  assert equal $nullable.body.statements.0.values.0.literalType "null"
  assert equal $nullable.body.statements.0.values.0.value null
  let ordinary = ($results | where name == "precedence" | first | get module.declarations.0.body.statements.0.targets.0.type)
  assert not $ordinary.nullable
  let callback = ($results | where name == "callback_type" | first | get module.declarations.0)
  assert equal $callback.parameters.0.type.kind "function-type"
  assert equal ($callback.parameters.0.type.inputs | length) 2
  assert equal ($callback.parameters.0.type.results | length) 2
  assert $callback.parameters.0.type.inputs.1.nullable
  assert $callback.parameters.1.type.nullable
  assert $callback.results.0.type.nullable
  assert not $callback.results.0.type.results.0.nullable
  let utf16 = ($results | where name == "utf16" | first | get diagnostics.0.range.start)
  assert equal $utf16 {line: 0, character: 17}
  let crlf = ($results | where name == "crlf" | first | get diagnostics.0.range.start)
  assert equal $crlf {line: 1, character: 1}
  print $"Parser checks passed: ($demos | length) demo files and ($cases | length) focused cases."
}
