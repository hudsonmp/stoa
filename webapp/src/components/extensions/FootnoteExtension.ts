/**
 * FootnoteExtension — inline superscript marker with separate definition list.
 *
 * Markdown semantics
 * ──────────────────
 * Source markdown uses pandoc-style footnotes:
 *   Body with reference[^1]
 *   [^1]: footnote content.
 *
 * In the editor we represent the two halves as two node types:
 *   - footnoteReference (inline, atom) — renders as `<sup data-fn-id="1">1</sup>`
 *   - footnoteDefinition (block) — holds the definition body, keyed by the
 *     same fn-id. Definitions are accumulated at the end of the note when
 *     serialising to markdown; the editor renders them inline where inserted
 *     so the user can see the footnote body without context-switching.
 *
 * cmd+alt+f inserts a fresh `[^N]` reference + empty definition below the
 * current paragraph and jumps the cursor into the definition.
 */

import { Node, mergeAttributes } from "@tiptap/core";

function nextFootnoteId(html: string): string {
  // Find the max numeric id in the current document and increment.
  const matches = html.match(/data-fn-id="(\d+)"/g) || [];
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

// ── FootnoteReference ─────────────────────────────────────────────────────────

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      fnId: {
        default: "1",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-fn-id") || "1",
        renderHTML: (attrs) => ({ "data-fn-id": attrs.fnId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-fn-id]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        class: "stoa-footnote-ref",
        "data-type": "footnote-ref",
      }),
      `[${node.attrs.fnId}]`,
    ];
  },
});

// ── FootnoteDefinition ────────────────────────────────────────────────────────

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      fnId: {
        default: "1",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-fn-id") || "1",
        renderHTML: (attrs) => ({ "data-fn-id": attrs.fnId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='footnote-def']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "stoa-footnote-def",
        "data-type": "footnote-def",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-f": ({ editor }) => {
        const html = editor.getHTML();
        const fnId = nextFootnoteId(html);
        // Insert `[N]` at cursor, then append an empty definition block.
        return editor
          .chain()
          .focus()
          .insertContent({
            type: "footnoteReference",
            attrs: { fnId },
          })
          .insertContentAt(editor.state.doc.content.size, {
            type: "footnoteDefinition",
            attrs: { fnId },
            content: [{ type: "text", text: " " }],
          })
          .run();
      },
    };
  },
});

// Re-exported so the editor can pull both extensions in a single import.
export const FootnoteExtensions = [FootnoteReference, FootnoteDefinition];
