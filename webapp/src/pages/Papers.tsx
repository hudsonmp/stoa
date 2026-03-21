import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { FileText, Plus, Upload, Loader2, X, Link as LinkIcon, Search, Zap } from "lucide-react";
import type { Item } from "@/lib/supabase";
import ItemRow from "@/components/ItemRow";
import { ingestUrl, ingestPdf, getPapersByTopic } from "@/lib/api";

/**
 * Normalize bare DOIs and arXiv IDs to full URLs.
 */
function normalizeInput(raw: string): string {
  const trimmed = raw.trim();
  if (/^10\.\d{4,}/.test(trimmed)) return `https://doi.org/${trimmed}`;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) return `https://arxiv.org/abs/${trimmed}`;
  return trimmed;
}

interface TopicGroup {
  papers: Item[];
  count: number;
}

export default function Papers() {
  const [groups, setGroups] = useState<Record<string, TopicGroup>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [quickInput, setQuickInput] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickSuccess, setQuickSuccess] = useState(false);

  const handleQuickAdd = async () => {
    const raw = quickInput.trim();
    if (!raw) return;
    setQuickLoading(true);
    try {
      const finalUrl = normalizeInput(raw);
      await ingestUrl({ url: finalUrl, type: "paper" });
      setQuickInput("");
      setQuickSuccess(true);
      setTimeout(() => setQuickSuccess(false), 2000);
      load();
    } catch {
      // Fall back to modal for errors
      setShowAdd(true);
    } finally {
      setQuickLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPapersByTopic();
      setGroups(data.groups as Record<string, TopicGroup>);
      setTotal(data.total);
    } catch {
      // fall through
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const topicEntries = Object.entries(groups).sort((a, b) => {
    // "Uncategorized" always last
    if (a[0] === "Uncategorized") return 1;
    if (b[0] === "Uncategorized") return -1;
    return b[1].count - a[1].count;
  });

  const topicCount = topicEntries.length;

  // Collect displayed papers: filter by topic, then by search query
  let displayed: Item[] = [];
  if (selectedTopic) {
    displayed = groups[selectedTopic]?.papers || [];
  } else {
    displayed = topicEntries.flatMap(([, g]) => g.papers);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    displayed = displayed.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.domain?.toLowerCase().includes(q)
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-text-primary">
              Papers
            </h1>
            <p className="text-sm text-text-tertiary mt-1">
              {total} paper{total !== 1 ? "s" : ""} across{" "}
              {topicCount} topic{topicCount !== 1 ? "s" : ""}
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

        {/* Quick Add bar */}
        <div className="mb-6">
          <form
            onSubmit={(e) => { e.preventDefault(); handleQuickAdd(); }}
            className="flex items-center gap-2"
          >
            <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-card
                            border border-border focus-within:border-accent/30 transition-warm
                            bg-bg-secondary/50">
              <Zap size={14} className="text-text-tertiary flex-shrink-0" />
              <input
                type="text"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                placeholder="Quick add: paste URL, DOI (10.xxx), or arXiv ID (2401.10020)"
                className="flex-1 bg-transparent border-none outline-none
                           text-sm text-text-primary placeholder:text-text-tertiary"
              />
              {quickLoading && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
              {quickSuccess && <span className="text-[11px] text-green-600 font-medium">Added</span>}
            </div>
            <button
              type="submit"
              disabled={!quickInput.trim() || quickLoading}
              className="px-3 py-2.5 rounded-card bg-accent text-white text-sm
                         font-medium hover:bg-accent-hover transition-warm
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </form>
        </div>

        {loading && total === 0 && (
          <p className="text-center py-20 text-sm text-text-tertiary">
            Loading...
          </p>
        )}

        {!loading && total === 0 && (
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

        {total > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Topic sidebar */}
            <div className="space-y-0.5 bg-bg-secondary/50 rounded-card p-2 border border-border-light">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest px-2 pt-1 pb-2">
                Topics
              </p>

              {/* Search */}
              <div className="px-2 pb-2">
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[6px]
                                bg-bg-primary border border-border">
                  <Search size={12} className="text-text-tertiary flex-shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter..."
                    className="flex-1 bg-transparent border-none outline-none
                               text-[12px] text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
              </div>

              <button
                onClick={() => setSelectedTopic(null)}
                className={`w-full text-left px-3 py-2 rounded-card text-sm font-medium transition-warm
                           ${
                             selectedTopic === null
                               ? "bg-bg-primary text-text-primary border-l-2 border-accent pl-[10px] shadow-sm"
                               : "text-text-secondary hover:bg-bg-primary/60 hover:text-text-primary"
                           }`}
              >
                <span className="flex items-center justify-between">
                  All
                  <span className="text-[11px] font-mono text-text-tertiary tabular-nums bg-bg-primary/80 px-1.5 py-0.5 rounded">
                    {total}
                  </span>
                </span>
              </button>

              <div className="h-px bg-border my-2 mx-1" />

              {topicEntries.map(([topic, group]) => (
                <button
                  key={topic}
                  onClick={() => setSelectedTopic(topic)}
                  className={`w-full text-left px-3 py-2 rounded-card text-sm font-medium transition-warm
                             ${
                               selectedTopic === topic
                                 ? "bg-bg-primary text-text-primary border-l-2 border-accent pl-[10px] shadow-sm"
                                 : "text-text-secondary hover:bg-bg-primary/60 hover:text-text-primary"
                             }`}
                >
                  <span className="flex items-center justify-between">
                    <span className="truncate">{topic}</span>
                    <span className="text-[11px] font-mono text-text-tertiary tabular-nums bg-bg-primary/80 px-1.5 py-0.5 rounded ml-2">
                      {group.count}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {/* Paper list */}
            <div className="md:col-span-3 space-y-0.5">
              {selectedTopic && (
                <div className="mb-4">
                  <h2 className="font-serif text-lg font-medium text-text-primary">
                    {selectedTopic}
                  </h2>
                </div>
              )}
              {displayed.length === 0 && searchQuery && (
                <p className="text-sm text-text-tertiary py-8 text-center">
                  No papers matching &ldquo;{searchQuery}&rdquo;
                </p>
              )}
              {displayed.map((item, i) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={i}
                  onDeleted={load}
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
            load();
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
        const finalUrl = normalizeInput(url);
        await ingestUrl({ url: finalUrl, type: "paper" });
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
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="URL, DOI (10.xxx), or arXiv ID (2401.10020)"
                  className="flex-1 bg-transparent border-none outline-none
                             text-sm text-text-primary placeholder:text-text-tertiary"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                arXiv, ACM DL, Springer, OpenReview, DOI, or direct PDF links
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
