/**
 * CommentMark — inline mark that anchors a sidebar comment to a text range.
 *
 * Rationale
 * ─────────
 * Google-Docs-style sidebar comments need a DOM anchor the editor can scroll
 * to and that re-attaches correctly after reloads. TipTap marks survive edits
 * better than Prosemirror decorations across save/load, and the mark's
 * `data-comment-id` is the primary key in the comments table.
 *
 * We use the mark (not a node) so the underlying text is still editable;
 * selection, copy-paste, and inline math inside a comment range all still work.
 */

import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentMark: {
      setCommentMark: (commentId: string) => ReturnType;
      unsetCommentMark: (commentId?: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: "commentMark",
  inclusive: false,
  spanning: true,
  excludes: "",

  addAttributes() {
    return {
      commentId: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-comment-id") || "",
        renderHTML: (attrs) =>
          attrs.commentId ? { "data-comment-id": attrs.commentId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "stoa-comment-highlight",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentMark:
        (commentId: string) =>
        ({ commands }) => {
          return commands.setMark("commentMark", { commentId });
        },
      unsetCommentMark:
        () =>
        ({ commands }) => {
          return commands.unsetMark("commentMark");
        },
    };
  },
});
