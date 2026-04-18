import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
} from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  ArrowLeft,
  X,
  Pencil,
  Trash2,
  ExternalLink,
  GripVertical,
  FileText,
  Link as LinkIcon,
  Github,
  Mail,
  Image as ImageIcon,
} from "lucide-react";
import {
  getProject,
  listFolders,
  listFolderItems,
  createFolder,
  updateFolder,
  deleteFolder,
  moveFolder,
  addItemToFolder,
  removeItemFromFolder,
  moveItemToFolder,
  ingestUrl,
  ingestPdf,
  ingestGdoc,
  ingestGithub,
  ingestResearchImage,
  type Project,
  type Folder as FolderType,
  type FolderItem,
} from "@/lib/api";

type ViewMode = "icon" | "list";
interface CtxMenu { x: number; y: number; kind: "folder" | "item" | "blank"; target?: FolderType | FolderItem; }

function typeIcon(type: string) {
  if (type === "pdf") return "📄";
  if (type === "book") return "📚";
  if (type === "video") return "🎬";
  if (type === "podcast") return "🎙️";
  if (type === "tweet") return "𝕏";
  return "🔗";
}

function Breadcrumbs({ crumbs, projectId }: { crumbs: { id: string | null; name: string }[]; projectId: string }) {
  const navigate = useNavigate();
  return (
    <nav className="flex items-center gap-1 text-xs text-text-tertiary min-w-0 flex-1">
      <Link to="/projects" className="hover:text-text-primary transition-warm shrink-0">Projects</Link>
      {crumbs.map((crumb, i) => (
        <span key={crumb.id ?? "root"} className="flex items-center gap-1 min-w-0">
          <ChevronRight size={12} className="shrink-0" />
          {i === crumbs.length - 1 ? (
            <span className="text-text-primary font-medium truncate">{crumb.name}</span>
          ) : (
            <button
              onClick={() => navigate(crumb.id ? `/projects/${projectId}/folders/${crumb.id}` : `/projects/${projectId}`)}
              className="hover:text-text-primary transition-warm truncate max-w-[120px]"
            >
              {crumb.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function FolderIcon({ folder, selected, onSelect, onOpen, onCtx, onDragStart, onDrop }: {
  folder: FolderType; selected: boolean; onSelect: () => void; onOpen: () => void;
  onCtx: (e: React.MouseEvent) => void; onDragStart: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { setDragOver(false); onDrop(e); }}
      onContextMenu={onCtx}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`flex flex-col items-center gap-1.5 p-3 rounded-card cursor-pointer select-none transition-warm group ${selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-bg-secondary"} ${dragOver ? "ring-2 ring-accent bg-accent/5" : ""}`}
    >
      {selected ? <FolderOpen size={36} className="text-amber-400" /> : <Folder size={36} className="text-amber-400 group-hover:text-amber-300 transition-warm" />}
      <span className="text-xs text-text-secondary text-center line-clamp-2 max-w-[80px] leading-tight">{folder.name}</span>
      {(folder.item_count ?? 0) > 0 && <span className="text-[10px] font-mono text-text-tertiary">{folder.item_count}</span>}
    </div>
  );
}

function ItemIcon({ item, selected, onSelect, onOpen, onCtx, onDragStart }: {
  item: FolderItem; selected: boolean; onSelect: () => void; onOpen: () => void;
  onCtx: (e: React.MouseEvent) => void; onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onContextMenu={onCtx}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`flex flex-col items-center gap-1.5 p-3 rounded-card cursor-pointer select-none transition-warm ${selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-bg-secondary"}`}
    >
      {item.cover_image_url ? (
        <img src={item.cover_image_url} alt="" className="w-9 h-9 rounded object-cover" />
      ) : (
        <span className="text-3xl leading-none">{typeIcon(item.type)}</span>
      )}
      <span className="text-xs text-text-secondary text-center line-clamp-2 max-w-[80px] leading-tight">{item.title}</span>
    </div>
  );
}

function CreateFolderModal({ projectId, parentFolderId, onClose, onCreated }: {
  projectId: string; parentFolderId: string | null; onClose: () => void; onCreated: (f: FolderType) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const handleCreate = async () => {
    if (!name.trim()) { setError("Name required."); return; }
    setSaving(true);
    try {
      const data = await createFolder(projectId, { name: name.trim(), parent_folder_id: parentFolderId });
      onCreated(data.folder as FolderType);
    } catch { setError("Failed to create folder."); setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.14 }} className="bg-bg-primary border border-border rounded-card shadow-2xl w-full max-w-sm mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary font-serif">New Folder</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1 rounded"><X size={14} /></button>
        </div>
        <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }} placeholder="Folder name" className="w-full px-3 py-2 rounded-card bg-bg-secondary border border-border text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent transition-warm mb-3" />
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary rounded-card hover:bg-bg-secondary transition-warm">Cancel</button>
          <button onClick={handleCreate} disabled={saving || !name.trim()} className="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-card hover:bg-accent/90 transition-warm disabled:opacity-50">{saving ? "Creating…" : "Create"}</button>
        </div>
      </motion.div>
    </div>
  );
}

function ContextMenu({
  menu,
  onClose,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onRemoveItem,
  onAddPdf,
  onAddUrl,
  onAddGdoc,
  onAddGithub,
  onAddImage,
}: {
  menu: CtxMenu;
  onClose: () => void;
  onNewFolder: () => void;
  onRenameFolder: (f: FolderType) => void;
  onDeleteFolder: (f: FolderType) => void;
  onRemoveItem: (i: FolderItem) => void;
  onAddPdf: () => void;
  onAddUrl: () => void;
  onAddGdoc: () => void;
  onAddGithub: () => void;
  onAddImage: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <motion.div ref={ref} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.1 }} className="fixed z-50 min-w-[180px] bg-bg-primary border border-border rounded-card shadow-xl py-1 text-sm" style={{ left: menu.x, top: menu.y }}>
      {menu.kind === "blank" && (
        <>
          <button onClick={() => { onClose(); onNewFolder(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><Plus size={13} /> New Folder</button>
          <div className="my-1 h-px bg-border" />
          <button onClick={() => { onClose(); onAddPdf(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><FileText size={13} /> Add PDF</button>
          <button onClick={() => { onClose(); onAddUrl(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><LinkIcon size={13} /> Add URL</button>
          <button onClick={() => { onClose(); onAddGdoc(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><Mail size={13} /> Add Google Doc</button>
          <button onClick={() => { onClose(); onAddGithub(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><Github size={13} /> Add GitHub Repo</button>
          <button onClick={() => { onClose(); onAddImage(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><ImageIcon size={13} /> Add Image</button>
        </>
      )}
      {menu.kind === "folder" && menu.target && (
        <>
          <button onClick={() => { onClose(); onRenameFolder(menu.target as FolderType); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><Pencil size={13} /> Rename</button>
          <button onClick={() => { onClose(); onDeleteFolder(menu.target as FolderType); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-warm"><Trash2 size={13} /> Delete Folder</button>
        </>
      )}
      {menu.kind === "item" && menu.target && (
        <>
          {(menu.target as FolderItem).url && <a href={(menu.target as FolderItem).url} target="_blank" rel="noopener noreferrer" onClick={onClose} className="w-full flex items-center gap-2 px-3 py-1.5 text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-warm"><ExternalLink size={13} /> Open Link</a>}
          <button onClick={() => { onClose(); onRemoveItem(menu.target as FolderItem); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-warm"><Trash2 size={13} /> Remove from Folder</button>
        </>
      )}
    </motion.div>
  );
}

export default function ProjectFolder() {
  const { projectId, folderId } = useParams<{ projectId: string; folderId?: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("icon");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<FolderType | null>(null);
  const [renameName, setRenameName] = useState("");
  const [crumbs, setCrumbs] = useState<{ id: string | null; name: string }[]>([]);

  const currentFolderId = folderId ?? null;
  const dragPayload = useRef<{ kind: "folder" | "item"; id: string; sourceFolderId: string | null } | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [projData, folderData] = await Promise.all([
        getProject(projectId),
        listFolders(projectId, currentFolderId),
      ]);
      const proj = projData.project as Project;
      setProject(proj);
      setFolders((folderData.folders as FolderType[]) || []);
      if (currentFolderId) {
        const itemData = await listFolderItems(projectId, currentFolderId);
        setItems((itemData.items as FolderItem[]) || []);
      } else {
        setItems([]);
      }
      const folderName = (folderData.folders as FolderType[]).find((f) => f.id === currentFolderId)?.name ?? (currentFolderId ? "Folder" : null);
      setCrumbs([{ id: null, name: proj.name }, ...(folderName ? [{ id: currentFolderId, name: folderName }] : [])]);
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId, currentFolderId]);

  useEffect(() => { load(); }, [load]);

  const allIds = [...folders.map((f) => f.id), ...items.map((i) => i.id)];

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!allIds.length) return;
    const idx = selectedId ? allIds.indexOf(selectedId) : -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setSelectedId(allIds[(idx + 1) % allIds.length]); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setSelectedId(allIds[(idx - 1 + allIds.length) % allIds.length]); }
    else if (e.key === "Enter" && selectedId) { const f = folders.find((f) => f.id === selectedId); if (f) navigate(`/projects/${projectId}/folders/${f.id}`); }
    else if (e.key === "Backspace") { navigate(-1); }
    else if ((e.metaKey || e.ctrlKey) && e.key === "v") {
      navigator.clipboard.readText().then((text) => {
        const ids = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        if (ids.length && currentFolderId && projectId) {
          Promise.all(ids.map((id) => addItemToFolder(projectId, currentFolderId, id))).then(load);
        }
      });
    }
  }, [allIds, selectedId, folders, projectId, currentFolderId, navigate, load]);

  const openCtx = (e: React.MouseEvent, kind: CtxMenu["kind"], target?: FolderType | FolderItem) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, kind, target });
  };

  const onFolderDragStart = (e: React.DragEvent, folder: FolderType) => {
    dragPayload.current = { kind: "folder", id: folder.id, sourceFolderId: currentFolderId };
    e.dataTransfer.effectAllowed = "move";
  };
  const onItemDragStart = (e: React.DragEvent, item: FolderItem) => {
    dragPayload.current = { kind: "item", id: item.id, sourceFolderId: currentFolderId };
    e.dataTransfer.effectAllowed = "move";
  };
  const onDropIntoFolder = async (e: React.DragEvent, targetFolder: FolderType) => {
    e.preventDefault();
    const p = dragPayload.current;
    if (!p || !projectId) return;
    try {
      if (p.kind === "folder") await moveFolder(projectId, p.id, targetFolder.id);
      else if (p.kind === "item" && p.sourceFolderId) await moveItemToFolder(projectId, p.id, p.sourceFolderId, targetFolder.id);
      load();
    } catch { /* ignore */ }
    dragPayload.current = null;
  };

  const confirmRename = async () => {
    if (!renamingFolder || !projectId) return;
    const trimmed = renameName.trim();
    if (trimmed && trimmed !== renamingFolder.name) await updateFolder(projectId, renamingFolder.id, { name: trimmed }).catch(() => {});
    setRenamingFolder(null);
    load();
  };
  const handleDeleteFolder = async (folder: FolderType) => {
    if (!projectId || !confirm(`Delete "${folder.name}" and all its contents?`)) return;
    await deleteFolder(projectId, folder.id).catch(() => {});
    load();
  };
  const handleRemoveItem = async (item: FolderItem) => {
    if (!projectId || !currentFolderId) return;
    await removeItemFromFolder(projectId, currentFolderId, item.id).catch(() => {});
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  // ── navigation helper: open an item inside the current project context ────
  const openItemInProject = useCallback(
    (itemId: string) => {
      if (!projectId) return;
      const params = new URLSearchParams({ project_id: projectId });
      if (currentFolderId) params.set("folder_id", currentFolderId);
      navigate(`/item/${itemId}?${params.toString()}`);
    },
    [projectId, currentFolderId, navigate]
  );

  // ── attach an ingested item to the current folder + refresh ───────────────
  const attachAndReload = useCallback(
    async (ingestedItemId: string | undefined) => {
      if (!projectId || !currentFolderId || !ingestedItemId) return;
      try {
        await addItemToFolder(projectId, currentFolderId, ingestedItemId);
      } catch {
        /* non-fatal — item was still ingested */
      }
      await load();
    },
    [projectId, currentFolderId, load]
  );

  // ── Add-X handlers (context menu on blank space) ──────────────────────────
  // Each prompts for input / opens a file picker, ingests via the existing
  // /ingest/* routes, then attaches to the current folder. If there is no
  // current folder (i.e. we are at the project root), we surface a notice
  // instead of silently failing — items must live in a folder.

  const requireFolder = useCallback(() => {
    if (!currentFolderId) {
      alert("Open a folder first — items must live inside a folder.");
      return false;
    }
    return true;
  }, [currentFolderId]);

  const handleAddPdf = useCallback(async () => {
    if (!requireFolder()) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await ingestPdf(file);
        const newItemId = (result.item as { id?: string } | undefined)?.id;
        await attachAndReload(newItemId);
      } catch {
        alert("PDF ingest failed.");
      }
    };
    input.click();
  }, [requireFolder, attachAndReload]);

  const handleAddUrl = useCallback(async () => {
    if (!requireFolder()) return;
    const url = window.prompt("Paste a URL to ingest:");
    if (!url) return;
    try {
      const result = (await ingestUrl({ url })) as { item?: { id?: string } };
      await attachAndReload(result.item?.id);
    } catch {
      alert("URL ingest failed.");
    }
  }, [requireFolder, attachAndReload]);

  const handleAddGdoc = useCallback(async () => {
    if (!requireFolder()) return;
    const url = window.prompt("Paste a Google Doc URL:");
    if (!url) return;
    try {
      const result = await ingestGdoc(url);
      await attachAndReload(result.item_id);
    } catch {
      alert("Google Doc ingest failed.");
    }
  }, [requireFolder, attachAndReload]);

  const handleAddGithub = useCallback(async () => {
    if (!requireFolder()) return;
    const url = window.prompt("Paste a GitHub repo URL:");
    if (!url) return;
    try {
      const result = await ingestGithub(url);
      await attachAndReload(result.item_id);
    } catch {
      alert("GitHub repo ingest failed.");
    }
  }, [requireFolder, attachAndReload]);

  const handleAddImage = useCallback(async () => {
    if (!requireFolder()) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await ingestResearchImage(file);
        await attachAndReload(result.item_id);
      } catch {
        alert("Image ingest failed.");
      }
    };
    input.click();
  }, [requireFolder, attachAndReload]);

  if (!projectId) return null;

  return (
    <div className="flex flex-col h-full outline-none" tabIndex={0} onKeyDown={handleKeyDown} onClick={() => { setSelectedId(null); setCtxMenu(null); }} onContextMenu={(e) => { if (e.target === e.currentTarget) openCtx(e, "blank"); }}>
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-bg-primary">
        <button onClick={(e) => { e.stopPropagation(); navigate(-1); }} className="p-1.5 rounded-card text-text-tertiary hover:text-text-primary hover:bg-bg-secondary transition-warm">
          <ArrowLeft size={15} />
        </button>
        <Breadcrumbs crumbs={crumbs} projectId={projectId} />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button onClick={(e) => { e.stopPropagation(); setViewMode("icon"); }} className={`p-1.5 rounded transition-warm ${viewMode === "icon" ? "bg-bg-secondary text-text-primary" : "text-text-tertiary hover:text-text-primary"}`} title="Icon view"><LayoutGrid size={15} /></button>
          <button onClick={(e) => { e.stopPropagation(); setViewMode("list"); }} className={`p-1.5 rounded transition-warm ${viewMode === "list" ? "bg-bg-secondary text-text-primary" : "text-text-tertiary hover:text-text-primary"}`} title="List view"><List size={15} /></button>
          <div className="w-px h-4 bg-border mx-1" />
          <button onClick={(e) => { e.stopPropagation(); setShowCreateFolder(true); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-card text-xs font-medium bg-accent text-white hover:bg-accent/90 transition-warm"><Plus size={13} /> New Folder</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-text-tertiary text-sm">Loading…</div>
        ) : folders.length === 0 && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Folder size={36} className="text-text-tertiary opacity-30 mb-3" />
            <p className="text-sm text-text-secondary">Empty folder</p>
            <p className="text-xs text-text-tertiary mt-1">Right-click to add a PDF, URL, Google Doc, GitHub repo, image, or subfolder.</p>
          </div>
        ) : viewMode === "icon" ? (
          <div className="p-4 flex flex-wrap gap-1 content-start" onContextMenu={(e) => { if (e.target === e.currentTarget) openCtx(e, "blank"); }}>
            <AnimatePresence mode="popLayout">
              {folders.map((folder) =>
                renamingFolder?.id === folder.id ? (
                  <div key={folder.id} className="flex flex-col items-center gap-1.5 p-3 w-[100px]" onClick={(e) => e.stopPropagation()}>
                    <Folder size={36} className="text-amber-400" />
                    <input autoFocus value={renameName} onChange={(e) => setRenameName(e.target.value)} onBlur={confirmRename} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingFolder(null); e.stopPropagation(); }} className="w-full text-xs text-center bg-bg-primary border border-accent rounded px-1 py-0.5 focus:outline-none" />
                  </div>
                ) : (
                  <motion.div key={folder.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} className="w-[100px]" onClick={(e) => e.stopPropagation()}>
                    <FolderIcon folder={folder} selected={selectedId === folder.id} onSelect={() => setSelectedId(folder.id)} onOpen={() => navigate(`/projects/${projectId}/folders/${folder.id}`)} onCtx={(e) => { setSelectedId(folder.id); openCtx(e, "folder", folder); }} onDragStart={(e) => onFolderDragStart(e, folder)} onDrop={(e) => onDropIntoFolder(e, folder)} />
                  </motion.div>
                )
              )}
              {items.map((item) => (
                <motion.div key={item.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} className="w-[100px]" onClick={(e) => e.stopPropagation()}>
                  <ItemIcon item={item} selected={selectedId === item.id} onSelect={() => setSelectedId(item.id)} onOpen={() => openItemInProject(item.id)} onCtx={(e) => { setSelectedId(item.id); openCtx(e, "item", item); }} onDragStart={(e) => onItemDragStart(e, item)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {folders.map((folder) => (
              <div key={folder.id} draggable onDragStart={(e) => onFolderDragStart(e, folder)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropIntoFolder(e, folder)} onContextMenu={(e) => { setSelectedId(folder.id); openCtx(e, "folder", folder); }} onClick={(e) => { e.stopPropagation(); setSelectedId(folder.id); }} onDoubleClick={() => navigate(`/projects/${projectId}/folders/${folder.id}`)} className={`flex items-center gap-3 px-6 py-2.5 cursor-pointer select-none transition-warm group ${selectedId === folder.id ? "bg-accent/8" : "hover:bg-bg-secondary"}`}>
                <GripVertical size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 shrink-0" />
                <Folder size={16} className="text-amber-400 shrink-0" />
                {renamingFolder?.id === folder.id ? (
                  <input autoFocus value={renameName} onChange={(e) => setRenameName(e.target.value)} onBlur={confirmRename} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingFolder(null); e.stopPropagation(); }} onClick={(e) => e.stopPropagation()} className="flex-1 text-sm bg-bg-primary border border-accent rounded px-2 py-0.5 focus:outline-none" />
                ) : (
                  <span className="flex-1 text-sm text-text-primary truncate">{folder.name}</span>
                )}
                {(folder.item_count ?? 0) > 0 && <span className="text-[11px] font-mono text-text-tertiary shrink-0">{folder.item_count} item{folder.item_count !== 1 ? "s" : ""}</span>}
              </div>
            ))}
            {items.map((item) => (
              <div key={item.id} draggable onDragStart={(e) => onItemDragStart(e, item)} onContextMenu={(e) => { setSelectedId(item.id); openCtx(e, "item", item); }} onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); }} onDoubleClick={() => openItemInProject(item.id)} className={`flex items-center gap-3 px-6 py-2.5 cursor-pointer select-none transition-warm group ${selectedId === item.id ? "bg-accent/8" : "hover:bg-bg-secondary"}`}>
                <GripVertical size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 shrink-0" />
                <span className="text-base leading-none shrink-0">{typeIcon(item.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{item.title}</p>
                  {item.domain && <p className="text-[11px] text-text-tertiary truncate">{item.domain}</p>}
                </div>
                <span className="text-[11px] font-mono text-text-tertiary uppercase shrink-0">{item.type}</span>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 rounded text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-warm shrink-0"><ExternalLink size={12} /></a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreateFolder && (
          <CreateFolderModal projectId={projectId} parentFolderId={currentFolderId} onClose={() => setShowCreateFolder(false)} onCreated={(folder) => { setShowCreateFolder(false); setFolders((prev) => [...prev, folder]); }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ctxMenu && (
          <ContextMenu
            menu={ctxMenu}
            onClose={() => setCtxMenu(null)}
            onNewFolder={() => setShowCreateFolder(true)}
            onRenameFolder={(folder) => { setRenamingFolder(folder); setRenameName(folder.name); }}
            onDeleteFolder={handleDeleteFolder}
            onRemoveItem={handleRemoveItem}
            onAddPdf={handleAddPdf}
            onAddUrl={handleAddUrl}
            onAddGdoc={handleAddGdoc}
            onAddGithub={handleAddGithub}
            onAddImage={handleAddImage}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
