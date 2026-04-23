/**
 * WikilinkExtension — `[[Note Title]]` → inline wikilink node.
 *
 * Distinct from @mention (which is TipTap's suggestion-based autocomplete).
 * Wikilinks are a markdown-native convention (Obsidian, Roam, Logseq) where
 * the writer types `[[Title]]` directly; on parse we convert to an inline
 * node that the reader can click.
 *
 * Resolution of wikilink → note id happens lazily: the stored `target` is the
 * literal title string. When rendering, we attempt a lookup; if it resolves,
 * we link to that note; if not, the wikilink renders as a "broken link" which
 * remains interactable (clicking offers to create the note).
 */

import { Node, mergeAttributes, InputRule } from "@tiptap/core";

export const Wikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-type='wikilink']",
        getAttrs: (el) => ({
          target: (el as HTMLElement).getAttribute("data-target") || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = (node.attrs.target as string) || "";
    // Render as anchor; ProjectNotes page can enhance with resolution lookup.
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-type": "wikilink",
        "data-target": target,
        class: "stoa-wikilink",
        href: `/project-notes?q=${encodeURIComponent(target)}`,
      }),
      `[[${target}]]`,
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\]]+)\]\]$/,
        handler: ({ range, match, chain }) => {
          const target = match[1].trim();
          if (!target) return null;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .insertContent({
              type: "wikilink",
              attrs: { target },
            })
            .run();
        },
      }),
    ];
  },
});
