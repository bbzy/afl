import assert from "node:assert/strict";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
const suiteDirectory = path.join(process.argv[2], "tests/lsp");
const project_root = path.dirname(path.dirname(suiteDirectory));
const checker = path.join(project_root, "packages/checker/dist/index.js");
const files = {
  "file:///editor/core/lib.afl":
    "\nclass {|class|}Adder [desc = [An adder]] {\n    {|property|}base: i32 = 10000 [desc = [The initial value]]\n    fn {|method|}add(a: i32, b: i32) -> i32 [\n        a = [First input]\n        b = [Second input]\n        return = [Sum]\n    ] { self.base + a + b }\n}\nextern fn {|function|}combine(a: string?, b: i32) -> string? [\n    desc = [Combine text and a number]\n    a = [Text input]\n    b = [Number input]\n    return = [Combined text]\n]\nfn make() -> Adder? [return = [An adder or null]] {\n    result: Adder = {base: 1}\n    result\n}\nextern fn reserved(`return`: i32) -> i32 [\n    desc = [Accept a parameter with a keyword name]\n    `return` = [Input number]\n    return = [Result]\n]\n",
  "file:///editor/app/main.afl":
    '\nuse dep::core::lib::{|import|}Adder as Remote\nuse dep::core::lib::combine as join\nuse dep::core::lib::make\nclass Settings [desc = [Settings]] {\n    name: string? = {|default_call|}join(null, {|default_arg|}1) [desc = [Default name]]\n    adder: Remote = {} [desc = [Default adder]]\n}\nfn main() {\n    value: {|type|}Remote? = {{|field|}base: 10}\n    message: string = {|call|}join("a,b", {|arg|}1)\n    {|nullable_value|}value.{|member|}add(1, 2)\n    value.ba{|complete_member|}se\n    make().{|chained|}base\n    local: i32 = 1\n    if true {\n        hidden: i32 = 2\n        lo{|local_completion|}cal\n    }\n    {|outside_scope|}local\n    [join and value.base are {|prose|}ordinary words]\n    text: string = "join {|literal|}value"\n    raw_text: string? = {|raw_call|}join(r##"a "#, ) [\n{|raw_literal|}value.base"##, {|raw_arg|}1)\n    r##[join and {|raw_prose|}value.base ]# are words]##\n    {|callback_binding|}handler: fn(i32, i32) -> i32 = value.{|method_reference|}add\n    {|callback_call|}handler(1, {|callback_arg|}2)\n}\n',
};
const incomplete = [
  {
    name: "member",
    text: "fn main() {\n value: Remote = [Create]\n value.{|cursor|}",
    labels: ["add", "base"],
  },
  {
    name: "raw_signature",
    text: 'fn main() {\njoin(r##"a "# , ) [\nb"##, {|cursor|}',
    parameter: 1,
  },
  {
    name: "raw_unclosed_string",
    text: 'fn main() {\ntext: string = r##"a "# join {|cursor|}',
    labels: [],
  },
  {
    name: "raw_unclosed_prose",
    text: "fn main() {\nr##[a ]# join {|cursor|}",
    labels: [],
  },
  {
    name: "raw_literal_end",
    text: 'fn main() {\ntext: string = r#"a"# \njo{|cursor|}',
    labels: ["join"],
  },
  {
    name: "raw_prose_end",
    text: "fn main() {\nr##[a ]#]##\njo{|cursor|}",
    labels: ["join"],
  },
  {
    name: "property_default_completion",
    text: "class Settings [desc = [Settings]] {\n value: string? = jo{|cursor|}",
    labels: ["join"],
  },
  {
    name: "property_default_signature",
    text: "class Settings [desc = [Settings]] {\n value: string? = join(null, {|cursor|}",
    parameter: 1,
  },
  {
    name: "member_prefix",
    text: "fn main() {\n value: Remote = [Create]\n value.ba{|cursor|}",
    labels: ["base"],
  },
  {
    name: "nullable_member",
    text: "fn main() {\n value: Remote? = null\n value.{|cursor|}",
    labels: ["add", "base"],
  },
  {
    name: "null_keyword",
    text: "fn main() {\n value: string? = nu{|cursor|}",
    labels: ["null"],
  },
  {
    name: "callback_signature",
    text: "fn main() {\n handler: fn(i32, string) -> bool = [Create handler]\n handler(1, {|cursor|}",
    parameter: 1,
  },
  {
    name: "callback_return_member",
    text: "fn main() {\n handler: fn() -> Remote? = [Create handler]\n handler().{|cursor|}",
    labels: ["add", "base"],
  },
  {
    name: "returned_callback_signature",
    text: "fn main() {\n factory: fn() -> fn(string) -> i32 = [Create factory]\n factory()({|cursor|}",
    parameter: 0,
  },
  {
    name: "unknown_member",
    text: "fn main() {\n value = [Create]\n value.{|cursor|}",
    labels: [],
  },
  {
    name: "signature",
    text: 'fn main() {\n join("a,b", {|cursor|}',
    parameter: 1,
  },
  {
    name: "nested_signature",
    text: 'fn main() {\n value: Remote = [Create]\n join("x", value.add(1, {|cursor|}',
    parameter: 1,
  },
  { name: "dep_completion", text: "use dep::{|cursor|}", labels: ["core"] },
  {
    name: "module_completion",
    text: "use dep::core::{|cursor|}",
    labels: ["lib"],
  },
  {
    name: "export_completion",
    text: "use dep::core::lib::co{|cursor|}",
    labels: ["combine"],
  },
  { name: "keyword", text: "ret{|cursor|}", labels: ["return"] },
  {
    name: "unclosed_prose",
    text: "fn main() {\n [Describe {|cursor|}",
    labels: [],
  },
  {
    name: "future_variable",
    text: "fn main() {\n lat{|cursor|}\n later: i32 = 1\n}",
    labels: [],
  },
  {
    name: "after_invalid_literal",
    text: 'fn main() {\n text: string = "\\q"\n}\nfn next() {\n jo{|cursor|}\n}',
    labels: ["join"],
  },
  {
    name: "escaped_local",
    text: "fn main() {\n `return` = [Result]\n `ret{|cursor|}",
    labels: ["return"],
  },
  {
    name: "escaped_signature",
    text: "fn main() {\n reserved({|cursor|}",
    parameter: 0,
  },
];
const execution = await exercise({ files: files, incomplete: incomplete }, [
  checker,
]);
const result = execution;
assert(result.firstUpdate);
assert(!result.unchangedUpdate);
assert.deepEqual(result.diagnostics, []);
assert.deepEqual(result.cliDiagnostics, []);
for (const pair of [
  ["import", "class"],
  ["type", "class"],
  ["field", "property"],
  ["call", "function"],
  ["member", "method"],
  ["chained", "property"],
  ["default_call", "function"],
]) {
  const location = result.definitions[pair[0]];
  assert.deepEqual(location.uri, "file:///editor/core/lib.afl");
  assert.deepEqual(location.range.start, result.coreMarks[pair[1]]);
}
assert.deepEqual(
  result.memberCompletions.map((item) => item.label),
  ["base"],
);
assert.deepEqual(
  result.localCompletions.map((item) => item.label),
  ["local"],
);
assert(!result.outsideCompletions.map((item) => item.label).includes("hidden"));
assert.deepEqual(result.proseCompletion, []);
assert.deepEqual(result.proseDefinition, null);
assert.deepEqual(result.literalCompletion, []);
assert.deepEqual(result.rawLiteralCompletion, []);
assert.deepEqual(result.rawLiteralDefinition, null);
assert.deepEqual(result.rawProseCompletion, []);
assert.deepEqual(result.rawProseDefinition, null);
assert.deepEqual(result.rawSignature.activeParameter, 1);
assert(result.hover.text.includes("First input"));
assert(result.propertyHover.text.includes("base: i32 = 10000"));
assert.deepEqual(result.defaultSignature.activeParameter, 1);
assert.deepEqual(result.defaultSignature.parameters[1].label, "b: i32");
assert(
  result.defaultReferences.some((ref) =>
    isDeepStrictEqual(ref.range.start, result.defaultCallPosition),
  ),
);
assert.deepEqual(result.outline[0].children[0].detail, "base: i32 = 10000");
assert(result.nullableHover.text.includes("Adder?"));
assert.deepEqual(result.callbackDefinition.range.start, result.callbackBinding);
assert.deepEqual(result.methodReference.range.start, result.coreMarks.method);
assert.deepEqual(result.methodReference.uri, "file:///editor/core/lib.afl");
assert(result.callbackHover.text.includes("fn(i32, i32) -> i32"));
assert.deepEqual(result.callbackSignature.label, "fn(i32, i32) -> i32");
assert.deepEqual(result.callbackSignature.activeParameter, 1);
assert.deepEqual(
  result.callbackSignature.parameters.map((item) => item.label),
  ["i32", "i32"],
);
assert.deepEqual(result.signature.parameters[0].label, "a: string?");
assert(result.signature.label.endsWith("-> string?"));
assert(
  result.outline
    .filter((item) => item.name === "make")[0]
    .detail.includes("Adder?"),
);
assert.deepEqual(result.signature.activeParameter, 1);
assert(result.signature.parameters[1].documentation.includes("Number input"));
assert(result.references.length > result.withoutDeclaration.length);
assert.deepEqual(
  result.outline[0].children.map((item) => item.name),
  ["base", "add"],
);
for (const testCase of incomplete) {
  const actual = result.cases.filter((item) => item.name === testCase.name)[0];
  if (Object.hasOwn(testCase, "labels")) {
    assert.deepEqual(
      actual.completion.map((item) => item.label),
      testCase.labels,
      testCase.name,
    );
  }
  if (Object.hasOwn(testCase, "parameter")) {
    assert.deepEqual(
      actual.signature.activeParameter,
      testCase.parameter,
      testCase.name,
    );
  }
}
const keyword = result.cases.filter((item) => item.name === "keyword")[0]
  .completion[0];
assert.deepEqual(keyword.insertText, "return");
const escaped = result.cases.filter((item) => item.name === "escaped_local")[0]
  .completion[0];
assert.deepEqual(escaped.insertText, "`return`");
const signature = result.cases.filter(
  (item) => item.name === "escaped_signature",
)[0].signature;
assert.deepEqual(signature.parameters[0].label, "`return`: i32");
assert.deepEqual(signature.parameters[0].documentation, "Input number");
assert(signature.label.includes(signature.parameters[0].label));
assert(result.cachedDependencyAst);
assert(result.changedDocumentAst);
assert.deepEqual(result.afterRename, null);
assert(result.renamedDiagnostics.map((item) => item.code).includes("AFL3102"));
assert.deepEqual(result.afterClose, []);
assert(result.removedAst);
console.log(
  "Editor index checks passed: navigation, references, completion, hover, signatures, recovery and AST caching.",
);

async function exercise(payload: any, args: string[]) {
  const { pathToFileURL } = await import("node:url");
  const { LanguageService, checkProject } = await import(
    pathToFileURL(args[0]).href
  );
  const input = payload;
  const mainUri = "file:///editor/app/main.afl",
    coreUri = "file:///editor/core/lib.afl";
  const context = {
    crates: [
      {
        root: "file:///editor/app/",
        kind: "binary",
        dependencies: { core: "file:///editor/core/" },
      },
      { root: "file:///editor/core/", kind: "library", dependencies: {} },
    ],
  };
  const position = (text, offset) => {
    const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
    return { line: lines.length - 1, character: lines.at(-1).length };
  };
  const marked = (uri, source) => {
    const offsets = {};
    let text = "",
      end = 0;
    for (const match of source.matchAll(/\{\|([A-Za-z_0-9]+)\|\}/g)) {
      text += source.slice(end, match.index);
      offsets[match[1]] = text.length;
      end = match.index + match[0].length;
    }
    text += source.slice(end);
    return {
      uri,
      text,
      marks: Object.fromEntries(
        Object.entries(offsets).map(([name, offset]) => [
          name,
          position(text, offset),
        ]),
      ),
    };
  };
  const documents = Object.entries(input.files).map(([uri, text]) =>
    marked(uri, text),
  );
  const main = documents.find((item) => item.uri === mainUri),
    core = documents.find((item) => item.uri === coreUri);
  const service = new LanguageService();
  const firstUpdate = service.update(documents, context);
  const definition = (at) => service.definition(mainUri, main.marks[at]);
  const memberCompletions = service.completion(
    mainUri,
    main.marks.complete_member,
  );
  const result: Record<string, any> = {
    firstUpdate,
    unchangedUpdate: service.update(documents, context),
    diagnostics: service.diagnostics,
    cliDiagnostics: checkProject(documents, context).diagnostics,
    definitions: Object.fromEntries(
      [
        "import",
        "type",
        "field",
        "call",
        "member",
        "chained",
        "default_call",
      ].map((name) => [name, definition(name)]),
    ),
    coreMarks: core.marks,
    memberCompletions,
    localCompletions: service.completion(mainUri, main.marks.local_completion),
    outsideCompletions: service.completion(mainUri, main.marks.outside_scope),
    proseCompletion: service.completion(mainUri, main.marks.prose),
    proseDefinition: service.definition(mainUri, main.marks.prose) ?? null,
    literalCompletion: service.completion(mainUri, main.marks.literal),
    rawLiteralCompletion: service.completion(mainUri, main.marks.raw_literal),
    rawLiteralDefinition:
      service.definition(mainUri, main.marks.raw_literal) ?? null,
    rawProseCompletion: service.completion(mainUri, main.marks.raw_prose),
    rawProseDefinition:
      service.definition(mainUri, main.marks.raw_prose) ?? null,
    rawSignature: service.signatureHelp(mainUri, main.marks.raw_arg),
    hover: service.hover(mainUri, main.marks.member),
    propertyHover: service.hover(mainUri, main.marks.field),
    defaultSignature: service.signatureHelp(mainUri, main.marks.default_arg),
    defaultReferences: service.references(coreUri, core.marks.function, false),
    defaultCallPosition: main.marks.default_call,
    nullableHover: service.hover(mainUri, main.marks.nullable_value),
    callbackDefinition: service.definition(mainUri, main.marks.callback_call),
    callbackBinding: main.marks.callback_binding,
    methodReference: service.definition(mainUri, main.marks.method_reference),
    callbackHover: service.hover(mainUri, main.marks.callback_call),
    callbackSignature: service.signatureHelp(mainUri, main.marks.callback_arg),
    signature: service.signatureHelp(mainUri, main.marks.arg),
    references: service.references(coreUri, core.marks.class),
    withoutDeclaration: service.references(coreUri, core.marks.class, false),
    outline: service.documentSymbols(coreUri),
    cases: [],
  };
  const stableAst = service.getModule(coreUri),
    mainAst = service.getModule(mainUri);
  const prefix =
    "use dep::core::lib::Adder as Remote\nuse dep::core::lib::combine as join\nuse dep::core::lib::reserved\n";
  for (const item of input.incomplete) {
    const document = marked(mainUri, prefix + item.text);
    service.update([core, document], context);
    result.cases.push({
      name: item.name,
      completion: service.completion(mainUri, document.marks.cursor),
      signature: service.signatureHelp(mainUri, document.marks.cursor) ?? null,
      diagnostics: service.diagnostics,
    });
  }
  result.cachedDependencyAst = service.getModule(coreUri) === stableAst;
  result.changedDocumentAst = service.getModule(mainUri) !== mainAst;
  const renamedCore = {
    ...core,
    text: core.text.replace("class Adder", "class Renamed"),
  };
  service.update([renamedCore, main], context);
  result.afterRename = service.definition(mainUri, main.marks.type) ?? null;
  result.renamedDiagnostics = service.diagnostics;
  service.update([], {});
  result.afterClose = service.completion(mainUri, main.marks.type);
  result.removedAst = service.getModule(coreUri) === undefined;
  return result;
}
