/**
 * PdfAnnotationView — Annotatable PDF viewer using react-pdf-highlighter-extended.
 * Replaces the plain iframe PDF embed with a proper PDF.js viewer that supports
 * text selection → highlight creation with notes.
 */

import { useState, useCallback, useRef } from "react";
import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  MonitoredHighlightContainer,
  useHighlightContainerContext,
} from "react-pdf-highlighter-extended";
import type {
  Highlight as PdfHighlight,
  GhostHighlight,
  PdfSelection,
  PdfHighlighterUtils,
  ScaledPosition,
} from "react-pdf-highlighter-extended";


interface PdfAnnotationViewProps {
  pdfUrl: string;
  onCreateHighlight: (text: string, color: string, note?: string, position?: ScaledPosition) => void;
}

// Inner component for rendering each highlight
function HighlightRenderer() {
  const { highlight, isScrolledTo } = useHighlightContainerContext();
  return (
    <MonitoredHighlightContainer>
      <TextHighlight highlight={highlight} isScrolledTo={isScrolledTo} />
    </MonitoredHighlightContainer>
  );
}

export default function PdfAnnotationView({
  pdfUrl,
  onCreateHighlight,
}: PdfAnnotationViewProps) {
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [noteText, setNoteText] = useState("");
  const [pdfHighlights, setPdfHighlights] = useState<PdfHighlight[]>([]);
  const utilsRef = useRef<PdfHighlighterUtils | null>(null);
  let idCounter = useRef(0);

  const handleSelection = useCallback((sel: PdfSelection) => {
    setSelection(sel);
    setNoteText("");
  }, []);

  const handleSaveHighlight = useCallback(() => {
    if (!selection) return;
    const ghost = selection.makeGhostHighlight();
    const text = ghost.content.text || "";

    // Create a local PDF highlight for immediate rendering
    const newHl: PdfHighlight = {
      id: `local-${++idCounter.current}`,
      type: "text",
      position: ghost.position,
    };
    setPdfHighlights((prev) => [...prev, newHl]);

    // Send to parent for API persistence
    onCreateHighlight(text, "yellow", noteText || undefined, ghost.position);

    setSelection(null);
    setNoteText("");
    window.getSelection()?.removeAllRanges();
  }, [selection, noteText, onCreateHighlight]);

  const handleCancel = useCallback(() => {
    setSelection(null);
    setNoteText("");
    window.getSelection()?.removeAllRanges();
  }, []);

  return (
    <div className="pdf-annotation-container">
      <PdfLoader
        document={pdfUrl}
        beforeLoad={(progress) => (
          <div className="pdf-loading">
            Loading PDF... {progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0}%
          </div>
        )}
      >
        {(pdfDocument) => (
          <PdfHighlighter
            pdfDocument={pdfDocument}
            highlights={pdfHighlights}
            onSelection={handleSelection}
            enableAreaSelection={() => false}
            utilsRef={(utils) => { utilsRef.current = utils; }}
            selectionTip={
              <div className="pdf-selection-tip">
                <button onClick={handleSaveHighlight} className="pdf-selection-tip-btn">
                  Highlight
                </button>
              </div>
            }
            style={{ height: "85vh" }}
          >
            <HighlightRenderer />
          </PdfHighlighter>
        )}
      </PdfLoader>

      {/* Note input modal when text is selected */}
      {selection && (
        <div className="pdf-annotation-tip" onClick={handleCancel}>
          <div className="pdf-annotation-tip-inner" onClick={(e) => e.stopPropagation()}>
            <p className="pdf-annotation-tip-text">
              &ldquo;{(selection.content.text || "").slice(0, 120)}
              {(selection.content.text || "").length > 120 ? "..." : ""}&rdquo;
            </p>
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a thought..."
              className="pdf-annotation-tip-input"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveHighlight();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <div className="pdf-annotation-tip-actions">
              <button onClick={handleSaveHighlight} className="pdf-annotation-tip-save">
                Save
              </button>
              <button onClick={handleCancel} className="pdf-annotation-tip-cancel">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
