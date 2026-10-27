import { lstat, readFile, readdir, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, TomlError } from "smol-toml";
import type { CheckContext, CrateContext, PresetContext } from "./analyzer.js";
import type { Diagnostic, SourceDocument } from "./index.js";
import { parseAssociations, type AssociationSet } from "./associations.js";
import { Source } from "./source.js";
import { crateIdPattern } from "./symbol-path.js";
import {
  ProjectRoots,
  canonicalPath as canonical,
  directoryUri as rootUri,
  ignoredDirectories,
} from "./project-roots.js";
export { identity, readRegularFile } from "./files.js";
export {
  ProjectRoots,
  canonicalPath,
  containsPath,
  directoryUri,
  ignoredDirectories,
  owningProject,
  type ProjectRoot,
} from "./project-roots.js";

export interface TestAssociation {
  /** Canonical directory URI of the crate whose requirements are described. */
  target: string;
  /** Canonical directory URIs of its directly associated test specification crates. */
  crates: string[];
}
export interface LoadedProject extends CheckContext {
  documents: SourceDocument[];
  associations: AssociationSet[];
  nativeDocuments: SourceDocument[];
  crates: CrateContext[];
  diagnostics: Diagnostic[];
  /** Includes configs and missing files, so hosts can refresh when they change. */
  watchedFiles: string[];
  /** Canonical source URI to editor URI, preserving editors opened via aliases. */
  displayUris: Record<string, string>;
  presets: PresetContext[];
  watchedDirectories: string[];
  tests: TestAssociation[];
}
export interface LoadOptions {
  preset?: string;
  presetsOnly?: boolean;
  project?: boolean;
  /** Known canonical project directory URIs retain nested boundaries during incomplete edits. */
  projectRoots?: readonly string[];
}
const uri = (path: string): string => pathToFileURL(path).href;
const missing = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

/** Load selected crates, their test specifications and dependencies, with editor overlays. */
export async function loadProject(
  inputs: readonly string[],
  overlays: readonly SourceDocument[] = [],
  options: LoadOptions = {},
): Promise<LoadedProject> {
  const overlay = new Map<string, string>();
  const displayUris: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const document of overlays) {
    if (document.uri.startsWith("file:")) {
      const path = await canonical(fileURLToPath(document.uri));
      overlay.set(path, document.text);
      displayUris[uri(path)] = document.uri;
    }
  }
  const watched = new Set<string>();
  const watchedDirectories = new Set<string>();
  const presets: PresetContext[] = [];
  let preset: PresetContext | undefined;
  const documents = new Map<string, SourceDocument>();
  const crates = new Map<string, CrateContext>();
  const configs = new Map<string, { source: Source; test: unknown }>();
  const selectedCrates = new Set<string>();
  const tests: TestAssociation[] = [];
  const diagnostics: Diagnostic[] = [];
  const projectRoots = await ProjectRoots.create(overlays);
  const projectOperation =
    options.project || options.preset !== undefined || options.presetsOnly;
  let invalidProject = false;
  if (projectOperation) {
    if (inputs.length !== 1)
      throw new Error(
        "Project operations require exactly one project directory.",
      );
    const directory = await canonical(resolve(inputs[0]!));
    if (!(await stat(directory)).isDirectory())
      throw new Error("Project operations require a project directory.");
    const root = (await projectRoots.root(directory, true))!;
    watched.add(join(directory, "config.toml"));
    watchedDirectories.add(directory);
    diagnostics.push(...root.diagnostics);
    invalidProject = root.diagnostics.length > 0;
  }
  const visiting = new Set<string>();
  const rootCache = new Map<string, Promise<string | undefined>>();

  async function isFile(path: string): Promise<boolean> {
    if (overlay.has(path)) return true;
    try {
      return (await lstat(path)).isFile();
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  async function read(path: string): Promise<string> {
    watched.add(path);
    return overlay.get(path) ?? (await readFile(path, "utf8"));
  }
  function issue(path: string, code: string, message: string): void {
    diagnostics.push({
      uri: uri(path),
      code,
      severity: "error",
      message,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    });
  }
  function rootOf(directory: string): Promise<string | undefined> {
    const cached = rootCache.get(directory);
    if (cached) return cached;
    const result = (async () => {
      const parent = dirname(directory);
      const ancestor = parent === directory ? undefined : await rootOf(parent);
      if (ancestor) return ancestor;
      const entries = await Promise.all([
        isFile(join(directory, "main.afl")),
        isFile(join(directory, "lib.afl")),
      ]);
      return entries.some(Boolean) ? directory : undefined;
    })();
    rootCache.set(directory, result);
    return result;
  }
  async function scan(
    directory: string,
    projectBoundary = false,
  ): Promise<Set<string>> {
    const paths = new Set<string>();
    async function walk(current: string): Promise<void> {
      if (
        projectBoundary &&
        current !== directory &&
        (options.projectRoots?.includes(rootUri(current)) ||
          (await projectRoots.root(current)))
      )
        return;
      let children;
      try {
        children = await readdir(current, { withFileTypes: true });
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      for (const child of children) {
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory() && !ignoredDirectories.has(child.name))
          await walk(join(current, child.name));
        else if (child.isFile() && extname(child.name) === ".afl")
          paths.add(join(current, child.name));
      }
    }
    await walk(directory);
    for (const path of overlay.keys()) {
      const local = relative(directory, path);
      if (
        local &&
        !local.startsWith(`..${sep}`) &&
        local !== ".." &&
        extname(path) === ".afl" &&
        !local
          .split(sep)
          .slice(0, -1)
          .some((part) => ignoredDirectories.has(part))
      ) {
        let nested = false;
        if (projectBoundary)
          for (
            let parent = dirname(path);
            parent !== directory;
            parent = dirname(parent)
          ) {
            if (
              options.projectRoots?.includes(rootUri(parent)) ||
              (await projectRoots.root(parent))
            ) {
              nested = true;
              break;
            }
          }
        if (!nested) paths.add(path);
      }
    }
    return paths;
  }
  async function addDocument(path: string): Promise<void> {
    if (!documents.has(path))
      documents.set(path, { uri: uri(path), text: await read(path) });
  }
  async function addCrateDocument(
    path: string,
    directory: string,
  ): Promise<void> {
    await addDocument(path);
    if (
      ["main.afl", "lib.afl"].includes(basename(path)) &&
      dirname(path) !== directory
    ) {
      issue(
        path,
        "AFL3000",
        "Nested crates are not allowed: an entry file exists below the crate root.",
      );
    }
  }

  async function loadCrate(directory: string, chain: string[]): Promise<void> {
    if (crates.has(directory)) return;
    const [main, lib] = await Promise.all([
      isFile(join(directory, "main.afl")),
      isFile(join(directory, "lib.afl")),
    ]);
    const configPath = join(directory, "config.toml");
    const dependencyRoots: Record<string, string> = Object.create(
      null,
    ) as Record<string, string>;
    const crate: CrateContext = {
      root: rootUri(directory),
      kind: main && lib ? "invalid" : main ? "binary" : "library",
      dependencies: dependencyRoots,
    };
    crates.set(directory, crate);
    visiting.add(directory);
    if (main && lib)
      issue(
        join(directory, "main.afl"),
        "AFL3000",
        "A crate cannot contain both main.afl and lib.afl.",
      );
    for (const path of await scan(directory))
      await addCrateDocument(path, directory);
    let config: Source | undefined;
    let table: Record<string, unknown>;
    try {
      config = new Source({
        uri: uri(configPath),
        text: await read(configPath),
      });
      table = parse(config.document.text);
    } catch (error) {
      if (missing(error))
        issue(
          configPath,
          "AFL3001",
          "Each crate requires a config.toml at its root.",
        );
      else if (error instanceof TomlError && config) {
        const start =
          (config.lineStarts[Math.max(0, error.line - 1)] ??
            config.document.text.length) + Math.max(0, error.column - 1);
        config.error("AFL3001", error.message, { start, end: start + 1 });
        diagnostics.push(...config.diagnostics);
      } else throw error;
      visiting.delete(directory);
      return;
    }
    configs.set(directory, { source: config, test: table.test });
    const dependencyError = (
      name: string,
      message: string,
      code = "AFL3002",
    ): void => {
      const offset = Math.max(0, config.document.text.indexOf(name));
      config.error(code, message, { start: offset, end: offset + name.length });
    };
    if (table.res !== undefined) {
      dependencyError(
        "res",
        "The [res] section has been removed. Keep resources and native project files in their own projects.",
        "AFL3001",
      );
    }
    if (table.crate !== undefined) {
      const identity = table.crate;
      if (
        !tableValue(identity) ||
        Object.keys(identity).some((key) => key !== "id") ||
        typeof identity.id !== "string" ||
        !crateIdPattern.test(identity.id)
      ) {
        dependencyError(
          "crate",
          "The [crate] table requires only id: a lowercase letter followed by lowercase letters, digits, underscores or hyphens.",
          "AFL3001",
        );
      } else crate.id = identity.id;
    }
    if (table.codegen !== undefined) {
      dependencyError(
        "codegen",
        "Code generation has been removed. Replace [codegen] with preset implementations association files; maintain native code directly.",
        "AFL3001",
      );
    }
    const dependencies = table.dep ?? {};
    if (
      !dependencies ||
      typeof dependencies !== "object" ||
      Array.isArray(dependencies) ||
      dependencies instanceof Date
    ) {
      dependencyError(
        "dep",
        "The [dep] configuration must be a table of name = directory entries.",
        "AFL3001",
      );
    } else {
      for (const [name, target] of Object.entries(dependencies)) {
        if (
          !/^[A-Za-z_][A-Za-z_0-9]*$/u.test(name) ||
          typeof target !== "string" ||
          !target.trim()
        ) {
          dependencyError(
            name,
            "Dependencies require identifier names and nonempty directory strings.",
            "AFL3001",
          );
          continue;
        }
        let targetDirectory = resolve(directory, target);
        try {
          targetDirectory = await canonical(targetDirectory);
          // A dependency may not exist yet. Its entry/config creation must
          // still let editors retry the project check.
          for (const file of ["main.afl", "lib.afl", "config.toml"])
            watched.add(join(targetDirectory, file));
          if (!(await stat(targetDirectory)).isDirectory())
            throw new Error("The target is not a directory.");
        } catch (error) {
          dependencyError(
            name,
            `Cannot load dependency '${name}': ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        const [targetMain, targetLib] = await Promise.all([
          isFile(join(targetDirectory, "main.afl")),
          isFile(join(targetDirectory, "lib.afl")),
        ]);
        if (
          targetMain === targetLib ||
          (await rootOf(targetDirectory)) !== targetDirectory
        ) {
          dependencyError(
            name,
            `Dependency '${name}' must point to a unique, non-nested crate root.`,
          );
          continue;
        }
        dependencyRoots[name] = rootUri(targetDirectory);
        if (visiting.has(targetDirectory)) {
          dependencyError(
            name,
            `Cyclic crate dependency: ${[...chain, directory, targetDirectory].join(" -> ")}`,
            "AFL3003",
          );
        } else await loadCrate(targetDirectory, [...chain, directory]);
      }
    }
    diagnostics.push(...config.diagnostics);
    visiting.delete(directory);
  }

  const tableValue = (value: unknown): value is Record<string, unknown> =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date);

  async function loadTests(directory: string): Promise<void> {
    const config = configs.get(directory);
    if (!config || config.test === undefined) return;
    const source = new Source(config.source.document);
    const fail = (name: string, message: string): void => {
      const offset = Math.max(0, source.document.text.indexOf(name));
      source.error("AFL3004", message, {
        start: offset,
        end: offset + name.length,
      });
    };
    const table = config.test;
    if (
      !tableValue(table) ||
      Object.keys(table).some((key) => key !== "crates") ||
      !Array.isArray(table.crates)
    ) {
      fail(
        "test",
        "The [test] configuration must contain only a crates list of test specification crate paths.",
      );
      diagnostics.push(...source.diagnostics);
      return;
    }
    const association: TestAssociation = {
      target: rootUri(directory),
      crates: [],
    };
    const seen = new Set<string>();
    for (const path of table.crates) {
      if (typeof path !== "string" || !path.trim()) {
        fail(
          "crates",
          "Test specification paths must be nonempty directory strings.",
        );
        continue;
      }
      let target: string;
      try {
        target = await canonical(resolve(directory, path));
        // Watch absent entries too, so creating a missing test crate can repair
        // diagnostics without editing the owner's configuration again.
        for (const file of ["main.afl", "lib.afl", "config.toml"])
          watched.add(join(target, file));
        if (!(await stat(target)).isDirectory())
          throw new Error("The target is not a directory.");
        const [main, lib] = await Promise.all([
          isFile(join(target, "main.afl")),
          isFile(join(target, "lib.afl")),
        ]);
        if (main === lib || (await rootOf(target)) !== target) {
          fail(
            path,
            `Test specification '${path}' must point to a unique, non-nested crate root.`,
          );
          continue;
        }
      } catch (error) {
        fail(
          path,
          `Cannot load test specification '${path}': ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (target === directory) {
        fail(
          path,
          "A test specification crate must be outside its target crate.",
        );
        continue;
      }
      if (seen.has(target)) {
        fail(path, `Duplicate test specification crate '${path}'.`);
        continue;
      }
      seen.add(target);
      association.crates.push(rootUri(target));
      await loadCrate(target, []);
    }
    tests.push(association);
    diagnostics.push(...source.diagnostics);
  }

  async function presetTable(
    path: string,
  ): Promise<Record<string, unknown> | undefined> {
    let source: Source | undefined;
    try {
      source = new Source({ uri: uri(path), text: await read(path) });
      return parse(source.document.text);
    } catch (error) {
      if (error instanceof TomlError && source) {
        const start =
          (source.lineStarts[Math.max(0, error.line - 1)] ??
            source.document.text.length) + Math.max(0, error.column - 1);
        source.error("AFL4001", error.message, { start, end: start + 1 });
        diagnostics.push(...source.diagnostics);
      } else
        issue(
          path,
          "AFL4001",
          `Cannot read preset configuration: ${error instanceof Error ? error.message : String(error)}`,
        );
      return undefined;
    }
  }
  const presetNames = new Set<string>();
  async function addPreset(
    name: string,
    value: unknown,
    path: string,
  ): Promise<void> {
    const fail = (message: string): void =>
      issue(path, "AFL4001", `Preset '${name}': ${message}`);
    if (!name.trim()) {
      fail("the name cannot be empty.");
      return;
    }
    if (presetNames.has(name)) {
      fail("duplicate preset name.");
      return;
    }
    presetNames.add(name);
    if (
      !tableValue(value) ||
      Object.keys(value).some(
        (key) =>
          !["core", "edge", "implementations", "allow_unsupported"].includes(
            key,
          ),
      )
    ) {
      fail(
        "expected core and edge lists, with optional implementations and allow_unsupported. Generation options project_dir and codegen_pack have been removed; maintain native code directly.",
      );
      return;
    }
    const result: PresetContext = { name, uri: uri(path), core: [], edge: [] };
    let valid = true;
    if (value.implementations !== undefined) {
      if (
        typeof value.implementations !== "string" ||
        !value.implementations.trim() ||
        isAbsolute(value.implementations) ||
        extname(value.implementations) !== ".toml"
      ) {
        fail("implementations must be a nonempty relative TOML file path.");
        valid = false;
      } else {
        const file = await canonical(
          resolve(dirname(path), value.implementations),
        );
        result.implementations = uri(file);
        watched.add(file);
      }
    }
    const seen = new Set<string>();
    for (const role of ["core", "edge"] as const) {
      const paths = value[role];
      if (!Array.isArray(paths) || (role === "core" && !paths.length)) {
        fail(
          `${role} must be a ${role === "core" ? "nonempty " : ""}list of crate directory paths.`,
        );
        valid = false;
        continue;
      }
      for (const entry of paths) {
        const target = entry;
        if (typeof target !== "string" || !target.trim()) {
          fail(
            `${role} paths must be nonempty strings. Crate generation preset selections have been removed.`,
          );
          valid = false;
          continue;
        }
        try {
          const directory = await canonical(resolve(dirname(path), target));
          for (const file of ["main.afl", "lib.afl", "config.toml"])
            watched.add(join(directory, file));
          const [main, lib] = await Promise.all([
            isFile(join(directory, "main.afl")),
            isFile(join(directory, "lib.afl")),
          ]);
          if (main === lib || (await rootOf(directory)) !== directory) {
            fail(
              `${role} path '${target}' must point to a unique, non-nested crate root.`,
            );
            valid = false;
            continue;
          }
          if (seen.has(directory)) {
            fail(
              `crate '${target}' is selected more than once or in both roles.`,
            );
            valid = false;
            continue;
          }
          seen.add(directory);
          (result[role] as string[]).push(rootUri(directory));
        } catch (error) {
          fail(
            `cannot resolve '${target}': ${error instanceof Error ? error.message : String(error)}`,
          );
          valid = false;
        }
      }
    }
    if (value.allow_unsupported !== undefined) {
      if (!Array.isArray(value.allow_unsupported)) {
        fail(
          "allow_unsupported must be a list of source-file.afl::Symbol strings.",
        );
        valid = false;
      } else {
        const permissions: { uri: string; name: string }[] = [];
        for (const target of value.allow_unsupported) {
          const match =
            typeof target === "string"
              ? /^(.+\.afl)::([A-Za-z_][A-Za-z_0-9]*)$/u.exec(target)
              : null;
          if (!match) {
            fail(
              "allow_unsupported entries must be source-file.afl::Symbol strings.",
            );
            valid = false;
            continue;
          }
          const file = await canonical(resolve(dirname(path), match[1]!));
          watched.add(file);
          const targetUri = uri(file);
          if (
            !(await isFile(file)) ||
            !result.core.some((root) => targetUri.startsWith(root))
          ) {
            fail(
              `allow_unsupported '${target}' must reference an existing AFL file inside a selected core.`,
            );
            valid = false;
            continue;
          }
          if (
            permissions.some(
              (item) => item.uri === targetUri && item.name === match[2],
            )
          ) {
            fail(`duplicate allow_unsupported target '${target}'.`);
            valid = false;
            continue;
          }
          permissions.push({ uri: targetUri, name: match[2]! });
        }
        result.allowUnsupported = permissions;
      }
    }
    if (valid) presets.push(result);
  }
  if (
    !invalidProject &&
    (options.project || options.preset !== undefined || options.presetsOnly)
  ) {
    if (inputs.length !== 1)
      throw new Error("Preset checks require exactly one project directory.");
    const directory = await canonical(resolve(inputs[0]!));
    if (!(await stat(directory)).isDirectory())
      throw new Error("Preset checks require a project directory.");
    watchedDirectories.add(directory);
    const configPath = join(directory, "config.toml");
    const config = await presetTable(configPath);
    if (config) {
      if (config.codegen !== undefined) {
        issue(
          configPath,
          "AFL4001",
          "Code generation has been removed. Use preset implementations association files and maintain native code directly.",
        );
      }
      if (config.res !== undefined)
        issue(
          configPath,
          "AFL4001",
          "The [res] section has been removed. Keep resources and native project files in their own projects.",
        );
      if (config.preset !== undefined) {
        if (!tableValue(config.preset))
          issue(
            configPath,
            "AFL4001",
            "preset must be a table of named presets.",
          );
        else
          for (const [name, value] of Object.entries(config.preset))
            await addPreset(name, value, configPath);
      }
      if (config.preset_dir !== undefined) {
        if (typeof config.preset_dir !== "string" || !config.preset_dir.trim())
          issue(
            configPath,
            "AFL4001",
            "preset_dir must be a nonempty directory path.",
          );
        else {
          const presetDirectory = await canonical(
            resolve(directory, config.preset_dir),
          );
          watchedDirectories.add(presetDirectory);
          try {
            const children = await readdir(presetDirectory, {
              withFileTypes: true,
            });
            const paths = new Set(
              children
                .filter(
                  (child) =>
                    (child.isFile() || child.isSymbolicLink()) &&
                    extname(child.name) === ".toml",
                )
                .map((child) => join(presetDirectory, child.name)),
            );
            for (const path of overlay.keys())
              if (
                dirname(path) === presetDirectory &&
                extname(path) === ".toml"
              )
                paths.add(path);
            for (const path of [...paths].sort()) {
              const table = await presetTable(path);
              if (table) await addPreset(basename(path, ".toml"), table, path);
            }
          } catch (error) {
            issue(
              configPath,
              "AFL4001",
              `Cannot scan preset_dir: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }
    presets.sort((a, b) => a.name.localeCompare(b.name));
    if (options.preset !== undefined) {
      preset = presets.find((item) => item.name === options.preset);
      if (!preset)
        issue(
          configPath,
          "AFL4002",
          `Unknown or invalid preset '${options.preset}'.`,
        );
      else
        for (const root of [...preset.core, ...preset.edge]) {
          const directory = resolve(fileURLToPath(root));
          selectedCrates.add(directory);
          await loadCrate(directory, []);
        }
    }
  }

  if (options.project && options.preset === undefined && !options.presetsOnly) {
    for (const selection of presets.filter((item) => item.implementations)) {
      for (const root of [...selection.core, ...selection.edge]) {
        const directory = resolve(fileURLToPath(root));
        selectedCrates.add(directory);
        await loadCrate(directory, []);
      }
    }
  }

  const selected = new Set<string>();
  let selectedProject = false;
  for (const input of invalidProject ||
  options.preset !== undefined ||
  options.presetsOnly
    ? []
    : inputs) {
    const path = await canonical(resolve(input));
    if (overlay.has(path) && extname(path) === ".afl") selected.add(path);
    else {
      const entry = await stat(path);
      if (entry.isDirectory()) {
        const root = await projectRoots.root(path);
        if (root) {
          selectedProject = true;
          diagnostics.push(...root.diagnostics);
        }
        for (const file of await scan(path, !!root)) selected.add(file);
      } else if (entry.isFile() && extname(path) === ".afl") selected.add(path);
      else throw new Error(`Expected an .afl file or directory: ${path}`);
    }
  }
  if (
    !selected.size &&
    !invalidProject &&
    !projectOperation &&
    !selectedProject
  )
    throw new Error("No .afl files found in the selected paths.");
  for (const path of selected) {
    const root = await rootOf(dirname(path));
    if (root) {
      selectedCrates.add(root);
      await loadCrate(root, []);
      // Explicit inputs remain selected even when the owning crate scan skips
      // their directory (for example node_modules or dist).
      if (!documents.has(path)) await addCrateDocument(path, root);
    } else {
      await addDocument(path);
      issue(
        path,
        "AFL3000",
        "Source file is outside a crate; add main.afl or lib.afl to its crate root.",
      );
    }
  }
  // Test associations are not dependency edges. Expand only the explicitly
  // selected owners after dependency traversal, allowing tests to depend back
  // on their target without a false cycle or recursive test inheritance.
  for (const directory of [...selectedCrates].sort())
    await loadTests(directory);
  const identities = new Map<string, string>();
  for (const [directory, crate] of crates) {
    if (!crate.id) continue;
    const previous = identities.get(crate.id);
    if (previous)
      issue(
        join(directory, "config.toml"),
        "AFL3001",
        `Duplicate crate id '${crate.id}'; also declared in '${previous}'.`,
      );
    else identities.set(crate.id, directory);
  }
  const associations: AssociationSet[] = [];
  const nativeDocuments = new Map<string, SourceDocument>();
  for (const selection of options.presetsOnly
    ? []
    : preset
      ? [preset]
      : options.project
        ? presets
        : []) {
    if (!selection.implementations) {
      continue;
    }
    const path = fileURLToPath(selection.implementations);
    let document: SourceDocument;
    try {
      document = { uri: selection.implementations, text: await read(path) };
    } catch (error) {
      issue(
        path,
        "AFL4200",
        `Cannot read implementation associations: ${String(error)}`,
      );
      associations.push({ preset: selection, entries: [], documents: [] });
      continue;
    }
    const parsed = parseAssociations(document);
    diagnostics.push(...parsed.diagnostics);
    const entries = [];
    const snapshots = new Map<string, SourceDocument>();
    for (const entry of parsed.entries) {
      const file = await canonical(resolve(dirname(path), entry.file));
      const targetUri = uri(file);
      watched.add(file);
      try {
        const snapshot = nativeDocuments.get(targetUri) ?? {
          uri: targetUri,
          text: await read(file),
        };
        snapshots.set(targetUri, snapshot);
        nativeDocuments.set(targetUri, snapshot);
        entries.push({ ...entry, uri: targetUri, mapUri: document.uri });
      } catch (error) {
        issue(
          path,
          "AFL4202",
          `Cannot read associated file '${entry.file}': ${String(error)}`,
        );
      }
    }
    const testRoots = tests
      .filter((test) =>
        [...selection.core, ...selection.edge].includes(test.target),
      )
      .flatMap((test) => test.crates);
    associations.push({
      preset: selection,
      entries,
      documents: [...snapshots.values()],
      testRoots,
    });
  }
  return {
    documents: [...documents.values()].sort((a, b) =>
      a.uri.localeCompare(b.uri),
    ),
    associations,
    nativeDocuments: [...nativeDocuments.values()],
    crates: [...crates.values()],
    diagnostics,
    watchedFiles: [...watched].sort(),
    displayUris,
    presets,
    tests,
    watchedDirectories: [...watchedDirectories].sort(),
    ...(preset ? { preset } : {}),
  };
}

export {
  traceAssociations,
  implementationImpact,
  queryTrace,
  queryImpact,
} from "./association-queries.js";
