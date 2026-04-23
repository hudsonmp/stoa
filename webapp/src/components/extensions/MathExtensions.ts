/**
 * MathExtensions — inline + block LaTeX math via KaTeX.
 *
 * Rationale
 * ─────────
 * The redesigned editor must render live `$inline$` and `$$display$$` math.
 * We roll a thin wrapper over @tiptap/core + katex instead of pulling a
 * heavier third-party math extension: the feature surface is small
 * (parse `$…$` / `$$…$$`, render, allow editing) and external extensions
 * bring deps we don't need.
 *
 * Tolerant parser
 * ───────────────
 * KaTeX with `throwOnError: false` renders `\color{#cc0000}\text{...}` for
 * invalid LaTeX, so surrounding text still renders and the user sees a
 * red-text hint. No fatal errors reach ProseMirror.
 *
 * Markdown round-tripping
 * ───────────────────────
 * Inline and block math serialise back to `$…$` / `$$…$$` via the
 * HTML parse rule (data-type="math-inline" / "math-block" + data-latex).
 * `note-serializer.ts` recognises these data attrs when converting HTML → md.
 */

import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import katex from "katex";
import "katex/dist/katex.min.css";

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "html",
      strict: "ignore",
    });
  } catch {
    return `<span class="math-error">${escapeHtml(latex)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── InlineMath ────────────────────────────────────────────────────────────────

export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-type='math-inline']",
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute("data-latex") || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex = (node.attrs.latex as string) || "";
    const rendered = renderKatex(latex, false);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "math-inline",
        "data-latex": latex,
        class: "stoa-math-inline",
        // contenteditable=false keeps ProseMirror from editing rendered KaTeX
        contenteditable: "false",
        // rendered HTML stored via innerHTML on output; see renderText
      }),
      // Fallback plain text — screen readers / markdown copy
      `$${latex}$`,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.setAttribute("data-type", "math-inline");
      dom.setAttribute("data-latex", node.attrs.latex as string);
      dom.className = "stoa-math-inline";
      dom.contentEditable = "false";
      dom.innerHTML = renderKatex(node.attrs.latex as string, false);
      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== "inlineMath") return false;
          dom.setAttribute("data-latex", updatedNode.attrs.latex as string);
          dom.innerHTML = renderKatex(updatedNode.attrs.latex as string, false);
          return true;
        },
      };
    };
  },

  addInputRules() {
    // `$...$ ` — typing a closing dollar fires a rule that replaces the
    // pending text with an InlineMath node. The trailing whitespace in the
    // regex is intentional: lets us distinguish "$x$" (math) from "$5" (typo).
    return [
      new InputRule({
        find: /\$([^$\n]+)\$$/,
        handler: ({ range, match, chain }) => {
          const latex = match[1];
          if (!latex) return null;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .insertContent({
              type: "inlineMath",
              attrs: { latex },
            })
            .run();
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertInlineMath:
        (latex: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ commands }: any) => {
          return commands.insertContent({
            type: "inlineMath",
            attrs: { latex },
          });
        },
    } as Record<string, unknown>;
  },
});

// ── BlockMath ─────────────────────────────────────────────────────────────────

export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-type='math-block']",
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute("data-latex") || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex = (node.attrs.latex as string) || "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "math-block",
        "data-latex": latex,
        class: "stoa-math-block",
        contenteditable: "false",
      }),
      `$$${latex}$$`,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-type", "math-block");
      dom.setAttribute("data-latex", node.attrs.latex as string);
      dom.className = "stoa-math-block";
      dom.contentEditable = "false";
      dom.innerHTML = renderKatex(node.attrs.latex as string, true);
      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== "blockMath") return false;
          dom.setAttribute("data-latex", updatedNode.attrs.latex as string);
          dom.innerHTML = renderKatex(updatedNode.attrs.latex as string, true);
          return true;
        },
      };
    };
  },

  addInputRules() {
    // `$$…$$` on its own line
    return [
      new InputRule({
        find: /\$\$([^$]+)\$\$$/,
        handler: ({ range, match, chain }) => {
          const latex = match[1];
          if (!latex) return null;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .insertContent({
              type: "blockMath",
              attrs: { latex },
            })
            .run();
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertBlockMath:
        (latex: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ commands }: any) => {
          return commands.insertContent({
            type: "blockMath",
            attrs: { latex },
          });
        },
    } as Record<string, unknown>;
  },
});
