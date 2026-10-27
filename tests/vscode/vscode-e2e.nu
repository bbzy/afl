use std/assert
use ../support.nu temporary-directory

# Runs every scenario in one real, isolated VS Code window.
def main [--vscode-executable: path] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let version = (open ($project_root | path join "package.json") | get version)
  let temporary_root = ($env.TEMP_DIR? | default "")
  let run_root = (if $temporary_root == "" { $project_root | path join ".test-artifacts" "vscode-e2e" } else { $temporary_root | path expand })
  mkdir $run_root
  let fixture = (temporary-directory "afl-vscode-e2e" $run_root)
  print $"VS Code E2E artifacts and logs: ($fixture)"
  mkdir ($fixture | path join "workspace/app") ($fixture | path join "workspace/core") ($fixture | path join "driver")
  "use dep::core::lib::show\nfn main() {\n    value: i32 = show(1)\n}" | save ($fixture | path join "workspace/app/main.afl")
  "[dep]\ncore = '../core'" | save ($fixture | path join "workspace/app/config.toml")
  "extern fn show(a: i32) -> i32 [\n desc = [Display number]\n a = [Input number]\n return = [Displayed number]\n]" | save ($fixture | path join "workspace/core/lib.afl")
  "[dep]" | save ($fixture | path join "workspace/core/config.toml")
  mkdir ($fixture | path join "specs")
  '[dep]
core = "../workspace/core"' | save ($fixture | path join "specs/config.toml")
  "use dep::core::lib::show\nfn scenario() { missing_test() }" | save ($fixture | path join "specs/lib.afl")
  mkdir ($fixture | path join "workspace/edge") ($fixture | path join "workspace/ios-edge") ($fixture | path join "workspace/presets")
  'preset_dir = "presets"
[project]
[preset.android]
core = ["core"]
edge = ["edge"]' | save ($fixture | path join "workspace/config.toml")
  'core = ["../core"]
edge = ["../ios-edge"]' | save ($fixture | path join "workspace/presets/ios.toml")
  '[dep]
core = "../core"' | save ($fixture | path join "workspace/edge/config.toml")
  'impl dep::core::lib::show
fn show(value: i32) -> i32 [
    value = [Input]
    return = [Displayed value]
] { value }' | save ($fixture | path join "workspace/edge/lib.afl")
  cp ($fixture | path join "workspace/edge/config.toml") ($fixture | path join "workspace/ios-edge/config.toml")
  cp ($fixture | path join "workspace/edge/lib.afl") ($fixture | path join "workspace/ios-edge/lib.afl")
  'class Counter [desc = [A counter]] {
    value: i32 = 10000 [desc = [Current count]]
}
struct Gift [desc = [Gift protocol]] {
    "gift-id": string [desc = [Gift identity]]
    note?: string? [desc = [Optional note]]
}
fn highlight(sample: i32?) -> i32? [
    sample = [Incoming value]
    return = [Computed value]
] {
    text: string = "hello"
    pattern: string = r#"\d+\.\d+"#
    template: string = r##"first "#, [ \n
raw_literal_body"##
    optional: string? = null
    handler: fn(i32) -> i32 = [Create a transform callback]
    [Reverse [nested] input]
    r#[Raw if true text]#
    if true { sample + 1 } else { 0 }
}' | save ($fixture | path join "workspace/app/highlighting.afl")
  {contributes: {languages: [{id: swig, extensions: [".tpl"]}]}, name: afl-test-driver, publisher: afl-tests, version: "0.0.0", engines: {vscode: "^1.100.0"}, main: "./activate.cjs", activationEvents: [onStartupFinished]} | to json | save ($fixture | path join "driver/package.json")

  cp --recursive ($project_root | path join "demo/implementations") ($fixture | path join "workspace/associations")
  mkdir ($fixture | path join "native-project")
  cp ($fixture | path join "workspace/associations/native/Counter.kt") ($fixture | path join "native-project/Counter.kt")
  open --raw ($fixture | path join "workspace/associations/kotlin.toml") | str replace --all 'native/Counter.kt' '../../native-project/Counter.kt' | save --force ($fixture | path join "workspace/associations/kotlin.toml")

  # This bridge runs INSIDE Extension Host. All VS Code APIs and the installed
  # extension are real; Nushell below asserts the observed results.
  let suite = r#'
const vscode = require("vscode");
const fs = require("node:fs/promises"), path = require("node:path");
const root = process.env.AFL_E2E_ROOT;
const id = "afl-local.afl-vscode";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(query, accept, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await query();
    if (accept(value)) return value;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
const file = (name) => vscode.Uri.file(path.join(root, "workspace", name));
const codes = (uri) => vscode.languages.getDiagnostics(uri).map(d => typeof d.code === "object" ? d.code.value : d.code);
const at = (doc, text, offset = 0) => doc.positionAt(doc.getText().indexOf(text) + offset);
async function replace(doc, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("Editor rejected edit");
}
async function readLogs(directory) {
  const result = {};
  let entries;
  try { entries = await fs.readdir(directory, {withFileTypes: true}); }
  catch (error) { if (error.code === "ENOENT") return result; throw error; }
  for (const entry of entries) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await readLogs(name));
    else if (entry.name === "AFL.log") result[name] = await fs.readFile(name, "utf8");
  }
  return result;
}
exports.run = async (mode, context) => {
  const result = {version: vscode.version, mode, hostPid: process.pid, appPid: process.ppid};
  const logRoot = path.dirname(context.logUri.fsPath), logBefore = await readLogs(logRoot);
  const showProject = async (document, project) => {
    const before = await readLogs(logRoot);
    if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
      const alternate = await vscode.workspace.openTextDocument(file(project ? "app/main.afl" : "secondary/core/lib.afl"));
      await vscode.window.showTextDocument(alternate);
    }
    await vscode.window.showTextDocument(document);
    await until(async () => Object.entries(await readLogs(logRoot)).map(([name, text]) => text.slice(before[name]?.length ?? 0)).join("\n"),
      text => text.includes("Active AFL project: " + file(project).toString().replace(/\/?$/u, "/")), "active project follows editor: " + project);
  };
  try {
    const extension = vscode.extensions.getExtension(id);
    if (!extension) throw new Error("Installed AFL VSIX was not discovered");
    result.extensionPath = extension.extensionPath;
    result.extensionVersion = extension.packageJSON.version;
    result.activeBefore = extension.isActive;
    if (mode === "associations") {
      await vscode.commands.executeCommand("afl.selectPreset", {projectUri:file("associations").toString(),preset:"kotlin"});
      const nativeUri=vscode.Uri.file(path.join(root,"native-project/Counter.kt"));
      let native=await vscode.workspace.openTextDocument(nativeUri);
      const mapping=await vscode.workspace.openTextDocument(file("associations/kotlin.toml"));
      const originalMap=mapping.getText(), originalNative=native.getText();
      const shared=await vscode.workspace.openTextDocument(file("associations/shared/lib.afl"));
      const target=()=>vscode.commands.executeCommand("vscode.executeImplementationProvider",shared.uri,at(shared,"fn add",3));
      result.nativeTargets=await until(target,value=>value?.length===1,"native implementation navigation");
      await vscode.window.showTextDocument(native);
      vscode.window.activeTextEditor.selection=new vscode.Selection(4,0,4,0);
      await vscode.commands.executeCommand("afl.traceGeneration");
      result.trace=JSON.parse(vscode.window.activeTextEditor.document.getText());
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await replace(native,"short");
      result.nativeOverlayErrors=await until(()=>codes(mapping.uri),value=>value.includes("AFL4202"),"unsaved native range validation");
      await replace(native,originalNative);
      await until(()=>codes(mapping.uri),value=>value.length===0,"native overlay recovery");
      await replace(mapping,originalMap.replace("line = 4","line = 5"));
      const shifted=await until(target,value=>value?.[0]?.range?.start.line===4,"unsaved association navigation");
      result.shiftedLine=shifted[0].range.start.line;
      await replace(mapping,originalMap);await mapping.save();await native.save();
      await vscode.window.showTextDocument(native);
      await vscode.commands.executeCommand("afl.generationImpact");
      result.impact=JSON.parse(vscode.window.activeTextEditor.document.getText());
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      // Watch a native file with no open buffer; open snapshots intentionally override disk contents.
      const watchedNative=vscode.Uri.file(path.join(root,"native-project/Watched.kt"));
      await fs.writeFile(watchedNative.fsPath,originalNative);
      await replace(mapping,originalMap.replaceAll("Counter.kt","Watched.kt"));await mapping.save();
      await until(target,value=>value?.[0]?.uri.toString()===watchedNative.toString(),"new native file watch");
      await fs.unlink(watchedNative.fsPath);
      result.deleted=await until(()=>codes(mapping.uri),value=>value.includes("AFL4202"),"deleted external native file");
      await fs.writeFile(watchedNative.fsPath,originalNative);
      result.recreated=await until(()=>codes(mapping.uri),value=>value.length===0,"recreated external native file");
      await replace(mapping,originalMap);await mapping.save();
      await fs.writeFile(path.join(root,"workspace/ordinary.tpl"),"unrelated template");
      result.tplLanguage=(await vscode.workspace.openTextDocument(file("ordinary.tpl"))).languageId;
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    } else if (mode === "failure") {
      try { await extension.activate(); result.activationFailed = false; }
      catch { result.activationFailed = true; }
      await vscode.commands.executeCommand("afl.showLogs");
      result.showLogs = true;
      await vscode.commands.executeCommand("afl.check");
      result.checkFailureHandled = true;
    } else if (["persist", "restore", "cleared"].includes(mode)) {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      const main = await vscode.workspace.openTextDocument(file("app/main.afl"));
      await vscode.window.showTextDocument(main);
      await extension.activate();
      if (mode === "persist") {
        await vscode.commands.executeCommand("afl.selectPreset", {projectUri: file("secondary").toString(), preset: "android"});
        await vscode.commands.executeCommand("afl.selectPreset", {projectUri: file("").toString(), preset: "ios"});
      }
      const secondaryImplementation = await vscode.commands.executeCommand("vscode.executeImplementationProvider", file("secondary/core/lib.afl"), new vscode.Position(0, 11));
      result.secondaryImplementation = (secondaryImplementation ?? []).map(d => (d.uri ?? d.targetUri).toString());
      const implementation = await vscode.commands.executeCommand("vscode.executeImplementationProvider", file("core/lib.afl"), new vscode.Position(0, 11));
      result.implementation = (implementation ?? []).map(d => (d.uri ?? d.targetUri).toString());
      if (mode === "restore") {
        await vscode.commands.executeCommand("afl.check");
        const cleared = await vscode.commands.executeCommand("vscode.executeImplementationProvider", file("core/lib.afl"), new vscode.Position(0, 11));
        result.cleared = (cleared ?? []).map(d => (d.uri ?? d.targetUri).toString());
      }
    } else if (mode === "command") {
      // No AFL document has been opened: the command must activate the extension.
      result.documentsBefore = vscode.workspace.textDocuments.filter(d => d.languageId === "afl").length;
      await vscode.commands.executeCommand("afl.showLogs");
      result.active = extension.isActive;
      // Several independent projects are present; select the owner explicitly without a picker.
      await vscode.commands.executeCommand("afl.selectPreset", {projectUri:file("").toString(),preset:"android"});
      await vscode.commands.executeCommand("afl.check");
      result.checked = true;
    } else {
      const main = await vscode.workspace.openTextDocument(file("app/main.afl"));
      await vscode.window.showTextDocument(main);
      await until(() => extension.isActive, Boolean, "language activation");
      result.active = extension.isActive;
      result.language = main.languageId;
      const original = main.getText();
      const definition = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "show(1)")),
        value => value?.length > 0, "definition registration");
      result.definition = definition.map(d => (d.uri ?? d.targetUri).toString());
      result.coreUri = file("core/lib.afl").toString();
      const hover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "show(1)"));
      result.hover = hover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const signature = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, "show(1)", 5));
      result.signature = signature.signatures[0].parameters[0].label;
      const references = await vscode.commands.executeCommand("vscode.executeReferenceProvider", main.uri, at(main, "show(1)"));
      result.references = references.map(r => r.uri.toString());
      await replace(main, "use dep::core::lib::show\nfn main() {\n sh");
      const completion = await until(
        () => vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, new vscode.Position(2, 3)),
        value => value?.items.some(item => item.label === "show"), "completion after edit");
      result.completions = completion.items.map(item => item.label);
      await replace(main, original.replace("show(1)", "missing()"));
      result.unsavedErrors = await until(() => codes(main.uri), c => c.includes("AFL3203"), "unsaved diagnostics");
      result.dirty = main.isDirty;
      result.diskUnchanged = (await fs.readFile(main.uri.fsPath, "utf8")) === original;
      await replace(main, original);
      result.recoveredErrors = await until(() => codes(main.uri), c => c.length === 0, "diagnostic recovery");
      const formatting = await vscode.workspace.openTextDocument({language: "afl", content: "fn messy(){call()}"});
      const edits = await until(() => vscode.commands.executeCommand("vscode.executeFormatDocumentProvider", formatting.uri, {tabSize: 2, insertSpaces: true}),
        value => value?.length > 0, "AFL formatting registration");
      result.formatBufferUntouched = formatting.getText() === "fn messy(){call()}";
      const formattingEdit = new vscode.WorkspaceEdit();
      formattingEdit.set(formatting.uri, edits);
      if (!await vscode.workspace.applyEdit(formattingEdit)) throw new Error("Editor rejected formatting edits");
      result.formatted = formatting.getText();
      await replace(main, 'use highlighting::Counter\n' + original +
        '\nfn nullable_demo() {\n counter: Counter? = null\n counter.value\n}');
      const nullableDefinition = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "counter.value", 8)),
        value => value?.length > 0, "nullable member definition");
      result.nullableDefinition = nullableDefinition.map(d => (d.uri ?? d.targetUri).toString());
      result.nullableTypeUri = file("app/highlighting.afl").toString();
      const nullableHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "counter.value"));
      result.nullableHover = nullableHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const nullableCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "counter.value", 8));
      result.nullableCompletions = nullableCompletion.items.map(item => item.label);
      result.nullableErrors = codes(main.uri);
      const callbackText = 'use dep::core::lib::show\nfn main() {\n handler: fn(i32) -> i32 = show\n handler(1)\n}';
      await replace(main, callbackText);
      const callbackSignature = await until(
        () => vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, "handler(1)", 8)),
        value => value?.signatures[0]?.label === "fn(i32) -> i32", "callback signature help");
      result.callbackSignature = callbackSignature.signatures[0].label;
      const callbackReference = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "= show", 2));
      result.callbackReference = callbackReference.map(d => (d.uri ?? d.targetUri).toString());
      await replace(main, callbackText.replace("fn(i32) -> i32", "fn() -> i32"));
      result.callbackErrors = await until(() => codes(main.uri), c => c.includes("AFL3207"), "callback signature mismatch");
      await replace(main, original);
      await until(() => codes(main.uri), c => c.length === 0, "callback diagnostic recovery");
      const defaultText = 'use highlighting::Counter\n' + original +
        '\nclass Settings [desc = [Settings]] {\n value: i32 = show(4) [desc = [Default value]]\n}' +
        '\nfn defaults() {\n counter: Counter = {}\n settings: Settings = {}\n counter.value\n}';
      await replace(main, defaultText);
      const defaultDefinition = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "show(4)")),
        value => value?.length > 0, "property default dependency definition");
      result.defaultDefinition = defaultDefinition.map(d => (d.uri ?? d.targetUri).toString());
      const defaultHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "counter.value", 8));
      result.defaultHover = defaultHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const highlighting = await vscode.workspace.openTextDocument(file("app/highlighting.afl"));
      const originalHighlighting = highlighting.getText();
      await replace(highlighting, originalHighlighting.replace(" = 10000", ""));
      result.removedDefaultErrors = await until(() => codes(main.uri), c => c.includes("AFL3302"), "required field after removing dependency default");
      await replace(highlighting, originalHighlighting);
      result.defaultRecoveredErrors = await until(() => codes(main.uri), c => c.length === 0, "omitted field after restoring dependency default");
      await replace(main, defaultText.replace("show(4)", "missing_default(4)"));
      result.defaultReferenceErrors = await until(() => codes(main.uri), c => c.includes("AFL3203"), "unresolved property default dependency");
      await replace(main, original);
      await until(() => codes(main.uri), c => c.length === 0, "property default recovery");
      await highlighting.save();
      const rawText = 'use dep::core::lib::show\n' +
        'fn render(text: string, count: i32) [text = r#[Text with ] and [ preserved]#\ncount = [Count]] {}\n' +
        'fn main() {\n render(r##"if, ) [\nraw content "#, still raw"##, 1)\n' +
        ' r##[opaque words ]# unmatched [ \\\\]##\n show(3)\n}';
      await replace(main, rawText);
      const rawSignature = await until(
        () => vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, '"##, 1)', 5)),
        value => value?.signatures[0]?.parameters.length === 2, "raw string argument signature");
      result.rawActiveParameter = rawSignature.activeParameter;
      const rawCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "raw content", 4));
      result.rawCompletions = rawCompletion?.items.map(item => item.label) ?? [];
      const rawDefinition = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "opaque words", 8));
      result.rawDefinitions = rawDefinition ?? [];
      const afterRaw = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "show(3)"));
      result.afterRawDefinition = afterRaw.map(d => (d.uri ?? d.targetUri).toString());
      await replace(main, rawText.replace('"##, 1)', '"#, 1)'));
      result.rawStringErrors = await until(() => codes(main.uri), c => c.includes("AFL1001"), "unclosed raw string");
      await replace(main, rawText);
      await until(() => codes(main.uri), c => c.length === 0, "raw string recovery");
      await replace(main, rawText.replace("]##", "]#"));
      result.rawDescriptionErrors = await until(() => codes(main.uri), c => c.includes("AFL1001"), "unclosed raw description");
      await replace(main, rawText);
      result.rawRecoveredErrors = await until(() => codes(main.uri), c => c.length === 0, "raw description recovery");
      await replace(main, original);
      await until(() => codes(main.uri), c => c.length === 0, "restore after raw checks");
      const structText = 'use highlighting::Gift\nfn main() {\n gift: Gift = {"gift-id": "one"}\n gift.note\n}';
      await replace(main, structText);
      const structDefinition = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, '"gift-id"', 2)),
        value => value?.length > 0, "struct literal key definition");
      result.structDefinition = structDefinition.map(d => (d.uri ?? d.targetUri).toString());
      const structHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "gift.note", 5));
      result.structHover = structHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const structCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "gift.note", 5));
      result.structCompletions = structCompletion.items.map(item => item.label);
      result.structFieldKind = structCompletion.items.find(item => item.label === "note")?.kind === vscode.CompletionItemKind.Field;
      const structOutline = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", highlighting.uri);
      const giftSymbol = structOutline.find(item => item.name === "Gift");
      result.structSymbolKind = giftSymbol?.kind === vscode.SymbolKind.Struct;
      result.structChildKinds = giftSymbol?.children.every(item => item.kind === vscode.SymbolKind.Field);
      await replace(highlighting, originalHighlighting.replace("note?:", "note:"));
      result.structRequiredErrors = await until(() => codes(main.uri), c => c.includes("AFL3302"), "required struct field after dependency edit");
      await replace(highlighting, originalHighlighting);
      result.structRecoveredErrors = await until(() => codes(main.uri), c => c.length === 0, "optional struct field restored");
      await replace(main, original);
      await highlighting.save();
      const forText = 'use highlighting::Counter\nfn main() {\n counters: list<Counter> = {{}}\n for counter in counters { counter.value }\n}';
      await replace(main, forText);
      const loopMember = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "counter.value", 8)),
        value => value?.length > 0, "for element member definition");
      result.forMemberDefinition = loopMember.map(d => (d.uri ?? d.targetUri).toString());
      const loopBinding = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "counter.value"));
      result.forBindingLine = (loopBinding[0].range ?? loopBinding[0].targetSelectionRange).start.line;
      const loopCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "counter.value", 8));
      result.forCompletions = loopCompletion.items.map(item => item.label);
      await replace(main, forText.replace("list<Counter> = {{}}", "map<string, Counter> = {}"));
      result.forErrors = await until(() => codes(main.uri), c => c.includes("AFL3208"), "for binding count after collection edit");
      await replace(main, forText);
      result.forRecoveredErrors = await until(() => codes(main.uri), c => c.length === 0, "for diagnostic recovery");
      const indexedFor = forText.replace("for counter in", "for index, counter in")
        .replace("{ counter.value }", "{ if index == 0 { continue }\n counter.value }");
      await replace(main, indexedFor);
      const indexDefinition = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "index == 0")),
        value => value?.length > 0, "for index definition");
      const indexStart = (indexDefinition[0].range ?? indexDefinition[0].targetSelectionRange).start;
      result.forIndexDefinition = indexStart.isEqual(at(main, "index, counter"));
      const indexHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "index == 0"));
      result.forIndexHover = indexHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const indexReferences = await vscode.commands.executeCommand("vscode.executeReferenceProvider", main.uri, at(main, "index, counter"));
      result.forIndexReference = indexReferences.some(ref => ref.uri.toString() === main.uri.toString() && ref.range.start.isEqual(at(main, "index == 0")));
      const indexCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "index == 0", 3));
      result.forIndexCompletions = indexCompletion.items.map(item => item.label);
      const indexedMember = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "counter.value", 8));
      result.forIndexedMember = indexedMember.map(d => (d.uri ?? d.targetUri).toString());
      await replace(main, indexedFor.replace("list<Counter>", "set<Counter>"));
      result.forIndexedErrors = await until(() => codes(main.uri), c => c.includes("AFL3208"), "indexed set rejected");
      await replace(main, indexedFor);
      result.forIndexedRecovered = await until(() => codes(main.uri), c => c.length === 0, "indexed list restored");
      await main.save();
      result.forSyntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", main.uri);
      await replace(main, original);
      const whenText = 'use dep::core::lib::show\nfn main() {\n value: i32 = when {\n true -> {\n chosen: i32 = show(1)\n chosen\n }\n else -> { show(2) }\n }\n}';
      await replace(main, whenText);
      const whenCall = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "show(1)")),
        value => value?.length > 0, "when branch call definition");
      result.whenDefinition = whenCall.map(d => (d.uri ?? d.targetUri).toString());
      const whenBinding = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "\n chosen\n", 2));
      const bindingPosition = (whenBinding[0].range ?? whenBinding[0].targetSelectionRange).start;
      result.whenLocalDefinition = bindingPosition.line === at(main, "chosen:").line && bindingPosition.character === at(main, "chosen:").character;
      const whenCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "\n chosen\n", 4));
      result.whenCompletions = whenCompletion.items.map(item => item.label);
      const whenSignature = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, "show(1)", 5));
      result.whenSignature = whenSignature.signatures[0].parameters[0].label;
      await replace(main, whenText.replace("\n else -> { show(2) }", ""));
      result.whenErrors = await until(() => codes(main.uri), c => c.includes("AFL1004"), "when expression missing fallback");
      await replace(main, whenText);
      result.whenRecoveredErrors = await until(() => codes(main.uri), c => c.length === 0, "when diagnostic recovery");
      await main.save();
      result.whenSyntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", main.uri);
      await replace(main, original);
      const collectionText = 'use highlighting::Counter\nfn main() {\n counters: list<Counter> = {{}}\n counters.add({})\n counters.get(0).value\n mapping: map<string, Counter?> = {}\n mapping.set("one", {})\n mapping.get("one").value\n seen: set<string> = {}\n seen.add("one")\n}';
      await replace(main, collectionText);
      const collectionCompletion = await until(
        () => vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "counters.get", 9)),
        value => value?.items.some(item => item.label === "remove_at"), "built-in list completion");
      result.collectionCompletions = collectionCompletion.items.map(item => item.label);
      result.collectionMethodKind = collectionCompletion.items.find(item => item.label === "get")?.kind === vscode.CompletionItemKind.Method;
      const collectionHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "counters.get", 10));
      result.collectionHover = collectionHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const collectionSignature = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, 'mapping.set("one",', 18));
      result.collectionSignature = collectionSignature.signatures[0].parameters.map(parameter => parameter.label);
      result.collectionActiveParameter = collectionSignature.activeParameter;
      const collectionDefinition = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "counters.get(0).value", 17));
      result.collectionDefinition = collectionDefinition.map(d => (d.uri ?? d.targetUri).toString());
      result.collectionBuiltinDefinition = (await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "counters.get", 10))) ?? [];
      const mapCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "mapping.get", 8));
      result.mapCompletions = mapCompletion.items.map(item => item.label);
      const setCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "seen.add", 5));
      result.setCompletions = setCompletion.items.map(item => item.label);
      await replace(main, collectionText.replace("counters.get(0)", "counters.missing(0)"));
      result.collectionErrors = await until(() => codes(main.uri), c => c.includes("AFL3204"), "unknown collection method");
      await replace(main, collectionText.replace('mapping.set("one", {})', 'mapping.set("one")'));
      result.collectionArgumentErrors = await until(() => codes(main.uri), c => c.includes("AFL3206"), "collection argument count");
      await replace(main, collectionText);
      result.collectionRecoveredErrors = await until(() => codes(main.uri), c => c.length === 0, "collection diagnostics recovery");
      await main.save();
      result.collectionSyntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", main.uri);
      await replace(main, original);
      const assertText = "fn main() {\n ready: bool = true\n assert(ready)\n}";
      await replace(main, assertText);
      const assertCompletion = await until(
        () => vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "assert(", 3)),
        value => value?.items.some(item => item.label === "assert"), "built-in assert completion");
      result.assertFunctionKind = assertCompletion.items.find(item => item.label === "assert").kind === vscode.CompletionItemKind.Function;
      const assertHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "assert("));
      result.assertHover = assertHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const assertSignature = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, "assert(ready)", 7));
      result.assertSignature = assertSignature.signatures[0].label;
      result.assertParameter = assertSignature.signatures[0].parameters[0].label;
      result.assertBuiltinDefinition = (await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "assert("))) ?? [];
      result.assertBuiltinReferences = (await vscode.commands.executeCommand("vscode.executeReferenceProvider", main.uri, at(main, "assert("))) ?? [];
      const assertArgument = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "assert(ready)", 7));
      result.assertArgumentDefinition = (assertArgument[0].range ?? assertArgument[0].targetSelectionRange).start.isEqual(at(main, "ready:"));
      await replace(main, assertText.replace("assert(ready)", "assert()"));
      result.assertErrors = await until(() => codes(main.uri), c => c.includes("AFL3206"), "assert argument count");
      await replace(main, assertText);
      result.assertRecovered = await until(() => codes(main.uri), c => c.length === 0, "assert recovery");
      await main.save();
      result.assertSyntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", main.uri);
      await replace(main, original);
      const linkText = "use dep::core::lib::show as display\nfn main() [desc = [See {@display}]] {\n value: i32 = 1\n [Display {@value} according to {@dep::core::lib::show}]\n r#[Keep {@missing}]#\n}";
      await replace(main, linkText);
      const linkDefinition = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "{@display}", 2)),
        value => value?.length > 0, "description link definition");
      result.linkDefinition = linkDefinition.map(d => (d.uri ?? d.targetUri).toString());
      const linkHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "{@display}", 2));
      result.linkHover = linkHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const linkLocal = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "{@value}", 2));
      result.linkLocalDefinition = (linkLocal[0].range ?? linkLocal[0].targetSelectionRange).start.isEqual(at(main, "value:"));
      const linkReferences = await vscode.commands.executeCommand("vscode.executeReferenceProvider", main.uri, at(main, "{@display}", 2));
      result.linkReferences = linkReferences.some(r => r.uri.toString() === main.uri.toString() && r.range.start.isEqual(at(main, "{@dep::core::lib::show}", 18)));
      result.linkRawDefinitions = (await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "{@missing}", 2))) ?? [];
      const linkRawCompletion = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "{@missing}", 5));
      result.linkRawCompletions = linkRawCompletion?.items.map(item => item.label) ?? [];
      await replace(main, "use dep::core::lib::show as display\nfn main() { [See {@dis");
      const linkCompletion = await until(
        () => vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, at(main, "{@dis", 5)),
        value => value?.items.some(item => item.label === "display"), "unfinished description link completion");
      result.linkCompletions = linkCompletion.items.map(item => item.label);
      await replace(main, linkText.replace("{@display}", "{@missing}"));
      result.linkErrors = await until(() => codes(main.uri), c => c.includes("AFL3203"), "unresolved description link");
      await replace(main, linkText.replace("{@display}", "{@}"));
      result.linkSyntaxErrors = await until(() => codes(main.uri), c => c.includes("AFL1006"), "malformed description link");
      await replace(main, linkText);
      result.linkRecovered = await until(() => codes(main.uri), c => c.length === 0, "description link recovery");
      await main.save();
      result.linkSyntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", main.uri);
      await replace(main, original);
      await replace(main, "fn main() {\n [中文描述保持为文本]\n]\nfn later() {}");
      const closerDiagnostics = await until(() => vscode.languages.getDiagnostics(main.uri),
        values => values.length === 1 && String(values[0].code) === "AFL1002", "precise delimiter recovery");
      result.closerLine = closerDiagnostics[0].range.start.line;
      result.closerMessage = closerDiagnostics[0].message;
      result.closerRelatedLine = closerDiagnostics[0].relatedInformation[0].location.range.start.line;
      const recoveredSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", main.uri);
      result.closerLaterSymbol = recoveredSymbols.some(item => item.name === "later");
      const feedbackText = 'type Mode = "camera" | "image"\nstruct Frame [desc = [Frame]] { name: string [desc = [Name]] }\nfn frame_name(frame: Frame) -> string [frame = [Frame]\nreturn = [Name]] { frame.name }\nfn main() {\n mode: Mode = "camera"\n frames: list<Frame> = {}\n frames.sort_by(frame_name)\n ratio: f64 = 5 / 2\n rounded: i64 = to_int(round(ratio))\n assert(rounded == 3)\n}';
      await replace(main, feedbackText);
      result.feedbackRecovered = await until(() => codes(main.uri), value => value.length === 0, "feedback feature source");
      const modeHover = await vscode.commands.executeCommand("vscode.executeHoverProvider", main.uri, at(main, "type Mode", 5));
      result.unionHover = modeHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      const unionDefinition = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "mode: Mode", 6));
      result.unionDefinitionLine = (unionDefinition[0].range ?? unionDefinition[0].targetSelectionRange).start.line;
      const typeSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", main.uri);
      result.unionSymbolKind = typeSymbols.find(item => item.name === "Mode").kind === vscode.SymbolKind.Enum;
      const sortingSignature = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, "sort_by(frame_name)", 10));
      result.sortingSignature = sortingSignature.signatures[0].label;
      const numericSignature = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", main.uri, at(main, "round(ratio)", 8));
      result.numericSignature = numericSignature.signatures[0].label;
      await replace(main, feedbackText.replace('mode: Mode = "camera"', 'mode: Mode = "camrea"'));
      result.unionErrors = await until(() => codes(main.uri), value => value.includes("AFL3209"), "invalid union value");
      await replace(main, feedbackText);
      await until(() => codes(main.uri), value => value.length === 0, "union recovery");
      await main.save();
      result.feedbackSyntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", main.uri);
      const groupedText = "use dep::core::lib::{\n show as display,\n}\nfn main() { value: i32 = display(1) }";
      await replace(main, groupedText);
      const groupedDefinition = await until(
        () => vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, at(main, "display(1)")),
        value => value?.length > 0, "grouped import definition");
      result.groupedDefinition = groupedDefinition.map(d => (d.uri ?? d.targetUri).toString());
      await replace(main, "use dep::core::lib::{\n sh");
      const groupedCompletion = await until(
        () => vscode.commands.executeCommand("vscode.executeCompletionItemProvider", main.uri, new vscode.Position(1, 3)),
        value => value?.items.some(item => item.label === "show"), "unfinished grouped import completion");
      result.groupedCompletion = groupedCompletion.items.map(item => item.label);
      await replace(main, original);
      const inheritedEdge = await vscode.workspace.openTextDocument(file("edge/lib.afl"));
      const originalInheritedEdge = inheritedEdge.getText();
      await replace(inheritedEdge, "impl dep::core::lib::show\nfn show(value: i32) -> i32 { value }");
      const inheritedHover = await until(
        () => vscode.commands.executeCommand("vscode.executeHoverProvider", inheritedEdge.uri, at(inheritedEdge, "show(value")),
        value => value?.some(item => item.contents.some(content => (typeof content === "string" ? content : content.value).includes("Input"))), "inherited documentation hover");
      result.inheritedHover = inheritedHover.flatMap(item => item.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      result.inheritedErrors = await until(() => codes(inheritedEdge.uri), value => value.length === 0, "inherited documentation validation");
      await replace(inheritedEdge, originalInheritedEdge);
      await inheritedEdge.save();
      const config = await vscode.workspace.openTextDocument(file("app/config.toml"));
      const originalConfig = config.getText();
      await replace(config, "[dep]\ncore = '../missing'");
      result.configErrors = await until(() => codes(config.uri), c => c.includes("AFL3002"), "unsaved config diagnostics");
      await replace(config, originalConfig);
      await until(() => codes(config.uri), c => c.length === 0, "config recovery");
      const specificationUri = vscode.Uri.file(path.join(root, "specs/lib.afl"));
      await replace(config, originalConfig + '\n[test]\ncrates = ["../../specs"]');
      result.specErrors = await until(() => codes(specificationUri), c => c.includes("AFL3203"), "associated test source outside workspace");
      const specification = await vscode.workspace.openTextDocument(specificationUri);
      await replace(specification, "use dep::core::lib::show\nfn scenario() [desc = [Expected behavior]] { value: i32 = show(1) }");
      result.specRecovered = await until(() => codes(specificationUri), c => c.length === 0, "unsaved test specification recovery");
      const specDefinition = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", specificationUri, at(specification, "show(1)"));
      result.specDefinition = specDefinition.map(d => (d.uri ?? d.targetUri).toString());
      await replace(config, originalConfig + '\n[test]\ncrates = ["../../missing-specs"]');
      result.specConfigErrors = await until(() => codes(config.uri), c => c.includes("AFL3004"), "unsaved test association diagnostics");
      await replace(config, originalConfig);
      await until(() => codes(config.uri), c => c.length === 0, "test association removal");
      await specification.save();
      await vscode.commands.executeCommand("afl.check");
      await vscode.commands.executeCommand("afl.showLogs");
      result.showLogs = true;
      // Restore and save only this test's fixtures before closing the test window.
      await main.save(); await config.save();
      await vscode.commands.executeCommand("afl.selectPreset", {projectUri: file("").toString(), preset: "android"});
      const implemented = await until(
        () => vscode.commands.executeCommand("vscode.executeImplementationProvider", file("core/lib.afl"), new vscode.Position(0, 11)),
        value => value?.length > 0, "implementation provider");
      result.implementation = implemented.map(d => (d.uri ?? d.targetUri).toString());
      result.edgeUri = file("edge/lib.afl").toString();
      const linkedCore = await vscode.workspace.openTextDocument(file("core/lib.afl"));
      const originalCore = linkedCore.getText();
      await replace(linkedCore, originalCore.replace("Display number", "Display number using {@show}"));
      const linkedAndroid = await until(
        () => vscode.commands.executeCommand("vscode.executeImplementationProvider", linkedCore.uri, at(linkedCore, "{@show}", 2)),
        value => value?.length > 0, "linked extern android implementation");
      result.linkAndroidImplementation = linkedAndroid.map(d => (d.uri ?? d.targetUri).toString());
      await vscode.commands.executeCommand("afl.selectPreset", {projectUri: file("").toString(), preset: "ios"});
      const linkedIos = await until(
        () => vscode.commands.executeCommand("vscode.executeImplementationProvider", linkedCore.uri, at(linkedCore, "{@show}", 2)),
        value => value?.some(d => (d.uri ?? d.targetUri).toString() === file("ios-edge/lib.afl").toString()), "linked extern ios implementation");
      result.linkIosImplementation = linkedIos.map(d => (d.uri ?? d.targetUri).toString());
      await replace(linkedCore, originalCore);
      await linkedCore.save();
      const preset = await vscode.workspace.openTextDocument(file("presets/ios.toml"));
      const originalPreset = preset.getText();
      const unsupportedEdge = await vscode.workspace.openTextDocument(file("ios-edge/lib.afl"));
      const originalUnsupportedEdge = unsupportedEdge.getText();
      await replace(unsupportedEdge, "unsupported dep::core::lib::show [\n desc = [No display on this target]\n fallback = [Keep the input value and skip visual output]\n]");
      result.unsupportedDenied = await until(() => codes(file("core/lib.afl")), value => value.includes("AFL4101"), "unsupported without preset permission");
      await replace(preset, originalPreset + '\nallow_unsupported = ["../core/lib.afl::show"]');
      result.unsupportedAccepted = await until(() => codes(unsupportedEdge.uri), value => value.includes("AFL4103"), "permitted capability difference");
      result.unsupportedNoImplementation = (await vscode.commands.executeCommand("vscode.executeImplementationProvider", file("core/lib.afl"), new vscode.Position(0, 11))) ?? [];
      await replace(preset, originalPreset);
      result.unsupportedRevoked = await until(() => codes(file("core/lib.afl")), value => value.includes("AFL4101"), "revoked capability permission");
      await replace(unsupportedEdge, originalUnsupportedEdge);
      await until(() => codes(file("core/lib.afl")), value => value.length === 0, "restored ios implementation");
      await unsupportedEdge.save();

      await replace(preset, 'core = ["../core"]\nedge = []');
      result.presetErrors = await until(() => codes(file("core/lib.afl")), c => c.includes("AFL4101"), "unsaved standalone preset");
      await replace(preset, originalPreset);
      result.presetRecovered = await until(() => codes(file("core/lib.afl")), c => c.length === 0, "preset recovery");
      await preset.save();
      result.implSyntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", file("edge/lib.afl"));
      await vscode.commands.executeCommand("afl.check");
      // VS Code's own TextMate capture command returns scopes and theme colors
      // from the registered grammar in the installed VSIX (no mocked tokenizer).
      result.syntax = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", file("app/highlighting.afl"));
      result.iosEdgeUri = file("ios-edge/lib.afl").toString();
      // A nested independent project has its own preset and follows active-editor focus.
      for (const part of ["core", "edge", "ios-edge"]) {
        await fs.mkdir(file("secondary/" + part).fsPath, {recursive:true});
        await fs.copyFile(file(part + "/lib.afl").fsPath, file("secondary/" + part + "/lib.afl").fsPath);
        await fs.copyFile(file(part + "/config.toml").fsPath, file("secondary/" + part + "/config.toml").fsPath);
      }
      await fs.writeFile(file("secondary/config.toml").fsPath, '[project]\n[preset.android]\ncore=["core"]\nedge=["edge"]\n[preset.ios]\ncore=["core"]\nedge=["ios-edge"]');
      await vscode.commands.executeCommand("afl.selectPreset", {projectUri:file("secondary").toString(),preset:"android"});
      const second = await vscode.workspace.openTextDocument(file("secondary/core/lib.afl"));
      await showProject(main, "");
      await vscode.commands.executeCommand("afl.check");
      const secondAfterClear = await vscode.commands.executeCommand("vscode.executeImplementationProvider", second.uri, new vscode.Position(0,11));
      result.secondaryAfterParentClear = (secondAfterClear ?? []).map(d => (d.uri ?? d.targetUri).toString());
      await vscode.commands.executeCommand("afl.selectPreset", {projectUri:file("").toString(),preset:"ios"});
      await showProject(second, "secondary");
      await vscode.commands.executeCommand("afl.check");
      const parentAfterClear = await vscode.commands.executeCommand("vscode.executeImplementationProvider", file("core/lib.afl"), new vscode.Position(0,11));
      result.parentAfterSecondaryClear = (parentAfterClear ?? []).map(d => (d.uri ?? d.targetUri).toString());
      await vscode.commands.executeCommand("afl.selectPreset", {projectUri:file("secondary").toString(),preset:"android"});
      await showProject(main, "");
    }
    if (["language", "command", "failure"].includes(mode)) {
      const expected = ["Activating AFL extension", ...(mode === "failure"
        ? ["AFL language server failed to start", "AFL project check failed"]
        : ["Language server ready", "Project check completed"])];
      const logs = await until(async () => Object.entries(await readLogs(logRoot))
        .map(([name, text]) => text.slice(logBefore[name]?.length ?? 0)).join("\n"),
        text => expected.every(message => text.includes(message)), "scenario log flush: " + mode);
      await fs.writeFile(path.join(root, mode + ".log"), logs);
    }
  } catch (error) {
    result.error = error.stack ?? String(error);
    throw error;
  } finally {
    await fs.writeFile(path.join(root, `${mode}.json`), JSON.stringify(result, null, 2));
  }
};
'#
  $suite | save ($fixture | path join "driver/suite.cjs")
  # VS Code deliberately uses in-memory workspace storage with extensionTestsPath.
  # One ordinary window preserves real workspace storage across window reloads.
  # A host-only restart replays activation events, so cold starts also reload.
  r#'
const vscode = require("vscode");
const fs = require("node:fs/promises"), path = require("node:path");
const root = process.env.AFL_E2E_ROOT;
const stages = [
  {mode: "command", next: "workbench.action.reloadWindow"},
  {mode: "associations", next: "workbench.action.reloadWindow"},
  {mode: "language"},
  {mode: "persist", next: "workbench.action.reloadWindow"},
  {mode: "restore", next: "workbench.action.reloadWindow"},
  {mode: "cleared", next: "workbench.action.reloadWindow"},
  {mode: "failure"},
];
async function closeEditors() {
  // Discard only this run's buffers, including untitled formatting fixtures.
  // Closing dirty editors without reverting would open confirmation dialogs.
  for (const document of vscode.workspace.textDocuments) {
    if (!document.isDirty) continue;
    if (document.uri.scheme !== "untitled" && !document.uri.fsPath.startsWith(root + path.sep)) {
      throw new Error("Unexpected document outside the isolated test workspace");
    }
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}
async function run(context) {
  const stateFile = path.join(root, "stage.json");
  let {index} = JSON.parse(await fs.readFile(stateFile, "utf8"));
  try {
    for (; index < stages.length; index++) {
      const {mode, next} = stages[index];
      await fs.appendFile(path.join(root, "stages.jsonl"), JSON.stringify({mode, hostPid: process.pid, appPid: process.ppid}) + "\n");
      let timeout;
      try {
        await Promise.race([require("./suite.cjs").run(mode, context), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Timed out scenario: " + mode)), 90000);
        })]);
      } finally { clearTimeout(timeout); }
      await closeEditors();
      if (mode === "cleared") {
        const extension = vscode.extensions.getExtension("afl-local.afl-vscode");
        await fs.writeFile(path.join(extension.extensionPath, "dist/server.cjs"), 'throw new Error("AFL E2E injected startup failure");');
      }
      await fs.writeFile(stateFile, JSON.stringify({index: index + 1}));
      if (next) {
        // Reload disposes this host's command connection; cancellation is normal.
        void vscode.commands.executeCommand(next).catch(async error => {
          if (error.name === "Canceled") return;
          await fs.writeFile(path.join(root, "driver-error.json"), JSON.stringify({index, error: error.stack ?? String(error)}));
          await vscode.commands.executeCommand("workbench.action.quit");
        });
        return;
      }
    }
  } catch (error) {
    await fs.writeFile(path.join(root, "driver-error.json"), JSON.stringify({index, error: error.stack ?? String(error)}));
    await closeEditors();
  }
  await vscode.commands.executeCommand("workbench.action.quit");
}
exports.activate = context => {
  // Finish activation before a stage can reload the window.
  setImmediate(() => { void run(context).catch(error => console.error(error)); });
};
'# | save ($fixture | path join "driver/activate.cjs")

  let launcher = r#'
const fs = require("node:fs/promises"), path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");
const { execFileSync, spawn } = require("node:child_process");
const [root, fixture, version, configured] = process.argv.slice(1);
const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } = createRequire(path.join(root, "package.json"))("@vscode/test-electron");
(async () => {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("VS Code E2E requires a Linux desktop session. Run it under Xvfb or provide DISPLAY/WAYLAND_DISPLAY.");
  }
  let executable = configured || process.env.AFL_VSCODE_EXECUTABLE;
  if (!executable && process.platform === "darwin") {
    for (const name of ["Code", "Electron"]) {
      const installed = `/Applications/Visual Studio Code.app/Contents/MacOS/${name}`;
      try { await fs.access(installed); executable = installed; break; } catch {}
    }
  }
  if (!executable) {
    const cachePath = path.join(process.env.TEMP_DIR || path.join(root, ".test-artifacts"), "vscode-download");
    await fs.mkdir(cachePath, {recursive: true});
    executable = await downloadAndUnzipVSCode({version: "stable", cachePath});
  }
  // Honor the configured location; the macOS default stays short for Unix sockets.
  const runtime = await fs.mkdtemp(path.join(process.env.TEMP_DIR || (process.platform === "win32" ? os.tmpdir() : "/tmp"), "afl-e2e-"));
  const profile = path.join(runtime, "profile");
  let server, original;
  try {
    const extensions = path.join(fixture, "extensions");
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable, {reuseMachineInstall: true});
    const install = execFileSync(cli, [...cliArgs, "--user-data-dir", path.join(runtime, "install"),
      "--extensions-dir", extensions, "--install-extension", path.join(root, "release", `afl-vscode-${version}.vsix`), "--force"],
      {encoding: "utf8", timeout: 60000});
    await fs.writeFile(path.join(fixture, "install.log"), install);
    server = path.join(extensions, `afl-local.afl-vscode-${version}`, "dist/server.cjs");
    original = await fs.readFile(server);
    await fs.mkdir(path.join(profile, "User"), {recursive: true});
    await fs.writeFile(path.join(profile, "User/settings.json"), JSON.stringify({
      "telemetry.telemetryLevel": "off", "update.mode": "none", "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false, "window.restoreWindows": "none", "workbench.startupEditor": "none",
      "files.hotExit": "off", "security.workspace.trust.enabled": false,
      // Keep word-based fallback suggestions out of language-provider assertions.
      "editor.wordBasedSuggestions": "off",
    }));
    await fs.writeFile(path.join(fixture, "stage.json"), JSON.stringify({index: 0}));
    // This is the only GUI process launch. Stage changes happen inside its window.
    const child = spawn(executable, [fixture,
      "--user-data-dir", profile, "--extensions-dir", extensions, "--new-window",
      "--no-sandbox", "--disable-gpu-sandbox", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
      "--skip-add-to-recently-opened", "--disable-telemetry",
      "--extensionDevelopmentPath=" + path.join(fixture, "driver")], {
      stdio: "inherit", env: {...process.env, AFL_E2E_ROOT: fixture},
    });
    const kill = setTimeout(() => child.kill("SIGKILL"), 300000);
    try {
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`VS Code exited with ${code ?? signal}`)));
      });
    } finally { clearTimeout(kill); }
    await fs.writeFile(path.join(fixture, "launch.json"), JSON.stringify({count: 1, appPid: child.pid}));
    try {
      const error = JSON.parse(await fs.readFile(path.join(fixture, "driver-error.json"), "utf8"));
      throw new Error(error.error);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const state = JSON.parse(await fs.readFile(path.join(fixture, "stage.json"), "utf8"));
    if (state.index !== 7) throw new Error("VS Code exited before all scenarios completed");
  } finally {
    if (original) await fs.writeFile(server, original);
    try { await fs.cp(profile, path.join(fixture, "profile"), {recursive: true}); }
    finally { await fs.rm(runtime, {recursive: true, force: true}); }
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
'#
  let execution = (^node -e $launcher $project_root $fixture $version ($vscode_executable | default "") | complete)
  $execution.stdout | save ($fixture | path join "host-stdout.log")
  $execution.stderr | save ($fixture | path join "host-stderr.log")
  if $execution.exit_code != 0 { error make {msg: $"VS Code E2E failed; see ($fixture).\n($execution.stdout)\n($execution.stderr)"} }
  let launch = (open ($fixture | path join "launch.json"))
  assert equal $launch.count 1
  let stages = (open --raw ($fixture | path join "stages.jsonl") | lines | each {|line| $line | from json})
  assert equal ($stages | get mode) [command associations language persist restore cleared failure]
  assert equal ($stages | get appPid | uniq) [$launch.appPid]
  # Cold activation, preset restoration and injected failure all use fresh hosts.
  assert equal ($stages | get hostPid | uniq | length) 6
  for mode in [command associations language failure] {
    let observed = (open ($fixture | path join $"($mode).json"))
    assert (not $observed.activeBefore) $"($mode) must start with an inactive AFL extension"
  }
  let associations = (open ($fixture | path join "associations.json"))
  assert equal $associations.tplLanguage "swig"
  assert equal ($associations.nativeTargets | length) 1
  assert equal ($associations.trace.results | length) 2
  assert equal $associations.shiftedLine 4
  assert ("AFL4202" in $associations.nativeOverlayErrors)
  assert ("AFL4202" in $associations.deleted)
  assert equal $associations.recreated []
  assert (($associations.impact.implementations | length) >= 2)
  let language = (open ($fixture | path join "language.json"))
  assert equal $language.extensionVersion $version
  assert ($language.extensionPath | str starts-with ($fixture | path join "extensions"))
  assert $language.active
  assert equal $language.language "afl"
  assert equal $language.definition [$language.coreUri]
  assert ($language.hover | str replace --all "&nbsp;" " " | str contains "Display number")
  assert equal $language.signature "a: i32"
  assert (($language.references | length) >= 1)
  assert ("show" in $language.completions)
  assert ("AFL3203" in $language.unsavedErrors)
  assert $language.dirty
  assert $language.diskUnchanged
  assert equal $language.recoveredErrors []
  assert equal $language.formatted "fn messy() {\n  call()\n}\n"
  assert $language.formatBufferUntouched
  assert equal $language.nullableDefinition [$language.nullableTypeUri]
  assert ($language.nullableHover | str contains "Counter?")
  assert ("value" in $language.nullableCompletions)
  assert equal $language.nullableErrors []
  assert equal $language.callbackSignature "fn(i32) -> i32"
  assert equal $language.callbackReference [$language.coreUri]
  assert ("AFL3207" in $language.callbackErrors)
  assert equal $language.defaultDefinition [$language.coreUri]
  assert ($language.defaultHover | str replace --all "&nbsp;" " " | str contains "value: i32 = 10000")
  assert ("AFL3302" in $language.removedDefaultErrors)
  assert equal $language.defaultRecoveredErrors []
  assert ("AFL3203" in $language.defaultReferenceErrors)
  assert equal $language.rawActiveParameter 1
  assert equal $language.rawCompletions []
  assert equal $language.rawDefinitions []
  assert equal $language.afterRawDefinition [$language.coreUri]
  assert ("AFL1001" in $language.rawStringErrors)
  assert ("AFL1001" in $language.rawDescriptionErrors)
  assert equal $language.rawRecoveredErrors []
  assert equal $language.structDefinition [$language.nullableTypeUri]
  assert ($language.structHover | str replace --all "&nbsp;" " " | str contains "note?: string?")
  assert equal $language.structCompletions [note]
  assert $language.structFieldKind
  assert $language.structSymbolKind
  assert $language.structChildKinds
  assert ("AFL3302" in $language.structRequiredErrors)
  assert equal $language.structRecoveredErrors []
  assert equal $language.forMemberDefinition [$language.nullableTypeUri]
  assert equal $language.forBindingLine 3
  assert equal $language.forCompletions [value]
  assert ("AFL3208" in $language.forErrors)
  assert equal $language.forRecoveredErrors []
  assert $language.forIndexDefinition
  assert ($language.forIndexHover | str replace --all "&nbsp;" " " | str contains "index: i32")
  assert $language.forIndexReference
  assert ("index" in $language.forIndexCompletions)
  assert equal $language.forIndexedMember [$language.nullableTypeUri]
  assert ("AFL3208" in $language.forIndexedErrors)
  assert equal $language.forIndexedRecovered []
  assert $language.assertFunctionKind
  assert ($language.assertHover | str replace --all "&nbsp;" " " | str replace --all '\' '' | str contains "fn assert(condition: bool)")
  assert equal $language.assertSignature "fn assert(condition: bool)"
  assert equal $language.assertParameter "condition: bool"
  assert equal $language.assertBuiltinDefinition []
  assert equal $language.assertBuiltinReferences []
  assert $language.assertArgumentDefinition
  assert ("AFL3206" in $language.assertErrors)
  assert equal $language.assertRecovered []
  assert ($language.assertSyntax | any {|token| ($token.c == "assert") and ($token.t | str contains "entity.name.function.afl") })
  assert equal $language.linkDefinition [$language.coreUri]
  assert ($language.linkHover | str replace --all "&nbsp;" " " | str contains "Display number")
  assert $language.linkLocalDefinition
  assert $language.linkReferences
  assert equal $language.linkRawDefinitions []
  assert equal $language.linkRawCompletions []
  assert ("display" in $language.linkCompletions)
  assert ("AFL3203" in $language.linkErrors)
  assert ("AFL1006" in $language.linkSyntaxErrors)
  assert equal $language.linkRecovered []
  assert ($language.linkSyntax | any {|token| ($token.c == "display") and ($token.t | str contains "markup.underline.link.afl") })
  assert equal $language.linkAndroidImplementation [$language.edgeUri]
  assert equal $language.linkIosImplementation [$language.iosEdgeUri]
  assert equal $language.closerLine 2
  assert equal $language.closerRelatedLine 0
  assert ($language.closerMessage | str contains "method body")
  assert $language.closerLaterSymbol
  assert equal $language.feedbackRecovered []
  assert ($language.unionHover | str contains "camera")
  assert equal $language.unionDefinitionLine 0
  assert $language.unionSymbolKind
  assert ($language.sortingSignature | str contains "key: fn(Frame) -> K")
  assert equal $language.numericSignature "fn round(value: f64) -> f64"
  assert ("AFL3209" in $language.unionErrors)
  assert equal $language.groupedDefinition [$language.coreUri]
  assert ("show" in $language.groupedCompletion)
  assert ($language.inheritedHover | str replace --all "&nbsp;" " " | str contains "Input number")
  assert equal $language.inheritedErrors []
  assert ("AFL4101" in $language.unsupportedDenied)
  assert ("AFL4103" in $language.unsupportedAccepted)
  assert equal $language.unsupportedNoImplementation []
  assert ("AFL4101" in $language.unsupportedRevoked)
  assert ($language.feedbackSyntax | any {|token| ($token.c == "Mode") and ($token.t | str contains "entity.name.type.afl") })
  assert equal $language.whenDefinition [$language.coreUri]
  assert $language.whenLocalDefinition
  assert ("chosen" in $language.whenCompletions)
  assert equal $language.whenSignature "a: i32"
  assert equal ($language.collectionCompletions | sort) [add clear contains get index_of insert len remove remove_at set sort sort_by sorted sorted_by]
  assert equal ($language.setCompletions | sort) [add clear contains len remove]
  assert equal ($language.mapCompletions | sort) [clear contains_key get keys len remove set values]
  assert $language.collectionMethodKind
  assert ($language.collectionHover | str replace --all "&nbsp;" " " | str replace --all '\' '' | str contains "fn list<Counter>.get(index: i32) -> Counter")
  assert equal $language.collectionSignature ["key: string" "value: Counter?"]
  assert equal $language.collectionActiveParameter 1
  assert equal $language.collectionDefinition [$language.nullableTypeUri]
  assert equal $language.collectionBuiltinDefinition []
  assert ("AFL3204" in $language.collectionErrors)
  assert ("AFL3206" in $language.collectionArgumentErrors)
  assert equal $language.collectionRecoveredErrors []
  assert (not ($language.collectionSyntax | where {|token| ($token.c == "get") and ($token.t | str contains "entity.name.function.afl") } | is-empty))
  assert ("AFL1004" in $language.whenErrors)
  assert equal $language.whenRecoveredErrors []
  assert (not ($language.whenSyntax | where {|token| ($token.c == "when") and ($token.t | str contains "keyword.control.afl") } | is-empty))
  assert (not ($language.whenSyntax | where {|token| ($token.c == "->") and ($token.t | str contains "keyword.operator.branch.afl") } | is-empty))
  for word in [for in] {
    assert (not ($language.forSyntax | where {|token| ($token.c == $word) and ($token.t | str contains "keyword.control.afl") } | is-empty))
  }
  assert ("AFL3002" in $language.configErrors)
  assert ("AFL3203" in $language.specErrors)
  assert equal $language.specRecovered []
  assert equal $language.specDefinition [$language.coreUri]
  assert ("AFL3004" in $language.specConfigErrors)
  assert $language.showLogs
  assert equal $language.implementation [$language.edgeUri]
  assert ("AFL4101" in $language.presetErrors)
  assert equal $language.presetRecovered []
  assert (not ($language.implSyntax | where {|token| ($token.c == "impl") and ($token.t | str contains "keyword.control.import.afl") } | is-empty))
  assert (not ($language.syntax | where {|token| ($token.c == "?") and ($token.t | str contains "keyword.operator.type.nullable.afl") } | is-empty))
  for expected in [
    {text: struct, scope: storage.type.struct.afl}
    {text: Gift, scope: entity.name.type.struct.afl}
    {text: gift-id, scope: string.quoted.double.afl}
    {text: Counter, scope: entity.name.type.class.afl}
    {text: '10000', scope: constant.numeric.afl}
    {text: highlight, scope: entity.name.function.afl}
    {text: i32, scope: support.type.primitive.afl}
    {text: sample, scope: variable.parameter.afl}
    {text: Incoming, scope: comment.block.documentation.afl}
    {text: Raw, scope: comment.block.documentation.raw.afl}
    {text: hello, scope: string.quoted.double.afl}
    {text: raw_literal_body, scope: string.quoted.double.raw.afl}
    {text: "null", scope: constant.language.null.afl}
  ] {
    let matches = ($language.syntax | where {|token| ($token.c | str contains $expected.text) and ($token.t | str contains $expected.scope) })
    assert (not ($matches | is-empty)) $"Missing editor token: ($expected.text)"
    for token in $matches {
      for color in [$token.r.dark_plus $token.r.light_plus] {
        assert ($color | str contains "#")
        assert (not ($color | str starts-with "default:")) $"No theme color for ($expected.text)"
      }
    }
  }
  let persisted = (open ($fixture | path join "persist.json"))
  assert equal $persisted.implementation [$language.iosEdgeUri]
  let restored = (open ($fixture | path join "restore.json"))
  assert equal $restored.implementation [$language.iosEdgeUri]
  assert equal ($restored.cleared | sort) ([$language.edgeUri $language.iosEdgeUri] | sort)
  let cleared = (open ($fixture | path join "cleared.json"))
  assert equal ($cleared.implementation | sort) ([$language.edgeUri $language.iosEdgeUri] | sort)
  assert equal $language.secondaryAfterParentClear $persisted.secondaryImplementation
  assert equal $language.parentAfterSecondaryClear [$language.iosEdgeUri]
  assert equal $restored.secondaryImplementation $persisted.secondaryImplementation
  assert equal $cleared.secondaryImplementation $persisted.secondaryImplementation
  assert ($persisted.secondaryImplementation.0 | str ends-with "/secondary/edge/lib.afl")
  let command = (open ($fixture | path join "command.json"))
  assert equal $command.documentsBefore 0
  assert $command.active
  assert $command.checked
  let failure = (open ($fixture | path join "failure.json"))
  assert $failure.activationFailed
  assert $failure.showLogs
  assert $failure.checkFailureHandled
  for mode in [language command failure] {
    let text = (open --raw ($fixture | path join $"($mode).log"))
    assert ($text | str contains "Activating AFL extension")
    if $mode == "failure" {
      assert ($text | str contains "AFL language server failed to start")
      assert ($text | str contains "AFL project check failed")
    } else {
      assert ($text | str contains "Language server ready")
      assert ($text | str contains "Project check completed")
    }
  }
  print $"Real VS Code ($language.version) checks passed in one window and one app process: all 7 scenarios, cold activation, TextMate, navigation, diagnostics, formatting, preset restoration across reloads and startup failure logs."
}
