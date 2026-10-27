import { parse } from "smol-toml";
import type { CheckContext, PresetContext } from "./analyzer.js";
import type { Diagnostic, SourceDocument } from "./index.js";
import type { Location } from "./editor.js";
import type { IndexedSymbol, ProjectIndex } from "./symbols.js";

export interface AssociationEntry {
  afl: string;
  file: string;
  symbol: string;
  line: number;
  endLine: number;
}
export interface NativeAssociation extends AssociationEntry {
  uri: string;
  mapUri: string;
}
export interface AssociationSet {
  preset: PresetContext;
  entries: readonly NativeAssociation[];
  documents: readonly SourceDocument[];
  testRoots?: readonly string[];
}
export interface NativeImplementation extends Location {
  afl: string;
  symbol: string;
  preset: string;
  associationUri: string;
}
export const associationIssue = (
  uri: string,
  code: string,
  message: string,
): Diagnostic => ({
  uri,
  code,
  severity: "error",
  message,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
});

/** Parse only association metadata. Native symbols and syntax remain opaque. */
export function parseAssociations(document: SourceDocument): {
  entries: AssociationEntry[];
  diagnostics: Diagnostic[];
} {
  const entries: AssociationEntry[] = [],
    diagnostics: Diagnostic[] = [];
  const fail = (message: string): void => {
    diagnostics.push(associationIssue(document.uri, "AFL4200", message));
  };
  try {
    const table = parse(document.text);
    if (
      Object.keys(table).some((key) => key !== "implementation") ||
      !Array.isArray(table.implementation)
    ) {
      fail(
        "Association files require only an implementation array (use [[implementation]] or implementation = []).",
      );
      return { entries, diagnostics };
    }
    for (const [index, value] of table.implementation.entries()) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        value instanceof Date
      ) {
        fail(`Implementation ${index + 1} must be a table.`);
        continue;
      }
      const entry = value as Record<string, unknown>;
      const endLine = entry.end_line ?? entry.line;
      if (
        Object.keys(entry).some(
          (key) => !["afl", "file", "symbol", "line", "end_line"].includes(key),
        ) ||
        typeof entry.afl !== "string" ||
        !entry.afl.startsWith("afl://") ||
        typeof entry.file !== "string" ||
        !entry.file.trim() ||
        /^(?:[\\/]|[A-Za-z]:|[a-z]+:)/u.test(entry.file) ||
        typeof entry.symbol !== "string" ||
        !entry.symbol.trim() ||
        typeof entry.line !== "number" ||
        !Number.isSafeInteger(entry.line) ||
        entry.line < 1 ||
        typeof endLine !== "number" ||
        !Number.isSafeInteger(endLine) ||
        endLine < entry.line
      ) {
        fail(
          `Implementation ${index + 1} requires afl:// address, relative file, opaque symbol, positive line and optional end_line >= line; unknown fields are not allowed.`,
        );
        continue;
      }
      entries.push({
        afl: entry.afl,
        file: entry.file,
        symbol: entry.symbol,
        line: entry.line,
        endLine,
      });
    }
  } catch (error) {
    fail(`Invalid association TOML: ${String(error)}`);
  }
  return { entries, diagnostics };
}

export function checkAssociations(
  index: ProjectIndex,
  paths: ReadonlyMap<string, IndexedSymbol>,
  context: CheckContext,
) {
  const diagnostics: Diagnostic[] = [];
  const implementations: NativeImplementation[] = [];
  const nativeProviders = new Map<string, { uri: string; name: string }[]>();
  const pathsById = new Map(
    [...paths].map(([path, symbol]) => [symbol.id, path]),
  );
  const crateOf = (symbol: IndexedSymbol): string | undefined =>
    context.crates?.find((crate) => symbol.uri.startsWith(crate.root))?.root;
  for (const set of context.associations ?? []) {
    const providers: { uri: string; name: string }[] = [];
    nativeProviders.set(set.preset.name, providers);
    const roots = new Set([...set.preset.core, ...set.preset.edge]);
    for (const root of roots) {
      const crate = context.crates?.find((item) => item.root === root);
      Object.values(crate?.dependencies ?? {}).forEach((dependency) =>
        roots.add(dependency),
      );
    }
    const selected = (symbol: IndexedSymbol): boolean =>
      roots.has(crateOf(symbol) ?? "");
    const links = new Map<string, Set<string>>();
    for (const [contract, targets] of index.implementations) {
      for (const target of targets) {
        const symbol = index.symbols.get(target)!;
        if (!set.preset.edge.includes(crateOf(symbol) ?? "")) {
          continue;
        }
        links.set(contract, new Set([...(links.get(contract) ?? []), target]));
        links.set(target, new Set([...(links.get(target) ?? []), contract]));
      }
    }
    const group = (id: string): Set<string> => {
      const ids = new Set([id]);
      for (const current of ids) {
        links.get(current)?.forEach((target) => ids.add(target));
      }
      return ids;
    };
    const snapshots = new Map(
      set.documents.map((document) => [
        document.uri,
        document.text.split(/\r\n|\r|\n/u),
      ]),
    );
    const seen = new Set<string>(),
      covered = new Set<string>();
    const registered = new Set<string>();
    for (const entry of set.entries) {
      const fail = (code: string, message: string): void => {
        diagnostics.push(
          associationIssue(
            entry.mapUri,
            code,
            `Preset '${set.preset.name}': ${message}`,
          ),
        );
      };
      const symbol = paths.get(entry.afl);
      if (!symbol) {
        fail("AFL4201", `Unknown or ambiguous AFL symbol '${entry.afl}'.`);
        continue;
      }
      // Test specifications can also have native associations; they are not implementation coverage requirements.
      if (
        !selected(symbol) &&
        !set.testRoots?.some((root) => symbol.uri.startsWith(root))
      ) {
        fail("AFL4201", `Symbol '${entry.afl}' is outside this preset.`);
        continue;
      }
      const lines = snapshots.get(entry.uri);
      if (!lines || entry.endLine > lines.length) {
        fail(
          "AFL4202",
          `Range ${entry.line}..${entry.endLine} is outside '${entry.file}'.`,
        );
        continue;
      }
      const key = JSON.stringify([
        entry.afl,
        entry.uri,
        entry.symbol,
        entry.line,
        entry.endLine,
      ]);
      if (seen.has(key)) {
        fail(
          "AFL4203",
          `Duplicate implementation association for '${entry.afl}' at '${entry.file}:${entry.line}'.`,
        );
        continue;
      }
      seen.add(key);
      const ids = group(symbol.id);
      ids.forEach((id) => covered.add(id));
      for (const id of ids) {
        const afl = pathsById.get(id);
        if (afl) {
          implementations.push({
            afl,
            uri: entry.uri,
            symbol: entry.symbol,
            preset: set.preset.name,
            associationUri: entry.mapUri,
            range: {
              start: { line: entry.line - 1, character: 0 },
              end: {
                line: entry.endLine - 1,
                character: lines[entry.endLine - 1]!.length,
              },
            },
          });
        }
      }
      const provider = symbol.parentId
        ? index.symbols.get(symbol.parentId)!
        : symbol;
      if (
        provider.external &&
        !links.has(provider.id) &&
        !registered.has(provider.id)
      ) {
        registered.add(provider.id);
        providers.push({ uri: provider.uri, name: provider.name });
      }
    }
    const unsupported = new Set<string>();
    for (const [uri, module] of index.modules) {
      if (!set.preset.edge.some((root) => uri.startsWith(root))) {
        continue;
      }
      for (const node of module.parsed.module.declarations) {
        if (node.kind !== "unsupported") {
          continue;
        }
        for (const occurrence of index.occurrences.get(uri) ?? []) {
          const target = index.symbols.get(occurrence.symbolId)!;
          if (
            occurrence.span.start >= node.start &&
            occurrence.span.end <= node.end &&
            set.preset.allowUnsupported?.some(
              (item) => item.uri === target.uri && item.name === target.name,
            )
          ) {
            unsupported.add(target.id);
          }
        }
      }
    }
    for (const symbol of index.symbols.values()) {
      if (
        symbol.local ||
        !selected(symbol) ||
        !["class", "struct", "function", "method"].includes(symbol.kind) ||
        covered.has(symbol.id) ||
        unsupported.has(symbol.id) ||
        (symbol.parentId && unsupported.has(symbol.parentId))
      ) {
        continue;
      }
      const source = index.modules.get(symbol.uri)!.source;
      diagnostics.push({
        ...associationIssue(
          symbol.uri,
          "AFL4204",
          `Preset '${set.preset.name}' has no native association for '${pathsById.get(symbol.id) ?? symbol.name}'.${pathsById.has(symbol.id) ? "" : " Give its crate a unique [crate].id."}`,
        ),
        range: {
          start: source.position(symbol.selection.start),
          end: source.position(symbol.selection.end),
        },
      });
    }
  }
  return { diagnostics, implementations, nativeProviders };
}
