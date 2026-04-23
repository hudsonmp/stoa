import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Search, FileText, Trash2, ExternalLink } from "lucide-react";
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
  const text = note.content.replace(/<[^>]*>/g, "").trim();
  if (!text) return "Untitled";
  const firstLine = text.split("\n")[0];
  return firstLine.length > 50 ? firstLine.slice(0, 50) + "..." : firstLine;
}

export default function Writings() {
  const { id: activeId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [writings, setWritings] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [overleafUrl, setOverleafUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotes();
      // Filter to writings (tagged "writing" or standalone notes without item_id)
      const writingNotes = (data.notes as Note[]).filter(
        (n) => n.tags?.includes("writing") || n.tags?.includes("essay") || n.tags?.includes("draft")
      );
      writingNotes.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setWritings(writingNotes);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeNote = writings.find((n) => n.id === activeId);

  // Sync title + overleaf URL when switching writings
  useEffect(() => {
    if (activeNote) {
      setEditingTitleId(activeNote.id);
      setTitleDraft(activeNote.title && activeNote.title !== "Untitled" ? activeNote.title : "");
      const olTag = activeNote.tags?.find((t: string) => t.startsWith("overleaf:"));
      setOverleafUrl(olTag ? olTag.replace("overleaf:", "") : "");
    }
  }, [activeNote?.id]);

  const handleCreateWriting = useCallback(async () => {
    try {
      const data = await createNote({
        content: "",
        title: "Untitled",
        tags: ["writing"],
      });
      const newNote = data.note as Note;
      await load();
      navigate(`/writings/${newNote.id}`);
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
        setWritings((prev) =>
          prev.map((n) =>
            n.id === activeId
              ? { ...n, content, updated_at: new Date().toISOString() }
              : n
          )
        );
      } catch {
        // silent
      } finally {
        setSaving(false);
      }
    },
    [activeId]
  );

  const saveTitle = useCallback(
    async (noteId: string) => {
      const trimmed = titleDraft.trim();
      const newTitle = trimmed || "Untitled";
      setEditingTitleId(null);
      try {
        await updateNote(noteId, { title: newTitle });
        setWritings((prev) =>
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

  const handleDelete = useCallback(
    async (noteId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await deleteNote(noteId);
        setWritings((prev) => prev.filter((n) => n.id !== noteId));
        if (noteId === activeId) navigate("/writings");
      } catch {
        // silent
      }
    },
    [activeId, navigate]
  );

  const filtered = searchQuery
    ? writings.filter((n) => {
        const q = searchQuery.toLowerCase();
        const title = extractTitle(n).toLowerCase();
        const content = n.content.replace(/<[^>]*>/g, "").toLowerCase();
        return title.includes(q) || content.includes(q);
      })
    : writings;

  return (
    <div className="flex h-full">
      {/* Left sidebar — writing list */}
      <div className="w-[240px] flex-shrink-0 border-r border-border bg-bg-secondary/30 flex flex-col h-full">
        <div className="p-3">
          <button
            onClick={handleCreateWriting}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-card
                       bg-accent text-white text-sm font-medium
                       hover:bg-accent-hover transition-warm"
          >
            <Plus size={14} />
            New Writing
          </button>
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[6px]
                          bg-bg-primary border border-border">
            <Search size={12} className="text-text-tertiary flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search writings..."
              className="flex-1 bg-transparent border-none outline-none
                         text-[12px] text-text-primary placeholder:text-text-tertiary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {loading && (
            <p className="text-center text-[12px] text-text-tertiary py-4">Loading...</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-[12px] text-text-tertiary py-4">
              {searchQuery ? "No matches" : "No writings yet"}
            </p>
          )}
          {filtered.map((note) => (
            <div
              key={note.id}
              className={`group/note relative w-full text-left px-3 py-2.5 rounded-card transition-warm cursor-pointer
                ${note.id === activeId
                  ? "bg-bg-primary border-l-2 border-accent pl-[10px] shadow-sm"
                  : "hover:bg-bg-primary/60"
                }`}
              onClick={() => navigate(`/writings/${note.id}`)}
            >
              <p className="text-sm font-medium text-text-primary truncate leading-tight">
                {extractTitle(note)}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-text-tertiary">
                  {formatRelativeDate(note.updated_at)}
                </span>
                <span className="text-[9px] font-mono uppercase tracking-wider text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded">
                  {note.content.replace(/<[^>]*>/g, "").trim().split(/\s+/).length} words
                </span>
              </div>
              <button
                onClick={(e) => handleDelete(note.id, e)}
                className="absolute top-2 right-2 opacity-0 group-hover/note:opacity-100
                           transition-warm p-1 rounded text-text-tertiary hover:text-red-500
                           hover:bg-red-50"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
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
            </div>
            {/* Overleaf integration */}
            <div className="px-6 pb-2 flex items-center gap-3">
              {overleafUrl ? (
                <a
                  href={overleafUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary
                             hover:text-text-primary transition-warm"
                >
                  <ExternalLink size={11} />
                  Open in Overleaf
                </a>
              ) : (
                <button
                  onClick={async () => {
                    if (!activeNote) return;
                    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
                    const headers: Record<string, string> = { "Content-Type": "application/json" };
                    const devId = import.meta.env.VITE_DEV_USER_ID;
                    const token = localStorage.getItem("stoa_token");
                    const userId = localStorage.getItem("stoa_user_id");
                    if (devId) headers["X-User-Id"] = devId;
                    else if (token) headers["Authorization"] = `Bearer ${token}`;
                    else if (userId) headers["X-User-Id"] = userId;

                    const btn = document.activeElement as HTMLButtonElement;
                    if (btn) { btn.textContent = "Pushing..."; btn.disabled = true; }

                    try {
                      const resp = await fetch(`${apiUrl}/writings/${activeNote.id}/push-to-overleaf`, {
                        method: "POST", headers,
                      });
                      const data = await resp.json();
                      if (data.success && data.overleaf_url) {
                        // Save the Overleaf URL to the note's tags
                        const oldTags = (activeNote.tags || []).filter((t: string) => !t.startsWith("overleaf:"));
                        await updateNote(activeNote.id, { tags: [...oldTags, `overleaf:${data.overleaf_url}`] });
                        setOverleafUrl(data.overleaf_url);
                        window.open(data.overleaf_url, "_blank");
                        if (btn) btn.textContent = "Pushed ✓";
                      } else {
                        if (btn) btn.textContent = "Failed";
                        if (data.error) console.warn("[Stoa] Overleaf push failed:", data.error);
                      }
                    } catch {
                      if (btn) btn.textContent = "Failed";
                    }
                    setTimeout(() => { if (btn) { btn.textContent = "Push to Overleaf"; btn.disabled = false; } }, 2000);
                  }}
                  className="inline-flex items-center gap-1.5 text-[12px] text-accent
                             hover:text-accent-hover transition-warm font-medium"
                >
                  <ExternalLink size={11} />
                  Push to Overleaf
                </button>
              )}
            </div>

            <div className="flex-1 notes-editor-fullwidth">
              <ResearchEditor
                content={activeNote.content}
                onSave={handleSave}
                placeholder="Start writing..."
              />
            </div>
          </motion.div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={32} className="mx-auto mb-3 text-text-tertiary/40" />
              <p className="font-serif text-sm text-text-secondary">
                {writings.length > 0
                  ? "Select a writing to continue"
                  : "Start your first essay, draft, or blog post"}
              </p>
              {writings.length === 0 && !loading && (
                <button
                  onClick={handleCreateWriting}
                  className="mt-3 px-4 py-2 rounded-card bg-accent text-white text-sm
                             font-medium hover:bg-accent-hover transition-warm"
                >
                  <Plus size={14} className="inline mr-1" />
                  New Writing
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
