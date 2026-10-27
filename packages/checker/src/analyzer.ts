import {
  collectionMethods,
  collectionSignature,
  type CollectionMethod,
  type MethodSignature,
} from "./collections.js";
import { inheritDocumentation, type Documented } from "./documentation.js";
import { validateDocumentation } from "./validation.js";
import { builtinFunctions } from "./builtins.js";
import type * as AST from "./ast.js";
import type { CheckResult, Diagnostic, SourceDocument } from "./index.js";
import { parseDocument } from "./parser.js";
import { Source } from "./source.js";
import {
  primitive,
  collections,
  ProjectIndex,
  functionLabel,
  typeLabel,
  callbackLabel,
  identifier,
  documentation,
  parameterDocumentation,
  type IndexedScope,
  type IndexedType,
  type SymbolKind,
} from "./symbols.js";

export interface CrateContext {
  /** Optional portable identity, independent of directory and dependency aliases. */
  id?: string;
  /** Canonical directory URI, with a trailing slash. */
  root: string;
  kind: "binary" | "library" | "invalid";
  dependencies: Readonly<Record<string, string>>;
}
export interface CheckContext {
  crates?: readonly CrateContext[];
  diagnostics?: readonly Diagnostic[];
  preset?: PresetContext;
  associations?: readonly import("./associations.js").AssociationSet[];
  /** Native providers validated against the symbol index by LanguageService. */
  nativeImplementations?: readonly { uri: string; name: string }[];
  /** Internal first pass while resolving native associations. */
  deferNativeCoverage?: boolean;
}
export interface PresetContext {
  name: string;
  allowUnsupported?: readonly { uri: string; name: string }[];
  /** Canonical URI of an Agent-maintained implementation association file. */
  implementations?: string;
  /** URI of the TOML file declaring this preset. */
  uri: string;
  /** Canonical crate directory URIs, with trailing slashes. */
  core: readonly string[];
  edge: readonly string[];
}
interface Symbol {
  declaration:
    | AST.FunctionDeclaration
    | AST.ObjectDeclaration
    | AST.TypeAliasDeclaration
    | AST.ConstantDeclaration;
  module: ModuleState;
}
interface ModuleState {
  source: Source;
  tree: AST.Module;
  exports: Map<string, Symbol>;
  names: Map<string, Symbol>;
  crate: CrateContext | undefined;
  valid: boolean;
}
type Type = (
  | { kind: "builtin"; name: string; arguments: Type[] }
  | { kind: "object"; symbol: Symbol }
  | { kind: "union"; symbol: Symbol; values: string[] }
  | { kind: "string-literal"; value: string }
  | { kind: "function"; inputs: Type[]; results: Type[] }
  | { kind: "unknown" | "error" | "null" }
) & { nullable?: boolean };
interface Value {
  types: Type[];
  symbol?: Symbol;
  bindingId?: string | undefined;
  constant?: boolean;
  typeReceiver?: boolean;
  numericBuiltin?: string;
  builtinSignature?: MethodSignature;
}
const unknown: Type = { kind: "unknown" };
const invalid: Type = { kind: "error" };

function sameType(left: Type, right: Type): boolean {
  if (Boolean(left.nullable) !== Boolean(right.nullable)) return false;
  if (left.kind === "function" && right.kind === "function") {
    return (
      left.inputs.length === right.inputs.length &&
      left.results.length === right.results.length &&
      left.inputs.every((type, i) => sameType(type, right.inputs[i]!)) &&
      left.results.every((type, i) => sameType(type, right.results[i]!))
    );
  }
  if (left.kind === "object" && right.kind === "object")
    return left.symbol.declaration === right.symbol.declaration;
  if (left.kind === "builtin" && right.kind === "builtin") {
    return (
      left.name === right.name &&
      left.arguments.length === right.arguments.length &&
      left.arguments.every((type, index) =>
        sameType(type, right.arguments[index]!),
      )
    );
  }
  return left.kind === right.kind;
}

class Scope {
  readonly bindings = new Map<string, Type>();
  readonly constants = new Set<string>();
  isConstant(name: string): boolean {
    return this.bindings.has(name)
      ? this.constants.has(name)
      : (this.parent?.isConstant(name) ?? false);
  }
  constructor(
    readonly parent?: Scope,
    readonly indexed?: IndexedScope,
  ) {}
  get(name: string): Type | undefined {
    return this.bindings.get(name) ?? this.parent?.get(name);
  }
  getId(name: string): string | undefined {
    return (
      this.indexed?.bindings.get(name)?.symbolId ?? this.parent?.getId(name)
    );
  }
}

function numericLiteral(
  value: AST.Expression,
): "integer" | "decimal" | undefined {
  if (value.kind === "unary" && value.operator === "-")
    return numericLiteral(value.value);
  return value.kind === "literal" && value.literalType === "number"
    ? String(value.value).includes(".")
      ? "decimal"
      : "integer"
    : undefined;
}

/** Hosts provide the source closure and crate metadata; no filesystem I/O here. */
export function analyzeProject(
  documents: readonly SourceDocument[],
  context: CheckContext = {},
  options: { index?: ProjectIndex; parse?: typeof parseDocument } = {},
): CheckResult {
  const index = options.index;
  const modules = new Map<string, ModuleState>();
  const diagnostics = [...(context.diagnostics ?? [])];
  for (const document of documents) {
    const parsed = (options.parse ?? parseDocument)(document);
    const indexed = index?.module(document, parsed);
    const source = new Source(document);
    source.diagnostics.push(...parsed.diagnostics);
    const state: ModuleState = {
      source,
      tree: parsed.module,
      exports: new Map(),
      names: new Map(),
      crate: context.crates?.find((crate) =>
        document.uri.startsWith(crate.root),
      ),
      valid: !parsed.diagnostics.some(
        (issue) => issue.code === "AFL1001" || issue.code === "AFL1002",
      ),
    };
    modules.set(document.uri, state);
    for (const declaration of state.tree.declarations) {
      if (
        declaration.kind === "import" ||
        declaration.kind === "implementation" ||
        declaration.kind === "unsupported"
      )
        continue;
      const name = declaration.name.text;
      if (
        state.exports.has(name) ||
        primitive.has(name) ||
        collections.has(name)
      ) {
        source.error(
          "AFL3201",
          `Duplicate or reserved top-level name '${name}'.`,
          declaration.name,
        );
      } else state.exports.set(name, { declaration, module: state });
    }
    state.names = new Map(state.exports);
    if (index && indexed) {
      for (const [name, symbol] of state.exports) {
        const declaration = symbol.declaration;
        const id = index.id(document.uri, declaration.name);
        if (declaration.kind === "function")
          registerFunction(declaration, document.uri);
        else if (declaration.kind === "constant")
          index.define(document.uri, declaration.name, declaration, {
            kind: "constant",
            detail:
              "const " +
              identifier(name) +
              ": " +
              typeLabel(declaration.type) +
              " = " +
              document.text.slice(
                declaration.initializer!.start,
                declaration.initializer!.end,
              ),
            documentation: documentation(declaration.documentation),
          });
        else if (declaration.kind === "type-alias")
          index.define(document.uri, declaration.name, declaration, {
            kind: "type",
            external: declaration.external,
            detail: declaration.external
              ? "extern type " + identifier(name)
              : "type " +
                identifier(name) +
                " = " +
                declaration.values
                  .map((value) => JSON.stringify(value.value))
                  .join(" | "),
            documentation: documentation(declaration.documentation),
          });
        else {
          index.define(document.uri, declaration.name, declaration, {
            kind: declaration.kind,
            external: declaration.external,
            detail:
              (declaration.external ? "extern " : "") +
              declaration.kind +
              " " +
              identifier(name),
            documentation: documentation(declaration.documentation),
          });
          const members = new Map<string, string>();
          index.members.set(id, members);
          for (const property of declaration.properties) {
            const propertyId = index.define(
              document.uri,
              property.name,
              property,
              {
                kind: property.constant
                  ? "constant"
                  : declaration.kind === "struct"
                    ? "field"
                    : "property",
                static: Boolean(property.static),
                detail:
                  (property.constant
                    ? "const "
                    : property.static
                      ? "static "
                      : "") +
                  (property.name.quoted
                    ? document.text.slice(
                        property.name.start,
                        property.name.end,
                      )
                    : identifier(property.name.text)) +
                  (property.optional ? "?" : "") +
                  ": " +
                  typeLabel(property.type) +
                  (property.initializer
                    ? " = " +
                      document.text.slice(
                        property.initializer.start,
                        property.initializer.end,
                      )
                    : ""),
                documentation: documentation(property.documentation),
                parentId: id,
              },
            );
            members.set(property.name.text, propertyId);
          }
          for (const fn of declaration.kind === "class"
            ? declaration.methods
            : [])
            members.set(fn.name.text, registerFunction(fn, document.uri, id));
        }
        indexed.exports.set(name, id);
        indexed.scope.bindings.set(name, { symbolId: id, availableAfter: 0 });
      }
    }
  }

  function registerFunction(
    fn: AST.FunctionDeclaration,
    uri: string,
    parentId?: string,
  ): string {
    return index!.define(uri, fn.name, fn, {
      kind: parentId ? "method" : "function",
      external: fn.external,
      detail: functionLabel(fn),
      documentation: documentation(fn.documentation),
      parameters: fn.parameters.map((parameter) => ({
        label:
          identifier(parameter.name!.text) + ": " + typeLabel(parameter.type),
        documentation: parameterDocumentation(
          fn.documentation,
          parameter.name!.text,
        ),
      })),
      ...(parentId ? { parentId } : {}),
    });
  }
  function reference(state: ModuleState, name: AST.Name, symbol: Symbol): void {
    if (index)
      index.reference(
        state.source.document.uri,
        name,
        index.id(symbol.module.source.document.uri, symbol.declaration.name),
      );
  }
  function typeName(type: Type): string {
    if (type.kind === "union")
      return (
        identifier(type.symbol.declaration.name.text) +
        (type.nullable ? "?" : "")
      );
    if (type.kind === "string-literal") return JSON.stringify(type.value);
    if (type.kind === "function")
      return callbackLabel(
        type.inputs.map(typeName),
        type.results.map(typeName),
        type.nullable,
      );
    const suffix = type.nullable ? "?" : "";
    if (type.kind === "object")
      return identifier(type.symbol.declaration.name.text) + suffix;
    if (type.kind === "builtin")
      return (
        type.name +
        (type.arguments.length
          ? "<" + type.arguments.map(typeName).join(", ") + ">"
          : "") +
        suffix
      );
    return type.kind === "null" ? "null" : "unknown";
  }
  function isNumeric(type: Type | undefined): type is Extract<
    Type,
    { kind: "builtin" }
  > & {
    name: `${"i" | "u"}${8 | 16 | 32 | 64 | 128}` | `f${32 | 64}`;
  } {
    return (
      type?.kind === "builtin" &&
      /^(?:[iu](?:8|16|32|64|128)|f(?:32|64))$/u.test(type.name)
    );
  }
  function isOrderable(type: Type): boolean {
    return (
      !type.nullable &&
      (isNumeric(type) ||
        type.kind === "string-literal" ||
        type.kind === "union" ||
        (type.kind === "builtin" &&
          ["string", "char", "K"].includes(type.name)))
    );
  }
  function numericValue(name: string, operand?: Type): Value {
    const builtin = builtinFunctions.get(name)!;
    const concrete = isNumeric(operand)
      ? operand
      : { kind: "builtin" as const, name: "T", arguments: [] };
    const label = typeName(concrete);
    const type = (name: string): Type =>
      name === "T" ? concrete : { kind: "builtin", name, arguments: [] };
    return {
      types: [
        {
          kind: "function",
          inputs: builtin.inputs.map(type),
          results: builtin.results.map(type),
        },
      ],
      numericBuiltin: name,
      builtinSignature: {
        ...builtin.signature,
        label: builtin.signature.label.replace(/\bT\b/gu, label),
        parameters: builtin.signature.parameters.map((parameter) => ({
          ...parameter,
          label: parameter.label.replace(/\bT\b/gu, label),
        })),
      },
    };
  }
  function methodsFor(type: Type): CollectionMethod<Type>[] {
    return type.kind === "builtin"
      ? collectionMethods<Type>(type.name, type.arguments, {
          sortKey: { kind: "builtin", name: "K", arguments: [] },
          callback: (inputs, results) => ({
            kind: "function",
            inputs,
            results,
          }),
          i32: { kind: "builtin", name: "i32", arguments: [] },
          bool: { kind: "builtin", name: "bool", arguments: [] },
          nullable: (type) => ({ ...type, nullable: true }),
          list: (type) => ({
            kind: "builtin",
            name: "list",
            arguments: [type],
          }),
        })
      : [];
  }
  function indexedType(type: Type): IndexedType {
    const label = typeName(type);
    if (type.kind === "object" && type.symbol.declaration.kind !== "type-alias")
      return {
        label,
        [type.symbol.declaration.kind === "struct" ? "structId" : "classId"]:
          index!.id(
            type.symbol.module.source.document.uri,
            type.symbol.declaration.name,
          ),
      };
    const methods = methodsFor(type).map((method) => ({
      name: method.name,
      signature: collectionSignature(label, method, typeName),
    }));
    return methods.length ? { label, methods } : { label };
  }

  function resolvePath(
    state: ModuleState,
    declaration: AST.Span & { path: AST.Name[] },
  ): Symbol | undefined {
    const parts = declaration.path.map((name) => name.text);
    const source = state.source;
    const last = parts.pop()!;
    let base = source.document.uri;
    if (parts[0] === "crate" && !declaration.path[0]!.escaped) {
      parts.shift();
      if (!state.crate) {
        source.error(
          "AFL3101",
          "A crate:: path requires a crate root.",
          declaration,
        );
        return;
      }
      base = state.crate.root;
    } else if (parts[0] === "dep" && !declaration.path[0]!.escaped) {
      parts.shift();
      const dependency = parts.shift();
      const root = dependency && state.crate?.dependencies[dependency];
      if (!root) {
        source.error(
          "AFL3101",
          `Unconfigured dependency '${dependency ?? ""}'.`,
          declaration,
        );
        return;
      }
      base = root;
    }
    if (!parts.length) {
      source.error(
        "AFL3101",
        "A symbol path requires a module before the symbol.",
        declaration,
      );
      return;
    }
    let target: ModuleState | undefined;
    try {
      target = modules.get(
        new URL(`${parts.map(encodeURIComponent).join("/")}.afl`, base).href,
      );
    } catch {
      /* Non-file documents cannot resolve relative imports. */
    }
    if (!target) {
      source.error(
        "AFL3101",
        `Cannot find module '${parts.join("::")}'.`,
        declaration,
      );
      return;
    }
    const symbol = target.exports.get(last);
    if (!symbol)
      source.error(
        "AFL3102",
        `Module does not define or declare '${last}'.`,
        declaration.path.at(-1)!,
      );
    return symbol;
  }

  // Collect every module's declarations first, then resolve paths against exports.
  for (const state of modules.values()) {
    if (!state.valid && !index) continue;
    for (const declaration of state.tree.declarations) {
      if (declaration.kind !== "import") continue;
      const source = state.source;
      const symbol = resolvePath(state, declaration);
      if (!symbol) continue;
      const name = declaration.alias ?? declaration.path.at(-1)!;
      if (
        state.names.has(name.text) ||
        primitive.has(name.text) ||
        collections.has(name.text)
      ) {
        const implemented = state.tree.declarations.some(
          (item) =>
            item.kind === "implementation" &&
            item.path.map((part) => part.text).join("::") ===
              declaration.path.map((part) => part.text).join("::"),
        );
        source.error(
          "AFL3201",
          `Duplicate or reserved imported name '${name.text}'. ${implemented ? "impl does not require use. Remove this import; use 'as' only if you also need to refer to the external declaration separately." : "Use 'as' to choose another name."}`,
          name,
        );
      } else {
        state.names.set(name.text, symbol);
        if (index) {
          const id = index.id(
            symbol.module.source.document.uri,
            symbol.declaration.name,
          );
          index.modules
            .get(source.document.uri)!
            .scope.bindings.set(name.text, { symbolId: id, availableAfter: 0 });
          reference(state, declaration.path.at(-1)!, symbol);
          if (declaration.alias) reference(state, declaration.alias, symbol);
        }
      }
    }
  }

  const typeCache = new WeakMap<AST.TypeRef, Type>();
  function resolveType(reference: AST.TypeRef, state: ModuleState): Type {
    const previous = typeCache.get(reference);
    if (previous) return previous;
    if (reference.kind === "function-type") {
      const type: Type = {
        kind: "function",
        nullable: reference.nullable,
        inputs: reference.inputs.map((item) => resolveType(item, state)),
        results: reference.results.map((item) => resolveType(item, state)),
      };
      typeCache.set(reference, type);
      return type;
    }
    const name = reference.name.text;
    const args = reference.arguments.map((argument) =>
      resolveType(argument, state),
    );
    let type: Type;
    if (primitive.has(name) || collections.has(name)) {
      const arity = collections.get(name) ?? 0;
      if (args.length !== arity)
        state.source.error(
          "AFL3202",
          `Type '${name}' requires ${arity} type argument(s).`,
          reference,
        );
      type = { kind: "builtin", name, arguments: args };
      if (index) {
        const occurrences =
          index.builtinOccurrences.get(state.source.document.uri) ?? [];
        occurrences.push({ span: reference.name, label: typeLabel(reference) });
        index.builtinOccurrences.set(state.source.document.uri, occurrences);
      }
    } else {
      const symbol = state.names.get(name);
      if (
        !symbol ||
        symbol.declaration.kind === "function" ||
        symbol.declaration.kind === "constant"
      ) {
        state.source.error(
          "AFL3202",
          `Unknown type '${name}'.`,
          reference.name,
        );
        type = invalid;
      } else {
        if (args.length)
          state.source.error(
            "AFL3202",
            "User-defined generic types are not part of AFL v1.",
            reference,
          );
        type =
          symbol.declaration.kind === "type-alias" &&
          !symbol.declaration.external
            ? {
                kind: "union",
                symbol,
                values: symbol.declaration.values.map((value) =>
                  String(value.value),
                ),
              }
            : { kind: "object", symbol };
        if (index)
          index.reference(
            state.source.document.uri,
            reference.name,
            index.id(
              symbol.module.source.document.uri,
              symbol.declaration.name,
            ),
          );
      }
    }
    if (reference.nullable) type = { ...type, nullable: true };
    typeCache.set(reference, type);
    return type;
  }

  function functionTypes(symbol: Symbol): Extract<Type, { kind: "function" }> {
    const fn = symbol.declaration;
    if (fn.kind !== "function")
      return { kind: "function", inputs: [], results: [] };
    return {
      kind: "function",
      inputs: fn.parameters.map((parameter) =>
        resolveType(parameter.type, symbol.module),
      ),
      results: fn.results.map((parameter) =>
        resolveType(parameter.type, symbol.module),
      ),
    };
  }

  function symbolValue(symbol: Symbol): Value {
    const node = symbol.declaration;
    if (node.kind === "constant")
      return {
        types: [resolveType(node.type, symbol.module)],
        constant: true,
        bindingId: index?.id(symbol.module.source.document.uri, node.name),
      };
    if (node.kind === "class" || node.kind === "struct")
      return {
        types: [{ kind: "object", symbol }],
        symbol,
        typeReceiver: true,
      };
    return {
      types: [node.kind === "function" ? functionTypes(symbol) : unknown],
      symbol,
    };
  }

  const implementations: {
    target: Symbol;
    local: Symbol;
    node: AST.ImplementationDeclaration;
  }[] = [];
  for (const state of modules.values()) {
    if (!state.valid && !index) continue;
    const seen = new Set<AST.Declaration>();
    for (const node of state.tree.declarations) {
      if (node.kind !== "implementation") continue;
      const target = resolvePath(state, node);
      if (!target) continue;
      reference(state, node.path.at(-1)!, target);
      if (
        !target.declaration.external ||
        target.declaration.kind === "type-alias"
      ) {
        state.source.error(
          "AFL3401",
          "An impl target must be an extern function, class or struct.",
          node,
        );
        continue;
      }
      const local = state.exports.get(target.declaration.name.text);
      if (
        !local ||
        local.declaration.external ||
        local.declaration.kind !== target.declaration.kind
      ) {
        state.source.error(
          "AFL3402",
          `impl requires a same-name ordinary ${target.declaration.kind} '${target.declaration.name.text}' in this module.`,
          node,
        );
        continue;
      }
      if (seen.has(target.declaration)) {
        state.source.error(
          "AFL3403",
          "This module already declares an implementation of this external symbol.",
          node,
        );
        continue;
      }
      seen.add(target.declaration);
      implementations.push({ target, local, node });
    }
  }
  const unsupported: {
    target: Symbol;
    module: ModuleState;
    node: AST.UnsupportedDeclaration;
  }[] = [];
  for (const state of modules.values()) {
    if (!state.valid && !index) continue;
    for (const node of state.tree.declarations) {
      if (node.kind !== "unsupported") continue;
      const target = resolvePath(state, node);
      if (!target) continue;
      reference(state, node.path.at(-1)!, target);
      if (
        !target.declaration.external ||
        target.declaration.kind === "type-alias"
      ) {
        state.source.error(
          "AFL3410",
          "unsupported requires an extern capability. It does not suppress ordinary definitions or dependency errors.",
          node,
        );
        continue;
      }
      if (
        unsupported.some(
          (item) =>
            item.module === state &&
            item.target.declaration === target.declaration,
        ) ||
        implementations.some(
          (item) =>
            item.local.module === state &&
            item.target.declaration === target.declaration,
        )
      ) {
        state.source.error(
          "AFL3411",
          "This module already implements or marks this capability unsupported; keep exactly one declaration.",
          node,
        );
      }
      if (
        context.preset?.edge.includes(state.crate?.root ?? "") &&
        !context.preset.core.includes(target.module.crate?.root ?? "")
      ) {
        state.source.error(
          "AFL3410",
          "An unsupported declaration in a selected edge must refer to a selected core capability.",
          node,
        );
      }
      unsupported.push({ target, module: state, node });
    }
  }
  const selectedImplementations = implementations.filter(
    ({ local }) =>
      !context.preset ||
      context.preset.edge.includes(local.module.crate?.root ?? ""),
  );
  const objectPairs = selectedImplementations.filter(
    ({ target }) => target.declaration.kind !== "function",
  );
  function signatureType(left: Type, right: Type): boolean {
    // Unresolved types already have dependency diagnostics; avoid cascading errors.
    if (left.kind === "error" || right.kind === "error") return true;
    if (Boolean(left.nullable) !== Boolean(right.nullable)) return false;
    if (right.kind === "builtin" && right.name === "K")
      return isOrderable(left);
    if (left.kind === "function" && right.kind === "function") {
      return (
        left.inputs.length === right.inputs.length &&
        left.results.length === right.results.length &&
        left.inputs.every((type, i) => signatureType(type, right.inputs[i]!)) &&
        left.results.every((type, i) => signatureType(type, right.results[i]!))
      );
    }
    if (left.kind === "union" && right.kind === "union")
      return (
        left.values.length === right.values.length &&
        left.values.every((value) => right.values.includes(value))
      );
    if (left.kind === "string-literal" && right.kind === "string-literal")
      return left.value === right.value;
    if (left.kind === "object" && right.kind === "object") {
      return (
        left.symbol.declaration === right.symbol.declaration ||
        objectPairs.some(
          ({ target, local }) =>
            (target.declaration === left.symbol.declaration &&
              local.declaration === right.symbol.declaration) ||
            (target.declaration === right.symbol.declaration &&
              local.declaration === left.symbol.declaration),
        )
      );
    }
    return (
      left.kind === "builtin" &&
      right.kind === "builtin" &&
      left.name === right.name &&
      left.arguments.length === right.arguments.length &&
      left.arguments.every((type, i) =>
        signatureType(type, right.arguments[i]!),
      )
    );
  }
  function matchFunction(target: Symbol, local: Symbol): void {
    const expected = functionTypes(target),
      actual = functionTypes(local);
    for (const part of ["inputs", "results"] as const) {
      if (
        expected[part].length !== actual[part].length ||
        expected[part].some((type, i) => !signatureType(type, actual[part][i]!))
      ) {
        local.module.source.error(
          "AFL3404",
          `Implementation '${local.declaration.name.text}' has ${part} incompatible with its extern declaration.`,
          local.declaration.name,
        );
      }
    }
  }
  function indexImplementation(
    target: Symbol,
    local: Symbol,
    targetName = target.declaration.name,
    localName = local.declaration.name,
  ): void {
    if (!index) return;
    const id = index.id(target.module.source.document.uri, targetName);
    const entries = index.implementations.get(id) ?? new Set<string>();
    entries.add(index.id(local.module.source.document.uri, localName));
    index.implementations.set(id, entries);
  }
  for (const record of implementations) {
    const { target, local } = record;
    if (selectedImplementations.includes(record))
      indexImplementation(target, local);
    if (target.declaration.kind === "function") matchFunction(target, local);
    else if (
      local.declaration.kind !== "function" &&
      local.declaration.kind !== "type-alias" &&
      local.declaration.kind !== "constant" &&
      target.declaration.kind !== "type-alias" &&
      target.declaration.kind !== "constant"
    ) {
      const actualObject = local.declaration;
      for (const member of [
        ...target.declaration.properties,
        ...(target.declaration.kind === "class"
          ? target.declaration.methods
          : []),
      ]) {
        const method = "kind" in member;
        const actual = (
          method
            ? actualObject.kind === "class"
              ? actualObject.methods
              : []
            : actualObject.properties
        ).find((item) => item.name.text === member.name.text);
        if (!actual) {
          local.module.source.error(
            "AFL3405",
            `Implementation ${actualObject.kind} '${actualObject.name.text}' requires ${method ? "method" : "property"} '${member.name.text}'.`,
            actualObject.name,
          );
        } else if (method && "kind" in actual) {
          const targetMethod = { declaration: member, module: target.module };
          const localMethod = { declaration: actual, module: local.module };
          matchFunction(targetMethod, localMethod);
          if (selectedImplementations.includes(record))
            indexImplementation(targetMethod, localMethod);
        } else if (!method && !("kind" in actual)) {
          if (
            member.optional !== actual.optional ||
            Boolean(member.static) !== Boolean(actual.static) ||
            Boolean(member.constant) !== Boolean(actual.constant) ||
            !signatureType(
              resolveType(member.type, target.module),
              resolveType(actual.type, local.module),
            )
          ) {
            local.module.source.error(
              "AFL3404",
              `Property '${actual.name.text}' has a type, optional, static or const marker incompatible with its extern declaration.`,
              actual.type,
            );
          }
          if (selectedImplementations.includes(record))
            indexImplementation(target, local, member.name, actual.name);
        }
      }
    }
  }
  if (context.preset) {
    const preset = context.preset;
    const crates = new Map(context.crates?.map((crate) => [crate.root, crate]));
    for (const root of preset.core) {
      const pending = [root],
        visited = new Set<string>();
      while (pending.length) {
        const current = pending.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (preset.edge.includes(current)) {
          diagnostics.push({
            uri: preset.uri,
            code: "AFL4001",
            severity: "error",
            message: `Core crate '${crates.get(root)?.id ?? root}' must not depend on selected edge '${crates.get(current)?.id ?? current}', directly or indirectly.`,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          });
          break;
        }
        pending.push(...Object.values(crates.get(current)?.dependencies ?? {}));
      }
    }
    const provided = context.nativeImplementations ?? [];
    for (const item of provided) {
      const target = modules.get(item.uri)?.exports.get(item.name);
      if (!target?.declaration.external)
        diagnostics.push({
          uri: preset.uri,
          code: "AFL4001",
          severity: "error",
          message: `Target implementation '${item.uri}::${item.name}' must name a loaded top-level extern.`,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        });
    }
    for (const permission of preset.allowUnsupported ?? []) {
      const module = modules.get(permission.uri),
        symbol = module?.exports.get(permission.name);
      if (
        !module ||
        !preset.core.includes(module.crate?.root ?? "") ||
        !symbol?.declaration.external ||
        symbol.declaration.kind === "type-alias"
      ) {
        diagnostics.push({
          uri: preset.uri,
          code: "AFL4001",
          severity: "error",
          message: `allow_unsupported target '${permission.uri}::${permission.name}' must name an extern in a selected core.`,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        });
      }
    }
    for (const state of modules.values()) {
      if (
        !preset.core.includes(state.crate?.root ?? "") &&
        !preset.edge.includes(state.crate?.root ?? "") &&
        !provided.some((item) => item.uri === state.source.document.uri)
      )
        continue;
      for (const target of state.exports.values()) {
        if (!target.declaration.external) continue;
        if (
          !preset.core.includes(state.crate?.root ?? "") &&
          target.declaration.kind !== "type-alias" &&
          !provided.some(
            (item) =>
              item.uri === state.source.document.uri &&
              item.name === target.declaration.name.text,
          )
        )
          continue;
        const matches = selectedImplementations.filter(
          (item) => item.target.declaration === target.declaration,
        );
        const native = provided.filter(
          (item) =>
            item.uri === state.source.document.uri &&
            item.name === target.declaration.name.text,
        );
        const count = matches.length + native.length;
        const exclusions = unsupported.filter(
          (item) =>
            item.target.declaration === target.declaration &&
            preset.edge.includes(item.module.crate?.root ?? ""),
        );
        const permitted = preset.allowUnsupported?.some(
          (item) =>
            item.uri === state.source.document.uri &&
            item.name === target.declaration.name.text,
        );
        if (
          !count &&
          !context.deferNativeCoverage &&
          exclusions.length < 2 &&
          !(exclusions.length === 1 && permitted)
        )
          state.source.error(
            "AFL4101",
            `Preset '${preset.name}' has no implementation of '${target.declaration.name.text}'.${exclusions.length ? " To accept this capability difference, explicitly list its source-file::symbol in allow_unsupported and document fallback handling." : ""}`,
            target.declaration.name,
          );
        if (exclusions.length === 1 && permitted && !count) {
          const exclusion = exclusions[0]!;
          const doc = documentation(exclusion.node.documentation);
          diagnostics.push({
            uri: exclusion.module.source.document.uri,
            code: "AFL4103",
            severity: "information",
            message: `Preset '${preset.name}' explicitly accepts unsupported '${target.declaration.name.text}'. ${doc}`,
            range: {
              start: exclusion.module.source.position(exclusion.node.start),
              end: exclusion.module.source.position(exclusion.node.end),
            },
          });
        }
        if (
          (exclusions.length && count + exclusions.length > 1) ||
          (native.length && count > 1)
        )
          state.source.error(
            "AFL4102",
            `Preset '${preset.name}' provides conflicting implementations/unsupported declarations for '${target.declaration.name.text}'.`,
            target.declaration.name,
          );
        if (matches.length > 1) {
          for (const match of matches)
            match.local.module.source.error(
              "AFL4102",
              `Preset '${preset.name}' has multiple implementations of '${target.declaration.name.text}'.`,
              match.node,
            );
        }
      }
    }
  }

  const inherited = new Map<Documented, AST.Documentation>();
  const inherit = (
    local: Documented,
    target: Documented,
    state: ModuleState,
  ): void => {
    const doc = inheritDocumentation(local, target);
    inherited.set(local, doc);
    if (index) {
      const symbol = index.symbols.get(
        index.id(state.source.document.uri, local.name),
      );
      if (symbol) {
        symbol.documentation = documentation(doc);
        if ("kind" in local && local.kind === "function")
          symbol.parameters = local.parameters.map((parameter) => ({
            label:
              identifier(parameter.name!.text) +
              ": " +
              typeLabel(parameter.type),
            documentation: parameterDocumentation(doc, parameter.name!.text),
          }));
      }
    }
  };
  for (const { local, target } of implementations) {
    // Multiple targets may share one implementation, but omission cannot choose
    // which contract's prose to inherit. Explicit local documentation still works.
    if (
      implementations.filter(
        (item) => item.local.declaration === local.declaration,
      ).length !== 1
    )
      continue;
    inherit(local.declaration, target.declaration, local.module);
    if (
      local.declaration.kind !== "function" &&
      local.declaration.kind !== "type-alias" &&
      local.declaration.kind !== "constant" &&
      target.declaration.kind !== "function" &&
      target.declaration.kind !== "type-alias" &&
      target.declaration.kind !== "constant"
    ) {
      for (const property of local.declaration.properties) {
        const other = target.declaration.properties.find(
          (item) => item.name.text === property.name.text,
        );
        if (other) inherit(property, other, local.module);
      }
      if (
        local.declaration.kind === "class" &&
        target.declaration.kind === "class"
      ) {
        for (const method of local.declaration.methods) {
          const other = target.declaration.methods.find(
            (item) => item.name.text === method.name.text,
          );
          if (other) inherit(method, other, local.module);
        }
      }
    }
  }
  for (const state of modules.values()) {
    if (state.valid || index)
      validateDocumentation(state.source, state.tree, inherited);
  }

  function checkBody(
    node:
      | AST.FunctionDeclaration
      | AST.Property
      | AST.ObjectDeclaration
      | AST.TypeAliasDeclaration
      | AST.ConstantDeclaration
      | AST.UnsupportedDeclaration,
    state: ModuleState,
    owner?: Symbol,
  ): void {
    const fn = "kind" in node && node.kind === "function" ? node : undefined;
    const source = state.source;
    const rootScope = new Scope(
      undefined,
      index?.scope(
        source.document.uri,
        node,
        index.modules.get(source.document.uri)?.scope,
      ),
    );
    if (owner) {
      rootScope.bindings.set("self", { kind: "object", symbol: owner });
      if (index)
        rootScope.indexed!.bindings.set("self", {
          symbolId: index.id(
            owner.module.source.document.uri,
            owner.declaration.name,
          ),
          availableAfter: 0,
        });
    }
    for (const parameter of fn ? [...fn.parameters, ...fn.results] : []) {
      const type = resolveType(parameter.type, state);
      if (parameter.name) {
        declare(
          rootScope,
          parameter.name,
          type,
          "parameter",
          0,
          parameterDocumentation(
            ("name" in node ? inherited.get(node) : undefined) ??
              fn?.documentation,
            parameter.name.text,
          ),
        );
        if (index) {
          const field = fn?.documentation?.fields.find(
            (field) =>
              field.name.text === parameter.name!.text &&
              (field.name.escaped ||
                !["desc", "return"].includes(field.name.text)),
          );
          if (field)
            index.reference(
              source.document.uri,
              field.name,
              index.id(source.document.uri, parameter.name),
            );
        }
      }
    }
    const resultTypes =
      fn?.results.map((parameter) => resolveType(parameter.type, state)) ?? [];

    function declare(
      scope: Scope,
      name: AST.Name,
      type: Type,
      kind: SymbolKind = "variable",
      availableAfter = name.end,
      docs = "",
    ): void {
      if (scope.get(name.text))
        source.error(
          "AFL3201",
          `Local name '${name.text}' is already visible in this scope.`,
          name,
        );
      else {
        scope.bindings.set(name.text, type);
        if (kind === "constant") scope.constants.add(name.text);
        if (index) {
          const id = index.define(source.document.uri, name, name, {
            kind,
            local: true,
            detail:
              (kind === "constant" ? "const " : "") +
              identifier(name.text) +
              ": " +
              indexedType(type).label,
            documentation: docs,
            type: indexedType(type),
            parentId: index.id(
              source.document.uri,
              "name" in node ? node.name : node.path.at(-1)!,
            ),
          });
          scope.indexed!.bindings.set(name.text, {
            symbolId: id,
            availableAfter,
          });
        }
      }
    }
    function arity(actual: number, expected: number, span: AST.Span): void {
      if (actual !== expected)
        source.error(
          "AFL3303",
          `Expected ${expected} value(s), received ${actual}.`,
          span,
        );
    }
    function single(
      value: AST.Expression,
      scope: Scope,
      expected?: Type,
    ): Value {
      const info = expression(value, scope, expected ? [expected] : undefined);
      if (!info.types.some((type) => type.kind === "error"))
        arity(info.types.length, 1, value);
      return info;
    }
    function values(
      items: AST.Expression[],
      scope: Scope,
      expected?: Type[],
    ): Type[] {
      const types: Type[] = [];
      for (const [index, item] of items.entries()) {
        const remaining = expected?.slice(
          types.length,
          index === items.length - 1 ? undefined : types.length + 1,
        );
        types.push(...expression(item, scope, remaining).types);
      }
      return types;
    }
    function block(
      body: AST.Block,
      parent: Scope,
      expected?: Type[],
      bindings: { name: AST.Name; type: Type }[] = [],
    ): Type[] {
      const scope = new Scope(
        parent,
        index?.scope(source.document.uri, body, parent.indexed),
      );
      for (const binding of bindings)
        declare(scope, binding.name, binding.type, "variable", body.start + 1);
      let tail: Type[] = [];
      for (const [statementIndex, statement] of body.statements.entries()) {
        const isLast = statementIndex === body.statements.length - 1;
        switch (statement.kind) {
          case "assignment": {
            const types = statement.targets.map((target) => {
              if (target.type) return resolveType(target.type, state);
              if (target.value.kind === "name") {
                const name = target.value.name;
                const binding = scope.get(name.text);
                const symbol = !binding
                  ? state.names.get(name.text)
                  : undefined;
                const id = scope.getId(name.text);
                if (index && id) index.reference(source.document.uri, name, id);
                if (symbol) reference(state, name, symbol);
                if (
                  scope.isConstant(name.text) ||
                  symbol?.declaration.kind === "constant"
                )
                  source.error(
                    "AFL3212",
                    `Constant '${name.text}' cannot be reassigned.`,
                    name,
                  );
                return (
                  binding ??
                  (symbol?.declaration.kind === "constant"
                    ? resolveType(symbol.declaration.type, symbol.module)
                    : unknown)
                );
              }
              if (target.value.kind === "member") {
                const member = expression(target.value, scope);
                if (member.constant)
                  source.error(
                    "AFL3212",
                    `Constant '${target.value.name.text}' cannot be reassigned.`,
                    target.value.name,
                  );
                if (member.symbol || member.builtinSignature) {
                  source.error(
                    "AFL3204",
                    "Only properties can be assigned; this member is a method.",
                    target.value.name,
                  );
                  return invalid;
                }
                return member.types[0] ?? invalid;
              }
              return invalid;
            });
            const actual = values(statement.values, scope, types);
            if (!actual.some((type) => type.kind === "error"))
              arity(actual.length, statement.targets.length, statement);
            for (const [targetIndex, target] of statement.targets.entries()) {
              const value = target.value;
              if (value.kind !== "name") continue;
              const name = value.name;
              const prose =
                statement.values[0]?.kind === "description"
                  ? statement.values[0].text
                  : "";
              if (target.type)
                declare(
                  scope,
                  name,
                  types[targetIndex]!,
                  statement.constant ? "constant" : "variable",
                  statement.end + 1,
                  prose,
                );
              else if (
                !scope.get(name.text) &&
                state.names.get(name.text)?.declaration.kind !== "constant"
              ) {
                if (
                  statement.targets.length === 1 &&
                  statement.values[0]?.kind === "description"
                )
                  declare(
                    scope,
                    name,
                    unknown,
                    "variable",
                    statement.end + 1,
                    prose,
                  );
                else
                  source.error(
                    "AFL3203",
                    `Assignment target '${name.text}' has not been declared.`,
                    name,
                  );
              }
            }
            tail = [];
            break;
          }
          case "expression":
            tail = values(
              statement.values,
              scope,
              isLast ? expected : undefined,
            );
            break;
          case "return":
            if (statement.values.length) {
              const actual = values(statement.values, scope, resultTypes);
              if (!actual.some((type) => type.kind === "error"))
                arity(actual.length, resultTypes.length, statement);
            } else if (fn?.results.some((result) => !result.name)) {
              source.error(
                "AFL3303",
                "An anonymous result needs a value after return.",
                statement,
              );
            }
            tail = resultTypes;
            break;
          case "while":
            single(statement.condition, scope);
            block(statement.body, scope);
            tail = [];
            break;
          case "for": {
            const values = single(statement.iterable, scope).types;
            const collection = values.length === 1 ? values[0]! : invalid;
            let types: Type[] = [];
            if (
              collection.kind === "builtin" &&
              collections.has(collection.name)
            ) {
              const count = statement.bindings.length;
              types =
                collection.name === "list" && count >= 2
                  ? [
                      { kind: "builtin", name: "i32", arguments: [] },
                      ...collection.arguments,
                    ]
                  : collection.arguments;
              const validCount =
                collection.name === "list"
                  ? count === 1 || count === 2
                  : count === (collection.name === "map" ? 2 : 1);
              if (!validCount) {
                const expected =
                  collection.name === "list"
                    ? "one or two"
                    : collection.name === "map"
                      ? "two"
                      : "one";
                source.error(
                  "AFL3208",
                  `A for loop over ${collection.name} requires ${expected} binding name(s).`,
                  statement,
                );
              }
            } else if (collection.kind !== "error") {
              source.error(
                "AFL3208",
                "A for loop requires an explicitly known list, set or map type.",
                statement.iterable,
              );
            }
            block(
              statement.body,
              scope,
              undefined,
              statement.bindings.map((name, i) => ({
                name,
                type: types[i] ?? invalid,
              })),
            );
            tail = [];
            break;
          }
          case "break":
          case "continue":
            tail = [];
            break;
        }
      }
      return tail;
    }
    function initializer(
      value: AST.Initializer,
      scope: Scope,
      expected: Type | undefined,
    ): Value {
      if (expected?.kind === "error") return { types: [invalid] };
      if (
        expected?.kind === "object" &&
        expected.symbol.declaration.kind !== "function" &&
        expected.symbol.declaration.kind !== "type-alias" &&
        expected.symbol.declaration.kind !== "constant"
      ) {
        const fields = new Map(
          expected.symbol.declaration.properties
            .filter((property) => !property.static)
            .map((property) => [property.name.text, property]),
        );
        const seen = new Set<string>();
        for (const entry of value.entries) {
          const key = entry.key;
          const name =
            key?.kind === "name"
              ? key.name.text
              : expected.symbol.declaration.kind === "struct" &&
                  key?.kind === "literal" &&
                  key.literalType === "string"
                ? String(key.value)
                : undefined;
          if (name === undefined) {
            source.error(
              "AFL3301",
              "An object initializer requires declared property names before ':'.",
              entry.key ?? entry.value,
            );
            single(entry.value, scope);
            continue;
          }
          const field = fields.get(name);
          if (index && field)
            index.reference(
              source.document.uri,
              key!,
              index.id(expected.symbol.module.source.document.uri, field.name),
            );
          if (!field)
            source.error(
              "AFL3301",
              `Unknown property '${name}' in object initializer.`,
              key!,
            );
          if (seen.has(name))
            source.error(
              "AFL3302",
              `Duplicate initializer property '${name}'.`,
              key!,
            );
          seen.add(name);
          single(
            entry.value,
            scope,
            field ? resolveType(field.type, expected.symbol.module) : undefined,
          );
        }
        for (const [name, field] of fields) {
          if (!seen.has(name) && !field.initializer && !field.optional)
            source.error(
              "AFL3302",
              `Missing initializer property '${name}'.`,
              value,
            );
        }
      } else if (
        expected?.kind === "builtin" &&
        collections.has(expected.name)
      ) {
        for (const entry of value.entries) {
          if (expected.name === "map") {
            if (!entry.key)
              source.error(
                "AFL3301",
                "A map initializer requires key: value entries.",
                entry.value,
              );
            else single(entry.key, scope, expected.arguments[0]);
            single(entry.value, scope, expected.arguments[1]);
          } else {
            if (entry.key) {
              source.error(
                "AFL3301",
                "List and set initializers contain values without keys.",
                entry.key,
              );
              single(entry.key, scope);
            }
            single(entry.value, scope, expected.arguments[0]);
          }
        }
      } else {
        source.error(
          "AFL3301",
          "A brace initializer needs a declared object, list, set or map type.",
          value,
        );
        return { types: [invalid] };
      }
      return { types: [expected] };
    }
    function member(
      object: Type | undefined,
      name: AST.Name,
      typeReceiver = false,
      link = false,
    ): Value {
      if (object?.kind === "error") return { types: [invalid] };
      if (object?.kind === "builtin" && collections.has(object.name)) {
        const method = methodsFor(object).find(
          (method) => method.name === name.text,
        );
        if (!method) {
          source.error(
            "AFL3204",
            `Type '${typeName(object)}' does not declare member '${name.text}'.`,
            name,
          );
          return { types: [invalid] };
        }
        if (
          ["sort", "sorted"].includes(method.name) &&
          object.arguments[0] &&
          !isOrderable(object.arguments[0])
        ) {
          source.error(
            "AFL3211",
            `${method.name} requires non-null numeric, character or string elements. Use sort_by/sorted_by with a key function for objects.`,
            name,
          );
        }
        const signature = collectionSignature(
          typeName(object),
          method,
          typeName,
        );
        if (index) {
          const occurrences =
            index.builtinOccurrences.get(source.document.uri) ?? [];
          occurrences.push({
            span: name,
            label: signature.label,
            documentation: signature.documentation,
          });
          index.builtinOccurrences.set(source.document.uri, occurrences);
        }
        return {
          types: [
            {
              kind: "function",
              inputs: method.parameters.map((parameter) => parameter.type),
              results: method.results,
            },
          ],
          builtinSignature: signature,
        };
      }
      if (
        object?.kind !== "object" ||
        object.symbol.declaration.kind === "function" ||
        object.symbol.declaration.kind === "type-alias" ||
        object.symbol.declaration.kind === "constant"
      ) {
        source.error(
          "AFL3205",
          `Member '${name.text}' requires an explicitly known class, struct or collection type; descriptions and any do not declare members.`,
          name,
        );
        return { types: [invalid] };
      }
      const cls = object.symbol.declaration;
      const property = cls.properties.find(
        (item) => item.name.text === name.text,
      );
      if (property) {
        if (!link && Boolean(property.static) !== typeReceiver)
          source.error(
            "AFL3213",
            property.static
              ? `Shared member '${name.text}' must be accessed through its class name.`
              : `Instance member '${name.text}' requires an object receiver.`,
            name,
          );
        if (index)
          index.reference(
            source.document.uri,
            name,
            index.id(object.symbol.module.source.document.uri, property.name),
          );
        return {
          types: [resolveType(property.type, object.symbol.module)],
          constant: Boolean(property.constant),
          bindingId: index?.id(
            object.symbol.module.source.document.uri,
            property.name,
          ),
        };
      }
      const method = (cls.kind === "class" ? cls.methods : []).find(
        (item) => item.name.text === name.text,
      );
      if (method) {
        if (typeReceiver && !link)
          source.error(
            "AFL3213",
            `Instance method '${name.text}' requires an object receiver.`,
            name,
          );
        const symbol = { declaration: method, module: object.symbol.module };
        reference(state, name, symbol);
        return { types: [functionTypes(symbol)], symbol };
      }
      source.error(
        "AFL3204",
        `Type '${cls.name.text}' does not declare member '${name.text}'.`,
        name,
      );
      return { types: [invalid] };
    }

    function descriptionLinks(
      description: AST.Description,
      scope: Scope,
    ): void {
      for (const link of description.links) {
        if ((!link.valid && !index) || !link.path.length) continue;
        const first = link.path[0]!;
        let value: Value;
        if (link.path.length > 1) {
          const symbol = resolvePath(state, link);
          if (!symbol) continue;
          reference(state, link.path.at(-1)!, symbol);
          value = symbolValue(symbol);
        } else if (
          !scope.get(first.text) &&
          !state.names.has(first.text) &&
          (primitive.has(first.text) || collections.has(first.text))
        ) {
          value = {
            types: [{ kind: "builtin", name: first.text, arguments: [] }],
          };
          if (index) {
            const occurrences =
              index.builtinOccurrences.get(source.document.uri) ?? [];
            occurrences.push({ span: first, label: first.text });
            index.builtinOccurrences.set(source.document.uri, occurrences);
          }
        } else
          value = expression(
            { kind: "name", name: first, start: first.start, end: first.end },
            scope,
          );
        // A link to a type's member navigates its declaration without creating an instance.
        if (
          value.symbol &&
          value.symbol.declaration.kind !== "function" &&
          value.symbol.declaration.kind !== "type-alias" &&
          value.symbol.declaration.kind !== "constant"
        )
          value.types = [{ kind: "object", symbol: value.symbol }];
        const record = (end: number): void => {
          if (!index) return;
          const values = index.values.get(source.document.uri) ?? [];
          values.push({
            uri: source.document.uri,
            span: { start: first.start, end },
            type: value.types[0] ? indexedType(value.types[0]) : undefined,
          });
          index.values.set(source.document.uri, values);
        };
        record(link.path.at(-1)!.end);
        for (const name of link.members) {
          value = member(value.types[0], name, false, true);
          record(name.end);
        }
      }
    }

    function checkUnion(
      actual: Type,
      target: Type | undefined,
      span: AST.Span,
    ): void {
      if (
        target?.kind !== "union" ||
        actual.kind === "unknown" ||
        actual.kind === "error" ||
        (actual.kind === "builtin" && ["string", "any"].includes(actual.name))
      )
        return;
      const valid =
        actual.kind === "string-literal"
          ? target.values.includes(actual.value)
          : actual.kind === "union"
            ? actual.values.every((value) => target.values.includes(value)) &&
              (!actual.nullable || target.nullable)
            : actual.kind === "null" && target.nullable;
      if (!valid)
        source.error(
          "AFL3209",
          `Value is outside ${typeName(target)}. Use ${target.values.map((value) => JSON.stringify(value)).join(" | ")}${target.nullable ? " | null" : ""}.`,
          span,
        );
    }
    let depth = 0;
    function expression(
      value: AST.Expression,
      scope: Scope,
      expected?: Type[],
    ): Value {
      const result = evaluate(value, scope, expected);
      for (const [i, actual] of result.types.entries()) {
        const target = expected?.[i];
        checkUnion(actual, target, value);
        if (
          target?.kind !== "function" ||
          actual.kind === "error" ||
          actual.kind === "null" ||
          (actual.kind === "unknown" && !result.symbol)
        )
          continue;
        // Compare callback contracts, while keeping runtime null handling and
        // opaque description semantics outside the checker.
        if (
          actual.kind !== "function" ||
          !signatureType(
            { ...actual, nullable: Boolean(target.nullable) },
            target,
          )
        ) {
          source.error(
            "AFL3207",
            "Callback value does not match the declared input and result signature.",
            value,
          );
        }
      }
      if (index) {
        const values = index.values.get(source.document.uri) ?? [];
        values.push({
          uri: source.document.uri,
          span: value,
          type:
            result.types.length === 1
              ? {
                  ...indexedType(result.types[0]!),
                  typeReceiver: Boolean(result.typeReceiver),
                }
              : undefined,
        });
        index.values.set(source.document.uri, values);
      }
      return result;
    }
    function evaluate(
      value: AST.Expression,
      scope: Scope,
      expected?: Type[],
    ): Value {
      if (++depth > 256) {
        source.error(
          "AFL1003",
          "Expression nesting exceeds 256 levels.",
          value,
        );
        depth--;
        return { types: [invalid] };
      }
      try {
        switch (value.kind) {
          case "description":
            descriptionLinks(value, scope);
            return { types: [unknown] };
          case "literal":
            return {
              types: [
                value.literalType === "string"
                  ? { kind: "string-literal", value: String(value.value) }
                  : value.literalType === "null"
                    ? { kind: "null" }
                    : {
                        kind: "builtin",
                        name:
                          value.literalType === "number"
                            ? String(value.value).includes(".")
                              ? "f64"
                              : "i32"
                            : value.literalType,
                        arguments: [],
                      },
              ],
            };
          case "name": {
            const binding = scope.get(value.name.text);
            if (binding) {
              const id = scope.getId(value.name.text);
              if (index && id)
                index.reference(source.document.uri, value.name, id);
              return {
                types: [binding],
                bindingId: id,
                constant: scope.isConstant(value.name.text),
              };
            }
            const symbol = state.names.get(value.name.text);
            if (symbol) {
              reference(state, value.name, symbol);
              return symbolValue(symbol);
            }
            const builtin = builtinFunctions.get(value.name.text);
            if (builtin) {
              const expectedFunction = expected?.[0];
              const numeric = builtin.numeric
                ? numericValue(
                    value.name.text,
                    expectedFunction?.kind === "function"
                      ? expectedFunction.inputs[0]
                      : undefined,
                  )
                : undefined;
              if (index) {
                const occurrences =
                  index.builtinOccurrences.get(source.document.uri) ?? [];
                occurrences.push({
                  span: value.name,
                  label:
                    numeric?.builtinSignature?.label ?? builtin.signature.label,
                  documentation: builtin.signature.documentation,
                });
                index.builtinOccurrences.set(source.document.uri, occurrences);
              }
              if (numeric) return numeric;
              const type = (name: string): Type => ({
                kind: "builtin",
                name,
                arguments: [],
              });
              return {
                types: [
                  {
                    kind: "function",
                    inputs: builtin.inputs.map(type),
                    results: builtin.results.map(type),
                  },
                ],
                builtinSignature: builtin.signature,
              };
            }
            source.error(
              "AFL3203",
              `Unresolved name '${value.name.text}'.`,
              value.name,
            );
            return { types: [invalid] };
          }
          case "member": {
            const receiver = single(value.object, scope);
            return member(receiver.types[0], value.name, receiver.typeReceiver);
          }
          case "call": {
            let callee = expression(value.callee, scope);
            let numericArguments: Value[] | undefined;
            if (callee.numericBuiltin) {
              numericArguments = value.arguments.map((argument) =>
                single(argument, scope),
              );
              const literals = value.arguments.map(numericLiteral);
              const typed = numericArguments.find(
                (argument, i) => isNumeric(argument.types[0]) && !literals[i],
              )?.types[0];
              const contextual =
                isNumeric(expected?.[0]) &&
                (!literals.includes("decimal") ||
                  expected[0].name.startsWith("f"))
                  ? expected[0]
                  : undefined;
              const operand =
                typed ??
                contextual ??
                numericArguments.find(
                  (argument) =>
                    isNumeric(argument.types[0]) &&
                    argument.types[0].name === "f64",
                )?.types[0] ??
                numericArguments.find((argument) =>
                  isNumeric(argument.types[0]),
                )?.types[0];
              const name = callee.numericBuiltin;
              callee = numericValue(name, operand);
              numericArguments.forEach((argument, i) => {
                const type = argument.types[0];
                if (
                  type &&
                  type.kind !== "error" &&
                  type.kind !== "unknown" &&
                  !(type.kind === "builtin" && type.name === "any") &&
                  (!isNumeric(type) ||
                    (["min", "max"].includes(name) &&
                      isNumeric(operand) &&
                      type.name !== operand.name &&
                      (!literals[i] ||
                        (literals[i] === "decimal" &&
                          !operand.name.startsWith("f")))))
                ) {
                  source.error(
                    "AFL3210",
                    `${name} requires numeric operands${["min", "max"].includes(name) ? " of the same type; use to_float or to_int explicitly" : ""}.`,
                    value.arguments[i]!,
                  );
                }
              });
              if (index) {
                const occurrence = index.builtinOccurrences
                  .get(source.document.uri)
                  ?.find((item) => item.span.start === value.callee.start);
                if (occurrence)
                  occurrence.label = callee.builtinSignature!.label;
              }
            }
            const symbol = callee.symbol;
            const signature =
              callee.types.length === 1 ? callee.types[0] : undefined;
            if (signature?.kind !== "function") {
              if (!callee.types.some((type) => type.kind === "error"))
                source.error(
                  "AFL3206",
                  "Calls require a declared function, method or callback type; AFL has no constructor calls.",
                  value.callee,
                );
              value.arguments.forEach((argument) => single(argument, scope));
              return { types: [invalid] };
            }
            if (index) {
              const calls = index.calls.get(source.document.uri) ?? [];
              const symbolId =
                symbol?.declaration.kind === "function"
                  ? index.id(
                      symbol.module.source.document.uri,
                      symbol.declaration.name,
                    )
                  : callee.bindingId;
              const entry = symbolId ? index.symbols.get(symbolId) : undefined;
              calls.push({
                uri: source.document.uri,
                span: value,
                arguments: value.arguments,
                open: source.document.text.indexOf("(", value.callee.end),
                symbolId,
                ...(callee.builtinSignature
                  ? { signature: callee.builtinSignature }
                  : symbol?.declaration.kind === "function"
                    ? {}
                    : {
                        signature: {
                          label: indexedType(signature).label,
                          documentation: entry?.documentation ?? "",
                          parameters: signature.inputs.map((type) => ({
                            label: indexedType(type).label,
                            documentation: "",
                          })),
                        },
                      }),
              });
              index.calls.set(source.document.uri, calls);
            }
            if (value.arguments.length !== signature.inputs.length)
              source.error(
                "AFL3206",
                `Expected ${signature.inputs.length} argument(s), received ${value.arguments.length}.`,
                value,
              );
            if (!numericArguments)
              value.arguments.forEach((argument, index) =>
                single(argument, scope, signature.inputs[index]),
              );
            return { types: signature.results };
          }
          case "initializer":
            return initializer(value, scope, expected?.[0]);
          case "unary": {
            const operand = single(value.value, scope);
            return {
              types:
                value.operator === "!" && operand.types[0]?.kind !== "error"
                  ? [{ kind: "builtin", name: "bool", arguments: [] }]
                  : operand.types,
            };
          }
          case "binary": {
            const left = single(value.left, scope).types[0]!,
              right = single(value.right, scope).types[0]!;
            if (["==", "!="].includes(value.operator)) {
              checkUnion(left, right, value.left);
              checkUnion(right, left, value.right);
            }
            if (value.operator === "/") {
              for (const [type, span] of [
                [left, value.left],
                [right, value.right],
              ] as const) {
                if (
                  type &&
                  type.kind !== "error" &&
                  type.kind !== "unknown" &&
                  !(type.kind === "builtin" && type.name === "any") &&
                  !isNumeric(type)
                )
                  source.error(
                    "AFL3210",
                    "Division requires numeric operands. '/' returns f64; use to_int(a / b) for truncating integer division.",
                    span,
                  );
              }
              return {
                types: [{ kind: "builtin", name: "f64", arguments: [] }],
              };
            }
            if (
              ["==", "!=", "<", ">", "<=", ">=", "&&", "||"].includes(
                value.operator,
              )
            )
              return {
                types: [{ kind: "builtin", name: "bool", arguments: [] }],
              };
            return {
              types: [
                isNumeric(left) && isNumeric(right) && left.name === right.name
                  ? left
                  : unknown,
              ],
            };
          }
          case "if":
          case "when": {
            const checkBranch = (body: AST.Block): Type[] => {
              const types = block(body, scope, expected);
              if (
                expected &&
                body.statements.at(-1)?.kind !== "return" &&
                !types.some((type) => type.kind === "error")
              ) {
                arity(types.length, expected.length, body);
              }
              return types;
            };
            const branches = value.branches.map((branch) => {
              single(branch.condition, scope);
              return checkBranch(branch.body);
            });
            if (value.otherwise) branches.push(checkBranch(value.otherwise));
            const first = branches[0] ?? [];
            const merged = first.map((type, index) =>
              branches.every(
                (branch) =>
                  branch.length === first.length &&
                  sameType(type, branch[index]!),
              )
                ? type
                : unknown,
            );
            return { types: expected ?? merged };
          }
        }
      } finally {
        depth--;
      }
    }

    for (const field of node.documentation?.fields ?? [])
      descriptionLinks(field.value, rootScope);
    if (fn?.body) {
      const anonymous = fn.results.length === 1 && !fn.results[0]!.name;
      const actual = block(
        fn.body,
        rootScope,
        anonymous ? resultTypes : undefined,
      );
      const last = fn.body.statements.at(-1);
      if (
        anonymous &&
        last?.kind === "expression" &&
        !actual.some((type) => type.kind === "error")
      )
        arity(actual.length, 1, last);
    } else if (
      (!("kind" in node) || node.kind === "constant") &&
      node.initializer
    ) {
      single(node.initializer, rootScope, resolveType(node.type, state));
    }
  }

  for (const state of modules.values()) {
    if (!state.valid && !index) continue;
    for (const declaration of state.tree.declarations) {
      if (declaration.kind === "constant") {
        const type = resolveType(declaration.type, state);
        const entry = index?.symbols.get(
          index.id(state.source.document.uri, declaration.name),
        );
        if (entry) entry.type = indexedType(type);
        checkBody(declaration, state);
      }
      if (
        declaration.kind === "function" ||
        declaration.kind === "type-alias" ||
        declaration.kind === "unsupported"
      )
        checkBody(declaration, state);
      if (declaration.kind === "class" || declaration.kind === "struct") {
        const symbol: Symbol = { declaration, module: state };
        checkBody(declaration, state);
        for (const property of declaration.properties) {
          const type = resolveType(property.type, state);
          if (index) {
            const entry = index.symbols.get(
              index.id(state.source.document.uri, property.name),
            );
            if (entry) entry.type = indexedType(type);
          }
          checkBody(property, state);
        }
        for (const fn of declaration.kind === "class"
          ? declaration.methods
          : [])
          checkBody(fn, state, symbol);
      }
    }
    if (
      state.crate?.kind === "binary" &&
      state.source.document.uri === new URL("main.afl", state.crate.root).href
    ) {
      const entry = state.exports.get("main")?.declaration;
      if (entry?.kind !== "function" || entry.external)
        state.source.error(
          "AFL3000",
          "main.afl must define a non-extern main function.",
          { start: 0, end: 0 },
        );
    }
  }
  for (const state of modules.values())
    diagnostics.push(...state.source.diagnostics);
  const unique = [
    ...new Map(
      diagnostics.map((item) => [JSON.stringify(item), item]),
    ).values(),
  ];
  unique.sort(
    (a, b) =>
      a.uri.localeCompare(b.uri) ||
      a.range.start.line - b.range.start.line ||
      a.range.start.character - b.range.start.character ||
      a.code.localeCompare(b.code),
  );
  index?.finish();
  return { status: "complete", diagnostics: unique };
}
