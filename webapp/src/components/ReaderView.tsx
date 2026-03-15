import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Item, Highlight, Citation } from "@/lib/supabase";
import SelectionToolbar, { type HighlightColor } from "./SelectionToolbar";

// --- Reading time calculation ---
function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 238)); // 238 wpm average
}

/** Detect if text is markdown (has headers, bold, lists, etc.) */
function isMarkdown(text: string): boolean {
  return /^#{1,6} /m.test(text) || /\*\*.+\*\*/m.test(text) || /^[-*] /m.test(text) || /\|.+\|/m.test(text);
}

// --- Props ---
interface ReaderViewProps {
  item: Item;
  highlights: Highlight[];
  citation: Citation | null;
  onHighlightClick?: (hl: Highlight) => void;
  onCreateHighlight?: (text: string, color: HighlightColor, note?: string, context?: string) => void;
  onNoteForLastHighlight?: (note: string) => void;
}

export default function ReaderView({
  item,
  highlights,
  citation,
  onHighlightClick,
  onCreateHighlight,
  onNoteForLastHighlight,
}: ReaderViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  const text = item.extracted_text || "";
  const hasMarkdown = useMemo(() => isMarkdown(text), [text]);
  const readingTime = useMemo(() => estimateReadingTime(text), [text]);
  const isTwoColumn = (item.metadata as Record<string, unknown>)?.is_two_column === true;

  // --- Scroll progress tracking ---
  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    const el = contentRef.current.closest("[data-reader-scroll]");
    if (!el) return;
    const scrollable = el as HTMLElement;
    const scrollTop = scrollable.scrollTop;
    const scrollHeight = scrollable.scrollHeight - scrollable.clientHeight;
    if (scrollHeight <= 0) {
      setProgress(100);
      return;
    }
    setProgress(Math.min(100, Math.round((scrollTop / scrollHeight) * 100)));
  }, []);

  useEffect(() => {
    const scrollParent = contentRef.current?.closest("[data-reader-scroll]");
    if (!scrollParent) return;
    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // initial
    return () => scrollParent.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const handleHighlightClick = useCallback(
    (hl: Highlight) => {
      onHighlightClick?.(hl);
    },
    [onHighlightClick]
  );

  const handleToolbarHighlight = useCallback(
    (selectedText: string, color: HighlightColor, note?: string, context?: string) => {
      onCreateHighlight?.(selectedText, color, note, context);
    },
    [onCreateHighlight]
  );

  return (
    <div ref={contentRef} className="reader-view">
      {/* Progress bar - thin line at top */}
      <div className="reader-progress-track">
        <motion.div
          className="reader-progress-bar"
          style={{ width: `${progress}%` }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        />
      </div>

      {/* Citation metadata block for papers */}
      {citation && (
        <div className="reader-citation">
          {citation.authors && citation.authors.length > 0 && (
            <p className="reader-citation-authors">
              {citation.authors.map((a) => a.name).join(", ")}
            </p>
          )}
          <div className="reader-citation-meta">
            {citation.year && <span>{citation.year}</span>}
            {citation.venue && (
              <>
                {citation.year && <span className="reader-citation-sep">/</span>}
                <span>{citation.venue}</span>
              </>
            )}
            {citation.doi && (
              <>
                <span className="reader-citation-sep">/</span>
                <a
                  href={`https://doi.org/${citation.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="reader-citation-doi"
                >
                  {citation.doi}
                </a>
              </>
            )}
          </div>
          {citation.abstract && (
            <details className="reader-citation-abstract">
              <summary>Abstract</summary>
              <p>{citation.abstract}</p>
            </details>
          )}
        </div>
      )}

      {/* Reading time */}
      <div className="reader-meta">
        <span className="reader-reading-time">
          {readingTime} min read
        </span>
        {highlights.length > 0 && (
          <span className="reader-highlight-count">
            {highlights.length} highlight{highlights.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Body text — position: relative for toolbar positioning */}
      <div ref={bodyRef} className={`reader-text-content${isTwoColumn ? " reader-two-column" : ""}`} style={{ position: "relative" }}>
        {text ? (
          hasMarkdown ? (
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
          ) : (
            text.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p.replace(/\n/g, " ").trim()}</p>
            ))
          )
        ) : (
          <p className="reader-empty">
            No extracted text available for this item.
          </p>
        )}

        {/* Selection toolbar — renders inside body for correct positioning */}
        {onCreateHighlight && (
          <SelectionToolbar
            containerRef={bodyRef}
            onHighlight={handleToolbarHighlight}
            onNoteForLastHighlight={onNoteForLastHighlight}
          />
        )}
      </div>
    </div>
  );
}
