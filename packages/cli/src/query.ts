import { realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LanguageService,
  type Diagnostic,
  type Location,
  type OutlineSymbol,
  type SourcePosition,
} from "@afl/checker";
import { loadProject } from "@afl/checker/node";

export type QueryCommand =
  "symbols" | "definition" | "references" | "implementations";
export interface QueryOptions {
  project?: string;
  preset?: string;
  line?: string;
  column?: string;
  includeDeclaration?: boolean;
}
interface QueryLocation extends Location {
  path: string;
  symbolPath: string | null;
  /** The complete source line containing the selected identifier. */
  text: string;
}
interface QuerySymbol extends QueryLocation, Omit<OutlineSymbol, "children"> {
  children: QuerySymbol[];
}
export interface QueryResult {
  status: "complete";
  command: QueryCommand;
  scope: {
    inputs: string[];
    files: string[];
    crates: string[];
    preset: string | null;
    tests: { target: string; crates: string[] }[];
  };
  results: (QueryLocation | QuerySymbol)[];
  diagnostics: readonly Diagnostic[];
}

function coordinate(value: string | undefined, option: string): number {
  if (
    value === undefined ||
    !/^[1-9][0-9]*$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new Error(
      `${option} requires a positive integer (positions are one-based).`,
    );
  }
  return Number(value) - 1;
}

export async function queryProject(
  command: QueryCommand,
  paths: string[],
  options: QueryOptions,
): Promise<QueryResult> {
  if (options.project !== undefined && !options.project.trim())
    throw new Error("--project requires a nonempty directory path.");
  if (options.includeDeclaration !== undefined && command !== "references")
    throw new Error("--include-declaration is only valid for references.");

  let position: SourcePosition | undefined;
  let targetUri: string | undefined;
  if (command === "symbols") {
    if (options.line !== undefined || options.column !== undefined)
      throw new Error("symbols does not accept --line or --column.");
    if (options.project !== undefined && paths.length)
      throw new Error("symbols accepts paths or --project, not both.");
  } else {
    if (paths.length !== 1)
      throw new Error(
        `${command} requires exactly one .afl file and --line/--column.`,
      );
    position = {
      line: coordinate(options.line, "--line"),
      character: coordinate(options.column, "--column"),
    };
    if (options.preset !== undefined && options.project === undefined)
      throw new Error(
        "Position queries with --preset require --project <directory>.",
      );
    const target = await realpath(resolve(paths[0]!));
    if (extname(target) !== ".afl" || !(await stat(target)).isFile())
      throw new Error(`Expected an .afl file: ${paths[0]}`);
    targetUri = pathToFileURL(target).href;
  }
  if (
    options.project !== undefined &&
    !(await stat(resolve(options.project))).isDirectory()
  ) {
    throw new Error("--project requires a directory.");
  }
  const inputs = (
    options.project !== undefined
      ? [options.project]
      : paths.length
        ? paths
        : ["."]
  ).map((path) => resolve(path));
  const project = await loadProject(inputs, [], {
    ...(options.preset === undefined ? {} : { preset: options.preset }),
    ...(options.project === undefined ? {} : { project: true }),
  });
  const service = new LanguageService();
  service.update(project.documents, project);
  const diagnostics = service.diagnostics;
  // Query the same snapshots that were indexed; never reread source for snippets.
  const lines = new Map(
    [...project.documents, ...project.nativeDocuments].map((document) => [
      document.uri,
      document.text.split(/\r\n|\r|\n/u),
    ]),
  );
  const location = (item: Location): QueryLocation => ({
    ...item,
    path: fileURLToPath(item.uri),
    symbolPath: service.symbolPath(item.uri, item.range.start) ?? null,
    text: lines.get(item.uri)?.[item.range.start.line] ?? "",
  });
  const outline = (uri: string, item: OutlineSymbol): QuerySymbol => ({
    ...location({ uri, range: item.selectionRange }),
    ...item,
    children: item.children.map((child) => outline(uri, child)),
  });

  let results: QueryResult["results"] = [];
  if (command === "symbols") {
    results = project.documents.flatMap((document) =>
      service
        .documentSymbols(document.uri)
        .map((item) => outline(document.uri, item)),
    );
  } else {
    const sourceLines = lines.get(targetUri!);
    if (!sourceLines) {
      // A failed preset/configuration can leave the source set incomplete. Keep
      // its diagnostics instead of turning it into a successful empty query.
      if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new Error(
          "The query file is outside the selected project/preset source set.",
        );
      }
    } else {
      const line = sourceLines[position!.line];
      if (line === undefined || position!.character > line.length)
        throw new Error(
          "The query position is outside the file (columns count UTF-16 code units).",
        );
      if (command === "definition") {
        const found = service.definition(targetUri!, position!);
        results = found ? [location(found)] : [];
      } else if (command === "references") {
        results = service
          .references(
            targetUri!,
            position!,
            options.includeDeclaration ?? false,
          )
          .map(location);
      } else {
        results = service.implementations(targetUri!, position!).map(location);
      }
    }
  }
  return {
    status: "complete",
    command,
    scope: {
      inputs,
      files: project.documents.map((document) => fileURLToPath(document.uri)),
      crates: project.crates.map((crate) => fileURLToPath(crate.root)).sort(),
      preset: options.preset ?? null,
      tests: project.tests.map((test) => ({
        target: fileURLToPath(test.target),
        crates: test.crates.map((uri) => fileURLToPath(uri)),
      })),
    },
    results,
    diagnostics,
  };
}

export function formatQuery(result: QueryResult): string {
  const scope = `Scope: ${result.scope.files.length} files in ${result.scope.crates.length} crates; preset: ${result.scope.preset ?? "none"}`;
  const lines = [scope, ...result.scope.inputs.map((path) => `  ${path}`)];
  const append = (item: QueryLocation | QuerySymbol, indent = ""): void => {
    const start =
      "selectionRange" in item ? item.selectionRange.start : item.range.start;
    lines.push(
      `${indent}${item.path}:${start.line + 1}:${start.character + 1} ${"name" in item ? item.detail : item.text.trim()}`,
    );
    if ("children" in item)
      item.children.forEach((child) => append(child, indent + "  "));
  };
  result.results.forEach((item) => append(item));
  if (!result.results.length) lines.push("No results in this scope.");
  return lines.join("\n") + "\n";
}
