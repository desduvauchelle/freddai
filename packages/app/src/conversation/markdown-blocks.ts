/** Splits message markdown into blocks at blank lines outside fenced code, so each block can be
 * parsed and memoized independently while a reply streams. Anything whose meaning can depend on
 * content in another block (reference/footnote definitions, raw HTML) is kept as one block. */
const fenceOpen = /^\s*(`{3,}|~{3,})/;
// `[x]: url` link reference definitions and `[^x]: note` footnotes.
const referenceDefinition = /^ {0,3}\[[^\]\n]+\]:/m;
// Raw HTML blocks / inline tags, comments, declarations and processing instructions.
const rawHtml = /^ {0,3}<(?:[A-Za-z][\w:-]*[\s/>]|\/[A-Za-z]|!|\?)|[A-Za-z0-9][^\n]*<[A-Za-z/!][^\n]*>/m;

const listMarker = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

export function splitMarkdownBlocks(text: string): string[] {
  if (!text.trim()) return [text];
  if (referenceDefinition.test(text) || rawHtml.test(text)) return [text];
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inList = false;
  let fence: { char: string; length: number } | null = null;
  const flush = () => { if (current.length) { blocks.push(current.join("\n")); current = []; inList = false; } };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      current.push(line);
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(fenceOpen);
    // A backtick fence's info string may not contain a backtick (otherwise it is inline code).
    if (open && !(open[1][0] === "`" && line.slice(open[0].length).includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      current.push(line);
      continue;
    }
    if (line.trim() !== "") {
      if (listMarker.test(line)) inList = true;
      current.push(line);
      continue;
    }
    // Blank line: it separates blocks unless it sits inside a (possibly loose) list, where the next
    // line is another item or an indented continuation of the current one.
    let next = index + 1;
    while (next < lines.length && lines[next].trim() === "") next++;
    const following = lines[next];
    if (following === undefined) { flush(); continue; }
    if (inList && (listMarker.test(following) || /^[ \t]/.test(following))) { current.push(line); continue; }
    flush();
  }
  flush();
  return blocks.length ? blocks : [text];
}
