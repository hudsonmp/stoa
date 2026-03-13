import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import type { Item, Highlight, Citation } from "@/lib/supabase";
import SelectionToolbar, { type HighlightColor } from "./SelectionToolbar";

// --- Highlight colors matching design system ---
const HIGHLIGHT_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  yellow: { bg: "#FEF3C7", border: "#F59E0B", label: "Yellow" },
  green:  { bg: "#D1FAE5", border: "#10B981", label: "Green" },
  blue:   { bg: "#DBEAFE", border: "#3B82F6", label: "Blue" },
  pink:   { bg: "#FCE7F3", border: "#EC4899", label: "Pink" },
  purple: { bg: "#EDE9FE", border: "#8B5CF6", label: "Purple" },
};

// --- Reading time calculation ---
function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 238)); // 238 wpm average
}

// --- Text processing: convert plain extracted_text to rendered paragraphs ---
function processText(raw: string): string[] {
  return raw
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);
}

// --- Highlight overlay logic ---
function renderParagraphWithHighlights(
  text: string,
  highlights: Highlight[],
  onHighlightClick: (hl: Highlight) => void
): React.ReactNode {
  // Find highlights that appear in this paragraph
  const matches: { start: number; end: number; hl: Highlight }[] = [];
  for (const hl of highlights) {
    const idx = text.indexOf(hl.text);
    if (idx !== -1) {
      matches.push({ start: idx, end: idx + hl.text.length, hl });
    }
  }

  if (matches.length === 0) return text;

  // Sort by start position, merge overlaps
  matches.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const m of matches) {
    if (m.start > cursor) {
      parts.push(text.slice(cursor, m.start));
    }
    const color = HIGHLIGHT_COLORS[m.hl.color] || HIGHLIGHT_COLORS.yellow;
    parts.push(
      <mark
        key={m.hl.id}
        id={`hl-${m.hl.id}`}
        onClick={() => onHighlightClick(m.hl)}
        style={{
          backgroundColor: color.bg,
          borderBottom: `2px solid ${color.border}`,
          borderRadius: "2px",
          padding: "1px 2px",
          cursor: "pointer",
          transition: "background-color 0.15s ease",
        }}
        title={m.hl.note || undefined}
      >
        {text.slice(m.start, m.end)}
      </mark>
    );
    cursor = m.end;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
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
  const paragraphs = useMemo(() => processText(text), [text]);
  const readingTime = useMemo(() => estimateReadingTime(text), [text]);

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
      <div ref={bodyRef} className="reader-body" style={{ position: "relative" }}>
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => (
            <p key={i}>
              {renderParagraphWithHighlights(p, highlights, handleHighlightClick)}
            </p>
          ))
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
