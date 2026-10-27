import type { DescriptionLink, Name } from "./ast.js";
import type { Source } from "./source.js";

/** Parse only explicit markers, from original text so escapes retain source offsets. */
export function descriptionLinks(
  source: Source,
  start: number,
  end: number,
  keywords: ReadonlySet<string>,
): DescriptionLink[] {
  const text = source.document.text;
  const links: DescriptionLink[] = [];
  let cursor = start;
  while (cursor < end) {
    const opening = text.indexOf("{@", cursor);
    if (opening < 0 || opening >= end) break;
    const contentStart = opening + 2;
    const boundary = /\}|\r|\n|\[|\]|\{@/gu;
    boundary.lastIndex = contentStart;
    const next = boundary.exec(text);
    const contentEnd = Math.min(end, next?.index ?? end);
    const closed = contentEnd < end && text[contentEnd] === "}";
    const link: DescriptionLink = {
      kind: "description-link",
      start: opening,
      end: contentEnd + (closed ? 1 : 0),
      content: { start: contentStart, end: contentEnd },
      path: [],
      members: [],
      valid: closed,
    };
    let offset = contentStart,
      member = false;
    const space = (): void => {
      while (offset < contentEnd && /[ \t]/u.test(text[offset]!)) offset++;
    };
    const token = /(?:\x60[A-Za-z_][A-Za-z_0-9]*\x60|[A-Za-z_][A-Za-z_0-9]*)/uy;
    while (true) {
      space();
      token.lastIndex = offset;
      const match = token.exec(text);
      if (!match || token.lastIndex > contentEnd) {
        link.valid = false;
        break;
      }
      const escaped = match[0].charCodeAt(0) === 96;
      const name: Name = {
        text: escaped ? match[0].slice(1, -1) : match[0],
        escaped,
        start: offset,
        end: token.lastIndex,
      };
      if (
        !escaped &&
        keywords.has(name.text) &&
        !(
          link.path.length === 0 && ["crate", "dep", "self"].includes(name.text)
        )
      )
        link.valid = false;
      (member ? link.members : link.path).push(name);
      offset = token.lastIndex;
      space();
      if (offset === contentEnd) break;
      if (!member && text.slice(offset, offset + 2) === "::") offset += 2;
      else if (text[offset] === ".") {
        member = true;
        offset++;
      } else {
        link.valid = false;
        break;
      }
    }
    if (!link.valid)
      source.error(
        "AFL1006",
        "A description link requires {@name}, a module path, or member access on one line; calls and expressions are not allowed.",
        link,
      );
    links.push(link);
    cursor = Math.max(contentStart, link.end);
  }
  source.descriptionLinks.push(...links);
  return links;
}
