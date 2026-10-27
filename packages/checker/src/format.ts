import type { Diagnostic, SourceDocument, Span } from "./index.js";
import { Lexer, type Token } from "./lexer.js";
import { parseDocument } from "./parser.js";
import { Source } from "./source.js";

export interface FormatOptions {
  tabSize?: number;
  insertSpaces?: boolean;
}
export interface FormatResult {
  text: string;
  diagnostics: readonly Diagnostic[];
}

export function formatIndent(options: FormatOptions): string {
  const size = options.tabSize ?? 4;
  if (!Number.isInteger(size) || size < 1 || size > 16)
    throw new Error("Indent width must be an integer from 1 to 16.");
  return options.insertSpaces === false ? "\t" : " ".repeat(size);
}

/** A lossless token printer: the AST classifies layout, never reconstructs text. */
export function formatDocument(
  document: SourceDocument,
  options: FormatOptions = {},
): FormatResult {
  const indent = formatIndent(options),
    parsed = parseDocument(document);
  const syntax = parsed.diagnostics.filter((issue) =>
    issue.code.startsWith("AFL1"),
  );
  if (syntax.length) return { text: document.text, diagnostics: syntax };
  const original = document.text,
    source = new Source(document),
    lexer = new Lexer(source);
  const opaque = new Set(parsed.opaqueSpans.map((span) => span.start)),
    tokens: Token[] = [];
  for (;;) {
    let token = lexer.take();
    if (token.kind === "eof") break;
    if (token.kind === "newline") continue;
    if (token.text === "[" && opaque.has(token.start)) {
      const description = lexer.description(token.start);
      token = { ...token, kind: "raw-description", end: description.end };
    }
    tokens.push({ ...token, text: original.slice(token.start, token.end) });
  }
  const eol = /\r\n|\r|\n/u.exec(original)?.[0] ?? "\n";
  const before = new Set<number>(),
    unary = new Set<number>(),
    typeAngles = new Set<number>();
  const scopes = new Map<number, { close: number; multiline: boolean }>();
  const tokenAt = new Map(tokens.map((token, index) => [token.start, index]));
  const scope = (span: Span, opening: string, force = false): void => {
    const first = tokens.findIndex(
      (token) => token.start >= span.start && token.text === opening,
    );
    const last = tokenAt.get(span.end - 1);
    if (first < 0 || last === undefined || first >= last) return;
    const multiline =
      last > first + 1 &&
      (force ||
        /[\r\n]/u.test(
          original.slice(tokens[first]!.end, tokens[last]!.start),
        ));
    scopes.set(first, { close: last, multiline });
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown> & Span;
    if (
      node.kind === "description" ||
      node.kind === "literal" ||
      node.kind === "name"
    )
      return;
    if (node.kind === "unary") unary.add(node.start);
    if (node.kind === "named-type" || node.kind === "function-type") {
      for (const token of tokens)
        if (
          token.start >= node.start &&
          token.end <= node.end &&
          ["<", ">"].includes(token.text)
        )
          typeAngles.add(token.start);
    }
    if (Array.isArray(node.statements)) scope(node, "{", true);
    if (node.kind === "class" || node.kind === "struct") {
      const doc = node.documentation as Span | undefined,
        name = node.name as Span;
      scope({ start: doc?.end ?? name.end, end: node.end }, "{", true);
    }
    if (node.kind === "when") scope(node, "{", true);
    if (node.kind === "initializer") scope(node, "{");
    if (Array.isArray(node.fields)) scope(node, "[");
    for (const [key, child] of Object.entries(node)) {
      if (
        [
          "statements",
          "declarations",
          "properties",
          "methods",
          "fields",
        ].includes(key) &&
        Array.isArray(child)
      ) {
        for (const item of child)
          if (item && typeof item === "object") {
            const start =
              (item as Span).start ?? (item as { name?: Span }).name?.start;
            if (start !== undefined) before.add(start);
          }
      }
      visit(child);
    }
  };
  visit(parsed.module);
  for (const group of parsed.importGroups)
    scope({ start: group.content.start - 1, end: group.end }, "{");
  // Parentheses and type arguments retain existing line breaks and gain indentation.
  const pairs: number[] = [];
  tokens.forEach((token, index) => {
    if (
      token.text === "(" ||
      (token.text === "<" && typeAngles.has(token.start))
    )
      pairs.push(index);
    if (
      token.text === ")" ||
      (token.text === ">" && typeAngles.has(token.start))
    ) {
      const open = pairs.pop();
      if (open !== undefined)
        scopes.set(open, {
          close: index,
          multiline: /[\r\n]/u.test(
            original.slice(tokens[open]!.end, token.start),
          ),
        });
    }
  });
  const closing = new Map(
    [...scopes].map(([open, value]) => [value.close, { open, ...value }]),
  );
  const tight = (token: Token | undefined): boolean =>
    !!token && [".", "::", "?"].includes(token.text);
  let text = original.startsWith("\uFEFF") ? "\uFEFF" : "",
    depth = 0;
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1],
      close = closing.get(index),
      open = scopes.get(index - 1);
    if (close?.multiline) depth--;
    if (open?.multiline) depth++;
    let separator = "";
    if (previous) {
      const gap = original.slice(previous.end, token.start),
        breaks = gap.match(/\r\n|\r|\n/gu)?.length ?? 0;
      const join =
        (token.text === "else" && tokens[index + 1]?.text !== "->") ||
        (token.text === "{" && scopes.has(index) && previous.text !== "::") ||
        (token.text === "[" && scopes.has(index));
      const boundary =
        before.has(token.start) &&
        previous.text !== "[" &&
        previous.text !== "{" &&
        previous.text !== "::";
      const line =
        open?.multiline ||
        close?.multiline ||
        boundary ||
        (breaks > 0 && !join);
      if (line)
        separator =
          eol.repeat(
            breaks > 1 && !open?.multiline && !close?.multiline ? 2 : 1,
          ) + indent.repeat(Math.max(0, depth));
      else if (
        token.text === "," ||
        token.text === ":" ||
        token.text === ")" ||
        token.text === "]" ||
        tight(token) ||
        (tight(previous) && previous.text !== "?") ||
        unary.has(previous.start) ||
        typeAngles.has(token.start) ||
        (previous.text === "<" && typeAngles.has(previous.start)) ||
        previous.text === "(" ||
        previous.text === "[" ||
        previous.text === "{" ||
        token.text === "}" ||
        (token.text === "(" &&
          ((previous.kind === "name" &&
            !["if", "while", "for", "when", "return"].includes(
              previous.text,
            )) ||
            [")", "]", "?"].includes(previous.text)))
      )
        separator = "";
      else separator = " ";
    }
    text += separator + token.text;
  });
  if (tokens.length) text += eol;
  // Refuse a layout that changes parse structure, including newline-sensitive returns.
  const formatted = parseDocument({ ...document, text });
  const shape = (value: unknown): string =>
    JSON.stringify(value, (key, item: unknown) =>
      key === "start" || key === "end" ? undefined : item,
    );
  if (
    formatted.diagnostics.some((issue) => issue.code.startsWith("AFL1")) ||
    shape(parsed.module) !== shape(formatted.module)
  ) {
    return {
      text: original,
      diagnostics: [
        {
          uri: document.uri,
          code: "AFL6001",
          severity: "error",
          message:
            "Formatting could not preserve the AFL syntax tree; source left unchanged.",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
      ],
    };
  }
  return { text, diagnostics: [] };
}
