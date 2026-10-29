import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { globSync } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/vscode");
const root = path.dirname(path.dirname(suiteDirectory));
const cases = [
  {
    name: "return_initializer",
    text: 'struct Entry [desc = [Entry]] {\n  title: string [desc = [Title]]\n  children: list<Entry> = {} [desc = [Children]]\n}\nfn direct() -> Entry [return = [Entry]] {\n  return {title: "outer", children: {{title: r#"nested"#}}}\n}\nfn after() {}',
    probes: [
      { text: "return {", scope: "keyword.control.afl" },
      { text: 'title: "outer"', scope: "variable.other.property.afl" },
      { text: "outer", scope: "string.quoted.double.afl" },
      { text: "nested", scope: "string.quoted.double.raw.afl" },
      { text: "after", scope: "entity.name.function.afl" },
    ],
  },
  {
    name: "static_constants",
    text: "const LIMIT: i32 = 100 [desc = [Global limit]]\nclass Counter [desc = [Counter]] {\n    value: i32 = 0 [desc = [Value]]\n    static total: i32 = 0 [desc = [Shared total]]\n    const MAX: i32 = LIMIT [desc = [Maximum]]\n    fn increment() {\n        const step: i32 = 1\n        Counter.total = Counter.total + step\n    }\n}\nfn after() {}",
    probes: [
      { text: "const", scope: "storage.modifier.afl" },
      { text: "LIMIT", scope: "variable.other.constant.afl" },
      { text: "Global limit", scope: "comment.block.documentation.afl" },
      { text: "static", scope: "storage.modifier.afl" },
      { text: "total", scope: "variable.other.property.afl" },
      { text: "MAX", scope: "variable.other.constant.afl" },
      { text: "Shared total", scope: "comment.block.documentation.afl" },
      { text: "Maximum", scope: "comment.block.documentation.afl" },
      { text: "step", scope: "variable.other.readwrite.afl" },
      { text: "after", scope: "entity.name.function.afl" },
    ],
  },
  {
    name: "description_links",
    text: 'fn example() [desc = [See {@dep::core::ui::show}]] {\n    [Nested [Link {@example}]; text after]\n    r#[Keep {@raw_target}]#\n    text: string = "{@string_target}"\n    [Broken {@unfinished\n     ordinary continuation]\n    [Broken {@missing_close]\n    ready: bool = true\n}',
    probes: [
      { text: "dep::core", scope: "markup.underline.link.afl" },
      { text: "example}", scope: "markup.underline.link.afl" },
      { text: "raw_target", scope: "comment.block.documentation.raw.afl" },
      { text: "string_target", scope: "string.quoted.double.afl" },
      { text: "continuation", scope: "comment.block.documentation.afl" },
      { text: "ready", scope: "variable.other.readwrite.afl" },
    ],
  },
  {
    name: "collection_methods",
    text: 'fn execute() {\nitems: list<i32> = {1, 2}\nitems.add(3)\nitems.get(0)\nmapping: map<string, i32> = {}\nmapping.set("one", 1)\nmapping.values().remove_at(0)\n[Remove items matching a business condition]\n}',
    probes: [
      { text: "add", scope: "entity.name.function.afl" },
      { text: "get", scope: "entity.name.function.afl" },
      { text: "values", scope: "entity.name.function.afl" },
      { text: "remove_at", scope: "entity.name.function.afl" },
      { text: "one", scope: "string.quoted.double.afl" },
      { text: "Remove", scope: "comment.block.documentation.afl" },
    ],
  },
  {
    name: "when_branches",
    text: 'struct Options [desc = [Options]] {\nvalue: i32 = when {\n    true -> { 1 }\n    else -> { 2 }\n} [desc = [Default value]]\n}\nfn execute() {\n    message: string = when {\n        count == 0 -> { "empty" }\n        else -> { r#"ready"# }\n    }\n    for item in items {\n        when\n        {\n            item.done -> { continue }\n            else -> { r#[Process ] [ as text]# }\n        }\n    }\n}',
    probes: [
      { text: "when", scope: "keyword.control.afl" },
      { text: "-> {", scope: "keyword.operator.branch.afl" },
      { text: "Default value", scope: "comment.block.documentation.afl" },
      { text: "message", scope: "variable.other.readwrite.afl" },
      { text: "empty", scope: "string.quoted.double.afl" },
      { text: "ready", scope: "string.quoted.double.raw.afl" },
      { text: "done", scope: "variable.other.property.afl" },
      { text: "continue", scope: "keyword.control.afl" },
      { text: "Process", scope: "comment.block.documentation.raw.afl" },
    ],
  },
  {
    name: "for_loop",
    text: "fn execute() {\nfor key, value in entries {\n    [Process the entry]\n    value.run()\n    continue\n}\n}",
    probes: [
      { text: "for", scope: "keyword.control.afl" },
      { text: "in", scope: "keyword.control.afl" },
      { text: "key", scope: "variable.other.readwrite.afl" },
      { text: "value", scope: "variable.other.readwrite.afl" },
      { text: "Process", scope: "comment.block.documentation.afl" },
      { text: "run", scope: "entity.name.function.afl" },
      { text: "continue", scope: "keyword.control.afl" },
    ],
  },
  {
    name: "structs",
    text: 'struct Gift [desc = [Gift protocol]] {\n"gift-id": string [desc = [Identity]]\nnote?: string? [desc = [Note]]\ntimeout: i64 = 10000 [desc = [Timeout]]\nr##"raw\nkey"##?: string = r#"value"# [desc = [Raw key]]\ncontext: any = [Create context] [desc = [Context]]\n}\nclass Viewer [desc = [Viewer]] {\ngift: Gift [desc = [Current gift]]\nfn show() { self.gift.note }\n}',
    probes: [
      { text: "struct", scope: "storage.type.struct.afl" },
      { text: "Gift", scope: "entity.name.type.struct.afl" },
      { text: "gift-id", scope: "string.quoted.double.afl" },
      { text: "Identity", scope: "comment.block.documentation.afl" },
      { text: "note", scope: "variable.other.property.afl" },
      { text: "?", scope: "keyword.operator.field.optional.afl" },
      { text: "10000", scope: "constant.numeric.afl" },
      { text: "raw", scope: "string.quoted.double.raw.afl" },
      { text: "value", scope: "string.quoted.double.raw.afl" },
      { text: "Raw key", scope: "comment.block.documentation.afl" },
      { text: "Context", scope: "comment.block.documentation.afl" },
      { text: "Viewer", scope: "entity.name.type.class.afl" },
      { text: "show", scope: "entity.name.function.afl" },
    ],
  },
  {
    name: "raw_literals",
    text: 'class Raw [desc = r##[Class ]# " \\ text]##] {\npattern: string = r#"\\d+\\.\\d+"# [desc = r#[Pattern]#]\njson: string = r##"{"name": "demo", "marker": "\\"#"}\nfn hidden() {} [still text]"## [desc = [JSON]]\ncontext: any = r##[Keep ]# and unmatched [ " \\]## [desc = [Context]]\nfn next() { r#[Action]# }\n}',
    probes: [
      { text: "Class", scope: "comment.block.documentation.raw.afl" },
      { text: "\\d", scope: "string.quoted.double.raw.afl" },
      { text: "hidden", scope: "string.quoted.double.raw.afl" },
      { text: "JSON", scope: "comment.block.documentation.afl" },
      { text: "Keep", scope: "comment.block.documentation.raw.afl" },
      { text: "Context", scope: "comment.block.documentation.afl" },
      { text: "next", scope: "entity.name.function.afl" },
      { text: "Action", scope: "comment.block.documentation.raw.afl" },
    ],
  },
  {
    name: "raw_call",
    text: 'fn main() { work(r##"a "# ,\nb ) [ \\n"##, r#"value"#)\nr: string = r#"literal"#\nr#[Action]#\nreturn\n}',
    probes: [
      { text: "work", scope: "entity.name.function.afl" },
      { text: "\\n", scope: "string.quoted.double.raw.afl" },
      { text: "literal", scope: "string.quoted.double.raw.afl" },
      { text: "Action", scope: "comment.block.documentation.raw.afl" },
      { text: "return", scope: "keyword.control.afl" },
    ],
  },
  {
    name: "property_defaults",
    text: 'class Config [desc = [Config]] {\ntimeout: i64 = 10000 [desc = [Timeout]]\ncallback: fn() = notify [desc = [Action]]\nmessage: string = "hello" [desc = [Message]]\nenabled: bool = true [desc = [Enabled]]\noptional: string? = null [desc = [Optional]]\nitems: list<i32> = {\n    7,\n} [desc = [Items]]\nvalue: any = [Create a value] [desc = [Context]]\nraw: any = r#[Raw content]# [desc = [Raw context]]\nnext: i32 [desc = [Required]]\nfn work() {}\n}',
    probes: [
      { text: "timeout", scope: "variable.other.property.afl" },
      { text: "10000", scope: "constant.numeric.afl" },
      { text: "notify", scope: "variable.other.readwrite.afl" },
      { text: "hello", scope: "string.quoted.double.afl" },
      { text: true, scope: "constant.language.boolean.afl" },
      { text: "null", scope: "constant.language.null.afl" },
      { text: "7", scope: "constant.numeric.afl" },
      { text: "Context", scope: "comment.block.documentation.afl" },
      { text: "Raw content", scope: "comment.block.documentation.raw.afl" },
      { text: "next", scope: "variable.other.property.afl" },
      { text: "work", scope: "entity.name.function.afl" },
    ],
  },
  {
    name: "property_default_call",
    text: "class Config [desc = [Config]] {\nvalue: i32 = get(\n    123,\n) [desc = [Result]]\nchoice: i32 = if true { 1 }\nelse { 2 } [desc = [Choice]]\n}",
    probes: [
      { text: "get", scope: "entity.name.function.afl" },
      { text: "123", scope: "constant.numeric.afl" },
      { text: "Result", scope: "comment.block.documentation.afl" },
      { text: "else", scope: "keyword.control.afl" },
      { text: "Choice", scope: "comment.block.documentation.afl" },
    ],
  },
  {
    name: "signature",
    text: "extern fn add(`if`: i32) -> sum: i32 [desc = [Add] `if` = [Input] sum = [Output]]",
    probes: [
      { text: "extern", scope: "storage.modifier.afl" },
      { text: "fn", scope: "storage.type.function.afl" },
      { text: "add", scope: "entity.name.function.afl" },
      { text: "`if`", scope: "variable.parameter.afl" },
      { text: "i32", scope: "support.type.primitive.afl" },
      { text: "sum", scope: "variable.parameter.afl" },
      { text: "desc", scope: "keyword.other.documentation.afl" },
      { text: "Add", scope: "comment.block.documentation.afl" },
    ],
  },
  {
    name: "class",
    text: "class counter [desc = [Counter]] { base: i32 [desc = [Initial value]] }",
    probes: [
      { text: "counter", scope: "entity.name.type.class.afl" },
      { text: "base", scope: "variable.other.property.afl" },
      { text: "Initial", scope: "comment.block.documentation.afl" },
    ],
  },
  {
    name: "body",
    text: "fn main() { items: list<map<string, User>> = {}",
    probes: [
      { text: "items", scope: "variable.other.readwrite.afl" },
      { text: "list", scope: "support.type.primitive.afl" },
      { text: "User", scope: "entity.name.type.afl" },
    ],
  },
  {
    name: "expression",
    text: "fn main() { if true { self.show(1.5) } else { return } }",
    probes: [
      { text: "if", scope: "keyword.control.afl" },
      { text: true, scope: "constant.language.boolean.afl" },
      { text: "self", scope: "variable.language.this.afl" },
      { text: "show", scope: "entity.name.function.afl" },
      { text: "1.5", scope: "constant.numeric.afl" },
      { text: "else", scope: "keyword.control.afl" },
    ],
  },
  {
    name: "nullable",
    text: "fn work(items: list<User?>?) -> string? [items = [Users]\nreturn = [Name]] { value: string? = null }",
    probes: [
      { text: "User", scope: "entity.name.type.afl" },
      { text: "?", scope: "keyword.operator.type.nullable.afl" },
      { text: "null", scope: "constant.language.null.afl" },
    ],
  },
  {
    name: "escaped_null",
    text: "fn main() { `null`: string? = null }",
    probes: [{ text: "`null`", scope: "variable.other.readwrite.afl" }],
  },
  {
    name: "callback",
    text: "fn work(callback: fn(i32, User?) -> (bool, string), fallback: (fn() -> string)?) [callback = [Action]\nfallback = [Optional fallback]] { callback(1, null) }",
    probes: [
      { text: "User", scope: "entity.name.type.afl" },
      { text: "bool", scope: "support.type.primitive.afl" },
      { text: "fallback", scope: "variable.parameter.afl" },
      { text: "Action", scope: "comment.block.documentation.afl" },
    ],
  },
  {
    name: "multiline_callback_result",
    text: "fn factory() ->\nfn(User?) -> bool [return = [Callback]] { [Create callback] }",
    probes: [
      { text: "User", scope: "entity.name.type.afl" },
      { text: "Callback", scope: "comment.block.documentation.afl" },
    ],
  },
  {
    name: "escaped",
    text: "fn main() { `return` = `if` }",
    probes: [
      { text: "`return`", scope: "variable.other.readwrite.afl" },
      { text: "`if`", scope: "variable.other.readwrite.afl" },
    ],
  },
  {
    name: "ordinary",
    text: "fn main() { [if true [nested [[[words]]] words] \\] \\[ \\\\ end] return }",
    probes: [
      { text: "if", scope: "comment.block.documentation.afl" },
      { text: "words", scope: "comment.block.documentation.afl" },
      { text: "\\]", scope: "constant.character.escape.afl" },
      { text: "return", scope: "keyword.control.afl" },
    ],
  },
  {
    name: "raw",
    text: 'fn main() { r#[if "quotes" [ \\]# return }',
    probes: [
      { text: "if", scope: "comment.block.documentation.raw.afl" },
      { text: "return", scope: "keyword.control.afl" },
    ],
  },
  {
    name: "strings",
    text: 'fn main() { text: string = "if [value]\\n" }',
    probes: [
      { text: "if", scope: "string.quoted.double.afl" },
      { text: "\\n", scope: "constant.character.escape.afl" },
    ],
  },
  {
    name: "recovery",
    text: 'fn main() { value: string = "unclosed\n}\nfn next() {}',
    probes: [{ text: "next", scope: "entity.name.function.afl" }],
  },
  {
    name: "import",
    text: "use dep::core::math::add as sum",
    probes: [
      { text: "use", scope: "keyword.control.import.afl" },
      { text: "dep", scope: "keyword.other.module.afl" },
      { text: "core", scope: "entity.name.type.module.afl" },
      { text: "as", scope: "keyword.control.import.afl" },
    ],
  },
  {
    name: "implementation",
    text: "impl dep::core::ui::Button",
    probes: [
      { text: "impl", scope: "keyword.control.import.afl" },
      { text: "dep", scope: "keyword.other.module.afl" },
      { text: "core", scope: "entity.name.type.module.afl" },
    ],
  },
];
const demos = [
  ...globSync(path.join(root, "demo/**/*.afl")),
  ...globSync(path.join(root, "tests/fixtures/**/*.afl")),
].map((file) => ({
  name: file,
  text: fs.readFileSync(file, "utf8"),
  probes: [],
}));
const execution = await exercise([...cases, ...demos], [root]);
for (const result of execution) {
  for (const probe of result.probes) {
    assert(
      probe.actual.includes(probe.scope),
      "" +
        String(result.name) +
        ": " +
        String(probe.text) +
        " got " +
        String(JSON.stringify(probe.actual)) +
        "",
    );
  }
  assert.deepEqual(
    result.mismatches,
    [],
    "Prose boundary mismatch: " + String(result.name) + "",
  );
  for (const fnItem of result.functions) {
    assert(
      fnItem.scopes.includes("entity.name.function.afl"),
      "Function highlighting: " +
        String(result.name) +
        " / " +
        String(fnItem.name) +
        "",
    );
  }
}
console.log(
  "Highlighting checks passed: " +
    String(cases.length) +
    " focused cases and " +
    String(demos.length) +
    " demos, including AST-checked prose boundaries.",
);

async function exercise(input: any, args: string[]) {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const root = args[0],
    require = createRequire(join(root, "package.json"));
  const { Registry, parseRawGrammar } = require("vscode-textmate");
  const { loadWASM, OnigScanner, OnigString } = require("vscode-oniguruma");
  const { parseDocument } = await import(
    pathToFileURL(join(root, "packages/checker/dist/index.js")).href
  );
  await loadWASM(
    readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")),
  );
  const path = join(root, "packages/vscode/syntaxes/afl.tmLanguage.json");
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (s) => new OnigScanner(s),
      createOnigString: (s) => new OnigString(s),
    }),
    loadGrammar: async (scope) =>
      scope === "source.afl"
        ? parseRawGrammar(readFileSync(path, "utf8"), path)
        : null,
  });
  const grammar = await registry.loadGrammar("source.afl");

  const results = input.map((item) => {
    let state = null,
      offset = 0;
    const tokens = [];
    for (const line of item.text.split("\n")) {
      const result = grammar.tokenizeLine(line, state);
      for (const token of result.tokens) {
        tokens.push({
          ...token,
          startIndex: offset + token.startIndex,
          endIndex: offset + Math.min(token.endIndex, line.length),
        });
      }
      state = result.ruleStack;
      offset += line.length + 1;
    }
    const scopesAt = (position) =>
      tokens.find((t) => t.startIndex <= position && position < t.endIndex)
        ?.scopes ?? [];
    const descriptions = [],
      strings = [],
      functions = [];
    function visit(node) {
      if (!node || typeof node !== "object") {
        return;
      }
      if (node.kind === "description") {
        descriptions.push(node);
      }
      if (
        node.kind === "literal" &&
        ["string", "char"].includes(node.literalType)
      ) {
        strings.push(node);
      }
      if (node.kind === "function") {
        functions.push(node.name);
      }
      for (const child of Object.values(node)) {
        if (typeof child === "object") {
          visit(child);
        }
      }
    }
    const parsed = parseDocument({ uri: item.name, text: item.text });
    visit(parsed.module);
    const mismatches = [];
    for (const literal of strings) {
      const expected = literal.raw
        ? "string.quoted.double.raw.afl"
        : "string.quoted.";
      for (let p = literal.start; p < literal.end; p++) {
        if (
          !/\s/.test(item.text[p]) &&
          !scopesAt(p).some((s) => s.startsWith(expected))
        ) {
          mismatches.push({
            offset: p,
            text: item.text.slice(p, p + 20),
            scopes: scopesAt(p),
          });
          break;
        }
      }
    }
    for (const description of descriptions) {
      if (
        description.raw &&
        tokens.some(
          (t) =>
            t.startIndex >= description.start &&
            t.startIndex < description.end &&
            t.scopes.includes("meta.link.afl"),
        )
      ) {
        mismatches.push({ rawLink: description.start });
      }
      for (let p = description.start; p < description.end; p++) {
        if (
          !/\s/.test(item.text[p]) &&
          !scopesAt(p).some((s) => s.startsWith("comment.block.documentation"))
        ) {
          mismatches.push({
            offset: p,
            text: item.text.slice(p, p + 20),
            scopes: scopesAt(p),
          });
          break;
        }
      }
    }
    for (const token of tokens) {
      if (!item.text.slice(token.startIndex, token.endIndex).trim()) {
        continue;
      }
      if (
        token.scopes.some((s) => s.startsWith("comment.block.documentation")) &&
        !descriptions.some(
          (d) => token.startIndex >= d.start && token.startIndex < d.end,
        )
      ) {
        mismatches.push({
          offset: token.startIndex,
          text: item.text.slice(token.startIndex, token.endIndex),
          scopes: token.scopes,
        });
      }
    }
    return {
      name: item.name,
      probes: item.probes.map((probe) => ({
        ...probe,
        actual: scopesAt(item.text.indexOf(probe.text)),
      })),
      mismatches: parsed.diagnostics.length === 0 ? mismatches : [],
      functions: functions.map((name) => ({
        name: name.text,
        scopes: scopesAt(name.start),
      })),
    };
  });
  registry.dispose();
  return results;
}
