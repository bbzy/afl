import type { CrateContext } from "./analyzer.js";

export const crateIdPattern = /^[a-z][a-z0-9_-]*$/u;
const namePattern = /^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)?$/u;
const identifierPattern = /^[A-Za-z_][A-Za-z_0-9]*$/u;
const encodeName = (name: string): string | undefined => {
  const dot = name.indexOf("."),
    owner = dot < 0 ? name : name.slice(0, dot);
  if (!identifierPattern.test(owner)) return undefined;
  return dot < 0
    ? owner
    : `${owner}.${encodeURIComponent(name.slice(dot + 1))}`;
};

export interface SymbolTarget {
  readonly uri: string;
  readonly name: string;
}

/** Portable declaration identity; snapshot IDs continue to serve local navigation. */
export function symbolPath(
  crate: CrateContext,
  uri: string,
  name: string,
): string | undefined {
  if (
    !crate.id ||
    !crateIdPattern.test(crate.id) ||
    !uri.startsWith(crate.root)
  )
    return undefined;
  const module = uri.slice(crate.root.length);
  if (!module.endsWith(".afl")) return undefined;
  try {
    const parts = module.split("/").map(decodeURIComponent);
    if (
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[\\/\u0000-\u001f\u007f]/u.test(part),
      )
    )
      return undefined;
    const encodedName = encodeName(name);
    return encodedName === undefined
      ? undefined
      : `afl://${crate.id}/${parts.map(encodeURIComponent).join("/")}#${encodedName}`;
  } catch {
    return undefined;
  }
}

/** Resolve only within the caller's loaded crate graph; no filesystem or implicit dependencies. */
export function resolveSymbolPath(
  path: string,
  crates: readonly CrateContext[],
  fromCrate?: string,
): SymbolTarget | undefined {
  let crate: CrateContext | undefined, module: string, name: string;
  if (path.startsWith("afl://")) {
    const match = /^afl:\/\/([a-z][a-z0-9_-]*)\/([^#?]+)#(.+)$/u.exec(path);
    if (!match) return undefined;
    const candidates = crates.filter((item) => item.id === match[1]);
    if (candidates.length !== 1) return undefined;
    crate = candidates[0]!;
    module = match[2]!;
    try {
      name = decodeURIComponent(match[3]!);
      if (encodeName(name) !== match[3]) return undefined;
    } catch {
      return undefined;
    }
  } else {
    const parts = path.split("::");
    crate = crates.find((item) => item.root === fromCrate);
    if (!crate) return undefined;
    if (parts.shift() === "dep") {
      const alias = parts.shift();
      if (!alias || !identifierPattern.test(alias)) return undefined;
      const root = crate.dependencies[alias];
      crate = crates.find((item) => item.root === root);
    } else if (!path.startsWith("crate::")) return undefined;
    if (!crate || parts.length < 2) return undefined;
    name = parts.pop()!;
    if (
      !namePattern.test(name) ||
      parts.some((part) => !identifierPattern.test(part))
    )
      return undefined;
    module = parts.join("/") + ".afl";
  }
  if (fromCrate !== undefined) {
    const caller = crates.find((item) => item.root === fromCrate);
    if (
      !caller ||
      (crate.root !== caller.root &&
        !Object.values(caller.dependencies).includes(crate.root))
    )
      return undefined;
  }
  if (!module.endsWith(".afl")) return undefined;
  try {
    const parts = module.split("/").map(decodeURIComponent);
    if (
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[\\/\u0000-\u001f\u007f]/u.test(part),
      )
    )
      return undefined;
    const uri = new URL(parts.map(encodeURIComponent).join("/"), crate.root)
      .href;
    if (!uri.startsWith(crate.root)) return undefined;
    if (
      crates.some(
        (other) =>
          other.root !== crate.root &&
          other.root.startsWith(crate.root) &&
          uri.startsWith(other.root),
      )
    )
      return undefined;
    if (path.startsWith("afl://") && symbolPath(crate, uri, name) !== path)
      return undefined;
    return { uri, name };
  } catch {
    return undefined;
  }
}
