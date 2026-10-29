import assert from "node:assert/strict";
import * as path from "node:path";
const suiteDirectory = path.join(process.argv[2], "tests/language");
const root = path.dirname(path.dirname(suiteDirectory));
const checker = path.join(root, "packages/checker/dist/index.js");
const cases = [
  {
    name: "list_operations",
    code: null,
    text: "items: list<Item> = {{id: 1}}\nitems.add({id: 2})\nitems.insert(0, {id: 3})\nitems.set(0, {id: 4})\nitem: Item = items.get(0)\nitem.id\nsize: i32 = items.len()\npresent: bool = items.contains(item)\nposition: i32? = items.index_of(item)\nitems.remove(item)\nitems.remove_at(0)\nitems.clear()",
  },
  {
    name: "set_operations",
    code: null,
    text: "items: set<Item> = {}\nitems.add({id: 1})\npresent: bool = items.contains({id: 1})\nsize: i32 = items.len()\nitems.remove({id: 1})\nitems.clear()",
  },
  {
    name: "map_operations",
    code: null,
    text: 'items: map<string, Item> = {}\nitems.set("one", {id: 1})\npresent: bool = items.contains_key("one")\nsize: i32 = items.len()\nitem: Item? = items.get("one")\nif item != null { item.id }\nfor key in items.keys() { items.get(key).id }\nfor value in items.values() { value.id }\nitems.remove("missing")\nitems.clear()',
  },
  {
    name: "nested_collections",
    code: null,
    text: 'items: map<string, list<set<Item>>> = {}\nitems.set("one", {{{id: 1}}})\nitems.get("one").get(0).add({id: 2})\nitems.values().get(0).get(0).clear()',
  },
  {
    name: "method_reference",
    code: null,
    text: "items: list<Item> = {}\nreader: fn(i32) -> Item = items.get\nreader(0).id\nconsumer: fn(Item) = items.add\nconsumer({id: 1})",
  },
  {
    name: "bound_callback",
    code: null,
    text: "items: list<Item> = {}\naccept(items.add)",
  },
  {
    name: "callback_storage",
    code: null,
    text: 'handlers: map<string, fn(i32) -> Item> = {}\nhandlers.set("make", make)\nhandlers.get("make")(1).id\nhandlers.values().get(0)(1).id',
  },
  {
    name: "nullable",
    code: null,
    text: 'items: list<Item?>? = null\nitems.get(0).id\nitems.set(0, null)\nmapping: map<string, Item?>? = null\nmapping.get("one").id\nmapping.values().get(0).id',
  },
  {
    name: "any_elements",
    code: null,
    text: 'items: list<any> = {}\nitems.add(1)\nitems.add("one")\nelement = [An element]\nitems.contains(element)',
  },
  {
    name: "multiline",
    code: null,
    text: 'items: map<string, Item> = {}\nitems.set(\n r#"one, two"#,\n {id: 1},\n)',
  },
  {
    name: "property_receiver",
    code: null,
    text: "store: Store = {}\nstore.items.add({id: 1})\nstore.items.get(0).id",
  },
  { name: "call_receiver", code: null, text: "make_items().get(0).id" },
  {
    name: "branch_receiver",
    code: null,
    text: "(if true { make_items() } else { make_items() }).get(0).id",
  },
  {
    name: "source_method_same_name",
    code: null,
    text: "object: Custom = {}\nobject.get().id",
  },
  {
    name: "foreach_remove",
    code: null,
    text: "items: list<Item> = make_items()\nfor item in items {\n if item.id == 0 { items.remove(item) }\n}",
  },
  {
    name: "no_bounds_analysis",
    code: null,
    text: "items: list<i32> = {}\nitems.get(-1)\nitems.set(100, 1)\nitems.insert(-1, 1)\nitems.remove_at(100)",
  },
  {
    name: "no_general_type_check",
    code: null,
    text: 'items: list<i32> = {}\nitems.add("Target conversion belongs to the Agent")',
  },
  {
    name: "unknown_method",
    code: "AFL3204",
    text: "items: list<i32> = {}\nitems.missing()",
  },
  {
    name: "list_map_method",
    code: "AFL3204",
    text: "items: list<i32> = {}\nitems.keys()",
  },
  {
    name: "set_no_index",
    code: "AFL3204",
    text: "items: set<i32> = {}\nitems.get(0)",
  },
  {
    name: "map_no_add",
    code: "AFL3204",
    text: "items: map<string, i32> = {}\nitems.add(1)",
  },
  {
    name: "any_no_methods",
    code: "AFL3205",
    text: "items: any = [Create]\nitems.clear()",
  },
  {
    name: "prose_no_methods",
    code: "AFL3205",
    text: "items = [Create list]\nitems.clear()",
  },
  { name: "string_no_methods", code: "AFL3205", text: '"text".len()' },
  {
    name: "class_no_builtin_methods",
    code: "AFL3204",
    text: "item: Item = {id: 1}\nitem.clear()",
  },
  {
    name: "no_method_assignment",
    code: "AFL3204",
    text: "items: list<i32> = {}\nitems.add = [Replace method]",
  },
  {
    name: "no_method_assignment_map",
    code: "AFL3204",
    text: "items: map<string, i32> = {}\nitems.get = [Replace method]",
  },
  {
    name: "extra_argument",
    code: "AFL3206",
    text: "items: list<i32> = {}\nitems.len(1)",
  },
  {
    name: "missing_argument",
    code: "AFL3206",
    text: 'items: map<string, Item> = {}\nitems.set("one")',
  },
  {
    name: "no_clear_result",
    code: "AFL3303",
    text: "items: set<i32> = {}\nvalue: any = items.clear()",
  },
  {
    name: "no_remove_result",
    code: "AFL3303",
    text: "items: list<i32> = {}\nvalue: any = items.remove(1)",
  },
  {
    name: "no_multiple_results",
    code: "AFL3303",
    text: 'items: map<string, Item> = {}\nvalue: Item?, found: bool = items.get("one")',
  },
  {
    name: "bad_element_initializer",
    code: "AFL3302",
    text: "items: list<Item> = {}\nitems.add({})",
  },
  {
    name: "bad_map_value_initializer",
    code: "AFL3302",
    text: 'items: map<string, Item> = {}\nitems.set("one", {})',
  },
  {
    name: "bad_map_key_initializer",
    code: "AFL3302",
    text: "items: map<Item, string> = {}\nitems.get({})",
  },
  {
    name: "bad_set_initializer",
    code: "AFL3302",
    text: "items: set<Item> = {}\nitems.remove({})",
  },
  {
    name: "unknown_argument",
    code: "AFL3203",
    text: "items: list<i32> = {}\nitems.add(missing)",
  },
  {
    name: "unknown_element_type",
    code: "AFL3202",
    text: "items: list<Missing> = {}\nitems.clear()",
  },
  {
    name: "wrong_callback",
    code: "AFL3207",
    text: "items: list<fn(i32) -> Item> = {}\nitems.add(notify)",
  },
  {
    name: "wrong_method_reference",
    code: "AFL3207",
    text: "items: list<Item> = {}\nreader: fn(string) -> Item = items.get",
  },
  {
    name: "callback_result_count",
    code: "AFL3206",
    text: 'items: map<string, fn(i32) -> Item> = {}\nitems.get("one")()',
  },
  {
    name: "void_argument",
    code: "AFL3303",
    text: "items: list<i32> = {}\nitems.get(notify())",
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
  "Collection methods passed: " +
    String(cases.length) +
    " contracts and diagnostics, typed completion, navigation, hover, signatures and edits.",
);

async function exercise(input: any, args: string[]) {
  const { pathToFileURL } = await import("node:url");

  const { checkProject, LanguageService } = await import(
    pathToFileURL(args[0]).href
  );
  const cases = input;
  const declarations = `struct Item [desc = [Data]] { id: i32 [desc = [Identity]] }
struct Store [desc = [Storage]] { items: list<Item> = {} [desc = [Items]] }
class Custom [desc = [Custom methods]] { fn get() -> Item [return = [Item]] { return {id: 1} } }
fn make(id: i32) -> Item [id = [Identity]\nreturn = [Item]] { return {id: id} }
fn make_items() -> list<Item> [return = [Items]] { return {{id: 1}} }
fn notify() {}
fn accept(consumer: fn(Item)) [consumer = [Consumer]] {}
`;
  const results = cases.map((item) => ({
    name: item.name,
    ...checkProject([
      {
        uri: "file:///methods/lib.afl",
        text: declarations + "fn main() {\n" + item.text + "\n}",
      },
    ]),
  }));
  const service = new LanguageService();
  const doc = {
    uri: "file:///methods/lib.afl",
    text:
      declarations +
      `fn main() {
 items: map<string, Item?>? = null
 value: Item? = items.get("one")
 value.id
 items.values().get(0).id
 items.set("one", {id: 1})
 keys: list<string> = items.keys()
 index: i32? = keys.index_of("one")
 size: i32 = keys.len()
 present: bool = items.contains_key("one")
}`,
  };
  const position = (text, offset) => ({
    line: text.slice(0, offset).split("\n").length - 1,
    character: offset - text.lastIndexOf("\n", offset - 1) - 1,
  });
  const at = (doc, text, delta = 0) => {
    assert.ok(doc.text.includes(text), text);
    return position(doc.text, doc.text.indexOf(text) + delta);
  };
  service.update([doc]);
  assert.deepEqual(service.diagnostics, []);
  assert.match(
    service.hover(doc.uri, at(doc, "value.id")).text,
    /value: Item\?/,
  );
  assert.match(
    service.hover(doc.uri, at(doc, "index: i32?")).text,
    /index: i32\?/,
  );
  assert.match(service.hover(doc.uri, at(doc, "size: i32")).text, /size: i32/);
  assert.match(
    service.hover(doc.uri, at(doc, "present: bool")).text,
    /present: bool/,
  );
  assert.match(
    service.hover(doc.uri, at(doc, "keys: list<string>")).text,
    /keys: list<string>/,
  );
  const hover = service.hover(doc.uri, at(doc, "items.get", 7));
  assert.match(
    hover.text,
    /fn map<string, Item\?>\?\.get\(key: string\) -> Item\?/,
  );
  assert.ok(!hover.text.includes("??"));
  assert.match(hover.text, /absent/);
  assert.equal(service.definition(doc.uri, at(doc, "items.get", 7)), undefined);
  assert.deepEqual(service.references(doc.uri, at(doc, "items.get", 7)), []);
  assert.deepEqual(
    service.definition(doc.uri, at(doc, "value.id", 7)).range.start,
    at(doc, "id: i32"),
  );
  assert.deepEqual(
    service.definition(doc.uri, at(doc, "get(0).id", 8)).range.start,
    at(doc, "id: i32"),
  );
  assert.ok(
    service.references(doc.uri, at(doc, "items: map"), false).length >= 5,
  );
  const signature = service.signatureHelp(
    doc.uri,
    at(doc, 'items.set("one",', 16),
  );
  assert.equal(
    signature.label,
    "fn map<string, Item?>?.set(key: string, value: Item?)",
  );
  assert.equal(signature.activeParameter, 1);
  assert.equal(signature.parameters[1].label, "value: Item?");
  for (const [type, names] of [
    [
      "list<Item>",
      [
        "add",
        "clear",
        "contains",
        "get",
        "index_of",
        "insert",
        "len",
        "remove",
        "remove_at",
        "set",
        "sort",
        "sort_by",
        "sorted",
        "sorted_by",
      ],
    ],
    ["set<Item>", ["add", "clear", "contains", "len", "remove"]],
    [
      "map<string, Item>",
      [
        "clear",
        "contains_key",
        "get",
        "keys",
        "len",
        "remove",
        "set",
        "values",
      ],
    ],
  ] as [string, string[]][]) {
    const partial = {
      ...doc,
      text: declarations + `fn main() { items: ${type} = {}\nitems.`,
    };
    service.update([partial]);
    const completion = service.completion(
      partial.uri,
      position(partial.text, partial.text.length),
    );
    assert.deepEqual(completion.map((item) => item.label).sort(), names.sort());
    assert.ok(
      completion.every(
        (item) => item.kind === "method" && item.documentation.length > 0,
      ),
    );
    assert.equal(
      completion.find((item) => item.label === "len").detail,
      `fn ${type}.len() -> i32`,
    );
  }
  for (const [source, names] of [
    ["make_items().", ["get", "insert"]],
    ["items: map<string, Item> = {}\nitems.values().", ["get", "insert"]],
    ["items: map<string, Item> = {}\nitems.values().get(0).", ["id"]],
    ['items: map<string, Item> = {}\nitems.get("one").', ["id"]],
    ["store: Store = {}\nstore.items.", ["get", "insert"]],
  ] as [string, string[]][]) {
    const partial = { ...doc, text: declarations + `fn main() { ${source}` };
    service.update([partial]);
    const completions = service.completion(
      partial.uri,
      position(partial.text, partial.text.length),
    );
    for (const name of names) {
      assert.ok(
        completions.some((item) => item.label === name),
        source + " " + name,
      );
    }
  }
  const edit = {
    ...doc,
    text:
      declarations + "fn main() { items: list<Item> = {}\nitems.get(0).id }",
  };
  service.update([edit]);
  assert.deepEqual(service.diagnostics, []);
  service.update([
    {
      ...edit,
      text: edit.text.replace(
        "fn main() { items: list<Item>",
        "fn main() { items: set<Item>",
      ),
    },
  ]);
  assert.ok(service.diagnostics.some((item) => item.code === "AFL3204"));
  service.update([edit]);
  assert.deepEqual(service.diagnostics, []);
  const raw = {
    ...doc,
    text:
      declarations +
      'fn main() { items: map<string, Item> = {}\nitems.set(r#"one, two"#, ',
  };
  service.update([raw]);
  assert.equal(
    service.signatureHelp(raw.uri, position(raw.text, raw.text.length))
      .activeParameter,
    1,
  );
  const callbacks = {
    ...doc,
    text:
      declarations +
      'fn main() { items: map<string, fn() -> i32> = {}\nvalue: (fn() -> i32)? = items.get("one") }',
  };
  service.update([callbacks]);
  assert.match(
    service.hover(callbacks.uri, at(callbacks, "value: (fn() -> i32)?")).text,
    /value: \(fn\(\) -> i32\)\?/,
  );
  return results;
}
