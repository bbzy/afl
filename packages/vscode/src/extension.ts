import * as vscode from "vscode";
import {
  LanguageClient,
  TransportKind,
  ExecuteCommandRequest,
  State,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node.js";

import {
  PresetController,
  type PresetList,
  type ProjectState,
} from "./presets.js";

let stop: (() => Promise<void>) | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const log = vscode.window.createOutputChannel("AFL", { log: true });
  log.info("Activating AFL extension");
  const showLogs = vscode.commands.registerCommand("afl.showLogs", () =>
    log.show(true),
  );
  const reportError = (message: string, error: unknown): void => {
    log.error(message, error instanceof Error ? error : String(error));
    // Notifications must not hold activation or command completion open until clicked.
    void vscode.window
      .showErrorMessage(
        `${message}. See the AFL output for details.`,
        "Show Logs",
      )
      .then((action) => {
        if (action === "Show Logs") log.show(true);
      });
  };
  const server = context.asAbsolutePath("dist/server.cjs");
  log.info(`Starting language server: ${server}`);
  const serverOptions: ServerOptions = {
    run: { module: server, transport: TransportKind.ipc },
    debug: { module: server, transport: TransportKind.ipc },
  };
  let presets: PresetController;
  const clientOptions: LanguageClientOptions = {
    // Synchronize native snapshots too; the server only reads explicitly associated files.
    documentSelector: [
      { scheme: "file" },
      { scheme: "untitled", language: "afl" },
    ],
    outputChannel: log,
    initializationOptions: () => ({
      projects: presets.selections,
      activeDocumentUri:
        vscode.window.activeTextEditor?.document.uri.toString(),
    }),
  };
  const client = new LanguageClient(
    "afl",
    "AFL Language Server",
    serverOptions,
    clientOptions,
  );
  presets = new PresetController(
    context,
    async (selection) => {
      await ready;
      let result: ProjectState;
      if (selection.preset) {
        log.info(`Preset check requested: ${selection.preset}`);
        result = await client.sendRequest(ExecuteCommandRequest.type, {
          command: "afl.checkPreset",
          arguments: [selection.projectUri, selection.preset],
        });
        log.info(`Preset check completed: ${selection.preset}`);
      } else {
        log.info("Project check requested");
        result = await client.sendRequest(ExecuteCommandRequest.type, {
          command: "afl.checkProject",
          arguments: [selection.projectUri],
        });
        log.info("Project check completed");
      }
      return result;
    },
    async (project) => {
      await ready;
      return client.sendRequest<PresetList>(ExecuteCommandRequest.method, {
        command: "afl.listPresets",
        arguments: [project],
      });
    },
    async (documentUri) => {
      await ready;
      const state = await client.sendRequest<ProjectState>(
        "afl/projectContext",
        documentUri ? { documentUri } : {},
      );
      log.info(`Active AFL project: ${state.activeProjectUri ?? "none"}`);
      return state;
    },
    reportError,
  );
  const showReport = async (value: unknown): Promise<void> => {
    const document = await vscode.workspace.openTextDocument({
      language: "json",
      content: JSON.stringify(value, null, 2),
    });
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  };
  const associationCommands = [
    vscode.commands.registerCommand("afl.traceGeneration", async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== "file")
          throw new Error("Open an associated native file first.");
        await ready;
        await showReport(
          await client.sendRequest(ExecuteCommandRequest.type, {
            command: "afl.traceGenerated",
            arguments: [
              editor.document.uri.toString(),
              editor.selection.active.line + 1,
              editor.selection.active.character + 1,
            ],
          }),
        );
      } catch (error) {
        reportError("Implementation trace failed", error);
      }
    }),
    vscode.commands.registerCommand("afl.generationImpact", async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        await presets.focus();
        const selected = presets.current;
        if (!editor || editor.document.uri.scheme !== "file" || !selected)
          throw new Error(
            "Open an input file and select its AFL project first.",
          );
        await ready;
        await showReport(
          await client.sendRequest(ExecuteCommandRequest.type, {
            command: "afl.queryImpact",
            arguments: [
              selected.projectUri,
              selected.preset,
              editor.document.uri.toString(),
            ],
          }),
        );
      } catch (error) {
        reportError("Implementation impact failed", error);
      }
    }),
  ];
  context.subscriptions.push(...associationCommands);
  const projectChanges = client.onNotification(
    "afl/projectsChanged",
    (state: ProjectState) => presets.updateProjects(state),
  );
  const stateChanges = client.onDidChangeState(({ newState }) => {
    log.info(`Language server state: ${State[newState]}`);
    presets.serverState(newState === State.Running);
  });
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> =>
    (disposing ??= (async () => {
      log.info("Stopping AFL extension");
      presets.dispose();
      try {
        await client.dispose();
        log.info("Language server stopped");
      } catch (error) {
        log.error(
          "Failed to stop language server",
          error instanceof Error ? error : String(error),
        );
      } finally {
        projectChanges.dispose();
        stateChanges.dispose();
        showLogs.dispose();
        log.dispose();
      }
    })());
  stop = dispose;
  const ready = client.start();
  context.subscriptions.push({
    dispose(): void {
      void dispose();
    },
  });
  try {
    await ready;
    await presets.focus();
    log.info("Language server ready");
  } catch (error) {
    reportError("AFL language server failed to start", error);
    // Keep the output and Show Logs available after activation fails.
    // VS Code disposes these subscriptions when the extension host shuts down.
    context.subscriptions.push(log, showLogs, presets);
    stateChanges.dispose();
    projectChanges.dispose();
    presets.serverFailed();
    await client.dispose();
    stop = undefined;
    throw error;
  }
}

export async function deactivate(): Promise<void> {
  const dispose = stop;
  stop = undefined;
  await dispose?.();
}
