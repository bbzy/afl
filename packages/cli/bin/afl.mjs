#!/usr/bin/env node
// Keep the npm entry available before the TypeScript implementation is built.
import { existsSync } from "node:fs";

const entry = new URL("../dist/afl.js", import.meta.url);
if (existsSync(entry)) {
  await import(entry.href);
} else {
  process.stderr.write(
    "afl: Run npm run build in the AFL tool repository first.\n",
  );
  process.exitCode = 2;
}
