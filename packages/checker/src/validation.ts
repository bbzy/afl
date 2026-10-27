import type * as AST from "./ast.js";
import { Source } from "./source.js";
import { documentationKey, type Documented } from "./documentation.js";

export function validateDocumentation(
  source: Source,
  module: AST.Module,
  inherited?: ReadonlyMap<Documented, AST.Documentation>,
): void {
  const implNames = new Set(
    module.declarations
      .filter((d) => d.kind === "implementation")
      .map((d) => d.path.at(-1)!.text),
  );
  let deferRequired = false;
  const effective = (node: Documented): AST.Documentation | undefined =>
    inherited?.get(node) ?? node.documentation;
  function documents(
    documentation: AST.Documentation | undefined,
    required: Map<string, string>,
    allowed: Set<string>,
    owner: AST.Span,
  ): void {
    const seen = new Set<string>();
    for (const field of documentation?.fields ?? []) {
      const { name, value } = field;
      const key = documentationKey(name);
      if (!inherited && seen.has(key))
        source.error(
          "AFL2002",
          `Duplicate documentation field '${name.text}'.`,
          name,
        );
      else if (!inherited && !allowed.has(key))
        source.error(
          "AFL2003",
          `Unexpected documentation field '${name.text}'.`,
          name,
        );
      if (!inherited && !value.text.trim())
        source.error(
          "AFL2001",
          `Documentation for '${name.text}' cannot be empty.`,
          value,
        );
      seen.add(key);
    }
    for (const [key, label] of required) {
      if (!deferRequired && !seen.has(key))
        source.error(
          "AFL2001",
          `Missing documentation for ${label}. Add ${key === "keyword:return" ? "return" : key === "keyword:desc" ? "desc" : ["desc", "return"].includes(key.slice(5)) ? "`" + key.slice(5) + "`" : key.slice(5)} = [description] in the documentation block before the body.`,
          owner,
        );
    }
  }

  function functionDocs(fn: AST.FunctionDeclaration): void {
    const required = new Map<string, string>();
    if (!fn.body) required.set("keyword:desc", "'desc'");
    const names = new Set<string>();
    for (const parameter of [...fn.parameters, ...fn.results]) {
      const name = parameter.name;
      if (name) {
        if (!inherited && names.has(name.text))
          source.error(
            "AFL2004",
            `Duplicate input or result name '${name.text}'.`,
            name,
          );
        names.add(name.text);
        required.set(`name:${name.text}`, `parameter '${name.text}'`);
      } else required.set("keyword:return", "the anonymous result ('return')");
    }
    documents(
      effective(fn),
      required,
      new Set([...required.keys(), "keyword:desc"]),
      fn.name,
    );
    if (!inherited && fn.body)
      block(fn.body, 0, fn.results.length === 1 && !fn.results[0]!.name);
  }

  function block(
    body: AST.Block,
    loops: number,
    needsValue: boolean,
    inFunction = true,
  ): void {
    for (const [index, statement] of body.statements.entries()) {
      switch (statement.kind) {
        case "expression":
          for (const value of statement.values) {
            expression(
              value,
              loops,
              needsValue && index === body.statements.length - 1,
              true,
              inFunction,
            );
          }
          break;
        case "assignment":
          for (const target of statement.targets) {
            expression(target.value, loops, true, false, inFunction);
            if (
              target.value.kind !== "name" &&
              target.value.kind !== "member"
            ) {
              source.error(
                "AFL1003",
                "An assignment target must be a variable or property.",
                target.value,
              );
            }
            if (target.type && target.value.kind !== "name") {
              source.error(
                "AFL1003",
                "A typed declaration requires a variable name.",
                target.value,
              );
            }
          }
          for (const value of statement.values)
            expression(
              value,
              loops,
              true,
              statement.values.length === 1,
              inFunction,
            );
          break;
        case "return":
          if (!inFunction)
            source.error(
              "AFL1003",
              "return is only allowed in a function body.",
              statement,
            );
          for (const value of statement.values)
            expression(value, loops, true, false, inFunction);
          break;
        case "while":
          expression(statement.condition, loops, true, false, inFunction);
          block(statement.body, loops + 1, false, inFunction);
          break;
        case "for":
          expression(statement.iterable, loops, true, false, inFunction);
          block(statement.body, loops + 1, false, inFunction);
          break;
        case "break":
        case "continue":
          if (!loops)
            source.error(
              "AFL1005",
              `'${statement.kind}' is only allowed inside a loop.`,
              statement,
            );
          break;
      }
    }
  }

  function expression(
    value: AST.Expression,
    loops: number,
    needsValue: boolean,
    descriptionAllowed: boolean,
    inFunction = true,
    depth = 0,
  ): void {
    if (depth >= 256) {
      source.error("AFL1003", "Expression nesting exceeds 256 levels.", value);
      return;
    }
    const child = (item: AST.Expression): void =>
      expression(item, loops, true, false, inFunction, depth + 1);
    switch (value.kind) {
      case "description":
        if (
          !descriptionAllowed ||
          (needsValue && descriptionAllowed && value.text.trim() === "")
        ) {
          source.error(
            "AFL1003",
            "A description must be a standalone action or a nonempty assignment value.",
            value,
          );
        }
        break;
      case "if":
      case "when":
        if (needsValue && !value.otherwise)
          source.error(
            "AFL1004",
            `The ${value.kind} expression requires a final else when used for its value.`,
            value,
          );
        for (const branch of value.branches) {
          child(branch.condition);
          block(branch.body, loops, needsValue, inFunction);
        }
        if (value.otherwise)
          block(value.otherwise, loops, needsValue, inFunction);
        break;
      case "binary":
        child(value.left);
        child(value.right);
        break;
      case "unary":
        child(value.value);
        break;
      case "member":
        child(value.object);
        break;
      case "call":
        child(value.callee);
        value.arguments.forEach(child);
        break;
      case "initializer":
        for (const entry of value.entries) {
          if (entry.key) child(entry.key);
          child(entry.value);
        }
        break;
      case "literal":
      case "name":
        break;
    }
  }

  for (const declaration of module.declarations) {
    const candidate =
      "name" in declaration && implNames.has(declaration.name.text);
    if (inherited && !candidate) continue;
    deferRequired = !inherited && candidate;
    if (declaration.kind === "unsupported") {
      documents(
        declaration.documentation,
        new Map([
          ["keyword:desc", "unsupported reason ('desc')"],
          ["name:fallback", "call handling ('fallback')"],
        ]),
        new Set(["keyword:desc", "name:fallback"]),
        declaration,
      );
    }
    if (declaration.kind === "constant") {
      documents(
        declaration.documentation,
        new Map([["keyword:desc", "'desc'"]]),
        new Set(["keyword:desc"]),
        declaration.name,
      );
      if (!inherited && declaration.initializer)
        expression(declaration.initializer, 0, true, true, false);
    }
    if (declaration.kind === "type-alias") {
      documents(
        declaration.documentation,
        new Map(declaration.external ? [["keyword:desc", "'desc'"]] : []),
        new Set(["keyword:desc"]),
        declaration.name,
      );
      if (
        !inherited &&
        new Set(declaration.values.map((value) => value.value)).size !==
          declaration.values.length
      ) {
        source.error(
          "AFL3202",
          "Duplicate value in string union; keep each allowed string once.",
          declaration,
        );
      }
    }
    if (declaration.kind === "function") functionDocs(declaration);
    if (declaration.kind === "class" || declaration.kind === "struct") {
      const required = new Map([["keyword:desc", "'desc'"]]);
      documents(
        effective(declaration),
        required,
        new Set(required.keys()),
        declaration.name,
      );
      const names = new Set<string>();
      for (const member of [
        ...declaration.properties,
        ...(declaration.kind === "class" ? declaration.methods : []),
      ]) {
        if (!inherited && names.has(member.name.text))
          source.error(
            "AFL2004",
            `Duplicate ${declaration.kind} member '${member.name.text}'.`,
            member.name,
          );
        names.add(member.name.text);
      }
      for (const property of declaration.properties) {
        documents(
          effective(property),
          required,
          new Set(required.keys()),
          property.name,
        );
        if (!inherited && property.initializer)
          expression(property.initializer, 0, true, true, false);
      }
      if (declaration.kind === "class")
        declaration.methods.forEach(functionDocs);
    }
  }
}
