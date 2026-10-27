import { fileURLToPath, pathToFileURL } from "node:url";
import manifest from "../package.json" with { type: "json" };
import {
  createConnection,
  TextDocuments,
  TextDocumentSyncKind,
  CompletionItemKind,
  SymbolKind,
  DiagnosticSeverity,
  MarkupKind,
  DidChangeWatchedFilesNotification,
  DocumentFormattingRequest,
  type Disposable,
  type Diagnostic as LspDiagnostic,
  type DocumentSymbol,
  type SymbolInformation,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  formatDocument,
  type OutlineSymbol,
  type Completion,
} from "@afl/checker";
import {
  loadProject,
  traceAssociations,
  implementationImpact,
} from "@afl/checker/node";
import { EditorProjects, type ProjectSelection } from "./projects.js";

// No argument means stdio; the VS Code client selects --node-ipc.
const connection = process.argv.includes("--node-ipc")
  ? createConnection()
  : createConnection(process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);
const projects = new EditorProjects();
let workspaceFolders: string[] = [];
let revision = 0,
  applied = -1;
let stopping = false,
  initialized = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<void> | undefined;
let published = new Set<string>();
let canWatch = false;
let canChangeFolders = false;
let hierarchicalSymbols = false;
let watchKey = "";
let watchRegistration: Disposable | undefined;
let watchUpdates = Promise.resolve();
let dynamicFormatting = false;
let formattingRegistration: Disposable | undefined;

const isAfl = (document: TextDocument): boolean =>
  document.languageId === "afl" || document.uri.endsWith(".afl");
const isConfig = (document: TextDocument): boolean =>
  /\.toml$/u.test(document.uri);
const directory = (uri: string): string => new URL(".", uri).href;
const asDirectory = (uri: string): string => uri.replace(/\/?$/u, "/");
connection.onInitialize(async (params) => {
  workspaceFolders =
    params.workspaceFolders?.map((folder) => folder.uri) ??
    (params.rootUri ? [params.rootUri] : []);
  await projects.setFolders(workspaceFolders);
  const saved =
    params.initializationOptions?.projects ??
    (params.initializationOptions?.preset
      ? [params.initializationOptions.preset]
      : []);
  if (Array.isArray(saved))
    for (const value of saved) {
      if (validSelection(value)) await projects.select(value, false);
    }
  if (typeof params.initializationOptions?.activeDocumentUri === "string")
    await projects.focus(params.initializationOptions.activeDocumentUri);
  const watching = params.capabilities.workspace?.didChangeWatchedFiles;
  canWatch =
    watching?.dynamicRegistration === true &&
    watching.relativePatternSupport === true;
  canChangeFolders = params.capabilities.workspace?.workspaceFolders === true;
  hierarchicalSymbols =
    params.capabilities.textDocument?.documentSymbol
      ?.hierarchicalDocumentSymbolSupport === true;
  dynamicFormatting =
    params.capabilities.textDocument?.formatting?.dynamicRegistration === true;
  return {
    serverInfo: { name: "afl-lsp", version: manifest.version },
    capabilities: {
      positionEncoding: "utf-16",
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      definitionProvider: true,
      implementationProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      completionProvider: { triggerCharacters: [".", ":"] },
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
        retriggerCharacters: [","],
      },
      documentSymbolProvider: true,
      documentFormattingProvider: !dynamicFormatting,
      executeCommandProvider: {
        commands: [
          "afl.checkProject",
          "afl.listPresets",
          "afl.checkPreset",
          "afl.traceGenerated",
          "afl.queryImpact",
        ],
      },
      workspace: {
        workspaceFolders: { supported: true, changeNotifications: true },
      },
    },
  };
});

function invalidate(): void {
  if (stopping) return;
  revision++;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void current().catch((error: unknown) =>
      connection.console.error(String(error)),
    );
  }, 75);
}

// Serialize registration changes, install replacements before removing old watches.
function updateWatchers(
  roots: Set<string>,
  directories: readonly string[],
  files: Set<string>,
): void {
  if (!initialized || !canWatch) return;
  const selected = [...roots]
    .filter(
      (root) =>
        ![...roots].some((other) => root !== other && root.startsWith(other)),
    )
    .sort();
  // Watch directory entries themselves, including missing association directories.
  // Source globs alone do not observe creating or deleting an empty directory.
  const parents = [
    ...new Set([
      ...directories.map((path) => directory(pathToFileURL(path).href)),
      ...[...files]
        .filter(
          (uri) =>
            uri.startsWith("file:") &&
            (!selected.some((root) => uri.startsWith(root)) ||
              !/\.(afl|toml)$/u.test(uri)),
        )
        .map(directory),
    ]),
  ].sort();
  const key = JSON.stringify([selected, parents]);
  if (key === watchKey) return;
  watchKey = key;
  watchUpdates = watchUpdates
    .then(async () => {
      if (stopping) return;
      const next =
        selected.length || parents.length
          ? await connection.client.register(
              DidChangeWatchedFilesNotification.type,
              {
                watchers: [
                  ...selected.map((baseUri) => ({
                    globPattern: { baseUri, pattern: "{**/*.afl,**/*.toml}" },
                  })),
                  ...parents.map((baseUri) => ({
                    globPattern: { baseUri, pattern: "*" },
                  })),
                ],
              },
            )
          : undefined;
      watchRegistration?.dispose();
      watchRegistration = next;
      if (stopping) {
        next?.dispose();
        watchRegistration = undefined;
      }
    })
    .catch((error: unknown) => {
      watchKey = "";
      connection.console.error(
        "Unable to register AFL file watchers: " + String(error),
      );
    });
}

async function refresh(): Promise<void> {
  const version = revision;
  const open = documents.all().map((document) => ({
    uri: document.uri,
    languageId: document.languageId,
    text: document.getText(),
    version: document.version,
  }));
  if (
    !(await projects.refresh(
      workspaceFolders,
      open,
      () => !stopping && version === revision,
    ))
  )
    return;
  const versions = new Map(
    open.map((document) => [document.uri, document.version]),
  );
  const grouped = new Map<string, LspDiagnostic[]>();
  const roots = new Set(
    workspaceFolders.filter((uri) => uri.startsWith("file:")).map(asDirectory),
  );
  const directories = new Set<string>();
  const files = new Set<string>();
  const owners = new Map<string, Set<string>>();
  for (const context of projects.contexts)
    if (context.key.startsWith("file:")) {
      for (const document of context.sources) {
        const keys =
          owners.get(context.display(document.uri)) ?? new Set<string>();
        keys.add(context.key);
        owners.set(context.display(document.uri), keys);
      }
    }
  for (const document of open) grouped.set(document.uri, []);
  for (const context of projects.contexts) {
    context.roots.forEach((root) => roots.add(root));
    context.watched.forEach((uri) => files.add(uri));
    context.project?.watchedDirectories.forEach((path) =>
      directories.add(path),
    );
    for (const document of context.sources)
      grouped.set(
        context.display(document.uri),
        grouped.get(context.display(document.uri)) ?? [],
      );
    for (const issue of context.issues) {
      const uri = context.display(issue.uri);
      // Ordinary fallback contexts are used for queries, not duplicate project diagnostics.
      if (context.key.startsWith("document:") && owners.has(uri)) continue;
      const entries = grouped.get(uri) ?? [];
      const shared = (owners.get(uri)?.size ?? 0) > 1;
      const diagnostic: LspDiagnostic = {
        range: issue.range,
        code: issue.code,
        source: "afl",
        message: shared
          ? `[${fileURLToPath(context.key)}] ${issue.message}`
          : issue.message,
        ...(context.key.startsWith("file:")
          ? { data: { projectUri: context.key } }
          : {}),
        ...(issue.relatedInformation
          ? {
              relatedInformation: issue.relatedInformation.map((item) => ({
                ...item,
                location: context.location(item.location),
              })),
            }
          : {}),
        severity:
          issue.severity === "error"
            ? DiagnosticSeverity.Error
            : issue.severity === "warning"
              ? DiagnosticSeverity.Warning
              : DiagnosticSeverity.Information,
      };
      if (
        !entries.some(
          (entry) => JSON.stringify(entry) === JSON.stringify(diagnostic),
        )
      )
        entries.push(diagnostic);
      grouped.set(uri, entries);
    }
  }
  for (const uri of new Set([...published, ...grouped.keys()])) {
    const documentVersion = versions.get(uri);
    void connection.sendDiagnostics({
      uri,
      diagnostics: grouped.get(uri) ?? [],
      ...(documentVersion !== undefined ? { version: documentVersion } : {}),
    });
  }
  published = new Set(grouped.keys());
  applied = version;
  updateWatchers(roots, [...directories], files);
  void connection.sendNotification("afl/projectsChanged", projects.state);
}

function validSelection(value: unknown): value is ProjectSelection {
  return (
    !!value &&
    typeof value === "object" &&
    "projectUri" in value &&
    typeof value.projectUri === "string" &&
    value.projectUri.startsWith("file:") &&
    (!("preset" in value) ||
      value.preset === undefined ||
      (typeof value.preset === "string" && !!value.preset.trim()))
  );
}

/** Requests share in-flight loading and wait until the latest snapshot is indexed. */
async function current(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  while (!stopping && applied !== revision) {
    if (!pending)
      pending = refresh().finally(() => {
        pending = undefined;
      });
    await pending;
  }
}

connection.onInitialized(() => {
  initialized = true;
  if (dynamicFormatting)
    void connection.client
      .register(DocumentFormattingRequest.type, {
        documentSelector: [{ language: "afl" }],
      })
      .then((registration) => {
        formattingRegistration = registration;
        if (stopping) registration.dispose();
      })
      .catch((error: unknown) =>
        connection.console.error(
          "Unable to register AFL formatting: " + String(error),
        ),
      );
  if (canChangeFolders)
    connection.workspace.onDidChangeWorkspaceFolders((event) => {
      const removed = new Set(event.removed.map((folder) => folder.uri));
      workspaceFolders = [
        ...new Set([
          ...workspaceFolders.filter((uri) => !removed.has(uri)),
          ...event.added.map((folder) => folder.uri),
        ]),
      ];
      projects.changed();
      invalidate();
    });
  invalidate();
});
documents.onDidChangeContent(({ document }) => {
  projects.changed(document.uri);
  invalidate();
});
documents.onDidClose(({ document }) => {
  projects.changed(document.uri);
  invalidate();
});
documents.onDidSave(({ document }) => {
  projects.changed(document.uri, true);
  invalidate();
});
connection.onDidChangeWatchedFiles(() => {
  projects.changed(undefined, true);
  invalidate();
});
connection.onRequest(
  "afl/projectContext",
  async (params: { documentUri?: string } | undefined) => {
    await projects.focus(params?.documentUri);
    invalidate();
    await current();
    return projects.state;
  },
);
connection.onDocumentFormatting(({ textDocument, options }, token) => {
  const document = documents.get(textDocument.uri);
  if (!document || token.isCancellationRequested || !isAfl(document)) return [];
  const source = { uri: document.uri, text: document.getText() };
  const result = formatDocument(source, options);
  if (result.diagnostics.length || result.text === source.text) return [];
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: document.positionAt(source.text.length),
      },
      newText: result.text,
    },
  ];
});
connection.onExecuteCommand(async ({ command, arguments: args }) => {
  if (command === "afl.traceGenerated") {
    if (
      typeof args?.[0] !== "string" ||
      !args[0].startsWith("file:") ||
      !Number.isSafeInteger(args[1]) ||
      args[1] < 1 ||
      !Number.isSafeInteger(args[2]) ||
      args[2] < 1
    ) {
      throw new Error("Trace requires a file URI, positive line and column.");
    }
    await current();
    const context = projects.context(args[0]);
    if (!context.project) {
      throw new Error(
        "Select the AFL project associated with this file first.",
      );
    }
    return traceAssociations(
      context.service,
      context.canonical(args[0]),
      args[1] - 1,
    );
  }
  if (command === "afl.queryImpact") {
    if (
      typeof args?.[0] !== "string" ||
      !args[0].startsWith("file:") ||
      (args[1] !== undefined && typeof args[1] !== "string") ||
      typeof args[2] !== "string" ||
      !args[2].startsWith("file:") ||
      args.length > 3
    ) {
      throw new Error(
        "Impact requires project URI, optional preset and changed file URI.",
      );
    }
    const root = await projects.select({
      projectUri: args[0],
      ...(args[1] ? { preset: args[1] } : {}),
    });
    invalidate();
    await current();
    const context = projects.contexts.find((snapshot) => snapshot.key === root);
    if (!context?.project) {
      throw new Error("Cannot load the selected AFL project.");
    }
    return implementationImpact(context.service, context.project, [
      context.canonical(args[2]),
    ]);
  }
  let selectedProjectUri: string;
  if (command === "afl.listPresets" || command === "afl.checkPreset") {
    if (typeof args?.[0] !== "string" || !args[0].startsWith("file:"))
      throw new Error(
        "A preset command requires a project directory file URI.",
      );
    if (command === "afl.listPresets") {
      const overlays = documents
        .all()
        .filter((document) => isAfl(document) || isConfig(document))
        .map((document) => ({ uri: document.uri, text: document.getText() }));
      const project = await loadProject([fileURLToPath(args[0])], overlays, {
        presetsOnly: true,
      });
      return {
        presets: project.presets.map(({ name, uri, implementations }) => ({
          name,
          uri,
          ...(implementations ? { implementations } : {}),
        })),
        diagnostics: project.diagnostics,
      };
    }
    if (typeof args?.[1] !== "string" || !args[1].trim())
      throw new Error("A preset check requires a nonempty preset name.");
    selectedProjectUri = await projects.select({
      projectUri: args[0],
      preset: args[1],
    });
  } else if (command === "afl.checkProject") {
    await current();
    const uri = args?.[0] ?? projects.activeProject;
    if (typeof uri !== "string" || !uri.startsWith("file:"))
      throw new Error(
        "Select an AFL project containing a [project] marker before checking it.",
      );
    selectedProjectUri = await projects.select({ projectUri: uri });
  } else return null;
  invalidate();
  await current();
  return { ...projects.state, selectedProjectUri };
});
connection.onDefinition(async ({ textDocument, position }, token) => {
  await current();
  const context = projects.context(textDocument.uri);
  if (token.isCancellationRequested) return null;
  const found = context.service.definition(
    context.canonical(textDocument.uri),
    position,
  );
  return found ? context.location(found) : null;
});
connection.onImplementation(async ({ textDocument, position }, token) => {
  await current();
  const context = projects.context(textDocument.uri);
  return token.isCancellationRequested
    ? []
    : context.service
        .implementations(context.canonical(textDocument.uri), position)
        .map((item) => context.location(item));
});
connection.onReferences(
  async ({ textDocument, position, context: referenceContext }, token) => {
    await current();
    const context = projects.context(textDocument.uri);
    return token.isCancellationRequested
      ? []
      : context.service
          .references(
            context.canonical(textDocument.uri),
            position,
            referenceContext.includeDeclaration,
          )
          .map((item) => context.location(item));
  },
);
connection.onHover(async ({ textDocument, position }, token) => {
  await current();
  const context = projects.context(textDocument.uri);
  const found = token.isCancellationRequested
    ? undefined
    : context.service.hover(context.canonical(textDocument.uri), position);
  return found
    ? {
        contents: { kind: MarkupKind.PlainText, value: found.text },
        range: found.range,
      }
    : null;
});
const completionKinds: Record<Completion["kind"], CompletionItemKind> = {
  class: CompletionItemKind.Class,
  struct: CompletionItemKind.Struct,
  field: CompletionItemKind.Field,
  function: CompletionItemKind.Function,
  method: CompletionItemKind.Method,
  constant: CompletionItemKind.Constant,
  property: CompletionItemKind.Property,
  parameter: CompletionItemKind.Variable,
  variable: CompletionItemKind.Variable,
  keyword: CompletionItemKind.Keyword,
  module: CompletionItemKind.Module,
  type: CompletionItemKind.TypeParameter,
};
connection.onCompletion(async ({ textDocument, position }, token) => {
  await current();
  const context = projects.context(textDocument.uri);
  if (token.isCancellationRequested) return [];
  return context.service
    .completion(context.canonical(textDocument.uri), position)
    .map((item) => ({
      label: item.label,
      kind: completionKinds[item.kind],
      detail: item.detail,
      documentation: { kind: MarkupKind.PlainText, value: item.documentation },
      textEdit: { range: item.range, newText: item.insertText },
    }));
});
connection.onSignatureHelp(async ({ textDocument, position }, token) => {
  await current();
  const context = projects.context(textDocument.uri);
  const signature = token.isCancellationRequested
    ? undefined
    : context.service.signatureHelp(
        context.canonical(textDocument.uri),
        position,
      );
  return signature
    ? {
        signatures: [
          {
            label: signature.label,
            documentation: {
              kind: MarkupKind.PlainText,
              value: signature.documentation,
            },
            parameters: signature.parameters.map((parameter) => ({
              label: parameter.label,
              documentation: {
                kind: MarkupKind.PlainText,
                value: parameter.documentation,
              },
            })),
            ...(signature.activeParameter !== undefined
              ? { activeParameter: signature.activeParameter }
              : {}),
          },
        ],
        activeSignature: 0,
        ...(signature.activeParameter !== undefined
          ? { activeParameter: signature.activeParameter }
          : {}),
      }
    : null;
});
const symbolKinds: Record<OutlineSymbol["kind"], SymbolKind> = {
  type: SymbolKind.Enum,
  class: SymbolKind.Class,
  struct: SymbolKind.Struct,
  field: SymbolKind.Field,
  function: SymbolKind.Function,
  method: SymbolKind.Method,
  constant: SymbolKind.Constant,
  property: SymbolKind.Property,
  parameter: SymbolKind.Variable,
  variable: SymbolKind.Variable,
};
const outline = (item: OutlineSymbol): DocumentSymbol => ({
  ...item,
  kind: symbolKinds[item.kind],
  children: item.children.map(outline),
});
connection.onDocumentSymbol(async ({ textDocument }, token) => {
  await current();
  const context = projects.context(textDocument.uri);
  if (token.isCancellationRequested) return [];
  const symbols = context.service
    .documentSymbols(context.canonical(textDocument.uri))
    .map(outline);
  if (hierarchicalSymbols) return symbols;
  const flatten = (
    items: DocumentSymbol[],
    containerName?: string,
  ): SymbolInformation[] =>
    items.flatMap((item) => [
      {
        name: item.name,
        kind: item.kind,
        location: { uri: textDocument.uri, range: item.range },
        ...(containerName !== undefined ? { containerName } : {}),
      },
      ...flatten(item.children ?? [], item.name),
    ]);
  return flatten(symbols);
});
connection.onShutdown(() => {
  stopping = true;
  if (timer) clearTimeout(timer);
  watchRegistration?.dispose();
  formattingRegistration?.dispose();
});

documents.listen(connection);
connection.listen();
