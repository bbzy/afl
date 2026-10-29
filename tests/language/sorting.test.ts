import assert from "node:assert/strict";
import * as path from "node:path";
const checker = path.join(process.argv[2], "packages/checker/dist/index.js");

const { pathToFileURL } = await import("node:url");
const { checkProject, LanguageService } = await import(
  pathToFileURL(checker).href
);
const uri = "file:///sorting/lib.afl";
const prefix =
  "struct Effect [desc = [Effect]] { name: string [desc = [Name]] }\nfn name(item: Effect) -> string [item = [Effect]\nreturn = [Name]] { item.name }\n";
const cases = [
  [
    "natural",
    "items: list<i32> = {3, 1, 2}\nitems.sort()\ncopy: list<i32> = items.sorted()",
  ],
  ["strings", "items: list<string> = {}\nitems.sort()"],
  [
    "keys",
    "items: list<Effect> = {}\nitems.sort_by(name)\ncopy: list<Effect> = items.sorted_by(name)\nfirst: string = copy.get(0).name",
  ],
  [
    "named callback",
    "key: fn(Effect) -> string = name\nitems: list<Effect> = {}\nitems.sort_by(key)",
  ],
  ["no object order", "items: list<Effect> = {}\nitems.sort()", "AFL3211"],
  ["no nullable order", "items: list<i32?> = {}\nitems.sorted()", "AFL3211"],
  ["no any order", "items: list<any> = {}\nitems.sort()", "AFL3211"],
  ["missing key", "items: list<Effect> = {}\nitems.sort_by()", "AFL3206"],
  [
    "bad key result",
    "key: fn(Effect) -> bool = [Predicate]\nitems: list<Effect> = {}\nitems.sort_by(key)",
    "AFL3207",
  ],
  [
    "bad key input",
    "key: fn(i32) -> string = [Key]\nitems: list<Effect> = {}\nitems.sort_by(key)",
    "AFL3207",
  ],
  [
    "nullable key",
    "key: fn(Effect) -> string? = [Key]\nitems: list<Effect> = {}\nitems.sort_by(key)",
    "AFL3207",
  ],
  ["set unchanged", "items: set<i32> = {}\nitems.sort()", "AFL3204"],
  ["map unchanged", "items: map<string, i32> = {}\nitems.sorted()", "AFL3204"],
];
for (const [name, body, code] of cases) {
  const diagnostics = checkProject([
    { uri, text: prefix + "fn main() {\n" + body + "\n}" },
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
const doc = {
  uri,
  text:
    prefix +
    "fn main() {\n items: list<Effect> = {}\n items.sorted_by(name).get(0).name\n}",
};
const s = new LanguageService();
s.update([doc]);
assert.deepEqual(s.diagnostics, []);
const at = (text, delta = 0) => {
  const offset = doc.text.indexOf(text) + delta,
    before = doc.text.slice(0, offset);
  return {
    line: before.split("\n").length - 1,
    character: offset - before.lastIndexOf("\n") - 1,
  };
};
assert.match(
  s.signatureHelp(uri, at("sorted_by(name)", 11)).label,
  /key: fn\(Effect\) -> K/,
);
assert.equal(s.definition(uri, at("get(0).name", 7)).range.start.line, 0);
assert.equal(s.definition(uri, at("sorted_by", 2)), undefined);
console.log(
  `Sorting passed: ${cases.length} contracts, callbacks, return-member navigation and signature help.`,
);
