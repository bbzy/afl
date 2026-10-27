import * as vscode from "vscode";

export interface PresetSelection {
  projectUri: string;
  preset?: string;
}
export interface PresetList {
  presets: { name: string; uri: string; implementations?: string }[];
  diagnostics: { message: string }[];
}
export interface ProjectState {
  projects: { uri: string; diagnostics: { message: string }[] }[];
  aliases?: Record<string, string>;
  activeProjectUri?: string;
  selectedProjectUri?: string;
}
const stateKey = "afl.projectPresets";
const legacyKey = "afl.activePreset";
const projectUri = (value: string): string => value.replace(/\/?$/u, "/");

function selection(value: unknown): PresetSelection | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("projectUri" in value) ||
    typeof value.projectUri !== "string" ||
    ("preset" in value &&
      value.preset !== undefined &&
      (typeof value.preset !== "string" || !value.preset.trim()))
  )
    return undefined;
  try {
    const uri = vscode.Uri.parse(value.projectUri);
    if (uri.scheme === "file")
      return {
        projectUri: projectUri(uri.toString()),
        ...("preset" in value && typeof value.preset === "string"
          ? { preset: value.preset }
          : {}),
      };
  } catch {
    /* Ignore malformed saved state; explicit command arguments are reported below. */
  }
  return undefined;
}

/** Desired selections are independent per project; acknowledgements never change editor focus. */
export class PresetController implements vscode.Disposable {
  private readonly status = vscode.window.createStatusBarItem(
    "afl.preset",
    vscode.StatusBarAlignment.Left,
    10,
  );
  private readonly subscriptions: vscode.Disposable[];
  private readonly desired = new Map<string, PresetSelection>();
  private readonly confirmed = new Map<string, PresetSelection>();
  private readonly revisions = new Map<string, number>();
  private readonly aliases = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly failures = new Map<string, string>();
  private projects: ProjectState["projects"] = [];
  private active: string | undefined;
  private queue = Promise.resolve();
  private focusRevision = 0;
  private changeRevision = 0;
  private focusPending = false;
  private focusTask = Promise.resolve();
  private running = false;
  private disposed = false;
  private serverFailure: string | undefined;

  get current(): PresetSelection | undefined {
    return this.active
      ? (this.desired.get(this.active) ?? { projectUri: this.active })
      : undefined;
  }
  get selections(): PresetSelection[] {
    return [...this.desired.values()];
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly apply: (value: PresetSelection) => Promise<ProjectState>,
    private readonly list: (project: string) => Promise<PresetList>,
    private readonly locate: (documentUri?: string) => Promise<ProjectState>,
    private readonly reportError: (message: string, error: unknown) => void,
  ) {
    const saved = context.workspaceState.get<unknown>(stateKey);
    const legacy = selection(context.workspaceState.get<unknown>(legacyKey));
    for (const value of Array.isArray(saved) ? saved : legacy ? [legacy] : []) {
      const item = selection(value);
      if (item) {
        this.desired.set(item.projectUri, item);
        this.confirmed.set(item.projectUri, item);
      }
    }
    if (this.desired.size === 1) this.active = this.selections[0]!.projectUri;
    this.status.name = "AFL Preset";
    this.status.command = "afl.selectPreset";
    this.subscriptions = [
      vscode.commands.registerCommand(
        "afl.selectPreset",
        async (value?: unknown) => {
          try {
            if (this.serverFailure) throw new Error(this.serverFailure);
            if (value === undefined) {
              await this.focusTask;
              await this.pick();
            } else {
              const selected = selection(value);
              if (!selected?.preset)
                throw new Error(
                  "A preset selection requires a project file URI and a nonempty preset name.",
                );
              await this.change(selected);
            }
          } catch (error) {
            this.reportError("AFL preset selection failed", error);
          }
        },
      ),
      vscode.commands.registerCommand("afl.check", async () => {
        try {
          if (this.serverFailure) throw new Error(this.serverFailure);
          await this.focusTask;
          const project = this.active ?? (await this.project());
          if (project) await this.change({ projectUri: project });
        } catch (error) {
          this.reportError("AFL project check failed", error);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        void this.focus();
      }),
    ];
    this.render();
    this.status.show();
  }

  updateProjects(state: ProjectState): void {
    this.projects = state.projects;
    this.canonicalize(state);
    if (!this.focusPending && !this.pending.size)
      this.active = state.activeProjectUri;
    this.render();
  }

  private canonicalize(state: ProjectState): void {
    for (const [alias, root] of Object.entries(state.aliases ?? {}))
      this.reconcileProject(alias, root);
  }

  private canonicalProject(project: string): string {
    const seen = new Set<string>();
    while (this.aliases.has(project) && !seen.has(project)) {
      seen.add(project);
      project = this.aliases.get(project)!;
    }
    return project;
  }

  private reconcileProject(alias: string, project: string): void {
    const root = this.canonicalProject(project);
    if (alias === root) return;
    const revision = this.revisions.get(alias) ?? 0;
    const previous = this.revisions.get(root) ?? 0;
    const desired = this.desired.get(alias);
    if (desired && (revision > previous || !this.desired.has(root))) {
      this.desired.set(root, { ...desired, projectUri: root });
      const failure = this.failures.get(alias);
      if (failure) this.failures.set(root, failure);
      else this.failures.delete(root);
    }
    const confirmed = this.confirmed.get(alias);
    if (confirmed && !this.confirmed.has(root))
      this.confirmed.set(root, { ...confirmed, projectUri: root });
    this.revisions.set(root, Math.max(revision, previous));
    if (this.pending.delete(alias)) this.pending.add(root);
    if (this.active === alias) this.active = root;
    this.desired.delete(alias);
    this.confirmed.delete(alias);
    this.revisions.delete(alias);
    this.failures.delete(alias);
    this.aliases.set(alias, root);
  }

  focus(): Promise<void> {
    this.focusTask = this.resolveFocus();
    return this.focusTask;
  }

  private async resolveFocus(): Promise<void> {
    const revision = ++this.focusRevision;
    this.focusPending = true;
    try {
      const state = await this.locate(
        vscode.window.activeTextEditor?.document.uri.toString(),
      );
      if (this.disposed || revision !== this.focusRevision) return;
      this.projects = state.projects;
      this.canonicalize(state);
      this.active = state.activeProjectUri;
      this.render();
    } catch (error) {
      if (!this.disposed && revision === this.focusRevision && this.running)
        this.reportError("AFL project discovery failed", error);
    } finally {
      if (revision === this.focusRevision) this.focusPending = false;
    }
  }

  serverState(running: boolean): void {
    this.running = running;
    if (running) this.serverFailure = undefined;
    this.render();
  }

  serverFailed(): void {
    this.serverFailure =
      "Language server unavailable. See the AFL output for details.";
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const value = this.current;
    const label = value?.preset ?? "No preset";
    const root = this.projects.find((project) => project.uri === this.active);
    const failure =
      this.serverFailure ??
      (this.active ? this.failures.get(this.active) : undefined) ??
      root?.diagnostics[0]?.message;
    const pending = !!this.active && this.pending.has(this.active);
    const icon = failure
      ? "$(warning)"
      : pending || !this.running
        ? "$(sync~spin)"
        : "$(list-selection)";
    const path = value
      ? vscode.Uri.parse(value.projectUri).fsPath.replace(/[\\/]$/u, "")
      : undefined;
    const name = path?.split(/[\\/]/u).at(-1);
    this.status.text = icon + " AFL: " + (name ? name + " / " : "") + label;
    this.status.tooltip = [
      path ? "Project: " + path : "Ordinary crate checks",
      failure ??
        (pending
          ? "Applying selection…"
          : !this.running
            ? "Waiting for language server…"
            : "Click to select a preset"),
    ].join("\n");
    this.status.accessibilityInformation = {
      label: "AFL project: " + (path ?? "none") + "; preset: " + label,
    };
  }

  private change(value: PresetSelection): Promise<void> {
    const root = this.canonicalProject(value.projectUri);
    const selected = { ...value, projectUri: root };
    const revision = ++this.changeRevision;
    this.revisions.set(root, revision);
    const focusRevision = ++this.focusRevision;
    this.focusPending = false;
    this.active = root;
    this.desired.set(root, selected);
    this.pending.add(root);
    this.failures.delete(root);
    this.render();
    this.queue = this.queue.then(async () => {
      if (this.disposed) return;
      try {
        const state = await this.apply(selected);
        if (this.disposed) return;
        this.projects = state.projects;
        // Canonical identity comes from the shared resolver, not client filesystem guesses.
        this.canonicalize(state);
        const canonical = this.canonicalProject(
          state.selectedProjectUri ?? root,
        );
        const confirmed = { ...value, projectUri: canonical };
        this.reconcileProject(root, canonical);
        this.confirmed.set(canonical, confirmed);
        try {
          await this.context.workspaceState.update(stateKey, [
            ...this.confirmed.values(),
          ]);
          await this.context.workspaceState.update(legacyKey, undefined);
        } catch (error) {
          if (revision === this.revisions.get(canonical))
            this.failures.set(
              canonical,
              "Selection is active, but could not be remembered for reopening.",
            );
          this.reportError("AFL selection could not be saved", error);
        }
      } catch (error) {
        const canonical = this.canonicalProject(root);
        if (!this.disposed && revision === this.revisions.get(canonical)) {
          this.failures.set(
            canonical,
            "Could not apply this selection. Click to select again.",
          );
          this.reportError(
            value.preset
              ? "AFL preset check failed"
              : "AFL project check failed",
            error,
          );
        }
      }
      const canonical = this.canonicalProject(root);
      if (revision === this.revisions.get(canonical))
        this.pending.delete(canonical);
      if (
        !this.disposed &&
        focusRevision !== this.focusRevision &&
        !this.pending.size
      )
        await this.focus();
      this.render();
    });
    return this.queue;
  }

  private async project(): Promise<string | undefined> {
    await this.focus();
    if (this.active) return this.active;
    if (this.projects.length === 1) return this.projects[0]!.uri;
    if (!this.projects.length) return this.browse();
    const items = this.projects.map((project) => ({
      label: vscode.Uri.parse(project.uri).fsPath,
      uri: project.uri,
    }));
    const chosen = await vscode.window.showQuickPick(
      [...items, { label: "Choose project folder…", uri: "" }],
      { title: "AFL: Select Project" },
    );
    return chosen ? chosen.uri || this.browse() : undefined;
  }

  private async browse(): Promise<string | undefined> {
    const chosen = await vscode.window.showOpenDialog({
      title: "Select the AFL project folder with [project] in config.toml",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    return chosen?.[0] ? projectUri(chosen[0].toString()) : undefined;
  }

  private async pick(): Promise<void> {
    let project = this.active ?? (await this.project());
    while (project && !this.disposed) {
      const result = await this.list(project);
      if (result.diagnostics.length)
        this.reportError(
          "AFL preset configuration has errors",
          result.diagnostics.map((item) => item.message).join("\n"),
        );
      type Choice = vscode.QuickPickItem & {
        action: "none" | "preset" | "browse" | "project";
        preset?: string;
        uri?: string;
      };
      const items: Choice[] = [
        {
          label: "No preset",
          description: "Ordinary project checks",
          action: "none",
          picked: !this.desired.get(project)?.preset,
        },
        ...result.presets.map((item) => ({
          label: item.name,
          description: vscode.Uri.parse(item.uri).fsPath,
          action: "preset" as const,
          preset: item.name,
          picked: this.desired.get(project!)?.preset === item.name,
        })),
        ...this.projects
          .filter((item) => item.uri !== project)
          .map((item) => ({
            label: vscode.Uri.parse(item.uri).fsPath,
            description: "Switch project",
            action: "project" as const,
            uri: item.uri,
          })),
        {
          label: "Choose project folder…",
          description: "Select a folder with a [project] marker",
          action: "browse",
        },
      ];
      const chosen = await vscode.window.showQuickPick(items, {
        title: "AFL: Select Preset",
        placeHolder: vscode.Uri.parse(project).fsPath,
      });
      if (!chosen) return;
      if (chosen.action === "browse") {
        project = await this.browse();
        continue;
      }
      if (chosen.action === "project") {
        project = chosen.uri;
        continue;
      }
      await this.change({
        projectUri: project,
        ...(chosen.action === "preset" ? { preset: chosen.preset! } : {}),
      });
      return;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.status.dispose();
    for (const item of this.subscriptions) item.dispose();
  }
}
