use std/assert

def main [] {
  let root = ($env.FILE_PWD | path dirname | path dirname)
  let checker = ($root | path join "packages/checker/dist/index.js")
  let cases = [
    {name: list_operations, code: null, text: 'items: list<Item> = {{id: 1}}
items.add({id: 2})
items.insert(0, {id: 3})
items.set(0, {id: 4})
item: Item = items.get(0)
item.id
size: i32 = items.len()
present: bool = items.contains(item)
position: i32? = items.index_of(item)
items.remove(item)
items.remove_at(0)
items.clear()'}
    {name: set_operations, code: null, text: 'items: set<Item> = {}
items.add({id: 1})
present: bool = items.contains({id: 1})
size: i32 = items.len()
items.remove({id: 1})
items.clear()'}
    {name: map_operations, code: null, text: 'items: map<string, Item> = {}
items.set("one", {id: 1})
present: bool = items.contains_key("one")
size: i32 = items.len()
item: Item? = items.get("one")
if item != null { item.id }
for key in items.keys() { items.get(key).id }
for value in items.values() { value.id }
items.remove("missing")
items.clear()'}
    {name: nested_collections, code: null, text: 'items: map<string, list<set<Item>>> = {}
items.set("one", {{{id: 1}}})
items.get("one").get(0).add({id: 2})
items.values().get(0).get(0).clear()'}
    {name: method_reference, code: null, text: 'items: list<Item> = {}
reader: fn(i32) -> Item = items.get
reader(0).id
consumer: fn(Item) = items.add
consumer({id: 1})'}
    {name: bound_callback, code: null, text: 'items: list<Item> = {}
accept(items.add)'}
    {name: callback_storage, code: null, text: 'handlers: map<string, fn(i32) -> Item> = {}
handlers.set("make", make)
handlers.get("make")(1).id
handlers.values().get(0)(1).id'}
    {name: nullable, code: null, text: 'items: list<Item?>? = null
items.get(0).id
items.set(0, null)
mapping: map<string, Item?>? = null
mapping.get("one").id
mapping.values().get(0).id'}
    {name: any_elements, code: null, text: 'items: list<any> = {}
items.add(1)
items.add("one")
element = [An element]
items.contains(element)'}
    {name: multiline, code: null, text: 'items: map<string, Item> = {}
items.set(
 r#"one, two"#,
 {id: 1},
)'}
    {name: property_receiver, code: null, text: 'store: Store = {}
store.items.add({id: 1})
store.items.get(0).id'}
    {name: call_receiver, code: null, text: 'make_items().get(0).id'}
    {name: branch_receiver, code: null, text: '(if true { make_items() } else { make_items() }).get(0).id'}
    {name: source_method_same_name, code: null, text: 'object: Custom = {}
object.get().id'}
    {name: foreach_remove, code: null, text: 'items: list<Item> = make_items()
for item in items {
 if item.id == 0 { items.remove(item) }
}'}
    {name: no_bounds_analysis, code: null, text: 'items: list<i32> = {}
items.get(-1)
items.set(100, 1)
items.insert(-1, 1)
items.remove_at(100)'}
    {name: no_general_type_check, code: null, text: 'items: list<i32> = {}
items.add("Target conversion belongs to the Agent")'}
    {name: unknown_method, code: AFL3204, text: 'items: list<i32> = {}
items.missing()'}
    {name: list_map_method, code: AFL3204, text: 'items: list<i32> = {}
items.keys()'}
    {name: set_no_index, code: AFL3204, text: 'items: set<i32> = {}
items.get(0)'}
    {name: map_no_add, code: AFL3204, text: 'items: map<string, i32> = {}
items.add(1)'}
    {name: any_no_methods, code: AFL3205, text: 'items: any = [Create]
items.clear()'}
    {name: prose_no_methods, code: AFL3205, text: 'items = [Create list]
items.clear()'}
    {name: string_no_methods, code: AFL3205, text: '"text".len()'}
    {name: class_no_builtin_methods, code: AFL3204, text: 'item: Item = {id: 1}
item.clear()'}
    {name: no_method_assignment, code: AFL3204, text: 'items: list<i32> = {}
items.add = [Replace method]'}
    {name: no_method_assignment_map, code: AFL3204, text: 'items: map<string, i32> = {}
items.get = [Replace method]'}
    {name: extra_argument, code: AFL3206, text: 'items: list<i32> = {}
items.len(1)'}
    {name: missing_argument, code: AFL3206, text: 'items: map<string, Item> = {}
items.set("one")'}
    {name: no_clear_result, code: AFL3303, text: 'items: set<i32> = {}
value: any = items.clear()'}
    {name: no_remove_result, code: AFL3303, text: 'items: list<i32> = {}
value: any = items.remove(1)'}
    {name: no_multiple_results, code: AFL3303, text: 'items: map<string, Item> = {}
value: Item?, found: bool = items.get("one")'}
    {name: bad_element_initializer, code: AFL3302, text: 'items: list<Item> = {}
items.add({})'}
    {name: bad_map_value_initializer, code: AFL3302, text: 'items: map<string, Item> = {}
items.set("one", {})'}
    {name: bad_map_key_initializer, code: AFL3302, text: 'items: map<Item, string> = {}
items.get({})'}
    {name: bad_set_initializer, code: AFL3302, text: 'items: set<Item> = {}
items.remove({})'}
    {name: unknown_argument, code: AFL3203, text: 'items: list<i32> = {}
items.add(missing)'}
    {name: unknown_element_type, code: AFL3202, text: 'items: list<Missing> = {}
items.clear()'}
    {name: wrong_callback, code: AFL3207, text: 'items: list<fn(i32) -> Item> = {}
items.add(notify)'}
    {name: wrong_method_reference, code: AFL3207, text: 'items: list<Item> = {}
reader: fn(string) -> Item = items.get'}
    {name: callback_result_count, code: AFL3206, text: 'items: map<string, fn(i32) -> Item> = {}
items.get("one")()'}
    {name: void_argument, code: AFL3303, text: 'items: list<i32> = {}
items.get(notify())'}
  ]
  let bridge = r###'
    import {readFileSync} from "node:fs";
    import {pathToFileURL} from "node:url";
    import assert from "node:assert/strict";
    const {checkProject, LanguageService} = await import(pathToFileURL(process.argv[1]).href);
    const cases = JSON.parse(readFileSync(0, "utf8"));
    const declarations = `struct Item [desc = [Data]] { id: i32 [desc = [Identity]] }
struct Store [desc = [Storage]] { items: list<Item> = {} [desc = [Items]] }
class Custom [desc = [Custom methods]] { fn get() -> Item [return = [Item]] { return {id: 1} } }
fn make(id: i32) -> Item [id = [Identity]\nreturn = [Item]] { return {id: id} }
fn make_items() -> list<Item> [return = [Items]] { return {{id: 1}} }
fn notify() {}
fn accept(consumer: fn(Item)) [consumer = [Consumer]] {}
`;
    const results = cases.map(item => ({name: item.name, ...checkProject([
      {uri: "file:///methods/lib.afl", text: declarations + "fn main() {\n" + item.text + "\n}"},
    ])}));
    const service = new LanguageService();
    const doc = {uri: "file:///methods/lib.afl", text: declarations + `fn main() {
 items: map<string, Item?>? = null
 value: Item? = items.get("one")
 value.id
 items.values().get(0).id
 items.set("one", {id: 1})
 keys: list<string> = items.keys()
 index: i32? = keys.index_of("one")
 size: i32 = keys.len()
 present: bool = items.contains_key("one")
}`};
    const position = (text, offset) => ({line: text.slice(0, offset).split("\n").length - 1, character: offset - text.lastIndexOf("\n", offset - 1) - 1});
    const at = (doc, text, delta = 0) => { assert.ok(doc.text.includes(text), text); return position(doc.text, doc.text.indexOf(text) + delta); };
    service.update([doc]);
    assert.deepEqual(service.diagnostics, []);
    assert.match(service.hover(doc.uri, at(doc, "value.id")).text, /value: Item\?/);
    assert.match(service.hover(doc.uri, at(doc, "index: i32?")).text, /index: i32\?/);
    assert.match(service.hover(doc.uri, at(doc, "size: i32")).text, /size: i32/);
    assert.match(service.hover(doc.uri, at(doc, "present: bool")).text, /present: bool/);
    assert.match(service.hover(doc.uri, at(doc, "keys: list<string>")).text, /keys: list<string>/);
    const hover = service.hover(doc.uri, at(doc, "items.get", 7));
    assert.match(hover.text, /fn map<string, Item\?>\?\.get\(key: string\) -> Item\?/);
    assert.ok(!hover.text.includes("??"));
    assert.match(hover.text, /absent/);
    assert.equal(service.definition(doc.uri, at(doc, "items.get", 7)), undefined);
    assert.deepEqual(service.references(doc.uri, at(doc, "items.get", 7)), []);
    assert.deepEqual(service.definition(doc.uri, at(doc, "value.id", 7)).range.start, at(doc, "id: i32"));
    assert.deepEqual(service.definition(doc.uri, at(doc, "get(0).id", 8)).range.start, at(doc, "id: i32"));
    assert.ok(service.references(doc.uri, at(doc, "items: map"), false).length >= 5);
    const signature = service.signatureHelp(doc.uri, at(doc, "items.set(\"one\",", 16));
    assert.equal(signature.label, "fn map<string, Item?>?.set(key: string, value: Item?)");
    assert.equal(signature.activeParameter, 1);
    assert.equal(signature.parameters[1].label, "value: Item?");
    for (const [type, names] of [
      ["list<Item>", ["add", "clear", "contains", "get", "index_of", "insert", "len", "remove", "remove_at", "set", "sort", "sort_by", "sorted", "sorted_by"]],
      ["set<Item>", ["add", "clear", "contains", "len", "remove"]],
      ["map<string, Item>", ["clear", "contains_key", "get", "keys", "len", "remove", "set", "values"]],
    ]) {
      const partial = {...doc, text: declarations + `fn main() { items: ${type} = {}\nitems.`};
      service.update([partial]);
      const completion = service.completion(partial.uri, position(partial.text, partial.text.length));
      assert.deepEqual(completion.map(item => item.label).sort(), names.sort());
      assert.ok(completion.every(item => item.kind === "method" && item.documentation.length > 0));
      assert.equal(completion.find(item => item.label === "len").detail, `fn ${type}.len() -> i32`);
    }
    for (const [source, names] of [
      ["make_items().", ["get", "insert"]],
      ["items: map<string, Item> = {}\nitems.values().", ["get", "insert"]],
      ["items: map<string, Item> = {}\nitems.values().get(0).", ["id"]],
      ["items: map<string, Item> = {}\nitems.get(\"one\").", ["id"]],
      ["store: Store = {}\nstore.items.", ["get", "insert"]],
    ]) {
      const partial = {...doc, text: declarations + `fn main() { ${source}`};
      service.update([partial]);
      const completions = service.completion(partial.uri, position(partial.text, partial.text.length));
      for (const name of names) assert.ok(completions.some(item => item.label === name), source + " " + name);
    }
    const edit = {...doc, text: declarations + "fn main() { items: list<Item> = {}\nitems.get(0).id }"};
    service.update([edit]); assert.deepEqual(service.diagnostics, []);
    service.update([{...edit, text: edit.text.replace("fn main() { items: list<Item>", "fn main() { items: set<Item>")}]);
    assert.ok(service.diagnostics.some(item => item.code === "AFL3204"));
    service.update([edit]); assert.deepEqual(service.diagnostics, []);
    const raw = {...doc, text: declarations + "fn main() { items: map<string, Item> = {}\nitems.set(r#\"one, two\"#, "};
    service.update([raw]);
    assert.equal(service.signatureHelp(raw.uri, position(raw.text, raw.text.length)).activeParameter, 1);
    const callbacks = {...doc, text: declarations + "fn main() { items: map<string, fn() -> i32> = {}\nvalue: (fn() -> i32)? = items.get(\"one\") }"};
    service.update([callbacks]);
    assert.match(service.hover(callbacks.uri, at(callbacks, "value: (fn() -> i32)?")).text, /value: \(fn\(\) -> i32\)\?/);
    console.log(JSON.stringify(results));
  '###
  let run = ($cases | to json | ^node --input-type=module -e $bridge $checker | complete)
  if $run.exit_code != 0 { error make {msg: $run.stderr} }
  let results = ($run.stdout | from json)
  for case in $cases {
    let diagnostics = ($results | where name == $case.name | first | get diagnostics)
    if $case.code == null { assert equal $diagnostics [] $case.name } else {
      assert ($case.code in ($diagnostics | get code)) $"($case.name): ($diagnostics | to json --raw)"
    }
  }
  print $"Collection methods passed: ($cases | length) contracts and diagnostics, typed completion, navigation, hover, signatures and edits."
}
