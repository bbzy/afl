import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "./support.js";

const [root, fixture] = process.argv.slice(2);
const configured = path.join(fixture, "configured temp");
const fallback = path.join(fixture, "fallback");
fs.mkdirSync(configured);
fs.mkdirSync(fallback);

function temporaryDirectory(
  prefix: string,
  fallbackPath: string,
  directory: string,
) {
  const result = run(
    "nu",
    [
      "--no-config-file",
      path.join(root, "tests/support/temporary-directory.nu"),
      prefix,
      fallbackPath,
    ],
    {
      env: { ...process.env, TEMP_DIR: directory, TMPDIR: fixture },
    },
  );
  assert.equal(result.exit_code, 0, result.stderr);
  const created = result.stdout.trim();
  assert(fs.existsSync(created));
  return created;
}

const first = temporaryDirectory("first", fallback, configured);
const second = temporaryDirectory("second", fallback, configured);
assert.equal(path.dirname(first), configured);
assert.equal(path.dirname(second), configured);
assert.notEqual(first, second);
const explicit = temporaryDirectory("fallback", fallback, "");
const system = temporaryDirectory("system", "", "");
assert.equal(path.dirname(explicit), fallback);
assert.equal(path.dirname(system), fixture);
console.log(
  "PASS test fixtures: TEMP_DIR precedence, spaces, unique directories and fallback paths",
);
