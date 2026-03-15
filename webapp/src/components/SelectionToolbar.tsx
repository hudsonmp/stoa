/**
 * SelectionToolbar — Floating note input for text selection in the reader.
 *
 * Simplified: selecting text shows a single input. Type a thought and press
 * Enter (or click submit) to create a yellow highlight with the note attached.
 * Press Enter with an empty input to create a highlight with no note.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send } from "lucide-react";

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";

interface SelectionToolbarProps {
  /** Called to create a highlight (with optional note + context) */
  onHighlight: (text: string, color: HighlightColor, note?: string, context?: string) => void;
  /** Called to add a note to the most recently created highlight (post-highlight nudge) */
  onNoteForLastHighlight?: (note: string) => void;
  /** Ref to the container where text selection should be monitored */
  containerRef: React.RefObject<HTMLElement | null>;
}

export default function SelectionToolbar({
  onHighlight,
  containerRef,
}: SelectionToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState("");
  const [selectedContext, setSelectedContext] = useState("");
  const [noteText, setNoteText] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
    setNoteText("");
    setSelectedText("");
    setSelectedContext("");
  }, []);

  // Listen for text selection within the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setTimeout(() => {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed) dismiss();
        }, 150);
        return;
      }

      const text = selection.toString().trim();
      if (text.length < 3) {
        dismiss();
        return;
      }

      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        dismiss();
        return;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const TOOLBAR_HEIGHT = 50;
      const TOOLBAR_WIDTH = 300;
      const GAP = 10;

      // Position above the selection by default
      let top = rect.top - containerRect.top - TOOLBAR_HEIGHT - GAP;
      let left = rect.left - containerRect.left + rect.width / 2 - TOOLBAR_WIDTH / 2;

      // If toolbar would go above the container, place it below the selection instead
      if (rect.top - TOOLBAR_HEIGHT - GAP < 0) {
        top = rect.bottom - containerRect.top + GAP;
      }

      // Clamp horizontal position to stay within the container
      left = Math.max(0, Math.min(left, containerRect.width - TOOLBAR_WIDTH));

      setPosition({ top, left });

      // Capture paragraph context (W3C TextQuoteSelector pattern)
      const ancestor = range.commonAncestorContainer;
      const paragraph = ancestor.nodeType === Node.TEXT_NODE
        ? ancestor.parentElement?.closest("p") || ancestor.parentElement
        : (ancestor as HTMLElement).closest?.("p") || ancestor;
      const ctx = (paragraph as HTMLElement)?.textContent?.substring(0, 500) || "";

      setSelectedText(text);
      setSelectedContext(ctx);
      setVisible(true);
      setNoteText("");
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [containerRef, dismiss]);

  // Keyboard shortcut: Escape to dismiss
  useEffect(() => {
    if (!visible) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismiss();
        window.getSelection()?.removeAllRanges();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [visible, dismiss]);

  // Focus note input when toolbar appears
  useEffect(() => {
    if (visible && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [visible]);

  const handleSubmit = () => {
    onHighlight(
      selectedText,
      "yellow",
      noteText.trim() || undefined,
      selectedContext || undefined
    );
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="stoa-selection-toolbar"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <div className="stoa-st-note-row">
        <input
          ref={noteInputRef}
          type="text"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a thought..."
          className="stoa-st-note-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") dismiss();
          }}
        />
        <button
          className="stoa-st-submit"
          onClick={handleSubmit}
          title="Highlight (Enter)"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
