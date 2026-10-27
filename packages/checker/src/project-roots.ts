import { readFile, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, TomlError } from "smol-toml";
import type { Diagnostic, SourceDocument } from "./index.js";
import { Source } from "./source.js";

export const ignoredDirectories = new Set([
  ".git",
  ".jj",
  "node_modules",
  "dist",
  "target",
]);
const missing = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

/** Canonicalize existing ancestors too, so newly created editor buffers retain identity. */
export async function canonicalPath(path: string): Promise<string> {
  path = resolve(path);
  try {
    return await realpath(path);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = dirname(path);
    return parent === path
      ? path
      : join(await canonicalPath(parent), basename(path));
  }
}

export const directoryUri = (path: string): string =>
  pathToFileURL(path.endsWith(sep) ? path : path + sep).href;
export function containsPath(root: string, path: string): boolean {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

export interface ProjectRoot {
  uri: string;
  configUri: string;
  diagnostics: Diagnostic[];
}

/** One snapshot of configuration overlays and marker reads, shared by discovery/loading. */
export class ProjectRoots {
  private readonly overlay = new Map<string, string>();
  private readonly reads = new Map<
    string,
    Promise<{
      source: Source;
      table?: Record<string, unknown>;
      absent?: boolean;
    }>
  >();

  static async create(
    overlays: readonly SourceDocument[] = [],
  ): Promise<ProjectRoots> {
    const result = new ProjectRoots();
    for (const document of overlays)
      if (
        document.uri.startsWith("file:") &&
        basename(fileURLToPath(document.uri)) === "config.toml"
      ) {
        result.overlay.set(
          await canonicalPath(fileURLToPath(document.uri)),
          document.text,
        );
      }
    return result;
  }

  private read(directory: string) {
    let promise = this.reads.get(directory);
    if (!promise) {
      promise = (async () => {
        const path = join(directory, "config.toml");
        const source = new Source({ uri: pathToFileURL(path).href, text: "" });
        try {
          const text = this.overlay.get(path) ?? (await readFile(path, "utf8"));
          const source = new Source({ uri: pathToFileURL(path).href, text });
          try {
            return { source, table: parse(text) };
          } catch (error) {
            const offset =
              error instanceof TomlError
                ? (source.lineStarts[Math.max(0, error.line - 1)] ??
                    text.length) + Math.max(0, error.column - 1)
                : 0;
            source.error("AFL4001", String(error), {
              start: offset,
              end: offset + 1,
            });
            return { source };
          }
        } catch (error) {
          if (missing(error)) return { source, absent: true };
          source.error(
            "AFL4001",
            `Cannot read project configuration: ${String(error)}`,
            { start: 0, end: 0 },
          );
          return { source };
        }
      })();
      this.reads.set(directory, promise);
    }
    return promise;
  }

  async root(
    directory: string,
    required = false,
    retainInvalid = false,
  ): Promise<ProjectRoot | undefined> {
    directory = await canonicalPath(directory);
    const { source, table, absent } = await this.read(directory);
    const marked = table !== undefined && Object.hasOwn(table, "project");
    if (!required && !marked && !(retainInvalid && !absent && !table))
      return undefined;
    const diagnostics = [...source.diagnostics];
    if (table || absent) {
      const value = table?.project;
      if (
        !marked ||
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        value instanceof Date ||
        Object.keys(value).length
      ) {
        diagnostics.push({
          uri: source.document.uri,
          code: "AFL4003",
          severity: "error",
          message: marked
            ? "The [project] marker must be an empty table."
            : "AFL project operations require an empty [project] table in the root config.toml. Add [project] to identify this project.",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        });
      }
    }
    return {
      uri: directoryUri(directory),
      configUri: source.document.uri,
      diagnostics,
    };
  }

  /** Search only supplied boundaries; never ascend or follow child directory symlinks. */
  async discover(
    boundaries: readonly string[],
    previous: readonly ProjectRoot[] = [],
  ): Promise<ProjectRoot[]> {
    const found = new Map<string, ProjectRoot>();
    const visited = new Set<string>();
    const known = new Set(previous.map((root) => root.uri));
    const walk = async (directory: string): Promise<void> => {
      if (visited.has(directory)) return;
      visited.add(directory);
      const root = await this.root(
        directory,
        false,
        known.has(directoryUri(directory)),
      );
      if (root) found.set(root.uri, root);
      let children;
      try {
        children = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (
          missing(error) ||
          (error instanceof Error && "code" in error && error.code === "EACCES")
        )
          return;
        throw error;
      }
      for (const child of children)
        if (child.isDirectory() && !ignoredDirectories.has(child.name))
          await walk(join(directory, child.name));
      // Unsaved config files can introduce a project before its directory exists on disk.
      for (const path of this.overlay.keys())
        if (containsPath(directory, path)) {
          const child = dirname(path);
          const local = relative(directory, child);
          if (!local.split(sep).some((part) => ignoredDirectories.has(part))) {
            const root = await this.root(
              child,
              false,
              known.has(directoryUri(child)),
            );
            if (root) found.set(root.uri, root);
          }
        }
    };
    for (const boundary of boundaries)
      await walk(await canonicalPath(boundary));
    return [...found.values()].sort((a, b) => a.uri.localeCompare(b.uri));
  }
}

/** Input URI must already be canonical; directory URIs include a trailing slash. */
export function owningProject(
  uri: string,
  roots: readonly ProjectRoot[],
): ProjectRoot | undefined {
  return roots
    .filter((root) => uri === root.uri.slice(0, -1) || uri.startsWith(root.uri))
    .sort((a, b) => b.uri.length - a.uri.length)[0];
}
