use std/assert

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let checker = ($project_root | path join "packages/checker/dist/index.js")
  let files = {
    "file:///editor/core/lib.afl": r#'
class {|class|}Adder [desc = [An adder]] {
    {|property|}base: i32 = 10000 [desc = [The initial value]]
    fn {|method|}add(a: i32, b: i32) -> i32 [
        a = [First input]
        b = [Second input]
        return = [Sum]
    ] { self.base + a + b }
}
extern fn {|function|}combine(a: string?, b: i32) -> string? [
    desc = [Combine text and a number]
    a = [Text input]
    b = [Number input]
    return = [Combined text]
]
fn make() -> Adder? [return = [An adder or null]] {
    result: Adder = {base: 1}
    result
}
extern fn reserved(`return`: i32) -> i32 [
    desc = [Accept a parameter with a keyword name]
    `return` = [Input number]
    return = [Result]
]
'#
    "file:///editor/app/main.afl": r#'
use dep::core::lib::{|import|}Adder as Remote
use dep::core::lib::combine as join
use dep::core::lib::make
class Settings [desc = [Settings]] {
    name: string? = {|default_call|}join(null, {|default_arg|}1) [desc = [Default name]]
    adder: Remote = {} [desc = [Default adder]]
}
fn main() {
    value: {|type|}Remote? = {{|field|}base: 10}
    message: string = {|call|}join("a,b", {|arg|}1)
    {|nullable_value|}value.{|member|}add(1, 2)
    value.ba{|complete_member|}se
    make().{|chained|}base
    local: i32 = 1
    if true {
        hidden: i32 = 2
        lo{|local_completion|}cal
    }
    {|outside_scope|}local
    [join and value.base are {|prose|}ordinary words]
    text: string = "join {|literal|}value"
    raw_text: string? = {|raw_call|}join(r##"a "#, ) [
{|raw_literal|}value.base"##, {|raw_arg|}1)
    r##[join and {|raw_prose|}value.base ]# are words]##
    {|callback_binding|}handler: fn(i32, i32) -> i32 = value.{|method_reference|}add
    {|callback_call|}handler(1, {|callback_arg|}2)
}
'#
  }
  let incomplete = [
    {name: "member", text: "fn main() {\n value: Remote = [Create]\n value.{|cursor|}", labels: ["add", "base"]}
    {name: "raw_signature", text: 'fn main() {
join(r##"a "# , ) [
b"##, {|cursor|}', parameter: 1}
    {name: "raw_unclosed_string", text: 'fn main() {
text: string = r##"a "# join {|cursor|}', labels: []}
    {name: "raw_unclosed_prose", text: 'fn main() {
r##[a ]# join {|cursor|}', labels: []}
    {name: "raw_literal_end", text: 'fn main() {
text: string = r#"a"# 
jo{|cursor|}', labels: ["join"]}
    {name: "raw_prose_end", text: 'fn main() {
r##[a ]#]##
jo{|cursor|}', labels: ["join"]}
    {name: "property_default_completion", text: "class Settings [desc = [Settings]] {\n value: string? = jo{|cursor|}", labels: ["join"]}
    {name: "property_default_signature", text: "class Settings [desc = [Settings]] {\n value: string? = join(null, {|cursor|}", parameter: 1}
    {name: "member_prefix", text: "fn main() {\n value: Remote = [Create]\n value.ba{|cursor|}", labels: ["base"]}
    {name: "nullable_member", text: "fn main() {\n value: Remote? = null\n value.{|cursor|}", labels: ["add", "base"]}
    {name: "null_keyword", text: "fn main() {\n value: string? = nu{|cursor|}", labels: ["null"]}
    {name: "callback_signature", text: "fn main() {\n handler: fn(i32, string) -> bool = [Create handler]\n handler(1, {|cursor|}", parameter: 1}
    {name: "callback_return_member", text: "fn main() {\n handler: fn() -> Remote? = [Create handler]\n handler().{|cursor|}", labels: ["add", "base"]}
    {name: "returned_callback_signature", text: "fn main() {\n factory: fn() -> fn(string) -> i32 = [Create factory]\n factory()({|cursor|}", parameter: 0}
    {name: "unknown_member", text: "fn main() {\n value = [Create]\n value.{|cursor|}", labels: []}
    {name: "signature", text: "fn main() {\n join(\"a,b\", {|cursor|}", parameter: 1}
    {name: "nested_signature", text: "fn main() {\n value: Remote = [Create]\n join(\"x\", value.add(1, {|cursor|}", parameter: 1}
    {name: "dep_completion", text: "use dep::{|cursor|}", labels: ["core"]}
    {name: "module_completion", text: "use dep::core::{|cursor|}", labels: ["lib"]}
    {name: "export_completion", text: "use dep::core::lib::co{|cursor|}", labels: ["combine"]}
    {name: "keyword", text: "ret{|cursor|}", labels: ["return"]}
    {name: "unclosed_prose", text: "fn main() {\n [Describe {|cursor|}", labels: []}
    {name: "future_variable", text: "fn main() {\n lat{|cursor|}\n later: i32 = 1\n}", labels: []}
    {name: "after_invalid_literal", text: "fn main() {\n text: string = \"\\q\"\n}\nfn next() {\n jo{|cursor|}\n}", labels: ["join"]}
    {name: "escaped_local", text: "fn main() {\n `return` = [Result]\n `ret{|cursor|}", labels: ["return"]}
    {name: "escaped_signature", text: "fn main() {\n reserved({|cursor|}", parameter: 0}
  ]
  let bridge = r#'
    import {readFileSync} from "node:fs";
    import {pathToFileURL} from "node:url";
    const {LanguageService, checkProject} = await import(pathToFileURL(process.argv[1]).href);
    const input = JSON.parse(readFileSync(0, "utf8"));
    const mainUri = "file:///editor/app/main.afl", coreUri = "file:///editor/core/lib.afl";
    const context = {crates: [
      {root: "file:///editor/app/", kind: "binary", dependencies: {core: "file:///editor/core/"}},
      {root: "file:///editor/core/", kind: "library", dependencies: {}},
    ]};
    const position = (text, offset) => {
      const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
      return {line: lines.length - 1, character: lines.at(-1).length};
    };
    const marked = (uri, source) => {
      const offsets = {};
      let text = "", end = 0;
      for (const match of source.matchAll(/\{\|([A-Za-z_0-9]+)\|\}/g)) {
        text += source.slice(end, match.index); offsets[match[1]] = text.length; end = match.index + match[0].length;
      }
      text += source.slice(end);
      return {uri, text, marks: Object.fromEntries(Object.entries(offsets).map(([name, offset]) => [name, position(text, offset)]))};
    };
    const documents = Object.entries(input.files).map(([uri, text]) => marked(uri, text));
    const main = documents.find(item => item.uri === mainUri), core = documents.find(item => item.uri === coreUri);
    const service = new LanguageService();
    const firstUpdate = service.update(documents, context);
    const definition = at => service.definition(mainUri, main.marks[at]);
    const memberCompletions = service.completion(mainUri, main.marks.complete_member);
    const result = {
      firstUpdate, unchangedUpdate: service.update(documents, context),
      diagnostics: service.diagnostics, cliDiagnostics: checkProject(documents, context).diagnostics,
      definitions: Object.fromEntries(["import", "type", "field", "call", "member", "chained", "default_call"].map(name => [name, definition(name)])),
      coreMarks: core.marks,
      memberCompletions,
      localCompletions: service.completion(mainUri, main.marks.local_completion),
      outsideCompletions: service.completion(mainUri, main.marks.outside_scope),
      proseCompletion: service.completion(mainUri, main.marks.prose),
      proseDefinition: service.definition(mainUri, main.marks.prose) ?? null,
      literalCompletion: service.completion(mainUri, main.marks.literal),
      rawLiteralCompletion: service.completion(mainUri, main.marks.raw_literal),
      rawLiteralDefinition: service.definition(mainUri, main.marks.raw_literal) ?? null,
      rawProseCompletion: service.completion(mainUri, main.marks.raw_prose),
      rawProseDefinition: service.definition(mainUri, main.marks.raw_prose) ?? null,
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
    const stableAst = service.getModule(coreUri), mainAst = service.getModule(mainUri);
    const prefix = "use dep::core::lib::Adder as Remote\nuse dep::core::lib::combine as join\nuse dep::core::lib::reserved\n";
    for (const item of input.incomplete) {
      const document = marked(mainUri, prefix + item.text);
      service.update([core, document], context);
      result.cases.push({name: item.name, completion: service.completion(mainUri, document.marks.cursor),
        signature: service.signatureHelp(mainUri, document.marks.cursor) ?? null,
        diagnostics: service.diagnostics});
    }
    result.cachedDependencyAst = service.getModule(coreUri) === stableAst;
    result.changedDocumentAst = service.getModule(mainUri) !== mainAst;
    const renamedCore = {...core, text: core.text.replace("class Adder", "class Renamed")};
    service.update([renamedCore, main], context);
    result.afterRename = service.definition(mainUri, main.marks.type) ?? null;
    result.renamedDiagnostics = service.diagnostics;
    service.update([], {});
    result.afterClose = service.completion(mainUri, main.marks.type);
    result.removedAst = service.getModule(coreUri) === undefined;
    console.log(JSON.stringify(result));
  '#
  let execution = ({files: $files, incomplete: $incomplete} | to json | ^node --input-type=module -e $bridge $checker | complete)
  if $execution.exit_code != 0 { error make {msg: $execution.stderr} }
  let result = ($execution.stdout | from json)
  assert $result.firstUpdate
  assert not $result.unchangedUpdate
  assert equal $result.diagnostics []
  assert equal $result.cliDiagnostics []
  for pair in [["import", "class"], ["type", "class"], ["field", "property"], ["call", "function"], ["member", "method"], ["chained", "property"], ["default_call", "function"]] {
    let location = ($result.definitions | get $pair.0)
    assert equal $location.uri "file:///editor/core/lib.afl"
    assert equal $location.range.start ($result.coreMarks | get $pair.1)
  }
  assert equal ($result.memberCompletions | get label) ["base"]
  assert equal ($result.localCompletions | get label) ["local"]
  assert not ("hidden" in ($result.outsideCompletions | get label))
  assert equal $result.proseCompletion []
  assert equal $result.proseDefinition null
  assert equal $result.literalCompletion []
  assert equal $result.rawLiteralCompletion []
  assert equal $result.rawLiteralDefinition null
  assert equal $result.rawProseCompletion []
  assert equal $result.rawProseDefinition null
  assert equal $result.rawSignature.activeParameter 1
  assert ($result.hover.text | str contains "First input")
  assert ($result.propertyHover.text | str contains "base: i32 = 10000")
  assert equal $result.defaultSignature.activeParameter 1
  assert equal $result.defaultSignature.parameters.1.label "b: i32"
  assert ($result.defaultReferences | any {|ref| $ref.range.start == $result.defaultCallPosition })
  assert equal $result.outline.0.children.0.detail "base: i32 = 10000"
  assert ($result.nullableHover.text | str contains "Adder?")
  assert equal $result.callbackDefinition.range.start $result.callbackBinding
  assert equal $result.methodReference.range.start $result.coreMarks.method
  assert equal $result.methodReference.uri "file:///editor/core/lib.afl"
  assert ($result.callbackHover.text | str contains "fn(i32, i32) -> i32")
  assert equal $result.callbackSignature.label "fn(i32, i32) -> i32"
  assert equal $result.callbackSignature.activeParameter 1
  assert equal ($result.callbackSignature.parameters | get label) ["i32", "i32"]
  assert equal $result.signature.parameters.0.label "a: string?"
  assert ($result.signature.label | str ends-with "-> string?")
  assert (($result.outline | where name == "make" | first | get detail) | str contains "Adder?")
  assert equal $result.signature.activeParameter 1
  assert ($result.signature.parameters.1.documentation | str contains "Number input")
  assert (($result.references | length) > ($result.withoutDeclaration | length))
  assert equal ($result.outline.0.children | get name) ["base", "add"]
  for case in $incomplete {
    let actual = ($result.cases | where name == $case.name | first)
    if "labels" in $case { assert equal ($actual.completion | get label) $case.labels $case.name }
    if "parameter" in $case { assert equal $actual.signature.activeParameter $case.parameter $case.name }
  }
  let keyword = ($result.cases | where name == "keyword" | first | get completion.0)
  assert equal $keyword.insertText "return"
  let escaped = ($result.cases | where name == "escaped_local" | first | get completion.0)
  assert equal $escaped.insertText "`return`"
  let signature = ($result.cases | where name == "escaped_signature" | first | get signature)
  assert equal $signature.parameters.0.label "`return`: i32"
  assert equal $signature.parameters.0.documentation "Input number"
  assert ($signature.label | str contains $signature.parameters.0.label)
  assert $result.cachedDependencyAst
  assert $result.changedDocumentAst
  assert equal $result.afterRename null
  assert ("AFL3102" in ($result.renamedDiagnostics | get code))
  assert equal $result.afterClose []
  assert $result.removedAst
  print "Editor index checks passed: navigation, references, completion, hover, signatures, recovery and AST caching."
}
