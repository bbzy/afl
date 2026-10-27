export interface Span {
  start: number;
  end: number;
}
export interface Name extends Span {
  text: string;
  escaped: boolean;
}
export type TypeRef =
  | (Span & {
      kind: "named-type";
      name: Name;
      arguments: TypeRef[];
      nullable: boolean;
    })
  | (Span & {
      kind: "function-type";
      inputs: TypeRef[];
      results: TypeRef[];
      nullable: boolean;
    });
export interface DescriptionLink extends Span {
  kind: "description-link";
  content: Span;
  path: Name[];
  members: Name[];
  valid: boolean;
}
export interface Description extends Span {
  kind: "description";
  text: string;
  raw: boolean;
  links: DescriptionLink[];
}
export interface Documentation extends Span {
  fields: { name: Name; value: Description }[];
}
export interface Parameter extends Span {
  name: Name | undefined;
  type: TypeRef;
}
export interface FunctionDeclaration extends Span {
  kind: "function";
  name: Name;
  external: boolean;
  parameters: Parameter[];
  results: Parameter[];
  documentation: Documentation | undefined;
  body: Block | undefined;
}
export interface Property extends Span {
  static?: boolean;
  constant?: boolean;
  name: Name & { quoted?: boolean; raw?: boolean };
  optional: boolean;
  type: TypeRef;
  initializer: Expression | undefined;
  documentation: Documentation | undefined;
}
export interface ClassDeclaration extends Span {
  kind: "class";
  name: Name;
  external: boolean;
  documentation: Documentation | undefined;
  properties: Property[];
  methods: FunctionDeclaration[];
}
/** Pure data: properties only, with no methods or constructors. */
export interface StructDeclaration extends Span {
  kind: "struct";
  name: Name;
  external: boolean;
  documentation: Documentation | undefined;
  properties: Property[];
}
export type ObjectDeclaration = ClassDeclaration | StructDeclaration;
export interface ImportGroup extends Span {
  path: Name[];
  content: Span;
}
export interface ImportDeclaration extends Span {
  kind: "import";
  path: Name[];
  alias: Name | undefined;
}
export interface ImplementationDeclaration extends Span {
  kind: "implementation";
  path: Name[];
}
export interface TypeAliasDeclaration extends Span {
  kind: "type-alias";
  name: Name;
  /** Extern types are opaque nominal declarations; values is empty. */
  external: boolean;
  values: Literal[];
  documentation: Documentation | undefined;
}
export interface UnsupportedDeclaration extends Span {
  kind: "unsupported";
  path: Name[];
  documentation: Documentation | undefined;
}
export interface ConstantDeclaration extends Property {
  kind: "constant";
  external: false;
}
export type Declaration =
  | ConstantDeclaration
  | UnsupportedDeclaration
  | TypeAliasDeclaration
  | FunctionDeclaration
  | ObjectDeclaration
  | ImportDeclaration
  | ImplementationDeclaration;
export interface Module extends Span {
  declarations: Declaration[];
}
export interface Block extends Span {
  statements: Statement[];
}
export interface NameExpression extends Span {
  kind: "name";
  name: Name;
}
export interface Literal extends Span {
  kind: "literal";
  literalType: "number" | "string" | "char" | "bool" | "null";
  value: string | boolean | null;
  /** Present on string literals; the source span retains the complete delimiter. */
  raw?: boolean;
}
export interface IfExpression extends Span {
  kind: "if";
  branches: { condition: Expression; body: Block }[];
  otherwise: Block | undefined;
}
export interface WhenExpression extends Omit<IfExpression, "kind"> {
  kind: "when";
}
export interface Initializer extends Span {
  kind: "initializer";
  entries: { key: Expression | undefined; value: Expression }[];
}
export type Expression =
  | NameExpression
  | Literal
  | Description
  | IfExpression
  | WhenExpression
  | Initializer
  | (Span & { kind: "unary"; operator: string; value: Expression })
  | (Span & {
      kind: "binary";
      operator: string;
      left: Expression;
      right: Expression;
    })
  | (Span & { kind: "member"; object: Expression; name: Name })
  | (Span & { kind: "call"; callee: Expression; arguments: Expression[] });
export type Statement =
  | (Span & {
      kind: "assignment";
      constant?: boolean;
      targets: { value: Expression; type: TypeRef | undefined }[];
      values: Expression[];
    })
  | (Span & { kind: "expression"; values: Expression[] })
  | (Span & { kind: "return"; values: Expression[] })
  | (Span & { kind: "while"; condition: Expression; body: Block })
  | (Span & {
      kind: "for";
      bindings: Name[];
      iterable: Expression;
      body: Block;
    })
  | (Span & { kind: "break" | "continue" });
