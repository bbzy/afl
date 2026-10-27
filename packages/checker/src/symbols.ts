import type { MethodSignature } from "./collections.js";
import type * as AST from "./ast.js";
import type { SourceDocument } from "./index.js";
import type { ParseResult } from "./parser.js";
import { keywords } from "./lexer.js";
import { Source } from "./source.js";

export const primitive = new Set([
  "bool",
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "f32",
  "f64",
  "char",
  "string",
  "any",
]);
export const collections = new Map([
  ["list", 1],
  ["set", 1],
  ["map", 2],
]);
export const identifier = (name: string): string =>
  keywords.has(name)
    ? String.fromCharCode(96) + name + String.fromCharCode(96)
    : name;
export function callbackLabel(
  inputs: string[],
  results: string[],
  nullable = false,
): string {
  const label =
    "fn(" +
    inputs.join(", ") +
    ")" +
    (results.length === 1
      ? " -> " + results[0]
      : results.length
        ? " -> (" + results.join(", ") + ")"
        : "");
  return nullable ? (results.length ? "(" + label + ")?" : label + "?") : label;
}
export const typeLabel = (type: AST.TypeRef): string =>
  type.kind === "function-type"
    ? callbackLabel(
        type.inputs.map(typeLabel),
        type.results.map(typeLabel),
        type.nullable,
      )
    : identifier(type.name.text) +
      (type.arguments.length
        ? "<" + type.arguments.map(typeLabel).join(", ") + ">"
        : "") +
      (type.nullable ? "?" : "");
export const functionLabel = (fn: AST.FunctionDeclaration): string =>
  (fn.external ? "extern " : "") +
  "fn " +
  identifier(fn.name.text) +
  "(" +
  fn.parameters
    .map((item) => identifier(item.name!.text) + ": " + typeLabel(item.type))
    .join(", ") +
  ")" +
  (fn.results.length
    ? " -> " +
      fn.results
        .map(
          (item) =>
            (item.name ? identifier(item.name.text) + ": " : "") +
            typeLabel(item.type),
        )
        .join(", ")
    : "");
export function documentation(docs?: AST.Documentation): string {
  return (docs?.fields ?? [])
    .map((field) =>
      !field.name.escaped && field.name.text === "desc"
        ? field.value.text.trim()
        : field.name.text + ": " + field.value.text.trim(),
    )
    .join("\n\n");
}
export function parameterDocumentation(
  docs: AST.Documentation | undefined,
  name: string,
): string {
  return (
    docs?.fields
      .find(
        (field) =>
          field.name.text === name &&
          (field.name.escaped || !["desc", "return"].includes(name)),
      )
      ?.value.text.trim() ?? ""
  );
}

export type SymbolKind =
  | "constant"
  | "class"
  | "struct"
  | "function"
  | "method"
  | "property"
  | "field"
  | "parameter"
  | "variable"
  | "type";
export interface IndexedType {
  typeReceiver?: boolean;
  label: string;
  classId?: string;
  structId?: string;
  methods?: { name: string; signature: MethodSignature }[];
}
export interface IndexedSymbol {
  id: string;
  name: string;
  uri: string;
  kind: SymbolKind;
  static?: boolean;
  external?: boolean;
  local?: boolean;
  selection: AST.Span;
  span: AST.Span;
  detail: string;
  documentation: string;
  parentId?: string;
  type?: IndexedType;
  parameters?: { label: string; documentation: string }[];
}
export interface Occurrence {
  uri: string;
  span: AST.Span;
  symbolId: string;
  declaration: boolean;
}
export interface Binding {
  symbolId: string;
  availableAfter: number;
}
export interface IndexedScope {
  uri: string;
  span: AST.Span;
  parent: IndexedScope | undefined;
  bindings: Map<string, Binding>;
}
export interface IndexedValue {
  uri: string;
  span: AST.Span;
  type: IndexedType | undefined;
}
export interface CallSite {
  uri: string;
  span: AST.Span;
  open: number;
  arguments: AST.Span[];
  symbolId?: string | undefined;
  signature?: MethodSignature;
}
export interface IndexedModule {
  source: Source;
  parsed: ParseResult;
  scope: IndexedScope;
  exports: Map<string, string>;
}

/** One immutable analysis snapshot, shared by navigation and completion queries. */
export class ProjectIndex {
  readonly modules = new Map<string, IndexedModule>();
  readonly symbols = new Map<string, IndexedSymbol>();
  readonly occurrences = new Map<string, Occurrence[]>();
  readonly references = new Map<string, Occurrence[]>();
  readonly scopes = new Map<string, IndexedScope[]>();
  readonly members = new Map<string, Map<string, string>>();
  readonly values = new Map<string, IndexedValue[]>();
  readonly calls = new Map<string, CallSite[]>();
  readonly builtinOccurrences = new Map<
    string,
    { span: AST.Span; label: string; documentation?: string }[]
  >();
  readonly implementations = new Map<string, Set<string>>();

  id(uri: string, name: AST.Name): string {
    return uri + "#" + name.start;
  }

  module(document: SourceDocument, parsed: ParseResult): IndexedModule {
    const scope = this.scope(document.uri, parsed.module);
    const module = {
      source: new Source(document),
      parsed,
      scope,
      exports: new Map<string, string>(),
    };
    this.modules.set(document.uri, module);
    return module;
  }

  scope(uri: string, span: AST.Span, parent?: IndexedScope): IndexedScope {
    const scope = { uri, span, parent, bindings: new Map<string, Binding>() };
    const scopes = this.scopes.get(uri) ?? [];
    scopes.push(scope);
    this.scopes.set(uri, scopes);
    return scope;
  }

  define(
    uri: string,
    name: AST.Name,
    span: AST.Span,
    info: Omit<IndexedSymbol, "id" | "name" | "uri" | "span" | "selection">,
  ): string {
    const id = this.id(uri, name);
    if (!this.symbols.has(id)) {
      this.symbols.set(id, {
        id,
        name: name.text,
        uri,
        selection: name,
        span,
        ...info,
      });
      this.reference(uri, name, id, true);
    }
    return id;
  }

  reference(
    uri: string,
    span: AST.Span,
    symbolId: string,
    declaration = false,
  ): void {
    if (span.start === span.end) return;
    const occurrence = { uri, span, symbolId, declaration };
    const local = this.occurrences.get(uri) ?? [];
    local.push(occurrence);
    this.occurrences.set(uri, local);
    const all = this.references.get(symbolId) ?? [];
    all.push(occurrence);
    this.references.set(symbolId, all);
  }

  finish(): void {
    for (const occurrences of this.occurrences.values())
      occurrences.sort((a, b) => a.span.start - b.span.start);
    for (const values of this.values.values())
      values.sort((a, b) => a.span.end - b.span.end);
  }
}
