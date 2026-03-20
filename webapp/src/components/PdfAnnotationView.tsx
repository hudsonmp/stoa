/**
 * PdfAnnotationView — Native PDF embed + annotation sidebar.
 * PDF renders via browser's built-in viewer (left).
 * Notes + highlights for this item shown in sidebar (right).
 */

import { useState } from "react";
import { Send, BookOpen } from "lucide-react";
import type { Highlight, Note } from "@/lib/supabase";

interface PdfAnnotationViewProps {
  pdfUrl: string;
  highlights: Highlight[];
  notes: Note[];
  onCreateNote: (content: string) => void;
}

export default function PdfAnnotationView({
  pdfUrl,
  highlights,
  notes,
  onCreateNote,
}: PdfAnnotationViewProps) {
  const [noteText, setNoteText] = useState("");

  const handleSubmit = () => {
    if (!noteText.trim()) return;
    onCreateNote(noteText);
    setNoteText("");
  };

  return (
    <div className="pdf-split-view">
      {/* PDF — native browser embed */}
      <div className="pdf-split-main">
        <embed
          src={pdfUrl}
          type="application/pdf"
          className="pdf-split-embed"
        />
      </div>

      {/* Annotation sidebar */}
      <aside className="pdf-split-sidebar">
        <div className="pdf-sidebar-heading">Notes</div>

        {/* Note input */}
        <div className="pdf-sidebar-input">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note about this paper..."
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!noteText.trim()}
            className="pdf-sidebar-send"
            title="Save note (Cmd+Enter)"
          >
            <Send size={13} />
          </button>
        </div>

        {/* Highlights */}
        {highlights.length > 0 && (
          <>
            <div className="pdf-sidebar-divider" />
            <div className="pdf-sidebar-heading">
              Highlights ({highlights.length})
            </div>
            {highlights.map((hl) => (
              <div key={hl.id} className="pdf-sidebar-card">
                <p className="pdf-sidebar-quote">&ldquo;{hl.text}&rdquo;</p>
                {hl.note && <p className="pdf-sidebar-note">{hl.note}</p>}
                <span className="pdf-sidebar-time">
                  {new Date(hl.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Notes */}
        {notes.length > 0 && (
          <>
            <div className="pdf-sidebar-divider" />
            <div className="pdf-sidebar-heading">
              Notes ({notes.length})
            </div>
            {notes.map((n) => (
              <div key={n.id} className="pdf-sidebar-card">
                <div
                  className="pdf-sidebar-note-content"
                  dangerouslySetInnerHTML={{ __html: n.content }}
                />
                <span className="pdf-sidebar-time">
                  {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </>
        )}

        {highlights.length === 0 && notes.length === 0 && (
          <p className="pdf-sidebar-empty">
            No annotations yet. Add a note above while reading the PDF.
          </p>
        )}
      </aside>
    </div>
  );
}
