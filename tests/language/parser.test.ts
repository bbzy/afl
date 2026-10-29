import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { globSync } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/language");
const project_root = path.dirname(path.dirname(suiteDirectory));
const checker = path.join(project_root, "packages/checker/dist/index.js");
const demos = [
  ...globSync(path.join(project_root, "demo/**/*.afl")),
  ...globSync(path.join(project_root, "tests/fixtures/**/*.afl")),
].map((path) => ({ name: path, text: fs.readFileSync(path, "utf8") }));
const cases = [
  ...[
    {
      name: "raw_string",
      text: 'fn main() { value: string = r#"C:\\tmp\\n"# }',
      code: null,
    },
    {
      name: "raw_empty_string",
      text: 'fn main() { value: string = r#""# }',
      code: null,
    },
    {
      name: "raw_hashes",
      text: 'fn main() { value: string = r##"a "# and\n  b \\n"##\nr##[a ]# and unmatched [ \\]##\n}',
      code: null,
    },
    {
      name: "raw_crlf",
      text: 'fn main() { value: string = r#"a\r\n  b"# }',
      code: null,
    },
    {
      name: "raw_doc",
      text: 'fn work() [desc = r#[Keep ] [ \\ " as text]#]',
      code: null,
    },
    {
      name: "raw_doc_empty",
      text: "fn work() [desc = r#[]#]",
      code: "AFL2001",
    },
    {
      name: "raw_assignment_empty",
      text: "fn main() { value = r#[]# }",
      code: "AFL1003",
    },
    {
      name: "raw_string_not_doc",
      text: 'fn work() [desc = r#"Text"#]',
      code: "AFL1002",
    },
    {
      name: "raw_string_needs_hash",
      text: 'fn main() { value: string = r"Text" }',
      code: "AFL1002",
    },
    {
      name: "raw_desc_needs_hash",
      text: "fn work() [desc = r[Text]]",
      code: "AFL1002",
    },
    {
      name: "raw_prefix_adjacent",
      text: 'fn main() { value: string = r# "Text"# }',
      code: "AFL1001",
    },
    {
      name: "raw_invalid_delimiter",
      text: "fn main() { value: string = r#'text'# }",
      code: "AFL1001",
    },
    {
      name: "raw_string_unclosed",
      text: 'fn main() { value: string = r##"Text"# }',
      code: "AFL1001",
    },
    {
      name: "raw_desc_unclosed",
      text: "fn main() { r##[Text]# }",
      code: "AFL1001",
    },
    {
      name: "raw_string_extra_hash",
      text: 'fn main() { value: string = r#"Text"## }',
      code: "AFL1001",
    },
    {
      name: "raw_desc_extra_hash",
      text: "fn main() { r#[Text]## }",
      code: "AFL1001",
    },
    {
      name: "raw_r_identifier",
      text: 'class r[desc = [R]] {}\nfn main() { r: string = r#"Text"# }',
      code: null,
    },
    {
      name: "old_raw_is_nested",
      text: "fn main() { [[[words]]] }",
      code: null,
    },
    { name: "raw_utf16", text: 'fn main() { r#"😀"# @ }', code: "AFL1001" },
    {
      name: "property_default",
      text: "class Config [desc = [Config]] {\ntimeout_us: i64 = 10000 [desc = [Timeout]]\nname: string [desc = [Name]]\n}",
      code: null,
    },
    {
      name: "property_default_prose",
      text: "class Config [desc = [Config]] {\nvalue: any = [Create a value] [desc = [Value]]\n}",
      code: null,
    },
    {
      name: "property_default_missing_doc",
      text: "class Config [desc = [Config]] { value: i32 = 1 }",
      code: "AFL2001",
    },
    {
      name: "property_default_empty_prose",
      text: "class Config [desc = [Config]] { value: any = [] [desc = [Value]] }",
      code: "AFL1003",
    },
    {
      name: "property_default_missing_value",
      text: "class Config [desc = [Config]] { value: i32 = }",
      code: "AFL1002",
    },
    {
      name: "property_default_if_without_else",
      text: "class Config [desc = [Config]] { value: i32 = if true { 1 } [desc = [Value]] }",
      code: "AFL1004",
    },
    {
      name: "property_default_return",
      text: "class Config [desc = [Config]] { value: i32 = if true { return 1 } else { 2 } [desc = [Value]] }",
      code: "AFL1003",
    },
    {
      name: "description",
      text: "fn main() { [Read arr[0], then \\[literal\\] and \\\\ slash] }",
      code: null,
    },
    {
      name: "raw",
      text: 'fn main() { r#[ignore quotes " and unmatched [ { \\\\]# }',
      code: null,
    },
    {
      name: "precedence",
      text: "fn main() { x: i32 = 1 + 2 * 3 }",
      code: null,
    },
    { name: "unicode", text: "fn main() { c: char = '😀' }", code: null },
    { name: "branch", text: "fn main() { if true { [action] } }", code: null },
    {
      name: "nullable",
      text: "fn work(items: list<User?>?) -> string? [items = [Optional users]\nreturn = [Optional name]] { null }",
      code: null,
    },
    {
      name: "escaped_null",
      text: 'fn main() { `null`: string? = null\n`null` = "name" }',
      code: null,
    },
    {
      name: "repeated_nullable",
      text: "fn main() { x: string?? = null }",
      code: "AFL1002",
    },
    {
      name: "null_type",
      text: "fn main() { x: null = null }",
      code: "AFL1002",
    },
    {
      name: "nullable_without_type",
      text: "fn main() { x: ? = null }",
      code: "AFL1002",
    },
    {
      name: "nullable_without_initializer",
      text: "fn main() { x: string? }",
      code: "AFL1002",
    },
    {
      name: "nullable_documentation",
      text: "fn work(x: string?) {}",
      code: "AFL2001",
    },
    {
      name: "callback_type",
      text: "fn work(callback: fn(i32, string?) -> (bool, User?), later: fn()?) -> (fn() -> string)? [callback = [Transform]\nlater = [Notify]\nreturn = [Optional action]] { null }",
      code: null,
    },
    {
      name: "callback_no_inputs",
      text: "fn main() { callback: fn() = [Action]\ncallback() }",
      code: null,
    },
    {
      name: "callback_empty_return",
      text: "fn main() { callback: fn() -> () = [Action] }",
      code: "AFL1002",
    },
    {
      name: "callback_body",
      text: "fn main() { callback: fn() = fn() {} }",
      code: "AFL1002",
    },
    {
      name: "callback_tuple_not_type",
      text: "fn main() { pair: (i32, string) = [Pair] }",
      code: "AFL1002",
    },
    {
      name: "callback_missing_doc",
      text: "fn work(callback: fn()) {}",
      code: "AFL2001",
    },
    { name: "missing_desc", text: "fn absent()", code: "AFL2001" },
    { name: "missing_parameter", text: "fn work(a: i32) {}", code: "AFL2001" },
    { name: "empty_doc", text: "fn work() [desc = [   ]]", code: "AFL2001" },
    {
      name: "extra_doc",
      text: "fn work() [extra = [Extra]] {}",
      code: "AFL2003",
    },
    {
      name: "duplicate_doc",
      text: "fn work() [desc = [One]\ndesc = [Two]]",
      code: "AFL2002",
    },
    {
      name: "duplicate_parameter",
      text: "fn work(a: i32) -> a: i32 [a = [Value]] {}",
      code: "AFL2004",
    },
    {
      name: "extern_body",
      text: "extern fn work() [desc = [Action]] {}",
      code: "AFL1003",
    },
    {
      name: "anonymous_multiple",
      text: "fn work() -> i32, i32 [desc = [Action]]",
      code: "AFL1003",
    },
    {
      name: "if_value",
      text: "fn main() { x: i32 = if true { 1 } }",
      code: "AFL1004",
    },
    {
      name: "if_assignment_receiver",
      text: "fn main() { (if true { value }).field = 1 }",
      code: "AFL1004",
    },
    {
      name: "if_tail",
      text: "fn work() -> i32 [return = [Value]] { if true { 1 } }",
      code: "AFL1004",
    },
    { name: "break", text: "fn main() { break }", code: "AFL1005" },
    { name: "continue", text: "fn main() { continue }", code: "AFL1005" },
    { name: "unclosed_desc", text: "fn main() { [Unclosed", code: "AFL1001" },
    {
      name: "unclosed_raw",
      text: "fn main() { r#[Unclosed ]",
      code: "AFL1001",
    },
    {
      name: "unclosed_literal",
      text: 'fn main() { "Unclosed',
      code: "AFL1001",
    },
    {
      name: "old_ellipsis",
      text: "extern fn work() [desc = [Action]] ...",
      code: "AFL1002",
    },
    {
      name: "no_separator",
      text: "fn main() { x: i32 = 1 x = 2 }",
      code: "AFL1002",
    },
    { name: "uninitialized", text: "fn main() { x: i32 }", code: "AFL1002" },
    { name: "missing_close", text: "fn main() {", code: "AFL1002" },
    { name: "invalid_target", text: "fn main() { 1 = 2 }", code: "AFL1003" },
    {
      name: "char_width",
      text: "fn main() { x: char = 'ab' }",
      code: "AFL1001",
    },
    { name: "utf16", text: 'fn main() { "😀" @ }', code: "AFL1001" },
    { name: "crlf", text: "fn main() {\r\n @\r\n}", code: "AFL1001" },
  ],
  ...[
    "[",
    "]",
    "{",
    "}",
    "(",
    ")",
    "if",
    "else",
    "while",
    "return",
    "fn",
    "class",
    "-",
    "!",
    ",",
    ":",
    "=",
    "true",
    "null",
  ]
    .map((content) => [
      {
        name: "raw_token_" + content,
        text: 'fn main() { value: string = r#"' + (content + '"# }'),
        code: null,
      },
      {
        name: "string_token_" + content,
        text: 'fn main() { value: string = "' + (content + '" }'),
        code: null,
      },
    ])
    .flat(),
];
const execution = await exercise([...demos, ...cases], [checker]);
const results = execution;
for (const demo of demos) {
  const actual = results.filter((item) => item.name === demo.name)[0];
  assert.deepEqual(
    actual.diagnostics,
    [],
    "Demo syntax failed: " + String(demo.name) + "",
  );
}
for (const testCase of cases) {
  const actual = results.filter((item) => item.name === testCase.name)[0];
  if (testCase.code === null) {
    assert.deepEqual(
      actual.diagnostics,
      [],
      "Unexpected diagnostic: " + String(testCase.name) + "",
    );
  } else {
    assert(
      actual.diagnostics.map((item) => item.code).includes(testCase.code),
      "Missing " + String(testCase.code) + ": " + String(testCase.name) + "",
    );
  }
}
const description = results.filter((item) => item.name === "description")[0]
  .module.declarations[0].body.statements[0].values[0];
const raw_string = results.filter((item) => item.name === "raw_string")[0]
  .module.declarations[0].body.statements[0].values[0];
assert.deepEqual(raw_string.literalType, "string");
assert(raw_string.raw);
assert.deepEqual(raw_string.value, "C:\\tmp\\n");
const raw_source = cases.filter((item) => item.name === "raw_string")[0].text;
assert.deepEqual(
  raw_source.slice(raw_string.start, raw_string.end),
  'r#"C:\\tmp\\n"#',
);
const raw_hashes = results.filter((item) => item.name === "raw_hashes")[0]
  .module.declarations[0].body.statements;
assert.deepEqual(raw_hashes[0].values[0].value, 'a "# and\n  b \\n');
assert(raw_hashes[1].values[0].raw);
assert.deepEqual(raw_hashes[1].values[0].text, "a ]# and unmatched [ \\");
assert.deepEqual(
  results.filter((item) => item.name === "raw_crlf")[0].module.declarations[0]
    .body.statements[0].values[0].value,
  "a\r\n  b",
);
const old_raw = results.filter((item) => item.name === "old_raw_is_nested")[0]
  .module.declarations[0].body.statements[0].values[0];
assert(!old_raw.raw);
assert.deepEqual(old_raw.text, "[[words]]");
assert.deepEqual(
  results.filter((item) => item.name === "raw_utf16")[0].diagnostics[0].range
    .start,
  { line: 0, character: 20 },
);
const properties = results.filter((item) => item.name === "property_default")[0]
  .module.declarations[0].properties;
assert.deepEqual(properties[0].initializer.kind, "literal");
assert.deepEqual(properties[0].initializer.value, "10000");
assert.deepEqual(properties[0].documentation.fields[0].value.text, "Timeout");
assert.deepEqual(properties[1].initializer ?? null, null);
assert.deepEqual(description.text, "Read arr[0], then [literal] and \\ slash");
const precedence = results.filter((item) => item.name === "precedence")[0]
  .module.declarations[0].body.statements[0].values[0];
assert.deepEqual(precedence.operator, "+");
assert.deepEqual(precedence.right.operator, "*");
const nullable = results.filter((item) => item.name === "nullable")[0].module
  .declarations[0];
assert(nullable.parameters[0].type.nullable);
assert(nullable.parameters[0].type.arguments[0].nullable);
assert(nullable.results[0].type.nullable);
assert.deepEqual(nullable.body.statements[0].values[0].literalType, "null");
assert.deepEqual(nullable.body.statements[0].values[0].value, null);
const ordinary = results.filter((item) => item.name === "precedence")[0].module
  .declarations[0].body.statements[0].targets[0].type;
assert(!ordinary.nullable);
const callback = results.filter((item) => item.name === "callback_type")[0]
  .module.declarations[0];
assert.deepEqual(callback.parameters[0].type.kind, "function-type");
assert.deepEqual(callback.parameters[0].type.inputs.length, 2);
assert.deepEqual(callback.parameters[0].type.results.length, 2);
assert(callback.parameters[0].type.inputs[1].nullable);
assert(callback.parameters[1].type.nullable);
assert(callback.results[0].type.nullable);
assert(!callback.results[0].type.results[0].nullable);
const utf16 = results.filter((item) => item.name === "utf16")[0].diagnostics[0]
  .range.start;
assert.deepEqual(utf16, { line: 0, character: 17 });
const crlf = results.filter((item) => item.name === "crlf")[0].diagnostics[0]
  .range.start;
assert.deepEqual(crlf, { line: 1, character: 1 });
console.log(
  "Parser checks passed: " +
    String(demos.length) +
    " demo files and " +
    String(cases.length) +
    " focused cases.",
);

async function exercise(input: any, args: string[]) {
  const { pathToFileURL } = await import("node:url");
  const { parseDocument } = await import(pathToFileURL(args[0]).href);
  const cases = input;
  return cases.map((item) => ({
    name: item.name,
    ...parseDocument({ uri: item.name, text: item.text }),
  }));
}
