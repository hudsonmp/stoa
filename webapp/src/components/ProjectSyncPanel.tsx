import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { FolderSync, FolderOpen, Check, AlertTriangle, Loader2, X, RefreshCw, CloudOff } from "lucide-react";
import {
  enableProjectSync,
  disableProjectSync,
  pullProjectSync,
  pushProjectSync,
  getProjectSyncStatus,
  resolveSyncConflict,
  type SyncStatus,
} from "@/lib/api";

interface Props {
  projectId: string;
  projectSlug: string;   // used for the suggested default path
  onClose: () => void;
}

// Default suggestion per spec Stage 4: ~/Desktop/Stoa/<project-slug>/
function defaultPath(slug: string): string {
  return `~/Desktop/Stoa/${slug || "untitled-project"}`;
}

// File System Access API (Chromium) feature detection.
// Falls back to a text input on Safari/Firefox.
type DirHandle = { name: string };
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: Record<string, unknown>) => Promise<DirHandle>;
  }
}

export default function ProjectSyncPanel({ projectId, projectSlug, onClose }: Props) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [pathInput, setPathInput] = useState<string>(defaultPath(projectSlug));
  const [error, setError] = useState<string>("");
  const [flash, setFlash] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const s = await getProjectSyncStatus(projectId);
      setStatus(s);
      if (s.sync_path) setPathInput(s.sync_path);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const canPickDirectory = typeof window !== "undefined" && !!window.showDirectoryPicker;

  const pickDirectory = async () => {
    if (!window.showDirectoryPicker) return;
    try {
      // Chromium returns only a handle; we cannot recover an OS path from it.
      // But we can show the user the chosen name and let them confirm the full
      // path manually, which preserves the mental model (File > Save As).
      const h = await window.showDirectoryPicker({ mode: "readwrite" });
      setPathInput(`~/Desktop/Stoa/${h.name}`);
      setFlash(`Chose "${h.name}". Confirm full path below, then Enable.`);
    } catch {
      /* user cancelled */
    }
  };

  const enable = async () => {
    setWorking(true);
    setError("");
    try {
      const res = await enableProjectSync(projectId, pathInput.trim());
      setStatus(res.status);
      setFlash(`Enabled. Initial scan: ${JSON.stringify(res.initial_scan)}`);
    } catch (e) {
      setError((e as Error).message);
    }
    setWorking(false);
  };

  const disable = async () => {
    if (!confirm("Disable sync? Local files remain on disk; Stoa-side state is preserved.")) return;
    setWorking(true);
    try {
      await disableProjectSync(projectId);
      await load();
      setFlash("Sync disabled. Files are still on disk.");
    } catch (e) { setError((e as Error).message); }
    setWorking(false);
  };

  const pull = async () => {
    setWorking(true);
    try {
      const res = await pullProjectSync(projectId);
      setStatus(res.status);
      setFlash(`Pulled: ${summarizeScan(res.scan)}`);
    } catch (e) { setError((e as Error).message); }
    setWorking(false);
  };

  const push = async () => {
    setWorking(true);
    try {
      const res = await pushProjectSync(projectId);
      setStatus(res.status);
      setFlash(`Pushed: ${summarizeScan(res.push)}`);
    } catch (e) { setError((e as Error).message); }
    setWorking(false);
  };

  const resolve = async (choice: "local" | "stoa" | "both", target: { item_id?: string | null; note_id?: string | null }) => {
    setWorking(true);
    try {
      const res = await resolveSyncConflict(projectId, choice, {
        item_id: target.item_id || undefined,
        note_id: target.note_id || undefined,
      });
      setStatus(res.status);
      setFlash(`Resolved: ${res.resolved}`);
    } catch (e) { setError((e as Error).message); }
    setWorking(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-bg-primary border border-border rounded-card shadow-2xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <FolderSync size={18} className="text-accent" />
            <h2 className="text-base font-semibold text-text-primary font-serif">Sync to folder</h2>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1 rounded">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm py-4">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Explainer */}
            <p className="text-xs text-text-tertiary mb-4 leading-relaxed">
              Pick a local folder; Stoa keeps it in sync with this project's files. Highlights,
              annotations and @mentions live in the hidden <code className="text-[10.5px] font-mono">.stoa/</code> directory
              — PDFs stay untouched so Preview.app and GoodNotes read them unmodified.
            </p>

            {/* Path picker */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Local folder path</label>
                <div className="flex gap-2">
                  <input
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                    placeholder="~/Desktop/Stoa/project-slug/"
                    className="flex-1 px-3 py-2 rounded-card bg-bg-secondary border border-border text-sm font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {canPickDirectory && (
                    <button onClick={pickDirectory} className="px-3 py-2 rounded-card bg-bg-secondary hover:bg-bg-tertiary border border-border text-text-secondary text-xs flex items-center gap-1">
                      <FolderOpen size={14} /> Browse
                    </button>
                  )}
                </div>
                <p className="text-[10.5px] text-text-tertiary mt-1 font-mono">
                  Tip: <code>~/Desktop/…</code> and <code>~/Library/Mobile Documents/…</code> are
                  mirrored by iCloud Drive automatically.
                </p>
              </div>

              {/* Status row */}
              <StatusRow status={status} />

              {/* Actions */}
              <div className="flex gap-2 flex-wrap pt-2">
                {!status?.enabled ? (
                  <button
                    onClick={enable}
                    disabled={working || !pathInput.trim()}
                    className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-card hover:bg-accent/90 transition-warm disabled:opacity-50"
                  >
                    {working ? "Enabling…" : "Enable sync"}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={pull}
                      disabled={working}
                      className="px-3 py-2 text-sm bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-card transition-warm flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw size={13} /> Pull now
                    </button>
                    <button
                      onClick={push}
                      disabled={working}
                      className="px-3 py-2 text-sm bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-card transition-warm disabled:opacity-50"
                    >
                      Push now
                    </button>
                    <button
                      onClick={disable}
                      disabled={working}
                      className="ml-auto px-3 py-2 text-sm text-red-500 hover:text-red-600 rounded-card transition-warm flex items-center gap-1 disabled:opacity-50"
                    >
                      <CloudOff size={13} /> Disable
                    </button>
                  </>
                )}
              </div>

              {/* Conflicts */}
              {status?.conflicts?.length ? (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-amber-500 text-sm font-medium mb-2">
                    <AlertTriangle size={14} /> {status.conflicts.length} conflict{status.conflicts.length === 1 ? "" : "s"} needing review
                  </div>
                  <ul className="space-y-2">
                    {status.conflicts.map((c) => (
                      <li key={c.local_path} className="bg-bg-secondary border border-border rounded p-2 text-xs">
                        <div className="font-mono break-all text-text-primary mb-1">{c.local_path}</div>
                        {c.reason && <div className="text-text-tertiary mb-2">{c.reason}</div>}
                        <div className="flex gap-1">
                          <button
                            onClick={() => resolve("local", { item_id: c.item_id ?? undefined, note_id: c.note_id ?? undefined })}
                            className="px-2 py-1 text-[11px] rounded bg-bg-primary border border-border hover:border-accent"
                          >Keep local</button>
                          <button
                            onClick={() => resolve("stoa", { item_id: c.item_id ?? undefined, note_id: c.note_id ?? undefined })}
                            className="px-2 py-1 text-[11px] rounded bg-bg-primary border border-border hover:border-accent"
                          >Keep Stoa</button>
                          <button
                            onClick={() => resolve("both", { item_id: c.item_id ?? undefined, note_id: c.note_id ?? undefined })}
                            className="px-2 py-1 text-[11px] rounded bg-bg-primary border border-border hover:border-accent"
                          >Keep both</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {error && <div className="mt-3 text-xs text-red-500">{error}</div>}
              {flash && <div className="mt-3 text-xs text-text-tertiary font-mono">{flash}</div>}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

function StatusRow({ status }: { status: SyncStatus | null }) {
  if (!status) return null;
  const enabled = !!(status.enabled || status.watcher_running);
  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-secondary rounded-card px-3 py-2 border border-border">
      {enabled ? (
        <>
          <Check size={13} className="text-emerald-500" />
          <span>
            {status.entry_count} item{status.entry_count === 1 ? "" : "s"} synced
            {status.conflict_count > 0 ? ` · ${status.conflict_count} conflict${status.conflict_count === 1 ? "" : "s"}` : ""}
          </span>
          {status.watcher_running && <span className="ml-auto text-[10.5px] text-text-tertiary">watcher live</span>}
        </>
      ) : (
        <>
          <CloudOff size={13} className="text-text-tertiary" />
          <span>Sync is off for this project.</span>
        </>
      )}
    </div>
  );
}

function summarizeScan(s: { scanned: number; pushed_to_stoa: number; pushed_to_disk: number; updated: number; conflicts: number; soft_deleted: number }) {
  const parts: string[] = [];
  if (s.scanned) parts.push(`${s.scanned} scanned`);
  if (s.pushed_to_stoa) parts.push(`${s.pushed_to_stoa} → Stoa`);
  if (s.pushed_to_disk) parts.push(`${s.pushed_to_disk} → disk`);
  if (s.updated) parts.push(`${s.updated} updated`);
  if (s.conflicts) parts.push(`${s.conflicts} conflicts`);
  if (s.soft_deleted) parts.push(`${s.soft_deleted} deleted`);
  return parts.join(", ") || "no changes";
}
