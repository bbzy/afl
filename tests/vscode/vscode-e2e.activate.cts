const vscode = require("vscode");
const fs = require("node:fs/promises"),
  path = require("node:path");
const root = process.env.AFL_E2E_ROOT;
const stages = [
  { mode: "command", next: "workbench.action.reloadWindow" },
  { mode: "associations", next: "workbench.action.reloadWindow" },
  { mode: "language" },
  { mode: "persist", next: "workbench.action.reloadWindow" },
  { mode: "restore", next: "workbench.action.reloadWindow" },
  { mode: "cleared", next: "workbench.action.reloadWindow" },
  { mode: "failure" },
];
async function closeEditors() {
  // Discard only this run's buffers, including untitled formatting fixtures.
  // Closing dirty editors without reverting would open confirmation dialogs.
  for (const document of vscode.workspace.textDocuments) {
    if (!document.isDirty) {
      continue;
    }
    if (
      document.uri.scheme !== "untitled" &&
      !document.uri.fsPath.startsWith(root + path.sep)
    ) {
      throw new Error(
        "Unexpected document outside the isolated test workspace",
      );
    }
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}
async function run(context) {
  const stateFile = path.join(root, "stage.json");
  let { index } = JSON.parse(await fs.readFile(stateFile, "utf8"));
  try {
    for (; index < stages.length; index++) {
      const { mode, next } = stages[index];
      await fs.appendFile(
        path.join(root, "stages.jsonl"),
        JSON.stringify({ mode, hostPid: process.pid, appPid: process.ppid }) +
          "\n",
      );
      let timeout;
      try {
        await Promise.race([
          require("./suite.cjs").run(mode, context),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Timed out scenario: " + mode)),
              90000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      await closeEditors();
      if (mode === "cleared") {
        const extension = vscode.extensions.getExtension(
          "afl-local.afl-vscode",
        );
        await fs.writeFile(
          path.join(extension.extensionPath, "dist/server.cjs"),
          'throw new Error("AFL E2E injected startup failure");',
        );
      }
      await fs.writeFile(stateFile, JSON.stringify({ index: index + 1 }));
      if (next) {
        // Reload disposes this host's command connection; cancellation is normal.
        void vscode.commands.executeCommand(next).catch(async (error) => {
          if (error.name === "Canceled") {
            return;
          }
          await fs.writeFile(
            path.join(root, "driver-error.json"),
            JSON.stringify({ index, error: error.stack ?? String(error) }),
          );
          await vscode.commands.executeCommand("workbench.action.quit");
        });
        return;
      }
    }
  } catch (error) {
    await fs.writeFile(
      path.join(root, "driver-error.json"),
      JSON.stringify({ index, error: error.stack ?? String(error) }),
    );
    await closeEditors();
  }
  await vscode.commands.executeCommand("workbench.action.quit");
}
exports.activate = (context) => {
  // Finish activation before a stage can reload the window.
  setImmediate(() => {
    void run(context).catch((error) => console.error(error));
  });
};
