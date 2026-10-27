import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LanguageService, type SourceDocument } from "./index.js";
import {
  canonicalPath,
  loadProject,
  ProjectRoots,
  type LoadedProject,
} from "./node.js";

export const associationLimitations = [
  "Associations are Agent-maintained locations. In-range lines do not prove that a native symbol still exists there.",
  "AFL does not parse native languages or verify native signatures, behavior or dependencies.",
  "Impact follows the current AFL reference graph and configured test associations; it has no historical baseline.",
];
export function traceAssociations(
  service: LanguageService,
  file: string,
  line?: number,
) {
  return {
    status: "complete" as const,
    file,
    results: service.trace(file, line),
    diagnostics: service.diagnostics,
    limitations: associationLimitations,
  };
}
export function implementationImpact(
  service: LanguageService,
  project: LoadedProject,
  changed: readonly string[],
) {
  const impact = service.impact(changed);
  const affected = new Set(
    impact.declarations.flatMap((item) =>
      project.crates
        .filter((crate) => item.uri.startsWith(crate.root))
        .map((crate) => crate.root),
    ),
  );
  const testRoots = project.tests
    .filter((test) => affected.has(test.target))
    .flatMap((test) => test.crates);
  const tests = project.documents
    .filter((document) =>
      testRoots.some((root) => document.uri.startsWith(root)),
    )
    .map((document) => ({
      uri: document.uri,
      implementations: service.nativeImplementations.filter(
        (item) => service.resolveSymbol(item.afl)?.uri === document.uri,
      ),
    }));
  return {
    status: "complete" as const,
    ...impact,
    tests,
    diagnostics: service.diagnostics,
    limitations: associationLimitations,
  };
}
export async function loadAssociationQuery(
  file: string,
  project?: string,
  preset?: string,
  overlays: readonly SourceDocument[] = [],
) {
  let root = project ? resolve(project) : dirname(resolve(file));
  if (!project) {
    const roots = await ProjectRoots.create(overlays);
    while (!(await roots.root(root))) {
      const parent = dirname(root);
      if (parent === root) {
        throw new Error(
          "Cannot find an AFL project for this file. Use --project DIR for native files outside the project.",
        );
      }
      root = parent;
    }
  }
  const loaded = await loadProject([root], overlays, {
    project: true,
    ...(preset === undefined ? {} : { preset }),
  });
  const service = new LanguageService();
  service.update(loaded.documents, loaded);
  return { project: loaded, service };
}
export async function queryTrace(
  file: string,
  options: { project?: string; preset?: string; line?: number } = {},
) {
  const { service } = await loadAssociationQuery(
    file,
    options.project,
    options.preset,
  );
  return traceAssociations(
    service,
    pathToFileURL(await canonicalPath(resolve(file))).href,
    options.line,
  );
}
export async function queryImpact(
  project: string,
  preset: string | undefined,
  files: readonly string[],
) {
  const snapshot = await loadAssociationQuery(
    files[0] ?? project,
    project,
    preset,
  );
  const uris = await Promise.all(
    files.map(
      async (file) => pathToFileURL(await canonicalPath(resolve(file))).href,
    ),
  );
  return implementationImpact(snapshot.service, snapshot.project, uris);
}
