import assert from "node:assert/strict";
import * as path from "node:path";
const suiteDirectory = path.join(process.argv[2], "tests/language");
const root = path.dirname(path.dirname(suiteDirectory));
const checker = path.join(root, "packages/checker/dist/index.js");
const cases = [
  { name: "statement", text: "when { true -> { [Act] } }", code: null },
  {
    name: "value",
    text: "result: i32 = when { true -> { 1 }\nelse -> { 2 } }",
    code: null,
  },
  {
    name: "fallback_only",
    text: "result: i32 = when { else -> { 1 } }",
    code: null,
  },
  {
    name: "bodyless_description",
    text: "when { true -> { r#[Act with ] and [ as text]# } }",
    code: null,
  },
  {
    name: "nested",
    text: "result: i32 = when {\ntrue -> { if true { 1 } else { 2 } }\nelse -> { when { true -> { 3 }\nelse -> { 4 } } }\n}",
    code: null,
  },
  {
    name: "multi_result",
    text: 'a: i32, b: string = when { true -> { 1, "one" }\nelse -> { 2, "two" } }',
    code: null,
  },
  {
    name: "call_argument",
    text: "accept(when {\ntrue -> { 1 }\nelse -> { 2 }\n}, 3)",
    code: null,
  },
  {
    name: "inside_collection",
    text: "values: list<i32> = {when { true -> { 1 }\nelse -> { 2 } }, 3}",
    code: null,
  },
  {
    name: "object_context",
    text: "item: Item = when { true -> { {id: 1} }\nelse -> { {id: 2} } }\nitem.id",
    code: null,
  },
  {
    name: "callback_context",
    text: "handler: fn() = when { true -> { notify }\nelse -> { notify } }\nhandler()",
    code: null,
  },
  {
    name: "callback_mismatch",
    text: "handler: fn() = when { true -> { notify }\nelse -> { one } }",
    code: "AFL3207",
  },
  {
    name: "for_source",
    text: "for item in when { true -> { items() }\nelse -> { items() } } { item.id }",
    code: null,
  },
  {
    name: "nested_controls",
    text: "for item in items() { when {\nitem.id == 0 -> { continue }\nelse -> { while true { break }\nreturn }\n} }",
    code: null,
  },
  {
    name: "branch_scopes",
    text: "result: i32 = when { true -> { local: i32 = 1\nlocal }\nelse -> { local: i32 = 2\nlocal } }",
    code: null,
  },
  { name: "empty", text: "when {}", code: "AFL1003" },
  {
    name: "missing_else_value",
    text: "result: i32 = when { true -> { 1 } }",
    code: "AFL1004",
  },
  {
    name: "missing_else_argument",
    text: "accept(when { true -> { 1 } }, 2)",
    code: "AFL1004",
  },
  {
    name: "missing_else_iterable",
    text: "for item in when { true -> { items() } } {}",
    code: "AFL1004",
  },
  {
    name: "missing_else_nested",
    text: "result: i32 = when { true -> { when { true -> { 1 } } }\nelse -> { 2 } }",
    code: "AFL1004",
  },
  {
    name: "else_not_last",
    text: "when { else -> { [Act] }\ntrue -> { [Again] } }",
    code: "AFL1003",
  },
  {
    name: "duplicate_else",
    text: "when { else -> { [Act] }\nelse -> { [Again] } }",
    code: "AFL1003",
  },
  {
    name: "branch_newline",
    text: "when { true -> {} false -> {} }",
    code: "AFL1002",
  },
  { name: "requires_arrow", text: "when { true { [Act] } }", code: "AFL1002" },
  { name: "requires_body", text: "when { true -> 1 }", code: "AFL1002" },
  { name: "no_subject", text: "when status { true -> {} }", code: "AFL1002" },
  {
    name: "no_prose_condition",
    text: "when { [Ready] -> {} }",
    code: "AFL1003",
  },
  {
    name: "unresolved_condition",
    text: "when { missing() -> {} }",
    code: "AFL3203",
  },
  {
    name: "unresolved_body",
    text: "when { true -> { missing() } }",
    code: "AFL3203",
  },
  {
    name: "arity_branch",
    text: 'a: i32, b: string = when { true -> { 1, "one" }\nelse -> { 2 } }',
    code: "AFL3303",
  },
  {
    name: "empty_value_branch",
    text: "a: i32 = when { true -> {}\nelse -> { 2 } }",
    code: "AFL3303",
  },
  {
    name: "missing_object_field",
    text: "item: Item = when { true -> { {} }\nelse -> { {id: 1} } }",
    code: "AFL3302",
  },
  {
    name: "no_scope_leak",
    text: "when { true -> { local: i32 = 1 } }\nlocal",
    code: "AFL3203",
  },
  {
    name: "no_cross_branch_scope",
    text: "when { true -> { local: i32 = 1 }\nelse -> { local } }",
    code: "AFL3203",
  },
  {
    name: "no_shadow",
    text: "local: i32 = 1\nwhen { true -> { local: i32 = 2 } }",
    code: "AFL3201",
  },
  {
    name: "break_outside_loop",
    text: "when { true -> { break } }",
    code: "AFL1005",
  },
  {
    name: "continue_outside_loop",
    text: "when { true -> { continue } }",
    code: "AFL1005",
  },
  {
    name: "return_value",
    full: "fn choose() -> i32 [return = [Value]] { return when { true -> { 1 }\nelse -> { 2 } } }",
    code: null,
  },
  {
    name: "tail_value",
    full: "fn choose() -> i32 [return = [Value]] { when { true -> { 1 }\nelse -> { 2 } } }",
    code: null,
  },
  {
    name: "tail_requires_else",
    full: "fn choose() -> i32 [return = [Value]] { when { true -> { 1 } } }",
    code: "AFL1004",
  },
  {
    name: "named_early_return",
    full: "fn choose() -> result: i32 [result = [Value]] { result = 1\nwhen { true -> { return } } }",
    code: null,
  },
  {
    name: "anonymous_early_return",
    full: "fn choose() -> i32 [return = [Value]] { when { true -> { return 1 }\nelse -> { 2 } } }",
    code: null,
  },
  {
    name: "property_default",
    full: "struct Options [desc = [Options]] { value: i32 = when { true -> { one() }\nelse -> { 2 } } [desc = [Value]] }",
    code: null,
  },
  {
    name: "default_no_return",
    full: "struct Options [desc = [Options]] { value: i32 = when { true -> { return 1 }\nelse -> { 2 } } [desc = [Value]] }",
    code: "AFL1003",
  },
  {
    name: "default_requires_else",
    full: "struct Options [desc = [Options]] { value: i32 = when { true -> { 1 } } [desc = [Value]] }",
    code: "AFL1004",
  },
  {
    name: "escaped_keyword",
    text: "`when`: bool = true\nwhen { `when` -> { [Act] } }",
    code: null,
  },
  {
    name: "literal_keyword",
    text: 'when { "else" -> { [Act] }\nr#"->"# -> { [Again] } }',
    code: null,
  },
  {
    name: "multiline_header",
    text: "when\n{\ntrue\n->\n{ [Act] }\n}",
    code: null,
  },
];
const executionResult = await exercise(cases, [checker]);
const results = executionResult;
for (const testCase of cases) {
  const diagnostics = results.filter((item) => item.name === testCase.name)[0]
    .diagnostics;
  if (testCase.code === null) {
    assert.deepEqual(diagnostics, [], testCase.name);
  } else {
    assert(
      diagnostics.some((issue) => issue.code === testCase.code),
      "" +
        String(testCase.name) +
        ": " +
        String(JSON.stringify(diagnostics)) +
        "",
    );
  }
}
console.log(
  "When checks passed: " +
    String(cases.length) +
    " syntax/dependency cases, branch scopes, values, editor navigation, recovery and signatures.",
);

async function exercise(input: any, args: string[]) {
  const { pathToFileURL } = await import("node:url");

  const { checkProject, LanguageService } = await import(
    pathToFileURL(args[0]).href
  );
  const cases = input;
  const declarations = `struct Item [desc = [Data]] { id: i32 [desc = [Identity]] }
fn items() -> list<Item> [desc = [Items]
return = [Items]]
fn notify() {}
fn one() -> i32 [return = [Value]] { 1 }
fn accept(a: i32, b: i32) [a = [First]
b = [Second]] {}
`;
  const results = cases.map((item) => ({
    name: item.name,
    ...checkProject([
      {
        uri: "file:///when/lib.afl",
        text: declarations + (item.full ?? "fn main() {\n" + item.text + "\n}"),
      },
    ]),
  }));
  const position = (text, offset) => ({
    line: text.slice(0, offset).split("\n").length - 1,
    character: offset - text.lastIndexOf("\n", offset - 1) - 1,
  });
  const at = (doc, text, delta = 0) => {
    assert.ok(doc.text.includes(text), text);
    return position(doc.text, doc.text.indexOf(text) + delta);
  };
  const data = { uri: "file:///when/data.afl", text: declarations };
  const main = {
    uri: "file:///when/lib.afl",
    text: `use data::one
use data::accept
fn main() {
result: i32 = when {
 true -> { local: i32 = one()
local }
 else -> { 2 }
}
accept(when { true -> { 1 }
else -> { 2 } }, 3)
}`,
  };
  const service = new LanguageService();
  service.update([data, main]);
  assert.deepEqual(service.diagnostics, []);
  const ast = service.getModule(main.uri).declarations[2].body.statements[0]
    .values[0];
  assert.equal(ast.kind, "when");
  assert.equal(ast.branches.length, 1);
  assert.ok(ast.otherwise);
  assert.equal(service.definition(main.uri, at(main, "one()")).uri, data.uri);
  assert.deepEqual(
    service.definition(main.uri, at(main, "\nlocal", 1)).range.start,
    at(main, "local:"),
  );
  assert.equal(
    service.references(data.uri, at(data, "one()"), false).length,
    2,
  );
  assert.equal(
    service.signatureHelp(main.uri, at(main, "}, 3)", 3)).activeParameter,
    1,
  );
  for (const [text, wanted, excluded] of [
    [
      "use data::one\nfn main() { when { true -> { local: i32 = 1\nlo",
      "local",
      null,
    ],
    [
      "use data::one\nfn main() { when { true -> { local: i32 = 1 }\nelse -> { lo",
      null,
      "local",
    ],
    [
      "use data::one\nfn main() { when { true -> { local: i32 = 1 } }\nlo",
      null,
      "local",
    ],
    ["use data::one\nfn main() { when { true -> { on", "one", null],
  ]) {
    service.update([data, { ...main, text }]);
    const items = service.completion(main.uri, position(text, text.length));
    if (wanted) {
      assert.ok(
        items.some((item) => item.label === wanted),
        text,
      );
    }
    if (excluded) {
      assert.ok(!items.some((item) => item.label === excluded), text);
    }
  }
  service.update([
    data,
    { ...main, text: main.text.replace(" else -> { 2 }", "") },
  ]);
  assert.ok(service.diagnostics.some((item) => item.code === "AFL1004"));
  service.update([data, main]);
  assert.deepEqual(service.diagnostics, []);
  return results;
}
