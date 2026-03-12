"use client";

import { useState } from "react";
import { search as apiSearch, ragQuery } from "@/lib/api";
import Link from "next/link";
import { ArrowLeft, Search, Sparkles, Loader2 } from "lucide-react";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<unknown[]>([]);
  const [ragAnswer, setRagAnswer] = useState("");
  const [ragSources, setRagSources] = useState<unknown[]>([]);
  const [mode, setMode] = useState<"search" | "rag">("search");
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);

    try {
      if (mode === "search") {
        const data = await apiSearch({
          query,
          user_id: "", // TODO: get from auth
          limit: 20,
        });
        setResults(data.results);
        setRagAnswer("");
      } else {
        const data = await ragQuery(query, "");
        setRagAnswer(data.answer);
        setRagSources(data.sources);
        setResults([]);
      }
    } catch {
      // API may not be running
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen max-w-3xl mx-auto p-8">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted
                  hover:text-foreground mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        Library
      </Link>

      <h1 className="text-xl font-bold mb-6">Search</h1>

      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setMode("search")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                    font-medium transition-colors ${
                      mode === "search"
                        ? "bg-accent-dim text-accent"
                        : "text-muted hover:text-foreground"
                    }`}
        >
          <Search size={14} />
          Search
        </button>
        <button
          onClick={() => setMode("rag")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                    font-medium transition-colors ${
                      mode === "rag"
                        ? "bg-accent-dim text-accent"
                        : "text-muted hover:text-foreground"
                    }`}
        >
          <Sparkles size={14} />
          Ask (RAG)
        </button>
      </div>

      {/* Search input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={
            mode === "search"
              ? "Search your library..."
              : "Ask a question about your knowledge base..."
          }
          className="flex-1 px-4 py-3 rounded-lg border border-border bg-surface
                    text-sm outline-none focus:border-accent"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-5 py-3 rounded-lg bg-accent text-white text-sm
                    font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Go"}
        </button>
      </div>

      {/* RAG Answer */}
      {ragAnswer && (
        <div className="mb-6 p-5 rounded-xl bg-surface border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-accent" />
            <span className="text-xs font-medium text-accent uppercase
                          tracking-wider">
              Answer
            </span>
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {ragAnswer}
          </div>
          {ragSources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <span className="text-[10px] text-muted uppercase tracking-wider">
                Sources
              </span>
              <div className="mt-1 space-y-1">
                {ragSources.map((s: unknown, i: number) => {
                  const source = s as { title: string; url?: string; id?: string };
                  return (
                    <div
                      key={i}
                      className="text-xs text-muted hover:text-foreground"
                    >
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.title}
                        </a>
                      ) : (
                        source.title
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search results */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r: unknown, i: number) => {
            const result = r as {
              title?: string;
              url?: string;
              chunk_text?: string;
              id?: string;
              item_id?: string;
            };
            return (
              <div
                key={i}
                className="p-3 rounded-lg border border-border bg-surface
                          hover:border-accent/30 transition-colors"
              >
                <h3 className="text-sm font-medium">{result.title || "Untitled"}</h3>
                {result.chunk_text && (
                  <p className="text-xs text-muted mt-1 line-clamp-2">
                    {result.chunk_text}
                  </p>
                )}
                {result.url && (
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-accent mt-1 inline-block"
                  >
                    {result.url}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
