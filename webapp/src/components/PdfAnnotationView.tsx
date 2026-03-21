/**
 * PdfAnnotationView — Native PDF embed + annotation sidebar.
 * PDF renders via browser's built-in viewer (left).
 * Notes + highlights for this item shown in sidebar (right).
 *
 * Notes created here are tagged with the source item (`ref:{item_id}`)
 * and carry the "synthesis" tag so they also appear on the /notes page.
 */

import { useState } from "react";
import { Send, BookOpen } from "lucide-react";
import NoteEditor from "@/components/NoteEditor";
import type { Highlight, Note } from "@/lib/supabase";

interface PdfAnnotationViewProps {
  pdfUrl: string;
  highlights: Highlight[];
  notes: Note[];
  /** item_id of the current PDF — used for source tagging */
  itemId: string;
  /** Called when a note is created; should POST to /notes with synthesis + ref tags */
  onCreateNote: (content: string, tags: string[]) => void;
}

export default function PdfAnnotationView({
  pdfUrl,
  highlights,
  notes,
  itemId,
  onCreateNote,
}: PdfAnnotationViewProps) {
  const [noteContent, setNoteContent] = useState("");

  const handleSubmit = () => {
    const trimmed = noteContent.trim();
    if (!trimmed || trimmed === "<p></p>") return;
    onCreateNote(noteContent, ["synthesis", `ref:${itemId}`]);
    setNoteContent("");
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

        {/* Rich-text note input via TipTap */}
        <div className="pdf-sidebar-input">
          <NoteEditor
            content={noteContent}
            onChange={setNoteContent}
            placeholder="Add a note about this paper..."
          />
          <button
            onClick={handleSubmit}
            disabled={!noteContent.trim() || noteContent === "<p></p>"}
            className="pdf-sidebar-send"
            title="Save note (also adds to Notes page)"
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
