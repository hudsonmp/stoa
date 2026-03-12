"use client";

import { useState } from "react";
import { FileDown, Upload, Copy, Check } from "lucide-react";
import { exportBibtex, importBibtex, ingestArxiv } from "@/lib/api";

interface CitationManagerProps {
  userId: string;
  onImport?: () => void;
}

export default function CitationManager({
  userId,
  onImport,
}: CitationManagerProps) {
  const [arxivInput, setArxivInput] = useState("");
  const [bibtexInput, setBibtexInput] = useState("");
  const [mode, setMode] = useState<"arxiv" | "bibtex" | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleArxivSubmit = async () => {
    if (!arxivInput.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      await ingestArxiv(arxivInput.trim(), userId);
      setStatus("Paper added");
      setArxivInput("");
      onImport?.();
    } catch {
      setStatus("Failed to add paper");
    }
    setLoading(false);
  };

  const handleBibtexImport = async () => {
    if (!bibtexInput.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const result = await importBibtex(bibtexInput.trim(), userId);
      setStatus(`Imported ${(result as { imported: number }).imported} papers`);
      setBibtexInput("");
      onImport?.();
    } catch {
      setStatus("Failed to import");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode(mode === "arxiv" ? null : "arxiv")}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                     border transition-colors ${
                       mode === "arxiv"
                         ? "border-accent bg-accent-dim text-accent"
                         : "border-border text-muted hover:text-foreground"
                     }`}
        >
          <FileDown size={14} />
          arXiv / DOI
        </button>
        <button
          onClick={() => setMode(mode === "bibtex" ? null : "bibtex")}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                     border transition-colors ${
                       mode === "bibtex"
                         ? "border-accent bg-accent-dim text-accent"
                         : "border-border text-muted hover:text-foreground"
                     }`}
        >
          <Upload size={14} />
          BibTeX Import
        </button>
      </div>

      {/* arXiv input */}
      {mode === "arxiv" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={arxivInput}
            onChange={(e) => setArxivInput(e.target.value)}
            placeholder="arXiv ID (e.g., 2301.00234)"
            className="flex-1 px-3 py-2 rounded-lg border border-border
                       bg-surface text-sm outline-none focus:border-accent"
            onKeyDown={(e) => e.key === "Enter" && handleArxivSubmit()}
          />
          <button
            onClick={handleArxivSubmit}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm
                       font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "..." : "Add"}
          </button>
        </div>
      )}

      {/* BibTeX input */}
      {mode === "bibtex" && (
        <div className="space-y-2">
          <textarea
            value={bibtexInput}
            onChange={(e) => setBibtexInput(e.target.value)}
            placeholder="Paste BibTeX entries..."
            rows={6}
            className="w-full px-3 py-2 rounded-lg border border-border
                       bg-surface text-sm font-mono outline-none
                       focus:border-accent resize-none"
          />
          <button
            onClick={handleBibtexImport}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm
                       font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Importing..." : "Import"}
          </button>
        </div>
      )}

      {/* Status */}
      {status && (
        <p className="text-xs text-muted">{status}</p>
      )}
    </div>
  );
}

export function CopyBibtexButton({ itemId }: { itemId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const { bibtex } = await exportBibtex(itemId);
      await navigator.clipboard.writeText(bibtex);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs
                 text-muted hover:text-foreground border border-border
                 hover:border-accent/30 transition-colors"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "BibTeX"}
    </button>
  );
}
