use std/assert

def main [] {
  let root = ($env.FILE_PWD | path dirname | path dirname)
  let bridge = r#'
    import assert from "node:assert/strict";
    import {pathToFileURL} from "node:url";
    const {checkProject, LanguageService} = await import(pathToFileURL(process.argv[1]));
    const uri = "file:///numeric/lib.afl";
    const cases = [
      ["operations", "a: i64 = 10\nb: i64 = 20\nsmall: i64 = min(a, b)\nlarge: i64 = max(a, b)\npositive: i64 = abs(a)\nratio: f64 = a / b\nrounded: f64 = round(ratio)\nwhole: i64 = to_int(ratio)\nconverted: f64 = to_float(a)\nassert(whole == 0)"],
      ["division literal", "ratio: f64 = 5 / 2"],
      ["negative integer right", "a: i64 = 1\nmin(a, -2)"],
      ["negative integer left", "a: i64 = 1\nmax(-2, a)"],
      ["negative decimal right", "a: f32 = 1.0\nmin(a, -2.5)"],
      ["negative decimal left", "a: f32 = 1.0\nmax(-2.5, a)"],
      ["nested literal signs", "a: i64 = 1\nmin(-(-2), a)"],
      ["negative decimal mismatch", "a: i64 = 1\nmin(a, -2.5)", "AFL3210"],
      ["negative typed mismatch", "a: i64 = 1\nb: f64 = 2.0\nmin(-a, b)", "AFL3210"],
      ["logical negation is not numeric", "min(!true, 1)", "AFL3210"],
      ["logical negation is not a callback", "f: fn() = [Make callback]\ng: fn() = !f", "AFL3207"],
      ["logical negation is not a collection", "items: list<i32> = {}\nfor item in !items { assert(true) }", "AFL3208"],
      ["callback", "f: fn(i64, i64) -> i64 = min\na: i64 = f(1, 2)"],
      ["callback mismatch", "f: fn(bool) -> bool = abs", "AFL3207"],
      ["missing", "min(1)", "AFL3206"],
      ["extra", "round(1, 2)", "AFL3206"],
      ["string", "min(\"one\", \"two\")", "AFL3210"],
      ["bool", "abs(true)", "AFL3210"],
      ["null", "to_int(null)", "AFL3210"],
      ["mixed", "a: i64 = 1\nb: f64 = 2.0\nmin(a, b)", "AFL3210"],
      ["mixed literal", "a: i64 = 1\nmin(a, 2.5)", "AFL3210"],
      ["explicit conversion", "a: i64 = 1\nb: f64 = 2.0\nmin(to_float(a), b)"],
      ["bad division", "value: f64 = \"one\" / 2", "AFL3210"],
      ["opaque numeric", "a: f64 = [Compute input]\nb: i64 = to_int(a)"],
      ["division by zero not executed", "a: f64 = 1 / 0"],
    ];
    for (const [name, body, code] of cases) {
      const diagnostics = checkProject([{uri, text: "fn main() {\n" + body + "\n}"}]).diagnostics;
      if (code) assert(diagnostics.some(d => d.code === code), name + JSON.stringify(diagnostics));
      else assert.deepEqual(diagnostics, [], name);
    }
    const doc = {uri, text: "fn main() {\n a: i64 = 10\n b: i64 = 20\n min(a, b)\n round(a / b)\n}"};
    const s = new LanguageService(); s.update([doc]);
    assert.deepEqual(s.diagnostics, []);
    assert.equal(s.signatureHelp(uri, {line:3, character:7}).label, "fn min(a: i64, b: i64) -> i64");
    assert.match(s.hover(uri, {line:3, character:2}).text, /i64/);
    assert.match(s.signatureHelp(uri, {line:4, character:8}).label, /value: f64/);
    assert.equal(s.definition(uri, {line:3, character:2}), undefined);
    assert.deepEqual(s.references(uri, {line:3, character:2}), []);
    assert(s.completion(uri, {line:3, character:2}).some(item => item.label === "min"));
    for (const [type, literal] of [["i64", "-2"], ["f32", "-2.5"], ["f64", "2"], ["f64", "-2"]]) {
      const text = `fn main() {\n value: ${type} = abs(${literal})\n}`;
      s.update([{uri,text}]);assert.deepEqual(s.diagnostics,[]);
      assert.equal(s.signatureHelp(uri,{line:1,character:text.split("\n")[1].indexOf("(")+1}).label,`fn abs(value: ${type}) -> ${type}`);
    }
    const shadow = {uri, text: "fn min() {}\nfn main() { min() }"}; s.update([shadow]);
    assert.deepEqual(s.diagnostics, []);
    assert.equal(s.definition(uri, {line:1, character:12}).uri, uri);
    console.log(`Numeric contracts passed: ${cases.length} cases, concrete signatures, callback use and shadowing.`);
  '#
  let run = (^node --input-type=module -e $bridge ($root | path join packages/checker/dist/index.js) | complete)
  assert equal $run.exit_code 0 $"($run.stdout)($run.stderr)"
  print $run.stdout
}
