/**
 * PdfAnnotationView — Clean PDF viewer that blends with the site theme.
 * Renders each page as a canvas using react-pdf, with text layer for selection.
 * Select text → floating note input → creates highlight.
 * No ugly external PDF viewer chrome — just pages flowing like content.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Send } from "lucide-react";

// PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfAnnotationViewProps {
  pdfUrl: string;
  onCreateHighlight: (text: string, color: string, note?: string) => void;
}

export default function PdfAnnotationView({
  pdfUrl,
  onCreateHighlight,
}: PdfAnnotationViewProps) {
  const [numPages, setNumPages] = useState(0);
  const [selectedText, setSelectedText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [tipPosition, setTipPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  // Listen for text selection in the PDF pages
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const text = selection.toString().trim();
      if (text.length < 3) return;

      // Check selection is within our container
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;

      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      setSelectedText(text);
      setTipPosition({
        top: rect.bottom - containerRect.top + container.scrollTop + 8,
        left: rect.left - containerRect.left + rect.width / 2 - 150,
      });
      setNoteText("");
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Focus note input when tip appears
  useEffect(() => {
    if (tipPosition && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [tipPosition]);

  const handleSubmit = useCallback(() => {
    if (!selectedText) return;
    onCreateHighlight(selectedText, "yellow", noteText.trim() || undefined);
    setSelectedText("");
    setTipPosition(null);
    setNoteText("");
    window.getSelection()?.removeAllRanges();
  }, [selectedText, noteText, onCreateHighlight]);

  const handleDismiss = useCallback(() => {
    setSelectedText("");
    setTipPosition(null);
    setNoteText("");
  }, []);

  return (
    <div
      ref={containerRef}
      className="pdf-clean-viewer"
      onClick={(e) => {
        // Dismiss tip if clicking outside it
        if (tipPosition && !(e.target as HTMLElement).closest(".pdf-note-tip")) {
          handleDismiss();
        }
      }}
    >
      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={<div className="pdf-clean-loading">Loading PDF...</div>}
        error={<div className="pdf-clean-error">Failed to load PDF</div>}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div key={i + 1} className="pdf-clean-page">
            <Page
              pageNumber={i + 1}
              width={Math.min(800, window.innerWidth - 400)}
              renderTextLayer={true}
              renderAnnotationLayer={false}
            />
            <div className="pdf-page-number">{i + 1}</div>
          </div>
        ))}
      </Document>

      {/* Floating note input at selection position */}
      {tipPosition && selectedText && (
        <div
          className="pdf-note-tip"
          style={{ top: tipPosition.top, left: Math.max(0, tipPosition.left) }}
        >
          <div className="pdf-note-tip-quote">
            &ldquo;{selectedText.slice(0, 80)}{selectedText.length > 80 ? "..." : ""}&rdquo;
          </div>
          <div className="pdf-note-tip-row">
            <input
              ref={noteInputRef}
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a thought..."
              className="pdf-note-tip-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") handleDismiss();
              }}
            />
            <button onClick={handleSubmit} className="pdf-note-tip-send" title="Save">
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
