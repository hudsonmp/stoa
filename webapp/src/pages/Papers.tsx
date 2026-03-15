import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { FileText, Plus, Upload, Loader2, X, Link as LinkIcon } from "lucide-react";
import type { Item } from "@/lib/supabase";
import ItemRow from "@/components/ItemRow";
import { ingestUrl, ingestPdf } from "@/lib/api";
import { useItems } from "@/hooks/useItems";

/** Known academic sources → display label */
const SOURCE_LABELS: Record<string, string> = {
  "arxiv.org": "arXiv",
  "dl.acm.org": "ACM DL",
  "link.springer.com": "Springer",
  "ieeexplore.ieee.org": "IEEE Xplore",
  "aclanthology.org": "ACL Anthology",
  "openreview.net": "OpenReview",
  "semanticscholar.org": "Semantic Scholar",
  "scholar.google.com": "Google Scholar",
  "nature.com": "Nature",
  "science.org": "Science",
  "proceedings.mlr.press": "PMLR",
  "papers.nips.cc": "NeurIPS",
};

function getSourceKey(domain?: string): string {
  if (!domain) return "other";
  for (const key of Object.keys(SOURCE_LABELS)) {
    if (domain.includes(key)) return key;
  }
  return domain;
}

function getSourceLabel(key: string): string {
  return SOURCE_LABELS[key] || key;
}

export default function Papers() {
  const { items: papers, loading, reload } = useItems(undefined, "paper");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const grouped = useMemo(() => {
    const groups: Record<string, Item[]> = {};
    for (const p of papers) {
      const key = getSourceKey(p.domain);
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    // Sort groups by count descending
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [papers]);

  const displayed = selectedSource
    ? papers.filter((p) => getSourceKey(p.domain) === selectedSource)
    : papers;

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-text-primary">
              Papers
            </h1>
            <p className="text-sm text-text-tertiary mt-1">
              {papers.length} paper{papers.length !== 1 ? "s" : ""} across{" "}
              {grouped.length} source{grouped.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-card
                       bg-accent text-white text-sm font-medium
                       hover:bg-accent-hover transition-warm"
          >
            <Plus size={14} />
            Add Paper
          </button>
        </div>

        {loading && papers.length === 0 && (
          <p className="text-center py-20 text-sm text-text-tertiary">
            Loading...
          </p>
        )}

        {!loading && papers.length === 0 && (
          <div className="text-center py-20">
            <FileText size={32} className="mx-auto mb-4 text-text-tertiary/40" />
            <p className="font-serif text-sm text-text-secondary">
              No papers yet
            </p>
            <p className="text-[12px] text-text-tertiary mt-1">
              Add a paper URL or upload a PDF
            </p>
          </div>
        )}

        {papers.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Source sidebar */}
            <div className="space-y-0.5 bg-bg-secondary/50 rounded-card p-2 border border-border-light">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest px-2 pt-1 pb-2">
                Sources
              </p>
              <button
                onClick={() => setSelectedSource(null)}
                className={`w-full text-left px-3 py-2 rounded-card text-sm font-medium transition-warm
                           ${
                             selectedSource === null
                               ? "bg-bg-primary text-text-primary border-l-2 border-accent pl-[10px] shadow-sm"
                               : "text-text-secondary hover:bg-bg-primary/60 hover:text-text-primary"
                           }`}
              >
                <span className="flex items-center justify-between">
                  All
                  <span className="text-[11px] font-mono text-text-tertiary tabular-nums bg-bg-primary/80 px-1.5 py-0.5 rounded">
                    {papers.length}
                  </span>
                </span>
              </button>

              <div className="h-px bg-border my-2 mx-1" />

              {grouped.map(([sourceKey, items]) => (
                <button
                  key={sourceKey}
                  onClick={() => setSelectedSource(sourceKey)}
                  className={`w-full text-left px-3 py-2 rounded-card text-sm font-medium transition-warm
                             ${
                               selectedSource === sourceKey
                                 ? "bg-bg-primary text-text-primary border-l-2 border-accent pl-[10px] shadow-sm"
                                 : "text-text-secondary hover:bg-bg-primary/60 hover:text-text-primary"
                             }`}
                >
                  <span className="flex items-center justify-between">
                    <span className="truncate">{getSourceLabel(sourceKey)}</span>
                    <span className="text-[11px] font-mono text-text-tertiary tabular-nums bg-bg-primary/80 px-1.5 py-0.5 rounded ml-2">
                      {items.length}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {/* Paper list */}
            <div className="md:col-span-3 space-y-0.5">
              {selectedSource && (
                <div className="mb-4">
                  <h2 className="font-serif text-lg font-medium text-text-primary">
                    {getSourceLabel(selectedSource)}
                  </h2>
                </div>
              )}
              {displayed.map((item, i) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={i}
                  onDeleted={reload}
                />
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Add Paper modal */}
      {showAdd && (
        <AddPaperModal
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/* ─── Add Paper Modal ─── */
function AddPaperModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<"url" | "pdf">("url");
  const [url, setUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "url") {
        if (!url.trim()) return;
        await ingestUrl({ url, type: "paper" });
      } else {
        if (!pdfFile) return;
        await ingestPdf(pdfFile, title || undefined);
      }
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add paper");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    !loading && ((mode === "url" && url.trim()) || (mode === "pdf" && pdfFile));

  return (
    <>
      <div
        className="fixed inset-0 bg-text-primary/20 z-50"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-bg-primary border border-border rounded-modal
                     shadow-warm-lg w-full max-w-md p-6 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-medium">Add Paper</h2>
            <button onClick={onClose}>
              <X size={16} className="text-text-tertiary" />
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 bg-bg-secondary rounded-card">
            {([
              { key: "url" as const, icon: LinkIcon, label: "URL" },
              { key: "pdf" as const, icon: Upload, label: "PDF Upload" },
            ]).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[6px]
                            text-[12px] font-sans font-medium transition-warm
                            ${
                              mode === key
                                ? "bg-bg-primary text-text-primary shadow-sm"
                                : "text-text-tertiary hover:text-text-secondary"
                            }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {mode === "url" && (
            <div>
              <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                Paper URL
              </label>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-card border border-border
                              focus-within:border-accent/30 transition-warm">
                <LinkIcon size={14} className="text-text-tertiary flex-shrink-0" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://arxiv.org/abs/..."
                  className="flex-1 bg-transparent border-none outline-none
                             text-sm text-text-primary placeholder:text-text-tertiary"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                arXiv, ACM DL, Springer, OpenReview, or direct PDF links
              </p>
            </div>
          )}

          {mode === "pdf" && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 block">
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Paper title..."
                  className="w-full px-3 py-2 rounded-card border border-border
                             bg-transparent text-sm text-text-primary
                             placeholder:text-text-tertiary outline-none
                             focus:border-accent/30 transition-warm"
                />
              </div>
              <div
                className="border-2 border-dashed border-border rounded-card p-6
                           flex flex-col items-center justify-center gap-2
                           hover:border-accent/30 transition-warm cursor-pointer min-h-[100px]"
                onClick={() => document.getElementById("pdf-input")?.click()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file?.type === "application/pdf") setPdfFile(file);
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                {pdfFile ? (
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-accent" />
                    <span className="text-sm text-text-primary">{pdfFile.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPdfFile(null); }}
                      className="text-text-tertiary hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload size={24} className="text-text-tertiary" />
                    <p className="text-sm text-text-tertiary">
                      Drop a PDF or click to browse
                    </p>
                  </>
                )}
                <input
                  id="pdf-input"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setPdfFile(file);
                  }}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-2.5 rounded-card bg-accent text-white text-sm
                       font-medium hover:bg-accent-hover transition-warm
                       disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Adding..." : "Add Paper"}
          </button>
        </motion.div>
      </div>
    </>
  );
}
