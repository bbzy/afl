import assert from "node:assert/strict";
import * as path from "node:path";
const checker = path.join(process.argv[2], "packages/checker/dist/index.js");

const { pathToFileURL } = await import("node:url");
const { checkProject, parseDocument, LanguageService } = await import(
  pathToFileURL(checker).href
);
const uri = "file:///groups/lib.afl";
const frames = {
  uri: "file:///groups/frames.afl",
  text: 'class NativeFrame [desc = [Frame]] {}\nclass FrameSource [desc = [Source]] {}\nfn open() {}\ntype Mode = "camera" | "image"',
};
const cases = [
  [
    "use frames::{NativeFrame, FrameSource}\nfn main() { frame: NativeFrame = {}\nsource: FrameSource = {} }",
  ],
  [
    'use frames::{NativeFrame as Frame, open, Mode}\nfn main() { frame: Frame = {}\nopen()\nmode: Mode = "camera" }',
  ],
  ["use frames::{\n NativeFrame,\n FrameSource,\n}\nfn main() {}"],
  ["use frames::{missing}", "AFL3102"],
  ["use frames::{NativeFrame, NativeFrame}", "AFL3201"],
  ["use frames::{}", "AFL1002"],
  ["use frames::{NativeFrame FrameSource}", "AFL1002"],
  ["use frames::{nested::{NativeFrame}}", "AFL1002"],
  ["use frames::{*}", "AFL1002"],
  ["impl frames::{NativeFrame}", "AFL1002"],
];
for (const [text, code] of cases) {
  const diagnostics = checkProject([frames, { uri, text }]).diagnostics;
  if (code) {
    assert(
      diagnostics.some((d) => d.code === code),
      text + JSON.stringify(diagnostics),
    );
  } else {
    assert.deepEqual(diagnostics, []);
  }
}
const doc = {
  uri,
  text: "use frames::{NativeFrame as Frame, FrameSource}\nfn main() { frame: Frame = {} }",
};
const parsed = parseDocument(doc);
assert.equal(parsed.module.declarations[0].kind, "import");
assert.equal(parsed.module.declarations[1].kind, "import");
assert.equal(parsed.importGroups.length, 1);
const s = new LanguageService();
s.update([frames, doc]);
assert.deepEqual(s.diagnostics, []);
assert.equal(s.definition(uri, { line: 0, character: 15 }).uri, frames.uri);
assert.equal(s.definition(uri, { line: 0, character: 28 }).uri, frames.uri);
for (const text of [
  "use frames::{",
  "use frames::{\n NativeFrame,\n Fra",
  "use frames::{NativeFrame, Fra}",
]) {
  s.update([frames, { uri, text }]);
  const offset = text.endsWith("}") ? text.length - 1 : text.length,
    before = text.slice(0, offset);
  const labels = s
    .completion(uri, {
      line: before.split("\n").length - 1,
      character: offset - before.lastIndexOf("\n") - 1,
    })
    .map((item) => item.label);
  assert(labels.includes("FrameSource"), text + JSON.stringify(labels));
}
console.log(
  `Grouped imports passed: ${cases.length} forms, flattened AST, aliases, navigation and multiline/incomplete completion.`,
);
