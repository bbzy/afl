import assert from "node:assert/strict";
import * as path from "node:path";
const checker = path.join(process.argv[2], "packages/checker/dist/index.js");

const { pathToFileURL } = await import("node:url");
const { checkProject, parseDocument, LanguageService } = await import(
  pathToFileURL(checker).href
);
const uri = "file:///diagnostics/lib.afl";
const text =
  "class View [desc = [界面]] {\n fn first() {\n  [更新按钮]\n ]\n fn second(value: i32) [value = [数值]] {\n  [显示结果]\n ]\n}\nfn next() {}";
const doc = { uri, text };
const parsed = parseDocument(doc);
assert.equal(parsed.diagnostics.length, 2);
assert.deepEqual(
  parsed.diagnostics.map((d) => d.range.start.line),
  [3, 6],
);
for (const d of parsed.diagnostics) {
  assert.match(d.message, /Expected.*}.*method body.*replace/);
  assert(
    d.relatedInformation[0].location.range.start.line < d.range.start.line,
  );
}
assert.equal(parsed.module.declarations[0].methods.length, 2);
assert.equal(parsed.module.declarations[1].name.text, "next");
for (const tail of ["r#[unclosed raw", "[unclosed ordinary"]) {
  const fatal = parseDocument({
    uri,
    text: "class A [desc = [A]] { fn broken() { " + tail,
  });
  assert.equal(fatal.diagnostics.length, 1, JSON.stringify(fatal.diagnostics));
  assert.equal(fatal.diagnostics[0].code, "AFL1001");
}
const service = new LanguageService();
service.update([doc]);
assert.equal(service.diagnostics.length, 2);
assert(service.documentSymbols(uri).some((s) => s.name === "next"));
for (const params of [
  "self",
  "self: View",
  "self, value: i32",
  "self: View, value: i32",
]) {
  const docs = params.includes("value") ? "[value = [数值]]" : "";
  const sample = {
    uri,
    text: `class View [desc = [界面]] { fn update(${params}) ${docs} {} }`,
  };
  const diagnostics = checkProject([sample]).diagnostics;
  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.match(diagnostics[0].message, /Remove self/);
}
const malformed = parseDocument({
  uri,
  text: "class A [desc = [A]] {\n fn bad(self, value: i32) [value = [描述包括 [嵌套] 文本]] {}\n fn good() {}\n}",
});
assert.equal(malformed.diagnostics.length, 1);
assert.equal(malformed.module.declarations[0].methods.length, 2);
const missingBrace = parseDocument({
  uri,
  text: "fn first() {\n [Action]\nfn second() {}",
});
assert.equal(missingBrace.diagnostics.length, 1);
assert.equal(missingBrace.module.declarations.length, 2);
const core = {
  uri: "file:///diagnostics/core.afl",
  text: "extern class View [desc = [View]] {}",
};
const conflict = checkProject([
  core,
  {
    uri,
    text: "use core::View\nimpl core::View\nclass View [desc = [View]] {}",
  },
]);
assert(
  conflict.diagnostics.some(
    (d) =>
      d.code === "AFL3201" && d.message.includes("impl does not require use"),
  ),
);
const missing = checkProject([
  { uri, text: "fn value(input: i32) -> i32 { input }" },
]);
assert.equal(missing.diagnostics.length, 2);
assert(
  missing.diagnostics.some((d) => d.message.includes("input = [description]")),
);
assert(
  missing.diagnostics.some((d) => d.message.includes("return = [description]")),
);
// Recovery must still preserve independent errors in other functions/files.
service.update([doc, { uri: core.uri, text: "fn other() { absent() }" }]);
assert(
  service.diagnostics.some((d) => d.uri === core.uri && d.code === "AFL3203"),
);
console.log(
  "Diagnostic quality passed: precise closers, bounded recovery, self repair, actionable docs/imports and independent errors.",
);
