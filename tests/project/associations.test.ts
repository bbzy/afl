import assert from "node:assert/strict";

const { default: fs } = await import("node:fs");
const { join, dirname } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { spawnSync } = await import("node:child_process");
const [root, temp] = process.argv.slice(2),
  uri = (path) => pathToFileURL(path).href;
const { LanguageService, checkProject } = await import(
  uri(join(root, "packages/checker/dist/index.js"))
);
const { loadProject, queryTrace, queryImpact } = await import(
  uri(join(root, "packages/checker/dist/node.js"))
);
const project = join(temp, "project");
fs.cpSync(join(root, "demo/implementations"), project, { recursive: true });
const write = (path, text) => {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, text);
};
const map = join(project, "kotlin.toml"),
  native = join(project, "native/Counter.kt"),
  source = join(project, "shared/lib.afl");
const mapping = fs.readFileSync(map, "utf8"),
  config = fs.readFileSync(join(project, "config.toml"), "utf8");
const load = async (preset = "kotlin", overlays = []) => {
  const loaded = await loadProject([project], overlays, {
    project: true,
    ...(preset ? { preset } : {}),
  });
  const service = new LanguageService();
  service.update(loaded.documents, loaded);
  return { loaded, service, codes: service.diagnostics.map((d) => d.code) };
};
const overlay = (path, text) => ({ uri: uri(path), text });
let snapshot = await load();
assert.deepEqual(snapshot.service.diagnostics, []);
assert.deepEqual(
  checkProject(snapshot.loaded.documents, snapshot.loaded).diagnostics,
  [],
);
const location = snapshot.service.resolveSymbol(
  "afl://counter/lib.afl#Counter.add",
);
assert(location);
assert.equal(
  snapshot.service.implementations(location.uri, location.range.start).length,
  1,
);
assert.equal(
  (await load(null)).service.implementations(location.uri, location.range.start)
    .length,
  2,
);
assert.equal(
  (await load("python")).service.implementations(
    location.uri,
    location.range.start,
  )[0].symbol,
  "Counter.add",
);
assert.equal(
  (await queryTrace(native, { project, preset: "kotlin", line: 4 })).results
    .length,
  2,
);
assert.equal(
  (await queryTrace(native, { project, preset: "python" })).results.length,
  0,
);
assert.equal(
  (await queryImpact(project, undefined, [source])).implementations.length,
  4,
);
assert.equal(
  (await queryImpact(project, "kotlin", [native])).declarations.length,
  3,
); // class, method and field
assert.deepEqual(
  (await queryImpact(project, "kotlin", [join(project, "unrelated.txt")]))
    .unassociated,
  [uri(join(project, "unrelated.txt"))],
);
for (const [text, code] of [
  [mapping.replace("#Counter.add", "#Missing"), "AFL4201"],
  [mapping.replace("line = 4", "line = 400"), "AFL4200"],
  [mapping.replace("end_line = 8", "end_line = 800"), "AFL4202"],
  [mapping + mapping, "AFL4203"],
  ["implementation = []", "AFL4204"],
  [
    mapping.replace('file = "native/Counter.kt"', 'file = "missing.kt"'),
    "AFL4202",
  ],
  [
    mapping.replace('symbol = "Counter"', 'symbol = "Counter"\nunknown = true'),
    "AFL4200",
  ],
  ["[[implementation]", "AFL4200"],
  [
    mapping.split("[[implementation]]").slice(0, 2).join("[[implementation]]"),
    "AFL4204",
  ],
]) {
  assert(
    (await load("kotlin", [overlay(map, text)])).codes.includes(code),
    text,
  );
}
// Native syntax, symbolic names and signatures are deliberately opaque.
assert.deepEqual(
  (
    await load("kotlin", [
      overlay(
        map,
        mapping.replaceAll('symbol = "Counter', 'symbol = "fictional::Counter'),
      ),
      overlay(native, "not a language\n".repeat(8)),
    ])
  ).codes,
  [],
);
assert(
  (await load("kotlin", [overlay(native, "short")])).codes.includes("AFL4202"),
);
fs.unlinkSync(native);
assert((await load()).codes.includes("AFL4202"));
write(native, "restored\n".repeat(8));
assert.deepEqual((await load()).codes, []);
fs.unlinkSync(map);
snapshot = await load();
assert(snapshot.codes.includes("AFL4200"));
assert(snapshot.loaded.watchedFiles.includes(map));
write(map, mapping);
assert.deepEqual((await load()).codes, []);
assert(
  (
    await load("kotlin", [
      overlay(
        join(project, "config.toml"),
        config.replace(
          'implementations = "kotlin.toml"',
          'project_dir = "native"',
        ),
      ),
    ])
  ).codes.includes("AFL4001"),
);
// One mapping covers an AFL contract and its selected impl, but not an unrelated preset.
write(
  join(project, "edge/config.toml"),
  '[crate]\nid="edge"\n[dep]\ncore="../shared"',
);
write(source, "extern fn value() -> i32 [desc=[Read]\nreturn=[Value]]");
write(
  join(project, "edge/lib.afl"),
  "impl dep::core::lib::value\nfn value() -> i32 { return 1 }",
);
const entry =
  '[[implementation]]\nafl="afl://counter/lib.afl#value"\nfile="native/Counter.kt"\nsymbol="opaque"\nline=1\n';
write(map, entry);
write(
  join(project, "config.toml"),
  '[project]\n[preset.kotlin]\ncore=["shared"]\nedge=["edge"]\nimplementations="kotlin.toml"',
);
snapshot = await load();
assert.deepEqual(snapshot.service.diagnostics, []);
let at = snapshot.service.resolveSymbol("afl://counter/lib.afl#value");
assert.equal(
  snapshot.service.implementations(at.uri, at.range.start).length,
  2,
);
assert.equal(snapshot.service.nativeImplementations.length, 2);
write(
  map,
  entry.replace("afl://counter/lib.afl#value", "afl://edge/lib.afl#value"),
);
assert.deepEqual((await load()).codes, []);
write(map, entry);
write(
  join(project, "config.toml"),
  fs
    .readFileSync(join(project, "config.toml"), "utf8")
    .replace('edge=["edge"]', "edge=[]"),
);
assert.deepEqual(
  (await load()).codes,
  [],
  "native association registers extern provider",
);
// An accepted unsupported capability cannot also have a native provider.
write(
  join(project, "edge/lib.afl"),
  "unsupported dep::core::lib::value [desc=[Unavailable]\nfallback=[Skip read]]",
);
write(
  join(project, "config.toml"),
  '[project]\n[preset.kotlin]\ncore=["shared"]\nedge=["edge"]\nimplementations="kotlin.toml"\nallow_unsupported=["shared/lib.afl::value"]',
);
assert((await load()).codes.includes("AFL4102"));
write(map, "implementation=[]");
assert.deepEqual((await load()).codes, ["AFL4103"]);
// A member association must not bypass an unsupported class boundary.
write(
  source,
  "extern class Capability [desc=[Capability]] {\nfn run() [desc=[Run]]\n}",
);
write(
  join(project, "edge/lib.afl"),
  "unsupported dep::core::lib::Capability [desc=[Unavailable]\nfallback=[Skip]]",
);
write(
  join(project, "config.toml"),
  fs
    .readFileSync(join(project, "config.toml"), "utf8")
    .replace("::value", "::Capability"),
);
write(map, entry.replace("#value", "#Capability.run"));
assert((await load()).codes.includes("AFL4102"));
// Current reverse dependencies and explicit test associations.
write(join(project, "edge/lib.afl"), "fn unrelated() {} ");
write(
  join(project, "config.toml"),
  '[project]\n[preset.kotlin]\ncore=["shared"]\nedge=[]\nimplementations="kotlin.toml"',
);
write(
  source,
  "fn value() -> i32 [return=[Value]] { return 1 }\nfn caller() -> i32 [return=[Value]] { return value() }",
);
write(map, entry + entry.replaceAll("#value", "#caller"));
write(
  join(project, "shared/config.toml"),
  '[crate]\nid="counter"\n[test]\ncrates=["../tests"]',
);
write(
  join(project, "tests/config.toml"),
  '[crate]\nid="tests"\n[dep]\ncore="../shared"',
);
write(
  join(project, "tests/lib.afl"),
  "use dep::core::lib::caller\nfn verify() { assert(caller() == 1) }",
);
const impact = await queryImpact(project, "kotlin", [native]);
assert.equal(impact.tests.length, 1);
assert(impact.declarations.some((d) => d.afl.endsWith("#caller")));
const cli = (...args) =>
  spawnSync(
    process.execPath,
    [join(root, "packages/cli/dist/afl.js"), ...args, "--json"],
    { encoding: "utf8" },
  );
for (const args of [
  ["check", project, "--preset", "kotlin"],
  ["trace", native, "--project", project],
  ["impact", native, "--project", project],
]) {
  assert.equal(cli(...args).status, 0, cli(...args).stdout);
}
for (const args of [
  ["generate", project],
  ["impact", source, "--project", project, "--baseline", temp],
  ["trace", native, "--line", "9007199254740992"],
]) {
  assert.equal(cli(...args).status, 2);
}
// Shared editor snapshots include unsaved mappings/native content and discard superseded loads.
const { build } = await import(
  uri(join(root, "node_modules/esbuild/lib/main.js"))
);
const bundle = join(temp, "projects.mjs");
await build({
  entryPoints: [join(root, "packages/lsp/src/projects.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  logLevel: "silent",
});
const { EditorProjects } = await import(uri(bundle));
const manager = new EditorProjects();
await manager.setFolders([uri(project)]);
await manager.select({ projectUri: uri(project), preset: "kotlin" });
assert(await manager.refresh([uri(project)], [], () => true));
const current = manager.context(uri(source)).service;
const bad = overlay(map, entry.replace("line=1", "line=999"));
assert.equal(await manager.refresh([uri(project)], [bad], () => false), false);
assert.deepEqual(current.diagnostics, []);
assert(await manager.refresh([uri(project)], [bad], () => true));
assert(manager.context(uri(source)).issues.some((d) => d.code === "AFL4202"));
assert(await manager.refresh([uri(project)], [], () => true));
assert.deepEqual(manager.context(uri(source)).issues, []);
console.log(
  "Implementation associations: coverage, opaque native snapshots, presets, impl links, trace, impact, CLI and editor recovery passed.",
);
