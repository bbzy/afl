import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/language");
const fixtureDirectory = process.argv[3];
const root = path.dirname(path.dirname(suiteDirectory));
const checker = path.join(root, "packages/checker/dist/index.js");
const executionResult = await exercise([checker]);
console.log(executionResult);
const cli = path.join(root, "packages/cli/bin/afl.mjs");
const fixture = fixtureDirectory;
try {
  fs.writeFileSync(path.join(fixture, "config.toml"), "[dep]");
  const file = path.join(fixture, "lib.afl");
  fs.writeFileSync(
    file,
    "fn target() {}\nfn example() {\n    [See {@target}]\n    r#[Literal {@target}]#\n}",
  );
  const query = run(process.execPath, [
    cli,
    "references",
    file,
    "--line",
    1,
    "--column",
    4,
    "--json",
  ]);
  assert.deepEqual(query.exit_code, 0, query.stderr);
  const results = JSON.parse(query.stdout).results;
  assert.deepEqual(results.length, 1);
  assert.deepEqual(results[0].range.start, { line: 2, character: 11 });
  const definition = run(process.execPath, [
    cli,
    "definition",
    file,
    "--line",
    3,
    "--column",
    12,
    "--json",
  ]);
  assert.deepEqual(definition.exit_code, 0, definition.stderr);
  assert.deepEqual(JSON.parse(definition.stdout).results[0].range.start, {
    line: 0,
    character: 3,
  });
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(
  "CLI references and definition include explicit links and exclude raw text.",
);

async function exercise(args: string[]) {
  const { pathToFileURL } = await import("node:url");
  const { checkProject, parseDocument, LanguageService } = await import(
    pathToFileURL(args[0]).href
  );
  const uri = "file:///links/app/lib.afl";
  const helpers = {
    uri: "file:///links/app/helpers.afl",
    text: "fn help() {}",
  };
  const core = {
    uri: "file:///links/core/lib.afl",
    text: "extern fn show() [desc = [Show a button]]",
  };
  const edge = {
    uri: "file:///links/edge/lib.afl",
    text: "impl dep::core::lib::show\nfn show() {}",
  };
  const ios = { uri: "file:///links/ios/lib.afl", text: edge.text };
  const context = {
    crates: [
      {
        root: "file:///links/app/",
        kind: "library",
        dependencies: { core: "file:///links/core/" },
      },
      { root: "file:///links/core/", kind: "library", dependencies: {} },
      {
        root: "file:///links/edge/",
        kind: "library",
        dependencies: { core: "file:///links/core/" },
      },
      {
        root: "file:///links/ios/",
        kind: "library",
        dependencies: { core: "file:///links/core/" },
      },
    ],
  };
  const declarations =
    "use dep::core::lib::show as display\n" +
    "struct Data [desc = [Data {@Data.count}]] { count: i32 = [Read {@helpers::help}] [desc = [An {@i32}]] }\n" +
    "class Box [desc = [Box {@Data}]] {\n" +
    " data: Data? [desc = [Stored {@Data.count}]]\n" +
    " fn update(value: i32) -> result: i32 [value = [Input {@value}]\nresult = [Result {@result} from {@self.data.count}]] { result = value }\n}\n";
  const cases = [
    ["global alias", "[See {@display}]"],
    ["relative", "[See {@helpers::help}]"],
    ["crate", "[See {@crate::helpers::help}]"],
    ["dep", "[See {@dep::core::lib::show}]"],
    ["spaced path", "[See {@ dep :: core :: lib :: show }]"],
    ["type member", "[See {@Box.update} and {@Box.data.count}]"],
    ["local member", "box: Box? = [Create box]\n[See {@box.data.count}]"],
    ["local", "value: i32 = 1\n[Use {@value}]"],
    ["initializer", "value: i32 = 1\nnext = [Use {@value}]"],
    [
      "loop",
      "items: list<Data> = {}\nfor index, item in items { [Use {@index} and {@item.count}] }",
    ],
    ["collection", "items: list<Data> = {}\n[See {@items.get}]"],
    ["builtins", "[See {@assert}, {@i32}, {@list}]"],
    ["escaped", "`return`: i32 = 1\n[See {@`return`}]"],
    ["opaque prose", "[Unresolved missing() and missing.member stay prose]"],
    ["opaque raw", "r#[Unresolved {@missing} and malformed {@fn(]#"],
    [
      "opaque string",
      'text: string = "{@missing}"\nraw: string = r#"{@missing}"#',
    ],
    ["nested", "[Nested [See {@display}]]"],
    ["multiline prose", "[First line\nSee {@display}\nLast line]"],
    ["missing", "[See {@missing}]", "AFL3203"],
    ["no prose declaration", "[value = create]\n[See {@value}]", "AFL3203"],
    [
      "not imported by link",
      "[See {@dep::core::lib::show}]\nshow()",
      "AFL3203",
    ],
    ["local forward", "[See {@later}]\nlater: i32 = 1", "AFL3203"],
    ["initializer self", "value = [Use {@value}]", "AFL3203"],
    ["out of block", "if true { value: i32 = 1 }\n[See {@value}]", "AFL3203"],
    ["missing module", "[See {@absent::show}]", "AFL3101"],
    ["missing dependency", "[See {@dep::absent::lib::show}]", "AFL3101"],
    ["missing export", "[See {@helpers::absent}]", "AFL3102"],
    ["missing member", "[See {@Data.absent}]", "AFL3204"],
    [
      "unknown receiver",
      "value = [An object]\n[See {@value.count}]",
      "AFL3205",
    ],
    ...[
      "",
      "display(",
      "display()",
      "display + 1",
      "helpers::",
      "Box.",
      "fn",
      "return",
      "Box.data::count",
      "display\n",
      "display {@display}",
    ].map((text) => ["malformed " + text, "[See {@" + text + "}]", "AFL1006"]),
    ["missing close", "[See {@display]", "AFL1006"],
  ];
  for (const [name, body, code] of cases) {
    const doc = { uri, text: declarations + "fn main() {\n" + body + "\n}" };
    const diagnostics = checkProject([helpers, core, doc], context).diagnostics;
    if (code) {
      assert(
        diagnostics.some((d) => d.code === code),
        name + JSON.stringify(diagnostics),
      );
    } else {
      assert.deepEqual(diagnostics, [], name);
    }
  }
  for (const text of [
    "fn foo(a: i32) [a = [See {@local}]] { local: i32 = 1 }",
    "struct Foo [desc = [See {@missing}]] {}",
    "class Foo [desc = [Foo]] { x: i32 [desc = [See {@missing}]] }",
  ]) {
    assert(
      checkProject([{ uri, text }]).diagnostics.some(
        (d) => d.code === "AFL3203",
      ),
      text,
    );
  }

  const service = new LanguageService();
  const doc = {
    uri,
    text:
      declarations +
      "fn main() {\n value: i32 = 1\n [😀 \\[ escaped \\] \\\\ {@value}; {@display}; {@dep::core::lib::show}; {@Box.data.count}]\n r#[Literal {@missing}]#\n}",
  };
  const position = (text, offset) => ({
    line: text.slice(0, offset).split("\n").length - 1,
    character: offset - text.lastIndexOf("\n", offset - 1) - 1,
  });
  const at = (doc, text, delta = 0) => {
    assert(doc.text.includes(text), text);
    return position(doc.text, doc.text.indexOf(text) + delta);
  };
  const update = (doc, extra = context) =>
    service.update([helpers, core, edge, ios, doc], extra);
  update(doc);
  assert.deepEqual(service.diagnostics, []);
  const parsed = parseDocument(doc);
  const link = parsed.descriptionLinks.find(
    (l) => doc.text.slice(l.start, l.end) === "{@display}",
  );
  assert(link?.valid);
  assert.equal(doc.text.slice(link.path[0].start, link.path[0].end), "display");
  assert.equal(
    parsed.module.declarations.at(-1).body.statements[1].values[0].text,
    "😀 [ escaped ] \\ {@value}; {@display}; {@dep::core::lib::show}; {@Box.data.count}",
  );
  assert(!parsed.descriptionLinks.some((l) => l.path[0]?.text === "missing"));
  const crlf = parseDocument({
    ...doc,
    text: doc.text.replaceAll("\n", "\r\n"),
  });
  for (const l of crlf.descriptionLinks) {
    assert.equal(
      doc.text.replaceAll("\n", "\r\n").slice(l.start, l.end).startsWith("{@"),
      true,
    );
  }
  assert.deepEqual(
    service.definition(uri, at(doc, "\\\\ {@value}", 5)).range.start,
    at(doc, "value: i32 = 1"),
  );
  assert.equal(service.definition(uri, at(doc, "{@display}", 2)).uri, core.uri);
  assert.equal(
    service.definition(uri, at(doc, "{@dep::core::lib::show}", 18)).uri,
    core.uri,
  );
  assert.deepEqual(
    service.definition(uri, at(doc, "{@Box.data.count}", 11)).range.start,
    at(doc, "count: i32"),
  );
  assert.match(
    service.hover(uri, at(doc, "{@display}", 2)).text,
    /Show a button/,
  );
  const references = service.references(core.uri, at(core, "show()"), false);
  for (const marker of ["{@display}", "{@dep::core::lib::show}"]) {
    assert(
      references.some(
        (ref) =>
          ref.uri === uri && ref.range.start.line === at(doc, marker).line,
      ),
    );
  }
  assert.equal(service.signatureHelp(uri, at(doc, "{@display}", 4)), undefined);
  assert.equal(service.definition(uri, at(doc, "{@missing}", 2)), undefined);
  assert.deepEqual(service.completion(uri, at(doc, "{@missing}", 4)), []);
  assert.deepEqual(service.completion(uri, at(doc, "escaped", 3)), []);
  assert.match(service.hover(uri, at(doc, "{@i32}", 2)).text, /i32/);
  assert.equal(service.definition(uri, at(doc, "{@i32}", 2)), undefined);
  assert.deepEqual(service.references(uri, at(doc, "{@i32}", 2), true), []);
  const completionCases: [string, string, string[]][] = [
    ["[See {@dis}]", "dis", ["display"]],
    ["[See {@}]", "{@", ["display", "Box", "helpers", "crate", "dep"]],
    ["[See {@helpers::}]", "::", ["help"]],
    ["[See {@crate::helpers::}]", "helpers::", ["help"]],
    ["[See {@dep::}]", "dep::", ["core"]],
    ["[See {@dep :: core :: lib :: }]", "lib :: ", ["show"]],
    ["[See {@Box.}]", "Box.", ["data", "update"]],
    ["box: Box = [Object]\n[See {@box.data.}]", "data.", ["count"]],
    ["items: list<Data> = {}\n[See {@items.}]", "items.", ["get", "len"]],
    ["[See {@crate::lib::Box.}]", "Box.", ["data", "update"]],
    ["[See {@dis", "dis", ["display"]],
    ["[See {@dep::core::lib::", "lib::", ["show"]],
    ["value: i32 = 1\n[See {@val", "val", ["value"]],
  ];
  for (const [body, cursor, expected] of completionCases) {
    const edit = { ...doc, text: declarations + "fn main() {\n" + body };
    update(edit);
    const offset = edit.text.lastIndexOf(cursor) + cursor.length;
    const labels = service
      .completion(uri, position(edit.text, offset))
      .map((item) => item.label);
    for (const label of expected) {
      assert(labels.includes(label), body + JSON.stringify(labels));
    }
    assert(!labels.includes("while"));
  }
  // Signature documentation sees parameters/results, but no body-local declarations.
  const signatureDoc = {
    uri,
    text: "fn foo(input: i32) -> result: i32 [input = [See {@}]\nresult = [Result]] { local: i32 = 1 }",
  };
  update(signatureDoc);
  const labels = service
    .completion(uri, at(signatureDoc, "{@}", 2))
    .map((item) => item.label);
  assert(
    labels.includes("input") &&
      labels.includes("result") &&
      !labels.includes("local"),
  );
  update(doc);
  service.update(
    [helpers, { ...core, text: core.text.replace("show()", "renamed()") }, doc],
    context,
  );
  assert(service.diagnostics.some((d) => d.code === "AFL3102"));
  update(doc);
  assert.deepEqual(service.diagnostics, []);
  const preset = (name, root) => ({
    ...context,
    preset: {
      name,
      uri: "file:///links/config.toml",
      core: [context.crates[1].root],
      edge: [root],
    },
  });
  for (const implementation of [edge, ios]) {
    update(
      doc,
      preset(
        implementation === edge ? "android" : "ios",
        new URL(".", implementation.uri).href,
      ),
    );
    assert.deepEqual(service.diagnostics, []);
    assert.deepEqual(
      service
        .implementations(uri, at(doc, "{@display}", 2))
        .map((item) => item.uri),
      [implementation.uri],
    );
  }
  const referenceOnly = {
    ...edge,
    text: "fn show() { [See {@dep::core::lib::show}] }",
  };
  const incomplete = checkProject(
    [core, referenceOnly],
    preset("android", context.crates[2].root),
  );
  assert(
    incomplete.diagnostics.some((d) => d.code === "AFL4101"),
    "A link must not provide an implementation",
  );
  return `Description links passed: ${cases.length} syntax/scope cases, AST offsets, editor recovery and preset navigation.`;
}
