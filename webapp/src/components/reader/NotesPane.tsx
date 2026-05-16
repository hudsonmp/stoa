/**
 * NotesPane — right column of the 3-pane reader.
 *
 * Layout:
 *   Notes | Essay | Refs   🔗 LINKED <item title>
 *   ● <file path>   <N> words            Edit | Split | Preview
 *   ── editor body ────────────────────────────────────
 *   <N> words · <N> min read · <N> citations · saved Ns ago
 *
 * Scope for PR A: scaffold only. The editor body mounts NoteEditorV2 in the
 * Notes tab; Essay shows a placeholder; Refs lists highlights as cards.
 * Edit/Split/Preview tri-toggle and real word-count instrumentation land
 * in PR B (tasks #5, #6). Refs-tab full implementation in #7.
 *
 * Reading-time formula: words ÷ 238 (Brysbaert, 2019 — silent-reading rate
 * in adults, mean ~238 wpm across 190 studies).
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Link2 } from "lucide-react";
import NoteEditorV2 from "@/components/NoteEditorV2";
import type { Highlight, Note, Item } from "@/lib/supabase";

interface NotesPaneProps {
  item: Item;
  highlights: Highlight[];
  mainNoteId: string | null;
  mainNoteContent: string;
  onSaveNote: (content: string, tags: string[]) => Promise<Note | null>;
  saveState: "idle" | "saving" | "saved";
  lastSavedAt: number | null;
}

type Tab = "notes" | "essay" | "refs";
type EditMode = "edit" | "split" | "preview";

export default function NotesPane({
  item,
  highlights,
  mainNoteId,
  mainNoteContent,
  onSaveNote,
  saveState,
  lastSavedAt,
}: NotesPaneProps) {
  const [tab, setTab] = useState<Tab>("notes");
  const [mode, setMode] = useState<EditMode>("edit");

  const wordCount = useMemo(() => countWords(mainNoteContent), [mainNoteContent]);
  const readTime = Math.max(1, Math.round(wordCount / 238));
  const citationCount = useMemo(
    () => countCitations(mainNoteContent),
    [mainNoteContent]
  );

  const savedAgo = useSavedAgo(lastSavedAt);

  return (
    <aside
      className="reader-notes-pane"
      style={{
        width: 380,
        flexShrink: 0,
        background: "var(--bg-editor)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Tabs row + LINKED pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 12px 0",
          borderBottom: "1px solid var(--border)",
          fontFamily: '"DM Sans", system-ui, sans-serif',
          fontSize: 12,
        }}
      >
        <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
          Notes
        </TabButton>
        <TabButton active={tab === "essay"} onClick={() => setTab("essay")}>
          Essay
        </TabButton>
        <TabButton active={tab === "refs"} onClick={() => setTab("refs")}>
          Refs
        </TabButton>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            border: "1px solid var(--border)",
            borderRadius: 2,
            color: "var(--text-secondary)",
            fontSize: 11,
            maxWidth: 220,
            marginBottom: 6,
          }}
          title={item.title}
        >
          <Link2 size={11} className="text-text-tertiary" />
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 9,
              letterSpacing: "0.08em",
              color: "var(--text-tertiary)",
            }}
          >
            LINKED
          </span>
          <span
            style={{
              fontFamily: '"Newsreader", Georgia, serif',
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </span>
        </div>
      </div>

      {/* Status strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px",
          borderBottom: "1px solid var(--border-light)",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          color: "var(--text-tertiary)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: saveState === "saving" ? "var(--accent-amber)" : "var(--accent-green)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          stoa/notes/{(mainNoteId || "scratch").slice(0, 8)}.md
        </span>

        <span style={{ color: "var(--text-tertiary)" }}>|</span>
        <span>{wordCount} words</span>

        <div style={{ flex: 1 }} />

        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: tab === "notes" ? 0 : "16px 18px" }}>
        {tab === "notes" && (
          <NotesBody
            mainNoteId={mainNoteId}
            mainNoteContent={mainNoteContent}
            onSaveNote={onSaveNote}
            mode={mode}
          />
        )}
        {tab === "essay" && <EssayPlaceholder />}
        {tab === "refs" && <RefsList highlights={highlights} />}
      </div>

      {/* Footer status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          color: "var(--text-tertiary)",
          background: "var(--bg-primary)",
        }}
      >
        <span>
          {wordCount} words · {readTime} min read · {citationCount} citations
        </span>
        <span style={{ color: saveState === "saving" ? "var(--accent-amber)" : "var(--accent-green)" }}>
          {saveState === "saving" ? "saving…" : `saved ${savedAgo}`}
        </span>
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px 10px",
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        cursor: "pointer",
        fontWeight: active ? 600 : 500,
        fontSize: 13,
        fontFamily: '"DM Sans", system-ui, sans-serif',
      }}
    >
      {children}
    </button>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: EditMode;
  onChange: (m: EditMode) => void;
}) {
  const modes: EditMode[] = ["edit", "split", "preview"];
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 3,
        overflow: "hidden",
        fontFamily: '"DM Sans", system-ui, sans-serif',
        fontSize: 10,
      }}
    >
      {modes.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            padding: "2px 8px",
            background: mode === m ? "var(--bg-secondary)" : "transparent",
            color: mode === m ? "var(--text-primary)" : "var(--text-tertiary)",
            border: "none",
            cursor: "pointer",
            textTransform: "capitalize",
            fontWeight: mode === m ? 600 : 500,
          }}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function NotesBody({
  mainNoteId,
  mainNoteContent,
  onSaveNote,
  mode,
}: {
  mainNoteId: string | null;
  mainNoteContent: string;
  onSaveNote: (content: string, tags: string[]) => Promise<Note | null>;
  mode: EditMode;
}) {
  // PR A: mode is UI-only; full Split + Preview wired in PR B (#5).
  // Mounting NoteEditorV2 directly preserves all of: KaTeX, wikilinks,
  // footnotes, sidebar comments, source toggle from feat/editor-redesign.
  void mode;
  return (
    <NoteEditorV2
      content={mainNoteContent}
      projectNoteId={mainNoteId || undefined}
      onSave={(content) => {
        // Fire-and-forget; NoteEditorV2's onSave is synchronous-shaped.
        void onSaveNote(content, ["source-note"]);
      }}
      placeholder="Start writing — notes anchor to highlights and link to other notes."
    />
  );
}

function EssayPlaceholder() {
  return (
    <div
      style={{
        color: "var(--text-tertiary)",
        fontFamily: '"Newsreader", Georgia, serif',
        fontStyle: "italic",
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      Essay mode (Writings drafts) lands in a follow-up. Use Notes for reading
      marginalia and synthesis; Essay will host long-form drafts that pull
      citations from this item's Refs.
    </div>
  );
}

function RefsList({ highlights }: { highlights: Highlight[] }) {
  if (highlights.length === 0) {
    return (
      <div
        style={{
          color: "var(--text-tertiary)",
          fontFamily: '"Newsreader", Georgia, serif',
          fontStyle: "italic",
          fontSize: 13,
        }}
      >
        No highlights yet. Select text in the reader to start a passage anchor.
      </div>
    );
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {highlights.map((h) => (
        <li
          key={h.id}
          style={{
            padding: "10px 12px",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              fontFamily: '"Newsreader", Georgia, serif',
              color: "var(--text-primary)",
              borderLeft: `3px solid ${h.color || "var(--accent)"}`,
              paddingLeft: 10,
            }}
          >
            {h.text}
          </div>
          {h.note && (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "var(--text-secondary)",
                fontFamily: '"DM Sans", system-ui, sans-serif',
              }}
            >
              {h.note}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function countWords(text: string): number {
  return text
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function countCitations(html: string): number {
  // Approximate: count wikilinks [[X]] + mention nodes + footnotes
  const wikilinks = (html.match(/\[\[[^\]]+\]\]/g) || []).length;
  const mentions = (html.match(/data-type="mention"/g) || []).length;
  const footnotes = (html.match(/data-type="footnote"/g) || []).length;
  return wikilinks + mentions + footnotes;
}

function useSavedAgo(lastSavedAt: number | null): string {
  if (!lastSavedAt) return "—";
  const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return "a while ago";
}

// Suppress unused-Link warning while keeping the import handy for the Refs
// tab's per-item navigation work in PR B.
void Link;
