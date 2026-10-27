import type * as AST from "./ast.js";
import type { CheckResult, SourceDocument, SourcePosition } from "./index.js";
import { analyzeProject, type CheckContext } from "./analyzer.js";
import { parseDocument, type ParseResult } from "./parser.js";
import { builtinFunctions } from "./builtins.js";
import {
  ProjectIndex,
  primitive,
  collections,
  identifier,
  type IndexedSymbol,
  type SymbolKind,
} from "./symbols.js";
import {
  checkAssociations,
  type NativeImplementation,
} from "./associations.js";
import { symbolPath, resolveSymbolPath } from "./symbol-path.js";

export interface Range {
  start: SourcePosition;
  end: SourcePosition;
}
export interface Location {
  uri: string;
  range: Range;
}
export interface Completion {
  label: string;
  kind: SymbolKind | "keyword" | "module" | "type";
  detail: string;
  documentation: string;
  insertText: string;
  range: Range;
}
export interface Hover {
  text: string;
  range: Range;
}
export interface Signature {
  label: string;
  documentation: string;
  parameters: { label: string; documentation: string }[];
  activeParameter?: number;
}
export interface OutlineSymbol {
  name: string;
  detail: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children: OutlineSymbol[];
}
const contains = (span: AST.Span, offset: number): boolean =>
  span.start <= offset && offset <= span.end;

/** Cached source snapshots and a shared declaration/reference index; no host I/O. */
export class LanguageService {
  private cache = new Map<string, { text: string; parsed: ParseResult }>();
  private context: CheckContext = {};
  private contextKey = "";
  private index = new ProjectIndex();
  private symbolPaths = new Map<string, IndexedSymbol>();
  private pathsById = new Map<string, string>();
  private native: NativeImplementation[] = [];
  private result: CheckResult = { status: "complete", diagnostics: [] };

  get diagnostics(): CheckResult["diagnostics"] {
    return this.result.diagnostics;
  }
  getModule(uri: string): AST.Module | undefined {
    return this.cache.get(uri)?.parsed.module;
  }
  getSource(uri: string): SourceDocument | undefined {
    const cached = this.cache.get(uri);
    return cached ? { uri, text: cached.text } : undefined;
  }

  update(
    documents: readonly SourceDocument[],
    context: CheckContext = {},
  ): boolean {
    const contextKey = JSON.stringify({
      crates: context.crates,
      diagnostics: context.diagnostics,
      preset: context.preset,
      associations: context.associations,
      nativeImplementations: context.nativeImplementations,
    });
    const uris = new Set(documents.map((document) => document.uri));
    let changed =
      contextKey !== this.contextKey || uris.size !== this.cache.size;
    for (const uri of this.cache.keys())
      if (!uris.has(uri)) {
        this.cache.delete(uri);
        changed = true;
      }
    for (const document of documents) {
      if (this.cache.get(document.uri)?.text !== document.text) {
        this.cache.set(document.uri, {
          text: document.text,
          parsed: parseDocument(document),
        });
        changed = true;
      }
    }
    if (!changed) return false;
    this.context = context;
    this.contextKey = contextKey;
    this.index = new ProjectIndex();
    this.result = analyzeProject(
      documents,
      {
        ...context,
        deferNativeCoverage: Boolean(context.associations?.length),
      },
      {
        index: this.index,
        parse: (document) => this.cache.get(document.uri)!.parsed,
      },
    );
    this.symbolPaths.clear();
    this.pathsById.clear();
    const ambiguous = new Set<string>();
    for (const symbol of this.index.symbols.values()) {
      if (
        symbol.local ||
        symbol.kind === "parameter" ||
        symbol.kind === "variable"
      )
        continue;
      const crate = context.crates?.find((item) =>
        symbol.uri.startsWith(item.root),
      );
      if (!crate) continue;
      const owner = symbol.parentId && this.index.symbols.get(symbol.parentId);
      const path = symbolPath(
        crate,
        symbol.uri,
        owner ? `${owner.name}.${symbol.name}` : symbol.name,
      );
      if (!path || ambiguous.has(path)) continue;
      const previous = this.symbolPaths.get(path);
      if (previous) {
        this.symbolPaths.delete(path);
        this.pathsById.delete(previous.id);
        ambiguous.add(path);
      } else {
        this.symbolPaths.set(path, symbol);
        this.pathsById.set(symbol.id, path);
      }
    }
    const associations = checkAssociations(
      this.index,
      this.symbolPaths,
      context,
    );
    this.native = associations.implementations;
    const issues = [...this.result.diagnostics, ...associations.diagnostics];
    for (const set of context.associations ?? []) {
      const checked = analyzeProject(
        documents,
        {
          ...context,
          diagnostics: [],
          preset: set.preset,
          nativeImplementations:
            associations.nativeProviders.get(set.preset.name) ?? [],
        },
        { parse: (document) => this.cache.get(document.uri)!.parsed },
      );
      issues.push(...checked.diagnostics);
    }
    this.result = {
      status: "complete",
      diagnostics: [
        ...new Map(
          issues.map((issue) => [JSON.stringify(issue), issue]),
        ).values(),
      ],
    };
    return true;
  }

  /** Stable declaration address at a declaration or reference; locals have snapshot identity only. */
  symbolPath(uri: string, position: SourcePosition): string | undefined {
    const occurrence = this.occurrence(uri, position);
    return occurrence && this.pathsById.get(occurrence.symbolId);
  }

  /** Find a declaration by its stable address or a crate-relative logical path. */
  resolveSymbol(path: string, fromCrate?: string): Location | undefined {
    const crates = this.context.crates ?? [];
    const target = resolveSymbolPath(path, crates, fromCrate);
    const crate =
      target && crates.find((item) => target.uri.startsWith(item.root));
    const canonical =
      target && crate && symbolPath(crate, target.uri, target.name);
    const symbol = canonical && this.symbolPaths.get(canonical);
    return symbol
      ? { uri: symbol.uri, range: this.range(symbol.uri, symbol.selection) }
      : undefined;
  }

  private range(uri: string, span: AST.Span): Range {
    const source = this.index.modules.get(uri)!.source;
    return {
      start: source.position(span.start),
      end: source.position(span.end),
    };
  }
  private opaque(uri: string, offset: number): boolean {
    return (
      this.cache
        .get(uri)
        ?.parsed.opaqueSpans.some(
          (span) =>
            (span.start < offset && offset < span.end) ||
            (offset === span.end &&
              span.end === this.cache.get(uri)!.text.length),
        ) ?? false
    );
  }
  private occurrence(uri: string, position: SourcePosition) {
    const module = this.index.modules.get(uri);
    if (!module) return undefined;
    const offset = module.source.offset(position);
    const entries = this.index.occurrences.get(uri) ?? [];
    let low = 0,
      high = entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (entries[middle]!.span.start <= offset) low = middle + 1;
      else high = middle;
    }
    const found = entries[low - 1];
    return found && contains(found.span, offset) ? found : undefined;
  }

  definition(uri: string, position: SourcePosition): Location | undefined {
    const occurrence = this.occurrence(uri, position);
    const symbol = occurrence && this.index.symbols.get(occurrence.symbolId);
    return symbol
      ? { uri: symbol.uri, range: this.range(symbol.uri, symbol.selection) }
      : undefined;
  }

  implementations(uri: string, position: SourcePosition): Location[] {
    const occurrence = this.occurrence(uri, position);
    const ids =
      occurrence && this.index.implementations.get(occurrence.symbolId);
    const locations = [...(ids ?? [])].flatMap((id) => {
      const symbol = this.index.symbols.get(id);
      return symbol
        ? [{ uri: symbol.uri, range: this.range(symbol.uri, symbol.selection) }]
        : [];
    });
    const path = occurrence && this.pathsById.get(occurrence.symbolId);
    locations.push(...this.native.filter((item) => item.afl === path));
    return [
      ...new Map(
        locations.map((item) => [JSON.stringify([item.uri, item.range]), item]),
      ).values(),
    ].sort(
      (a, b) =>
        a.uri.localeCompare(b.uri) || a.range.start.line - b.range.start.line,
    );
  }

  get nativeImplementations(): readonly NativeImplementation[] {
    return this.native;
  }

  /** Reverse lookup of saved/overlaid associations, with no native parsing. */
  trace(
    uri: string,
    line?: number,
  ): { implementation: NativeImplementation; declaration: Location }[] {
    return this.native
      .filter(
        (item) =>
          item.uri === uri &&
          (line === undefined ||
            (item.range.start.line <= line && line <= item.range.end.line)),
      )
      .flatMap((implementation) => {
        const declaration = this.resolveSymbol(implementation.afl);
        return declaration ? [{ implementation, declaration }] : [];
      });
  }

  /** Current AFL reference graph only; changed native files seed their associated AFL symbols. */
  impact(changedUris: readonly string[]) {
    const changed = new Set(changedUris),
      affected = new Set<string>();
    for (const symbol of this.symbolPaths.values()) {
      if (changed.has(symbol.uri)) {
        affected.add(symbol.id);
      }
    }
    for (const item of this.native) {
      if (changed.has(item.uri) || changed.has(item.associationUri)) {
        const symbol = this.symbolPaths.get(item.afl);
        if (symbol) {
          affected.add(symbol.id);
        }
      }
    }
    const dependents = new Map<string, Set<string>>();
    const add = (dependency: string, dependent: string): void => {
      const entries = dependents.get(dependency) ?? new Set<string>();
      entries.add(dependent);
      dependents.set(dependency, entries);
    };
    for (const [uri, occurrences] of this.index.occurrences) {
      const owners = [...this.symbolPaths.values()]
        .filter((symbol) => symbol.uri === uri)
        .sort(
          (a, b) => a.span.end - a.span.start - (b.span.end - b.span.start),
        );
      for (const occurrence of occurrences) {
        if (occurrence.declaration) {
          continue;
        }
        const owner = owners.find(
          (symbol) =>
            symbol.span.start <= occurrence.span.start &&
            occurrence.span.end <= symbol.span.end,
        );
        if (owner) {
          add(occurrence.symbolId, owner.id);
        }
      }
    }
    for (const symbol of this.symbolPaths.values()) {
      if (symbol.parentId) {
        add(symbol.id, symbol.parentId);
        add(symbol.parentId, symbol.id);
      }
    }
    for (const [contract, targets] of this.index.implementations) {
      for (const target of targets) {
        add(contract, target);
        add(target, contract);
      }
    }
    for (const id of affected) {
      dependents.get(id)?.forEach((dependent) => affected.add(dependent));
    }
    const declarations = [...this.symbolPaths]
      .filter(([, symbol]) => affected.has(symbol.id))
      .map(([afl, symbol]) => ({
        afl,
        uri: symbol.uri,
        range: this.range(symbol.uri, symbol.selection),
      }));
    const paths = new Set(declarations.map((item) => item.afl));
    return {
      declarations,
      implementations: this.native.filter((item) => paths.has(item.afl)),
      unassociated: changedUris.filter(
        (uri) =>
          !declarations.some((item) => item.uri === uri) &&
          !this.native.some(
            (item) => item.uri === uri || item.associationUri === uri,
          ),
      ),
    };
  }

  references(
    uri: string,
    position: SourcePosition,
    includeDeclaration = true,
  ): Location[] {
    const found = this.occurrence(uri, position);
    const entries = found
      ? (this.index.references.get(found.symbolId) ?? [])
      : [];
    const unique = new Map<string, Location>();
    for (const occurrence of entries) {
      if (!includeDeclaration && occurrence.declaration) continue;
      unique.set(
        occurrence.uri +
          "#" +
          occurrence.span.start +
          ":" +
          occurrence.span.end,
        {
          uri: occurrence.uri,
          range: this.range(occurrence.uri, occurrence.span),
        },
      );
    }
    return [...unique.values()].sort(
      (a, b) =>
        a.uri.localeCompare(b.uri) ||
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
    );
  }

  hover(uri: string, position: SourcePosition): Hover | undefined {
    const occurrence = this.occurrence(uri, position);
    const symbol = occurrence && this.index.symbols.get(occurrence.symbolId);
    if (symbol && occurrence)
      return {
        text:
          symbol.detail +
          (symbol.documentation ? "\n\n" + symbol.documentation : ""),
        range: this.range(uri, occurrence.span),
      };
    const module = this.index.modules.get(uri);
    const offset = module?.source.offset(position);
    const builtin =
      offset === undefined
        ? undefined
        : this.index.builtinOccurrences
            .get(uri)
            ?.find((item) => contains(item.span, offset));
    return builtin
      ? {
          text:
            builtin.label +
            "\n\n" +
            (builtin.documentation ?? "Built-in AFL type."),
          range: this.range(uri, builtin.span),
        }
      : undefined;
  }

  completion(uri: string, position: SourcePosition): Completion[] {
    const module = this.index.modules.get(uri);
    if (!module) return [];
    const text = module.source.document.text,
      offset = module.source.offset(position);
    const link = module.parsed.descriptionLinks.find(
      (item) => item.content.start <= offset && offset <= item.content.end,
    );
    if (this.opaque(uri, offset) && !link) return [];
    let start = offset,
      end = offset;
    while (start > 0 && /[A-Za-z_0-9]/u.test(text[start - 1]!)) start--;
    while (end < text.length && /[A-Za-z_0-9]/u.test(text[end]!)) end++;
    if (text[start - 1] === String.fromCharCode(96)) start--;
    if (text[end] === String.fromCharCode(96)) end++;
    const prefix = text
      .slice(start, offset)
      .replaceAll(String.fromCharCode(96), "");
    const range = this.range(uri, { start, end });
    const candidates = new Map<string, Completion>();
    const add = (
      label: string,
      kind: Completion["kind"],
      detail = "",
      docs = "",
      insertText = identifier(label),
    ): void => {
      if (label.startsWith(prefix) && !candidates.has(label))
        candidates.set(label, {
          label,
          kind,
          detail,
          documentation: docs,
          insertText,
          range,
        });
    };
    const addSymbol = (name: string, id: string): void => {
      const symbol = this.index.symbols.get(id);
      if (symbol) add(name, symbol.kind, symbol.detail, symbol.documentation);
    };
    const before = text.slice(0, start);
    const line = text.slice(
      module.source.lineStarts[position.line] ?? 0,
      offset,
    );
    const linkPrefix = link
      ? text.slice(link.content.start, offset).trimStart()
      : undefined;
    const group = module.parsed.importGroups.find(
      (item) => item.content.start <= offset && offset <= item.content.end,
    );
    const groupItem = group
      ? text.slice(group.content.start, offset).split(",").at(-1)!.trimStart()
      : undefined;
    if (groupItem && /\bas\s/u.test(groupItem)) return [];
    const imported = group
      ? [
          "",
          "use",
          group.path
            .map((part) => (part.escaped ? identifier(part.text) : part.text))
            .join("::") +
            "::" +
            groupItem,
        ]
      : linkPrefix?.includes("::") && !linkPrefix.includes(".")
        ? ["", "link", linkPrefix.replace(/[ \t]/gu, "")]
        : link
          ? null
          : /^\s*(use|impl|unsupported)\s+([A-Za-z_0-9:\u0060]*)$/u.exec(line);
    if (imported) {
      const raw = imported[2]!.split("::");
      raw.pop();
      const parts = raw.map((part) =>
        part.replaceAll(String.fromCharCode(96), ""),
      );
      const crate = this.context.crates?.find((crate) =>
        uri.startsWith(crate.root),
      );
      let base: string;
      try {
        base = new URL(".", uri).href;
      } catch {
        return [];
      }
      if (!parts.length) {
        add("crate", "keyword", "Current crate root", "", "crate::");
        add("dep", "keyword", "Configured dependency", "", "dep::");
      }
      if (parts[0] === "crate" && raw[0] === "crate") {
        if (!crate) return [];
        base = crate.root;
        parts.shift();
      } else if (parts[0] === "dep" && raw[0] === "dep") {
        parts.shift();
        if (!parts.length) {
          for (const name of Object.keys(crate?.dependencies ?? {}))
            add(
              name,
              "module",
              "Configured dependency",
              "",
              identifier(name) + "::",
            );
          return [...candidates.values()];
        }
        const dependency = parts.shift()!;
        const dependencyRoot = crate?.dependencies[dependency];
        if (!dependencyRoot) return [];
        base = dependencyRoot;
      }
      for (const [targetUri, target] of this.index.modules) {
        if (!targetUri.startsWith(base) || !targetUri.endsWith(".afl"))
          continue;
        const path = targetUri
          .slice(base.length, -4)
          .split("/")
          .map(decodeURIComponent);
        if (parts.some((part, index) => path[index] !== part)) continue;
        if (path.length > parts.length) {
          const name = path[parts.length]!;
          if (/^[A-Za-z_][A-Za-z_0-9]*$/u.test(name))
            add(name, "module", "AFL module path");
        } else
          for (const [name, id] of target.exports) {
            if (
              ["impl", "unsupported"].includes(imported[1]!) &&
              !target.parsed.module.declarations.some(
                (item) =>
                  (item.kind === "class" ||
                    item.kind === "struct" ||
                    item.kind === "function") &&
                  item.name.text === name &&
                  item.external,
              )
            )
              continue;
            addSymbol(name, id);
          }
      }
    } else if (/\.[ \t]*$/u.test(before)) {
      const dot = before.lastIndexOf(".");
      const receiver = [...(this.index.values.get(uri) ?? [])]
        .reverse()
        .find(
          (value) =>
            value.span.end <= dot &&
            text.slice(value.span.end, dot).trim() === "",
        );
      for (const method of receiver?.type?.methods ?? []) {
        add(
          method.name,
          "method",
          method.signature.label,
          method.signature.documentation,
        );
      }
      const objectId = receiver?.type?.classId ?? receiver?.type?.structId;
      const members = objectId ? this.index.members.get(objectId) : undefined;
      for (const [name, id] of members ?? []) {
        // Non-identifier protocol keys are initialized with string keys and
        // manipulated through descriptions, not through new access syntax.
        if (
          !link &&
          Boolean(this.index.symbols.get(id)?.static) !==
            Boolean(receiver?.type?.typeReceiver)
        )
          continue;
        if (/^[A-Za-z_][A-Za-z_0-9]*$/u.test(name)) addSymbol(name, id);
      }
    } else {
      const scopes = (this.index.scopes.get(uri) ?? [])
        .filter(
          (scope) =>
            scope.span.start <= offset &&
            (offset < scope.span.end ||
              (offset === text.length &&
                scope.span.end === offset &&
                text[offset - 1] !== "}")),
          // A lone declaration can share the module's exact span; inner scopes
          // are registered later and must win that tie (including in its docs).
        )
        .reverse()
        .sort((a, b) => b.span.start - a.span.start || a.span.end - b.span.end);
      let scope = scopes[0] ?? module.scope;
      while (scope) {
        for (const [name, binding] of scope.bindings)
          if (binding.availableAfter <= offset)
            addSymbol(name, binding.symbolId);
        if (!scope.parent) break;
        scope = scope.parent;
      }
      for (const [name, builtin] of builtinFunctions)
        add(
          name,
          "function",
          builtin.signature.label,
          builtin.signature.documentation,
        );
      for (const name of [...primitive, ...collections.keys()])
        add(name, "type", "Built-in AFL type");
      if (link) {
        add("crate", "keyword", "Current crate root", "", "crate::");
        add("dep", "keyword", "Configured dependency", "", "dep::");
        try {
          const base = new URL(".", uri).href;
          for (const target of this.index.modules.keys()) {
            if (!target.startsWith(base) || !target.endsWith(".afl")) continue;
            const name = decodeURIComponent(
              target.slice(base.length, -4).split("/")[0]!,
            );
            if (/^[A-Za-z_][A-Za-z_0-9]*$/u.test(name))
              add(name, "module", "AFL module path");
          }
        } catch {
          /* Untitled documents have no relative module root. */
        }
      } else
        for (const name of [
          "const",
          "static",
          "fn",
          "class",
          "struct",
          "type",
          "extern",
          "use",
          "impl",
          "unsupported",
          "if",
          "else",
          "when",
          "while",
          "for",
          "in",
          "return",
          "break",
          "continue",
          "true",
          "false",
          "null",
        ])
          add(name, "keyword", "", "", name);
    }
    return [...candidates.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  signatureHelp(uri: string, position: SourcePosition): Signature | undefined {
    const module = this.index.modules.get(uri);
    if (!module) return undefined;
    const text = module.source.document.text,
      offset = module.source.offset(position);
    const call = (this.index.calls.get(uri) ?? [])
      .filter(
        (call) =>
          call.open < offset &&
          offset <= call.span.end &&
          (offset < call.span.end || text[call.span.end - 1] !== ")"),
      )
      .sort((a, b) => b.open - a.open)[0];
    const symbol = call?.symbolId
      ? this.index.symbols.get(call.symbolId)
      : undefined;
    const signature =
      call?.signature ??
      (symbol?.parameters
        ? {
            label: symbol.detail,
            documentation: symbol.documentation,
            parameters: symbol.parameters,
          }
        : undefined);
    if (!call || !signature) return undefined;
    let parameter = 0,
      depth = 0;
    const opaque = module.parsed.opaqueSpans;
    for (let cursor = call.open + 1; cursor < offset; cursor++) {
      const region = opaque.find((span) => span.start === cursor);
      if (region) {
        cursor = region.end - 1;
        continue;
      }
      const char = text[cursor]!;
      if ("({[".includes(char)) depth++;
      else if (")}]".includes(char)) depth--;
      else if (char === "," && depth === 0) parameter++;
    }
    return {
      ...signature,
      ...(signature.parameters.length
        ? {
            activeParameter: Math.min(
              parameter,
              signature.parameters.length - 1,
            ),
          }
        : {}),
    };
  }

  documentSymbols(uri: string): OutlineSymbol[] {
    const entries = [...this.index.symbols.values()].filter(
      (symbol) =>
        symbol.uri === uri &&
        !symbol.local &&
        !["parameter", "variable"].includes(symbol.kind),
    );
    const convert = (symbol: IndexedSymbol): OutlineSymbol => ({
      name: symbol.name,
      detail: symbol.detail,
      kind: symbol.kind,
      range: this.range(uri, symbol.span),
      selectionRange: this.range(uri, symbol.selection),
      children: entries
        .filter((entry) => entry.parentId === symbol.id)
        .map(convert),
    });
    return entries.filter((entry) => !entry.parentId).map(convert);
  }
}
