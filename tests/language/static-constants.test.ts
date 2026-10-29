import assert from "node:assert/strict";
import * as path from "node:path";
const checker = path.join(process.argv[2], "packages/checker/dist/index.js");

const { pathToFileURL } = await import("node:url");
const { checkProject, parseDocument, LanguageService } = await import(
  pathToFileURL(checker).href
);
const uri = "file:///constants/lib.afl";
const prefix = `const LIMIT: i32 = 100 [desc = [Limit]]
class Counter [desc = [Counter]] {
    static total: i32 = 0 [desc = [Shared total]]
    const MAX: i32 = LIMIT [desc = [Maximum]]
    value: i32 = 0 [desc = [Instance value]]
    fn increment() { self.value = self.value + 1
        Counter.total = Counter.total + 1 }
}
fn pair() -> a: i32, b: i32 [a = [A]\nb = [B]] { a = 1\nb = 2 }
`;
const cases = [
  ["read and write shared", "Counter.total = Counter.total + LIMIT"],
  ["class constant", "const n: i32 = Counter.MAX"],
  [
    "shallow object binding",
    "const c: Counter = {}\nc.value = 2\nc.increment()",
  ],
  ["shallow collection binding", "const items: list<i32> = {}\nitems.add(1)"],
  ["local description", "const value: Counter = [Create]\nvalue.increment()"],
  ["local raw description", "const n: i32 = r#[Value]#"],
  ["branch constant", "const n: i32 = if true { 1 } else { 2 }"],
  ["constant binding", "const n: i32 = 1\nn = 2", "AFL3212"],
  ["nested reassignment", "const n: i32 = 1\nif true { n = 2 }", "AFL3212"],
  ["description reassignment", "const n: i32 = 1\nn = [Other]", "AFL3212"],
  [
    "multiple reassignment",
    "const n: i32 = 1\nb: i32 = 0\nn, b = pair()",
    "AFL3212",
  ],
  ["module reassignment", "LIMIT = 2", "AFL3212"],
  ["module description reassignment", "LIMIT = [Other]", "AFL3212"],
  ["class reassignment", "Counter.MAX = 2", "AFL3212"],
  ["instance static", "c: Counter = {}\nc.total = 2", "AFL3213"],
  ["instance const", "c: Counter = {}\nx: i32 = c.MAX", "AFL3213"],
  ["type property", "x: i32 = Counter.value", "AFL3213"],
  ["type method", "Counter.increment()", "AFL3213"],
  ["shared initializer override", "c: Counter = {total: 2}", "AFL3301"],
  ["constant initializer override", "c: Counter = {MAX: 2}", "AFL3301"],
  [
    "constant missing object field",
    "const c: Required = {}",
    "AFL3302",
    "class Required [desc = [Required]] { x: i32 [desc = [X]] }\n",
  ],
  ["local scope", "if true { const x: i32 = 1 }\nx = 2", "AFL3203"],
  ["local forward reference", "const x: i32 = x", "AFL3203"],
  ["local description self reference", "const x: i32 = [Read {@x}]", "AFL3203"],
  ["local name conflict", "const x: i32 = 1\nx: i32 = 2", "AFL3201"],
  ["constant invalid type", "const x: Missing = 1", "AFL3202"],
  ["constant as type", "x: LIMIT = 1", "AFL3202"],
  ["return count", "const x: i32 = pair()", "AFL3303"],
  ["if requires else", "const x: i32 = if true { 1 }", "AFL1004"],
  [
    "union validation",
    'const mode: Mode = "bad"',
    "AFL3209",
    'type Mode = "good"\n',
  ],
  ["callback validation", "const action: fn() = pair", "AFL3207"],
  [
    "escaped keywords",
    "const `static`: i32 = 1\nconst `const`: i32 = `static`",
  ],
  [
    "sibling scopes",
    "if true { const x: i32 = 1 }\nif false { const x: i32 = 2 }",
  ],
];
for (const [name, body, code, extra = ""] of cases) {
  const document = {
    uri,
    text: prefix + extra + "fn example() {\n" + body + "\n}",
  };
  for (const indexed of [false, true]) {
    let diagnostics;
    if (indexed) {
      const service = new LanguageService();
      service.update([document]);
      diagnostics = service.diagnostics;
    } else {
      diagnostics = checkProject([document]).diagnostics;
    }
    if (code) {
      assert(
        diagnostics.some((d) => d.code === code),
        name + JSON.stringify(diagnostics),
      );
    } else {
      assert.deepEqual(diagnostics, [], name);
    }
  }
}
for (const text of [
  "const N: i32 [desc = [N]]",
  "const N = 1 [desc = [N]]",
  "extern const N: i32 = 1 [desc = [N]]",
  "class C [desc = [C]] { static n: i32 [desc = [N]] }",
  "class C [desc = [C]] { const n: i32 [desc = [N]] }",
  "class C [desc = [C]] { static const n: i32 = 1 [desc = [N]] }",
  "struct S [desc = [S]] { static n: i32 = 1 [desc = [N]] }",
  "struct S [desc = [S]] { const n: i32 = 1 [desc = [N]] }",
  "fn f() { static n: i32 = 1 }",
  "fn f() { const n = 1 }",
  "fn f() { const n: i32 }",
  "fn f() { const n: i32 = 1, m: i32 = 2 }",
  "class C [desc = [C]] { static fn f() {} }",
]) {
  assert(
    parseDocument({ uri, text }).diagnostics.some((d) => d.code === "AFL1002"),
    text,
  );
}
for (const text of [
  "const N: i32 = 1",
  "class C [desc = [C]] { const N: i32 = 1 }",
  "class C [desc = [C]] { static n: i32 = 0 }",
]) {
  assert(
    checkProject([{ uri, text }]).diagnostics.some((d) => d.code === "AFL2001"),
  );
}
for (const text of [
  "const N: i32 = missing [desc = [N]]",
  "class C [desc = [C]] { static n: i32 = self.x [desc = [N]] }",
]) {
  assert(
    checkProject([{ uri, text }]).diagnostics.some((d) => d.code === "AFL3203"),
  );
}
assert(
  checkProject([
    {
      uri,
      text: "const N: i32 = if true { return 1 } else { 2 } [desc = [N]]",
    },
  ]).diagnostics.some((d) => d.code === "AFL1003"),
);
const core = {
  uri: "file:///constants/core.afl",
  text: `extern class Counter [desc = [Counter]] {
static total: i32 [desc = [Total]]
const MAX: i32 = 100 [desc = [Maximum]]
}`,
};
const edge = {
  uri,
  text: `impl core::Counter
class Counter {
static total: i32 = 0
const MAX: i32 = 100
}
fn f() { c: Counter = {}\nCounter.total = 1 }`,
};
assert.deepEqual(checkProject([core, edge]).diagnostics, []);
for (const text of [
  edge.text.replace("static total", "total"),
  edge.text.replace("const MAX", "static MAX"),
  edge.text.replace("static total", "const total"),
]) {
  assert(
    checkProject([core, { ...edge, text }]).diagnostics.some(
      (d) => d.code === "AFL3404",
    ),
  );
}
assert(
  checkProject([
    core,
    { ...edge, text: edge.text.replace("static total: i32 = 0", "") },
  ]).diagnostics.some((d) => d.code === "AFL3405"),
);
const api = {
  uri: "file:///constants/api.afl",
  text:
    prefix +
    `const shared: Counter = {} [desc = [Shared instance]]
const callback: fn() = [Create callback] [desc = [Callback]]
const values: list<i32> = {} [desc = [Values]]`,
};
const app = {
  uri,
  text: `use api::{LIMIT as CAP, Counter as C, shared, callback, values}
fn f() {
    const n: i32 = CAP
    C.total = n
    shared.increment()
    callback()
    values.add(n)
    [See {@C.value}, {@C.total}, {@shared.value} and {@CAP}]
}`,
};
const service = new LanguageService();
service.update([api, app]);
assert.deepEqual(service.diagnostics, []);
const pos = (doc, text, delta = 1) => {
  const offset = doc.text.indexOf(text);
  assert(offset >= 0, text);
  const lines = doc.text.slice(0, offset + delta).split("\n");
  return { line: lines.length - 1, character: lines.at(-1).length };
};
assert.equal(service.definition(uri, pos(app, "CAP\n")).uri, api.uri);
assert.match(service.hover(uri, pos(app, "CAP\n")).text, /const LIMIT: i32/);
assert.match(service.hover(uri, pos(app, "total =")).text, /static total: i32/);
assert(service.references(api.uri, pos(api, "LIMIT:")).length >= 3);
assert.equal(
  service.documentSymbols(api.uri).find((s) => s.name === "LIMIT").kind,
  "constant",
);
assert(
  service
    .documentSymbols(api.uri)
    .find((s) => s.name === "Counter")
    .children.some((s) => s.name === "MAX" && s.kind === "constant"),
);
assert(!service.documentSymbols(uri).some((s) => s.name === "n"));
assert(
  service
    .completion(uri, pos(app, "C.total", 2))
    .some((s) => s.label === "total"),
);
assert(
  !service
    .completion(uri, pos(app, "C.total", 2))
    .some((s) => s.label === "value"),
);
assert(
  service
    .completion(uri, pos(app, "shared.increment", 7))
    .some((s) => s.label === "value"),
);
assert(
  !service
    .completion(uri, pos(app, "shared.increment", 7))
    .some((s) => s.label === "MAX"),
);
assert(
  service
    .completion(uri, pos(app, "{@C.value}", 4))
    .some((s) => s.label === "value"),
);
assert(
  service
    .completion(uri, pos(app, "{@C.value}", 4))
    .some((s) => s.label === "MAX"),
);
assert(service.signatureHelp(uri, pos(app, "callback()", 9)));
for (const assignment of [
  "CAP = 2",
  "CAP = [Other]",
  "callback = [Other]",
  "values = {}",
  "C.MAX = 2",
]) {
  const document = {
    ...app,
    text: app.text.replace("    const n", assignment + "\n    const n"),
  };
  assert(
    checkProject([api, document]).diagnostics.some((d) => d.code === "AFL3212"),
    assignment,
  );
  service.update([api, document]);
  assert(
    service.diagnostics.some((d) => d.code === "AFL3212"),
    assignment,
  );
}
service.update([core, edge]);
assert.equal(service.implementations(core.uri, pos(core, "total:")).length, 1);
assert.equal(service.implementations(core.uri, pos(core, "MAX:")).length, 1);
const parsed = parseDocument({ uri, text: prefix }).module;
assert.equal(parsed.declarations[0].kind, "constant");
assert.equal(parsed.declarations[1].properties[0].static, true);
assert.equal(parsed.declarations[1].properties[1].constant, true);
console.log(
  `Static properties/constants passed: ${cases.length} indexed/unindexed cases, syntax, imports, impl and navigation.`,
);
