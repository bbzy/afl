import type * as AST from "./ast.js";
import type { Diagnostic, SourceDocument } from "./index.js";
import { keywords, Lexer, ParseFailure, type Token } from "./lexer.js";
import { Source } from "./source.js";
import { validateDocumentation } from "./validation.js";

export interface ParseResult {
  module: AST.Module;
  diagnostics: readonly Diagnostic[];
  opaqueSpans: readonly AST.Span[];
  descriptionLinks: readonly AST.DescriptionLink[];
  importGroups: readonly AST.ImportGroup[];
}

const precedence: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

class Parser {
  private readonly lexer: Lexer;
  private lastEnd = 0;
  private layout = 0;
  private insertedBoundary = -1;
  private halted = false;
  private depth = 0;

  constructor(readonly source: Source) {
    this.lexer = new Lexer(source);
  }

  parse(): AST.Module {
    const declarations: AST.Declaration[] = [];
    while (true) {
      try {
        this.newlines();
        if (this.peek().kind === "eof") break;
        const declaration = this.declaration();
        declarations.push(
          ...(Array.isArray(declaration) ? declaration : [declaration]),
        );
        this.boundary(this.lastEnd);
      } catch (error) {
        this.recover(error, false);
      }
    }
    return { declarations, start: 0, end: this.source.document.text.length };
  }

  private peek(ahead = 0): Token {
    return this.lexer.peek(ahead);
  }
  private at(text: string): boolean {
    const token = this.peek();
    return (
      (token.kind === "name" || token.kind === "symbol") &&
      token.text === text &&
      !token.escaped
    );
  }
  private take(): Token {
    const token = this.lexer.take();
    this.lastEnd = token.end;
    return token;
  }
  private accept(text: string): Token | undefined {
    return this.at(text) ? this.take() : undefined;
  }
  private expect(text: string): Token {
    if (!this.at(text)) this.fail(`Expected '${text}'.`);
    return this.take();
  }
  private closing(text: string): number {
    if (this.at(text)) return this.take().end;
    if (this.halted && this.peek().kind === "eof") return this.peek().start;
    if (this.peek().kind !== "eof" && !this.at("}"))
      return this.expect(text).end;
    this.source.error("AFL1002", `Expected '${text}'.`, this.peek());
    return this.peek().start;
  }
  private fail(message: string, span: AST.Span = this.peek()): never {
    this.source.error("AFL1002", message, span);
    throw new ParseFailure(message);
  }
  private newlines(): void {
    while (this.peek().kind === "newline") this.take();
  }
  private follows(text: string): boolean {
    let ahead = 0;
    while (this.peek(ahead).kind === "newline") ahead++;
    const token = this.peek(ahead);
    return (
      (token.kind === "name" || token.kind === "symbol") &&
      token.text === text &&
      !token.escaped
    );
  }
  private boundary(end: number): void {
    const next = this.peek();
    if (next.start === this.insertedBoundary) {
      this.insertedBoundary = -1;
      return;
    }
    if (
      next.kind === "eof" ||
      this.at("}") ||
      this.at("]") ||
      this.at(")") ||
      next.kind === "newline"
    )
      return;
    if (/[\r\n]/u.test(this.source.document.text.slice(end, next.start)))
      return;
    this.fail("Statements and declarations must be separated by a newline.");
  }
  private recover(error: unknown, inside: boolean): void {
    if (!(error instanceof ParseFailure)) throw error;
    // Skip text as text during recovery, rather than lexing every character of
    // a displaced documentation block as source code. Only the root error survives.
    const count = this.source.diagnostics.length;
    try {
      while (true) {
        try {
          if (this.peek().kind === "eof") {
            if (
              this.source.diagnostics
                .slice(0, count)
                .some(
                  (issue) =>
                    issue.code === "AFL1001" &&
                    this.source.offset(issue.range.end) ===
                      this.source.document.text.length,
                )
            )
              this.halted = true;
            return;
          }
          if (this.peek().kind === "newline") {
            this.take();
            return;
          }
          if (inside && this.at("}")) return;
          if (this.at("[")) this.lexer.description(this.take().start);
          else this.take();
        } catch (next) {
          if (!(next instanceof ParseFailure)) throw next;
        }
      }
    } finally {
      this.source.diagnostics.splice(count);
    }
  }
  private closeBlock(opening: AST.Span, context: string): number {
    if (this.at("}")) return this.take().end;
    const token = this.peek();
    if (this.halted && token.kind === "eof") return token.start;
    const mismatch = this.at("]") || this.at(")");
    this.source.error(
      "AFL1002",
      `Expected '}' to close ${context}; ${mismatch ? `replace '${token.text}' with '}'` : "insert '}' before this location"}.`,
      token,
      { span: opening, message: `${context} starts here.` },
    );
    if (!mismatch) this.insertedBoundary = token.start;
    return mismatch ? this.take().end : token.start;
  }

  private nested<T>(operation: () => T): T {
    if (++this.depth > 256) {
      this.depth--;
      this.fail("Syntax nesting exceeds 256 levels.");
    }
    try {
      return operation();
    } finally {
      this.depth--;
    }
  }
  private name(allowKeyword = false): AST.Name {
    const token = this.peek();
    if (
      token.kind !== "name" ||
      (!allowKeyword && !token.escaped && keywords.has(token.text))
    ) {
      this.fail("Expected an identifier; escape keyword names with backticks.");
    }
    this.take();
    return {
      text: token.text,
      escaped: token.escaped,
      start: token.start,
      end: token.end,
    };
  }
  private type(): AST.TypeRef {
    return this.nested(() => {
      const start = this.peek().start;
      let type: AST.TypeRef;
      let suffix = true;
      if (this.accept("fn")) {
        const inputs = this.typeList();
        let results: AST.TypeRef[] = [];
        if (this.accept("->")) {
          suffix = false;
          this.newlines();
          // Parentheses delimit multiple callback results from the containing
          // parameter/result list. A single parenthesized result is a type group.
          if (this.at("(")) {
            const groupStart = this.peek().start;
            results = this.typeList();
            if (!results.length)
              this.fail("Omit '->' for a callback without results.");
            if (results.length === 1) {
              results[0] = {
                ...results[0]!,
                start: groupStart,
                end: this.lastEnd,
              };
              if (this.accept("?"))
                results[0] = this.nullableType(results[0]!, this.lastEnd);
            }
          } else results = [this.type()];
          if (this.at("?"))
            this.fail(
              "Parenthesize the complete callback type before adding '?'.",
            );
        }
        type = {
          kind: "function-type",
          inputs,
          results,
          nullable: false,
          start,
          end: this.lastEnd,
        };
      } else if (this.accept("(")) {
        this.newlines();
        type = this.type();
        this.newlines();
        this.expect(")");
        type = { ...type, start, end: this.lastEnd };
      } else {
        const name = this.name();
        const args: AST.TypeRef[] = [];
        if (this.accept("<")) {
          this.newlines();
          if (this.at(">")) this.fail("Type arguments cannot be empty.");
          do {
            this.newlines();
            args.push(this.type());
            this.newlines();
          } while (this.accept(","));
          this.expect(">");
        }
        type = {
          kind: "named-type",
          name,
          arguments: args,
          nullable: false,
          start,
          end: this.lastEnd,
        };
      }
      if (suffix && this.accept("?"))
        type = this.nullableType(type, this.lastEnd);
      if (this.at("?"))
        this.fail("A type may have only one nullable '?' suffix.");
      return type;
    });
  }
  private nullableType(type: AST.TypeRef, end: number): AST.TypeRef {
    if (type.nullable)
      this.fail("A type may have only one nullable '?' suffix.");
    return { ...type, nullable: true, end };
  }
  private typeList(): AST.TypeRef[] {
    this.expect("(");
    const types: AST.TypeRef[] = [];
    this.newlines();
    while (!this.at(")") && this.peek().kind !== "eof") {
      types.push(this.type());
      this.newlines();
      if (!this.accept(",")) break;
      this.newlines();
    }
    this.expect(")");
    return types;
  }
  private description(): AST.Description {
    if (this.peek().kind === "raw-description") {
      const token = this.take();
      return {
        kind: "description",
        text: token.text,
        raw: true,
        links: [],
        start: token.start,
        end: token.end,
      };
    }
    const opening = this.expect("[");
    const result = this.lexer.description(opening.start);
    this.lastEnd = result.end;
    if (
      result.end === this.source.document.text.length &&
      this.source.diagnostics.some(
        (issue) =>
          issue.code === "AFL1001" && issue.message === "Unclosed description.",
      )
    )
      this.halted = true;
    return result;
  }
  private documentation(): AST.Documentation | undefined {
    if (!this.follows("[")) return undefined;
    this.newlines();
    const opening = this.expect("[");
    const fields: AST.Documentation["fields"] = [];
    this.newlines();
    while (!this.at("]") && this.peek().kind !== "eof") {
      const name = this.name(true);
      this.expect("=");
      const value = this.description();
      fields.push({ name, value });
      if (!this.at("]") && this.peek().kind !== "newline")
        this.fail("Documentation fields require a newline separator.");
      this.newlines();
    }
    return { fields, start: opening.start, end: this.expect("]").end };
  }
  private declaration(): AST.Declaration | AST.Declaration[] {
    const start = this.peek().start;
    if (this.at("use") || this.at("impl") || this.at("unsupported")) {
      const keyword = this.take().text;
      const implementation = keyword === "impl";
      const path = [this.name(true)];
      while (this.accept("::")) {
        if (keyword === "use" && this.at("{")) {
          const opening = this.take();
          const group: AST.ImportGroup = {
            path,
            start,
            end: this.source.document.text.length,
            content: {
              start: opening.end,
              end: this.source.document.text.length,
            },
          };
          this.source.importGroups.push(group);
          const imports: AST.ImportDeclaration[] = [];
          this.newlines();
          while (!this.at("}") && this.peek().kind !== "eof") {
            const name = this.name();
            if (this.at("::"))
              this.fail(
                "Nested import groups are not supported. List symbols directly, or use another use declaration.",
              );
            const alias = this.accept("as") ? this.name() : undefined;
            imports.push({
              kind: "import",
              path: [...path, name],
              alias,
              start,
              end: this.lastEnd,
            });
            this.newlines();
            if (!this.accept(",")) break;
            this.newlines();
          }
          group.content.end = this.peek().start;
          if (!imports.length && this.at("}"))
            this.source.error(
              "AFL1002",
              "An import group must contain at least one symbol.",
              this.peek(),
            );
          group.end = this.closing("}");
          return imports;
        }
        path.push(this.name());
      }
      if (path.length < 2)
        this.fail("A symbol path needs a module path and a symbol.", path[0]);
      if (implementation)
        return { kind: "implementation", path, start, end: this.lastEnd };
      if (keyword === "unsupported") {
        const documentation = this.documentation();
        return {
          kind: "unsupported",
          path,
          documentation,
          start,
          end: this.lastEnd,
        };
      }
      const alias = this.accept("as") ? this.name() : undefined;
      return { kind: "import", path, alias, start, end: this.lastEnd };
    }
    if (this.accept("type")) {
      const name = this.name();
      this.expect("=");
      const values: AST.Literal[] = [];
      do {
        this.newlines();
        const token = this.peek();
        if (token.kind !== "string" && token.kind !== "raw-string")
          this.fail(
            "A string union requires string literals separated by '|'.",
          );
        this.take();
        values.push({
          kind: "literal",
          literalType: "string",
          value: token.text,
          raw: token.kind === "raw-string",
          start: token.start,
          end: token.end,
        });
        if (this.follows("|")) this.newlines();
      } while (this.accept("|"));
      const documentation = this.documentation();
      return {
        kind: "type-alias",
        name,
        values,
        documentation,
        external: false,
        start,
        end: this.lastEnd,
      };
    }
    if (this.accept("const")) {
      const name = this.name();
      this.expect(":");
      const type = this.type();
      this.expect("=");
      const initializer = this.expression();
      const documentation = this.documentation();
      return {
        kind: "constant",
        external: false,
        constant: true,
        name,
        optional: false,
        type,
        initializer,
        documentation,
        start,
        end: this.lastEnd,
      };
    }
    const external = Boolean(this.accept("extern"));
    if (external && this.accept("type")) {
      const name = this.name();
      const documentation = this.documentation();
      return {
        kind: "type-alias",
        name,
        values: [],
        documentation,
        external: true,
        start,
        end: this.lastEnd,
      };
    }
    if (this.at("fn")) return this.function(external, start);
    if (this.at("class") || this.at("struct")) {
      const kind = this.take().text as "class" | "struct";
      const name = this.name();
      const documentation = this.documentation();
      this.newlines();
      const opening = this.expect("{");
      const properties: AST.Property[] = [];
      const methods: AST.FunctionDeclaration[] = [];
      this.newlines();
      while (
        !this.at("}") &&
        !this.at("]") &&
        !this.at(")") &&
        this.peek().kind !== "eof"
      ) {
        try {
          if (this.at("fn")) {
            const method = this.function(external, this.peek().start, true);
            if (kind === "struct")
              this.source.error(
                "AFL1003",
                "A struct only declares fields; methods belong in a class.",
                method,
              );
            else methods.push(method);
          } else {
            const memberStart = this.peek().start;
            const shared = Boolean(this.accept("static"));
            const constant = !shared && Boolean(this.accept("const"));
            if (kind === "struct" && (shared || constant))
              this.fail(
                "Static properties and constants belong in a class, not a struct.",
              );
            let propertyName: AST.Property["name"];
            if (
              kind === "struct" &&
              ["string", "raw-string"].includes(this.peek().kind)
            ) {
              const token = this.take();
              propertyName = {
                text: token.text,
                escaped: false,
                quoted: true,
                raw: token.kind === "raw-string",
                start: token.start,
                end: token.end,
              };
            } else propertyName = this.name();
            const optional = kind === "struct" && Boolean(this.accept("?"));
            this.expect(":");
            const type = this.type();
            const initializer = this.accept("=")
              ? this.expression()
              : undefined;
            if ((constant || (shared && !external)) && !initializer)
              this.fail(
                "A constant or ordinary static property requires an initializer.",
              );
            const docs = this.documentation();
            properties.push({
              name: propertyName,
              optional,
              type,
              initializer,
              documentation: docs,
              ...(shared || constant ? { static: true, constant } : {}),
              start: memberStart,
              end: this.lastEnd,
            });
          }
          this.boundary(this.lastEnd);
        } catch (error) {
          this.recover(error, true);
        }
        this.newlines();
      }
      const common = {
        name,
        external,
        documentation,
        properties,
        start,
        end: this.closeBlock(opening, `${kind} body`),
      };
      return kind === "class"
        ? { kind, ...common, methods }
        : { kind, ...common };
    }
    this.fail(
      "Expected a function, class, struct, external declaration, use or impl.",
    );
  }
  private function(
    external: boolean,
    start: number,
    member = false,
  ): AST.FunctionDeclaration {
    this.expect("fn");
    const name = this.name();
    this.expect("(");
    const parameters: AST.Parameter[] = [];
    this.newlines();
    while (!this.at(")") && this.peek().kind !== "eof") {
      if (member && this.at("self")) {
        const token = this.take();
        this.source.error(
          "AFL1003",
          "Member methods already provide self implicitly. Remove self from the parameter list and use self.member in the body.",
          token,
        );
        if (this.accept(":")) this.type();
        this.newlines();
        if (!this.accept(",")) break;
        this.newlines();
        continue;
      }
      const parameterName = this.name();
      this.expect(":");
      const type = this.type();
      parameters.push({
        name: parameterName,
        type,
        start: parameterName.start,
        end: type.end,
      });
      this.newlines();
      if (!this.accept(",")) break;
      this.newlines();
    }
    this.expect(")");
    const results: AST.Parameter[] = [];
    if (this.accept("->")) {
      do {
        this.newlines();
        const resultStart = this.peek().start;
        const resultName = this.peek(1).text === ":" ? this.name() : undefined;
        if (resultName) this.expect(":");
        const type = this.type();
        results.push({
          name: resultName,
          type,
          start: resultStart,
          end: type.end,
        });
      } while (this.accept(","));
      if (results.length > 1 && results.some((result) => !result.name)) {
        this.source.error(
          "AFL1003",
          "Every result in a multiple return signature must be named.",
          name,
        );
      }
    }
    const documentation = this.documentation();
    let body: AST.Block | undefined;
    if (this.follows("{")) {
      this.newlines();
      body = this.block("method body");
    }
    if (external && body)
      this.source.error(
        "AFL1003",
        "An extern function cannot have a body.",
        body,
      );
    return {
      kind: "function",
      name,
      external,
      parameters,
      results,
      documentation,
      body,
      start,
      end: this.lastEnd,
    };
  }
  private block(context = "block"): AST.Block {
    return this.nested(() => {
      const opening = this.expect("{");
      const start = opening.start;
      const previousLayout = this.layout;
      this.layout = 0;
      const statements: AST.Statement[] = [];
      try {
        while (true) {
          try {
            this.newlines();
            if (
              this.at("}") ||
              this.at("]") ||
              this.at(")") ||
              this.peek().kind === "eof" ||
              [
                "fn",
                "class",
                "struct",
                "type",
                "extern",
                "use",
                "impl",
                "unsupported",
              ].some((keyword) => this.at(keyword))
            )
              break;
            const statement = this.statement();
            statements.push(statement);
            this.boundary(statement.end);
          } catch (error) {
            this.recover(error, true);
          }
        }
        return { statements, start, end: this.closeBlock(opening, context) };
      } finally {
        this.layout = previousLayout;
      }
    });
  }
  private statement(): AST.Statement {
    const start = this.peek().start;
    if (this.at("break") || this.at("continue")) {
      const keyword = this.take();
      return {
        kind: keyword.text as "break" | "continue",
        start,
        end: keyword.end,
      };
    }
    if (this.accept("return")) {
      const values =
        this.peek().kind === "newline" ||
        this.at("}") ||
        this.peek().kind === "eof"
          ? []
          : this.expressions();
      return { kind: "return", values, start, end: this.lastEnd };
    }
    if (this.accept("while")) {
      const condition = this.expression();
      this.newlines();
      const body = this.block();
      return { kind: "while", condition, body, start, end: body.end };
    }
    if (this.accept("for")) {
      const bindings = [this.name()];
      while (this.accept(",")) bindings.push(this.name());
      this.expect("in");
      const iterable = this.expression();
      this.newlines();
      const body = this.block();
      return { kind: "for", bindings, iterable, body, start, end: body.end };
    }
    if (this.accept("const")) {
      const name = this.name();
      this.expect(":");
      const type = this.type();
      this.expect("=");
      const value = this.expression();
      return {
        kind: "assignment",
        constant: true,
        targets: [
          {
            value: { kind: "name", name, start: name.start, end: name.end },
            type,
          },
        ],
        values: [value],
        start,
        end: this.lastEnd,
      };
    }
    const targets: { value: AST.Expression; type: AST.TypeRef | undefined }[] =
      [];
    do {
      const value = this.expression();
      const type = this.accept(":") ? this.type() : undefined;
      targets.push({ value, type });
    } while (this.accept(","));
    if (this.accept("=")) {
      const values = this.expressions();
      return { kind: "assignment", targets, values, start, end: this.lastEnd };
    }
    if (targets.some((target) => target.type))
      this.fail("A variable declaration requires an initializer.");
    return {
      kind: "expression",
      values: targets.map((target) => target.value),
      start,
      end: this.lastEnd,
    };
  }
  private expressions(): AST.Expression[] {
    const values = [this.expression()];
    while (this.accept(",")) values.push(this.expression());
    return values;
  }
  private expression(minimum = 0): AST.Expression {
    return this.nested(() => {
      if (this.layout) this.newlines();
      let left = this.prefix();
      while (true) {
        if (this.layout) this.newlines();
        if (this.accept(".")) {
          let name: AST.Name;
          if (
            this.peek().kind === "newline" ||
            this.peek().kind === "eof" ||
            this.at("}")
          ) {
            this.source.error(
              "AFL1002",
              "Expected a member name after '.'.",
              this.peek(),
            );
            name = {
              text: "",
              escaped: false,
              start: this.lastEnd,
              end: this.lastEnd,
            };
          } else name = this.name();
          left = {
            kind: "member",
            object: left,
            name,
            start: left.start,
            end: name.end,
          };
        } else if (this.accept("(")) {
          const args: AST.Expression[] = [];
          this.layout++;
          try {
            this.newlines();
            if (!this.at(")") && this.peek().kind !== "eof" && !this.at("}")) {
              do {
                this.newlines();
                if (this.at(")") || this.peek().kind === "eof" || this.at("}"))
                  break;
                args.push(this.expression());
              } while (this.accept(","));
            }
            left = {
              kind: "call",
              callee: left,
              arguments: args,
              start: left.start,
              end: this.closing(")"),
            };
          } finally {
            this.layout--;
          }
        } else {
          const operator = this.peek();
          const rank =
            operator.kind === "symbol" ? precedence[operator.text] : undefined;
          if (rank === undefined || rank < minimum) break;
          this.take();
          const right = this.expression(rank + 1);
          left = {
            kind: "binary",
            operator: operator.text,
            left,
            right,
            start: left.start,
            end: right.end,
          };
        }
      }
      return left;
    });
  }
  private prefix(): AST.Expression {
    const token = this.peek();
    if (this.at("!") || this.at("-")) {
      this.take();
      const value = this.expression(7);
      return {
        kind: "unary",
        operator: token.text,
        value,
        start: token.start,
        end: value.end,
      };
    }
    if (this.accept("(")) {
      this.layout++;
      try {
        const value = this.expression();
        this.expect(")");
        return value;
      } finally {
        this.layout--;
      }
    }
    if (this.at("[") || token.kind === "raw-description")
      return this.description();
    if (this.at("{")) return this.initializer();
    if (this.at("if")) return this.conditional();
    if (this.at("when")) return this.when();
    if (
      token.kind === "number" ||
      token.kind === "string" ||
      token.kind === "raw-string" ||
      token.kind === "char"
    ) {
      this.take();
      return {
        kind: "literal",
        literalType: token.kind === "raw-string" ? "string" : token.kind,
        value: token.text,
        start: token.start,
        end: token.end,
        ...(token.kind === "string" || token.kind === "raw-string"
          ? { raw: token.kind === "raw-string" }
          : {}),
      };
    }
    if (this.at("true") || this.at("false")) {
      this.take();
      return {
        kind: "literal",
        literalType: "bool",
        value: token.text === "true",
        start: token.start,
        end: token.end,
      };
    }
    if (this.accept("null")) {
      return {
        kind: "literal",
        literalType: "null",
        value: null,
        start: token.start,
        end: token.end,
      };
    }
    const name = this.at("self") ? this.name(true) : this.name();
    return { kind: "name", name, start: name.start, end: name.end };
  }
  private initializer(): AST.Initializer {
    const start = this.expect("{").start;
    const entries: AST.Initializer["entries"] = [];
    this.layout++;
    try {
      this.newlines();
      while (!this.at("}") && this.peek().kind !== "eof") {
        const first = this.expression();
        const keyed = Boolean(this.accept(":"));
        const value = keyed ? this.expression() : first;
        entries.push({ key: keyed ? first : undefined, value });
        this.newlines();
        if (!this.accept(",")) break;
        this.newlines();
      }
      return { kind: "initializer", entries, start, end: this.expect("}").end };
    } finally {
      this.layout--;
    }
  }
  private conditional(): AST.IfExpression {
    const start = this.peek().start;
    const branches: AST.IfExpression["branches"] = [];
    let otherwise: AST.Block | undefined;
    while (true) {
      this.expect("if");
      const condition = this.expression();
      this.newlines();
      const body = this.block();
      branches.push({ condition, body });
      if (!this.follows("else")) break;
      this.newlines();
      this.expect("else");
      this.newlines();
      if (!this.at("if")) {
        otherwise = this.block();
        break;
      }
    }
    return { kind: "if", branches, otherwise, start, end: this.lastEnd };
  }
  private when(): AST.WhenExpression {
    const start = this.expect("when").start;
    this.newlines();
    this.expect("{");
    const previousLayout = this.layout;
    this.layout = 0;
    const branches: AST.WhenExpression["branches"] = [];
    let otherwise: AST.Block | undefined;
    try {
      this.newlines();
      while (!this.at("}") && this.peek().kind !== "eof") {
        try {
          if (otherwise)
            this.source.error(
              "AFL1003",
              "A when else branch must be unique and last.",
              this.peek(),
            );
          const condition = this.accept("else") ? undefined : this.expression();
          this.newlines();
          this.expect("->");
          this.newlines();
          const body = this.block();
          if (condition) branches.push({ condition, body });
          else otherwise ??= body;
          this.boundary(body.end);
        } catch (error) {
          this.recover(error, true);
        }
        this.newlines();
      }
      if (!branches.length && !otherwise)
        this.source.error(
          "AFL1003",
          "A when expression requires at least one branch.",
          { start, end: this.lastEnd },
        );
      return {
        kind: "when",
        branches,
        otherwise,
        start,
        end: this.closing("}"),
      };
    } finally {
      this.layout = previousLayout;
    }
  }
}

/** Parse syntax and required documentation; dependency checking is separate. */
export function parseDocument(document: SourceDocument): ParseResult {
  const source = new Source(document);
  const module = new Parser(source).parse();
  validateDocumentation(source, module);
  return {
    module,
    diagnostics: source.diagnostics,
    opaqueSpans: source.opaqueSpans,
    descriptionLinks: source.descriptionLinks,
    importGroups: source.importGroups,
  };
}
