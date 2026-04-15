import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Plus,
  Search,
  FileText,
  Trash2,
  Check,
  X,
  ExternalLink,
  Link2,
  Folder,
  FolderPlus,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import ResearchEditor from "@/components/ResearchEditor";
import FlashcardReview from "@/components/FlashcardReview";
import FlashcardEditor from "@/components/FlashcardEditor";
import {
  getNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  linkNoteToNote,
  unlinkNoteFromNote,
  addNoteToCollection,
  removeNoteFromCollection,
  listCollections,
  createCollection,
  KNOWLEDGE_TYPES,
  type KnowledgeType,
} from "@/lib/api";
import type { Note } from "@/lib/supabase";

const NOTES_LIST_COLLAPSED_KEY = "stoa_notes_list_collapsed";

interface CollectionRef {
  id: string;
  name: string;
}

type LinkedNotePreview = {
  id: string;
  title?: string | null;
  note_type?: string;
  knowledge_type?: KnowledgeType | null;
};

// Per-type pedagogy (Reading Hamming companion §4: different knowledge, different memory).
// Each knowledge type routes to a different memory system — the chip is the routing decision.
const KT_HINT: Record<KnowledgeType, { label: string; body: string }> = {
  declarative: {
    label: "Fact, claim, attribution",
    body: "Encode via Anki with Nielsen's 5 properties. Example: \"Hamming claimed ambiguity-tolerance predicts scientific greatness.\"",
  },
  procedural: {
    label: "Derivation, how-to",
    body: "Spaced practice on paper, not flashcards. Redo the derivation at 1d/1w/1mo. Card the trick, not the formula.",
  },
  conceptual: {
    label: "Schema, model, mental structure",
    body: "Self-explanation (Chi 1989) + concept note + essay. Cards flatten schemas — don't Ankify.",
  },
  episodic: {
    label: "Story, anecdote, scene",
    body: "Retain the scene, not the moral. Moral reconstructs on retrieval (Tulving 1972). Shannon hallway, open-door thesis.",
  },
  stylistic: {
    label: "Move, posture, taste",
    body: "Imitation, not encoding. Annotate the move; reuse in your writing. Cannot be Ankified.",
  },
};

function getNoteType(note: Note): "marginalia" | "synthesis" | "journal" {
  if (note.note_type) return note.note_type;
  const types = ["marginalia", "synthesis", "journal"] as const;
  for (const t of note.tags || []) {
    if ((types as readonly string[]).includes(t)) return t as (typeof types)[number];
  }
  return "marginalia";
}

function getNoteKnowledgeType(note: Note): KnowledgeType | null {
  if (note.knowledge_type) return note.knowledge_type;
  const fromTag = (note.tags || []).find((t) => t.startsWith("kt:"));
  if (!fromTag) return null;
  const kt = fromTag.slice(3) as KnowledgeType;
  return (KNOWLEDGE_TYPES as string[]).includes(kt) ? kt : null;
}

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function extractTitle(note: Note): string {
  if (note.title && note.title !== "Untitled") return note.title;
  // Strip HTML and take first line
  const text = note.content
    .replace(/<[^>]*>/g, "")
    .trim();
  if (!text) return "Untitled";
  const firstLine = text.split("\n")[0];
  return firstLine.length > 50 ? firstLine.slice(0, 50) + "..." : firstLine;
}

function noteTypeBadge(note: Note): string | null {
  if (note.item_id) return "annotation";
  if (note.person_id) return "person";
  if (note.tags?.includes("synthesis")) return "synthesis";
  return "standalone";
}

export default function Notes() {
  const { id: activeId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(true); // show all notes by default

  // Inline title editing state
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Hydrated linked-note previews for the active note (fetched via GET /notes/{id}).
  const [linkedNotes, setLinkedNotes] = useState<LinkedNotePreview[]>([]);

  // Link-picker state: opens an inline search over synthesis notes to add a link.
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [hoveredKt, setHoveredKt] = useState<KnowledgeType | null>(null);

  // Collections (folders) — tag-based via col:<id>. Lets you group all notes for a book.
  const [collections, setCollections] = useState<CollectionRef[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Flashcard review modal. v1 = linear deck of kt:declarative notes.
  const [reviewOpen, setReviewOpen] = useState(false);

  // Collapse the notes-list middle rail (beyond the Library nav collapse in Layout).
  const [listCollapsed, setListCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(NOTES_LIST_COLLAPSED_KEY) === "1";
  });
  const toggleListCollapsed = useCallback(() => {
    setListCollapsed((cur) => {
      const next = !cur;
      localStorage.setItem(NOTES_LIST_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotes();
      const allNotes = (data.notes as Note[]);
      // Sort by most recently updated
      allNotes.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setNotes(allNotes);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Load collections (shared with items, reused here to group notes by folder).
  useEffect(() => {
    listCollections()
      .then((res) => setCollections(res.collections as CollectionRef[]))
      .catch(() => setCollections([]));
  }, []);

  const handleCreateCollection = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const res = await createCollection({ name });
      const col = res.collection as CollectionRef;
      setCollections((prev) => [...prev, col]);
      setNewFolderName("");
      if (activeId) {
        await addNoteToCollection(activeId, col.id);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === activeId
              ? { ...n, tags: [...(n.tags || []), `col:${col.id}`] }
              : n
          )
        );
      }
    } catch {
      // silent
    }
  }, [newFolderName, activeId]);

  const handleToggleNoteCollection = useCallback(
    async (collectionId: string, currentlyIn: boolean) => {
      if (!activeId) return;
      try {
        if (currentlyIn) {
          await removeNoteFromCollection(activeId, collectionId);
          setNotes((prev) =>
            prev.map((n) =>
              n.id === activeId
                ? {
                    ...n,
                    tags: (n.tags || []).filter(
                      (t) => t !== `col:${collectionId}`
                    ),
                  }
                : n
            )
          );
        } else {
          await addNoteToCollection(activeId, collectionId);
          setNotes((prev) =>
            prev.map((n) =>
              n.id === activeId
                ? { ...n, tags: [...(n.tags || []), `col:${collectionId}`] }
                : n
            )
          );
        }
      } catch {
        // silent
      }
    },
    [activeId]
  );

  const getNoteCollectionIds = useCallback((note: Note): string[] => {
    if (note.collection_ids) return note.collection_ids;
    return (note.tags || [])
      .filter((t) => t.startsWith("col:"))
      .map((t) => t.slice(4));
  }, []);

  // Focus title input when editing starts
  useEffect(() => {
    if (editingTitleId && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitleId]);

  const handleCreateNote = useCallback(async () => {
    try {
      const data = await createNote({
        content: "",
        title: "Untitled",
        note_type: "synthesis",
      });
      const newNote = data.note as Note;
      await load();
      navigate(`/notes/${newNote.id}`);
    } catch {
      // silent
    }
  }, [load, navigate]);

  // Hydrate linked_notes whenever the active note changes. GET /notes/{id} returns
  // preview objects (id, title, note_type, knowledge_type) for every link:<id> tag.
  useEffect(() => {
    let cancelled = false;
    if (!activeId) {
      setLinkedNotes([]);
      setLinkPickerOpen(false);
      setLinkPickerQuery("");
      return;
    }
    getNoteById(activeId)
      .then((data) => {
        if (cancelled) return;
        const note = data.note as Note & { linked_notes?: LinkedNotePreview[] };
        setLinkedNotes(note.linked_notes || []);
      })
      .catch(() => {
        if (!cancelled) setLinkedNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const handleLinkNote = useCallback(
    async (targetId: string) => {
      if (!activeId || targetId === activeId) return;
      try {
        await linkNoteToNote(activeId, targetId);
        // Optimistically append a preview from the full notes list.
        const target = notes.find((n) => n.id === targetId);
        if (target && !linkedNotes.some((ln) => ln.id === targetId)) {
          setLinkedNotes((prev) => [
            ...prev,
            {
              id: target.id,
              title: target.title,
              note_type: target.note_type,
              knowledge_type: target.knowledge_type ?? null,
            },
          ]);
        }
        setLinkPickerQuery("");
        setLinkPickerOpen(false);
      } catch {
        // silent
      }
    },
    [activeId, notes, linkedNotes]
  );

  const handleUnlinkNote = useCallback(
    async (targetId: string) => {
      if (!activeId) return;
      try {
        await unlinkNoteFromNote(activeId, targetId);
        setLinkedNotes((prev) => prev.filter((ln) => ln.id !== targetId));
      } catch {
        // silent
      }
    },
    [activeId]
  );

  // Candidate set for the link picker: all other notes, filtered by query.
  // Matuschak's dense-linking rule applies to synthesis notes, but we allow
  // linking to any note type — the user judges what's a meaningful connection.
  const linkCandidates = useMemo(() => {
    if (!activeId) return [];
    const existingLinks = new Set(linkedNotes.map((ln) => ln.id));
    const q = linkPickerQuery.trim().toLowerCase();
    return notes
      .filter((n) => n.id !== activeId && !existingLinks.has(n.id))
      .filter((n) => {
        if (!q) return true;
        const title = extractTitle(n).toLowerCase();
        return title.includes(q);
      })
      .slice(0, 10);
  }, [activeId, notes, linkedNotes, linkPickerQuery]);

  const handleSetKnowledgeType = useCallback(
    async (noteId: string, kt: KnowledgeType | null) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      const existing = (note.tags || []).filter((t) => !t.startsWith("kt:"));
      const nextTags = kt ? [...existing, `kt:${kt}`] : existing;
      try {
        await updateNote(noteId, { tags: nextTags });
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId
              ? { ...n, tags: nextTags, knowledge_type: kt ?? undefined }
              : n
          )
        );
      } catch {
        // silent
      }
    },
    [notes]
  );

  const handleSave = useCallback(
    async (content: string) => {
      if (!activeId) return;
      setSaving(true);
      try {
        await updateNote(activeId, { content });
        // Update local state without full reload
        setNotes((prev) =>
          prev.map((n) =>
            n.id === activeId
              ? { ...n, content, updated_at: new Date().toISOString() }
              : n
          )
        );
      } catch {
        // silent — will retry on next save
      } finally {
        setSaving(false);
      }
    },
    [activeId]
  );

  const handleDelete = useCallback(
    async (noteId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await deleteNote(noteId);
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        if (noteId === activeId) {
          navigate("/notes");
        }
      } catch {
        // silent
      }
    },
    [activeId, navigate]
  );

  const startEditingTitle = useCallback(
    (note: Note, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingTitleId(note.id);
      setTitleDraft(note.title && note.title !== "Untitled" ? note.title : "");
    },
    []
  );

  const saveTitle = useCallback(
    async (noteId: string) => {
      const trimmed = titleDraft.trim();
      const newTitle = trimmed || "Untitled";
      setEditingTitleId(null);
      try {
        await updateNote(noteId, { title: newTitle });
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId
              ? { ...n, title: newTitle, updated_at: new Date().toISOString() }
              : n
          )
        );
      } catch {
        // silent
      }
    },
    [titleDraft]
  );

  const cancelEditingTitle = useCallback(() => {
    setEditingTitleId(null);
    setTitleDraft("");
  }, []);

  const filteredByType = showAll
    ? notes
    : notes.filter((n) => !n.item_id && !n.person_id);

  const filteredByCollection = activeCollectionId
    ? filteredByType.filter((n) =>
        getNoteCollectionIds(n).includes(activeCollectionId)
      )
    : filteredByType;

  const filtered = searchQuery
    ? filteredByCollection.filter((n) => {
        const q = searchQuery.toLowerCase();
        const title = extractTitle(n).toLowerCase();
        const content = n.content.replace(/<[^>]*>/g, "").toLowerCase();
        return title.includes(q) || content.includes(q);
      })
    : filteredByCollection;

  const activeNote = notes.find((n) => n.id === activeId);

  // Sync titleDraft when switching notes
  useEffect(() => {
    if (activeNote) {
      setEditingTitleId(activeNote.id);
      setTitleDraft(activeNote.title && activeNote.title !== "Untitled" ? activeNote.title : "");
    }
  }, [activeNote?.id]);

  return (
    <div className="flex h-full">
      {/* Collapsed rail */}
      {listCollapsed && (
        <button
          onClick={toggleListCollapsed}
          title="Show notes list"
          className="flex-shrink-0 w-7 border-r border-border flex flex-col items-center pt-3
                     text-text-tertiary hover:text-accent transition-warm"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {/* Left sidebar */}
      {!listCollapsed && (
      <div className="w-[240px] flex-shrink-0 border-r border-border bg-bg-secondary/30 flex flex-col h-full relative">
        <button
          onClick={toggleListCollapsed}
          title="Collapse list"
          className="absolute top-3 -right-3 z-20 w-6 h-6 rounded-full
                     bg-bg-primary border border-border shadow-sm
                     flex items-center justify-center text-text-tertiary
                     hover:text-accent hover:border-accent/40 transition-warm"
        >
          <ChevronLeft size={12} />
        </button>
        {/* New Note + Review row */}
        <div className="p-3 flex items-center gap-2">
          <button
            onClick={handleCreateNote}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-card
                       bg-accent text-white text-sm font-medium
                       hover:bg-accent-hover transition-warm"
          >
            <Plus size={14} />
            New Note
          </button>
          <button
            onClick={() => setReviewOpen(true)}
            title="Review declarative flashcards"
            className="flex items-center justify-center p-2 rounded-card
                       bg-bg-primary border border-border text-text-secondary
                       hover:text-accent hover:border-accent/40 transition-warm"
          >
            <Sparkles size={14} />
          </button>
        </div>

        {/* Collection (folder) filter */}
        {collections.length > 0 && (
          <div className="px-3 pb-2">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setActiveCollectionId(null)}
                className={`text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded transition-warm
                  ${activeCollectionId === null
                    ? "text-accent bg-accent/10"
                    : "text-text-tertiary hover:text-text-primary"}`}
              >
                All
              </button>
              {collections.map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    setActiveCollectionId(activeCollectionId === c.id ? null : c.id)
                  }
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-warm truncate max-w-[140px]
                    ${activeCollectionId === c.id
                      ? "text-accent bg-accent/10"
                      : "text-text-tertiary hover:text-text-primary"}`}
                  title={c.name}
                >
                  <Folder size={9} className="inline mr-0.5" />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filter toggle */}
        <div className="flex px-3 pb-1">
          <button
            onClick={() => setShowAll(true)}
            className={`flex-1 text-[10px] font-mono uppercase tracking-wider py-1.5 transition-warm
              ${showAll ? "text-text-primary border-b border-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}
          >
            All
          </button>
          <button
            onClick={() => setShowAll(false)}
            className={`flex-1 text-[10px] font-mono uppercase tracking-wider py-1.5 transition-warm
              ${!showAll ? "text-text-primary border-b border-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}
          >
            Standalone
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[6px]
                          bg-bg-primary border border-border">
            <Search size={12} className="text-text-tertiary flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              className="flex-1 bg-transparent border-none outline-none
                         text-[12px] text-text-primary placeholder:text-text-tertiary"
            />
          </div>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {loading && (
            <p className="text-center text-[12px] text-text-tertiary py-4">
              Loading...
            </p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-[12px] text-text-tertiary py-4">
              {searchQuery ? "No matches" : "No notes yet"}
            </p>
          )}
          {filtered.map((note) => {
            const badge = noteTypeBadge(note);
            const isEditing = editingTitleId === note.id;
            return (
              <div
                key={note.id}
                className={`group/note relative w-full text-left px-3 py-2.5 rounded-card transition-warm cursor-pointer
                  ${
                    note.id === activeId
                      ? "bg-bg-primary border-l-2 border-accent pl-[10px] shadow-sm"
                      : "hover:bg-bg-primary/60"
                  }`}
                onClick={() => {
                  if (!isEditing) navigate(`/notes/${note.id}`);
                }}
              >
                {/* Title — inline editable on double-click */}
                {isEditing ? (
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      ref={titleInputRef}
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveTitle(note.id);
                        if (e.key === "Escape") cancelEditingTitle();
                      }}
                      onBlur={() => saveTitle(note.id)}
                      className="flex-1 bg-transparent text-sm font-medium text-text-primary
                                 outline-none border-b border-accent/40 leading-tight"
                      placeholder="Note title..."
                    />
                    <button
                      onClick={() => saveTitle(note.id)}
                      className="p-0.5 text-accent hover:text-accent-hover"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={cancelEditingTitle}
                      className="p-0.5 text-text-tertiary hover:text-text-primary"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <p
                    className="text-sm font-medium text-text-primary truncate leading-tight"
                    onDoubleClick={(e) => startEditingTitle(note, e)}
                    title="Double-click to rename"
                  >
                    {extractTitle(note)}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-text-tertiary">
                    {formatRelativeDate(note.updated_at)}
                  </span>
                  {badge && badge !== "standalone" && (
                    <span className="text-[9px] font-mono uppercase tracking-wider text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded">
                      {badge}
                    </span>
                  )}
                </div>
                {note.item_id && (
                  <Link
                    to={`/item/${note.item_id}`}
                    className="flex items-center gap-1 mt-1 text-[10px] text-text-tertiary hover:text-text-secondary truncate"
                    onClick={(e) => e.stopPropagation()}
                    title="View linked item"
                  >
                    <ExternalLink size={9} className="flex-shrink-0" />
                    <span className="truncate">Linked item</span>
                  </Link>
                )}

                {/* Delete button — appears on hover */}
                <button
                  onClick={(e) => handleDelete(note.id, e)}
                  className="absolute top-2 right-2 opacity-0 group-hover/note:opacity-100
                             transition-warm p-1 rounded text-text-tertiary hover:text-red-500
                             hover:bg-red-50"
                  title="Delete note"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {activeNote ? (
          <motion.div
            key={activeNote.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="flex-1 flex flex-col"
          >
            {/* Document header — editable title, Google Doc style */}
            <div className="notes-doc-header">
              <div className="flex items-center justify-between">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => saveTitle(activeNote.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      saveTitle(activeNote.id);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="Untitled"
                  className="flex-1 font-serif text-2xl font-semibold text-text-primary
                             bg-transparent border-none outline-none
                             placeholder:text-text-tertiary/40"
                />
                <span className="text-[10px] font-mono text-text-tertiary flex-shrink-0 ml-4">
                  {saving ? "Saving..." : "Saved"}
                </span>
              </div>
              {activeNote.item_id && (
                <Link
                  to={`/item/${activeNote.item_id}`}
                  className="inline-flex items-center gap-1 text-[11px] text-text-tertiary
                             hover:text-text-secondary mt-1"
                >
                  <ExternalLink size={10} />
                  View linked item
                </Link>
              )}
              {/* Knowledge-type selector — encoding-before-extraction (§4).
                  Hover each chip for the per-type pedagogy (different memory systems). */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 relative">
                <span className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">
                  Encode as:
                </span>
                {KNOWLEDGE_TYPES.map((kt) => {
                  const active = getNoteKnowledgeType(activeNote) === kt;
                  return (
                    <button
                      key={kt}
                      onClick={() =>
                        handleSetKnowledgeType(
                          activeNote.id,
                          active ? null : kt
                        )
                      }
                      onMouseEnter={() => setHoveredKt(kt)}
                      onMouseLeave={() =>
                        setHoveredKt((cur) => (cur === kt ? null : cur))
                      }
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wide transition-warm
                        ${
                          active
                            ? "bg-accent text-white"
                            : "bg-bg-secondary text-text-tertiary hover:text-text-primary hover:bg-bg-secondary/80"
                        }`}
                    >
                      {kt}
                    </button>
                  );
                })}
                {hoveredKt && (
                  <div
                    className="absolute top-full left-0 mt-1.5 z-20 w-[320px]
                               bg-bg-primary border border-border rounded-card shadow-lg
                               px-3 py-2 pointer-events-none"
                  >
                    <div className="text-[10px] font-mono uppercase tracking-wider text-accent mb-0.5">
                      {hoveredKt}
                    </div>
                    <div className="text-[11px] text-text-primary font-medium mb-0.5">
                      {KT_HINT[hoveredKt].label}
                    </div>
                    <div className="text-[11px] text-text-secondary leading-snug">
                      {KT_HINT[hoveredKt].body}
                    </div>
                  </div>
                )}
              </div>

              {/* Dense-linking UI (Matuschak): evergreen notes earn their keep by
                  linking to ≥2 other notes. Orphans are surfaced via /notes/orphans. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 relative">
                <span className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">
                  Links ({linkedNotes.length}):
                </span>
                {linkedNotes.map((ln) => (
                  <div
                    key={ln.id}
                    className="group/linkchip inline-flex items-center gap-1 pl-2 pr-1 py-0.5
                               rounded-full text-[10px] bg-bg-secondary border border-border
                               hover:border-accent/40 transition-warm"
                  >
                    <Link
                      to={`/notes/${ln.id}`}
                      className="text-text-primary hover:text-accent truncate max-w-[180px]"
                      title={ln.title || "Untitled"}
                    >
                      <Link2 size={10} className="inline mr-1 text-text-tertiary" />
                      {ln.title || "Untitled"}
                    </Link>
                    <button
                      onClick={() => handleUnlinkNote(ln.id)}
                      className="p-0.5 rounded-full text-text-tertiary opacity-0
                                 group-hover/linkchip:opacity-100 hover:text-red-500 transition-warm"
                      title="Unlink"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setLinkPickerOpen((o) => !o)}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full
                             text-[10px] font-mono border border-dashed border-border
                             text-text-tertiary hover:text-accent hover:border-accent/40
                             transition-warm"
                  title="Link to another note"
                >
                  <Plus size={10} />
                  link
                </button>
                {linkPickerOpen && (
                  <div
                    className="absolute top-full left-0 mt-1.5 z-30 w-[340px]
                               bg-bg-primary border border-border rounded-card shadow-lg
                               overflow-hidden"
                  >
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
                      <Search size={12} className="text-text-tertiary flex-shrink-0" />
                      <input
                        autoFocus
                        value={linkPickerQuery}
                        onChange={(e) => setLinkPickerQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setLinkPickerOpen(false);
                            setLinkPickerQuery("");
                          }
                        }}
                        placeholder="Search notes to link..."
                        className="flex-1 bg-transparent border-none outline-none
                                   text-[12px] text-text-primary placeholder:text-text-tertiary"
                      />
                    </div>
                    <div className="max-h-[240px] overflow-y-auto">
                      {linkCandidates.length === 0 && (
                        <div className="px-3 py-2 text-[11px] text-text-tertiary">
                          {linkPickerQuery ? "No matches" : "No other notes yet"}
                        </div>
                      )}
                      {linkCandidates.map((cand) => (
                        <button
                          key={cand.id}
                          onClick={() => handleLinkNote(cand.id)}
                          className="w-full text-left px-3 py-2 hover:bg-bg-secondary
                                     transition-warm border-b border-border/40 last:border-b-0"
                        >
                          <div className="text-[12px] text-text-primary truncate">
                            {extractTitle(cand)}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {cand.knowledge_type && (
                              <span className="text-[9px] font-mono uppercase text-accent">
                                {cand.knowledge_type}
                              </span>
                            )}
                            <span className="text-[9px] text-text-tertiary">
                              {formatRelativeDate(cand.updated_at)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {linkedNotes.length < 2 && getNoteType(activeNote) === "synthesis" && (
                <div className="mt-1 text-[10px] text-text-tertiary italic">
                  Orphan warning — synthesis notes earn their keep at ≥2 links (Matuschak).
                </div>
              )}

              {/* Folder/collection membership */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 relative">
                <span className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">
                  Folders:
                </span>
                {getNoteCollectionIds(activeNote).map((cid) => {
                  const col = collections.find((c) => c.id === cid);
                  if (!col) return null;
                  return (
                    <div
                      key={cid}
                      className="group/colchip inline-flex items-center gap-1 pl-2 pr-1 py-0.5
                                 rounded-full text-[10px] bg-bg-secondary border border-border
                                 hover:border-accent/40 transition-warm"
                    >
                      <span className="text-text-primary">
                        <Folder size={10} className="inline mr-1 text-text-tertiary" />
                        {col.name}
                      </span>
                      <button
                        onClick={() => handleToggleNoteCollection(cid, true)}
                        className="p-0.5 rounded-full text-text-tertiary opacity-0
                                   group-hover/colchip:opacity-100 hover:text-red-500 transition-warm"
                        title="Remove from folder"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => setFolderPickerOpen((o) => !o)}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full
                             text-[10px] font-mono border border-dashed border-border
                             text-text-tertiary hover:text-accent hover:border-accent/40
                             transition-warm"
                  title="Add to folder"
                >
                  <FolderPlus size={10} />
                  folder
                </button>
                {folderPickerOpen && (
                  <div
                    className="absolute top-full left-0 mt-1.5 z-30 w-[280px]
                               bg-bg-primary border border-border rounded-card shadow-lg
                               overflow-hidden"
                  >
                    <div className="max-h-[200px] overflow-y-auto">
                      {collections.length === 0 && (
                        <div className="px-3 py-2 text-[11px] text-text-tertiary">
                          No folders yet — create one below.
                        </div>
                      )}
                      {collections.map((c) => {
                        const inCol = getNoteCollectionIds(activeNote).includes(c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() => handleToggleNoteCollection(c.id, inCol)}
                            className="w-full text-left px-3 py-1.5 hover:bg-bg-secondary
                                       transition-warm border-b border-border/40 last:border-b-0
                                       flex items-center justify-between"
                          >
                            <span className="text-[12px] text-text-primary truncate">
                              <Folder size={11} className="inline mr-1.5 text-text-tertiary" />
                              {c.name}
                            </span>
                            {inCol && <Check size={12} className="text-accent" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border">
                      <FolderPlus size={12} className="text-text-tertiary flex-shrink-0" />
                      <input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateCollection();
                          if (e.key === "Escape") setFolderPickerOpen(false);
                        }}
                        placeholder="New folder (e.g. Hamming)"
                        className="flex-1 bg-transparent border-none outline-none
                                   text-[12px] text-text-primary placeholder:text-text-tertiary"
                      />
                      <button
                        onClick={handleCreateCollection}
                        disabled={!newFolderName.trim()}
                        className="text-[11px] font-mono text-accent hover:text-accent-hover
                                   disabled:opacity-40 transition-warm"
                      >
                        create
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 notes-editor-fullwidth">
              {getNoteKnowledgeType(activeNote) === "declarative" ? (
                <FlashcardEditor
                  note={activeNote}
                  collectionNames={getNoteCollectionIds(activeNote)
                    .map((cid) => collections.find((c) => c.id === cid)?.name)
                    .filter((n): n is string => !!n)}
                  onNoteUpdated={(patch) =>
                    setNotes((prev) =>
                      prev.map((n) =>
                        n.id === patch.id
                          ? { ...n, ...patch, updated_at: new Date().toISOString() }
                          : n
                      )
                    )
                  }
                />
              ) : (
                <ResearchEditor
                  content={activeNote.content}
                  onSave={handleSave}
                  placeholder="Start writing your research notes..."
                />
              )}
            </div>
          </motion.div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={32} className="mx-auto mb-3 text-text-tertiary/40" />
              <p className="font-serif text-sm text-text-secondary">
                {notes.length > 0
                  ? "Select a note to start editing"
                  : "Create your first research note"}
              </p>
              {notes.length === 0 && !loading && (
                <button
                  onClick={handleCreateNote}
                  className="mt-3 px-4 py-2 rounded-card bg-accent text-white text-sm
                             font-medium hover:bg-accent-hover transition-warm"
                >
                  <Plus size={14} className="inline mr-1" />
                  New Note
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {reviewOpen && (
        <FlashcardReview
          collectionId={activeCollectionId || undefined}
          collectionName={
            activeCollectionId
              ? collections.find((c) => c.id === activeCollectionId)?.name
              : undefined
          }
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
