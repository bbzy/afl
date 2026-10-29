import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../support.js";
const suiteDirectory = path.join(process.argv[2], "tests/release");
const fixtureDirectory = process.argv[3];
const project_root = path.dirname(path.dirname(suiteDirectory));
const version = JSON.parse(
  fs.readFileSync(path.join(project_root, "package.json"), "utf8"),
).version;
const fixture = fixtureDirectory;
try {
  const result = await inspectPackage(project_root, fixture, version);
  assert.deepEqual(result.checksumResults, [true, true, true]);
  assert.deepEqual(result.archiveNames, [
    "afl-cli-" + String(version) + ".tgz",
    "afl-vscode-" + String(version) + ".vsix",
    "afl-skill-" + String(version) + ".zip",
  ]);
  assert.deepEqual(result.cliManifest.version, version);
  assert.deepEqual(result.cliManifest.type, "module");
  assert(!Object.keys(result.cliManifest).includes("dependencies"));
  for (const obsolete of [
    "afl-cli-" + String(version) + ".tar.gz",
    "afl-lsp-" + String(version) + ".tar.gz",
    "afl-" + String(version) + ".zip",
  ]) {
    assert(!fs.existsSync(path.join(project_root, "release", obsolete)));
  }
  assert.deepEqual(result.vsixManifest.version, version);
  assert.deepEqual(result.vsixManifest.publisher, "afl-local");
  assert(!Object.keys(result.vsixManifest).includes("dependencies"));
  assert(result.vsixEntries.includes("extension/dist/server.cjs"));
  assert(result.vsixEntries.includes("extension/syntaxes/afl.tmLanguage.json"));
  assert(result.vsixEntries.includes("extension/language-configuration.json"));
  assert(
    !result.vsixEntries.includes(
      "extension/syntaxes/afl-template.tmLanguage.json",
    ),
  );
  assert(
    !result.vsixEntries.includes(
      "extension/syntaxes/afl-template-kotlin.tmLanguage.json",
    ),
  );
  assert(
    !result.vsixEntries.includes(
      "extension/syntaxes/afl-template-python.tmLanguage.json",
    ),
  );
  assert(
    !result.vsixEntries.includes(
      "extension/template-language-configuration.json",
    ),
  );
  assert.deepEqual(
    result.vsixManifest.contributes.grammars[0].scopeName,
    "source.afl",
  );
  assert(result.vsixEntries.every((file) => !file.includes("node_modules")));
  assert(result.readme.includes("No separate server installation"));
  assert.deepEqual([...result.skillEntries].sort(), [
    "afl/SKILL.md",
    "afl/references/implementations.md",
    "afl/references/language.md",
  ]);
  assert(result.skillText.includes("references/language.md"));
  assert.deepEqual(
    result.skillText,
    fs.readFileSync(path.join(project_root, "skills/afl/SKILL.md"), "utf8"),
    "Release skill must match its reviewed source instructions",
  );
  assert.deepEqual(
    result.associationProtocol,
    fs.readFileSync(path.join(project_root, "docs/implementations.md"), "utf8"),
    "Bundled association protocol must match its reviewed source document",
  );
  assert(result.skillText.includes("npm install --global"));
  assert(result.spec.includes("# AFL language specification"));
  const source_spec = fs.readFileSync(
    path.join(project_root, "docs/language.md"),
    "utf8",
  );
  assert(
    result.spec.endsWith(source_spec),
    "Bundled specification must preserve the complete source document",
  );
  assert(
    !new RegExp("[\\p{Script=Han}]", "u").test(result.spec),
    "Bundled specification must be English",
  );
  assert(!result.spec.includes("## Harness"));
  assert(!result.spec.includes("## Architecture"));
  for (const section of [
    "Repairing diagnostics",
    "Inherited implementation documentation",
    "String literal unions",
    "Numeric operations",
    "List sorting",
    "Grouped imports",
    "Unsupported platform capabilities",
    "Static properties and constants",
  ]) {
    assert(
      result.spec.includes("## " + String(section) + ""),
      "Bundled specification is missing: " + String(section) + "",
    );
  }
  assert(result.spec.includes("halves away from zero"));
  assert(result.spec.includes("stable ascending"));
  assert(!result.spec.includes("/Users/"));
  assert(!result.spec.includes("TASK_BOARD"));
  assert(!result.skillText.includes("references/demo/"));
  assert(!result.spec.includes("](demo/"));
  const prefix = path.join(fixture, "global");
  const installed = run("npm", [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--cache",
    path.join(fixture, "npm-cache"),
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    path.join(project_root, "release", "afl-cli-" + String(version) + ".tgz"),
  ]);
  if (installed.exit_code !== 0) {
    throw new Error(
      {
        msg: "" + String(installed.stdout) + "" + String(installed.stderr) + "",
      }.msg,
    );
  }
  const cli = path.join(prefix, "bin/afl");
  fs.writeFileSync(path.join(fixture, "main.afl"), "fn main() {}");
  fs.writeFileSync(path.join(fixture, "config.toml"), "[dep]");
  const cli_version = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(fixture);
      return run(cli, ["--version"]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(cli_version.exit_code, 0);
  assert.deepEqual(cli_version.stdout.trim(), version);
  const valid = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(fixture);
      return run(cli, ["check", "main.afl", "--json"]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(valid.exit_code, 0);
  const symbols = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(fixture);
      return run(cli, ["symbols", "main.afl", "--json"]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(symbols.exit_code, 0, symbols.stdout);
  assert.deepEqual(
    JSON.parse(symbols.stdout).results.map((item) => item.name),
    ["main"],
  );
  const definition = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(fixture);
      return run(cli, [
        "definition",
        "main.afl",
        "--line",
        1,
        "--column",
        4,
        "--json",
      ]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(definition.exit_code, 0, definition.stdout);
  assert.deepEqual(JSON.parse(definition.stdout).results[0].range.start, {
    line: 0,
    character: 3,
  });
  const references = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(fixture);
      return run(cli, [
        "references",
        "main.afl",
        "--line",
        1,
        "--column",
        4,
        "--json",
      ]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(references.exit_code, 0, references.stdout);
  assert.deepEqual(JSON.parse(references.stdout).results, []);
  fs.mkdirSync(path.join(fixture, ".format-fixture"), { recursive: true });
  const format_file = path.join(fixture, ".format-fixture/format.afl");
  fs.writeFileSync(format_file, "fn formatted(){}");
  const needs_format = run(cli, ["format", format_file, "--check", "--json"]);
  assert.deepEqual(needs_format.exit_code, 1);
  const formatted = run(cli, ["format", format_file, "--json"]);
  assert.deepEqual(formatted.exit_code, 0, formatted.stdout);
  assert.deepEqual(fs.readFileSync(format_file, "utf8"), "fn formatted() {}\n");
  const stable = run(cli, ["format", format_file, "--check", "--json"]);
  assert.deepEqual(stable.exit_code, 0, stable.stdout);
  const associations = path.join(project_root, "demo/implementations");
  for (const preset of ["kotlin", "python"]) {
    const checked = run(cli, [
      "check",
      associations,
      "--preset",
      preset,
      "--json",
    ]);
    assert.deepEqual(checked.exit_code, 0, checked.stdout);
    assert.deepEqual(JSON.parse(checked.stdout).diagnostics, []);
  }
  const traced = run(cli, [
    "trace",
    path.join(associations, "native/Counter.kt"),
    "--line",
    5,
    "--project",
    associations,
    "--json",
  ]);
  assert.deepEqual(traced.exit_code, 0, traced.stdout);
  assert.deepEqual(JSON.parse(traced.stdout).results.length, 2);
  const impact = run(cli, [
    "impact",
    path.join(associations, "shared/lib.afl"),
    "--project",
    associations,
    "--json",
  ]);
  assert.deepEqual(impact.exit_code, 0, impact.stdout);
  assert.deepEqual(JSON.parse(impact.stdout).implementations.length, 4);
  const removed = run(cli, ["generate", associations, "--json"]);
  assert.deepEqual(removed.exit_code, 2);
  const specifications = run(cli, [
    "symbols",
    path.join(project_root, "demo/test-specs"),
    "--preset",
    "android",
    "--json",
  ]);
  assert.deepEqual(specifications.exit_code, 0, specifications.stdout);
  const specification_result = JSON.parse(specifications.stdout);
  assert.deepEqual(specification_result.scope.tests.length, 2);
  assert.deepEqual(specification_result.scope.files.length, 4);
  assert(
    specification_result.results
      .map((item) => item.name)
      .includes("addition_examples"),
  );
  for (const preset of ["android", "ios"]) {
    const checked = run(cli, [
      "check",
      path.join(project_root, "demo/edge"),
      "--preset",
      preset,
      "--json",
    ]);
    assert.deepEqual(checked.exit_code, 0, checked.stdout);
    assert.deepEqual(JSON.parse(checked.stdout).diagnostics, []);
    const implementation = run(cli, [
      "implementations",
      path.join(project_root, "demo/edge/core/ui.afl"),
      "--line",
      1,
      "--column",
      11,
      "--project",
      path.join(project_root, "demo/edge"),
      "--preset",
      preset,
      "--json",
    ]);
    assert.deepEqual(implementation.exit_code, 0, implementation.stdout);
    const locations = JSON.parse(implementation.stdout).results;
    assert.deepEqual(locations.length, 1);
    assert(locations[0].path.includes("/" + String(preset) + "/"));
  }
  fs.writeFileSync(path.join(fixture, "main.afl"), "fn main() { missing() }");
  const invalid = (() => {
    const previousDirectory = process.cwd();
    try {
      process.chdir(fixture);
      return run(cli, ["check", "main.afl", "--json"]);
    } finally {
      process.chdir(previousDirectory);
    }
  })();
  assert.deepEqual(invalid.exit_code, 1);
  assert(invalid.stdout.includes("AFL"));
  const vscode = run("nu", [
    "--no-config-file",
    path.join(project_root, "tests/vscode/vscode.nu"),
    "--extension-root",
    path.join(fixture, "vsix/extension"),
  ]);
  if (vscode.exit_code !== 0) {
    throw new Error(
      { msg: "" + String(vscode.stdout) + "" + String(vscode.stderr) + "" }.msg,
    );
  }
  const source = path.join(fixture, "source");
  fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(source, "packages/cli"), { recursive: true });
  fs.cpSync(
    path.join(project_root, "scripts/package.mjs"),
    path.join(source, "scripts/package.mjs"),
    { recursive: true },
  );
  run("ln", [
    "-s",
    path.join(project_root, "node_modules"),
    path.join(source, "node_modules"),
  ]);
  fs.writeFileSync(
    path.join(source, "package.json"),
    JSON.stringify({
      version: version,
      type: "module",
      workspaces: ["packages/cli"],
    }),
  );
  fs.writeFileSync(
    path.join(source, "packages/cli/package.json"),
    JSON.stringify({ name: "@afl/cli", version: "999.0.0" }),
  );
  const mismatch = run(process.execPath, [
    path.join(source, "scripts/package.mjs"),
  ]);
  assert(mismatch.exit_code !== 0);
  assert(mismatch.stderr.includes("expected version " + String(version) + ""));
  assert(!fs.existsSync(path.join(source, "release")));
  console.log(
    "Release checks passed: checksums, offline npm global CLI installation, extracted VSIX integration and skill instructions/specification.",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

async function inspectPackage(root: string, fixture: string, version: string) {
  const { createHash } = await import("node:crypto");
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");

  const require = createRequire(join(root, "package.json"));
  const { unzipSync } = require("fflate");
  const { extract } = require("tar");
  const release = join(root, "release");
  const decode = (bytes) => Buffer.from(bytes).toString("utf8");
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const outerSums = decode(await readFile(join(release, "SHA256SUMS")))
    .trim()
    .split("\n");
  const checksumResults = [];
  for (const line of outerSums) {
    const [hash, file] = line.split("  ");
    checksumResults.push(hash === digest(await readFile(join(release, file))));
  }
  const archiveNames = outerSums.map((line) => line.split("  ")[1]);
  await extract({
    cwd: fixture,
    file: join(release, `afl-cli-${version}.tgz`),
  });
  const cliManifest = JSON.parse(
    await readFile(join(fixture, "package/package.json"), "utf8"),
  );
  const vsix: Record<string, Uint8Array> = unzipSync(
    await readFile(join(release, `afl-vscode-${version}.vsix`)),
  );
  for (const [file, bytes] of Object.entries(vsix)) {
    if (file.endsWith("/")) {
      continue;
    }
    await mkdir(dirname(join(fixture, "vsix", file)), { recursive: true });
    await writeFile(join(fixture, "vsix", file), bytes);
  }
  const skill = unzipSync(
    await readFile(join(release, `afl-skill-${version}.zip`)),
  );
  return {
    checksumResults,
    archiveNames,
    cliManifest,
    vsixEntries: Object.keys(vsix),
    vsixManifest: JSON.parse(decode(vsix["extension/package.json"])),
    readme: decode(vsix["extension/readme.md"]),
    skillEntries: Object.keys(skill),
    skillText: decode(skill["afl/SKILL.md"]),
    spec: decode(skill["afl/references/language.md"]),
    associationProtocol: decode(skill["afl/references/implementations.md"]),
  };
}
