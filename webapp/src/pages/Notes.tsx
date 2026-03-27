import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Search, FileText, Trash2, Check, X, ExternalLink } from "lucide-react";
import ResearchEditor from "@/components/ResearchEditor";
import { getNotes, createNote, updateNote, deleteNote } from "@/lib/api";
import type { Note } from "@/lib/supabase";

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
        tags: ["synthesis"],
      });
      const newNote = data.note as Note;
      await load();
      navigate(`/notes/${newNote.id}`);
    } catch {
      // silent
    }
  }, [load, navigate]);

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

  const filtered = searchQuery
    ? filteredByType.filter((n) => {
        const q = searchQuery.toLowerCase();
        const title = extractTitle(n).toLowerCase();
        const content = n.content.replace(/<[^>]*>/g, "").toLowerCase();
        return title.includes(q) || content.includes(q);
      })
    : filteredByType;

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
      {/* Left sidebar */}
      <div className="w-[240px] flex-shrink-0 border-r border-border bg-bg-secondary/30 flex flex-col h-full">
        {/* New Note button */}
        <div className="p-3">
          <button
            onClick={handleCreateNote}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-card
                       bg-accent text-white text-sm font-medium
                       hover:bg-accent-hover transition-warm"
          >
            <Plus size={14} />
            New Note
          </button>
        </div>

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
            </div>
            <div className="flex-1 notes-editor-fullwidth">
              <ResearchEditor
                content={activeNote.content}
                onSave={handleSave}
                placeholder="Start writing your research notes..."
              />
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
    </div>
  );
}
