import type { Diagnostic, SourceDocument, SourcePosition } from "./index.js";
import type { DescriptionLink, ImportGroup, Span } from "./ast.js";

/** Offsets stay in UTF-16 code units throughout parsing and editor conversion. */
export class Source {
  readonly lineStarts = [0];
  readonly diagnostics: Diagnostic[] = [];
  /** Prose and literals are opaque except for explicit description links. */
  readonly opaqueSpans: Span[] = [];
  readonly importGroups: ImportGroup[] = [];
  readonly descriptionLinks: DescriptionLink[] = [];

  constructor(readonly document: SourceDocument) {
    for (let i = 0; i < document.text.length; i++) {
      if (document.text[i] === "\n") this.lineStarts.push(i + 1);
      else if (document.text[i] === "\r" && document.text[i + 1] !== "\n")
        this.lineStarts.push(i + 1);
    }
  }

  position(offset: number): SourcePosition {
    const bounded = Math.max(0, Math.min(offset, this.document.text.length));
    let low = 0;
    let high = this.lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (this.lineStarts[middle]! <= bounded) low = middle;
      else high = middle;
    }
    return { line: low, character: bounded - this.lineStarts[low]! };
  }

  offset(position: SourcePosition): number {
    const line = Math.max(
      0,
      Math.min(position.line, this.lineStarts.length - 1),
    );
    const start = this.lineStarts[line]!;
    let end = this.lineStarts[line + 1] ?? this.document.text.length;
    while (end > start && /[\r\n]/u.test(this.document.text[end - 1]!)) end--;
    return Math.min(end, start + Math.max(0, position.character));
  }

  error(
    code: string,
    message: string,
    span: Span,
    related?: { span: Span; message: string },
  ): void {
    this.diagnostics.push({
      uri: this.document.uri,
      code,
      severity: "error",
      message,
      ...(related
        ? {
            relatedInformation: [
              {
                location: {
                  uri: this.document.uri,
                  range: {
                    start: this.position(related.span.start),
                    end: this.position(related.span.end),
                  },
                },
                message: related.message,
              },
            ],
          }
        : {}),
      range: { start: this.position(span.start), end: this.position(span.end) },
    });
  }
}
