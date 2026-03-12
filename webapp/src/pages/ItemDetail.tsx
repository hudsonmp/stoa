import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Item, Highlight, Note, Citation } from "@/lib/supabase";
import NoteEditor from "@/components/NoteEditor";
import ReaderView from "@/components/ReaderView";
import HighlightPanel from "@/components/HighlightPanel";

const typeIcons: Record<string, typeof BookOpen> = {
  book: BookOpen,
  blog: FileText,
  paper: FileText,
  podcast: Headphones,
  page: Globe,
  tweet: MessageCircle,
  video: Video,
};

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

  useEffect(() => {
    if (!id) return;
    loadItem();
  }, [id]);

  // Auto-enter reader mode if there's extracted text
  useEffect(() => {
    if (item?.extracted_text && item.extracted_text.length > 200) {
      setReaderMode(true);
    }
  }, [item]);

  const loadItem = async () => {
    setLoading(true);
    const [itemRes, hlRes, noteRes, citRes] = await Promise.all([
      supabase.from("items").select("*").eq("id", id).single(),
      supabase
        .from("highlights")
        .select("*")
        .eq("item_id", id)
        .order("created_at"),
      supabase
        .from("notes")
        .select("*")
        .eq("item_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("citations").select("*").eq("item_id", id).single(),
    ]);

    const loadedItem = itemRes.data as Item | null;
    setItem(loadedItem);
    setHighlights((hlRes.data as Highlight[]) || []);
    setNotes((noteRes.data as Note[]) || []);
    setCitation(citRes.data as Citation | null);

    // Load related items (same type, excluding current)
    if (loadedItem) {
      const { data: related } = await supabase
        .from("items")
        .select("*")
        .eq("type", loadedItem.type)
        .neq("id", loadedItem.id)
        .order("created_at", { ascending: false })
        .limit(4);
      setRelatedItems((related as Item[]) || []);
    }

    setLoading(false);
  };

  const saveNote = async () => {
    if (!noteContent.trim() || !item) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("notes").insert({
      user_id: user?.id,
      item_id: item.id,
      content: noteContent,
    });
    setNoteContent("");
    loadItem();
  };

  const updateStatus = async (status: Item["reading_status"]) => {
    if (!item) return;
    await supabase.from("items").update({ reading_status: status }).eq("id", item.id);
    setItem({ ...item, reading_status: status });
  };

  const handleHighlightNote = useCallback(
    async (hl: Highlight, note: string) => {
      await supabase.from("highlights").update({ note }).eq("id", hl.id);
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
    <div className="reader-page" data-reader-scroll>
      {/* Top bar */}
      <div className="reader-topbar">
        <Link to="/" className="reader-back">
          <ArrowLeft size={14} />
          Library
        </Link>

        <div className="reader-topbar-actions">
          {item.extracted_text && (
            <button
              onClick={() => setReaderMode(!readerMode)}
              className={`reader-mode-toggle ${readerMode ? "active" : ""}`}
            >
              <BookOpen size={14} />
              {readerMode ? "Detail view" : "Reader view"}
            </button>
          )}

          {highlights.length > 0 && (
            <button
              onClick={() => setHighlightPanelOpen(!highlightPanelOpen)}
              className="reader-hl-toggle"
            >
              <Highlighter size={14} />
              {highlights.length}
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
            <h1 className="reader-title">{item.title}</h1>

            <div className="reader-header-meta">
              {item.domain && (
                <span className="reader-domain">{item.domain}</span>
              )}
              <span className="reader-type">{item.type}</span>
            </div>

            {/* Status controls */}
            <div className="reader-status-row">
              {(["to_read", "reading", "read"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  className={`reader-status-btn ${
                    item.reading_status === s ? "active" : ""
                  }`}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Reader mode: clean typography view */}
        {readerMode && item.extracted_text ? (
          <ReaderView
            item={item}
            highlights={highlights}
            citation={citation}
            onHighlightClick={(hl) => {
              setHighlightPanelOpen(true);
            }}
          />
        ) : (
          <>
            {/* Citation info */}
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
                    <p>
                      <span className="reader-detail-label">Year</span>
                      {citation.year}
                    </p>
                  )}
                  {citation.venue && (
                    <p>
                      <span className="reader-detail-label">Venue</span>
                      {citation.venue}
                    </p>
                  )}
                  {citation.abstract && (
                    <p className="mt-2 text-text-secondary leading-relaxed">
                      {citation.abstract}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Summary */}
            {item.summary && (
              <section className="reader-section">
                <h2 className="reader-section-heading">Summary</h2>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {item.summary}
                </p>
              </section>
            )}

            {/* Highlights inline */}
            {highlights.length > 0 && (
              <section className="reader-section">
                <h2 className="reader-section-heading">Highlights</h2>
                <div className="space-y-3">
                  {highlights.map((hl) => (
                    <div
                      key={hl.id}
                      className="reader-inline-highlight"
                      style={{
                        borderLeftColor:
                          (
                            {
                              yellow: "#F59E0B",
                              green: "#10B981",
                              blue: "#3B82F6",
                              pink: "#EC4899",
                              purple: "#8B5CF6",
                            } as Record<string, string>
                          )[hl.color] || "#F59E0B",
                      }}
                    >
                      <p className="text-sm text-text-primary leading-relaxed italic font-serif">
                        &ldquo;{hl.text}&rdquo;
                      </p>
                      {hl.note && (
                        <p className="text-[12px] text-text-secondary mt-1">
                          {hl.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* Notes section (always visible) */}
        <section className="reader-section reader-notes-section">
          <h2 className="reader-section-heading">Notes</h2>

          {notes.length > 0 && (
            <div className="space-y-3 mb-4">
              {notes.map((n) => (
                <div
                  key={n.id}
                  className="reader-note-card"
                  dangerouslySetInnerHTML={{ __html: n.content }}
                />
              ))}
            </div>
          )}

          <NoteEditor
            content={noteContent}
            onChange={setNoteContent}
            placeholder="Add a note about this item..."
          />
          {noteContent.trim() && (
            <button onClick={saveNote} className="reader-save-note-btn">
              Save Note
            </button>
          )}
        </section>

        {/* Related items */}
        {relatedItems.length > 0 && (
          <section className="reader-section reader-related">
            <h2 className="reader-section-heading">Related</h2>
            <div className="reader-related-grid">
              {relatedItems.map((ri) => {
                const RIcon = typeIcons[ri.type] || Bookmark;
                return (
                  <Link
                    key={ri.id}
                    to={`/item/${ri.id}`}
                    className="reader-related-card"
                  >
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

      {/* Highlight panel */}
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
