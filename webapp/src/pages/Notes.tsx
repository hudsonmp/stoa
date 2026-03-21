import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Search, FileText } from "lucide-react";
import ResearchEditor from "@/components/ResearchEditor";
import { getNotes, createNote, updateNote } from "@/lib/api";
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotes();
      // Filter to standalone notes (no item_id, no person_id) — research notes
      const standalone = (data.notes as Note[]).filter(
        (n) => !n.item_id && !n.person_id
      );
      // Sort by most recently updated
      standalone.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setNotes(standalone);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const filtered = searchQuery
    ? notes.filter((n) => {
        const q = searchQuery.toLowerCase();
        const title = extractTitle(n).toLowerCase();
        const content = n.content.replace(/<[^>]*>/g, "").toLowerCase();
        return title.includes(q) || content.includes(q);
      })
    : notes;

  const activeNote = notes.find((n) => n.id === activeId);

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
            return (
              <button
                key={note.id}
                onClick={() => navigate(`/notes/${note.id}`)}
                className={`w-full text-left px-3 py-2.5 rounded-card transition-warm
                  ${
                    note.id === activeId
                      ? "bg-bg-primary border-l-2 border-accent pl-[10px] shadow-sm"
                      : "hover:bg-bg-primary/60"
                  }`}
              >
                <p className="text-sm font-medium text-text-primary truncate leading-tight">
                  {extractTitle(note)}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-text-tertiary">
                    {formatRelativeDate(note.updated_at)}
                  </span>
                  {badge && (
                    <span className="text-[9px] font-mono uppercase tracking-wider text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded">
                      {badge}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeNote ? (
          <motion.div
            key={activeNote.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="flex-1 flex flex-col"
          >
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
              <p className="text-[11px] font-mono text-text-tertiary">
                {saving ? "Saving..." : "Saved"}
              </p>
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
