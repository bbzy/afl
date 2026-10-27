export interface CollectionMethod<T> {
  name: string;
  documentation: string;
  parameters: { name: string; type: T; documentation: string }[];
  results: T[];
}

export interface MethodSignature {
  label: string;
  documentation: string;
  parameters: { label: string; documentation: string }[];
}

/** Instantiate the built-in contracts with the receiver's resolved type arguments. */
export function collectionMethods<T>(
  name: string,
  args: readonly T[],
  types: {
    i32: T;
    bool: T;
    sortKey: T;
    callback: (inputs: T[], results: T[]) => T;
    nullable: (type: T) => T;
    list: (type: T) => T;
  },
): CollectionMethod<T>[] {
  if (
    !(name === "list" || name === "set" || name === "map") ||
    args.length !== (name === "map" ? 2 : 1)
  )
    return [];
  const element = args[0]!;
  const value = {
    name: "value",
    type: element,
    documentation: "Element to use.",
  };
  const key = { name: "key", type: element, documentation: "Entry key." };
  const index = {
    name: "index",
    type: types.i32,
    documentation: "Zero-based index; requires 0 <= index < len().",
  };
  const method = (
    name: string,
    documentation: string,
    parameters: CollectionMethod<T>["parameters"] = [],
    results: T[] = [],
  ): CollectionMethod<T> => ({ name, documentation, parameters, results });
  const common = [
    method("len", "Number of elements or entries.", [], [types.i32]),
    method("clear", "Remove all elements or entries."),
  ];
  if (name === "map")
    return [
      ...common,
      method(
        "contains_key",
        "Whether the key exists, including entries whose value is null.",
        [key],
        [types.bool],
      ),
      method(
        "get",
        "Read the value, or null if the key is absent. Use contains_key to distinguish an absent key from a null value.",
        [key],
        [types.nullable(args[1]!)],
      ),
      method(
        "set",
        "Insert an entry, replacing the value if the key already exists.",
        [
          key,
          { name: "value", type: args[1]!, documentation: "Value to store." },
        ],
      ),
      method("remove", "Remove the entry; do nothing if the key is absent.", [
        key,
      ]),
      method(
        "keys",
        "Snapshot list of all keys, in unspecified order.",
        [],
        [types.list(element)],
      ),
      method(
        "values",
        "Snapshot list of all values, in unspecified order. Iterate the map directly when key/value correspondence is needed.",
        [],
        [types.list(args[1]!)],
      ),
    ];
  const membership = method(
    "contains",
    "Whether a matching element exists.",
    [value],
    [types.bool],
  );
  if (name === "set")
    return [
      ...common,
      membership,
      method("add", "Add an element; do nothing if it already exists.", [
        value,
      ]),
      method("remove", "Remove the element; do nothing if it is absent.", [
        value,
      ]),
    ];
  const keyFunction = {
    name: "key",
    type: types.callback([element], [types.sortKey]),
    documentation:
      "Extract a non-null numeric, character or string sort key. K denotes this predefined constraint.",
  };
  return [
    ...common,
    membership,
    method(
      "sort",
      "Stable ascending sort in place. Elements must be non-null numbers, characters or strings; use sort_by for objects.",
    ),
    method(
      "sorted",
      "Return a new list in stable ascending order; leave the original unchanged. Elements must be non-null numbers, characters or strings.",
      [],
      [types.list(element)],
    ),
    method(
      "sort_by",
      "Stable ascending sort in place by the extracted key. Numeric keys compare numerically; strings and characters use Unicode scalar order without locale collation.",
      [keyFunction],
    ),
    method(
      "sorted_by",
      "Return a new list stably sorted by the extracted key, leaving the original unchanged. Strings and characters use Unicode scalar order.",
      [keyFunction],
      [types.list(element)],
    ),
    method(
      "get",
      "Read the element at a valid zero-based index.",
      [index],
      [element],
    ),
    method("set", "Replace the element at a valid zero-based index.", [
      index,
      value,
    ]),
    method(
      "index_of",
      "Index of the first matching element, or null if absent.",
      [value],
      [types.nullable(types.i32)],
    ),
    method(
      "remove",
      "Remove the first matching element; do nothing if absent.",
      [value],
    ),
    method("remove_at", "Remove the element at a valid zero-based index.", [
      index,
    ]),
    method("add", "Append an element to the end of the list.", [value]),
    method(
      "insert",
      "Insert before the specified position; index equal to len() appends.",
      [
        {
          ...index,
          documentation:
            "Zero-based insertion position; requires 0 <= index <= len().",
        },
        value,
      ],
    ),
  ];
}

export function collectionSignature<T>(
  receiver: string,
  method: CollectionMethod<T>,
  label: (type: T) => string,
): MethodSignature {
  const parameters = method.parameters.map((parameter) => ({
    label: parameter.name + ": " + label(parameter.type),
    documentation: parameter.documentation,
  }));
  return {
    label:
      "fn " +
      receiver +
      "." +
      method.name +
      "(" +
      parameters.map((parameter) => parameter.label).join(", ") +
      ")" +
      (method.results.length
        ? " -> " + method.results.map(label).join(", ")
        : ""),
    documentation: method.documentation,
    parameters,
  };
}
