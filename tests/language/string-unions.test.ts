import assert from "node:assert/strict";
import * as path from "node:path";
const checker = path.join(process.argv[2], "packages/checker/dist/index.js");

const { pathToFileURL } = await import("node:url");
const { checkProject, parseDocument, LanguageService } = await import(
  pathToFileURL(checker).href
);
const uri = "file:///unions/lib.afl";
const prefix =
  'type Mode = "camera" | "image" | r#"video"#\nstruct Options [desc = [Options]] { mode: Mode = "camera" [desc = [Mode]] }\nfn select(mode: Mode) [mode = [Mode]] {}\n';
const cases = [
  ["literal", 'mode: Mode = "camera"'],
  ["raw", 'mode: Mode = r#"video"#'],
  ["nullable", "mode: Mode? = null"],
  ["description", "mode: Mode = [Runtime mode]"],
  ["runtime string", "text: string = [Runtime text]\nmode: Mode = text"],
  ["call", 'select("image")'],
  ["list", 'modes: list<Mode> = {"camera", "image"}'],
  ["initializer", 'options: Options = {mode: "video"}'],
  ["bad literal", 'mode: Mode = "camrea"', "AFL3209"],
  ["number", "mode: Mode = 1", "AFL3209"],
  ["null", "mode: Mode = null", "AFL3209"],
  ["bad reassignment", 'mode: Mode = "camera"\nmode = "bad"', "AFL3209"],
  ["bad call", 'select("bad")', "AFL3209"],
  ["bad list", 'modes: list<Mode> = {"bad"}', "AFL3209"],
  ["bad map", 'modes: map<string, Mode> = {"current": "bad"}', "AFL3209"],
  ["bad initializer", 'options: Options = {mode: "bad"}', "AFL3209"],
  [
    "bad member assignment",
    'options: Options = {}\noptions.mode = "bad"',
    "AFL3209",
  ],
  [
    "bad comparison",
    'mode: Mode = "camera"\nif mode == "camrea" {}',
    "AFL3209",
  ],
  [
    "bad if result",
    'mode: Mode = if true { "camera" } else { "bad" }',
    "AFL3209",
  ],
];
for (const [name, body, code] of cases) {
  const diagnostics = checkProject([
    { uri, text: prefix + "fn example() {\n" + body + "\n}" },
  ]).diagnostics;
  if (code) {
    assert(
      diagnostics.some((d) => d.code === code),
      name + JSON.stringify(diagnostics),
    );
  } else {
    assert.deepEqual(diagnostics, [], name);
  }
}
for (const body of ['return "bad"', '"bad"']) {
  const diagnostics = checkProject([
    {
      uri,
      text: prefix + "fn result() -> Mode [return = [Mode]] { " + body + " }",
    },
  ]).diagnostics;
  assert(diagnostics.some((d) => d.code === "AFL3209"));
}
assert(
  checkProject([
    { uri, text: prefix.replace('= "camera" [desc', '= "bad" [desc') },
  ]).diagnostics.some((d) => d.code === "AFL3209"),
);
assert(
  parseDocument({
    uri,
    text: 'type Mode = "camera" | "camera"',
  }).diagnostics.some((d) => d.code === "AFL3202"),
);
assert(
  parseDocument({ uri, text: "type Mode = string" }).diagnostics.some(
    (d) => d.code === "AFL1002",
  ),
);
const contracts = {
  uri: "file:///unions/core.afl",
  text: 'type Mode = "camera" | "image"\nextern fn select(mode: Mode) [desc = [Select]\nmode = [Mode]]',
};
const edge = {
  uri,
  text: 'use core::Mode as Source\nimpl core::select\nfn select(mode: Source) {}\nfn caller() { select("camera") }',
};
const service = new LanguageService();
service.update([contracts, edge]);
assert.deepEqual(service.diagnostics, []);
assert.equal(
  service.definition(uri, { line: 2, character: 17 }).uri,
  contracts.uri,
);
assert.match(
  service.hover(contracts.uri, { line: 0, character: 5 }).text,
  /camera.*image/,
);
assert.equal(service.documentSymbols(contracts.uri)[0].kind, "type");
assert(
  service
    .completion(uri, { line: 2, character: 18 })
    .some((item) => item.label === "Source" && item.kind === "type"),
);
service.update([
  { ...contracts, text: contracts.text.replace('"camera" | ', "") },
  edge,
]);
assert(service.diagnostics.some((d) => d.code === "AFL3209"));
const other = edge.text.replace(
  "use core::Mode as Source",
  'type Source = "other"',
);
assert(
  checkProject([contracts, { ...edge, text: other }]).diagnostics.some(
    (d) => d.code === "AFL3404",
  ),
);
console.log(
  `String unions passed: ${cases.length} value contexts, return/default checks, imports, impl signatures and editor refresh.`,
);
