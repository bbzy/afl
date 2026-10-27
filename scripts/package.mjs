import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { zipSync } from "fflate";
import { createVSIX } from "@vscode/vsce";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await json(join(root, "package.json"));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error("Invalid release version");
const workspaces = new Map();
for (const path of manifest.workspaces) {
  const directory = join(root, path);
  const pkg = await json(join(directory, "package.json"));
  if (pkg.version !== version)
    throw new Error(
      `${pkg.name}: expected version ${version}, found ${pkg.version}`,
    );
  workspaces.set(pkg.name, { directory, pkg });
}
for (const path of [
  "cli/dist/afl.js",
  "vscode/dist/extension.cjs",
  "vscode/dist/server.cjs",
]) {
  await access(join(root, "packages", path));
}
const output = join(root, "release");
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(output, ".stage-"));
const artifacts = [];
const write = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
};
const copy = async (from, to) => {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
};

// Preserve notices for runtime dependencies, including dependencies bundled through workspaces.
async function notices(name, destination) {
  const seen = new Set();
  const lines = [];
  async function visit(directory, pkg) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!workspaces.has(pkg.name)) {
      lines.push(`${key}: ${pkg.license ?? "See included license"}`);
      for (const file of await readdir(directory)) {
        if (/^(licen[cs]e|notice)(?:[.-]|$)/i.test(file)) {
          await copy(
            join(directory, file),
            join(destination, "licenses", pkg.name.replaceAll("/", "-"), file),
          );
        }
      }
    }
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      const local = workspaces.get(dependency);
      if (local) {
        await visit(local.directory, local.pkg);
        continue;
      }
      const require = createRequire(join(directory, "package.json"));
      let path;
      try {
        path = dirname(require.resolve(`${dependency}/package.json`));
      } catch {
        path = dirname(require.resolve(dependency));
        while (true) {
          try {
            if ((await json(join(path, "package.json"))).name === dependency)
              break;
          } catch {}
          const parent = dirname(path);
          if (parent === path) throw new Error(`Cannot locate ${dependency}`);
          path = parent;
        }
      }
      await visit(path, await json(join(path, "package.json")));
    }
  }
  const entry = workspaces.get(name);
  await visit(entry.directory, entry.pkg);
  await write(
    join(destination, "THIRD_PARTY_NOTICES.txt"),
    `${lines.sort().join("\n")}\n`,
  );
}

async function zip(directory, target) {
  const files = {};
  async function visit(path, prefix = "") {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), `${name}/`);
      else if (entry.isFile())
        files[name] = new Uint8Array(await readFile(join(path, entry.name)));
      else throw new Error(`Unsupported archive entry: ${name}`);
    }
  }
  await visit(directory);
  await write(target, zipSync(files, { level: 9 }));
}
const checksum = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
try {
  const cli = join(stage, "cli");
  const { directory: cliSource, pkg: cliManifest } = workspaces.get("@afl/cli");
  for (const file of ["dist/afl.js", "dist/afl.js.map", "bin/afl.mjs"]) {
    await copy(join(cliSource, file), join(cli, file));
  }
  await chmod(join(cli, "bin/afl.mjs"), 0o755);
  await write(
    join(cli, "package.json"),
    JSON.stringify(
      {
        name: cliManifest.name,
        version,
        private: true,
        type: "module",
        engines: cliManifest.engines,
        bin: cliManifest.bin,
        files: ["bin", "dist", "licenses", "THIRD_PARTY_NOTICES.txt"],
      },
      null,
      2,
    ) + "\n",
  );
  await write(
    join(cli, "README.md"),
    `# AFL CLI ${version}\n\nRequires Node.js 22 or newer. Runtime dependencies are bundled.\n\nInstall: npm install --global ./afl-cli-${version}.tgz\n\nRun: afl check PROJECT --preset NAME --json\n\nAFL checks shared logic and Agent-maintained native implementation associations. Use implementations, trace and impact to navigate current locations. Native code is maintained directly; no generation or native parsing is provided.\n`,
  );
  await notices("@afl/cli", cli);
  const npmArgs = [
    "pack",
    "--json",
    "--ignore-scripts",
    "--offline",
    "--cache",
    join(stage, "npm-cache"),
    "--pack-destination",
    stage,
  ];
  const packed = JSON.parse(
    execFileSync(
      process.env.npm_execpath ? process.execPath : "npm",
      process.env.npm_execpath
        ? [process.env.npm_execpath, ...npmArgs]
        : npmArgs,
      { cwd: cli, encoding: "utf8" },
    ),
  );
  const cliArchive = `afl-cli-${version}.tgz`;
  if (packed.length !== 1 || packed[0].filename !== cliArchive)
    throw new Error("Unexpected npm pack output");
  artifacts.push(cliArchive);

  const extension = join(stage, "extension");
  const { directory, pkg } = workspaces.get("afl-vscode");
  const { dependencies, devDependencies, scripts, ...extensionManifest } = pkg;
  await write(
    join(extension, "package.json"),
    JSON.stringify(extensionManifest, null, 2) + "\n",
  );
  await write(
    join(extension, ".vscodeignore"),
    "# Files are selected explicitly by the release staging script.\n",
  );
  for (const file of [
    "extension.cjs",
    "server.cjs",
    "extension.cjs.map",
    "server.cjs.map",
  ]) {
    await copy(join(directory, "dist", file), join(extension, "dist", file));
  }
  await copy(join(directory, "syntaxes"), join(extension, "syntaxes"));
  await copy(join(directory, pkg.icon), join(extension, pkg.icon));
  await copy(
    join(directory, "language-configuration.json"),
    join(extension, "language-configuration.json"),
  );
  await write(
    join(extension, "README.md"),
    "# AFL\n\nAFL shared logic, diagnostics, definition/reference/implementation navigation, completion, hover and signature help. Format Document formats AFL only. Native implementation locations come from Agent-maintained association files.\n\nOpen an AFL file or run AFL: Select Preset to start the bundled language server. Choose the owning project for external native files. AFL: Trace Implementation reverses associations; AFL: Show Implementation Impact follows current AFL references. Unsaved native and association snapshots are supported. No native syntax or behavior is validated.\n\nInstall with Extensions: Install from VSIX. No separate server installation is required.\n",
  );
  await notices("afl-vscode", extension);
  const vsix = `afl-vscode-${version}.vsix`;
  await createVSIX({
    cwd: extension,
    packagePath: join(stage, vsix),
    dependencies: false,
    allowMissingRepository: true,
    skipLicense: true,
    rewriteRelativeLinks: false,
  });
  artifacts.push(vsix);

  const skill = join(stage, "skill", "afl");
  await copy(join(root, "skills", "afl", "SKILL.md"), join(skill, "SKILL.md"));
  const specification = await readFile(
    join(root, "docs", "language.md"),
    "utf8",
  );
  await write(
    join(skill, "references", "language.md"),
    "Repository paths in this reference refer to the AFL source checkout, not to files installed with the skill.\n\n" +
      specification,
  );
  await copy(
    join(root, "docs", "implementations.md"),
    join(skill, "references", "implementations.md"),
  );
  const skillArchive = `afl-skill-${version}.zip`;
  await zip(join(stage, "skill"), join(stage, skillArchive));
  artifacts.push(skillArchive);

  const sums = [];
  for (const file of artifacts)
    sums.push(`${await checksum(join(stage, file))}  ${file}`);
  await write(join(stage, "SHA256SUMS"), sums.join("\n") + "\n");
  // Only replace known outputs after all archives have been created successfully.
  for (const file of [...artifacts, "SHA256SUMS"])
    await rename(join(stage, file), join(output, file));
  // Remove superseded outputs for this version, preserving other versions and unrelated files.
  for (const file of [
    `afl-cli-${version}.tar.gz`,
    `afl-lsp-${version}.tar.gz`,
    `afl-${version}.zip`,
  ]) {
    await rm(join(output, file), { force: true });
  }
  console.log(
    `Packaged AFL ${version}:\n${artifacts.map((file) => `  release/${file}`).join("\n")}`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
