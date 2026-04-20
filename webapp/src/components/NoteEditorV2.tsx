/**
 * NoteEditorV2 — Stoa's redesigned text-focused editor.
 *
 * Design
 * ──────
 * Matches the Obsidian / Logseq / Bear / Overleaf class: markdown-flavored
 * WYSIWYG, keyboard-driven, live LaTeX math via KaTeX, pandoc-style
 * footnotes, `[[wikilinks]]` and `@mentions`, Google-Docs-style sidebar
 * comments on text ranges.
 *
 * No permanent toolbar — a floating bubble menu appears on selection. The
 * only permanent chrome is the top status strip (save state, source toggle,
 * comments toggle). Hudson's workflow: paste a passage → annotate → insert
 * wikilink → add footnote with citation → save. Every step must preserve
 * keyboard focus in the editor.
 *
 * Keyboard shortcuts
 * ──────────────────
 *   cmd+b/i/u      bold/italic/underline
 *   cmd+k          link
 *   cmd+shift+8    bullet list
 *   cmd+shift+7    ordered list
 *   cmd+shift+9    task list
 *   cmd+alt+m      add comment on selection
 *   cmd+alt+f      footnote
 *   cmd+e          inline code
 *   cmd+shift+e    code block
 *   cmd+/          toggle source view
 *   tab / shift+tab    list indent/outdent
 *
 * Round-trip
 * ──────────
 * toMarkdown / fromMarkdown live in `lib/note-serializer.ts`. The "show
 * source" toggle renders the canonical .md; edits to it re-parse back.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import ReactDOM from "react-dom/client";
import type {
  SuggestionOptions,
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  Code,
  MessageSquare,
  Sigma,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  TableIcon,
  Eye,
  EyeOff,
} from "lucide-react";

import ResizableImage from "./ResizableImageExtension";
import MentionList, { type MentionItem, type MentionListRef } from "./MentionList";
import NoteCommentsSidebar, {
  type NoteCommentsSidebarRef,
} from "./NoteCommentsSidebar";
import { InlineMath, BlockMath } from "./extensions/MathExtensions";
import {
  FootnoteReference,
  FootnoteDefinition,
} from "./extensions/FootnoteExtension";
import { CommentMark } from "./extensions/CommentMark";
import { Wikilink } from "./extensions/WikilinkExtension";
import { createProjectNoteLink } from "@/lib/api";
import {
  toMarkdown,
  fromMarkdown,
  type NoteFrontmatter,
} from "@/lib/note-serializer";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID;

// ── mention search (copied from ProjectNoteEditor) ───────────────────────────

interface MentionResult {
  id: string;
  label: string;
  ref_type: "note" | "item" | "person" | "folder";
  sub?: string;
}

function getAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (DEV_USER_ID) {
    h["X-User-Id"] = DEV_USER_ID;
    return h;
  }
  const token = localStorage.getItem("stoa_token");
  const userId = localStorage.getItem("stoa_user_id");
  if (token) h["Authorization"] = `Bearer ${token}`;
  else if (userId) h["X-User-Id"] = userId;
  return h;
}

async function mentionSearch(
  query: string,
): Promise<Array<MentionItem & { ref_type?: string }>> {
  if (!query || query.length < 1) return [];
  try {
    const res = await fetch(
      `${API_URL}/items/mention-search?q=${encodeURIComponent(query)}&limit=8`,
      { headers: getAuthHeaders() },
    );
    if (!res.ok) throw new Error("mention-search unavailable");
    const data: { results: MentionResult[] } = await res.json();
    return (data.results || []).map((r) => ({
      id: r.id,
      label: r.label,
      ref_type: r.ref_type,
      sub: r.sub,
    }));
  } catch {
    const res2 = await fetch(
      `${API_URL}/items/quick-search?q=${encodeURIComponent(query)}&limit=8`,
      { headers: getAuthHeaders() },
    );
    if (!res2.ok) return [];
    const data2: { results: { id: string; title: string }[] } = await res2.json();
    return (data2.results || []).map((r) => ({
      id: r.id,
      label: r.title,
      ref_type: "item" as const,
    }));
  }
}

function makeMentionSuggestion(): Omit<
  SuggestionOptions<
    MentionItem & { ref_type?: string },
    MentionItem & { ref_type?: string }
  >,
  "editor"
> {
  return {
    items: async ({ query }) => mentionSearch(query),
    render: () => {
      let root: ReactDOM.Root | null = null;
      let popup: HTMLDivElement | null = null;
      let componentRef: MentionListRef | null = null;
      return {
        onStart: (
          props: SuggestionProps<
            MentionItem & { ref_type?: string },
            MentionItem & { ref_type?: string }
          >,
        ) => {
          popup = document.createElement("div");
          popup.style.position = "absolute";
          popup.style.zIndex = "50";
          document.body.appendChild(popup);
          root = ReactDOM.createRoot(popup);
          root.render(
            <MentionList
              ref={(r) => {
                componentRef = r;
              }}
              items={props.items}
              command={props.command}
            />,
          );
          updatePosition(popup, props.clientRect);
        },
        onUpdate: (
          props: SuggestionProps<
            MentionItem & { ref_type?: string },
            MentionItem & { ref_type?: string }
          >,
        ) => {
          if (root && popup) {
            root.render(
              <MentionList
                ref={(r) => {
                  componentRef = r;
                }}
                items={props.items}
                command={props.command}
              />,
            );
            updatePosition(popup, props.clientRect);
          }
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            if (popup && root) {
              root.unmount();
              popup.remove();
              popup = null;
              root = null;
            }
            return true;
          }
          return componentRef?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          if (root) root.unmount();
          if (popup) popup.remove();
          popup = null;
          root = null;
          componentRef = null;
        },
      };
    },
  };
}

function updatePosition(
  popup: HTMLDivElement,
  clientRect: (() => DOMRect | null) | null | undefined,
) {
  if (!clientRect) return;
  const rect = clientRect();
  if (!rect) return;
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;
}

// ── link persistence (project_note_links) ────────────────────────────────────

async function syncProjectMentionLinks(
  noteId: string,
  html: string,
): Promise<void> {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const mentions = doc.querySelectorAll("a[data-type='mention'][data-id]");

    const seen = new Set<string>();
    const links: Array<{
      target_ref_type: "note" | "item" | "person" | "folder";
      target_ref_id: string;
      mention_offset: number;
    }> = [];
    const plainText = doc.body.textContent || "";

    mentions.forEach((el) => {
      const id = el.getAttribute("data-id") || "";
      const refType = (el.getAttribute("data-ref-type") || "item") as
        | "note"
        | "item"
        | "person"
        | "folder";
      const key = `${refType}::${id}`;
      if (!id || seen.has(key)) return;
      seen.add(key);
      const label = el.textContent || "";
      const offset = Math.max(0, plainText.indexOf(label));
      links.push({
        target_ref_type: refType,
        target_ref_id: id,
        mention_offset: offset,
      });
    });

    await Promise.allSettled(
      links.map((l) => createProjectNoteLink(noteId, l)),
    );
  } catch {
    // never block save
  }
}

// ── W3C text-quote selector from a ProseMirror range ────────────────────────

interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
}

function buildTextQuoteSelector(editor: Editor): TextQuoteSelector | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  const exact = editor.state.doc.textBetween(from, to, "\n");
  const CTX = 32;
  const prefix = editor.state.doc.textBetween(Math.max(0, from - CTX), from, "\n");
  const suffix = editor.state.doc.textBetween(
    to,
    Math.min(editor.state.doc.content.size, to + CTX),
    "\n",
  );
  return { type: "TextQuoteSelector", exact, prefix, suffix };
}

// ── BubbleMenuContent — floating toolbar on selection ───────────────────────

function BubbleMenuContent({
  editor,
  onAddComment,
  onInsertMath,
}: {
  editor: Editor;
  onAddComment: () => void;
  onInsertMath: () => void;
}) {
  const S = 13;
  const btn =
    "p-1.5 rounded-[4px] transition-warm text-text-tertiary hover:bg-bg-secondary hover:text-text-primary";
  const active =
    "p-1.5 rounded-[4px] transition-warm bg-bg-secondary text-accent";

  const addLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  };

  return (
    <div
      className="flex items-center gap-0.5 p-1 rounded-card
                 bg-bg-primary border border-border shadow-warm-lg"
    >
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive("bold") ? active : btn}
        title="Bold (⌘B)"
      >
        <Bold size={S} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive("italic") ? active : btn}
        title="Italic (⌘I)"
      >
        <Italic size={S} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={editor.isActive("underline") ? active : btn}
        title="Underline (⌘U)"
      >
        <UnderlineIcon size={S} />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={editor.isActive("code") ? active : btn}
        title="Inline code (⌘E)"
      >
        <Code size={S} />
      </button>
      <button
        onClick={addLink}
        className={editor.isActive("link") ? active : btn}
        title="Link (⌘K)"
      >
        <LinkIcon size={S} />
      </button>
      <button onClick={onInsertMath} className={btn} title="Inline math">
        <Sigma size={S} />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive("bulletList") ? active : btn}
        title="Bullet list (⌘⇧8)"
      >
        <List size={S} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive("orderedList") ? active : btn}
        title="Numbered list (⌘⇧7)"
      >
        <ListOrdered size={S} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={editor.isActive("taskList") ? active : btn}
        title="Task list (⌘⇧9)"
      >
        <ListChecks size={S} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive("blockquote") ? active : btn}
        title="Quote"
      >
        <Quote size={S} />
      </button>
      <button
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
            .run()
        }
        className={btn}
        title="Table"
      >
        <TableIcon size={S} />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button onClick={onAddComment} className={btn} title="Add comment (⌘⌥M)">
        <MessageSquare size={S} />
      </button>
    </div>
  );
}

// ── NoteEditorV2 props ──────────────────────────────────────────────────────

export interface NoteEditorV2Props {
  /** Current content as HTML. */
  content: string;
  /** Save callback — debounced to 5s of inactivity + flush on blur. */
  onSave: (content: string) => void;
  placeholder?: string;
  /** When present, @mentions become project_note_links and comments target this note. */
  projectNoteId?: string;
  /** Frontmatter shown in the source view. Minimum: note id. */
  frontmatter?: NoteFrontmatter;
  /** Shown above the editor for `source` toggle. */
  title?: string;
}

export interface NoteEditorV2Ref {
  focus: () => void;
}

// ── component ───────────────────────────────────────────────────────────────

const NoteEditorV2 = forwardRef<NoteEditorV2Ref, NoteEditorV2Props>(
  function NoteEditorV2(
    { content, onSave, placeholder = "Start writing...", projectNoteId, frontmatter, title },
    ref,
  ) {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestContentRef = useRef(content);
    const noteIdRef = useRef(projectNoteId);
    const sidebarRef = useRef<NoteCommentsSidebarRef>(null);
    const [showSource, setShowSource] = useState(false);
    const [sourceDraft, setSourceDraft] = useState("");

    useEffect(() => {
      noteIdRef.current = projectNoteId;
    }, [projectNoteId]);

    const handleSave = useCallback(
      (html: string) => {
        onSave(html);
        if (noteIdRef.current) syncProjectMentionLinks(noteIdRef.current, html);
      },
      [onSave],
    );

    // ── TipTap editor wiring
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          codeBlock: { HTMLAttributes: { class: "stoa-code-block" } },
        }),
        Placeholder.configure({ placeholder }),
        Underline,
        Link.configure({
          openOnClick: true,
          autolink: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
          },
        }),
        ResizableImage.configure({ allowBase64: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        InlineMath,
        BlockMath,
        FootnoteReference,
        FootnoteDefinition,
        CommentMark,
        Wikilink,
        Mention.configure({
          HTMLAttributes: { class: "stoa-mention" },
          renderHTML({ options, node }) {
            const refType: string = node.attrs.ref_type ?? "item";
            const id: string = node.attrs.id ?? "";
            let href = `/item/${id}`;
            if (refType === "note") href = `/project-notes/${id}`;
            else if (refType === "person") href = `/people/${id}`;
            return [
              "a",
              {
                ...options.HTMLAttributes,
                "data-type": "mention",
                "data-id": id,
                "data-ref-type": refType,
                href,
                class: "stoa-mention",
              },
              `@${node.attrs.label ?? id}`,
            ];
          },
          suggestion:
            makeMentionSuggestion() as unknown as typeof Mention.options.suggestion,
        }),
      ],
      content,
      onUpdate: ({ editor: ed }) => {
        const html = ed.getHTML();
        latestContentRef.current = html;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => handleSave(html), 5000);
      },
      editorProps: {
        handleDrop: (_view, event) => {
          const files = event.dataTransfer?.files;
          if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith("image/")) {
              event.preventDefault();
              const reader = new FileReader();
              reader.onload = () => {
                const src = reader.result as string;
                editor?.chain().focus().setImage({ src }).run();
              };
              reader.readAsDataURL(file);
              return true;
            }
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const items = event.clipboardData?.items;
          if (items) {
            for (const item of items) {
              if (item.type.startsWith("image/")) {
                event.preventDefault();
                const file = item.getAsFile();
                if (!file) return false;
                const reader = new FileReader();
                reader.onload = () => {
                  const src = reader.result as string;
                  editor?.chain().focus().setImage({ src }).run();
                };
                reader.readAsDataURL(file);
                return true;
              }
            }
          }
          return false;
        },
      },
    });

    // ── flush on blur
    const handleBlur = useCallback(() => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      handleSave(latestContentRef.current);
    }, [handleSave]);

    useEffect(() => {
      if (!editor) return;
      editor.on("blur", handleBlur);
      return () => {
        editor.off("blur", handleBlur);
      };
    }, [editor, handleBlur]);

    // ── sync prop changes
    const prevContentRef = useRef(content);
    useEffect(() => {
      if (editor && content !== prevContentRef.current) {
        prevContentRef.current = content;
        if (editor.getHTML() !== content) editor.commands.setContent(content);
      }
    }, [editor, content]);

    useEffect(
      () => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      },
      [],
    );

    // ── imperative handle
    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
      }),
      [editor],
    );

    // ── comment integration
    const addCommentOnSelection = useCallback(async () => {
      if (!editor || !projectNoteId) return;
      const selector = buildTextQuoteSelector(editor);
      if (!selector) {
        window.alert("Select text first to add a comment.");
        return;
      }
      const body = window.prompt(`Comment on "${selector.exact.slice(0, 60)}..."`);
      if (!body || !body.trim()) return;
      const comment = await sidebarRef.current?.addComment(
        body.trim(),
        selector,
      );
      if (comment) {
        // Apply the CommentMark to the selection so the editor renders the
        // underline + clickability. If multiple marks overlap we accept that.
        editor
          .chain()
          .focus()
          .setMark("commentMark", { commentId: comment.id })
          .run();
      }
    }, [editor, projectNoteId]);

    // ── keyboard shortcut: cmd+alt+m = comment
    useEffect(() => {
      if (!editor) return;
      const onKey = (e: KeyboardEvent) => {
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && e.altKey && (e.key === "m" || e.key === "M")) {
          e.preventDefault();
          addCommentOnSelection();
        }
        if (mod && e.key === "/") {
          e.preventDefault();
          setShowSource((s) => !s);
        }
      };
      const dom = editor.view.dom as HTMLElement;
      dom.addEventListener("keydown", onKey);
      return () => dom.removeEventListener("keydown", onKey);
    }, [editor, addCommentOnSelection]);

    // ── inline math insertion (prompt-driven)
    const insertInlineMath = useCallback(() => {
      if (!editor) return;
      const latex = window.prompt("LaTeX (inline):");
      if (!latex) return;
      editor
        .chain()
        .focus()
        .insertContent({ type: "inlineMath", attrs: { latex } })
        .run();
    }, [editor]);

    // ── click on comment-highlight: focus sidebar card
    useEffect(() => {
      if (!editor) return;
      const dom = editor.view.dom as HTMLElement;
      const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const span = target.closest("span[data-comment-id]") as HTMLElement | null;
        if (span) {
          const id = span.getAttribute("data-comment-id");
          if (id) sidebarRef.current?.focusComment(id);
        }
      };
      dom.addEventListener("click", onClick);
      return () => dom.removeEventListener("click", onClick);
    }, [editor]);

    // ── source-view bridge
    const handleToggleSource = useCallback(() => {
      if (!editor) return;
      if (!showSource) {
        // Going to source — serialise current HTML.
        const md = toMarkdown({
          frontmatter: frontmatter ?? ({ id: projectNoteId ?? "" } as NoteFrontmatter),
          title: title ?? "",
          html: editor.getHTML(),
        });
        setSourceDraft(md);
      } else {
        // Going back to WYSIWYG — parse source.
        try {
          const parsed = fromMarkdown(sourceDraft);
          editor.commands.setContent(parsed.html);
          latestContentRef.current = editor.getHTML();
          handleSave(latestContentRef.current);
        } catch {
          // If parse fails, keep WYSIWYG content; show alert.
          window.alert("Could not parse markdown — WYSIWYG unchanged.");
        }
      }
      setShowSource((s) => !s);
    }, [editor, showSource, sourceDraft, frontmatter, title, projectNoteId, handleSave]);

    // ── sidebar → editor
    const scrollToComment = useCallback(
      (comment: { range_selector: unknown; id: string }) => {
        if (!editor) return;
        // Prefer CommentMark search by id.
        const dom = editor.view.dom as HTMLElement;
        const span = dom.querySelector<HTMLElement>(
          `span[data-comment-id="${comment.id}"]`,
        );
        if (span) {
          span.scrollIntoView({ behavior: "smooth", block: "center" });
          span.classList.add("flash-highlight");
          setTimeout(() => span.classList.remove("flash-highlight"), 1200);
        }
      },
      [editor],
    );

    const removeCommentMark = useCallback(
      (commentId: string) => {
        if (!editor) return;
        const dom = editor.view.dom as HTMLElement;
        const span = dom.querySelector<HTMLElement>(
          `span[data-comment-id="${commentId}"]`,
        );
        if (!span) return;
        span.removeAttribute("data-comment-id");
        span.classList.remove("stoa-comment-highlight");
      },
      [editor],
    );

    // ── memoised BubbleMenu to avoid re-renders
    const bubble = useMemo(() => {
      if (!editor) return null;
      return (
        <BubbleMenu editor={editor}>
          <BubbleMenuContent
            editor={editor}
            onAddComment={addCommentOnSelection}
            onInsertMath={insertInlineMath}
          />
        </BubbleMenu>
      );
    }, [editor, addCommentOnSelection, insertInlineMath]);

    if (!editor) return null;

    return (
      <div className="note-editor-v2 flex flex-row h-full w-full">
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Top bar */}
          <div
            className="flex items-center justify-end gap-2 px-4 py-1.5
                       border-b border-border/60 bg-bg-primary/80"
          >
            <button
              onClick={handleToggleSource}
              className="flex items-center gap-1 text-[10px] font-mono
                         text-text-tertiary hover:text-text-secondary transition-warm"
              title="Toggle source (⌘/)"
            >
              {showSource ? (
                <>
                  <EyeOff size={10} /> Source
                </>
              ) : (
                <>
                  <Eye size={10} /> Source
                </>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {showSource ? (
              <textarea
                value={sourceDraft}
                onChange={(e) => setSourceDraft(e.target.value)}
                className="w-full h-full min-h-[85vh] p-8 bg-bg-editor
                           font-mono text-[13px] leading-relaxed text-text-primary
                           outline-none resize-none"
                spellCheck={false}
              />
            ) : (
              <>
                {bubble}
                <EditorContent editor={editor} />
              </>
            )}
          </div>
        </div>

        {/* Comments sidebar */}
        {projectNoteId && !showSource && (
          <NoteCommentsSidebar
            ref={sidebarRef}
            projectNoteId={projectNoteId}
            onCommentFocus={scrollToComment}
            onCommentDelete={removeCommentMark}
            defaultCollapsed={true}
          />
        )}
      </div>
    );
  },
);

export default NoteEditorV2;
