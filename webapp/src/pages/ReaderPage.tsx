/**
 * ReaderPage — the 3-pane web reader at `/read/:id`.
 *
 * Replaces the old fullscreen-on-PDF behavior of ItemDetail.tsx with a
 * Library | PDF | Notes layout that matches Hudson's target screenshot.
 *
 * Routing decision: `/item/:id` (ItemDetail.tsx, untouched) remains the
 * metadata/admin view — type/status/tags editing, related grid, citation
 * exports, type-switching. `/read/:id` (this file) is the focused reading
 * experience. ItemRow links to /read/:id for readable types and falls back
 * to /item/:id for gdoc/email/github/image.
 *
 * Why a new file rather than refactoring ItemDetail.tsx:
 *  - ItemDetail is 1305 lines with 5 type-specific renderers + Detail/Read/
 *    PDF mode toggle + project-context branching. Layering a 3-pane shell
 *    on top fights every existing concern.
 *  - A fresh ~250 LOC page can mount the existing primitives (PdfAnnotationView,
 *    NoteEditorV2, useItems) without inheriting that complexity.
 *  - Separation of routes lets the two views evolve independently.
 *
 * State persistence:
 *  - LIBRARY_COLLAPSED_KEY mirrors Layout.tsx so the user's collapse
 *    preference survives across global app and reader.
 *  - READER_ONLY is session-only (intentional — it's a focus mode, not a
 *    layout preference).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { getItem, createNote, updateNote, getPdfEmbedUrl, getNotes } from "@/lib/api";
import { useItems } from "@/hooks/useItems";
import type { Item, Highlight, Note } from "@/lib/supabase";
import PdfAnnotationView from "@/components/PdfAnnotationView";
import LibraryPane from "@/components/reader/LibraryPane";
import NotesPane from "@/components/reader/NotesPane";
import ReaderTopBar from "@/components/reader/ReaderTopBar";

const LIBRARY_COLLAPSED_KEY = "stoa_library_collapsed";

// Tag prefixes used internally by notes.py — strip these from the user-visible
// aggregation. See _attach_derived_fields and _make_tags in backend/routers/notes.py.
const INTERNAL_TAG_PREFIXES = ["kt:", "ref:", "link:", "col:", "anki:"];
const INTERNAL_TAG_LITERALS = new Set([
  "marginalia",
  "synthesis",
  "journal",
  "source-note",
]);

function isUserTag(t: string): boolean {
  if (INTERNAL_TAG_LITERALS.has(t)) return false;
  return !INTERNAL_TAG_PREFIXES.some((p) => t.startsWith(p));
}

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [itemNotes, setItemNotes] = useState<Note[]>([]);
  const [globalNotes, setGlobalNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainNoteId, setMainNoteId] = useState<string | null>(null);
  const [mainNoteContent, setMainNoteContent] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [readerOnly, setReaderOnly] = useState(false);
  const [libraryHidden, setLibraryHidden] = useState(() => {
    try {
      return localStorage.getItem(LIBRARY_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const prevLibraryStateRef = useRef<boolean>(libraryHidden);
  const { items: libraryItems } = useItems();

  const pdfUrl = item ? getPdfEmbedUrl(item) : null;

  // Persist library-hidden state (but not reader-only, which is session-only).
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_COLLAPSED_KEY, libraryHidden ? "1" : "0");
    } catch { /* localStorage unavailable */ }
  }, [libraryHidden]);

  // Load item + highlights + notes
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await getItem(id);
        if (cancelled) return;
        setItem(data.item as Item);
        setHighlights((data.highlights as Highlight[]) || []);
        const notes = (data.notes as Note[]) || [];
        setItemNotes(notes);
        const sourceNote =
          notes.find((n) => n.tags?.includes("source-note")) || notes[0] || null;
        setMainNoteId(sourceNote?.id || null);
        setMainNoteContent(sourceNote?.content || "");
      } catch {
        if (!cancelled) setItem(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Load global recent notes for LibraryPane (separate from item-scoped notes).
  useEffect(() => {
    let cancelled = false;
    getNotes()
      .then((res) => {
        if (cancelled) return;
        setGlobalNotes((res.notes as Note[]) || []);
      })
      .catch(() => { /* sidebar is non-critical */ });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tag aggregation: derive bullet-list counts from user-tags across global
  // notes. Items themselves don't carry tags in the Item interface; tags
  // surface via getItemTags per item, too expensive for the sidebar footer.
  // Notes give us a good approximation of the user's tag vocabulary.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of globalNotes) {
      for (const t of n.tags || []) {
        if (!isUserTag(t)) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }, [globalNotes]);

  // ⌘K command palette stub — opens for now, full palette is later work.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen]);

  const toggleLibrary = useCallback(() => {
    setLibraryHidden((v) => !v);
  }, []);

  const toggleReaderOnly = useCallback(() => {
    setReaderOnly((cur) => {
      if (!cur) {
        prevLibraryStateRef.current = libraryHidden;
        setLibraryHidden(true);
        return true;
      } else {
        setLibraryHidden(prevLibraryStateRef.current);
        return false;
      }
    });
  }, [libraryHidden]);

  const handleSaveNote = useCallback(
    async (content: string, tags: string[]): Promise<Note | null> => {
      if (!item) return null;
      setSaveState("saving");
      try {
        if (mainNoteId) {
          await updateNote(mainNoteId, { content });
          setMainNoteContent(content);
          setSaveState("saved");
          setLastSavedAt(Date.now());
          return null;
        }
        const result = await createNote({ item_id: item.id, content, tags });
        const created = (result as { note: Note }).note;
        setMainNoteId(created.id);
        setMainNoteContent(content);
        setItemNotes((prev) => [created, ...prev]);
        setSaveState("saved");
        setLastSavedAt(Date.now());
        return created;
      } catch {
        setSaveState("idle");
        return null;
      }
    },
    [item, mainNoteId]
  );

  const handleCreateNoteFromPdf = useCallback(
    async (content: string, tags: string[]): Promise<Note | null> => {
      if (!item) return null;
      try {
        const result = await createNote({ item_id: item.id, content, tags });
        const created = (result as { note: Note }).note;
        setItemNotes((prev) => [created, ...prev]);
        return created;
      } catch {
        return null;
      }
    },
    [item]
  );

  if (!id) return <Navigate to="/" replace />;

  if (loading || !item) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-tertiary)",
          fontFamily: '"Newsreader", Georgia, serif',
          fontStyle: "italic",
        }}
      >
        {loading ? "Loading…" : "Item not found"}
      </div>
    );
  }

  // Breadcrumb tag: surface the first user-tag from the item's notes' main note.
  const breadcrumbTag = (() => {
    const tags = itemNotes
      .flatMap((n) => n.tags || [])
      .filter(isUserTag);
    return tags[0];
  })();

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-primary)",
        overflow: "hidden",
      }}
    >
      <ReaderTopBar
        itemTitle={item.title}
        breadcrumbTag={breadcrumbTag}
        libraryHidden={libraryHidden}
        readerOnly={readerOnly}
        onOpenCommand={() => setPaletteOpen(true)}
        onToggleLibrary={toggleLibrary}
        onToggleReaderOnly={toggleReaderOnly}
      />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <LibraryPane
          items={libraryItems}
          notes={globalNotes}
          tagCounts={tagCounts}
          collapsed={libraryHidden}
        />

        {/* Center pane */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--bg-primary)",
          }}
        >
          <CenterPane
            item={item}
            pdfUrl={pdfUrl}
            highlights={highlights}
            itemNotes={itemNotes}
            onCreateNote={handleCreateNoteFromPdf}
          />
        </main>

        {!readerOnly && (
          <NotesPane
            item={item}
            highlights={highlights}
            mainNoteId={mainNoteId}
            mainNoteContent={mainNoteContent}
            onSaveNote={handleSaveNote}
            saveState={saveState}
            lastSavedAt={lastSavedAt}
          />
        )}
      </div>

      {paletteOpen && <CommandPaletteStub onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function CenterPane({
  item,
  pdfUrl,
  highlights,
  itemNotes,
  onCreateNote,
}: {
  item: Item;
  pdfUrl: string | null;
  highlights: Highlight[];
  itemNotes: Note[];
  onCreateNote: (content: string, tags: string[]) => Promise<Note | null>;
}) {
  if (pdfUrl) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
        <PdfAnnotationView
          pdfUrl={pdfUrl}
          highlights={highlights}
          notes={itemNotes}
          itemId={item.id}
          onCreateNote={onCreateNote}
        />
      </div>
    );
  }

  // Non-PDF fallback: blog/page items render as the in-app reader iframe is
  // handled by /reader/:id. For now show a placeholder + offer to open detail.
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 40,
        color: "var(--text-secondary)",
        fontFamily: '"Newsreader", Georgia, serif',
      }}
    >
      <div style={{ fontSize: 16, fontStyle: "italic" }}>
        No PDF for this item type yet.
      </div>
      <a
        href={`/item/${item.id}`}
        style={{
          fontFamily: '"DM Sans", system-ui, sans-serif',
          fontSize: 12,
          padding: "6px 12px",
          border: "1px solid var(--border)",
          borderRadius: 3,
          color: "var(--text-primary)",
          textDecoration: "none",
          letterSpacing: "0.04em",
        }}
      >
        Open details →
      </a>
    </div>
  );
}

function CommandPaletteStub({ onClose }: { onClose: () => void }) {
  // V1 stub — the ⌘K palette gets wired up properly when we cull the global
  // sidebar (task #10). For now: a backdrop with hint text so the key binding
  // is discoverable without a real palette behind it.
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,25,23,0.35)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "20vh",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: 16,
          fontFamily: '"DM Sans", system-ui, sans-serif',
          color: "var(--text-secondary)",
          fontSize: 13,
        }}
      >
        <div style={{ color: "var(--text-primary)", fontWeight: 600, marginBottom: 6 }}>
          Command palette
        </div>
        <div style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
          Stub for V1. The full palette lands with task #10 (sidebar cull → palette).
          Press <kbd style={{ fontFamily: '"JetBrains Mono", monospace' }}>Esc</kbd> to close.
        </div>
      </div>
    </div>
  );
}
