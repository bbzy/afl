/** A source snapshot; hosts supply file contents, including unsaved edits. */
export interface SourceDocument {
  readonly uri: string;
  readonly text: string;
}

/** Zero-based lines and UTF-16 character offsets, matching editor positions. */
export interface SourcePosition {
  readonly line: number;
  readonly character: number;
}

export interface Diagnostic {
  readonly uri: string;
  readonly code: string;
  readonly severity: "error" | "warning" | "information";
  readonly relatedInformation?: readonly {
    location: { uri: string; range: Diagnostic["range"] };
    message: string;
  }[];
  readonly message: string;
  readonly range: {
    readonly start: SourcePosition;
    readonly end: SourcePosition;
  };
}

export interface CheckResult {
  readonly status: "complete";
  readonly diagnostics: readonly Diagnostic[];
}

export {
  type CheckContext,
  type CrateContext,
  type PresetContext,
} from "./analyzer.js";
export { parseDocument, type ParseResult } from "./parser.js";
export type * from "./ast.js";
export {
  LanguageService,
  type Location,
  type Range,
  type Completion,
  type Hover,
  type Signature,
  type OutlineSymbol,
} from "./editor.js";
export {
  symbolPath,
  resolveSymbolPath,
  type SymbolTarget,
} from "./symbol-path.js";
export {
  formatDocument,
  formatIndent,
  type FormatOptions,
  type FormatResult,
} from "./format.js";

export {
  parseAssociations,
  type AssociationSet,
  type NativeAssociation,
  type NativeImplementation,
} from "./associations.js";
import { LanguageService } from "./editor.js";
import type { CheckContext } from "./analyzer.js";

export function checkProject(
  documents: readonly SourceDocument[],
  context: CheckContext = {},
): CheckResult {
  const service = new LanguageService();
  service.update(documents, context);
  return { status: "complete", diagnostics: service.diagnostics };
}
