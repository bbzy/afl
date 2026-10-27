use ../support.nu temporary-directory
use std/assert

def main [] {
  let project_root = ($env.FILE_PWD | path dirname | path dirname)
  let version = (open ($project_root | path join "package.json") | get version)
  let fixture = (temporary-directory "package")
  try {
    # JS handles archive formats; assertions remain in Nushell.
    let bridge = r#'
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const [root, fixture, version] = process.argv.slice(1);
const require = createRequire(join(root, "package.json"));
const { unzipSync } = require("fflate");
const { extract } = require("tar");
const release = join(root, "release");
const decode = (bytes) => Buffer.from(bytes).toString("utf8");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const outerSums = decode(await readFile(join(release, "SHA256SUMS"))).trim().split("\n");
const checksumResults = [];
for (const line of outerSums) {
  const [hash, file] = line.split("  ");
  checksumResults.push(hash === digest(await readFile(join(release, file))));
}
const archiveNames = outerSums.map((line) => line.split("  ")[1]);
await extract({ cwd: fixture, file: join(release, `afl-cli-${version}.tgz`) });
const cliManifest = JSON.parse(await readFile(join(fixture, "package/package.json"), "utf8"));
const vsix = unzipSync(await readFile(join(release, `afl-vscode-${version}.vsix`)));
for (const [file, bytes] of Object.entries(vsix)) {
  if (file.endsWith("/")) continue;
  await mkdir(dirname(join(fixture, "vsix", file)), { recursive: true });
  await writeFile(join(fixture, "vsix", file), bytes);
}
const skill = unzipSync(await readFile(join(release, `afl-skill-${version}.zip`)));
console.log(JSON.stringify({ checksumResults, archiveNames, cliManifest,
  vsixEntries: Object.keys(vsix), vsixManifest: JSON.parse(decode(vsix["extension/package.json"])),
  readme: decode(vsix["extension/readme.md"]),
  skillEntries: Object.keys(skill), skillText: decode(skill["afl/SKILL.md"]),
  spec: decode(skill["afl/references/language.md"]),
  associationProtocol: decode(skill["afl/references/implementations.md"]),
}));
'#
    let execution = (do {
      cd $fixture
      ^node --input-type=module -e $bridge $project_root $fixture $version | complete
    })
    if $execution.exit_code != 0 { error make {msg: $"($execution.stdout)($execution.stderr)"} }
    let result = ($execution.stdout | from json)
    assert equal $result.checksumResults [true true true]
    assert equal $result.archiveNames [$"afl-cli-($version).tgz" $"afl-vscode-($version).vsix" $"afl-skill-($version).zip"]
    assert equal $result.cliManifest.version $version
    assert equal $result.cliManifest.type "module"
    assert ("dependencies" not-in ($result.cliManifest | columns))
    for obsolete in [$"afl-cli-($version).tar.gz" $"afl-lsp-($version).tar.gz" $"afl-($version).zip"] {
      assert (not ($project_root | path join "release" $obsolete | path exists))
    }
    assert equal $result.vsixManifest.version $version
    assert equal $result.vsixManifest.publisher "afl-local"
    assert ("dependencies" not-in ($result.vsixManifest | columns))
    assert ("extension/dist/server.cjs" in $result.vsixEntries)
    assert ("extension/syntaxes/afl.tmLanguage.json" in $result.vsixEntries)
    assert ("extension/language-configuration.json" in $result.vsixEntries)
    assert ("extension/syntaxes/afl-template.tmLanguage.json" not-in $result.vsixEntries)
    assert ("extension/syntaxes/afl-template-kotlin.tmLanguage.json" not-in $result.vsixEntries)
    assert ("extension/syntaxes/afl-template-python.tmLanguage.json" not-in $result.vsixEntries)
    assert ("extension/template-language-configuration.json" not-in $result.vsixEntries)
    assert equal $result.vsixManifest.contributes.grammars.0.scopeName "source.afl"
    assert ($result.vsixEntries | all {|file| not ($file | str contains "node_modules") })
    assert ($result.readme | str contains "No separate server installation")
    assert equal ($result.skillEntries | sort) ["afl/SKILL.md" "afl/references/implementations.md" "afl/references/language.md"]
    assert ($result.skillText | str contains "references/language.md")
    assert equal $result.skillText (open --raw ($project_root | path join "skills/afl/SKILL.md")) "Release skill must match its reviewed source instructions"
    assert equal $result.associationProtocol (open --raw ($project_root | path join "docs/implementations.md")) "Bundled association protocol must match its reviewed source document"
    assert ($result.skillText | str contains "npm install --global")
    assert ($result.spec | str contains "# AFL language specification")
    let source_spec = (open --raw ($project_root | path join "docs/language.md"))
    assert ($result.spec | str ends-with $source_spec) "Bundled specification must preserve the complete source document"
    assert (not ($result.spec =~ '[\p{Han}]')) "Bundled specification must be English"
    assert (not ($result.spec | str contains "## Harness"))
    assert (not ($result.spec | str contains "## Architecture"))
    for section in ["Repairing diagnostics" "Inherited implementation documentation" "String literal unions" "Numeric operations" "List sorting" "Grouped imports" "Unsupported platform capabilities" "Static properties and constants"] {
      assert ($result.spec | str contains $"## ($section)") $"Bundled specification is missing: ($section)"
    }
    assert ($result.spec | str contains "halves away from zero")
    assert ($result.spec | str contains "stable ascending")
    assert (not ($result.spec | str contains "/Users/"))
    assert (not ($result.spec | str contains "TASK_BOARD"))
    assert (not ($result.skillText | str contains "references/demo/"))
    assert (not ($result.spec | str contains "](demo/"))
    # Install the actual npm tarball into an isolated global prefix, with an empty cache.
    let prefix = ($fixture | path join "global")
    let installed = (^npm install --global --prefix $prefix --cache ($fixture | path join "npm-cache") --offline --ignore-scripts --no-audit --no-fund ($project_root | path join "release" $"afl-cli-($version).tgz") | complete)
    if $installed.exit_code != 0 { error make {msg: $"($installed.stdout)($installed.stderr)"} }
    let cli = ($prefix | path join "bin/afl")
    "fn main() {}" | save ($fixture | path join "main.afl")
    "[dep]" | save ($fixture | path join "config.toml")
    let cli_version = (do { cd $fixture; ^$cli --version | complete })
    assert equal $cli_version.exit_code 0
    assert equal ($cli_version.stdout | str trim) $version
    let valid = (do { cd $fixture; ^$cli check main.afl --json | complete })
    assert equal $valid.exit_code 0
    let symbols = (do { cd $fixture; ^$cli symbols main.afl --json | complete })
    assert equal $symbols.exit_code 0 $symbols.stdout
    assert equal ($symbols.stdout | from json | get results.name) [main]
    let definition = (do { cd $fixture; ^$cli definition main.afl --line 1 --column 4 --json | complete })
    assert equal $definition.exit_code 0 $definition.stdout
    assert equal ($definition.stdout | from json | get results.0.range.start) {line: 0, character: 3}
    let references = (do { cd $fixture; ^$cli references main.afl --line 1 --column 4 --json | complete })
    assert equal $references.exit_code 0 $references.stdout
    assert equal ($references.stdout | from json | get results) []
    mkdir ($fixture | path join ".format-fixture")
    let format_file = ($fixture | path join ".format-fixture/format.afl")
    "fn formatted(){}" | save $format_file
    let needs_format = (^$cli format $format_file --check --json | complete)
    assert equal $needs_format.exit_code 1
    let formatted = (^$cli format $format_file --json | complete)
    assert equal $formatted.exit_code 0 $formatted.stdout
    assert equal (open --raw $format_file) "fn formatted() {}\n"
    let stable = (^$cli format $format_file --check --json | complete)
    assert equal $stable.exit_code 0 $stable.stdout
    let associations = ($project_root | path join demo/implementations)
    for preset in [kotlin python] {
      let checked = (^$cli check $associations --preset $preset --json | complete)
      assert equal $checked.exit_code 0 $checked.stdout
      assert equal ($checked.stdout | from json | get diagnostics) []
    }
    let traced = (^$cli trace ($associations | path join native/Counter.kt) --line 5 --project $associations --json | complete)
    assert equal $traced.exit_code 0 $traced.stdout
    assert equal ($traced.stdout | from json | get results | length) 2
    let impact = (^$cli impact ($associations | path join shared/lib.afl) --project $associations --json | complete)
    assert equal $impact.exit_code 0 $impact.stdout
    assert equal ($impact.stdout | from json | get implementations | length) 4
    let removed = (^$cli generate $associations --json | complete)
    assert equal $removed.exit_code 2
    let specifications = (^$cli symbols ($project_root | path join demo/test-specs) --preset android --json | complete)
    assert equal $specifications.exit_code 0 $specifications.stdout
    let specification_result = ($specifications.stdout | from json)
    assert equal ($specification_result.scope.tests | length) 2
    assert equal ($specification_result.scope.files | length) 4
    assert ("addition_examples" in ($specification_result.results | get name))
    for preset in [android ios] {
      let checked = (^$cli check ($project_root | path join demo/edge) --preset $preset --json | complete)
      assert equal $checked.exit_code 0 $checked.stdout
      assert equal ($checked.stdout | from json | get diagnostics) []
      let implementation = (^$cli implementations ($project_root | path join demo/edge/core/ui.afl) --line 1 --column 11 --project ($project_root | path join demo/edge) --preset $preset --json | complete)
      assert equal $implementation.exit_code 0 $implementation.stdout
      let locations = ($implementation.stdout | from json | get results)
      assert equal ($locations | length) 1
      assert ($locations.0.path | str contains $"/($preset)/")
    }
    "fn main() { missing() }" | save --force ($fixture | path join "main.afl")
    let invalid = (do { cd $fixture; ^$cli check main.afl --json | complete })
    assert equal $invalid.exit_code 1
    assert ($invalid.stdout | str contains "AFL")

    let vscode = (^nu --no-config-file ($project_root | path join "tests/vscode/vscode.nu") --extension-root ($fixture | path join "vsix/extension") | complete)
    if $vscode.exit_code != 0 { error make {msg: $"($vscode.stdout)($vscode.stderr)"} }

    # Version mismatches must fail before writing any release files.
    let source = ($fixture | path join "source")
    mkdir ($source | path join "scripts") ($source | path join "packages/cli")
    cp ($project_root | path join "scripts/package.mjs") ($source | path join "scripts/package.mjs")
    ^ln -s ($project_root | path join "node_modules") ($source | path join "node_modules")
    {version: $version, type: module, workspaces: ["packages/cli"]} | to json | save ($source | path join "package.json")
    {name: "@afl/cli", version: "999.0.0"} | to json | save ($source | path join "packages/cli/package.json")
    let mismatch = (^node ($source | path join "scripts/package.mjs") | complete)
    assert ($mismatch.exit_code != 0)
    assert ($mismatch.stderr | str contains $"expected version ($version)")
    assert (not ($source | path join "release" | path exists))
    print "Release checks passed: checksums, offline npm global CLI installation, extracted VSIX integration and skill instructions/specification."
  } finally {
    rm --recursive --force $fixture
  }
}
