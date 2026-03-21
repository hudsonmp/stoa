import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Send,
  Trash2,
  Copy,
} from "lucide-react";
import type { Item, Highlight, Note, Citation } from "@/lib/supabase";
import {
  getItem,
  updateItem,
  createNote,
  updateHighlight,
  deleteNote,
  deleteHighlight,
  exportBibtex,
} from "@/lib/api";
import NoteEditor from "@/components/NoteEditor";

/**
 * URL Reader — loads any page in an iframe with an annotation sidebar.
 * Used for blogs, pages, and non-PDF items.
 */
export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [editingHighlightNote, setEditingHighlightNote] = useState<string | null>(null);
  const [highlightNoteDraft, setHighlightNoteDraft] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!id) return;
    loadItem();
  }, [id]);

  const loadItem = async () => {
    setLoading(true);
    try {
      const data = await getItem(id!);
      const loadedItem = data.item as Item;
      setItem(loadedItem);
      setHighlights((data.highlights as Highlight[]) || []);
      setNotes((data.notes as Note[]) || []);
      setCitation((data.citation as Citation) || null);

      // Auto-set reading status
      if (loadedItem.reading_status === "to_read") {
        await updateItem(loadedItem.id, { reading_status: "reading" });
        setItem({ ...loadedItem, reading_status: "reading" });
      }
    } catch {
      setItem(null);
    }
    setLoading(false);
  };

  // Save scroll position when leaving the page
  const saveScrollPosition = useCallback(async () => {
    if (!item || !iframeRef.current) return;
    try {
      const iframeWindow = iframeRef.current.contentWindow;
      if (!iframeWindow) return;
      const scrollY = iframeWindow.scrollY || 0;
      const scrollX = iframeWindow.scrollX || 0;
      const docHeight = iframeWindow.document.documentElement.scrollHeight || 1;
      const viewportHeight = iframeWindow.innerHeight || 0;
      const progress = Math.min(
        Math.round(((scrollY + viewportHeight) / docHeight) * 100),
        100
      );
      await updateItem(item.id, {
        scroll_position: { x: scrollX, y: scrollY, progress },
      });
    } catch {
      // Cross-origin iframes block access — silently fail
    }
  }, [item]);

  // Periodically save scroll position and on unmount
  useEffect(() => {
    const interval = setInterval(() => {
      saveScrollPosition();
    }, 10000);
    return () => {
      clearInterval(interval);
      saveScrollPosition();
    };
  }, [saveScrollPosition]);

  // Restore scroll position when iframe loads
  const handleIframeLoad = useCallback(() => {
    if (!item?.scroll_position || !iframeRef.current) return;
    try {
      const iframeWindow = iframeRef.current.contentWindow;
      if (!iframeWindow) return;
      // Small delay to let page settle
      setTimeout(() => {
        iframeWindow.scrollTo({
          top: item.scroll_position!.y,
          left: item.scroll_position!.x,
          behavior: "smooth",
        });
      }, 500);
    } catch {
      // Cross-origin — can't restore
    }
  }, [item]);

  // Save on page leave
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveScrollPosition();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveScrollPosition]);

  const saveNote = async () => {
    if (!noteContent.trim() || !item) return;
    const result = await createNote({ item_id: item.id, content: noteContent });
    const newNote = (result as { note: Note }).note;
    setNotes((prev) => [newNote, ...prev]);
    setNoteContent("");
  };

  const handleDeleteNote = useCallback(async (noteId: string) => {
    try {
      await deleteNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (e) {
      console.error("Failed to delete note:", e);
    }
  }, []);

  const handleDeleteHighlight = useCallback(async (hlId: string) => {
    try {
      await deleteHighlight(hlId);
      setHighlights((prev) => prev.filter((h) => h.id !== hlId));
    } catch (e) {
      console.error("Failed to delete highlight:", e);
    }
  }, []);

  const saveHighlightNote = useCallback(
    async (hlId: string) => {
      await updateHighlight(hlId, { note: highlightNoteDraft || null });
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === hlId ? { ...h, note: highlightNoteDraft || undefined } : h
        )
      );
      setEditingHighlightNote(null);
      setHighlightNoteDraft("");
    },
    [highlightNoteDraft]
  );

  if (loading) {
    return (
      <div className="reader-loading">
        <div className="reader-loading-pulse" />
        <div className="reader-loading-pulse short" />
        <div className="reader-loading-pulse" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="reader-loading">
        <p className="text-sm text-text-secondary">Item not found</p>
      </div>
    );
  }

  return (
    <div className="url-reader">
      {/* Top bar */}
      <div className="url-reader-topbar">
        <Link
          to={`/item/${item.id}`}
          className="reader-back"
          onClick={() => saveScrollPosition()}
        >
          <ArrowLeft size={14} />
          {item.title.length > 50 ? item.title.slice(0, 50) + "..." : item.title}
        </Link>

        <div className="reader-topbar-actions">
          {item.scroll_position && item.scroll_position.progress > 0 && (
            <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
              {item.scroll_position.progress}%
            </span>
          )}
          {citation && (
            <button
              onClick={async () => {
                try {
                  const data = await exportBibtex(item.id);
                  await navigator.clipboard.writeText(data.bibtex);
                } catch {}
              }}
              className="reader-external-link"
            >
              <Copy size={12} /> Cite
            </button>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="reader-external-link"
            >
              <ExternalLink size={12} />
              Original
            </a>
          )}
        </div>
      </div>

      {/* Main content: iframe + sidebar */}
      <div className="url-reader-body">
        {/* Iframe loading the original URL */}
        <div className="url-reader-iframe-wrapper">
          {item.url ? (
            <iframe
              ref={iframeRef}
              src={item.url}
              title={item.title}
              className="url-reader-iframe"
              onLoad={handleIframeLoad}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
              No URL to load
            </div>
          )}
        </div>

        {/* Annotation sidebar */}
        <aside className="url-reader-sidebar">
          <div className="reader-margin-heading">Annotations</div>
          <div className="reader-margin-input-rich">
            <NoteEditor
              content={noteContent}
              onChange={setNoteContent}
              placeholder="Add a note..."
            />
            <button
              onClick={saveNote}
              disabled={!noteContent.trim() || noteContent === "<p></p>"}
              className="reader-margin-send mt-1"
              title="Save note (Cmd+Enter)"
            >
              <Send size={13} />
            </button>
          </div>

          {/* Highlights */}
          {highlights.length > 0 && (
            <>
              <div className="reader-margin-divider" />
              <div className="reader-margin-heading">
                Highlights ({highlights.length})
              </div>
              {highlights.map((hl) => (
                <div
                  key={hl.id}
                  className="reader-margin-card reader-margin-card-hl group/hl"
                  data-color={hl.color}
                >
                  <p className="reader-margin-card-text">
                    &ldquo;{hl.text}&rdquo;
                  </p>
                  {editingHighlightNote === hl.id ? (
                    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={highlightNoteDraft}
                        onChange={(e) => setHighlightNoteDraft(e.target.value)}
                        placeholder="What does this make you think?"
                        className="w-full bg-transparent text-[11px] font-sans text-text-primary
                                   outline-none border-b border-accent/30 pb-0.5"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveHighlightNote(hl.id);
                          if (e.key === "Escape") {
                            setEditingHighlightNote(null);
                            setHighlightNoteDraft("");
                          }
                        }}
                        onBlur={() => saveHighlightNote(hl.id)}
                      />
                    </div>
                  ) : hl.note ? (
                    <p
                      className="reader-margin-card-note"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingHighlightNote(hl.id);
                        setHighlightNoteDraft(hl.note || "");
                      }}
                      title="Double-click to edit"
                    >
                      {hl.note}
                    </p>
                  ) : (
                    <button
                      className="text-[10px] text-text-tertiary hover:text-accent mt-0.5 transition-warm
                                 opacity-0 group-hover/hl:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingHighlightNote(hl.id);
                        setHighlightNoteDraft("");
                      }}
                    >
                      + note
                    </button>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="reader-margin-card-time">
                      {new Date(hl.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <button
                      onClick={() => handleDeleteHighlight(hl.id)}
                      className="opacity-0 group-hover/hl:opacity-100 transition-warm
                                 text-text-tertiary hover:text-red-500 p-0.5"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Notes */}
          {notes.length > 0 && (
            <>
              <div className="reader-margin-divider" />
              <div className="reader-margin-heading">Notes ({notes.length})</div>
              {notes.map((n) => (
                <div key={n.id} className="reader-margin-card reader-margin-note-card group/note">
                  <div
                    className="reader-margin-note-content"
                    dangerouslySetInnerHTML={{ __html: n.content }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="reader-margin-card-time">
                      {new Date(n.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <button
                      onClick={() => handleDeleteNote(n.id)}
                      className="opacity-0 group-hover/note:opacity-100 transition-warm
                                 text-text-tertiary hover:text-red-500 p-0.5"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {highlights.length === 0 && notes.length === 0 && (
            <p className="reader-margin-empty">
              No annotations yet. Add a note above while you read.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
