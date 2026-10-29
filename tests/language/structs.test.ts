import assert from "node:assert/strict";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/language");
const root = path.dirname(path.dirname(suiteDirectory));
const checker = path.join(root, "packages/checker/dist/index.js");
const contract =
  'struct Gift [desc = [Gift protocol]] {\n"gift-id": string [desc = [Exact protocol key]]\nnote?: string? [desc = [Missing, null, or text]]\ntimeout_us: i64 = 10000 [desc = [Timeout]]\n}';
const cases = [
  {
    name: "optional_missing",
    prefix: contract,
    text: 'fn main() { gift: Gift = {"gift-id": "one"} }',
    code: null,
  },
  {
    name: "optional_null",
    prefix: contract,
    text: 'fn main() { gift: Gift = {r#"gift-id"#: "one", note: null} }',
    code: null,
  },
  {
    name: "defaults_override",
    prefix: contract,
    text: 'fn main() { gift: Gift = {"gift-id": "one", note: "", timeout_us: 20000}\ngift.timeout_us = 1 }',
    code: null,
  },
  {
    name: "required_missing",
    prefix: contract,
    text: "fn main() { gift: Gift = {} }",
    code: "AFL3302",
  },
  {
    name: "nullable_required",
    text: "struct Data [desc = [Data]] { note: string? [desc = [Required nullable key]] }\nfn main() { data: Data = {} }",
    code: "AFL3302",
  },
  {
    name: "optional_nonnull",
    text: "struct Data [desc = [Data]] { note?: string [desc = [Optional non-null key]] }\nfn main() { data: Data = {} }",
    code: null,
  },
  {
    name: "optional_default",
    text: 'struct Data [desc = [Data]] { note?: string = "fallback" [desc = [Default when omitted]] }\nfn main() { data: Data = {} }',
    code: null,
  },
  {
    name: "duplicate_initializer",
    prefix: contract,
    text: 'fn main() { gift: Gift = {"gift-id": "one", note: null, "note": "two"} }',
    code: "AFL3302",
  },
  {
    name: "unknown_field",
    prefix: contract,
    text: 'fn main() { gift: Gift = {"gift-id": "one", "extra": 1} }',
    code: "AFL3301",
  },
  {
    name: "computed_key",
    prefix: contract,
    text: 'fn main() { gift: Gift = {"gift-id" + "suffix": "one"} }',
    code: "AFL3301",
  },
  {
    name: "positional_key",
    prefix: contract,
    text: 'fn main() { gift: Gift = {"one"} }',
    code: "AFL3301",
  },
  {
    name: "numeric_key",
    prefix: contract,
    text: 'fn main() { gift: Gift = {1: "one"} }',
    code: "AFL3301",
  },
  {
    name: "no_constructor",
    prefix: contract,
    text: "fn main() { gift: Gift = Gift() }",
    code: "AFL3206",
  },
  {
    name: "missing_member",
    prefix: contract,
    text: "fn show(gift: Gift?) [gift = [Gift]] { gift.missing }",
    code: "AFL3204",
  },
  {
    name: "unknown_type",
    text: "struct Data [desc = [Data]] { value?: Missing [desc = [Value]] }",
    code: "AFL3202",
  },
  {
    name: "unknown_default",
    text: "struct Data [desc = [Data]] { value: i32 = missing [desc = [Value]] }",
    code: "AFL3203",
  },
  {
    name: "no_self",
    text: "struct Data [desc = [Data]] { value: i32 = self.value [desc = [Value]] }",
    code: "AFL3203",
  },
  {
    name: "duplicate_field",
    text: 'struct Data [desc = [Data]] {\nname: string [desc = [Name]]\n"name": string [desc = [Same key]]\n}',
    code: "AFL2004",
  },
  {
    name: "duplicate_raw_field",
    text: 'struct Data [desc = [Data]] {\n"gift-id": string [desc = [Name]]\nr#"gift-id"#: string [desc = [Same key]]\n}',
    code: "AFL2004",
  },
  {
    name: "special_keys",
    text: 'struct Data [desc = [Data]] {\n"return": i32 [desc = [Keyword key]]\n"": string [desc = [Empty key]]\n"礼物😀": string [desc = [Unicode key]]\n}\nfn main() { data: Data = {`return`: 1, "": "empty", "礼物😀": "gift"}\ndata.`return` }',
    code: null,
  },
  {
    name: "escaped_key",
    text: 'struct Data [desc = [Data]] { "line\\nend": string [desc = [Escaped key]] }\nfn main() { data: Data = {r#"line\nend"#: "value"} }',
    code: null,
  },
  {
    name: "nested",
    text: 'struct Child [desc = [Child]] { id: string [desc = [Identity]] }\nstruct Parent [desc = [Parent]] {\nchildren: list<Child> [desc = [Children]]\nnamed: map<string, Child?> = {} [desc = [Dynamic names]]\nchild?: Child? [desc = [Optional child]]\n}\nfn main() { value: Parent = {children: {{id: "one"}}, named: {"user": {id: "two"}}} }',
    code: null,
  },
  {
    name: "nested_missing",
    text: "struct Child [desc = [Child]] { id: string [desc = [Identity]] }\nstruct Parent [desc = [Parent]] { child: Child [desc = [Child]] }\nfn main() { value: Parent = {child: {}} }",
    code: "AFL3302",
  },
  {
    name: "default_nested_missing",
    text: "struct Child [desc = [Child]] { id: string [desc = [Identity]] }\nstruct Parent [desc = [Parent]] { child: Child = {} [desc = [Child]] }",
    code: "AFL3302",
  },
  {
    name: "recursive",
    text: "struct Node [desc = [Recursive data]] { next?: Node? [desc = [Next node]] }\nfn main() { node: Node = {next: {}} }",
    code: null,
  },
  {
    name: "callback_field",
    text: "fn done() {}\nstruct Data [desc = [Callback data]] { notify: fn() = done [desc = [Notification]] }\nfn main() { data: Data = {}\ndata.notify() }",
    code: null,
  },
  {
    name: "callback_mismatch",
    text: "fn done() -> i32 [return = [Value]] { 1 }\nstruct Data [desc = [Data]] { notify: fn() = done [desc = [Notification]] }",
    code: "AFL3207",
  },
  {
    name: "no_methods",
    text: "struct Data [desc = [Data]] {\nfn work() { [Work] }\nvalue: i32 [desc = [Value]]\n}\nfn next() {}",
    code: "AFL1003",
  },
  { name: "missing_desc", text: "struct Data {}", code: "AFL2001" },
  {
    name: "missing_field_desc",
    text: "struct Data [desc = [Data]] { value?: i32 }",
    code: "AFL2001",
  },
  {
    name: "missing_field_type",
    text: "struct Data [desc = [Data]] { value = 1 [desc = [Value]] }",
    code: "AFL1002",
  },
  {
    name: "optional_class_rejected",
    text: "class Data [desc = [Data]] { value?: i32 [desc = [Value]] }",
    code: "AFL1002",
  },
  {
    name: "quoted_class_rejected",
    text: 'class Data [desc = [Data]] { "value": i32 [desc = [Value]] }',
    code: "AFL1002",
  },
  {
    name: "top_level_conflict",
    text: "struct Data [desc = [Data]] {}\nclass Data [desc = [Functionality]] {}",
    code: "AFL3201",
  },
  { name: "keyword_reserved", text: "fn struct() {}", code: "AFL1002" },
  {
    name: "keyword_escaped",
    text: "fn `struct`() {}\nfn main() { `struct`() }",
    code: null,
  },
  {
    name: "empty_struct",
    text: "struct Empty [desc = [Empty data]] {}\nfn main() { value: Empty = {} }",
    code: null,
  },
];
const execution = await exercise({ cases: cases, contract: contract }, [
  checker,
]);
const results = execution;
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
const cli = path.join(root, "packages/cli/dist/afl.js");
const demo = path.join(root, "tests/fixtures/structs");
const symbols = run(process.execPath, [cli, "symbols", demo, "--json"]);
assert.deepEqual(symbols.exit_code, 0);
const outline = JSON.parse(symbols.stdout);
assert.deepEqual(outline.diagnostics, []);
const gift = outline.results.filter((item) => item.name === "Gift")[0];
assert.deepEqual(gift.kind, "struct");
const field = gift.children.filter((item) => item.name === "gift-id")[0];
assert.deepEqual(field.kind, "field");
const references = run(process.execPath, [
  cli,
  "references",
  field.path,
  "--line",
  field.selectionRange.start.line + 1,
  "--column",
  field.selectionRange.start.character + 2,
  "--json",
]);
assert.deepEqual(references.exit_code, 0);
const locations = JSON.parse(references.stdout).results;
assert.deepEqual(locations.length, 2);
const source = locations[0];
const definition = run(process.execPath, [
  cli,
  "definition",
  source.path,
  "--line",
  source.range.start.line + 1,
  "--column",
  source.range.start.character + 2,
  "--json",
]);
assert.deepEqual(definition.exit_code, 0);
const target = JSON.parse(definition.stdout).results[0];
assert.deepEqual(target.path, field.path);
assert.deepEqual(target.range, field.selectionRange);
console.log(
  "Structs: " +
    String(cases.length) +
    " syntax/checker cases, 8 preset cases, editor navigation/completion and CLI string-key queries passed.",
);

async function exercise(payload: any, args: string[]) {
  const { pathToFileURL } = await import("node:url");

  const { checkProject, parseDocument, LanguageService } = await import(
    pathToFileURL(args[0]).href
  );
  const input = payload;
  const cases = input.cases.map((item) => ({
    name: item.name,
    ...checkProject([
      {
        uri: "file:///structs/lib.afl",
        text: (item.prefix ?? "") + "\n" + item.text,
      },
    ]),
  }));
  const ast = parseDocument({ uri: "ast", text: input.contract }).module
    .declarations[0];
  assert.equal(ast.kind, "struct");
  assert.deepEqual(
    ast.properties.map((field) => field.optional),
    [false, true, false],
  );
  assert.equal(ast.properties[0].name.text, "gift-id");
  assert.equal(ast.properties[0].name.quoted, true);
  assert.equal(ast.properties[1].type.nullable, true);
  assert.equal(ast.properties[2].initializer.value, "10000");
  assert.equal("methods" in ast, false);
  const core = {
    uri: "file:///contracts/core/lib.afl",
    text: `extern struct Data [desc = [Data]] {
"gift-id": string [desc = [Identity]]
note?: string? [desc = [Note]]
}
extern fn send(data: list<Data?>) -> Data? [desc = [Send]
data = [Data]
return = [Result]]`,
  };
  const edge = {
    uri: "file:///contracts/edge/lib.afl",
    text: `impl dep::core::lib::Data
impl dep::core::lib::send
struct Data [desc = [Adapted data]] {
"gift-id": string [desc = [Identity]]
note?: string? = null [desc = [Default note]]
extra?: bool [desc = [Edge-only field]]
}
fn send(data: list<Data?>) -> Data? [data = [Data]
return = [Result]] { null }`,
  };
  const context = {
    crates: [
      { root: "file:///contracts/core/", kind: "library", dependencies: {} },
      {
        root: "file:///contracts/edge/",
        kind: "library",
        dependencies: { core: "file:///contracts/core/" },
      },
      {
        root: "file:///contracts/other/",
        kind: "library",
        dependencies: { core: "file:///contracts/core/" },
      },
    ],
    preset: {
      name: "target",
      uri: "file:///contracts/config.toml",
      core: ["file:///contracts/core/"],
      edge: ["file:///contracts/edge/"],
    },
  };
  for (const [name, text, code] of [
    ["matching", edge.text, null],
    ["optional_mismatch", edge.text.replace("note?:", "note:"), "AFL3404"],
    [
      "nullable_mismatch",
      edge.text.replace("note?: string?", "note?: string"),
      "AFL3404",
    ],
    [
      "missing_optional_declaration",
      edge.text.replace(/note\?:[^\n]+\n/, ""),
      "AFL3405",
    ],
    [
      "wrong_kind",
      edge.text.replace(
        /struct Data[^]*?\n\}/,
        "class Data [desc = [Class]] {}",
      ),
      "AFL3402",
    ],
    [
      "missing_impl",
      edge.text.replace("impl dep::core::lib::Data\n", ""),
      "AFL4101",
    ],
  ]) {
    const diagnostics = checkProject(
      [core, { ...edge, text }],
      context,
    ).diagnostics;
    if (code) {
      assert.ok(
        diagnostics.some((item) => item.code === code),
        name,
      );
    } else {
      assert.deepEqual(diagnostics, [], name);
    }
  }
  assert.deepEqual(checkProject([core]).diagnostics, []);
  assert.ok(
    checkProject(
      [core, edge, { ...edge, uri: "file:///contracts/other/lib.afl" }],
      {
        ...context,
        preset: {
          ...context.preset,
          edge: [...context.preset.edge, "file:///contracts/other/"],
        },
      },
    ).diagnostics.some((item) => item.code === "AFL4102"),
  );
  const position = (text, offset) => ({
    line: text.slice(0, offset).split("\n").length - 1,
    character: offset - text.lastIndexOf("\n", offset - 1) - 1,
  });
  const at = (doc, text, delta = 0) => {
    assert.ok(doc.text.includes(text), text);
    return position(doc.text, doc.text.indexOf(text) + delta);
  };
  const data = {
    uri: "file:///editor/data.afl",
    text: input.contract.replace("note?:", '"note"?:'),
  };
  const main = {
    uri: "file:///editor/lib.afl",
    text: `use data::Gift as Message
class Viewer [desc = [Viewer functionality]] {
gift: Message = {"gift-id": "default"} [desc = [Current gift]]
fn show() { self.gift.note }
}
fn create() -> Message? [return = [Message]] { {"gift-id": "one"} }
fn main() {
gift: Message = {"gift-id": "one", note: null}
gift.note
create().timeout_us
text: string = "gift-id"
}`,
  };
  const service = new LanguageService();
  service.update([data, main]);
  assert.deepEqual(service.diagnostics, []);
  assert.equal(service.documentSymbols(data.uri)[0].kind, "struct");
  assert.deepEqual(
    service.documentSymbols(data.uri)[0].children.map((item) => item.kind),
    ["field", "field", "field"],
  );
  assert.equal(
    service.definition(main.uri, at(main, "Message =")).uri,
    data.uri,
  );
  assert.equal(
    service.definition(main.uri, at(main, '"gift-id"', 2)).range.start.line,
    1,
  );
  assert.equal(
    service.definition(main.uri, at(main, "gift.note", 5)).range.start.line,
    2,
  );
  assert.equal(
    service.definition(main.uri, at(main, "create().timeout_us", 9)).range.start
      .line,
    3,
  );
  assert.ok(
    service
      .hover(main.uri, at(main, "gift.note", 5))
      .text.includes('"note"?: string?'),
  );
  assert.equal(
    service.references(data.uri, at(data, '"gift-id"', 2), false).length,
    3,
  );
  assert.equal(
    service.definition(main.uri, at(main, 'text: string = "gift-id"', 17)),
    undefined,
  );
  for (const [text, labels, kind] of [
    [
      "use data::Gift\nfn main() { gift: Gift? = null\ngift.",
      ["note", "timeout_us"],
      "field",
    ],
    ["use data::G", ["Gift"], "struct"],
    ['use data::Gift\nfn main() { gift: Gift = {r#"gift', [], null],
  ]) {
    service.update([data, { ...main, text }]);
    const items = service.completion(main.uri, position(text, text.length));
    assert.deepEqual(
      items.map((item) => item.label),
      labels,
    );
    if (kind) {
      assert.ok(items.every((item) => item.kind === kind));
    }
  }
  service.update([core, edge], context);
  assert.equal(
    service.implementations(core.uri, at(core, '"gift-id"', 2))[0].uri,
    edge.uri,
  );
  const impl = { ...edge, text: "impl dep::core::lib::D" };
  service.update([core, impl], context);
  assert.equal(
    service.completion(edge.uri, position(impl.text, impl.text.length))[0].kind,
    "struct",
  );
  service.update([
    { ...data, text: data.text.replace('"note"?:', '"note":') },
    main,
  ]);
  assert.ok(service.diagnostics.some((item) => item.code === "AFL3302"));
  return cases;
}
