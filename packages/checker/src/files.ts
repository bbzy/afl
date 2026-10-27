import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface FileState {
  sha256: string;
  bytes: number;
  mode: number;
  identity: string;
}
export const identity = (stat: { dev: number; ino: number }): string =>
  `${stat.dev}:${stat.ino}`;
const digest = (content: Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");
const conflict = (message: string): never => {
  throw new Error(message);
};
async function info(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function readRegularFile(
  path: string,
): Promise<{ state: FileState; content: Uint8Array } | undefined> {
  const entry = await info(path);
  if (!entry) return undefined;
  if (!entry.isFile() || entry.isSymbolicLink())
    conflict(
      `Expected a regular file, not a directory or symbolic link: '${path}'.`,
    );
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat(),
      content = await handle.readFile(),
      after = await handle.stat();
    if (
      !before.isFile() ||
      identity(before) !== identity(entry) ||
      identity(await lstat(path)) !== identity(before) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      conflict(`File changed while being read: '${path}'.`);
    }
    return {
      content,
      state: {
        sha256: digest(content),
        bytes: content.byteLength,
        mode: after.mode & 0o777,
        identity: identity(after),
      },
    };
  } finally {
    await handle.close();
  }
}
