import { Fragment, type ReactNode } from "react";

// Small, dependency-free markdown renderer for chat answers.
// Supports: # headings, - / * / 1. lists, ``` code blocks ```, **bold**, *italic*, `code`,
// and [links](https://...). Builds React elements (no raw HTML), so it's safe.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token)!;
      nodes.push(
        <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          {m[1]}
        </a>
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++; // closing fence (or end of a still-streaming answer)
      blocks.push(
        <pre key={k++} className="my-2 overflow-x-auto rounded-lg bg-gray-900 p-3 text-sm text-gray-100">
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const size = heading[1].length <= 2 ? "text-lg" : "text-base";
      blocks.push(
        <p key={k++} className={`mt-3 mb-1 font-semibold ${size}`}>
          {inline(heading[2], `h${k}`)}
        </p>
      );
      i++;
      continue;
    }

    // Lists
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line) && !bullet.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(re.exec(lines[i++])![1]);
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k++} className={`my-1 pl-6 space-y-1 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, j) => (
            <li key={j}>{inline(item, `l${k}-${j}`)}</li>
          ))}
        </List>
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph: consecutive plain lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={k++} className="my-1">
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${k}-${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className="leading-relaxed">{blocks}</div>;
}
