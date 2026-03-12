import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, MessageSquare, ChevronRight } from "lucide-react";
import type { Highlight } from "@/lib/supabase";

const HIGHLIGHT_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  yellow: { bg: "#FEF3C7", border: "#F59E0B", label: "Yellow" },
  green:  { bg: "#D1FAE5", border: "#10B981", label: "Green" },
  blue:   { bg: "#DBEAFE", border: "#3B82F6", label: "Blue" },
  pink:   { bg: "#FCE7F3", border: "#EC4899", label: "Pink" },
  purple: { bg: "#EDE9FE", border: "#8B5CF6", label: "Purple" },
};

interface HighlightPanelProps {
  highlights: Highlight[];
  isOpen: boolean;
  onClose: () => void;
  onJumpTo: (hl: Highlight) => void;
  onAddNote: (hl: Highlight, note: string) => void;
}

export default function HighlightPanel({
  highlights,
  isOpen,
  onClose,
  onJumpTo,
  onAddNote,
}: HighlightPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [filterColor, setFilterColor] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = highlights;
    if (filterColor) {
      result = result.filter((h) => h.color === filterColor);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (h) =>
          h.text.toLowerCase().includes(q) ||
          (h.note && h.note.toLowerCase().includes(q))
      );
    }
    return result;
  }, [highlights, searchQuery, filterColor]);

  const startEditNote = (hl: Highlight) => {
    setEditingNoteId(hl.id);
    setNoteText(hl.note || "");
  };

  const saveNote = (hl: Highlight) => {
    onAddNote(hl, noteText);
    setEditingNoteId(null);
    setNoteText("");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.aside
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="highlight-panel"
          >
            {/* Header */}
            <div className="highlight-panel-header">
              <h2>
                Highlights
                <span className="highlight-panel-count">{highlights.length}</span>
              </h2>
              <button
                onClick={onClose}
                className="highlight-panel-close"
                aria-label="Close highlights panel"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search */}
            <div className="highlight-panel-search">
              <Search size={14} className="highlight-panel-search-icon" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search highlights..."
                className="highlight-panel-search-input"
              />
            </div>

            {/* Color filter chips */}
            <div className="highlight-panel-filters">
              <button
                onClick={() => setFilterColor(null)}
                className={`highlight-filter-chip ${filterColor === null ? "active" : ""}`}
              >
                All
              </button>
              {Object.entries(HIGHLIGHT_COLORS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setFilterColor(filterColor === key ? null : key)}
                  className={`highlight-filter-chip ${filterColor === key ? "active" : ""}`}
                >
                  <span
                    className="highlight-filter-dot"
                    style={{ backgroundColor: val.border }}
                  />
                  {val.label}
                </button>
              ))}
            </div>

            {/* Highlight list */}
            <div className="highlight-panel-list">
              {filtered.length === 0 && (
                <p className="highlight-panel-empty">
                  {searchQuery
                    ? "No highlights match your search."
                    : "No highlights yet."}
                </p>
              )}

              {filtered.map((hl) => {
                const color = HIGHLIGHT_COLORS[hl.color] || HIGHLIGHT_COLORS.yellow;
                return (
                  <motion.div
                    key={hl.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="highlight-card"
                    style={{ borderLeftColor: color.border }}
                  >
                    {/* Highlight text */}
                    <button
                      onClick={() => onJumpTo(hl)}
                      className="highlight-card-text"
                    >
                      <span>&ldquo;{hl.text}&rdquo;</span>
                      <ChevronRight size={12} className="highlight-card-jump" />
                    </button>

                    {/* Note display / edit */}
                    {editingNoteId === hl.id ? (
                      <div className="highlight-card-note-edit">
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Write a note..."
                          rows={3}
                          autoFocus
                          className="highlight-card-note-textarea"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              saveNote(hl);
                            }
                            if (e.key === "Escape") {
                              setEditingNoteId(null);
                            }
                          }}
                        />
                        <div className="highlight-card-note-actions">
                          <button
                            onClick={() => setEditingNoteId(null)}
                            className="highlight-card-note-cancel"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveNote(hl)}
                            className="highlight-card-note-save"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="highlight-card-note-row">
                        {hl.note ? (
                          <p
                            className="highlight-card-note-text"
                            onClick={() => startEditNote(hl)}
                          >
                            {hl.note}
                          </p>
                        ) : (
                          <button
                            onClick={() => startEditNote(hl)}
                            className="highlight-card-add-note"
                          >
                            <MessageSquare size={12} />
                            Add note
                          </button>
                        )}
                      </div>
                    )}

                    {/* Timestamp */}
                    <time className="highlight-card-time">
                      {new Date(hl.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year:
                          new Date(hl.created_at).getFullYear() !==
                          new Date().getFullYear()
                            ? "numeric"
                            : undefined,
                      })}
                    </time>
                  </motion.div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
