use std/assert

def main [] {
  let root = ($env.FILE_PWD | path dirname | path dirname)
  let cases = [
    {name: return_initializer, text: 'struct Entry [desc = [Entry]] {
  title: string [desc = [Title]]
  children: list<Entry> = {} [desc = [Children]]
}
fn direct() -> Entry [return = [Entry]] {
  return {title: "outer", children: {{title: r#"nested"#}}}
}
fn after() {}', probes: [
      {text: 'return {', scope: keyword.control.afl}
      {text: 'title: "outer"', scope: variable.other.property.afl}
      {text: outer, scope: string.quoted.double.afl}
      {text: nested, scope: string.quoted.double.raw.afl}
      {text: after, scope: entity.name.function.afl}
    ]}
    {name: static_constants, text: 'const LIMIT: i32 = 100 [desc = [Global limit]]
class Counter [desc = [Counter]] {
    value: i32 = 0 [desc = [Value]]
    static total: i32 = 0 [desc = [Shared total]]
    const MAX: i32 = LIMIT [desc = [Maximum]]
    fn increment() {
        const step: i32 = 1
        Counter.total = Counter.total + step
    }
}
fn after() {}', probes: [
      {text: const, scope: storage.modifier.afl}
      {text: LIMIT, scope: variable.other.constant.afl}
      {text: 'Global limit', scope: comment.block.documentation.afl}
      {text: static, scope: storage.modifier.afl}
      {text: total, scope: variable.other.property.afl}
      {text: MAX, scope: variable.other.constant.afl}
      {text: 'Shared total', scope: comment.block.documentation.afl}
      {text: Maximum, scope: comment.block.documentation.afl}
      {text: step, scope: variable.other.readwrite.afl}
      {text: after, scope: entity.name.function.afl}
    ]}
    {name: description_links, text: 'fn example() [desc = [See {@dep::core::ui::show}]] {
    [Nested [Link {@example}]; text after]
    r#[Keep {@raw_target}]#
    text: string = "{@string_target}"
    [Broken {@unfinished
     ordinary continuation]
    [Broken {@missing_close]
    ready: bool = true
}', probes: [
      {text: 'dep::core', scope: markup.underline.link.afl}
      {text: 'example}', scope: markup.underline.link.afl}
      {text: raw_target, scope: comment.block.documentation.raw.afl}
      {text: string_target, scope: string.quoted.double.afl}
      {text: continuation, scope: comment.block.documentation.afl}
      {text: ready, scope: variable.other.readwrite.afl}
    ]}
    {name: collection_methods, text: 'fn execute() {
items: list<i32> = {1, 2}
items.add(3)
items.get(0)
mapping: map<string, i32> = {}
mapping.set("one", 1)
mapping.values().remove_at(0)
[Remove items matching a business condition]
}', probes: [
      {text: add, scope: entity.name.function.afl}
      {text: get, scope: entity.name.function.afl}
      {text: values, scope: entity.name.function.afl}
      {text: remove_at, scope: entity.name.function.afl}
      {text: one, scope: string.quoted.double.afl}
      {text: Remove, scope: comment.block.documentation.afl}
    ]}
    {name: when_branches, text: 'struct Options [desc = [Options]] {
value: i32 = when {
    true -> { 1 }
    else -> { 2 }
} [desc = [Default value]]
}
fn execute() {
    message: string = when {
        count == 0 -> { "empty" }
        else -> { r#"ready"# }
    }
    for item in items {
        when
        {
            item.done -> { continue }
            else -> { r#[Process ] [ as text]# }
        }
    }
}', probes: [
      {text: when, scope: keyword.control.afl}
      {text: '-> {', scope: keyword.operator.branch.afl}
      {text: 'Default value', scope: comment.block.documentation.afl}
      {text: message, scope: variable.other.readwrite.afl}
      {text: empty, scope: string.quoted.double.afl}
      {text: ready, scope: string.quoted.double.raw.afl}
      {text: done, scope: variable.other.property.afl}
      {text: continue, scope: keyword.control.afl}
      {text: Process, scope: comment.block.documentation.raw.afl}
    ]}
    {name: for_loop, text: 'fn execute() {
for key, value in entries {
    [Process the entry]
    value.run()
    continue
}
}', probes: [
      {text: for, scope: keyword.control.afl}
      {text: in, scope: keyword.control.afl}
      {text: key, scope: variable.other.readwrite.afl}
      {text: value, scope: variable.other.readwrite.afl}
      {text: Process, scope: comment.block.documentation.afl}
      {text: run, scope: entity.name.function.afl}
      {text: continue, scope: keyword.control.afl}
    ]}
    {name: structs, text: 'struct Gift [desc = [Gift protocol]] {
"gift-id": string [desc = [Identity]]
note?: string? [desc = [Note]]
timeout: i64 = 10000 [desc = [Timeout]]
r##"raw
key"##?: string = r#"value"# [desc = [Raw key]]
context: any = [Create context] [desc = [Context]]
}
class Viewer [desc = [Viewer]] {
gift: Gift [desc = [Current gift]]
fn show() { self.gift.note }
}', probes: [
      {text: struct, scope: storage.type.struct.afl}
      {text: Gift, scope: entity.name.type.struct.afl}
      {text: gift-id, scope: string.quoted.double.afl}
      {text: Identity, scope: comment.block.documentation.afl}
      {text: note, scope: variable.other.property.afl}
      {text: '?', scope: keyword.operator.field.optional.afl}
      {text: '10000', scope: constant.numeric.afl}
      {text: raw, scope: string.quoted.double.raw.afl}
      {text: value, scope: string.quoted.double.raw.afl}
      {text: 'Raw key', scope: comment.block.documentation.afl}
      {text: Context, scope: comment.block.documentation.afl}
      {text: Viewer, scope: entity.name.type.class.afl}
      {text: show, scope: entity.name.function.afl}
    ]}
    {name: raw_literals, text: 'class Raw [desc = r##[Class ]# " \ text]##] {
pattern: string = r#"\d+\.\d+"# [desc = r#[Pattern]#]
json: string = r##"{"name": "demo", "marker": "\"#"}
fn hidden() {} [still text]"## [desc = [JSON]]
context: any = r##[Keep ]# and unmatched [ " \]## [desc = [Context]]
fn next() { r#[Action]# }
}', probes: [
      {text: Class, scope: comment.block.documentation.raw.afl}
      {text: '\d', scope: string.quoted.double.raw.afl}
      {text: hidden, scope: string.quoted.double.raw.afl}
      {text: JSON, scope: comment.block.documentation.afl}
      {text: Keep, scope: comment.block.documentation.raw.afl}
      {text: Context, scope: comment.block.documentation.afl}
      {text: next, scope: entity.name.function.afl}
      {text: Action, scope: comment.block.documentation.raw.afl}
    ]}
    {name: raw_call, text: 'fn main() { work(r##"a "# ,
b ) [ \n"##, r#"value"#)
r: string = r#"literal"#
r#[Action]#
return
}', probes: [
      {text: work, scope: entity.name.function.afl}
      {text: '\n', scope: string.quoted.double.raw.afl}
      {text: literal, scope: string.quoted.double.raw.afl}
      {text: Action, scope: comment.block.documentation.raw.afl}
      {text: return, scope: keyword.control.afl}
    ]}
    {name: property_defaults, text: 'class Config [desc = [Config]] {
timeout: i64 = 10000 [desc = [Timeout]]
callback: fn() = notify [desc = [Action]]
message: string = "hello" [desc = [Message]]
enabled: bool = true [desc = [Enabled]]
optional: string? = null [desc = [Optional]]
items: list<i32> = {
    7,
} [desc = [Items]]
value: any = [Create a value] [desc = [Context]]
raw: any = r#[Raw content]# [desc = [Raw context]]
next: i32 [desc = [Required]]
fn work() {}
}', probes: [
      {text: timeout, scope: variable.other.property.afl}
      {text: '10000', scope: constant.numeric.afl}
      {text: notify, scope: variable.other.readwrite.afl}
      {text: hello, scope: string.quoted.double.afl}
      {text: true, scope: constant.language.boolean.afl}
      {text: "null", scope: constant.language.null.afl}
      {text: '7', scope: constant.numeric.afl}
      {text: Context, scope: comment.block.documentation.afl}
      {text: 'Raw content', scope: comment.block.documentation.raw.afl}
      {text: next, scope: variable.other.property.afl}
      {text: work, scope: entity.name.function.afl}
    ]}
    {name: property_default_call, text: 'class Config [desc = [Config]] {
value: i32 = get(
    123,
) [desc = [Result]]
choice: i32 = if true { 1 }
else { 2 } [desc = [Choice]]
}', probes: [
      {text: get, scope: entity.name.function.afl}
      {text: '123', scope: constant.numeric.afl}
      {text: Result, scope: comment.block.documentation.afl}
      {text: else, scope: keyword.control.afl}
      {text: Choice, scope: comment.block.documentation.afl}
    ]}
    {name: signature, text: 'extern fn add(`if`: i32) -> sum: i32 [desc = [Add] `if` = [Input] sum = [Output]]', probes: [
      {text: extern, scope: storage.modifier.afl}
      {text: fn, scope: storage.type.function.afl}
      {text: add, scope: entity.name.function.afl}
      {text: '`if`', scope: variable.parameter.afl}
      {text: i32, scope: support.type.primitive.afl}
      {text: sum, scope: variable.parameter.afl}
      {text: desc, scope: keyword.other.documentation.afl}
      {text: Add, scope: comment.block.documentation.afl}
    ]}
    {name: class, text: 'class counter [desc = [Counter]] { base: i32 [desc = [Initial value]] }', probes: [
      {text: counter, scope: entity.name.type.class.afl}
      {text: base, scope: variable.other.property.afl}
      {text: Initial, scope: comment.block.documentation.afl}
    ]}
    {name: body, text: 'fn main() { items: list<map<string, User>> = {}', probes: [
      {text: items, scope: variable.other.readwrite.afl}
      {text: list, scope: support.type.primitive.afl}
      {text: User, scope: entity.name.type.afl}
    ]}
    {name: expression, text: 'fn main() { if true { self.show(1.5) } else { return } }', probes: [
      {text: if, scope: keyword.control.afl}
      {text: true, scope: constant.language.boolean.afl}
      {text: self, scope: variable.language.this.afl}
      {text: show, scope: entity.name.function.afl}
      {text: '1.5', scope: constant.numeric.afl}
      {text: else, scope: keyword.control.afl}
    ]}
    {name: nullable, text: 'fn work(items: list<User?>?) -> string? [items = [Users]
return = [Name]] { value: string? = null }', probes: [
      {text: User, scope: entity.name.type.afl}
      {text: '?', scope: keyword.operator.type.nullable.afl}
      {text: "null", scope: constant.language.null.afl}
    ]}
    {name: escaped_null, text: 'fn main() { `null`: string? = null }', probes: [
      {text: '`null`', scope: variable.other.readwrite.afl}
    ]}
    {name: callback, text: 'fn work(callback: fn(i32, User?) -> (bool, string), fallback: (fn() -> string)?) [callback = [Action]
fallback = [Optional fallback]] { callback(1, null) }', probes: [
      {text: User, scope: entity.name.type.afl}
      {text: bool, scope: support.type.primitive.afl}
      {text: fallback, scope: variable.parameter.afl}
      {text: Action, scope: comment.block.documentation.afl}
    ]}
    {name: multiline_callback_result, text: 'fn factory() ->
fn(User?) -> bool [return = [Callback]] { [Create callback] }', probes: [
      {text: User, scope: entity.name.type.afl}
      {text: Callback, scope: comment.block.documentation.afl}
    ]}
    {name: escaped, text: 'fn main() { `return` = `if` }', probes: [
      {text: '`return`', scope: variable.other.readwrite.afl}
      {text: '`if`', scope: variable.other.readwrite.afl}
    ]}
    {name: ordinary, text: 'fn main() { [if true [nested [[[words]]] words] \] \[ \\ end] return }', probes: [
      {text: if, scope: comment.block.documentation.afl}
      {text: words, scope: comment.block.documentation.afl}
      {text: '\]', scope: constant.character.escape.afl}
      {text: return, scope: keyword.control.afl}
    ]}
    {name: raw, text: 'fn main() { r#[if "quotes" [ \]# return }', probes: [
      {text: if, scope: comment.block.documentation.raw.afl}
      {text: return, scope: keyword.control.afl}
    ]}
    {name: strings, text: 'fn main() { text: string = "if [value]\n" }', probes: [
      {text: if, scope: string.quoted.double.afl}
      {text: '\n', scope: constant.character.escape.afl}
    ]}
    {name: recovery, text: "fn main() { value: string = \"unclosed\n}\nfn next() {}", probes: [
      {text: next, scope: entity.name.function.afl}
    ]}
    {name: import, text: 'use dep::core::math::add as sum', probes: [
      {text: use, scope: keyword.control.import.afl}
      {text: dep, scope: keyword.other.module.afl}
      {text: core, scope: entity.name.type.module.afl}
      {text: as, scope: keyword.control.import.afl}
    ]}
    {name: implementation, text: 'impl dep::core::ui::Button', probes: [
      {text: impl, scope: keyword.control.import.afl}
      {text: dep, scope: keyword.other.module.afl}
      {text: core, scope: entity.name.type.module.afl}
    ]}
  ]
  let demos = ([...(glob ($root | path join "demo/**/*.afl")) ...(glob ($root | path join "tests/fixtures/**/*.afl"))] | each {|file| {name: $file, text: (open --raw $file), probes: []}})
  let bridge = r#'
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const root = process.argv[1], require = createRequire(join(root, "package.json"));
const { Registry, parseRawGrammar } = require("vscode-textmate");
const { loadWASM, OnigScanner, OnigString } = require("vscode-oniguruma");
const { parseDocument } = await import(pathToFileURL(join(root, "packages/checker/dist/index.js")));
await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
const path = join(root, "packages/vscode/syntaxes/afl.tmLanguage.json");
const registry = new Registry({onigLib: Promise.resolve({createOnigScanner: s => new OnigScanner(s), createOnigString: s => new OnigString(s)}),
  loadGrammar: async scope => scope === "source.afl" ? parseRawGrammar(readFileSync(path, "utf8"), path) : null});
const grammar = await registry.loadGrammar("source.afl");
const input = JSON.parse(readFileSync(0, "utf8"));
const results = input.map(item => {
  let state = null, offset = 0;
  const tokens = [];
  for (const line of item.text.split("\n")) {
    const result = grammar.tokenizeLine(line, state);
    for (const token of result.tokens) tokens.push({...token, startIndex: offset + token.startIndex, endIndex: offset + Math.min(token.endIndex, line.length)});
    state = result.ruleStack;
    offset += line.length + 1;
  }
  const scopesAt = position => tokens.find(t => t.startIndex <= position && position < t.endIndex)?.scopes ?? [];
  const descriptions = [], strings = [], functions = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === "description") descriptions.push(node);
    if (node.kind === "literal" && ["string", "char"].includes(node.literalType)) strings.push(node);
    if (node.kind === "function") functions.push(node.name);
    for (const child of Object.values(node)) if (typeof child === "object") visit(child);
  }
  const parsed = parseDocument({uri:item.name, text:item.text}); visit(parsed.module);
  const mismatches = [];
  for (const literal of strings) {
    const expected = literal.raw ? "string.quoted.double.raw.afl" : "string.quoted.";
    for (let p = literal.start; p < literal.end; p++) {
      if (!/\s/.test(item.text[p]) && !scopesAt(p).some(s => s.startsWith(expected))) {
        mismatches.push({offset:p, text:item.text.slice(p,p+20), scopes:scopesAt(p)}); break;
      }
    }
  }
  for (const description of descriptions) {
    if (description.raw && tokens.some(t => t.startIndex >= description.start && t.startIndex < description.end && t.scopes.includes("meta.link.afl"))) {
      mismatches.push({rawLink: description.start});
    }
    for (let p = description.start; p < description.end; p++) {
      if (!/\s/.test(item.text[p]) && !scopesAt(p).some(s => s.startsWith("comment.block.documentation"))) {
        mismatches.push({offset:p, text:item.text.slice(p,p+20), scopes:scopesAt(p)}); break;
      }
    }
  }
  for (const token of tokens) {
    if (!item.text.slice(token.startIndex, token.endIndex).trim()) continue;
    if (token.scopes.some(s => s.startsWith("comment.block.documentation")) && !descriptions.some(d => token.startIndex >= d.start && token.startIndex < d.end)) {
      mismatches.push({offset:token.startIndex, text:item.text.slice(token.startIndex,token.endIndex), scopes:token.scopes});
    }
  }
  return {name:item.name, probes:item.probes.map(probe => ({...probe, actual:scopesAt(item.text.indexOf(probe.text))})),
    mismatches: parsed.diagnostics.length === 0 ? mismatches : [],
    functions: functions.map(name => ({name:name.text, scopes:scopesAt(name.start)}))};
});
registry.dispose();
console.log(JSON.stringify(results));
'#
  let execution = ($cases | append $demos | to json | ^node --input-type=module -e $bridge $root | complete)
  if $execution.exit_code != 0 { error make {msg: $execution.stderr} }
  for result in ($execution.stdout | from json) {
    for probe in $result.probes {
      assert ($probe.scope in $probe.actual) $"($result.name): ($probe.text) got ($probe.actual | to json --raw)"
    }
    assert equal $result.mismatches [] $"Prose boundary mismatch: ($result.name)"
    for function in $result.functions {
      assert ("entity.name.function.afl" in $function.scopes) $"Function highlighting: ($result.name) / ($function.name)"
    }
  }
  print $"Highlighting checks passed: ($cases | length) focused cases and ($demos | length) demos, including AST-checked prose boundaries."
}
