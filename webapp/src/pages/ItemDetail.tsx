import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  BookOpen,
  FileText,
  Headphones,
  Globe,
  MessageCircle,
  Video,
  Bookmark,
  Highlighter,
  ChevronRight,
  PenLine,
  Check,
  X,
  Plus,
  Send,
  Trash2,
  Copy,
} from "lucide-react";
import type { Item, Highlight, Note, Citation } from "@/lib/supabase";
import { getItem, updateItem, createNote, createHighlight, updateHighlight, getItemTags, setItemTags, deleteNote, deleteHighlight, getPdfEmbedUrl, getAr5ivUrl, exportBibtex } from "@/lib/api";
import ReaderView from "@/components/ReaderView";
import HighlightPanel from "@/components/HighlightPanel";
import NoteEditor from "@/components/NoteEditor";
import { useHighlightPositions } from "@/hooks/useHighlightPositions";

const typeIcons: Record<string, typeof BookOpen> = {
  book: BookOpen,
  blog: FileText,
  paper: FileText,
  podcast: Headphones,
  page: Globe,
  tweet: MessageCircle,
  video: Video,
  writing: PenLine,
};

const ITEM_TYPES = ["blog", "writing", "book", "paper", "podcast", "video", "page"] as const;

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [relatedItems, setRelatedItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [highlightPanelOpen, setHighlightPanelOpen] = useState(false);
  const [readerMode, setReaderMode] = useState(false);
  const [pdfMode, setPdfMode] = useState(false);
  const [ar5ivMode, setAr5ivMode] = useState(false);

  // Inline editing state
  const [editingHighlightNote, setEditingHighlightNote] = useState<string | null>(null);
  const [highlightNoteDraft, setHighlightNoteDraft] = useState("");
  const [lastCreatedHighlightId, setLastCreatedHighlightId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLElement>(null);
  const hlContainerRef = useRef<HTMLDivElement>(null);

  // Positional anchoring version — bumped when highlights change
  const hlVersion = highlights.length;
  const hlIds = useMemo(() => highlights.map((h) => h.id), [highlights]);
  const hlPositions = useHighlightPositions(hlIds, scrollContainerRef, hlContainerRef, hlVersion);

  useEffect(() => {
    if (!id) return;
    loadItem();
  }, [id]);

  const pdfUrl = item ? getPdfEmbedUrl(item) : null;
  const ar5ivUrl = item ? getAr5ivUrl(item) : null;

  // Auto-enter reader mode if there's extracted text
  useEffect(() => {
    if (item?.extracted_text && item.extracted_text.length > 200) {
      setReaderMode(true);
    }
  }, [item]);

  // arXiv papers default to ar5iv HTML view (best quality rendering)
  // Other papers default to Annotate view
  useEffect(() => {
    if (item && ar5ivUrl) {
      setAr5ivMode(true);
      setReaderMode(false);
      setPdfMode(false);
    }
  }, [item, ar5ivUrl]);

  const loadItem = async () => {
    setLoading(true);
    try {
      const data = await getItem(id!);
      setItem(data.item as Item);
      setHighlights((data.highlights as Highlight[]) || []);
      setNotes((data.notes as Note[]) || []);
      setCitation((data.citation as Citation) || null);
      setRelatedItems((data.related as Item[]) || []);
      // Load tags
      try {
        const tagData = await getItemTags(id!);
        setTags(tagData.tags || []);
      } catch {
        setTags([]);
      }
    } catch {
      setItem(null);
    }
    setLoading(false);
  };

  const saveTitle = async () => {
    if (!item || !titleDraft.trim() || titleDraft === item.title) {
      setEditingTitle(false);
      return;
    }
    await updateItem(item.id, { title: titleDraft.trim() });
    setItem({ ...item, title: titleDraft.trim() });
    setEditingTitle(false);
  };

  const changeType = async (newType: string) => {
    if (!item || newType === item.type) return;
    await updateItem(item.id, { type: newType });
    setItem({ ...item, type: newType as Item["type"] });
  };

  const addTag = async () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || !item || tags.includes(t)) {
      setTagInput("");
      return;
    }
    const newTags = [...tags, t];
    setTags(newTags);
    setTagInput("");
    await setItemTags(item.id, newTags);
  };

  const removeTag = async (tag: string) => {
    if (!item) return;
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    await setItemTags(item.id, newTags);
  };

  const saveNote = async () => {
    if (!noteContent.trim() || !item) return;
    const result = await createNote({ item_id: item.id, content: noteContent });
    const newNote = (result as { note: Note }).note;
    setNotes((prev) => [newNote, ...prev]);
    setNoteContent("");
  };

  const updateStatus = async (status: Item["reading_status"]) => {
    if (!item) return;
    await updateItem(item.id, { reading_status: status });
    setItem({ ...item, reading_status: status });
  };

  const handleHighlightNote = useCallback(
    async (hl: Highlight, note: string) => {
      await updateHighlight(hl.id, { note });
      setHighlights((prev) =>
        prev.map((h) => (h.id === hl.id ? { ...h, note } : h))
      );
    },
    []
  );

  const handleJumpToHighlight = useCallback((hl: Highlight) => {
    const el = document.getElementById(`hl-${hl.id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Flash effect
      el.style.transition = "background-color 0.3s ease";
      const orig = el.style.backgroundColor;
      el.style.backgroundColor = "rgba(194, 65, 12, 0.2)";
      setTimeout(() => {
        el.style.backgroundColor = orig;
      }, 1200);
    }
  }, []);

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

  const handleCreateHighlight = useCallback(
    async (text: string, color: string, note?: string, context?: string) => {
      if (!item) return;
      try {
        const result = await createHighlight({
          item_id: item.id,
          text,
          color,
          note,
          context,
        });
        const hl = result.highlight as Highlight;
        setHighlights((prev) => [hl, ...prev]);
        setLastCreatedHighlightId(hl.id);
      } catch (e) {
        console.error("Failed to create highlight:", e);
      }
    },
    [item]
  );

  // Post-highlight note nudge — adds note to the most recently created highlight
  const handleNoteForLastHighlight = useCallback(
    async (note: string) => {
      if (!lastCreatedHighlightId) return;
      await updateHighlight(lastCreatedHighlightId, { note });
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === lastCreatedHighlightId ? { ...h, note } : h
        )
      );
      setLastCreatedHighlightId(null);
    },
    [lastCreatedHighlightId]
  );

  // Click on <mark> in reader → scroll margin card into view + open note editor
  const handleMarkClick = useCallback((hl: Highlight) => {
    const card = document.getElementById(`hl-card-${hl.id}`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    setEditingHighlightNote(hl.id);
    setHighlightNoteDraft(hl.note || "");
  }, []);

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

  const Icon = typeIcons[item.type] || Bookmark;

  return (
    <div ref={scrollContainerRef} className="reader-page" data-reader-scroll>
      {/* Top bar */}
      <div className="reader-topbar">
        <Link to="/" className="reader-back">
          <ArrowLeft size={14} />
          Library
        </Link>

        <div className="reader-topbar-actions">
          {/* View mode switcher */}
          <div className="flex gap-1.5 bg-bg-secondary rounded-card p-1">
            <button
              onClick={() => { setPdfMode(false); setReaderMode(false); setAr5ivMode(false); }}
              className={`reader-mode-toggle ${!pdfMode && !readerMode && !ar5ivMode ? "active" : ""}`}
            >
              Detail
            </button>
            {ar5ivUrl && (
              <button
                onClick={() => { setAr5ivMode(true); setPdfMode(false); setReaderMode(false); }}
                className={`reader-mode-toggle ${ar5ivMode ? "active" : ""}`}
              >
                <BookOpen size={13} />
                Read
              </button>
            )}
            {item.extracted_text && (
              <button
                onClick={() => { setPdfMode(false); setReaderMode(true); setAr5ivMode(false); }}
                className={`reader-mode-toggle ${!pdfMode && readerMode && !ar5ivMode ? "active" : ""}`}
              >
                <Highlighter size={13} />
                Annotate
              </button>
            )}
            {pdfUrl && (
              <button
                onClick={() => { setPdfMode(true); setReaderMode(false); setAr5ivMode(false); }}
                className={`reader-mode-toggle ${pdfMode ? "active" : ""}`}
              >
                <FileText size={13} />
                PDF
              </button>
            )}
          </div>

          {highlights.length > 0 && (
            <button
              onClick={() => setHighlightPanelOpen(!highlightPanelOpen)}
              className="reader-hl-toggle"
            >
              <Highlighter size={14} />
              {highlights.length}
            </button>
          )}

          {citation && (
            <button
              onClick={async () => {
                try {
                  const data = await exportBibtex(item.id);
                  await navigator.clipboard.writeText(data.bibtex);
                  // Brief visual feedback
                  const btn = document.getElementById("copy-cite-btn");
                  if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Cite"; }, 1500); }
                } catch { /* clipboard or API error */ }
              }}
              id="copy-cite-btn"
              className="reader-external-link"
              title="Copy BibTeX citation"
            >
              <Copy size={12} />
              Cite
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

      <div className="reader-body">
        {/* Main content column */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="reader-content-wrapper"
        >
          {/* Header */}
          <header className="reader-header">
            {item.cover_image_url ? (
              <img
                src={item.cover_image_url}
                alt={item.title}
                className="reader-cover"
              />
            ) : (
              <div className="reader-icon-wrap">
                <Icon size={20} className="text-text-tertiary" />
              </div>
            )}

            <div className="reader-header-text">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveTitle();
                      if (e.key === "Escape") setEditingTitle(false);
                    }}
                    className="reader-title bg-transparent border-b-2 border-accent/40
                               outline-none w-full"
                    autoFocus
                  />
                  <button onClick={saveTitle} className="p-1 text-accent hover:text-accent-hover">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditingTitle(false)} className="p-1 text-text-tertiary hover:text-text-primary">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <h1
                  className="reader-title cursor-pointer hover:text-accent transition-warm"
                  onClick={() => { setTitleDraft(item.title); setEditingTitle(true); }}
                  title="Click to edit"
                >
                  {item.title}
                </h1>
              )}

              <div className="reader-header-meta">
                {item.domain && <span className="reader-domain">{item.domain}</span>}
                <div className="flex flex-wrap gap-1">
                  {ITEM_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => changeType(t)}
                      className={`px-2 py-0.5 rounded-tag text-[11px] font-sans capitalize transition-warm
                                  ${item.type === t
                                    ? "bg-accent/10 text-accent font-medium"
                                    : "text-text-tertiary hover:text-text-secondary hover:bg-bg-secondary"
                                  }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-tag
                               bg-bg-secondary text-[11px] font-mono text-text-secondary group/tag"
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="opacity-0 group-hover/tag:opacity-100 transition-warm
                                 text-text-tertiary hover:text-red-500"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <form onSubmit={(e) => { e.preventDefault(); addTag(); }} className="inline-flex">
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="+ tag"
                    className="w-16 bg-transparent text-[11px] font-mono text-text-tertiary
                               outline-none placeholder:text-text-tertiary/50 focus:w-24 transition-all"
                  />
                </form>
              </div>

              <div className="reader-status-row">
                {(["to_read", "reading", "read"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(s)}
                    className={`reader-status-btn ${item.reading_status === s ? "active" : ""}`}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {/* ar5iv HTML mode — best quality for arXiv papers */}
          {ar5ivMode && ar5ivUrl && (
            <div className="mt-4 rounded-card overflow-hidden border border-border" style={{ height: "85vh" }}>
              <iframe
                src={ar5ivUrl}
                title={`${item.title} (ar5iv HTML)`}
                className="w-full h-full"
                style={{ border: "none" }}
              />
            </div>
          )}

          {/* PDF embed mode */}
          {pdfMode && pdfUrl && !ar5ivMode && (
            <div className="mt-4 rounded-card overflow-hidden border border-border" style={{ height: "80vh" }}>
              <iframe
                src={pdfUrl}
                title={`${item.title} PDF`}
                className="w-full h-full"
                style={{ border: "none" }}
              />
            </div>
          )}

          {/* Reader mode or detail view */}
          {!pdfMode && !ar5ivMode && readerMode && item.extracted_text ? (
            <ReaderView
              item={item}
              highlights={highlights}
              citation={citation}
              onHighlightClick={handleMarkClick}
              onCreateHighlight={handleCreateHighlight}
              onNoteForLastHighlight={handleNoteForLastHighlight}
            />
          ) : !pdfMode && !ar5ivMode ? (
            <>
              {citation && (
                <div className="reader-detail-citation">
                  <div className="text-sm text-text-secondary space-y-1">
                    {citation.authors && (
                      <p>
                        <span className="reader-detail-label">Authors</span>
                        {citation.authors.map((a) => a.name).join(", ")}
                      </p>
                    )}
                    {citation.year && (
                      <p><span className="reader-detail-label">Year</span>{citation.year}</p>
                    )}
                    {citation.venue && (
                      <p><span className="reader-detail-label">Venue</span>{citation.venue}</p>
                    )}
                    {citation.abstract && (
                      <p className="mt-2 text-text-secondary leading-relaxed">{citation.abstract}</p>
                    )}
                  </div>
                </div>
              )}

              {item.summary && (
                <section className="reader-section">
                  <h2 className="reader-section-heading">Summary</h2>
                  <p className="text-sm text-text-secondary leading-relaxed">{item.summary}</p>
                </section>
              )}
            </>
          ) : null}

          {/* Related items */}
          {relatedItems.length > 0 && (
            <section className="reader-section reader-related">
              <h2 className="reader-section-heading">Related</h2>
              <div className="reader-related-grid">
                {relatedItems.map((ri) => {
                  const RIcon = typeIcons[ri.type] || Bookmark;
                  return (
                    <Link key={ri.id} to={`/item/${ri.id}`} className="reader-related-card">
                      <div className="reader-related-icon">
                        <RIcon size={14} className="text-text-tertiary" />
                      </div>
                      <div className="reader-related-text">
                        <p className="reader-related-title">{ri.title}</p>
                        <p className="reader-related-domain">{ri.domain || ri.type}</p>
                      </div>
                      <ChevronRight size={12} className="text-text-tertiary" />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </motion.div>

        {/* Right margin — annotations column (Curius-style) */}
        <aside ref={marginRef} className="reader-margin">
          {/* Note input — rich text via TipTap */}
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
          {highlights.length > 0 && (() => {
            const hasPositions = Object.keys(hlPositions).length > 0;
            return (
            <>
              <div className="reader-margin-divider" />
              <div className="reader-margin-heading">
                Highlights ({highlights.length})
              </div>
              <div ref={hlContainerRef} style={{ position: "relative", minHeight: hasPositions ? Math.max(...Object.values(hlPositions), 0) + 100 : undefined }}>
              {highlights.map((hl) => (
                <div
                  key={hl.id}
                  id={`hl-card-${hl.id}`}
                  className="reader-margin-card reader-margin-card-hl group/hl"
                  data-color={hl.color}
                  onClick={() => handleJumpToHighlight(hl)}
                  onMouseEnter={() => {
                    const mark = document.getElementById(`hl-${hl.id}`);
                    if (mark) mark.classList.add("stoa-hl-active");
                  }}
                  onMouseLeave={() => {
                    const mark = document.getElementById(`hl-${hl.id}`);
                    if (mark) mark.classList.remove("stoa-hl-active");
                  }}
                  style={
                    hasPositions && hlPositions[hl.id] != null
                      ? { position: "absolute", top: hlPositions[hl.id], left: 0, right: 0, cursor: "pointer" }
                      : { cursor: "pointer" }
                  }
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
                      onClick={(e) => { e.stopPropagation(); handleDeleteHighlight(hl.id); }}
                      className="opacity-0 group-hover/hl:opacity-100 transition-warm
                                 text-text-tertiary hover:text-red-500 p-0.5"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
              </div>
            </>
            );
          })()}

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
              No annotations yet. Add a note above or highlight text in the reader.
            </p>
          )}
        </aside>
      </div>

      {/* Highlight panel (slide-over, kept for detailed editing) */}
      <HighlightPanel
        highlights={highlights}
        isOpen={highlightPanelOpen}
        onClose={() => setHighlightPanelOpen(false)}
        onJumpTo={handleJumpToHighlight}
        onAddNote={handleHighlightNote}
      />
    </div>
  );
}
