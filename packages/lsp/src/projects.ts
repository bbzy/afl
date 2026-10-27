import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LanguageService,
  parseDocument,
  type Diagnostic,
  type Location,
  type SourceDocument,
} from "@afl/checker";
import {
  loadProject,
  ProjectRoots,
  canonicalPath,
  directoryUri,
  owningProject,
  type LoadedProject,
  type ProjectRoot,
} from "@afl/checker/node";

export interface EditorDocument extends SourceDocument {
  languageId: string;
}
export interface ProjectSelection {
  projectUri: string;
  preset?: string;
}
export interface ProjectState {
  projects: ProjectRoot[];
  aliases: Record<string, string>;
  activeProjectUri?: string;
}
export const isAfl = (document: EditorDocument): boolean =>
  document.languageId === "afl" || document.uri.endsWith(".afl");

export class ProjectSnapshot {
  constructor(
    readonly key: string,
    readonly fingerprint: string,
    readonly service: LanguageService,
    readonly project: LoadedProject | undefined,
    readonly sources: readonly SourceDocument[],
    readonly issues: readonly Diagnostic[],
    readonly roots: Set<string>,
    readonly watched: Set<string>,
  ) {}
  canonical(uri: string): string {
    return (
      Object.entries(this.project?.displayUris ?? {}).find(
        ([, alias]) => alias === uri,
      )?.[0] ?? uri
    );
  }
  display(uri: string): string {
    return this.project?.displayUris[uri] ?? uri;
  }
  location(value: Location): Location {
    return { ...value, uri: this.display(value.uri) };
  }
  contains(uri: string): boolean {
    return (
      this.sources.some((source) => source.uri === uri) || this.watched.has(uri)
    );
  }
}

/** Filesystem/project state is independent of the editor protocol and UI. */
export class EditorProjects {
  private projects: ProjectRoot[] = [];
  private snapshots = new Map<string, ProjectSnapshot>();
  private readonly selections = new Map<string, string | undefined>();
  private readonly requested = new Set<string>();
  private readonly manual = new Set<string>();
  private aliases = new Map<string, string>();
  private readonly projectAliases = new Map<string, string>();
  private discoveryDirty = true;
  private diskVersion = 0;
  private active: string | undefined;
  private focused: string | undefined;
  private focusRevision = 0;
  private generation = 0;
  private boundaries: string[] = [];
  private folderKey = "";
  private readonly empty = new ProjectSnapshot(
    "",
    "",
    new LanguageService(),
    undefined,
    [],
    [],
    new Set(),
    new Set(),
  );

  get state(): ProjectState {
    return {
      projects: this.projects,
      aliases: Object.fromEntries(this.projectAliases),
      ...(this.active ? { activeProjectUri: this.active } : {}),
    };
  }
  get contexts(): readonly ProjectSnapshot[] {
    return [...this.snapshots.values()];
  }
  get activeProject(): string | undefined {
    return this.active;
  }

  async setFolders(folders: readonly string[]): Promise<void> {
    this.boundaries = await Promise.all(
      folders
        .filter((uri) => uri.startsWith("file:"))
        .map(async (uri) =>
          directoryUri(await canonicalPath(fileURLToPath(uri))),
        ),
    );
    this.folderKey = JSON.stringify(folders);
    this.discoveryDirty = true;
  }

  changed(uri?: string, disk = false): void {
    if (!uri || uri.endsWith("/config.toml") || disk)
      this.discoveryDirty = true;
    if (disk) this.diskVersion++;
  }

  async select(selection: ProjectSelection, activate = true): Promise<string> {
    const uri = directoryUri(
      await canonicalPath(fileURLToPath(selection.projectUri)),
    );
    this.projectAliases.set(selection.projectUri.replace(/\/?$/u, "/"), uri);
    if (!this.boundaries.some((boundary) => uri.startsWith(boundary)))
      this.manual.add(uri);
    this.requested.add(uri);
    this.selections.set(uri, selection.preset);
    this.discoveryDirty = true;
    if (activate) {
      this.focusRevision++;
      this.active = uri;
      this.focused = undefined;
    }
    return uri;
  }

  async focus(uri?: string): Promise<void> {
    const revision = ++this.focusRevision;
    const canonical = uri?.startsWith("file:")
      ? pathToFileURL(await canonicalPath(fileURLToPath(uri))).href
      : uri;
    if (revision === this.focusRevision) this.focused = canonical;
  }

  private owner(uri: string): string | undefined {
    return owningProject(uri, this.projects)?.uri;
  }
  private consumer(uri: string, contexts = this.snapshots): string | undefined {
    const candidates = [...contexts.values()].filter(
      (snapshot) => snapshot.key.startsWith("file:") && snapshot.contains(uri),
    );
    return (
      candidates.find((snapshot) => snapshot.key === this.active)?.key ??
      (candidates.length === 1 ? candidates[0]!.key : undefined)
    );
  }

  context(uri: string): ProjectSnapshot {
    const canonical = this.aliases.get(uri) ?? uri;
    const root = this.owner(canonical) ?? this.consumer(canonical);
    return (
      (root ? this.snapshots.get(root) : undefined) ??
      this.snapshots.get("document:" + canonical) ??
      [...this.snapshots.values()].find(
        (snapshot) =>
          snapshot.key.startsWith("document:") && snapshot.contains(canonical),
      ) ??
      this.empty
    );
  }

  async refresh(
    folders: readonly string[],
    documents: readonly EditorDocument[],
    current: () => boolean,
  ): Promise<boolean> {
    const generation = ++this.generation;
    if (JSON.stringify(folders) !== this.folderKey)
      await this.setFolders(folders);
    const aliases = new Map<string, string>();
    for (const document of documents)
      aliases.set(
        document.uri,
        document.uri.startsWith("file:")
          ? pathToFileURL(await canonicalPath(fileURLToPath(document.uri))).href
          : document.uri,
      );
    const overlays = documents;
    let projects = this.projects;
    if (this.discoveryDirty) {
      const markers = await ProjectRoots.create(overlays);
      projects = await markers.discover(
        folders
          .filter((uri) => uri.startsWith("file:"))
          .map((uri) => fileURLToPath(uri)),
        this.projects,
      );
      for (const uri of this.manual) {
        const roots = await markers.discover(
          [fileURLToPath(uri)],
          this.projects,
        );
        for (const root of roots)
          if (!projects.some((item) => item.uri === root.uri))
            projects.push(root);
      }
      // Retain desired selections with migration errors, but unload removed workspaces.
      for (const uri of this.requested)
        if (
          !projects.some((root) => root.uri === uri) &&
          (this.manual.has(uri) ||
            this.boundaries.some((boundary) => uri.startsWith(boundary)))
        ) {
          projects.push((await markers.root(fileURLToPath(uri), true))!);
        }
      projects.sort((a, b) => a.uri.localeCompare(b.uri));
    }
    const owner = (uri: string): string | undefined =>
      owningProject(uri, projects)?.uri;
    let active = this.focused
      ? (owner(this.focused) ?? this.consumer(this.focused))
      : this.active;
    if (!active && this.focused && !/\.(afl|toml)$/u.test(this.focused))
      active = this.active;
    if (active && !projects.some((root) => root.uri === active))
      active = undefined;
    if (!active && !this.focused && projects.length === 1)
      active = projects[0]!.uri;
    const wanted = new Set(
      [...this.requested].filter((uri) =>
        projects.some((root) => root.uri === uri),
      ),
    );
    if (active) wanted.add(active);
    for (const document of documents) {
      const root = owner(aliases.get(document.uri)!);
      if (root) wanted.add(root);
    }
    const next = new Map<string, ProjectSnapshot>();
    const commit: (() => void)[] = [];
    const diskVersion = this.diskVersion;
    const boundaries = projects.map((root) => root.uri);
    const build = async (
      key: string,
      root: string | undefined,
      local: readonly EditorDocument[],
    ): Promise<void> => {
      const previous = this.snapshots.get(key);
      const preset = root ? this.selections.get(root) : undefined;
      const fingerprint = JSON.stringify([
        preset,
        local.map((item) => item.uri),
        overlays,
        diskVersion,
        boundaries,
      ]);
      if (previous?.fingerprint === fingerprint) {
        next.set(key, previous);
        return;
      }
      const inputs = [
        ...local
          .filter(
            (document) => isAfl(document) && document.uri.startsWith("file:"),
          )
          .map((document) => fileURLToPath(document.uri)),
      ];
      const untitled = local.filter(
        (document) => isAfl(document) && !document.uri.startsWith("file:"),
      );
      const roots = new Set<string>();
      const watched = new Set<string>();
      let project: LoadedProject | undefined;
      let service = previous?.service ?? new LanguageService();
      let issues: readonly Diagnostic[] = [];
      let sources: readonly SourceDocument[] = local.filter(isAfl);
      let update: (() => void) | undefined;
      try {
        if (root || inputs.length)
          project = await loadProject(
            root ? [fileURLToPath(root)] : inputs,
            overlays,
            root
              ? {
                  project: true,
                  projectRoots: boundaries,
                  ...(preset === undefined ? {} : { preset }),
                }
              : {},
          );
        sources = [...(project?.documents ?? local.filter(isAfl)), ...untitled];
        if (project) {
          project.crates.forEach((crate) => roots.add(crate.root));
          project.watchedFiles.forEach((path) => {
            watched.add(pathToFileURL(path).href);
            roots.add(directoryUri(dirname(path)));
          });
          project.watchedDirectories.forEach((path) =>
            roots.add(directoryUri(path)),
          );
          project.documents.forEach((document) => watched.add(document.uri));
        }
        update = () => {
          service.update(sources, project ?? {});
          issues = service.diagnostics;
        };
      } catch (error) {
        const path =
          error instanceof Error &&
          "path" in error &&
          typeof error.path === "string"
            ? error.path
            : root
              ? join(fileURLToPath(root), "config.toml")
              : inputs[0];
        const uri = path ? pathToFileURL(path).href : (local[0]?.uri ?? key);
        if (path) roots.add(directoryUri(dirname(path)));
        sources = local.filter(isAfl);
        service = new LanguageService();
        update = () => {
          service.update(sources);
        };
        issues = [
          ...sources.flatMap((document) => parseDocument(document).diagnostics),
          {
            uri,
            code: "AFL9001",
            severity: "error",
            message: "Unable to check AFL project: " + String(error),
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          },
        ];
      }
      const apply = () => {
        update?.();
        next.set(
          key,
          new ProjectSnapshot(
            key,
            fingerprint,
            service,
            project,
            sources,
            issues,
            roots,
            watched,
          ),
        );
      };
      commit.push(apply);
    };
    for (const root of wanted) {
      const local = documents.filter(
        (document) =>
          owner(aliases.get(document.uri)!) === root ||
          this.snapshots.get(root)?.contains(aliases.get(document.uri)!),
      );
      await build(root, root, local);
    }
    for (const document of documents.filter((document) => isAfl(document))) {
      const canonical = aliases.get(document.uri)!;
      if (owner(canonical)) continue;
      // Keep an ordinary context for shared files when no consuming project is selected.
      await build("document:" + canonical, undefined, [document]);
    }
    if (!current() || generation !== this.generation) return false;
    // Cached services are mutable. Commit all of them together after every async read,
    // so a superseded load cannot mutate an otherwise reusable published snapshot.
    for (const apply of commit) apply();
    this.aliases = aliases;
    this.projects = projects;
    this.snapshots = next;
    this.active = active;
    this.discoveryDirty = false;
    return true;
  }
}
