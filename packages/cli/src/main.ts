#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkProject } from "@afl/checker";
import manifest from "../package.json" with { type: "json" };
import { loadProject, queryTrace, queryImpact } from "@afl/checker/node";
import { formatQuery, queryProject } from "./query.js";
import { formatFiles } from "./format.js";

const help = `AFL — shared business logic across languages

Usage:
  afl check [paths...] [--json]
  afl check <project-directory> --preset <name> [--json]
  afl format [paths...] [--check] [--indent-width N] [--tabs] [--json]
  afl symbols [paths...] [--project DIR] [--preset NAME] [--json]
  afl definition <file.afl> --line N --column N [--project DIR] [--preset NAME] [--json]
  afl references <file.afl> --line N --column N [--include-declaration] [--project DIR] [--preset NAME] [--json]
  afl implementations <file.afl> --line N --column N [--project DIR] [--preset NAME] [--json]
  afl trace <associated-file> [--line N [--column N]] [--project DIR] [--preset NAME] [--json]
  afl impact <changed-files...> --project DIR [--preset NAME] [--json]
  afl --help
  afl --version

Checks cover AFL syntax, documentation, signatures, explicit dependencies and
selected preset implementation associations. Native syntax and behavior are not checked.
An Agent writes native code directly and maintains the preset's implementations TOML file.
Templates, scaffolds and generate have been removed; native projects remain independent.

Formatting accepts AFL files and directories. --check compares without writing;
--indent-width is 1..16 (default 4), --tabs uses tabs. Dependencies are not formatted.
Checks and queries load whole crates, explicit dependencies and directly associated
[test].crates specifications. Dependency-only tests are not inherited.
Traversal skips .git, .jj, node_modules, dist, target and nested symbolic links.
Queries use current file snapshots. Trace reverses implementation associations;
impact follows the current AFL reference graph, with no native dependency analysis
or historical baseline. An in-range association is not proof of native correctness.
Without --preset, project queries aggregate configured associations.
Position queries with --preset require --project. --project also locates the AFL
project for associated native files outside it. Input lines/columns are one-based;
JSON ranges are zero-based UTF-16 with exclusive ends. --json writes JSON to stdout.
Exit codes: 0 success, 1 diagnostics or formatting differences, 2 invalid invocation/I/O.
`;

async function main(): Promise<number> {
  let json = process.argv.slice(2).includes("--json");

  try {
    const { values, positionals } = parseArgs({
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        check: { type: "boolean" },
        "indent-width": { type: "string" },
        tabs: { type: "boolean" },
        preset: { type: "string" },
        project: { type: "string" },
        line: { type: "string" },
        column: { type: "string" },
        "include-declaration": { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    json = values.json ?? false;

    if (values.help || (positionals.length === 0 && !values.version)) {
      process.stdout.write(help);
      return 0;
    }
    if (values.version) {
      process.stdout.write(`${manifest.version}\n`);
      return 0;
    }

    const [command, ...paths] = positionals;
    if (
      ![
        "check",
        "format",
        "trace",
        "impact",
        "symbols",
        "definition",
        "references",
        "implementations",
      ].includes(command!)
    ) {
      throw new Error(`Unknown command: ${command}. Run afl --help for usage.`);
    }

    if (values.preset !== undefined && !values.preset.trim())
      throw new Error("--preset requires a nonempty name.");
    if (
      command !== "format" &&
      [values["indent-width"], values.tabs].some((value) => value !== undefined)
    )
      throw new Error("--indent-width and --tabs are only valid for format.");
    if (command !== "format" && values.check !== undefined)
      throw new Error("--check is only valid for format.");
    let result;
    if (command === "impact") {
      if (
        !values.project?.trim() ||
        !paths.length ||
        [values.line, values.column, values["include-declaration"]].some(
          (value) => value !== undefined,
        )
      ) {
        throw new Error(
          "impact requires --project DIR and changed file paths.",
        );
      }
      result = await queryImpact(values.project, values.preset, paths);
      if (!json) {
        process.stdout.write(
          `Impact: ${result.declarations.length} AFL declarations, ${result.implementations.length} native locations, ${result.tests.length} test specifications.\n`,
        );
        for (const item of result.implementations) {
          process.stdout.write(
            `  ${fileURLToPath(item.uri)}:${item.range.start.line + 1} ${item.symbol} (${item.preset})\n`,
          );
        }
        for (const limitation of result.limitations) {
          process.stdout.write(`${limitation}\n`);
        }
      }
    } else if (command === "trace") {
      if (
        paths.length !== 1 ||
        values["include-declaration"] !== undefined ||
        (values.column !== undefined && values.line === undefined) ||
        (values.project !== undefined && !values.project.trim())
      ) {
        throw new Error(
          "trace accepts one associated file, optional --line/--column, --project and --preset.",
        );
      }
      for (const value of [values.line, values.column]) {
        if (
          value !== undefined &&
          (!/^[1-9][0-9]*$/u.test(value) ||
            !Number.isSafeInteger(Number(value)))
        ) {
          throw new Error("Trace coordinates must be positive safe integers.");
        }
      }
      result = await queryTrace(paths[0]!, {
        ...(values.project === undefined ? {} : { project: values.project }),
        ...(values.preset === undefined ? {} : { preset: values.preset }),
        ...(values.line === undefined ? {} : { line: Number(values.line) - 1 }),
      });
      if (!json) {
        for (const item of result.results) {
          process.stdout.write(
            `${item.implementation.afl}: ${fileURLToPath(item.declaration.uri)}:${item.declaration.range.start.line + 1}\n`,
          );
        }
        if (!result.results.length) {
          process.stdout.write("No associations in this scope.\n");
        }
      }
    } else if (command === "format") {
      if (
        [
          values.project,
          values.preset,
          values.line,
          values.column,
          values["include-declaration"],
        ].some((value) => value !== undefined)
      )
        throw new Error("format does not accept preset or query options.");
      const width = values["indent-width"];
      if (width !== undefined && !/^(?:[1-9]|1[0-6])$/u.test(width))
        throw new Error("--indent-width requires an integer from 1 to 16.");
      const formatted = await formatFiles(
        paths,
        {
          tabSize: width === undefined ? 4 : Number(width),
          insertSpaces: !values.tabs,
        },
        values.check ?? false,
      );
      if (json) process.stdout.write(`${JSON.stringify(formatted, null, 2)}\n`);
      else {
        for (const file of formatted.files)
          if (file.changed)
            process.stdout.write(
              `${file.written ? "Formatted" : "Needs formatting"}: ${file.path}\n`,
            );
        for (const issue of formatted.diagnostics)
          process.stderr.write(
            `${fileURLToPath(issue.uri)}:${issue.range.start.line + 1}:${issue.range.start.character + 1} ${issue.code}: ${issue.message}\n`,
          );
        if (formatted.diagnostics.length)
          process.stderr.write("Formatting cancelled; no files written.\n");
      }
      return formatted.diagnostics.length ||
        (formatted.check && formatted.files.some((file) => file.changed))
        ? 1
        : 0;
    } else if (
      command === "symbols" ||
      command === "definition" ||
      command === "references" ||
      command === "implementations"
    ) {
      const query = await queryProject(command, paths, {
        ...(values.project === undefined ? {} : { project: values.project }),
        ...(values.preset === undefined ? {} : { preset: values.preset }),
        ...(values.line === undefined ? {} : { line: values.line }),
        ...(values.column === undefined ? {} : { column: values.column }),
        ...(values["include-declaration"] === undefined
          ? {}
          : { includeDeclaration: values["include-declaration"] }),
      });
      result = query;
      if (!json) process.stdout.write(formatQuery(query));
    } else {
      if (
        [
          values.project,
          values.line,
          values.column,
          values["include-declaration"],
        ].some((value) => value !== undefined)
      ) {
        throw new Error(
          "check does not accept query options (--project, --line, --column, --include-declaration).",
        );
      }
      const project = await loadProject(
        paths.length > 0 ? paths : ["."],
        [],
        values.preset === undefined ? {} : { preset: values.preset },
      );
      const checked = checkProject(project.documents, project);
      result = { status: checked.status, diagnostics: checked.diagnostics };
    }

    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      for (const diagnostic of result.diagnostics) {
        const position = diagnostic.range.start;
        const location = `${fileURLToPath(diagnostic.uri)}:${position.line + 1}:${position.character + 1}`;
        process.stdout.write(
          `${location} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}\n`,
        );
      }
    }

    return result.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
      ? 1
      : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(`${JSON.stringify({ status: "error", message })}\n`);
    } else {
      process.stderr.write(`afl: ${message}\n`);
    }
    return 2;
  }
}

process.exitCode = await main();
