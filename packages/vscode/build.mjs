import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
};
await build({
  ...common,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  outfile: "dist/extension.cjs",
});
await build({
  ...common,
  entryPoints: ["../lsp/src/server.ts"],
  outfile: "dist/server.cjs",
});
