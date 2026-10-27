use ../support.nu temporary-directory
use std/assert

def main [--extension-root: path] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let extension_root = ($extension_root | default ($project_root | path join "packages/vscode"))
  let manifest = (open ($extension_root | path join "package.json"))
  let fixture = (temporary-directory "vscode")
  try {
    # Copy only distributable files: neither client nor server may need workspace packages at runtime.
    mkdir ($fixture | path join "extension/dist") ($fixture | path join "app") ($fixture | path join "core")
    cp ($extension_root | path join "dist/extension.cjs") ($fixture | path join "extension/dist/extension.cjs")
    cp ($extension_root | path join "dist/server.cjs") ($fixture | path join "extension/dist/server.cjs")
    "use dep::core::lib::show\nfn main() {\n    value: i32 = show(1)\n}" | save ($fixture | path join "app/main.afl")
    "[project]\n[dep]\ncore = '../core'" | save ($fixture | path join "app/config.toml")
    "extern fn show(a: i32) -> i32 [\n desc = [Display number]\n a = [Input number]\n return = [Displayed number]\n]" | save ($fixture | path join "core/lib.afl")
    "[dep]" | save ($fixture | path join "core/config.toml")

    # The VS Code API is simulated; the bundled Microsoft client, IPC transport,
    # bundled AFL server and filesystem are real. Assertions stay in Nushell.
    let bridge = r#'
      const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
      const {fileURLToPath, pathToFileURL} = require("node:url");
      const root = fs.realpathSync(process.argv[1]);
      const events = new Map(), providers = new Map(), commands = new Map(), diagnostics = new Map(), watchers = [], logs = [], channels = [];
      const disposables = [], waiters = new Set(), statuses = [], memory = new Map();
      let openDocuments = [], folders = [], diagnosticsDisposed = false;
      const wake = () => { for (const check of [...waiters]) check(); };
      class Disposable {
        constructor(callback = () => {}) { this.callback = callback; this.disposed = false; disposables.push(this); }
        dispose() { if (!this.disposed) { this.disposed = true; this.callback(); } }
        static from(...items) { return new Disposable(() => items.forEach(item => item.dispose())); }
      }
      class EventEmitter {
        constructor() {
          this.listeners = new Set();
          this.event = (callback, self, subscriptions) => {
            const bound = self ? callback.bind(self) : callback;
            this.listeners.add(bound);
            const result = new Disposable(() => this.listeners.delete(bound)); subscriptions?.push(result); return result;
          };
        }
        fire(value) { for (const callback of [...this.listeners]) callback(value); }
        dispose() { this.listeners.clear(); }
      }
      const event = name => {
        if (!events.has(name)) events.set(name, new EventEmitter());
        return events.get(name);
      };
      class Uri {
        constructor(value) { this.value = value; const parsed = new URL(value); this.scheme = parsed.protocol.slice(0, -1); this.path = decodeURIComponent(parsed.pathname); }
        static parse(value) { return new Uri(value); }
        static file(value) { return new Uri(pathToFileURL(value).href); }
        get fsPath() { return this.scheme === "file" ? fileURLToPath(this.value) : this.path; }
        toString() { return this.value; }
        toJSON() { return this.value; }
      }
      class Position { constructor(line, character) { Object.assign(this, {line, character}); } }
      class Range {
        constructor(a, b, c, d) { this.start = typeof a === "number" ? new Position(a, b) : a; this.end = typeof a === "number" ? new Position(c, d) : b; }
      }
      class MarkdownString {
        constructor(value = "") { this.value = value; }
        appendText(value) { this.value += value; return this; }
        appendMarkdown(value) { this.value += value; return this; }
        appendCodeblock(value) { this.value += value; return this; }
      }
      class Diagnostic { constructor(range, message, severity) { Object.assign(this, {range, message, severity}); } }
      class DiagnosticRelatedInformation { constructor(location, message) { Object.assign(this, {location, message}); } }
      class Location { constructor(uri, range) { Object.assign(this, {uri, range}); } }
      class CompletionItem { constructor(label) { this.label = label; } }
      class Hover { constructor(contents, range) { Object.assign(this, {contents, range}); } }
      class DocumentSymbol { constructor(name, detail, kind, range, selectionRange) { Object.assign(this, {name, detail, kind, range, selectionRange, children: []}); } }
      class RelativePattern { constructor(base, pattern) { this.baseUri = base instanceof Uri ? base : base.uri ?? Uri.file(base); this.pattern = pattern; } }
      const cancelled = {isCancellationRequested: false, onCancellationRequested: () => new Disposable()};
      const api = {
        StatusBarAlignment: {Left: 1, Right: 2},
        version: "1.100.0", env: {appName: "AFL test host", language: "en"},
        Disposable, EventEmitter, Uri, Position, Range, MarkdownString, Diagnostic, DiagnosticRelatedInformation, Location, CompletionItem, Hover, DocumentSymbol, RelativePattern,
        CancellationError: class extends Error {},
        CancellationTokenSource: class { constructor() { this.token = cancelled; } cancel() {} dispose() {} },
        SignatureHelp: class {}, SignatureInformation: class {constructor(label) {this.label = label;}},
        ParameterInformation: class {constructor(label) {this.label = label;}},
        CompletionList: class {constructor(items, isIncomplete) {Object.assign(this, {items, isIncomplete});}},
        TextEdit: class {constructor(range, newText) {Object.assign(this, {range, newText});}},
        DiagnosticSeverity: {Error: 0, Warning: 1, Information: 2, Hint: 3},
        CompletionTriggerKind: {Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2},
        SignatureHelpTriggerKind: {Invoke: 1, TriggerCharacter: 2, ContentChange: 3},
        CompletionItemKind: {Text: 0}, CompletionItemTag: {Deprecated: 1},
        SymbolKind: {Property: 6, TypeParameter: 25}, SymbolTag: {Deprecated: 1},
        CodeActionKind: Object.fromEntries(["Empty", "QuickFix", "Refactor", "RefactorExtract", "RefactorInline", "RefactorRewrite", "Source", "SourceOrganizeImports"].map(name => [name, {value: name}])),
      };
      for (const name of ["CodeLens", "DocumentLink", "CodeAction", "CallHierarchyItem", "TypeHierarchyItem", "SymbolInformation", "InlayHint"]) api[name] = class {};
      const registerProvider = name => (selector, provider) => {
        providers.set(name, {selector, provider}); return new Disposable(() => providers.delete(name));
      };
      api.languages = {
        match: (selector, document) => selector.some(item =>
          (!item.language || item.language === document.languageId) && (!item.scheme || item.scheme === document.uri.scheme) &&
          (!item.pattern || document.uri.path.endsWith(".toml"))) ? 10 : 0,
        createDiagnosticCollection: () => ({
          set(uri, values) { diagnostics.set(uri.toString(), values); wake(); },
          delete(uri) { diagnostics.delete(uri.toString()); wake(); },
          clear() { diagnostics.clear(); wake(); },
          dispose() { diagnosticsDisposed = true; diagnostics.clear(); },
        }),
      };
      for (const name of ["CompletionItem", "Hover", "SignatureHelp", "Definition", "Implementation", "Reference", "DocumentSymbol"]) {
        api.languages["register" + name + "Provider"] = registerProvider(name);
      }
      const hostEvents = object => new Proxy(object, {
        get(target, key) { if (key in target) return target[key]; if (String(key).startsWith("on")) return event(key).event; throw new Error("Missing host API " + String(key)); },
      });
      api.workspace = hostEvents({
        get textDocuments() {return openDocuments;}, get workspaceFolders() {return folders;}, notebookDocuments: [],
        getConfiguration: () => ({get: (_name, fallback) => fallback}),
        createFileSystemWatcher: (pattern, ignoreCreate, ignoreChange, ignoreDelete) => {
          const item = {pattern, change: new EventEmitter(), create: new EventEmitter(), delete: new EventEmitter(), disposed: false,
            ignoreCreate, ignoreChange, ignoreDelete}; watchers.push(item); wake();
          return {
            onDidChange: item.change.event, onDidCreate: item.create.event, onDidDelete: item.delete.event,
            dispose() {item.disposed = true; item.change.dispose(); item.create.dispose(); item.delete.dispose();},
          };
        },
      });
      api.window = hostEvents({
        visibleTextEditors: [], activeTextEditor: undefined,
        createStatusBarItem: id => {
          const item = {id, show() {this.visible = true;}, dispose() {this.disposed = true;}};
          statuses.push(item); return item;
        },
        createOutputChannel: (name, options) => {
          const channel = {name, options, shown: false, disposed: false}; channels.push(channel);
          return {append: value => logs.push(value), appendLine: value => logs.push(value),
            info: value => logs.push(value), error: value => logs.push("ERROR: " + value),
            show() {channel.shown = true;}, dispose() {channel.disposed = true;}};
        },
        showErrorMessage: async message => {logs.push(message);},
        showWarningMessage: async message => {logs.push(message);},
        showInformationMessage: async message => {logs.push(message);},
      });
      api.commands = {
        registerCommand: (name, callback) => {
          if (commands.has(name)) throw new Error("Command already registered: " + name);
          commands.set(name, callback); return new Disposable(() => commands.delete(name));
        },
        executeCommand: async (name, ...args) => commands.get(name)?.(...args),
      };
      const originalLoad = Module._load;
      Module._load = function(name, ...args) {return name === "vscode" ? api : originalLoad.call(this, name, ...args);};
      const extension = require(path.join(root, "extension/dist/extension.cjs"));
      Module._load = originalLoad;
      const context = {subscriptions: [], asAbsolutePath: value => path.join(root, "extension", value), workspaceState: {
        get: key => memory.get(key), update: async (key, value) => {if (value === undefined) memory.delete(key); else memory.set(key, value);},
      }};
      const fileUri = file => Uri.file(path.join(root, file));
      const makeDocument = (uri, text, languageId = "afl") => ({uri, text, languageId, version: 1, isClosed: false, getText() {return this.text;}});
      const main = makeDocument(fileUri("app/main.afl"), fs.readFileSync(path.join(root, "app/main.afl"), "utf8"));
      const core = makeDocument(fileUri("core/lib.afl"), fs.readFileSync(path.join(root, "core/lib.afl"), "utf8"));
      const config = makeDocument(fileUri("app/config.toml"), "[project]\n[dep]\ncore = '../missing'", "toml");
      const codes = uri => (diagnostics.get(uri.toString()) ?? []).map(item => item.code);
      const until = (predicate, label) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {waiters.delete(check); reject(new Error("Timed out: " + label + "\n" + logs.join("\n")));}, 6000);
        function check() {if (predicate()) {clearTimeout(timeout); waiters.delete(check); resolve();}}
        waiters.add(check); check();
      });
      const at = (document, text, skip = 0) => {
        const parts = document.text.slice(0, document.text.indexOf(text) + skip).split("\n");
        return new Position(parts.length - 1, parts.at(-1).length);
      };
      const provider = kind => providers.get(kind).provider;
      const edit = (document, text) => {
        const end = document.text.split("\n");
        const range = new Range(0, 0, end.length - 1, end.at(-1).length);
        const length = document.text.length; document.text = text; document.version++;
        event("onDidChangeTextDocument").fire({document, contentChanges: [{range, rangeLength: length, text}]});
      };
      const emitFile = (kind, file) => {
        const uri = fileUri(file);
        for (const watcher of watchers.filter(item => !item.disposed && uri.toString().startsWith(item.pattern.baseUri.toString()))) watcher[kind].fire(uri);
      };
      openDocuments = [main]; folders = [{uri: fileUri("app"), name: "app", index: 0}];
      const timeout = setTimeout(() => {throw new Error("VS Code host timed out\n" + logs.join("\n"));}, 20000);
      (async () => {
        const result = {};
        let constructorListeners;
        const listenerCounts = () => [...events].filter(([, value]) => value.listeners.size > 0).map(([name, value]) => ({name, count: value.listeners.size}));
        try {
          const activating = extension.activate(context);
          // SDK 9 registers three notebook listeners in its constructor. Track
          // that baseline separately from the AFL synchronization subscriptions.
          constructorListeners = listenerCounts().map(item => ({...item, count: item.count - (item.name === "onDidChangeActiveTextEditor" ? 1 : 0)})).filter(item => item.count > 0);
          const earlyCheck = commands.get("afl.check")();
          await Promise.all([activating, earlyCheck]);
          await until(() => diagnostics.has(main.uri.toString()), "initial diagnostics");
          if (!commands.has("afl.traceGeneration") || !commands.has("afl.generationImpact")) throw new Error("Implementation query commands were not registered");
          result.initial = codes(main.uri);
          result.providers = [...providers.keys()].sort();
          result.definition = await provider("Definition").provideDefinition(main, at(main, "show(1)"), cancelled);
          result.coreUri = core.uri.toString();
          result.hover = await provider("Hover").provideHover(main, at(main, "show(1)"), cancelled);
          result.signature = await provider("SignatureHelp").provideSignatureHelp(main, at(main, "show(1)", 5), cancelled, {triggerKind: 1, isRetrigger: false});
          result.references = await provider("Reference").provideReferences(main, at(main, "show(1)"), {includeDeclaration: false}, cancelled);
          result.outline = await provider("DocumentSymbol").provideDocumentSymbols(core, cancelled);
          const originalMain = main.text;
          edit(main, "use dep::core::lib::show\nfn main() {\n sh");
          result.completion = await provider("CompletionItem").provideCompletionItems(main, new Position(2, 3), cancelled, {triggerKind: 0});
          edit(main, originalMain);
          await provider("Definition").provideDefinition(main, at(main, "show(1)"), cancelled);
          openDocuments.push(config); event("onDidOpenTextDocument").fire(config);
          await until(() => codes(config.uri).includes("AFL3002"), "unsaved config"); result.unsavedConfig = codes(config.uri);
          openDocuments = [main]; config.isClosed = true; event("onDidCloseTextDocument").fire(config);
          await until(() => codes(config.uri).length === 0, "config close");
          result.restoredDefinition = await provider("Definition").provideDefinition(main, at(main, "show(1)"), cancelled);
          await until(() => watchers.some(item => !item.disposed && item.pattern.baseUri.toString().startsWith(core.uri.toString().replace("lib.afl", ""))), "external dependency watcher");
          result.externalWatches = watchers.filter(item => !item.disposed).map(item => item.pattern.baseUri.toString());

          fs.writeFileSync(path.join(root, "core/extra.afl"), "fn extra() { unknown() }");
          emitFile("create", "core/extra.afl");
          await until(() => codes(fileUri("core/extra.afl")).includes("AFL3203"), "created dependency module");
          result.created = codes(fileUri("core/extra.afl"));
          fs.unlinkSync(path.join(root, "core/extra.afl")); emitFile("delete", "core/extra.afl");
          await until(() => codes(fileUri("core/extra.afl")).length === 0, "deleted dependency module");
          result.deleted = codes(fileUri("core/extra.afl"));

          const untitled = makeDocument(Uri.parse("untitled:Scratch.afl"), "fn main() { missing() }");
          openDocuments.push(untitled); event("onDidOpenTextDocument").fire(untitled);
          await until(() => codes(untitled.uri).includes("AFL3203"), "untitled check"); result.untitled = codes(untitled.uri);
          openDocuments = []; main.isClosed = true; untitled.isClosed = true;
          event("onDidCloseTextDocument").fire(main); event("onDidCloseTextDocument").fire(untitled);
          await commands.get("afl.check")();
          result.workspaceDefinition = await provider("Definition").provideDefinition(main, at(main, "show(1)"), cancelled);
          await commands.get("afl.showLogs")();
          result.channels = channels;
          result.logs = logs;
          result.statuses = statuses;
        } finally {
          await extension.deactivate();
          context.subscriptions.forEach(item => item.dispose());
          clearTimeout(timeout);
        }
        result.cleaned = {diagnostics: diagnosticsDisposed, providers: providers.size, commands: commands.size,
          watchers: watchers.every(item => item.disposed), listenersReturnedToBaseline: JSON.stringify(listenerCounts()) === JSON.stringify(constructorListeners)};
        console.log(JSON.stringify(result));
      })().catch(error => {console.error(error.stack); process.exitCode = 1;});
    '#
    let execution = (^node -e $bridge $fixture | complete)
    if $execution.exit_code != 0 { error make {msg: $"($execution.stdout)($execution.stderr)"} }
    let result = ($execution.stdout | from json)
    assert equal $manifest.main "./dist/extension.cjs"
    assert equal $result.initial []
    assert equal $result.providers ["CompletionItem", "Definition", "DocumentSymbol", "Hover", "Implementation", "Reference", "SignatureHelp"]
    assert equal $result.definition.uri $result.coreUri
    assert ($result.hover.contents.value | str contains "Display number")
    assert equal $result.signature.activeParameter 0
    assert equal $result.signature.signatures.0.parameters.0.label "a: i32"
    assert equal ($result.references | length) 2
    assert equal ($result.outline | get name) ["show"]
    assert equal ($result.completion | get label) ["show"]
    assert ("AFL3002" in $result.unsavedConfig)
    assert equal $result.restoredDefinition $result.definition
    assert equal $result.created ["AFL3203"]
    assert equal $result.deleted []
    assert equal $result.untitled ["AFL3203"]
    assert equal $result.workspaceDefinition $result.definition
    assert ("Activating AFL extension" in $result.logs)
    assert ("Language server ready" in $result.logs)
    assert ("Project check completed" in $result.logs)
    assert ("Language server stopped" in $result.logs)
    assert ($result.logs | all {|line| not ($line | str starts-with "ERROR:") })
    assert ($result.channels | any {|channel| $channel.name == "AFL" and $channel.options.log and $channel.shown and $channel.disposed })
    assert ($result.statuses | any {|item| $item.id == "afl.preset" and $item.visible and $item.disposed and ($item.text | str contains "No preset") })
    assert equal $result.cleaned {diagnostics: true, providers: 0, commands: 0, watchers: true, listenersReturnedToBaseline: true}
    print "VS Code checks passed: portable bundles, real LSP client/server, providers, document sync, file watches and disposal."
  } finally {
    rm --recursive --force $fixture
  }
}
