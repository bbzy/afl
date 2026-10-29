const fs = require("node:fs/promises"),
  path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");
const { execFileSync, spawn } = require("node:child_process");
const [root, fixture, version, configured] = process.argv.slice(2);
const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } =
  createRequire(path.join(root, "package.json"))("@vscode/test-electron");
(async () => {
  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY
  ) {
    throw new Error(
      "VS Code E2E requires a Linux desktop session. Run it under Xvfb or provide DISPLAY/WAYLAND_DISPLAY.",
    );
  }
  let executable = configured || process.env.AFL_VSCODE_EXECUTABLE;
  if (!executable && process.platform === "darwin") {
    for (const name of ["Code", "Electron"]) {
      const installed = `/Applications/Visual Studio Code.app/Contents/MacOS/${name}`;
      try {
        await fs.access(installed);
        executable = installed;
        break;
      } catch {}
    }
  }
  if (!executable) {
    const cachePath = path.join(
      process.env.TEMP_DIR || path.join(root, ".test-artifacts"),
      "vscode-download",
    );
    await fs.mkdir(cachePath, { recursive: true });
    executable = await downloadAndUnzipVSCode({ version: "stable", cachePath });
  }
  // Honor the configured location; the macOS default stays short for Unix sockets.
  const runtime = await fs.mkdtemp(
    path.join(
      process.env.TEMP_DIR ||
        (process.platform === "win32" ? os.tmpdir() : "/tmp"),
      "afl-e2e-",
    ),
  );
  const profile = path.join(runtime, "profile");
  let server, original;
  try {
    const extensions = path.join(fixture, "extensions");
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(
      executable,
      { reuseMachineInstall: true },
    );
    const install = execFileSync(
      cli,
      [
        ...cliArgs,
        "--user-data-dir",
        path.join(runtime, "install"),
        "--extensions-dir",
        extensions,
        "--install-extension",
        path.join(root, "release", `afl-vscode-${version}.vsix`),
        "--force",
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    await fs.writeFile(path.join(fixture, "install.log"), install);
    server = path.join(
      extensions,
      `afl-local.afl-vscode-${version}`,
      "dist/server.cjs",
    );
    original = await fs.readFile(server);
    await fs.mkdir(path.join(profile, "User"), { recursive: true });
    await fs.writeFile(
      path.join(profile, "User/settings.json"),
      JSON.stringify({
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "window.restoreWindows": "none",
        "workbench.startupEditor": "none",
        "files.hotExit": "off",
        "security.workspace.trust.enabled": false,
        // Keep word-based fallback suggestions out of language-provider assertions.
        "editor.wordBasedSuggestions": "off",
      }),
    );
    await fs.writeFile(
      path.join(fixture, "stage.json"),
      JSON.stringify({ index: 0 }),
    );
    // This is the only GUI process launch. Stage changes happen inside its window.
    const child = spawn(
      executable,
      [
        fixture,
        "--user-data-dir",
        profile,
        "--extensions-dir",
        extensions,
        "--new-window",
        "--no-sandbox",
        "--disable-gpu-sandbox",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--skip-add-to-recently-opened",
        "--disable-telemetry",
        "--extensionDevelopmentPath=" + path.join(fixture, "driver"),
      ],
      {
        stdio: "inherit",
        env: { ...process.env, AFL_E2E_ROOT: fixture },
      },
    );
    const kill = setTimeout(() => child.kill("SIGKILL"), 300000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          code === 0
            ? resolve()
            : reject(new Error(`VS Code exited with ${code ?? signal}`)),
        );
      });
    } finally {
      clearTimeout(kill);
    }
    await fs.writeFile(
      path.join(fixture, "launch.json"),
      JSON.stringify({ count: 1, appPid: child.pid }),
    );
    try {
      const error = JSON.parse(
        await fs.readFile(path.join(fixture, "driver-error.json"), "utf8"),
      );
      throw new Error(error.error);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    const state = JSON.parse(
      await fs.readFile(path.join(fixture, "stage.json"), "utf8"),
    );
    if (state.index !== 7) {
      throw new Error("VS Code exited before all scenarios completed");
    }
  } finally {
    if (original) {
      await fs.writeFile(server, original);
    }
    try {
      await fs.cp(profile, path.join(fixture, "profile"), { recursive: true });
    } finally {
      await fs.rm(runtime, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
