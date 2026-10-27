import type { Description, Span } from "./ast.js";
import { Source } from "./source.js";
import { descriptionLinks } from "./description-links.js";

export interface Token extends Span {
  kind:
    | "name"
    | "number"
    | "string"
    | "raw-string"
    | "raw-description"
    | "char"
    | "symbol"
    | "newline"
    | "eof";
  text: string;
  escaped: boolean;
}

export class ParseFailure extends Error {}

export const keywords = new Set([
  "const",
  "static",
  "fn",
  "class",
  "struct",
  "type",
  "extern",
  "use",
  "impl",
  "unsupported",
  "as",
  "return",
  "if",
  "else",
  "while",
  "for",
  "in",
  "when",
  "break",
  "continue",
  "true",
  "false",
  "null",
  "self",
  "crate",
  "dep",
  "desc",
]);

/** Ordinary descriptions are scanned on demand; raw prefixes identify opaque tokens directly. */
export class Lexer {
  private offset = 0;
  private pending: Token[] = [];
  constructor(readonly source: Source) {}

  peek(ahead = 0): Token {
    while (this.pending.length <= ahead) this.pending.push(this.scan());
    return this.pending[ahead]!;
  }

  take(): Token {
    const token = this.peek();
    this.pending.shift();
    return token;
  }

  description(start: number): Description {
    const text = this.source.document.text;
    const region = { start, end: text.length };
    this.source.opaqueSpans.push(region);
    this.pending = [];
    this.offset = start + 1;
    let value = "";
    let depth = 1;
    while (this.offset < text.length) {
      const char = text[this.offset++]!;
      const next = text[this.offset];
      if (char === "\\" && (next === "[" || next === "]" || next === "\\")) {
        value += next;
        this.offset++;
      } else if (char === "]" && --depth === 0) {
        region.end = this.offset;
        return {
          kind: "description",
          text: value,
          raw: false,
          start,
          end: this.offset,
          links: descriptionLinks(
            this.source,
            start + 1,
            this.offset - 1,
            keywords,
          ),
        };
      } else {
        if (char === "[") depth++;
        value += char;
      }
    }
    this.source.error("AFL1001", "Unclosed description.", {
      start,
      end: this.offset,
    });
    return {
      kind: "description",
      text: value,
      raw: false,
      start,
      end: this.offset,
      links: descriptionLinks(this.source, start + 1, this.offset, keywords),
    };
  }

  private fail(message: string, start: number): never {
    this.source.error("AFL1001", message, { start, end: this.offset });
    throw new ParseFailure(message);
  }

  private scan(): Token {
    const text = this.source.document.text;
    while (
      this.offset < text.length &&
      /[ \t\f\v\uFEFF]/u.test(text[this.offset]!)
    )
      this.offset++;
    const start = this.offset;
    const char = text[this.offset];
    const token = (
      kind: Token["kind"],
      value: string,
      escaped = false,
    ): Token => ({
      kind,
      text: value,
      escaped,
      start,
      end: this.offset,
    });
    if (char === undefined) return token("eof", "");
    this.offset++;
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[this.offset] === "\n") this.offset++;
      return token("newline", "\n");
    }
    if (char === "r" && text[this.offset] === "#") {
      const hashStart = this.offset;
      while (text[this.offset] === "#") this.offset++;
      const hashes = text.slice(hashStart, this.offset);
      const opening = text[this.offset++];
      if (opening !== '"' && opening !== "[")
        this.fail(
          "A raw prefix requires a quote or '[' immediately after its '#' characters.",
          start,
        );
      const kind = opening === '"' ? "raw-string" : "raw-description";
      const closing = (opening === '"' ? '"' : "]") + hashes;
      const bodyStart = this.offset;
      const region = { start, end: text.length };
      this.source.opaqueSpans.push(region);
      const bodyEnd = text.indexOf(closing, bodyStart);
      if (bodyEnd === -1) {
        this.offset = text.length;
        this.fail(`Unclosed ${kind}; expected '${closing}'.`, start);
      }
      this.offset = region.end = bodyEnd + closing.length;
      return token(kind, text.slice(bodyStart, bodyEnd));
    }
    if (/[A-Za-z_]/u.test(char)) {
      while (
        this.offset < text.length &&
        /[A-Za-z_0-9]/u.test(text[this.offset]!)
      )
        this.offset++;
      return token("name", text.slice(start, this.offset));
    }
    if (char === "`") {
      while (this.offset < text.length && !/[`\r\n]/u.test(text[this.offset]!))
        this.offset++;
      const value = text.slice(start + 1, this.offset);
      if (text[this.offset] !== "`")
        this.fail("Unclosed escaped identifier.", start);
      this.offset++;
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/u.test(value))
        this.fail("Invalid escaped identifier.", start);
      return token("name", value, true);
    }
    if (/[0-9]/u.test(char)) {
      while (/[0-9]/u.test(text[this.offset] ?? "")) this.offset++;
      if (
        text[this.offset] === "." &&
        /[0-9]/u.test(text[this.offset + 1] ?? "")
      ) {
        this.offset++;
        while (/[0-9]/u.test(text[this.offset] ?? "")) this.offset++;
      }
      return token("number", text.slice(start, this.offset));
    }
    if (char === '"' || char === "'") {
      const region = { start, end: text.length };
      this.source.opaqueSpans.push(region);
      let value = "";
      const escapes: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        "0": "\0",
        "\\": "\\",
        '"': '"',
        "'": "'",
      };
      while (this.offset < text.length && text[this.offset] !== char) {
        let item = text[this.offset++]!;
        if (item === "\n" || item === "\r") {
          region.end = this.offset;
          this.fail(
            "Program string and character literals cannot span lines.",
            start,
          );
        }
        if (item === "\\") {
          const escape = text[this.offset++];
          if (escape === undefined || escapes[escape] === undefined) {
            // A malformed literal cannot make subsequent lines opaque to the editor.
            let end = Math.min(this.offset, text.length);
            while (end < text.length && !/[\r\n]/u.test(text[end]!)) end++;
            region.end = end;
            this.fail("Unsupported literal escape.", start);
          }
          item = escapes[escape]!;
        }
        value += item;
      }
      if (text[this.offset] !== char) this.fail("Unclosed literal.", start);
      this.offset++;
      region.end = this.offset;
      if (
        char === "'" &&
        (Array.from(value).length !== 1 || /[\uD800-\uDFFF]/u.test(value))
      ) {
        this.fail(
          "A character literal must contain one Unicode scalar value.",
          start,
        );
      }
      return token(char === '"' ? "string" : "char", value);
    }
    const pair = char + (text[this.offset] ?? "");
    if (["->", "::", "==", "!=", "<=", ">=", "&&", "||"].includes(pair)) {
      this.offset++;
      return token("symbol", pair);
    }
    if ("(){}[],:.=+-*/%<>!?|".includes(char)) return token("symbol", char);
    this.fail(`Unexpected character ${JSON.stringify(char)}.`, start);
  }
}
