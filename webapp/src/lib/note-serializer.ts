/**
 * note-serializer — TipTap HTML / markdown round-tripping for project notes.
 *
 * Shared source of truth
 * ──────────────────────
 * The folder-sync agent and the web editor both need identical semantics for
 * `.md` representation of a project_note. This module is the canonical
 * round-trip codec: `toMarkdown(noteMeta, html)` serialises a note to a
 * vault-portable `.md` file (YAML frontmatter + body), `fromMarkdown(md)`
 * parses it back.
 *
 * Preserved through round-trip (see __tests__/note-serializer.test.ts):
 *   - Title (`# heading` or from frontmatter `title` fallback)
 *   - Paragraphs, headings 1-3, emphasis, strong, inline code
 *   - Unordered / ordered / task lists (GFM)
 *   - Block quotes
 *   - Inline math `$…$` and display math `$$…$$` (KaTeX parseable)
 *   - Wikilinks `[[Target]]`
 *   - Tables (GFM minimal)
 *   - Footnotes: pandoc-style `[^n]` inline + `[^n]: …` definitions at end
 *   - Frontmatter: id, item_id, project_id, folder_id, evergreen, tags,
 *     anchor_selectors, links_out, created_at, updated_at, content_hash
 *
 * Not preserved (by design):
 *   - Comments (stored separately at `.stoa/comments/note-<id>.json`)
 *   - Embedded base64 images (too big for a vault file; these become
 *     `![alt](stoa://image-<id>)` placeholders)
 */

export interface NoteFrontmatter {
  id: string;
  item_id?: string | null;
  project_id?: string | null;
  folder_id?: string | null;
  evergreen?: boolean;
  tags?: string[];
  anchor_selectors?: unknown;
  links_out?: string[];
  created_at?: string;
  updated_at?: string;
  content_hash?: string;
}

export interface ParsedNote {
  frontmatter: NoteFrontmatter;
  title: string;
  body: string; // markdown body WITHOUT frontmatter or title line
  html: string; // HTML representation for the TipTap editor
}

// ─── HTML → Markdown ─────────────────────────────────────────────────────────

interface HtmlToMdState {
  footnotes: Array<{ id: string; body: string }>;
  inInline: boolean;
}

function escapeMd(s: string): string {
  // Minimal backslash-escaping for round-trip safety. We only escape the
  // characters that would otherwise re-parse into structure.
  return s.replace(/([*_`\\])/g, "\\$1");
}

function htmlAttr(el: Element, name: string): string {
  return el.getAttribute(name) || "";
}

function serializeChildren(parent: Node, state: HtmlToMdState): string {
  const parts: string[] = [];
  parent.childNodes.forEach((child) => {
    parts.push(serializeNode(child, state));
  });
  return parts.join("");
}

function serializeNode(node: Node, state: HtmlToMdState): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    return state.inInline ? text : escapeMd(text);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Math nodes — reconstruct via data-latex
  if (
    el.getAttribute("data-type") === "math-inline" &&
    el.hasAttribute("data-latex")
  ) {
    return `$${htmlAttr(el, "data-latex")}$`;
  }
  if (
    el.getAttribute("data-type") === "math-block" &&
    el.hasAttribute("data-latex")
  ) {
    return `\n\n$$${htmlAttr(el, "data-latex")}$$\n\n`;
  }

  // Wikilinks
  if (el.getAttribute("data-type") === "wikilink") {
    const target = htmlAttr(el, "data-target");
    return `[[${target}]]`;
  }

  // Mentions — render as `@Label` (resolution lives in project_note_links row)
  if (el.getAttribute("data-type") === "mention") {
    // MentionList already prepends @ to the label node in renderHTML;
    // we just echo the text content.
    return el.textContent || "";
  }

  // Footnote ref
  if (el.getAttribute("data-type") === "footnote-ref") {
    const id = htmlAttr(el, "data-fn-id") || "1";
    return `[^${id}]`;
  }
  // Footnote def — collect separately, emit at end of document
  if (el.getAttribute("data-type") === "footnote-def") {
    const id = htmlAttr(el, "data-fn-id") || "1";
    const body = serializeChildren(el, { ...state, inInline: true }).trim();
    state.footnotes.push({ id, body });
    return ""; // suppress inline emission
  }

  switch (tag) {
    case "p": {
      const inner = serializeChildren(el, state);
      return inner.trim().length === 0 ? "\n\n" : `${inner}\n\n`;
    }
    case "h1":
      return `# ${serializeChildren(el, { ...state, inInline: true })}\n\n`;
    case "h2":
      return `## ${serializeChildren(el, { ...state, inInline: true })}\n\n`;
    case "h3":
      return `### ${serializeChildren(el, { ...state, inInline: true })}\n\n`;
    case "h4":
      return `#### ${serializeChildren(el, { ...state, inInline: true })}\n\n`;
    case "strong":
    case "b":
      return `**${serializeChildren(el, state)}**`;
    case "em":
    case "i":
      return `_${serializeChildren(el, state)}_`;
    case "u":
      return `<u>${serializeChildren(el, state)}</u>`;
    case "code":
      // Inline code — disable markdown-escape for the inner content.
      return `\`${el.textContent || ""}\``;
    case "pre": {
      const codeEl = el.querySelector("code");
      const lang = codeEl?.getAttribute("class")?.match(/language-(\S+)/)?.[1] || "";
      const src = codeEl?.textContent ?? el.textContent ?? "";
      return `\n\`\`\`${lang}\n${src.replace(/\n+$/, "")}\n\`\`\`\n\n`;
    }
    case "blockquote": {
      const inner = serializeChildren(el, state).trim();
      return inner
        .split("\n")
        .map((l) => (l.length ? `> ${l}` : ">"))
        .join("\n") + "\n\n";
    }
    case "ul": {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === "li")
        .map((li) => serializeListItem(li, "-", state))
        .join("");
      return items + "\n";
    }
    case "ol": {
      let i = 1;
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === "li")
        .map((li) => serializeListItem(li, `${i++}.`, state))
        .join("");
      return items + "\n";
    }
    case "a": {
      const inner = serializeChildren(el, state).trim();
      const href = el.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return inner;
      return `[${inner}](${href})`;
    }
    case "img": {
      const alt = el.getAttribute("alt") || "";
      const src = el.getAttribute("src") || "";
      return `![${alt}](${src})`;
    }
    case "table":
      return serializeTable(el, state) + "\n\n";
    case "br":
      return "  \n";
    case "hr":
      return "\n---\n\n";
    case "sup":
      return `<sup>${serializeChildren(el, { ...state, inInline: true })}</sup>`;
    case "span":
      // Preserve inline math data-type path; otherwise pass through.
      return serializeChildren(el, state);
    case "div":
      return serializeChildren(el, state);
    default:
      return serializeChildren(el, state);
  }
}

function serializeListItem(li: Element, bullet: string, state: HtmlToMdState): string {
  // Task list detection: TipTap StarterKit emits <li><input type="checkbox" …>
  // or <label> wrappers. Handle both.
  const checkbox = li.querySelector(":scope > label > input[type='checkbox'], :scope > input[type='checkbox']");
  const isTask = li.getAttribute("data-type") === "taskItem" || !!checkbox;
  const checked = li.getAttribute("data-checked") === "true" ||
    (checkbox as HTMLInputElement | null)?.checked === true;

  // Strip the checkbox / label children, keep the prose.
  const contentNodes = Array.from(li.childNodes).filter((n) => {
    if (n.nodeType !== Node.ELEMENT_NODE) return true;
    const el = n as Element;
    if (el.tagName.toLowerCase() === "label") return false;
    if (el.tagName.toLowerCase() === "input") return false;
    return true;
  });
  const contentHtml = contentNodes.map((n) => serializeNode(n, state)).join("").trim();

  const prefix = isTask ? `${bullet} [${checked ? "x" : " "}] ` : `${bullet} `;
  return `${prefix}${contentHtml}\n`;
}

function serializeTable(table: Element, state: HtmlToMdState): string {
  const rows: string[][] = [];
  table.querySelectorAll("tr").forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll("th,td").forEach((cell) => {
      cells.push(
        serializeChildren(cell, { ...state, inInline: true }).trim().replace(/\|/g, "\\|"),
      );
    });
    rows.push(cells);
  });
  if (rows.length === 0) return "";
  const header = rows[0];
  const sep = header.map(() => "---");
  const body = rows.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const state: HtmlToMdState = { footnotes: [], inInline: false };
  let md = serializeChildren(body, state).replace(/\n{3,}/g, "\n\n").trim();
  // Append footnote definitions block.
  if (state.footnotes.length > 0) {
    md += "\n\n";
    for (const { id, body: fnBody } of state.footnotes) {
      md += `[^${id}]: ${fnBody}\n`;
    }
  }
  return md + "\n";
}

// ─── Markdown → HTML ─────────────────────────────────────────────────────────

/**
 * Minimal markdown→HTML for the round-trip path.
 *
 * The goal is not full CommonMark; it is to invert the subset we emit from
 * the editor. Concretely:
 *   - Frontmatter stripped (handled by fromMarkdown)
 *   - Headings, paragraphs, bold/italic/code, links, images
 *   - Lists (-, *, numbered) + task items
 *   - Tables (GFM)
 *   - Code fences
 *   - Math: `$…$` → inline node, `$$…$$` → block node
 *   - Wikilinks `[[…]]` → wikilink node
 *   - Footnotes: `[^id]` + `[^id]: …`
 */
function markdownToHtml(md: string): string {
  // Extract footnote definitions first
  const footnoteDefs = new Map<string, string>();
  const defRe = /^\[\^([^\]]+)\]:\s*(.+)$/gm;
  md = md.replace(defRe, (_m, id, body) => {
    footnoteDefs.set(id, body);
    return "";
  });

  // Extract block math (placeholders) so they don't get mangled by inline rules.
  const mathBlocks: string[] = [];
  md = md.replace(/\$\$([^$]+?)\$\$/g, (_m, latex) => {
    mathBlocks.push(latex);
    return `\u0000BLOCKMATH_${mathBlocks.length - 1}\u0000`;
  });

  // Extract inline math (placeholders)
  const mathInlines: string[] = [];
  md = md.replace(/\$([^$\n]+?)\$/g, (_m, latex) => {
    mathInlines.push(latex);
    return `\u0000INLINEMATH_${mathInlines.length - 1}\u0000`;
  });

  // Extract fenced code blocks
  const codeBlocks: string[] = [];
  md = md.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    codeBlocks.push(`<pre><code${lang ? ` class="language-${lang.trim()}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000CODEBLOCK_${codeBlocks.length - 1}\u0000`;
  });

  // Split into blocks separated by blank lines.
  const blocks = md.split(/\n{2,}/);
  const htmlBlocks: string[] = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    // Restored code block placeholders pass through intact
    if (/^\u0000CODEBLOCK_\d+\u0000$/.test(block)) {
      htmlBlocks.push(block);
      continue;
    }

    // Block math placeholders pass through
    if (/^\u0000BLOCKMATH_\d+\u0000$/.test(block)) {
      htmlBlocks.push(block);
      continue;
    }

    // Heading
    const hMatch = block.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      htmlBlocks.push(`<h${level}>${inlineToHtml(hMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(block)) {
      htmlBlocks.push("<hr>");
      continue;
    }

    // Blockquote
    if (/^>/.test(block)) {
      const inner = block
        .split("\n")
        .map((l) => l.replace(/^>\s?/, ""))
        .join("\n");
      htmlBlocks.push(`<blockquote>${inlineToHtml(inner)}</blockquote>`);
      continue;
    }

    // Table (at least 2 lines with pipes and a separator row)
    if (block.includes("|") && /\n\s*\|?\s*:?-+:?\s*\|/.test(block)) {
      htmlBlocks.push(tableToHtml(block));
      continue;
    }

    // List (task / unordered / ordered)
    if (/^(\s*)([-*]|\d+\.)\s/.test(block)) {
      htmlBlocks.push(listToHtml(block));
      continue;
    }

    // Paragraph (default)
    htmlBlocks.push(`<p>${inlineToHtml(block)}</p>`);
  }

  // Inject footnote definitions as their own block nodes.
  for (const [id, body] of footnoteDefs) {
    htmlBlocks.push(
      `<div data-type="footnote-def" data-fn-id="${escapeAttr(id)}">${inlineToHtml(body)}</div>`,
    );
  }

  let out = htmlBlocks.join("");

  // Restore code block / math placeholders
  out = out.replace(/\u0000CODEBLOCK_(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)]);
  out = out.replace(
    /\u0000BLOCKMATH_(\d+)\u0000/g,
    (_m, i) =>
      `<div data-type="math-block" data-latex="${escapeAttr(mathBlocks[Number(i)])}"></div>`,
  );
  out = out.replace(
    /\u0000INLINEMATH_(\d+)\u0000/g,
    (_m, i) =>
      `<span data-type="math-inline" data-latex="${escapeAttr(mathInlines[Number(i)])}"></span>`,
  );

  return out;
}

function inlineToHtml(s: string): string {
  let out = s;

  // Inline math placeholders
  out = out.replace(
    /\u0000INLINEMATH_(\d+)\u0000/g,
    (_m, _i) => _m, // leave for final restore in markdownToHtml
  );

  // Escape < > in text
  out = escapeHtml(out, { allowTags: true });

  // Wikilinks
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => {
    return `<a data-type="wikilink" data-target="${escapeAttr(target)}" class="stoa-wikilink" href="/project-notes?q=${encodeURIComponent(target)}">[[${escapeHtml(target)}]]</a>`;
  });

  // Footnote refs
  out = out.replace(/\[\^([^\]]+)\]/g, (_m, id) => {
    return `<sup data-fn-id="${escapeAttr(id)}" data-type="footnote-ref" class="stoa-footnote-ref">[${escapeHtml(id)}]</sup>`;
  });

  // Images
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    return `<img alt="${escapeAttr(alt)}" src="${escapeAttr(src)}">`;
  });

  // Links
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
    return `<a href="${escapeAttr(href)}">${escapeHtml(text)}</a>`;
  });

  // Bold (**…**)
  out = out.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");

  // Italic (_…_ or *…*)
  out = out.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<em>$1</em>");
  out = out.replace(/(?<![*])\*([^*\n]+?)\*(?![*])/g, "<em>$1</em>");

  // Inline code (`…`)
  out = out.replace(/`([^`]+?)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);

  // Hard-break: two spaces + newline
  out = out.replace(/ {2,}\n/g, "<br>");

  return out;
}

function tableToHtml(block: string): string {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const headerCells = splitTableRow(lines[0]);
  const bodyLines = lines.slice(2); // skip separator row
  const thead = `<thead><tr>${headerCells.map((c) => `<th>${inlineToHtml(c)}</th>`).join("")}</tr></thead>`;
  const tbody =
    bodyLines.length > 0
      ? `<tbody>${bodyLines
          .map((r) => {
            const cells = splitTableRow(r);
            return `<tr>${cells.map((c) => `<td>${inlineToHtml(c)}</td>`).join("")}</tr>`;
          })
          .join("")}</tbody>`
      : "";
  return `<table>${thead}${tbody}</table>`;
}

function splitTableRow(row: string): string[] {
  // Trim leading/trailing pipes, split on unescaped pipes.
  const trimmed = row.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function listToHtml(block: string): string {
  const lines = block.split("\n");
  let isOrdered = false;
  const items: Array<{ kind: "task" | "plain"; checked: boolean; text: string }> = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (!m) continue;
    if (/^\s*\d+\./.test(line)) isOrdered = true;
    const rest = m[1];
    const taskMatch = rest.match(/^\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      items.push({
        kind: "task",
        checked: taskMatch[1].toLowerCase() === "x",
        text: taskMatch[2],
      });
    } else {
      items.push({ kind: "plain", checked: false, text: rest });
    }
  }
  const hasTask = items.some((i) => i.kind === "task");
  const liHtml = items
    .map((i) => {
      if (i.kind === "task") {
        return `<li data-type="taskItem" data-checked="${i.checked}"><label><input type="checkbox" ${i.checked ? "checked" : ""}><span></span></label><div><p>${inlineToHtml(i.text)}</p></div></li>`;
      }
      return `<li><p>${inlineToHtml(i.text)}</p></li>`;
    })
    .join("");
  if (hasTask) return `<ul data-type="taskList">${liHtml}</ul>`;
  return isOrdered ? `<ol>${liHtml}</ol>` : `<ul>${liHtml}</ul>`;
}

function escapeHtml(
  s: string,
  opts: { allowTags?: boolean } = {},
): string {
  if (opts.allowTags) {
    // Only escape unescaped `<` and `>` that don't start a tag we just emitted.
    return s.replace(/&/g, "&amp;");
  }
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ─── Frontmatter ─────────────────────────────────────────────────────────────

export function parseFrontmatter(md: string): {
  frontmatter: NoteFrontmatter;
  body: string;
} {
  const empty: NoteFrontmatter = { id: "" };
  if (!md.startsWith("---\n")) return { frontmatter: empty, body: md };
  const end = md.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: empty, body: md };
  const yaml = md.slice(4, end);
  const body = md.slice(end + 5);
  const fm: Record<string, unknown> = { id: "" };
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    fm[key] = parseYamlScalar(raw);
  }
  return { frontmatter: fm as unknown as NoteFrontmatter, body };
}

function parseYamlScalar(raw: string): unknown {
  if (raw === "null" || raw === "") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  // Bracketed flow-style arrays
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((v) => {
      const t = v.trim();
      if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
      return t;
    });
  }
  // Quoted string
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  // JSON-looking object
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function stringifyFrontmatter(fm: NoteFrontmatter): string {
  const lines: string[] = ["---"];
  const ordered: Array<keyof NoteFrontmatter> = [
    "id",
    "item_id",
    "project_id",
    "folder_id",
    "evergreen",
    "tags",
    "anchor_selectors",
    "links_out",
    "created_at",
    "updated_at",
    "content_hash",
  ];
  for (const k of ordered) {
    if (!(k in fm)) continue;
    const v = fm[k];
    if (v === undefined) continue;
    lines.push(`${k}: ${stringifyYamlScalar(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function stringifyYamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
  }
  if (typeof v === "object") {
    return JSON.stringify(v);
  }
  return String(v);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ToMarkdownInput {
  frontmatter: NoteFrontmatter;
  title: string;
  html: string;
}

export function toMarkdown(input: ToMarkdownInput): string {
  const body = htmlToMarkdown(input.html);
  const fm = stringifyFrontmatter(input.frontmatter);
  const titleLine = input.title?.trim() ? `# ${input.title.trim()}\n\n` : "";
  return `${fm}\n${titleLine}${body}`;
}

export function fromMarkdown(text: string): ParsedNote {
  const { frontmatter, body: afterFm } = parseFrontmatter(text);

  // Extract H1 as title; remove it from body.
  let title = "";
  const titleMatch = afterFm.match(/^\s*# (.+?)\n\s*\n?/);
  let body = afterFm;
  if (titleMatch) {
    title = titleMatch[1].trim();
    body = afterFm.slice(titleMatch[0].length);
  }

  const html = markdownToHtml(body);
  return { frontmatter, title, body, html };
}

// Convenience: compute content hash (sha-256 hex) of a normalised note body.
// Exported so the sync engine can cross-check.
export async function contentHashOf(body: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const data = new TextEncoder().encode(body);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}
