import assert from "node:assert/strict";
import * as path from "node:path";
const checker = path.join(process.argv[2], "packages/checker/dist/index.js");

const { pathToFileURL } = await import("node:url");
const { checkProject, parseDocument, LanguageService } = await import(
  pathToFileURL(checker).href
);
const core = {
  uri: "file:///inherit/core.afl",
  text: "extern fn show(input: i32) -> output: i32 [desc = [Display {@input}]\ninput = [Source value]\noutput = [Displayed value]]\nextern class View [desc = [View contract]] {\n value: i32 [desc = [Current value]]\n fn update(input: i32) [desc = [Update view]\ninput = [New value]]\n}",
};
const edge = {
  uri: "file:///inherit/lib.afl",
  text: "impl core::show\nimpl core::View\nfn show(value: i32) -> i32 { value }\nclass View {\n value: i32\n fn update(value: i32) { self.value = value }\n}",
};
const check = (text) => checkProject([core, { ...edge, text }]).diagnostics;
assert.deepEqual(check(edge.text), []);
assert.deepEqual(
  check(edge.text.replace("{ value }", "")),
  [],
  "Bodyless implementation inherits its contract",
);
assert(
  check(edge.text.replace("impl core::show\n", "")).some(
    (d) => d.code === "AFL2001",
  ),
);
assert(
  check(edge.text.replace("core::show", "core::absent")).some(
    (d) => d.code === "AFL3102",
  ),
);
assert(
  check(edge.text.replace("class View {", "class View {\n extra: i32")).some(
    (d) => d.code === "AFL2001",
  ),
);
assert(
  check(edge.text.replace("-> i32 { value }", "-> string { value }")).some(
    (d) => d.code === "AFL3404",
  ),
);
assert(
  check(
    edge.text.replace("-> i32 { value }", "-> i32 [value = []] { value }"),
  ).some((d) => d.code === "AFL2001"),
);
const override = {
  ...edge,
  text: edge.text.replace(
    "-> i32 { value }",
    "-> i32 [value = [Platform value]] { value }",
  ),
};
const service = new LanguageService();
service.update([core, edge]);
assert.deepEqual(service.diagnostics, []);
const at = (doc, text, delta = 0) => {
  const offset = doc.text.indexOf(text) + delta,
    prefix = doc.text.slice(0, offset);
  return {
    line: prefix.split("\n").length - 1,
    character: offset - prefix.lastIndexOf("\n") - 1,
  };
};
assert.match(
  service.hover(edge.uri, at(edge, "show(value")).text,
  /Source value/,
);
assert.match(
  service.hover(edge.uri, at(edge, "class View", 6)).text,
  /View contract/,
);
assert.match(
  service.hover(edge.uri, at(edge, "value: i32\n fn")).text,
  /Current value/,
);
assert.match(
  service.hover(edge.uri, at(edge, "update(value", 7)).text,
  /New value/,
);
const ast = service.getModule(edge.uri);
assert.equal(
  ast.declarations[2].documentation,
  undefined,
  "Do not mutate cached ASTs",
);
assert.equal(
  parseDocument(edge).descriptionLinks.length,
  0,
  "Do not copy links into the implementation source",
);
assert.equal(
  service.definition(core.uri, at(core, "{@input}", 2)).uri,
  core.uri,
);
service.update([core, override]);
assert.match(
  service.hover(edge.uri, at(override, "show(value")).text,
  /Platform value/,
);
assert(
  !service
    .hover(edge.uri, at(override, "show(value"))
    .text.includes("Source value"),
);
service.update([
  { ...core, text: core.text.replace("Source value", "Changed contract") },
  edge,
]);
assert.match(
  service.hover(edge.uri, at(edge, "show(value")).text,
  /Changed contract/,
);
console.log(
  "Impl documentation passed: inheritance, positional mapping, local overrides, fields/methods, refresh and original link identity.",
);
