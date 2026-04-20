/**
 * NoteCommentsSidebar — Google-Docs-style threaded comments on project notes.
 *
 * Architecture
 * ────────────
 * - Selection in the editor -> "Add comment" affordance -> creates a row in
 *   note_comments keyed by a W3C range selector + commentMark on the text.
 * - Sidebar fetches comments for the active note and groups by parent_id
 *   (root + replies). Click a sidebar card -> editor scrolls the anchored
 *   range into view and flashes it. Click the range in the editor -> sidebar
 *   card scrolls in and highlights.
 * - Resizable: drag the left edge to resize (min 240, max 480).
 * - Collapsible: header chevron hides the panel to a 32px strip.
 *
 * Cognitive framing
 * ─────────────────
 * Hudson reads retrospectively — comments are a synthesis aid, not a
 * capture aid. The sidebar must stay out of the way during writing. We
 * default-collapse when there are zero comments; expand on selection or on
 * first comment creation.
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
import {
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Send,
  Trash2,
  Check,
  CornerDownRight,
} from "lucide-react";
import {
  listNoteComments,
  createNoteComment,
  updateNoteComment,
  deleteNoteComment,
  type NoteCommentRow,
} from "@/lib/api";

// ── public API ──────────────────────────────────────────────────────────────

export interface NoteCommentsSidebarRef {
  /** Add a new root comment; parent_id is null. Body/range come from the editor. */
  addComment: (
    body: string,
    range_selector: unknown,
    commentId?: string,
  ) => Promise<NoteCommentRow | null>;
  /** Scroll and flash a comment card. Used when user clicks a marked range. */
  focusComment: (commentId: string) => void;
  /** Refresh from the server (used after external edits). */
  refresh: () => Promise<void>;
}

interface NoteCommentsSidebarProps {
  projectNoteId: string | null;
  /** Callback when user clicks a comment card — scroll editor to the range. */
  onCommentFocus: (comment: NoteCommentRow) => void;
  /** Callback when user deletes a comment — remove the mark in the editor. */
  onCommentDelete: (commentId: string) => void;
  /** Initial collapsed state. Default true when no comments exist. */
  defaultCollapsed?: boolean;
}

// ── tree grouping ───────────────────────────────────────────────────────────

interface CommentTreeNode {
  comment: NoteCommentRow;
  replies: NoteCommentRow[];
}

function buildThreads(rows: NoteCommentRow[]): CommentTreeNode[] {
  const roots: CommentTreeNode[] = [];
  const byId = new Map<string, CommentTreeNode>();
  for (const r of rows) {
    if (!r.parent_id) {
      const node: CommentTreeNode = { comment: r, replies: [] };
      byId.set(r.id, node);
      roots.push(node);
    }
  }
  for (const r of rows) {
    if (r.parent_id) {
      const parent = byId.get(r.parent_id);
      if (parent) parent.replies.push(r);
      else {
        // Orphaned reply — surface as a root so the comment isn't lost.
        const node: CommentTreeNode = { comment: r, replies: [] };
        byId.set(r.id, node);
        roots.push(node);
      }
    }
  }
  roots.sort(
    (a, b) =>
      new Date(b.comment.created_at).getTime() -
      new Date(a.comment.created_at).getTime(),
  );
  return roots;
}

// ── component ───────────────────────────────────────────────────────────────

const NoteCommentsSidebar = forwardRef<
  NoteCommentsSidebarRef,
  NoteCommentsSidebarProps
>(function NoteCommentsSidebar(
  { projectNoteId, onCommentFocus, onCommentDelete, defaultCollapsed },
  ref,
) {
  const [comments, setComments] = useState<NoteCommentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(
    defaultCollapsed ?? false,
  );
  const [width, setWidth] = useState<number>(320);
  const resizingRef = useRef(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── data fetch
  const refresh = useCallback(async () => {
    if (!projectNoteId) {
      setComments([]);
      return;
    }
    setLoading(true);
    try {
      const { comments: rows } = await listNoteComments(projectNoteId);
      setComments(rows);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectNoteId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── resizing
  useEffect(() => {
    if (!resizingRef.current) return;
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const next = Math.min(Math.max(240, window.innerWidth - e.clientX), 480);
      setWidth(next);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onGutterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
  }, []);

  // ── imperative handle
  useImperativeHandle(
    ref,
    () => ({
      addComment: async (body, range_selector, _commentId) => {
        if (!projectNoteId) return null;
        try {
          const { comment } = await createNoteComment({
            project_note_id: projectNoteId,
            body,
            range_selector,
          });
          setComments((prev) => [...prev, comment]);
          setCollapsed(false);
          return comment;
        } catch {
          return null;
        }
      },
      focusComment: (commentId) => {
        const el = cardRefs.current.get(commentId);
        if (!el) return;
        setCollapsed(false);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash-highlight");
        setTimeout(() => el.classList.remove("flash-highlight"), 1200);
      },
      refresh,
    }),
    [projectNoteId, refresh],
  );

  const threads = useMemo(() => buildThreads(comments), [comments]);

  const rootCount = threads.length;
  const hasAny = rootCount > 0;

  // ── handlers
  const handleReply = useCallback(
    async (parent: NoteCommentRow, body: string) => {
      if (!projectNoteId || !body.trim()) return;
      try {
        const { comment } = await createNoteComment({
          project_note_id: projectNoteId,
          body,
          parent_id: parent.id,
          range_selector: parent.range_selector,
        });
        setComments((prev) => [...prev, comment]);
      } catch {
        // silent
      }
    },
    [projectNoteId],
  );

  const handleResolve = useCallback(async (c: NoteCommentRow) => {
    try {
      const { comment } = await updateNoteComment(c.id, { resolved: !c.resolved });
      setComments((prev) => prev.map((x) => (x.id === c.id ? comment : x)));
    } catch {
      // silent
    }
  }, []);

  const handleDelete = useCallback(
    async (c: NoteCommentRow) => {
      try {
        await deleteNoteComment(c.id);
        setComments((prev) =>
          prev.filter((x) => x.id !== c.id && x.parent_id !== c.id),
        );
        onCommentDelete(c.id);
      } catch {
        // silent
      }
    },
    [onCommentDelete],
  );

  if (collapsed) {
    return (
      <div
        className="h-full flex-shrink-0 flex flex-col items-center justify-start
                   border-l border-border bg-bg-secondary/30 w-8 py-2 gap-2"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="p-1 rounded hover:bg-bg-secondary text-text-tertiary
                     hover:text-text-secondary transition-warm"
          title="Expand comments"
        >
          <ChevronLeft size={14} />
        </button>
        <MessageSquare size={14} className="text-text-tertiary" />
        {hasAny && (
          <span className="text-[10px] font-mono text-text-secondary">
            {rootCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="h-full flex-shrink-0 relative border-l border-border
                 bg-bg-secondary/30 flex flex-col"
      style={{ width }}
    >
      {/* Resize gutter */}
      <div
        onMouseDown={onGutterMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize
                   hover:bg-accent/30 transition-warm z-10"
        title="Drag to resize"
      />

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2
                   border-b border-border bg-bg-secondary/50"
      >
        <div className="flex items-center gap-1.5">
          <MessageSquare size={13} className="text-text-tertiary" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-text-secondary">
            Comments ({rootCount})
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-0.5 rounded hover:bg-bg-primary text-text-tertiary
                     hover:text-text-secondary transition-warm"
          title="Collapse"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {loading && (
          <p className="text-[11px] text-text-tertiary text-center py-3">
            Loading...
          </p>
        )}
        {!loading && !hasAny && (
          <div className="text-center py-8 px-4">
            <MessageSquare
              size={20}
              className="mx-auto mb-2 text-text-tertiary/40"
            />
            <p className="text-[11px] text-text-secondary">No comments yet</p>
            <p className="text-[10px] text-text-tertiary mt-1 leading-snug">
              Select text and press{" "}
              <kbd className="px-1 py-0.5 rounded bg-bg-primary border border-border text-[9px]">
                ⌘⌥M
              </kbd>{" "}
              to add a comment.
            </p>
          </div>
        )}
        {threads.map((thread) => (
          <CommentThreadCard
            key={thread.comment.id}
            thread={thread}
            onFocus={onCommentFocus}
            onReply={handleReply}
            onResolve={handleResolve}
            onDelete={handleDelete}
            registerRef={(id, el) => {
              if (el) cardRefs.current.set(id, el);
              else cardRefs.current.delete(id);
            }}
          />
        ))}
      </div>
    </div>
  );
});

export default NoteCommentsSidebar;

// ── thread card ─────────────────────────────────────────────────────────────

function CommentThreadCard({
  thread,
  onFocus,
  onReply,
  onResolve,
  onDelete,
  registerRef,
}: {
  thread: CommentTreeNode;
  onFocus: (c: NoteCommentRow) => void;
  onReply: (parent: NoteCommentRow, body: string) => void;
  onResolve: (c: NoteCommentRow) => void;
  onDelete: (c: NoteCommentRow) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [showReplyBox, setShowReplyBox] = useState(false);
  const { comment, replies } = thread;

  const onReplyClick = useCallback(() => {
    const body = replyDraft.trim();
    if (!body) return;
    onReply(comment, body);
    setReplyDraft("");
    setShowReplyBox(false);
  }, [comment, onReply, replyDraft]);

  return (
    <div
      ref={(el) => registerRef(comment.id, el)}
      className={`rounded-card border px-2.5 py-2 transition-warm
        ${
          comment.resolved
            ? "border-border bg-bg-primary/40 opacity-60"
            : "border-border bg-bg-primary hover:border-accent/30"
        }`}
    >
      <CommentRow
        c={comment}
        onFocus={() => onFocus(comment)}
        onResolve={() => onResolve(comment)}
        onDelete={() => onDelete(comment)}
      />
      {replies.length > 0 && (
        <div className="mt-1.5 pl-3 border-l border-border/60 space-y-1.5">
          {replies.map((r) => (
            <CommentRow
              key={r.id}
              c={r}
              reply
              onFocus={() => onFocus(comment)}
              onResolve={() => {
                /* replies inherit resolve state */
              }}
              onDelete={() => onDelete(r)}
            />
          ))}
        </div>
      )}
      {!comment.resolved && (
        <div className="mt-1.5">
          {showReplyBox ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onReplyClick();
                  if (e.key === "Escape") {
                    setShowReplyBox(false);
                    setReplyDraft("");
                  }
                }}
                placeholder="Reply..."
                className="flex-1 text-[12px] px-2 py-1 rounded border
                           border-border bg-bg-secondary/40 outline-none
                           focus:border-accent/40 text-text-primary"
              />
              <button
                onClick={onReplyClick}
                className="p-1 rounded text-accent hover:bg-accent/10 transition-warm"
                title="Send"
              >
                <Send size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowReplyBox(true)}
              className="text-[10px] text-text-tertiary hover:text-text-secondary flex items-center gap-1"
            >
              <CornerDownRight size={9} /> Reply
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  c,
  onFocus,
  onResolve,
  onDelete,
  reply,
}: {
  c: NoteCommentRow;
  onFocus: () => void;
  onResolve: () => void;
  onDelete: () => void;
  reply?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  useEffect(() => setDraft(c.body), [c.body]);

  const onSave = useCallback(async () => {
    if (draft.trim() === c.body.trim()) {
      setEditing(false);
      return;
    }
    try {
      await updateNoteComment(c.id, { body: draft.trim() });
      setEditing(false);
    } catch {
      // silent
    }
  }, [c.id, c.body, draft]);

  return (
    <div>
      <div className="flex items-start gap-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") {
                setDraft(c.body);
                setEditing(false);
              }
            }}
            onBlur={onSave}
            className="flex-1 text-[12px] px-2 py-1 rounded border border-border
                       bg-bg-secondary/30 outline-none focus:border-accent/40"
          />
        ) : (
          <button
            onClick={onFocus}
            onDoubleClick={() => setEditing(true)}
            className={`flex-1 text-left text-[12px] leading-snug transition-warm
              ${reply ? "text-text-secondary" : "text-text-primary"}
              hover:text-accent`}
            title="Double-click to edit"
          >
            {c.body}
          </button>
        )}
        {!reply && (
          <button
            onClick={onResolve}
            className={`p-0.5 rounded transition-warm flex-shrink-0
              ${
                c.resolved
                  ? "text-green-500"
                  : "text-text-tertiary hover:text-green-500"
              }`}
            title={c.resolved ? "Reopen" : "Resolve"}
          >
            <Check size={11} />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-0.5 rounded text-text-tertiary hover:text-red-500 hover:bg-red-50
                     transition-warm flex-shrink-0"
          title="Delete"
        >
          <Trash2 size={10} />
        </button>
      </div>
      <p className="text-[9px] font-mono text-text-tertiary mt-0.5">
        {new Date(c.created_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}
