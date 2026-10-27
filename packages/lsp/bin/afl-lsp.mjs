#!/usr/bin/env node
import { existsSync } from "node:fs";

const server = new URL("../dist/server.cjs", import.meta.url);
if (!existsSync(server)) {
  console.error(
    "AFL language server has not been built. Run npm run build first.",
  );
  process.exitCode = 2;
} else {
  await import(server.href);
}
