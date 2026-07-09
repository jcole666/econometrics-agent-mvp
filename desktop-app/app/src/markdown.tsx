import katex from "katex";
import "katex/dist/katex.min.css";

import type { ChatMessage } from "./types";

type ChatMarkdownBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; items: { text: string; depth: number }[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "code"; language: string; code: string }
  | { kind: "formula"; text: string }
  | { kind: "rule" };

function isDivider(value: string) {
  return /^-{3,}$/.test(value) || /^\*{3,}$/.test(value);
}

function isFormulaLine(value: string) {
  const text = value.trim();
  if (text.length > 160) return false;
  if (!/[=≈∼~]/.test(text)) return false;
  return /[βεαδγθλ]|\\[a-zA-Z]+|Y|X|income|log|ln|\^|²|₀|₁|₂|₃/.test(text);
}

function latexEnvironmentName(value: string) {
  return value.trim().match(/^\\begin\{([^}]+)\}/)?.[1] ?? null;
}

function isTableRow(value: string) {
  const text = value.trim();
  return text.startsWith("|") && text.endsWith("|") && text.slice(1, -1).includes("|");
}

function parseTableCells(value: string) {
  return value
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(value: string) {
  if (!isTableRow(value)) return false;
  const cells = parseTableCells(value);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseChatMarkdown(value: string): ChatMarkdownBlock[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: ChatMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const text = line.trim();

    if (!text) {
      index += 1;
      continue;
    }

    const codeStart = text.match(/^```([\w-]*)/);
    if (codeStart) {
      const language = codeStart[1] || "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language, code: codeLines.join("\n") });
      continue;
    }

    if (text.startsWith("$$")) {
      const formulaLines: string[] = [];
      const first = text.replace(/^\$\$/, "").trim();
      if (first) formulaLines.push(first);
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith("$$")) {
        formulaLines.push(lines[index].trim());
        index += 1;
      }
      if (index < lines.length) {
        const last = lines[index].trim().replace(/\$\$$/, "").trim();
        if (last) formulaLines.push(last);
        index += 1;
      }
      blocks.push({ kind: "formula", text: formulaLines.join("\n") });
      continue;
    }

    if (text.startsWith("\\[")) {
      const formulaLines: string[] = [];
      const first = text.replace(/^\\\[/, "").trim();
      if (first && first !== "\\]") formulaLines.push(first);
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith("\\]")) {
        formulaLines.push(lines[index].trim());
        index += 1;
      }
      if (index < lines.length) {
        const last = lines[index].trim().replace(/\\\]$/, "").trim();
        if (last) formulaLines.push(last);
        index += 1;
      }
      blocks.push({ kind: "formula", text: formulaLines.join("\n") });
      continue;
    }

    const environmentName = latexEnvironmentName(text);
    if (environmentName) {
      const formulaLines = [text];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(`\\end{${environmentName}}`)) {
        formulaLines.push(lines[index].trim());
        index += 1;
      }
      if (index < lines.length) {
        formulaLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ kind: "formula", text: formulaLines.join("\n") });
      continue;
    }

    const heading = text.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (isDivider(text)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (isTableRow(text) && index + 1 < lines.length && isTableSeparator(lines[index + 1].trim())) {
      const headers = parseTableCells(text);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].trim()) && !isTableSeparator(lines[index].trim())) {
        const cells = parseTableCells(lines[index]);
        rows.push(headers.map((_, cellIndex) => cells[cellIndex] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      const items: { text: string; depth: number }[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^(\s*)[-*]\s+(.+)$/);
        if (!item) break;
        items.push({
          text: item[2].trim(),
          depth: Math.min(Math.floor(item[1].length / 2), 3)
        });
        index += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    if (isFormulaLine(text)) {
      blocks.push({ kind: "formula", text });
      index += 1;
      continue;
    }

    const paragraph: string[] = [text];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      const nextText = next.trim();
      if (!nextText) break;
      if (
        nextText.startsWith("```") ||
        nextText.startsWith("$$") ||
        nextText.startsWith("\\[") ||
        Boolean(latexEnvironmentName(nextText)) ||
        /^(#{1,4})\s+/.test(nextText) ||
        isDivider(nextText) ||
        isTableRow(nextText) ||
        /^(\s*)[-*]\s+/.test(next) ||
        isFormulaLine(nextText)
      ) {
        break;
      }
      paragraph.push(nextText);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function renderMathHtml(value: string, displayMode: boolean) {
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    });
  } catch {
    return "";
  }
}

function InlineMath({ value }: { value: string }) {
  const html = renderMathHtml(value, false);
  if (!html) return <code>{value}</code>;
  return <span className="inline-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

function BlockMath({ value }: { value: string }) {
  const html = renderMathHtml(value, true);
  if (!html) return <code>{value}</code>;
  return <div className="math-html" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\\\(.+?\\\)|\$[^$\n]+\$)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <b key={index}>{part.slice(2, -2)}</b>;
    }
    if (part.startsWith("\\(") && part.endsWith("\\)")) {
      return <InlineMath key={index} value={part.slice(2, -2)} />;
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      return <InlineMath key={index} value={part.slice(1, -1)} />;
    }
    return <span key={index}>{part}</span>;
  });
}

export function ChatMessageBody({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return <p className="chat-text">{message.content}</p>;
  }

  return <MarkdownBody value={message.content} />;
}

export function MarkdownBody({ value, className = "chat-markdown" }: { value: string; className?: string }) {
  const blocks = parseChatMarkdown(value);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const levelClass = block.level <= 2 ? "chat-heading-main" : "chat-heading";
          const slug = block.text.replace(/[^一-龥a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
          return <h3 className={levelClass} key={index} id={`report-h-${slug}`}>{renderInline(block.text)}</h3>;
        }
        if (block.kind === "list") {
          return (
            <ul className="chat-list" key={index}>
              {block.items.map((item, itemIndex) => (
                <li className={`chat-list-depth-${item.depth}`} key={`${index}-${itemIndex}`}>
                  {renderInline(item.text)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "table") {
          return (
            <div className="chat-table-wrap" key={index}>
              <table className="chat-table">
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`${index}-head-${headerIndex}`}>{renderInline(header)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${index}-row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${index}-cell-${rowIndex}-${cellIndex}`}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === "code") {
          return (
            <div className="chat-code-block" key={index}>
              <div className="chat-code-head">{block.language || "代码"}</div>
              <pre><code>{block.code}</code></pre>
            </div>
          );
        }
        if (block.kind === "formula") {
          return (
            <div className="chat-formula" key={index}>
              <BlockMath value={block.text} />
            </div>
          );
        }
        if (block.kind === "rule") {
          return <hr key={index} />;
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

export function ThinkingMessage() {
  return (
    <div className="chat-item chat-assistant chat-thinking">
      <strong>小计</strong>
      <span className="thinking-line">
        正在思考
        <span className="thinking-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </span>
    </div>
  );
}
