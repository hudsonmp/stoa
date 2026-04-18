import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderKanban,
  Plus,
  X,
  MoreHorizontal,
  Pencil,
  Trash2,
  Clock,
} from "lucide-react";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  type Project,
} from "@/lib/api";

const PROJECT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#14b8a6",
];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface CreateModalProps {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const data = await createProject({ name: name.trim(), description: description.trim() || undefined, color });
      onCreated(data.project as Project);
    } catch {
      setError("Failed to create project. Try again.");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.15 }}
        className="bg-bg-primary border border-border rounded-card shadow-2xl w-full max-w-md mx-4 p-6"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); }
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-primary font-serif">New Project</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-warm p-1 rounded">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Requirement Engineering"
              className="w-full px-3 py-2 rounded-card bg-bg-secondary border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent transition-warm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Description <span className="text-text-tertiary font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={2}
              className="w-full px-3 py-2 rounded-card bg-bg-secondary border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent transition-warm resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? "scale-125 ring-2 ring-offset-2 ring-offset-bg-primary ring-accent" : "hover:scale-110"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-card hover:bg-bg-secondary transition-warm">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !name.trim()} className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-card hover:bg-accent/90 transition-warm disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Creating…" : "Create Project"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  onOpen: (project: Project) => void;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
}

function ProjectCard({ project, onOpen, onRenamed, onDeleted }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renaming) renameRef.current?.select(); }, [renaming]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleRename = async () => {
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === project.name) { setRenaming(false); return; }
    try { await updateProject(project.id, { name: trimmed }); onRenamed(project.id, trimmed); } catch { /* ignore */ }
    setRenaming(false);
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!confirm(`Delete "${project.name}"? All folders inside will be removed.`)) return;
    try { await deleteProject(project.id); onDeleted(project.id); } catch { /* ignore */ }
  };

  const colorDot = project.color ?? PROJECT_COLORS[0];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="group relative bg-bg-secondary border border-border rounded-card p-4 cursor-pointer hover:border-accent/40 hover:shadow-sm transition-warm"
      onClick={() => !renaming && !menuOpen && onOpen(project)}
    >
      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-card opacity-80" style={{ backgroundColor: colorDot }} />
      <div className="flex items-start justify-between pt-1">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <FolderKanban size={18} style={{ color: colorDot }} className="flex-shrink-0 mt-0.5" />
          {renaming ? (
            <input
              ref={renameRef}
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") { setRenaming(false); setRenameName(project.name); }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-bg-primary border border-accent rounded px-2 py-0.5 text-sm font-medium text-text-primary focus:outline-none"
            />
          ) : (
            <span className="font-medium text-sm text-text-primary truncate">{project.name}</span>
          )}
        </div>
        <div className="relative ml-2 flex-shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-primary transition-warm"
          >
            <MoreHorizontal size={14} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-bg-primary border border-border rounded-card shadow-lg py-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button onClick={() => { setMenuOpen(false); setRenaming(true); setRenameName(project.name); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm">
                  <Pencil size={13} /> Rename
                </button>
                <button onClick={handleDelete} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-warm">
                  <Trash2 size={13} /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {project.description && (
        <p className="mt-2 text-xs text-text-tertiary line-clamp-2 leading-relaxed">{project.description}</p>
      )}
      <div className="mt-3 flex items-center gap-3 text-[11px] text-text-tertiary font-mono">
        {project.item_count !== undefined && (
          <span>{project.item_count} item{project.item_count !== 1 ? "s" : ""}</span>
        )}
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {formatRelativeTime(project.updated_at)}
        </span>
      </div>
    </motion.div>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProjects();
      setProjects((data.projects as Project[]) || []);
    } catch { setProjects([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-text-primary">Projects</h1>
          <p className="text-sm text-text-tertiary mt-1">Organise your reading and research into folders.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-card text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-warm shadow-sm">
          <Plus size={15} /> New Project
        </button>
      </motion.div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-card bg-bg-secondary animate-pulse border border-border" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 text-center">
          <FolderKanban size={40} className="text-text-tertiary mb-4 opacity-40" />
          <p className="text-sm text-text-secondary mb-1">No projects yet.</p>
          <p className="text-xs text-text-tertiary mb-5">Create a project to organise your items into folders.</p>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-card text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-warm">
            <Plus size={15} /> Create your first project
          </button>
        </motion.div>
      ) : (
        <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={(p) => navigate(`/projects/${p.id}`)}
                onRenamed={(id, name) => setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))}
                onDeleted={(id) => setProjects((prev) => prev.filter((p) => p.id !== id))}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateModal
            onClose={() => setShowCreate(false)}
            onCreated={(project) => { setShowCreate(false); setProjects((prev) => [project, ...prev]); navigate(`/projects/${project.id}`); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
