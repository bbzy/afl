import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/language");
const fixtureDirectory = process.argv[3];
const root = path.dirname(path.dirname(suiteDirectory));
const checker = path.join(root, "packages/checker/dist/index.js");
const cases = [
  { name: "list", text: "for item in items() { item.id }", code: null },
  {
    name: "set",
    text: "values: set<i32> = {1, 2}\nfor value in values { value = value + 1 }",
    code: null,
  },
  {
    name: "map",
    text: 'values: map<string, Item> = {"one": {id: 1}}\nfor key, value in values { key\nvalue.id }',
    code: null,
  },
  {
    name: "nested",
    text: "values: list<list<Item>> = {{{id: 1}}}\nfor row in values { for item in row { item.id\ncontinue } }",
    code: null,
  },
  {
    name: "nullable",
    text: "values: list<Item?>? = null\nfor item in values { item.id }",
    code: null,
  },
  {
    name: "callback",
    text: "handlers: list<fn()> = {notify}\nfor handler in handlers { handler() }",
    code: null,
  },
  {
    name: "control",
    text: "for item in items() { if item.id == 0 { break }\nwhile true { continue }\nreturn }",
    code: null,
  },
  {
    name: "iterable_call_multiline",
    text: "for item in items(\n) {\nitem.id\n}",
    code: null,
  },
  {
    name: "iterable_if",
    text: "for item in if true { items() } else { items() } { item.id }",
    code: null,
  },
  { name: "escaped", text: "for `for` in items() { `for`.id }", code: null },
  {
    name: "siblings",
    text: "for item in items() { item.id }\nfor item in items() { item.id }",
    code: null,
  },
  {
    name: "local_type_name",
    text: "for items in items() { items.id }",
    code: null,
  },
  { name: "source_scope", text: "for item in item { item }", code: "AFL3203" },
  {
    name: "no_leak",
    text: "for item in items() { item.id }\nitem.id",
    code: "AFL3203",
  },
  {
    name: "no_body_leak",
    text: "for item in items() { hidden: i32 = item.id }\nhidden",
    code: "AFL3203",
  },
  {
    name: "no_shadow",
    text: "item: i32 = 1\nfor item in items() {}",
    code: "AFL3201",
  },
  {
    name: "no_inner_shadow",
    text: "for item in items() { for item in items() {} }",
    code: "AFL3201",
  },
  {
    name: "no_redeclare",
    text: "for item in items() { item: i32 = 1 }",
    code: "AFL3201",
  },
  {
    name: "duplicate_map_names",
    text: "values: map<string, i32> = {}\nfor value, value in values {}",
    code: "AFL3201",
  },
  {
    name: "map_requires_pair",
    text: "values: map<string, i32> = {}\nfor value in values {}",
    code: "AFL3208",
  },
  {
    name: "indexed_list",
    text: "for index, item in items() { index + item.id }",
    code: null,
  },
  {
    name: "indexed_escaped",
    text: "for `for`, `in` in items() { `for` + `in`.id }",
    code: null,
  },
  {
    name: "indexed_nullable",
    text: "values: list<Item?>? = null\nfor position, entry in values { position\nentry.id }",
    code: null,
  },
  {
    name: "indexed_nested",
    text: "values: list<list<Item>> = {{{id: 1}}}\nfor row_index, row in values { for column_index, item in row { row_index + column_index + item.id } }",
    code: null,
  },
  {
    name: "indexed_callback",
    text: "handlers: list<fn()> = {notify}\nfor index, handler in handlers { index\nhandler() }",
    code: null,
  },
  {
    name: "indexed_if",
    text: "for position, item in if true { items() } else { items() } { position + item.id }",
    code: null,
  },
  {
    name: "indexed_control",
    text: "for index, item in items() { if index == 0 { continue }\nif item.id == 0 { break }\nreturn }",
    code: null,
  },
  {
    name: "indexed_no_leak",
    text: "for index, item in items() {}\nindex",
    code: "AFL3203",
  },
  {
    name: "indexed_no_shadow",
    text: "index: i32 = 1\nfor index, item in items() {}",
    code: "AFL3201",
  },
  {
    name: "duplicate_list_names",
    text: "for item, item in items() {}",
    code: "AFL3201",
  },
  {
    name: "indexed_source_scope",
    text: "for index, item in index {}",
    code: "AFL3203",
  },
  {
    name: "indexed_source_before_binding",
    text: "values: list<Item> = {}\nfor values, item in values {}",
    code: "AFL3201",
  },
  {
    name: "index_not_item",
    text: "for index, item in items() { index.id }",
    code: "AFL3205",
  },
  {
    name: "set_requires_one",
    text: "values: set<Item> = {}\nfor index, item in values {}",
    code: "AFL3208",
  },
  { name: "extra_names", text: "for a, b, c in items() {}", code: "AFL3208" },
  {
    name: "string_not_collection",
    text: 'for item in "text" {}',
    code: "AFL3208",
  },
  { name: "null_not_collection", text: "for item in null {}", code: "AFL3208" },
  {
    name: "any_not_collection",
    text: "value: any = [Create]\nfor item in value {}",
    code: "AFL3208",
  },
  {
    name: "unknown_not_collection",
    text: "value = [Create]\nfor item in value {}",
    code: "AFL3208",
  },
  {
    name: "unresolved_collection",
    text: "for item in missing() {}",
    code: "AFL3203",
  },
  {
    name: "unknown_member",
    text: "for item in items() { item.missing }",
    code: "AFL3204",
  },
  {
    name: "no_direct_prose",
    text: "for item in [Create a collection] {}",
    code: "AFL1003",
  },
  { name: "no_untyped_braces", text: "for item in {1, 2} {}", code: "AFL3301" },
  {
    name: "no_value",
    text: "value: i32 = for item in items() {}",
    code: "AFL1002",
  },
  {
    name: "no_binding_type",
    text: "for item: Item in items() {}",
    code: "AFL1002",
  },
  { name: "missing_in", text: "for item items() {}", code: "AFL1002" },
  { name: "missing_name", text: "for in items() {}", code: "AFL1002" },
  {
    name: "no_loop_outside",
    text: "for item in items() {}\nbreak",
    code: "AFL1005",
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
const fixture = fixtureDirectory;
try {
  fs.writeFileSync(path.join(fixture, "config.toml"), "[dep]");
  const file = path.join(fixture, "main.afl");
  fs.writeFileSync(
    file,
    "fn main() {\n    items: list<i32> = {10, 20}\n    for index, item in items {\n        value: i32 = index + item\n    }\n}",
  );
  const cli = path.join(root, "packages/cli/bin/afl.mjs");
  for (const pair of [
    { column: 22, binding: 8 },
    { column: 30, binding: 15 },
  ]) {
    const definition = run(process.execPath, [
      cli,
      "definition",
      file,
      "--line",
      4,
      "--column",
      String(pair.column),
      "--json",
    ]);
    assert.deepEqual(definition.exit_code, 0, definition.stderr);
    const result = JSON.parse(definition.stdout);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.results[0].path, file);
    assert.deepEqual(result.results[0].range.start, {
      line: 2,
      character: pair.binding,
    });
  }
  const references = run(process.execPath, [
    cli,
    "references",
    file,
    "--line",
    3,
    "--column",
    9,
    "--json",
  ]);
  assert.deepEqual(references.exit_code, 0, references.stderr);
  const result = JSON.parse(references.stdout);
  assert.deepEqual(result.results.length, 1);
  assert.deepEqual(result.results[0].range.start, { line: 3, character: 21 });
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(
  "For checks passed: " +
    String(cases.length) +
    " syntax/dependency cases, indexed traversal, scope, CLI queries and editor services.",
);

async function exercise(input: any, args: string[]) {
  const { pathToFileURL } = await import("node:url");

  const { checkProject, parseDocument, LanguageService } = await import(
    pathToFileURL(args[0]).href
  );
  const cases = input;
  const declarations = `struct Item [desc = [Data]] { id: i32 [desc = [Identity]] }
fn items() -> list<Item> [desc = [Items]
return = [Items]]
fn notify() {}
`;
  const results = cases.map((item) => ({
    name: item.name,
    ...checkProject([
      {
        uri: "file:///loops/lib.afl",
        text: declarations + "fn main() {\n" + item.text + "\n}",
      },
    ]),
  }));
  const ast = parseDocument({
    uri: "ast",
    text: "fn main() { for key, value in entries { value } }",
  }).module.declarations[0].body.statements[0];
  assert.equal(ast.kind, "for");
  assert.deepEqual(
    ast.bindings.map((name) => name.text),
    ["key", "value"],
  );
  assert.equal(ast.iterable.kind, "name");
  const position = (text, offset) => ({
    line: text.slice(0, offset).split("\n").length - 1,
    character: offset - text.lastIndexOf("\n", offset - 1) - 1,
  });
  const at = (doc, text, delta = 0) => {
    assert.ok(doc.text.includes(text), text);
    return position(doc.text, doc.text.indexOf(text) + delta);
  };
  const data = { uri: "file:///loops/data.afl", text: declarations };
  const main = {
    uri: "file:///loops/lib.afl",
    text: `use data::items
fn main() {
 for item in items() { item.id }
}`,
  };
  const service = new LanguageService();
  service.update([data, main]);
  assert.deepEqual(service.diagnostics, []);
  assert.deepEqual(
    service.definition(main.uri, at(main, "item.id")).range.start,
    at(main, "item in"),
  );
  assert.equal(
    service.definition(main.uri, at(main, "item.id", 5)).uri,
    data.uri,
  );
  assert.equal(service.definition(main.uri, at(main, "items()")).uri, data.uri);
  assert.match(service.hover(main.uri, at(main, "item.id")).text, /item: Item/);
  assert.equal(
    service.references(main.uri, at(main, "item in"), false).length,
    1,
  );
  for (const [text, cursor, wanted, excluded] of [
    [
      "use data::items\nfn main() { for item in items() { item.",
      "item.",
      "id",
      "items",
    ],
    [
      "use data::items\nfn main() { for item in items() { it",
      "{ it",
      "item",
      null,
    ],
    [
      "use data::items\nfn main() { for item in items() {}\nit",
      "\nit",
      "items",
      "item",
    ],
    ["use data::items\nfn main() { for item in it", "in it", "items", "item"],
  ]) {
    const doc = { ...main, text };
    service.update([data, doc]);
    const completions = service.completion(
      doc.uri,
      at(doc, cursor, cursor.length),
    );
    assert.ok(
      completions.some((item) => item.label === wanted),
      text,
    );
    if (excluded) {
      assert.ok(!completions.some((item) => item.label === excluded), text);
    }
  }
  service.update([
    { ...data, text: declarations.replace("list<Item>", "map<string, Item>") },
    main,
  ]);
  assert.ok(service.diagnostics.some((item) => item.code === "AFL3208"));
  const indexed = {
    ...main,
    text: "use data::items\nfn main() {\n for ordinal, entry in items() {\n ordinal\n entry.id\n }\n}",
  };
  service.update([data, indexed]);
  assert.deepEqual(service.diagnostics, []);
  const indexUse = at(indexed, "\n ordinal", 2),
    indexBinding = at(indexed, "ordinal, entry");
  assert.deepEqual(
    service.definition(indexed.uri, indexUse).range.start,
    indexBinding,
  );
  assert.match(service.hover(indexed.uri, indexUse).text, /ordinal: i32/);
  assert.match(
    service.hover(indexed.uri, at(indexed, "entry.id")).text,
    /entry: Item/,
  );
  assert.deepEqual(
    service
      .references(indexed.uri, indexBinding, false)
      .map((ref) => ref.range.start),
    [indexUse],
  );
  assert.deepEqual(
    service.definition(indexed.uri, at(indexed, "entry.id")).range.start,
    at(indexed, "entry in"),
  );
  assert.equal(
    service.definition(indexed.uri, at(indexed, "entry.id", 6)).uri,
    data.uri,
  );
  for (const [text, cursor, wanted, excluded] of [
    [
      "use data::items\nfn main() { for ordinal, entry in items() { entry.",
      "entry.",
      "id",
      "ordinal",
    ],
    [
      "use data::items\nfn main() { for ordinal, entry in items() { ord",
      "{ ord",
      "ordinal",
      null,
    ],
    [
      "use data::items\nfn main() { for ordinal, entry in items() { ent",
      "{ ent",
      "entry",
      null,
    ],
    [
      "use data::items\nfn main() { for ordinal, entry in items() {}\n ",
      "\n ",
      "items",
      "ordinal",
    ],
    [
      "use data::items\nfn main() { for ordinal, entry in it",
      "in it",
      "items",
      "ordinal",
    ],
  ]) {
    const doc = { ...indexed, text };
    service.update([data, doc]);
    const completions = service.completion(
      doc.uri,
      at(doc, cursor, cursor.length),
    );
    assert.ok(
      completions.some((item) => item.label === wanted),
      text,
    );
    if (excluded) {
      assert.ok(!completions.some((item) => item.label === excluded), text);
    }
  }
  for (const [collection, indexType, elementType, error] of [
    ["map<string, Item>", "string", "Item", false],
    ["list<Item?>?", "i32", "Item?", false],
    ["set<Item>", "Item", "unknown", true],
    ["list<Item>", "i32", "Item", false],
  ] as [string, string, string, boolean][]) {
    service.update([
      { ...data, text: declarations.replace("list<Item>", collection) },
      indexed,
    ]);
    assert.equal(
      service.diagnostics.some((item) => item.code === "AFL3208"),
      error,
    );
    assert.ok(
      service
        .hover(indexed.uri, indexUse)
        .text.includes("ordinal: " + indexType),
    );
    assert.ok(
      service
        .hover(indexed.uri, at(indexed, "entry.id"))
        .text.includes("entry: " + elementType),
    );
  }
  return results;
}
