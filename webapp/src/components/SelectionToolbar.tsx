/**
 * SelectionToolbar — Floating annotation toolbar for text selection in the reader.
 *
 * Interaction-first design grounded in ICAP framework (Chi & Wylie 2014):
 * The biggest learning jump is Active → Constructive. After highlighting
 * (Active), the toolbar transitions to a note prompt (Constructive nudge)
 * rather than dismissing immediately. Users can skip or type a thought.
 *
 * Three modes:
 * - "actions": Primary [Highlight] [Note] buttons + secondary color dots
 * - "note": Note-first flow — write thought, pick color, creates highlight+note
 * - "prompted": Post-highlight nudge — highlight already created, note prompt shown
 */

import { useState, useRef, useEffect, useCallback } from "react";

const COLORS = [
  { name: "yellow", bg: "#FEF3C7", solid: "#F59E0B" },
  { name: "green", bg: "#D1FAE5", solid: "#10B981" },
  { name: "blue", bg: "#DBEAFE", solid: "#3B82F6" },
  { name: "pink", bg: "#FCE7F3", solid: "#EC4899" },
  { name: "purple", bg: "#EDE9FE", solid: "#8B5CF6" },
] as const;

export type HighlightColor = (typeof COLORS)[number]["name"];

type ToolbarMode = "actions" | "note" | "prompted";

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
  onNoteForLastHighlight,
  containerRef,
}: SelectionToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState("");
  const [selectedContext, setSelectedContext] = useState("");
  const [mode, setMode] = useState<ToolbarMode>("actions");
  const [activeColor, setActiveColor] = useState<HighlightColor>("yellow");
  const [noteText, setNoteText] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
    setMode("actions");
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

      setPosition({
        top: rect.top - containerRect.top - 48,
        left: rect.left - containerRect.left + rect.width / 2 - 120,
      });

      // Capture paragraph context (W3C TextQuoteSelector pattern)
      const ancestor = range.commonAncestorContainer;
      const paragraph = ancestor.nodeType === Node.TEXT_NODE
        ? ancestor.parentElement?.closest("p") || ancestor.parentElement
        : (ancestor as HTMLElement).closest?.("p") || ancestor;
      const ctx = (paragraph as HTMLElement)?.textContent?.substring(0, 500) || "";

      setSelectedText(text);
      setSelectedContext(ctx);
      setVisible(true);
      setMode("actions");
      setNoteText("");
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [containerRef, dismiss]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!visible) return;

    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") {
          if (mode === "note") {
            setMode("actions");
            setNoteText("");
          } else if (mode === "prompted") {
            dismiss();
          }
        }
        return;
      }

      if (mode !== "actions") return;

      if (e.key === "Escape") {
        dismiss();
        window.getSelection()?.removeAllRanges();
        return;
      }

      // h for highlight with active color → transitions to note prompt
      if (e.key === "h") {
        e.preventDefault();
        doHighlight(activeColor);
        return;
      }

      // 1-5 for instant color highlight (power user shortcut)
      if (e.key >= "1" && e.key <= "5") {
        const color = COLORS[parseInt(e.key) - 1].name;
        setActiveColor(color);
        doHighlight(color);
        return;
      }

      // n for note-first mode
      if (e.key === "n") {
        e.preventDefault();
        setMode("note");
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [visible, mode, selectedText, selectedContext, activeColor, onHighlight, dismiss]);

  // Focus note input when entering note or prompted mode
  useEffect(() => {
    if ((mode === "note" || mode === "prompted") && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [mode]);

  // Core action: create highlight and transition to note prompt
  const doHighlight = useCallback(
    (color: HighlightColor) => {
      onHighlight(selectedText, color, undefined, selectedContext || undefined);
      window.getSelection()?.removeAllRanges();
      setMode("prompted");
    },
    [selectedText, selectedContext, onHighlight]
  );

  // Save note in note-first mode (creates highlight+note together)
  const handleNoteFirstSave = (color: HighlightColor = activeColor) => {
    onHighlight(selectedText, color, noteText || undefined, selectedContext || undefined);
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  // Save note in post-highlight prompted mode (updates existing highlight)
  const handlePromptedSave = () => {
    if (noteText.trim() && onNoteForLastHighlight) {
      onNoteForLastHighlight(noteText.trim());
    }
    dismiss();
  };

  if (!visible) return null;

  const activeColorObj = COLORS.find((c) => c.name === activeColor) || COLORS[0];

  return (
    <div
      ref={toolbarRef}
      className="stoa-selection-toolbar"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      {/* Color dots — click to highlight immediately */}
      <div className="stoa-st-color-row">
        {COLORS.map((c, i) => (
          <button
            key={c.name}
            className={`stoa-st-dot${activeColor === c.name ? " active" : ""}`}
            style={{ backgroundColor: c.solid }}
            onClick={() => {
              setActiveColor(c.name);
              doHighlight(c.name);
            }}
            title={`${c.name} (${i + 1})`}
          />
        ))}
      </div>

      {/* Note input — always visible below colors */}
      <div className="stoa-st-note-row">
        <input
          ref={noteInputRef}
          type="text"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder={mode === "prompted" ? "Add a thought..." : "Note (optional)"}
          className="stoa-st-note-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (mode === "prompted") {
                handlePromptedSave();
              } else {
                handleNoteFirstSave();
              }
            }
            if (e.key === "Escape") dismiss();
          }}
        />
        {mode === "prompted" && (
          <button
            className="stoa-st-skip"
            onClick={dismiss}
            title="Skip (Esc)"
          >
            ✓
          </button>
        )}
      </div>
    </div>
  );
}
