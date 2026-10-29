import assert from "node:assert/strict";
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export function run(
  command: string,
  args: (string | number)[],
  options: Partial<SpawnSyncOptionsWithStringEncoding> = {},
) {
  const result = spawnSync(command, args.map(String), {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.status,
  };
}

export function writeFiles(root: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
}

export function runQuery(cli: string, args: string[], expected = 0) {
  const result = run(process.execPath, [cli, ...args, "--json"]);
  assert.equal(result.exit_code, expected, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

export function globSync(pattern: string): string[] {
  const [root, suffix] = pattern.split("/**/");
  const extension = suffix.replace("*", "");
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}
