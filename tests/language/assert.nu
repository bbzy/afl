use ../support.nu temporary-directory
use std/assert

def main [] {
  let root = ($env.FILE_PWD | path dirname | path dirname)
  let checker = ($root | path join "packages/checker/dist/index.js")
  let cases = [
    {name: true_condition, text: "assert(true)", code: null}
    {name: false_is_not_executed, text: "assert(false)", code: null}
    {name: expression, text: "assert(1 + 2 == 3)", code: null}
    {name: variable, text: "ready: bool = true\nassert(ready)", code: null}
    {name: member, text: "state: State = {ok: true}\nassert(state.ok)", code: null}
    {name: predicate_call, text: "assert(predicate())", code: null}
    {name: multiline, text: "assert(\n predicate(),\n)", code: null}
    {name: prose, text: "ready: bool = [验证需要成立的条件]\nassert(ready)", code: null}
    {name: callback, text: "verify: fn(bool) = assert\nverify(true)\naccept(assert)", code: null}
    {name: callback_property, extra: "struct Rules [desc = [Checks]] { verify: fn(bool) = assert [desc = [Condition check]] }",
      text: "rules: Rules = {}\nrules.verify(true)", code: null}
    {name: no_general_value_type_check, text: "assert(123)", code: null}
    {name: missing_argument, text: "assert()", code: AFL3206}
    {name: extra_argument, text: 'assert(true, "message")', code: AFL3206}
    {name: undefined_name, text: "assert(missing)", code: AFL3203}
    {name: undefined_member, text: "state: State = {ok: true}\nassert(state.missing)", code: AFL3204}
    {name: no_value, text: "value: bool = assert(true)", code: AFL3303}
    {name: no_condition_value, text: "if assert(true) {}", code: AFL3303}
    {name: nested_no_value, text: "assert(assert(true))", code: AFL3303}
    {name: no_returned_callback, text: "assert(true)()", code: AFL3206}
    {name: callback_input_mismatch, text: "verify: fn(i32) = assert", code: AFL3207}
    {name: callback_result_mismatch, text: "verify: fn(bool) -> bool = assert", code: AFL3207}
    {name: not_a_type, text: "value: assert = [A value]", code: AFL3202}
    {name: no_extra_builtin, text: "assert_eq(1, 1)", code: AFL3203}
    {name: shadow_local, text: "assert: fn() = [Custom callback]\nassert()", code: null}
    {name: shadow_parameter, extra: "fn invoke(assert: fn()) [assert = [Custom callback]] { assert() }",
      text: "handler: fn() = [Custom callback]\ninvoke(handler)", code: null}
    {name: shadow_definition, extra: "fn assert(a: i32, b: i32) -> i32 [a = [First]\nb = [Second]\nreturn = [Sum]] { a + b }",
      text: "value: i32 = assert(1, 2)", code: null}
    {name: shadow_import, extra: "use helpers::custom as assert", text: "assert()", code: null}
    {name: ordinary_method, extra: "class Custom [desc = [Custom]] { fn assert() {} }",
      text: "custom: Custom = {}\ncustom.assert()", code: null}
    {name: not_exported, extra: "use helpers::assert", text: "assert(true)", code: AFL3102}
    {name: not_impl_target, extra: "impl helpers::assert", text: "", code: AFL3102}
    {name: cannot_assign_function, text: "assert = true", code: AFL3203}
  ]
  let bridge = r#'
    import assert from "node:assert/strict";
    import {readFileSync} from "node:fs";
    import {pathToFileURL} from "node:url";
    const {checkProject, LanguageService} = await import(pathToFileURL(process.argv[1]));
    const cases = JSON.parse(readFileSync(0, "utf8"));
    const helpers = {uri: "file:///assert/helpers.afl", text: "fn custom() {}"};
    const declarations = "struct State [desc = [State]] { ok: bool [desc = [Ready]] }\n" +
      "fn predicate() -> bool [return = [Ready]] { true }\n" +
      "fn accept(handler: fn(bool)) [handler = [Condition check]] { handler(true) }\n";
    const results = cases.map(item => ({name: item.name, ...checkProject([helpers, {
      uri: "file:///assert/lib.afl", text: declarations + (item.extra ?? "") + "\nfn main() {\n" + item.text + "\n}",
    }])}));
    const service = new LanguageService();
    const doc = {uri: "file:///assert/lib.afl", text: "fn main() {\n ready: bool = true\n assert(ready)\n}"};
    const position = (text, offset) => ({line: text.slice(0, offset).split("\n").length - 1, character: offset - text.lastIndexOf("\n", offset - 1) - 1});
    const at = (doc, text, delta = 0) => {
      assert(doc.text.includes(text), text);
      return position(doc.text, doc.text.indexOf(text) + delta);
    };
    service.update([doc]);
    assert.deepEqual(service.diagnostics, []);
    const call = at(doc, "assert"), arg = at(doc, "assert(ready", 7);
    assert.equal(service.definition(doc.uri, call), undefined);
    assert.deepEqual(service.references(doc.uri, call, true), []);
    assert.deepEqual(service.implementations(doc.uri, call), []);
    assert.deepEqual(service.documentSymbols(doc.uri).map(s => s.name), ["main"]);
    assert.match(service.hover(doc.uri, call).text, /fn assert\(condition: bool\)/);
    assert.deepEqual(service.hover(doc.uri, call).range.start, call);
    const signature = service.signatureHelp(doc.uri, arg);
    assert.equal(signature.label, "fn assert(condition: bool)");
    assert.equal(signature.parameters[0].label, "condition: bool");
    assert(signature.parameters[0].documentation.length > 0);
    assert.equal(signature.activeParameter, 0);
    assert.deepEqual(service.definition(doc.uri, arg).range.start, at(doc, "ready:"));
    assert.equal(service.references(doc.uri, at(doc, "ready:"), false).length, 1);
    for (const text of ["fn main() { ass", "fn main() {\n assert("]) {
      const edit = {...doc, text}; service.update([edit]);
      const cursor = position(text, text.length);
      if (text.endsWith("(")) assert.equal(service.signatureHelp(edit.uri, cursor).label, signature.label);
      else {
        const found = service.completion(edit.uri, cursor).find(item => item.label === "assert");
        assert.equal(found.kind, "function");
        assert.equal(found.detail, signature.label);
        assert.equal(found.insertText, "assert");
      }
    }
    for (const [text, cursor] of [
      ["fn main() { [assert remains prose] }", "remains"],
      ["fn main() { value: string = \"assert text\" }", "text"],
      ["fn main() { value: bool = true\n value.ass", "ass"],
      ["use helpers::ass", "ass"],
      ["impl helpers::ass", "ass"],
    ]) {
      const edit = {...doc, text}; service.update([helpers, edit]);
      assert(!service.completion(edit.uri, at(edit, cursor, cursor.length)).some(item => item.label === "assert"), text);
    }
    const shadow = {...doc, text: "use helpers::custom as assert\nfn main() { assert() }"};
    service.update([helpers, shadow]);
    assert.deepEqual(service.diagnostics, []);
    assert.equal(service.definition(shadow.uri, at(shadow, "assert()")).uri, helpers.uri);
    assert.equal(service.signatureHelp(shadow.uri, at(shadow, "assert()", 7)).label, "fn custom()");
    assert.equal(service.completion(shadow.uri, at(shadow, "assert()", 3)).find(item => item.label === "assert").detail, "fn custom()");
    service.update([doc]);
    assert.match(service.hover(doc.uri, call).text, /fn assert\(condition: bool\)/);
    assert.equal(service.definition(doc.uri, call), undefined);
    console.log(JSON.stringify(results));
  '#
  let run = ($cases | to json | ^node --input-type=module -e $bridge $checker | complete)
  assert equal $run.exit_code 0 $"($run.stdout)($run.stderr)"
  let results = ($run.stdout | from json)
  for case in $cases {
    let diagnostics = ($results | where name == $case.name | first | get diagnostics)
    if $case.code == null { assert equal $diagnostics [] $case.name } else {
      assert ($case.code in ($diagnostics | get code)) $"($case.name): ($diagnostics | to json --raw)"
    }
  }
  let cli = ($root | path join packages/cli/bin/afl.mjs)
  let fixture = (temporary-directory "assert")
  try {
    "[dep]" | save ($fixture | path join config.toml)
    let file = ($fixture | path join main.afl)
    "fn main() {\n    ready: bool = true\n    assert(ready)\n}" | save $file
    for command in [definition references implementations] {
      let query = (^node $cli $command $file --line 3 --column 5 --json | complete)
      assert equal $query.exit_code 0 $query.stderr
      assert equal ($query.stdout | from json | get results) []
    }
    let argument = (^node $cli definition $file --line 3 --column 12 --json | complete)
    assert equal $argument.exit_code 0 $argument.stderr
    assert equal ($argument.stdout | from json | get results.0.range.start) {line: 1, character: 4}
    let preset = (^node $cli check ($root | path join demo/test-specs) --preset android --json | complete)
    assert equal $preset.exit_code 0 $"($preset.stdout)($preset.stderr)"
    assert equal ($preset.stdout | from json | get diagnostics) []
  } finally { rm --recursive --force $fixture }
  print $"Built-in assert passed: ($cases | length) contracts and lookup cases, editor services, CLI queries and test preset."
}
