import type { MethodSignature } from "./collections.js";

interface BuiltinFunction {
  numeric?: boolean;
  inputs: string[];
  results: string[];
  signature: MethodSignature;
}

/** Source-independent function contracts, visible after ordinary name lookup. */
export const builtinFunctions = new Map<string, BuiltinFunction>([
  [
    "assert",
    {
      inputs: ["bool"],
      results: [],
      signature: {
        label: "fn assert(condition: bool)",
        documentation:
          "Require the condition to be true. A false condition means assertion failure and must fail the current test when used in a test. AFL describes this requirement without executing it; the Agent implements it in the target project.",
        parameters: [
          {
            label: "condition: bool",
            documentation: "Condition that must hold.",
          },
        ],
      },
    },
  ],
]);

const numeric = (
  name: string,
  parameters: string[],
  result: string,
  documentation: string,
): void => {
  const inputs = parameters.map(() => "T");
  builtinFunctions.set(name, {
    inputs,
    results: [result],
    numeric: true,
    signature: {
      label: `fn ${name}(${parameters.map((parameter) => parameter + ": T").join(", ")}) -> ${result}`,
      documentation:
        documentation +
        " T is a numeric AFL type; these are predefined contracts, not user-defined generics. AFL does not execute the operation.",
      parameters: parameters.map((parameter) => ({
        label: parameter + ": T",
        documentation: "Numeric operand.",
      })),
    },
  });
};
numeric(
  "min",
  ["a", "b"],
  "T",
  "Return the smaller operand. Both operands use the same numeric type.",
);
numeric(
  "max",
  ["a", "b"],
  "T",
  "Return the larger operand. Both operands use the same numeric type.",
);
numeric(
  "abs",
  ["value"],
  "T",
  "Return the absolute value, preserving the numeric type.",
);
numeric(
  "round",
  ["value"],
  "f64",
  "Round to the nearest integer value, with exact halves away from zero; return f64.",
);
numeric(
  "to_int",
  ["value"],
  "i64",
  "Truncate toward zero and return i64. The input must be finite and the result representable as i64.",
);
numeric(
  "to_float",
  ["value"],
  "f64",
  "Convert the numeric value to f64. The target's f64 representation determines precision.",
);
