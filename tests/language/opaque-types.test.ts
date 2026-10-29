import assert from "node:assert/strict";
import * as path from "node:path";
const checker = path.join(process.argv[2], "packages/checker/dist/index.js");

const { pathToFileURL } = await import("node:url");
const { checkProject, parseDocument, LanguageService } = await import(
  pathToFileURL(checker).href
);
const uri = "file:///opaque/lib.afl";
const declarations =
  "extern type ThreadIdentity [desc=[Thread identity]]\nextern type OtherIdentity [desc=[Different identity]]\n";
const valid =
  declarations +
  `fn keep(value: ThreadIdentity) -> ThreadIdentity [value=[Input]\nreturn=[Output]] { value }
fn example() {
  owner: ThreadIdentity? = null
  values: list<ThreadIdentity?> = {owner}
  handlers: list<fn(ThreadIdentity) -> ThreadIdentity> = {keep}
}
`;
assert.deepEqual(checkProject([{ uri, text: valid }]).diagnostics, []);
const parsed = parseDocument({ uri, text: declarations });
assert.deepEqual(parsed.diagnostics, []);
assert.equal(parsed.module.declarations[0].external, true);
assert.deepEqual(parsed.module.declarations[0].values, []);
for (const [text, code] of [
  ["extern type Empty", "AFL2001"],
  ['extern type T [desc=[Opaque]] = "value"', "AFL1002"],
  ["extern type T [desc=[Opaque]] {}", "AFL1002"],
  [declarations + "fn main() { owner: ThreadIdentity = {} }", "AFL3301"],
  [
    declarations +
      "fn main() { owner: ThreadIdentity = [Identity]\nowner.start() }",
    "AFL3205",
  ],
  [
    valid + "fn main() { handler: fn(OtherIdentity) -> OtherIdentity = keep }",
    "AFL3207",
  ],
  [
    valid +
      "fn main() { handler: fn(ThreadIdentity?) -> ThreadIdentity = keep }",
    "AFL3207",
  ],
  [
    declarations +
      "fn main() { owners: list<ThreadIdentity> = {}\nowners.sort() }",
    "AFL3211",
  ],
]) {
  assert(
    checkProject([{ uri, text }]).diagnostics.some((d) => d.code === code),
    text + JSON.stringify(checkProject([{ uri, text }]).diagnostics),
  );
}
const core = {
  uri: "file:///opaque/core.afl",
  text:
    declarations +
    "extern fn accept(owner:ThreadIdentity) [desc=[Accept]\nowner=[Identity]]",
};
const edge = (text) => ({ uri, text });
assert.deepEqual(
  checkProject([
    core,
    edge(
      "use core::ThreadIdentity\nimpl core::accept\nfn accept(owner:ThreadIdentity) {}",
    ),
  ]).diagnostics,
  [],
);
assert(
  checkProject([
    core,
    edge(
      "use core::OtherIdentity\nimpl core::accept\nfn accept(owner:OtherIdentity) {}",
    ),
  ]).diagnostics.some((d) => d.code === "AFL3404"),
);
assert(
  checkProject([
    core,
    edge('impl core::ThreadIdentity\ntype ThreadIdentity = "thread"'),
  ]).diagnostics.some((d) => d.code === "AFL3401"),
);
assert(
  checkProject([
    core,
    edge(
      "unsupported core::ThreadIdentity [desc=[Unavailable]\nfallback=[None]]",
    ),
  ]).diagnostics.some((d) => d.code === "AFL3410"),
);
const service = new LanguageService();
service.update([{ uri, text: valid }]);
const symbols = service.documentSymbols(uri);
assert.equal(symbols[0].detail, "extern type ThreadIdentity");
assert(service.references(uri, { line: 0, character: 15 }, true).length >= 5);
assert.equal(service.definition(uri, { line: 2, character: 20 }).uri, uri);
console.log(
  "PASS opaque types: nominal signatures, nullable/collection/callback contexts, docs, initializer/member boundaries and navigation",
);
