/**
 * PdfAnnotationView — Custom PDF renderer with highlight overlays.
 * Renders each page via react-pdf (PDF.js canvas), with a text layer
 * for selection. Select text → note input → creates highlight stored in Stoa.
 * Annotation sidebar on the right shows all notes/highlights.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Send } from "lucide-react";
import NoteEditor from "@/components/NoteEditor";
import type { Highlight, Note } from "@/lib/supabase";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfAnnotationViewProps {
  pdfUrl: string;
  highlights: Highlight[];
  notes: Note[];
  itemId: string;
  onCreateNote: (content: string, tags: string[]) => void;
}

export default function PdfAnnotationView({
  pdfUrl,
  highlights,
  notes,
  itemId,
  onCreateNote,
}: PdfAnnotationViewProps) {
  const [numPages, setNumPages] = useState(0);
  const [noteContent, setNoteContent] = useState("");
  const [pageWidth, setPageWidth] = useState(700);
  const [bookmarkPage, setBookmarkPage] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load saved bookmark
  useEffect(() => {
    const saved = localStorage.getItem(`stoa-bookmark:${itemId}`);
    if (saved) setBookmarkPage(parseInt(saved));
  }, [itemId]);

  // Track current page from scroll position
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const handleScroll = () => {
      const pageEls = scrollEl.querySelectorAll(".pdf-page-wrapper");
      const scrollTop = scrollEl.scrollTop + scrollEl.clientHeight / 3;
      for (let i = pageEls.length - 1; i >= 0; i--) {
        if ((pageEls[i] as HTMLElement).offsetTop <= scrollTop) {
          setCurrentPage(i + 1);
          break;
        }
      }
    };
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [numPages]);

  const saveBookmark = () => {
    setBookmarkPage(currentPage);
    localStorage.setItem(`stoa-bookmark:${itemId}`, String(currentPage));
  };

  const jumpToBookmark = () => {
    if (!bookmarkPage || !scrollRef.current) return;
    const pageEl = scrollRef.current.querySelectorAll(".pdf-page-wrapper")[bookmarkPage - 1];
    if (pageEl) pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Responsive page width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const available = containerRef.current.clientWidth - 300; // sidebar width
        setPageWidth(Math.min(Math.max(available - 40, 400), 900));
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  const handleSubmit = () => {
    const trimmed = noteContent.trim();
    if (!trimmed || trimmed === "<p></p>") return;
    onCreateNote(noteContent, ["synthesis", `ref:${itemId}`]);
    setNoteContent("");
  };

  return (
    <div ref={containerRef} className="pdf-split-view">
      {/* PDF pages rendered as canvas */}
      <div ref={scrollRef} className="pdf-pages-scroll">
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<div className="pdf-page-loading">Loading PDF...</div>}
          error={<div className="pdf-page-loading">Failed to load PDF</div>}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i + 1} className="pdf-page-wrapper">
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                renderTextLayer={true}
                renderAnnotationLayer={false}
              />
              <div className="pdf-page-num">{i + 1}</div>
            </div>
          ))}
        </Document>
      </div>

      {/* Annotation sidebar */}
      <aside className="pdf-split-sidebar">
        {/* Bookmark bar */}
        <div className="pdf-bookmark-bar">
          <span className="pdf-bookmark-page">Page {currentPage} / {numPages}</span>
          <button onClick={saveBookmark} className="pdf-bookmark-btn" title="Bookmark this page">
            📌 Bookmark
          </button>
          {bookmarkPage && (
            <button onClick={jumpToBookmark} className="pdf-bookmark-jump" title={`Jump to page ${bookmarkPage}`}>
              → p.{bookmarkPage}
            </button>
          )}
        </div>

        <div className="pdf-sidebar-divider" />
        <div className="pdf-sidebar-heading">Notes</div>

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
            title="Save note"
          >
            <Send size={13} />
          </button>
        </div>

        {highlights.length > 0 && (
          <>
            <div className="pdf-sidebar-divider" />
            <div className="pdf-sidebar-heading">Highlights ({highlights.length})</div>
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

        {notes.length > 0 && (
          <>
            <div className="pdf-sidebar-divider" />
            <div className="pdf-sidebar-heading">Notes ({notes.length})</div>
            {notes.map((n) => (
              <div key={n.id} className="pdf-sidebar-card">
                <div className="pdf-sidebar-note-content" dangerouslySetInnerHTML={{ __html: n.content }} />
                <span className="pdf-sidebar-time">
                  {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </>
        )}

        {highlights.length === 0 && notes.length === 0 && (
          <p className="pdf-sidebar-empty">No annotations yet.</p>
        )}
      </aside>
    </div>
  );
}
