import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatDocument,
  formatIndent,
  type Diagnostic,
  type FormatOptions,
} from "@afl/checker";
import {
  ignoredDirectories,
  identity,
  readRegularFile,
} from "@afl/checker/node";

export async function formatFiles(
  inputs: readonly string[],
  options: FormatOptions,
  check: boolean,
) {
  formatIndent(options);
  const selected = new Map<string, string>(),
    directories = new Map<string, string>();
  const visit = async (path: string, explicit: boolean): Promise<void> => {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      if (explicit)
        throw new Error(`Formatting does not follow symbolic links: ${path}`);
      return;
    }
    const canonical = await realpath(path);
    if (
      (!explicit && canonical !== path) ||
      identity(await lstat(canonical)) !== identity(info)
    ) {
      throw new Error(
        `Path changed during formatting; nothing written: ${path}`,
      );
    }
    if (info.isDirectory()) {
      directories.set(canonical, identity(info));
      for (const name of (await readdir(canonical)).sort())
        if (!ignoredDirectories.has(name))
          await visit(join(canonical, name), false);
    } else if (info.isFile() && extname(path) === ".afl")
      selected.set(canonical, identity(info));
    else if (explicit)
      throw new Error(`Expected an AFL file or directory: ${path}`);
  };
  for (const path of inputs.length ? inputs : ["."])
    await visit(resolve(path), true);
  const verifyDirectories = async (): Promise<void> => {
    for (const [path, expected] of directories) {
      const entry = await lstat(path);
      if (
        entry.isSymbolicLink() ||
        identity(entry) !== expected ||
        (await realpath(path)) !== path
      ) {
        throw new Error(
          `Directory changed during formatting; nothing written: ${path}`,
        );
      }
    }
  };
  await verifyDirectories();
  const diagnostics: Diagnostic[] = [],
    files = [];
  for (const [path, expected] of [...selected].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const snapshot = await readRegularFile(path);
    if (!snapshot || snapshot.state.identity !== expected)
      throw new Error(
        `File changed during formatting; nothing written: ${path}`,
      );
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(snapshot.content);
    const document = { uri: pathToFileURL(path).href, text };
    const result = formatDocument(document, options);
    diagnostics.push(...result.diagnostics);
    files.push({
      path,
      snapshot,
      formatted: result.text,
      changed: text !== result.text,
    });
  }
  let written = false;
  if (!check && !diagnostics.length) {
    const handles: { file: (typeof files)[number]; handle: FileHandle }[] = [];
    try {
      // Hold the original files through publication so a replacement cannot redirect writes.
      for (const file of files) {
        const handle = file.changed
          ? await open(
              file.path,
              constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
            )
          : undefined;
        if (handle) handles.push({ file, handle });
        const current = await readRegularFile(file.path);
        if (
          (handle &&
            identity(await handle.stat()) !== file.snapshot.state.identity) ||
          !current ||
          current.state.identity !== file.snapshot.state.identity ||
          current.state.sha256 !== file.snapshot.state.sha256
        ) {
          throw new Error(
            `File changed during formatting; nothing written: ${file.path}`,
          );
        }
      }
      await verifyDirectories();
      for (const { file, handle } of handles)
        if (file.changed) {
          const content = new TextEncoder().encode(file.formatted);
          await handle.writeFile(content);
          await handle.truncate(content.byteLength);
          const entry = await lstat(file.path);
          if (
            entry.isSymbolicLink() ||
            identity(entry) !== file.snapshot.state.identity ||
            (await realpath(file.path)) !== file.path
          ) {
            throw new Error(
              `File was replaced during formatting; stopped writing: ${file.path}`,
            );
          }
        }
      written = true;
    } finally {
      await Promise.all(handles.map(({ handle }) => handle.close()));
    }
  }
  return {
    status: "complete" as const,
    check,
    files: files.map(({ path, changed }) => ({
      path,
      changed,
      written: changed && written,
    })),
    diagnostics,
  };
}
