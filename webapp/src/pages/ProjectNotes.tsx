/**
 * ProjectNotes — Project-scoped notes page with Links tab.
 *
 * Forked from the post-merge Notes.tsx behaviour, targeting /project-notes and
 * /project-note-links endpoints. Preserves evergreen toggle, @mention editor,
 * and Links tab — these are Projects-only capabilities.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Plus,
  Search,
  FileText,
  Trash2,
  Check,
  X,
  ExternalLink,
  Leaf,
  Link2,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import ProjectNoteEditor from "@/components/ProjectNoteEditor";
import {
  getProjectNotes,
  createProjectNote,
  updateProjectNote,
  deleteProjectNote,
  getProjectNoteLinks,
} from "@/lib/api";
import type { ProjectNoteLinkRow } from "@/lib/api";
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

function noteTypeBadge(note: Note): string | null {
  if (note.evergreen) return "evergreen";
  if (note.item_id) return "annotation";
  if (note.person_id) return "person";
  if (note.tags?.includes("synthesis")) return "synthesis";
  return "standalone";
}

// ── LinksPanel ─────────────────────────────────────────────────────────────

function refTypePath(refType: string, id: string): string {
  // Project-scoped navigation: @note mentions route into ProjectNotes, items
  // into the item-detail reader. Folders are rendered as plain targets.
  if (refType === "note") return `/project-notes/${id}`;
  if (refType === "item") return `/item/${id}`;
  if (refType === "person") return `/people/${id}`;
  return "#";
}

function LinkRow({
  link,
  label,
  direction,
}: {
  link: ProjectNoteLinkRow;
  label: string | null | undefined;
  direction: "out" | "in";
}) {
  const targetId =
    direction === "out" ? link.target_ref_id : link.source_project_note_id;
  const href = refTypePath(
    direction === "out" ? link.target_ref_type : "note",
    targetId
  );
  const displayLabel = label || targetId.slice(0, 8) + "…";

  return (
    <Link
      to={href}
      className="flex items-center gap-2 px-3 py-2 rounded-card
                 hover:bg-bg-secondary/60 transition-warm group"
    >
      {direction === "out" ? (
        <ArrowUpRight
          size={12}
          className="flex-shrink-0 text-text-tertiary group-hover:text-accent"
        />
      ) : (
        <ArrowDownLeft
          size={12}
          className="flex-shrink-0 text-text-tertiary group-hover:text-accent"
        />
      )}
      <span className="text-sm text-text-primary truncate flex-1">
        {displayLabel}
      </span>
      <span className="text-[10px] font-mono text-text-tertiary flex-shrink-0">
        {direction === "out" ? link.target_ref_type : "note"}
      </span>
    </Link>
  );
}

function LinksPanel({ noteId }: { noteId: string }) {
  const [outgoing, setOutgoing] = useState<ProjectNoteLinkRow[]>([]);
  const [incoming, setIncoming] = useState<ProjectNoteLinkRow[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksError, setLinksError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLinksLoading(true);
    setLinksError(null);
    getProjectNoteLinks(noteId)
      .then(({ outgoing: out, incoming: inc }) => {
        if (!cancelled) {
          setOutgoing(out);
          setIncoming(inc);
        }
      })
      .catch(() => {
        if (!cancelled) setLinksError("Could not load links.");
      })
      .finally(() => {
        if (!cancelled) setLinksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (linksLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Loading links…
      </div>
    );
  }

  if (linksError) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        {linksError}
      </div>
    );
  }

  const empty = outgoing.length === 0 && incoming.length === 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
      {empty && (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <Link2 size={24} className="text-text-tertiary/40" />
          <p className="text-sm text-text-secondary">No links yet</p>
          <p className="text-[11px] text-text-tertiary max-w-[220px]">
            Use @mention in the note body to link other notes, items, or people.
          </p>
        </div>
      )}

      {outgoing.length > 0 && (
        <section>
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary mb-2 px-1">
            Outgoing ({outgoing.length})
          </p>
          <div className="space-y-0.5">
            {outgoing.map((link) => (
              <LinkRow
                key={`${link.target_ref_type}:${link.target_ref_id}:${link.mention_offset ?? 0}`}
                link={link}
                label={link.target_title}
                direction="out"
              />
            ))}
          </div>
        </section>
      )}

      {incoming.length > 0 && (
        <section>
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary mb-2 px-1">
            Incoming ({incoming.length})
          </p>
          <div className="space-y-0.5">
            {incoming.map((link) => (
              <LinkRow
                key={`${link.source_project_note_id}:${link.target_ref_type}:${link.mention_offset ?? 0}`}
                link={link}
                label={link.source_title}
                direction="in"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── ProjectNotes page ──────────────────────────────────────────────────────────
export default function ProjectNotes() {
  const { id: activeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Optional scope from URL — when scoping to a specific project/folder.
  const scopedProjectId = searchParams.get("project_id") || undefined;
  const scopedFolderId = searchParams.get("folder_id") || undefined;

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [activeTab, setActiveTab] = useState<"write" | "links">("write");

  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProjectNotes({
        project_id: scopedProjectId,
        folder_id: scopedFolderId,
      });
      const allNotes = data.notes as Note[];
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
  }, [scopedProjectId, scopedFolderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (editingTitleId && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitleId]);

  const handleCreateNote = useCallback(async () => {
    try {
      const data = await createProjectNote({
        content: "",
        title: "Untitled",
        tags: ["synthesis"],
        project_id: scopedProjectId,
        folder_id: scopedFolderId,
      });
      const newNote = data.note as Note;
      await load();
      navigate(`/project-notes/${newNote.id}`);
    } catch {
      // silent
    }
  }, [load, navigate, scopedProjectId, scopedFolderId]);

  const handleSave = useCallback(
    async (content: string) => {
      if (!activeId) return;
      setSaving(true);
      try {
        await updateProjectNote(activeId, { content });
        setNotes((prev) =>
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

  const handleDelete = useCallback(
    async (noteId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await deleteProjectNote(noteId);
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        if (noteId === activeId) {
          navigate("/project-notes");
        }
      } catch {
        // silent
      }
    },
    [activeId, navigate]
  );

  const handleToggleEvergreen = useCallback(
    async (note: Note, e: React.MouseEvent) => {
      e.stopPropagation();
      const newValue = !note.evergreen;
      setNotes((prev) =>
        prev.map((n) =>
          n.id === note.id ? { ...n, evergreen: newValue } : n
        )
      );
      try {
        await updateProjectNote(note.id, { evergreen: newValue });
      } catch {
        setNotes((prev) =>
          prev.map((n) =>
            n.id === note.id ? { ...n, evergreen: note.evergreen } : n
          )
        );
      }
    },
    []
  );

  const startEditingTitle = useCallback((note: Note, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitleId(note.id);
    setTitleDraft(note.title && note.title !== "Untitled" ? note.title : "");
  }, []);

  const saveTitle = useCallback(
    async (noteId: string) => {
      const trimmed = titleDraft.trim();
      const newTitle = trimmed || "Untitled";
      setEditingTitleId(null);
      try {
        await updateProjectNote(noteId, { title: newTitle });
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

  useEffect(() => {
    if (activeNote) {
      setEditingTitleId(activeNote.id);
      setTitleDraft(
        activeNote.title && activeNote.title !== "Untitled"
          ? activeNote.title
          : ""
      );
      setActiveTab("write");
    }
  }, [activeNote?.id]);

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="w-[240px] flex-shrink-0 border-r border-border bg-bg-secondary/30 flex flex-col h-full">
        <div className="p-3">
          <button
            onClick={handleCreateNote}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-card
                       bg-accent text-white text-sm font-medium
                       hover:bg-accent-hover transition-warm"
          >
            <Plus size={14} />
            New Project Note
          </button>
        </div>

        <div className="flex px-3 pb-1">
          <button
            onClick={() => setShowAll(true)}
            className={`flex-1 text-[10px] font-mono uppercase tracking-wider py-1.5 transition-warm
              ${
                showAll
                  ? "text-text-primary border-b border-text-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
          >
            All
          </button>
          <button
            onClick={() => setShowAll(false)}
            className={`flex-1 text-[10px] font-mono uppercase tracking-wider py-1.5 transition-warm
              ${
                !showAll
                  ? "text-text-primary border-b border-text-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
          >
            Standalone
          </button>
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] bg-bg-primary border border-border">
            <Search size={12} className="text-text-tertiary flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search project notes..."
              className="flex-1 bg-transparent border-none outline-none
                         text-[12px] text-text-primary placeholder:text-text-tertiary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {loading && (
            <p className="text-center text-[12px] text-text-tertiary py-4">
              Loading...
            </p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-[12px] text-text-tertiary py-4">
              {searchQuery ? "No matches" : "No project notes yet"}
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
                  if (!isEditing) navigate(`/project-notes/${note.id}`);
                }}
              >
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
                    className="text-sm font-medium text-text-primary truncate leading-tight pr-5"
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
                    <span
                      className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded
                        ${
                          badge === "evergreen"
                            ? "bg-green-50 text-green-600"
                            : "bg-bg-secondary text-text-tertiary"
                        }`}
                    >
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

                <button
                  onClick={(e) => handleToggleEvergreen(note, e)}
                  className={`absolute top-2 right-6 opacity-0 group-hover/note:opacity-100
                               transition-warm p-1 rounded
                               ${
                                 note.evergreen
                                   ? "text-green-500 opacity-100"
                                   : "text-text-tertiary hover:text-green-500"
                               }`}
                  title={note.evergreen ? "Remove evergreen" : "Make evergreen"}
                >
                  <Leaf size={11} />
                </button>

                <button
                  onClick={(e) => handleDelete(note.id, e)}
                  className="absolute top-2 right-1 opacity-0 group-hover/note:opacity-100
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
              <div className="flex items-center justify-between gap-3">
                {activeNote.evergreen ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Leaf
                      size={16}
                      className="flex-shrink-0 text-green-500"
                    />
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
                      placeholder={
                        activeNote.item_id
                          ? "Untitled (linked to paper)"
                          : "Concept name..."
                      }
                      className="flex-1 font-serif text-2xl font-semibold text-text-primary
                                 bg-transparent border-none outline-none
                                 placeholder:text-text-tertiary/40"
                    />
                  </div>
                ) : (
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
                )}

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => handleToggleEvergreen(activeNote, e)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-card text-[11px] font-medium transition-warm
                      ${
                        activeNote.evergreen
                          ? "bg-green-50 text-green-600 hover:bg-green-100"
                          : "bg-bg-secondary text-text-tertiary hover:text-green-500 hover:bg-green-50"
                      }`}
                    title={
                      activeNote.evergreen
                        ? "Remove evergreen flag"
                        : "Make evergreen (Matuschak-style atomic note)"
                    }
                  >
                    <Leaf size={12} />
                    {activeNote.evergreen ? "Evergreen" : "Make evergreen"}
                  </button>
                  <span className="text-[10px] font-mono text-text-tertiary">
                    {saving ? "Saving..." : "Saved"}
                  </span>
                </div>
              </div>

              {activeNote.item_id && (
                <Link
                  to={`/item/${activeNote.item_id}`}
                  className="inline-flex items-center gap-1 text-[11px] text-text-tertiary
                             hover:text-text-secondary mt-1"
                >
                  <ExternalLink size={10} />
                  {activeNote.evergreen ? "Source paper" : "View linked item"}
                </Link>
              )}
            </div>

            <div className="flex border-b border-border px-6 gap-0">
              <button
                onClick={() => setActiveTab("write")}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-warm
                  ${
                    activeTab === "write"
                      ? "border-accent text-accent"
                      : "border-transparent text-text-tertiary hover:text-text-secondary"
                  }`}
              >
                <FileText size={12} />
                Write
              </button>
              <button
                onClick={() => setActiveTab("links")}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-warm
                  ${
                    activeTab === "links"
                      ? "border-accent text-accent"
                      : "border-transparent text-text-tertiary hover:text-text-secondary"
                  }`}
              >
                <Link2 size={12} />
                Links
              </button>
            </div>

            {activeTab === "write" ? (
              <div className="flex-1 notes-editor-fullwidth">
                <ProjectNoteEditor
                  content={activeNote.content}
                  onSave={handleSave}
                  placeholder={
                    activeNote.evergreen
                      ? "Write your synthesis in your own words. Use @mention to link concepts..."
                      : "Start writing your project notes..."
                  }
                  projectNoteId={activeNote.id}
                />
              </div>
            ) : (
              <LinksPanel noteId={activeNote.id} />
            )}
          </motion.div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText
                size={32}
                className="mx-auto mb-3 text-text-tertiary/40"
              />
              <p className="font-serif text-sm text-text-secondary">
                {notes.length > 0
                  ? "Select a project note to start editing"
                  : "Create your first project note"}
              </p>
              {notes.length === 0 && !loading && (
                <button
                  onClick={handleCreateNote}
                  className="mt-3 px-4 py-2 rounded-card bg-accent text-white text-sm
                             font-medium hover:bg-accent-hover transition-warm"
                >
                  <Plus size={14} className="inline mr-1" />
                  New Project Note
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
