import type * as AST from "./ast.js";

export type Documented =
  | AST.FunctionDeclaration
  | AST.ObjectDeclaration
  | AST.TypeAliasDeclaration
  | AST.Property;
export const documentationKey = (name: AST.Name): string =>
  !name.escaped && ["desc", "return"].includes(name.text)
    ? `keyword:${name.text}`
    : `name:${name.text}`;

/** Presentation/validation view only: inherited text retains its source identity.
 * Never attach this view to the local AST or resolve its links in the local scope. */
export function inheritDocumentation(
  local: Documented,
  target: Documented,
): AST.Documentation {
  const own = local.documentation?.fields ?? [];
  const names = new Map<string, AST.Name>();
  if (
    "kind" in local &&
    local.kind === "function" &&
    "kind" in target &&
    target.kind === "function"
  ) {
    for (const part of ["parameters", "results"] as const) {
      target[part].forEach((parameter, i) => {
        const name = local[part][i]?.name;
        names.set(
          parameter.name ? `name:${parameter.name.text}` : "keyword:return",
          name
            ? { ...name, escaped: true }
            : {
                text: "return",
                escaped: false,
                start: local.name.start,
                end: local.name.end,
              },
        );
      });
    }
  }
  const seen = new Set(own.map((field) => documentationKey(field.name)));
  const fields = [...own];
  for (const field of target.documentation?.fields ?? []) {
    const name = names.get(documentationKey(field.name)) ?? field.name;
    if (!seen.has(documentationKey(name)))
      fields.push({ name, value: field.value });
  }
  return { start: local.start, end: local.end, fields };
}
