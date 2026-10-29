import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/cli");
const fixtureDirectory = process.argv[3];
const project_root = path.dirname(path.dirname(suiteDirectory));
const cli = path.join(project_root, "packages", "cli", "dist", "afl.js");
const cli_manifest = JSON.parse(
  fs.readFileSync(
    path.join(project_root, "packages", "cli", "package.json"),
    "utf8",
  ),
);
const fixture = fixtureDirectory;
try {
  const help = run(process.execPath, [cli, "--help"]);
  assert.deepEqual(help.exit_code, 0);
  assert(help.stdout.includes("afl check"));
  const version = run(process.execPath, [cli, "--version"]);
  assert.deepEqual(version.exit_code, 0);
  assert.deepEqual(version.stdout.trim(), cli_manifest.version);
  const installed_entry = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(project_root);
      return run("npm", ["exec", "--offline", "--", "afl", "--version"]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(installed_entry.exit_code, 0);
  assert.deepEqual(installed_entry.stdout.trim(), cli_manifest.version);
  fs.mkdirSync(path.join(fixture, "unbuilt", "bin"), { recursive: true });
  const unbuilt_launcher = path.join(fixture, "unbuilt", "bin", "afl.mjs");
  fs.cpSync(
    path.join(project_root, "packages", "cli", "bin", "afl.mjs"),
    unbuilt_launcher,
    { recursive: true },
  );
  const unbuilt = run(process.execPath, [unbuilt_launcher, "--help"]);
  assert.deepEqual(unbuilt.exit_code, 2);
  assert(unbuilt.stderr.includes("npm run build"));
  fs.mkdirSync(path.join(fixture, "nested dir"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "node_modules"), { recursive: true });
  const first_source = path.join(fixture, "first.afl");
  fs.writeFileSync(path.join(fixture, "main.afl"), "fn main() {}");
  fs.writeFileSync(path.join(fixture, "config.toml"), "[dep]");
  fs.writeFileSync(first_source, "fn first() { missing_first() }");
  fs.writeFileSync(
    path.join(fixture, "nested dir", "second.afl"),
    "fn second() { missing_second() }",
  );
  fs.writeFileSync(
    path.join(fixture, "node_modules", "ignored.afl"),
    "Ignored dependency source.",
  );
  fs.writeFileSync(path.join(fixture, "notes.txt"), "Unrelated file.");
  const check = run(process.execPath, [
    cli,
    "check",
    fixture,
    first_source,
    "--json",
  ]);
  assert.deepEqual(check.exit_code, 1);
  assert.deepEqual(check.stderr, "");
  const result = JSON.parse(check.stdout);
  assert.deepEqual(result.status, "complete");
  assert.deepEqual(result.diagnostics.length, 2);
  assert.deepEqual(
    [...new Set(result.diagnostics.map((item) => item.uri))].length,
    2,
  );
  assert(result.diagnostics.every((item) => item.code === "AFL3203"));
  assert(result.diagnostics.every((item) => item.severity === "error"));
  assert(
    result.diagnostics
      .map((item) => item.uri)
      .every((uri) => uri.startsWith("file:///")),
  );
  const text_check = run(process.execPath, [cli, "check", first_source]);
  assert.deepEqual(text_check.exit_code, 1);
  assert(text_check.stdout.includes(":1:14 error AFL3203"));
  const default_check = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(fixture);
      return run(process.execPath, [cli, "check", "--json"]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(default_check.exit_code, 1);
  assert.deepEqual(JSON.parse(default_check.stdout), result);
  const missing = run(process.execPath, [
    cli,
    "check",
    path.join(fixture, "missing.afl"),
    "--json",
  ]);
  assert.deepEqual(missing.exit_code, 2);
  assert.deepEqual(JSON.parse(missing.stdout).status, "error");
  fs.mkdirSync(path.join(fixture, "empty"), { recursive: true });
  const empty = run(process.execPath, [
    cli,
    "check",
    path.join(fixture, "empty"),
    "--json",
  ]);
  assert.deepEqual(empty.exit_code, 2);
  assert.deepEqual(JSON.parse(empty.stdout).status, "error");
  const wrong_file = run(process.execPath, [
    cli,
    "check",
    path.join(fixture, "notes.txt"),
    "--json",
  ]);
  assert.deepEqual(wrong_file.exit_code, 2);
  assert.deepEqual(JSON.parse(wrong_file.stdout).status, "error");
  const unknown = run(process.execPath, [cli, "unknown"]);
  assert.deepEqual(unknown.exit_code, 2);
  assert(unknown.stderr.includes("Unknown command"));
  const unknown_option = run(process.execPath, [cli, "check", "--unknown"]);
  assert.deepEqual(unknown_option.exit_code, 2);
  assert(!(unknown_option.stderr.length === 0));
  const extension = run("nu", [
    "--no-config-file",
    path.join(project_root, "tests", "vscode", "vscode.nu"),
  ]);
  if (extension.exit_code !== 0) {
    throw new Error(
      {
        msg:
          "VS Code adapter checks failed:\\n" +
          String(extension.stdout) +
          "" +
          String(extension.stderr) +
          "",
      }.msg,
    );
  }
  console.log(extension.stdout);
  console.log("CLI smoke checks passed.");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
