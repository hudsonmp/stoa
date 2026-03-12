"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Item, Highlight, Citation, Note } from "@/lib/supabase";
import HighlightPanel from "@/components/HighlightPanel";
import NoteEditor from "@/components/NoteEditor";
import { CopyBibtexButton } from "@/components/CitationManager";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  BookOpen,
  Clock,
  CheckCircle,
} from "lucide-react";

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [tab, setTab] = useState<"content" | "highlights" | "notes">(
    "content"
  );

  useEffect(() => {
    if (id) loadItem();
  }, [id]);

  const loadItem = async () => {
    const { data: itemData } = await supabase
      .from("items")
      .select("*")
      .eq("id", id)
      .single();
    setItem(itemData);

    const { data: highlightsData } = await supabase
      .from("highlights")
      .select("*")
      .eq("item_id", id)
      .order("created_at", { ascending: false });
    setHighlights(highlightsData || []);

    const { data: citationData } = await supabase
      .from("citations")
      .select("*")
      .eq("item_id", id)
      .limit(1);
    if (citationData && citationData.length > 0) {
      setCitation(citationData[0]);
    }

    const { data: notesData } = await supabase
      .from("notes")
      .select("content")
      .eq("item_id", id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (notesData && notesData.length > 0) {
      setNoteContent(notesData[0].content);
    }
  };

  const updateStatus = async (status: string) => {
    if (!item) return;
    await supabase.from("items").update({ reading_status: status }).eq("id", id);
    setItem({ ...item, reading_status: status as Item["reading_status"] });
  };

  if (!item) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Main reading area */}
      <div className="flex-1 max-w-3xl mx-auto p-8">
        {/* Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted
                    hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Library
        </Link>

        {/* Item header */}
        <header className="mb-8">
          <h1 className="text-2xl font-bold leading-tight">{item.title}</h1>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {item.domain && (
              <span className="text-sm text-muted">{item.domain}</span>
            )}
            <span className="text-sm text-muted/60">
              {new Date(item.created_at).toLocaleDateString()}
            </span>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-accent
                          hover:opacity-80 transition-opacity"
              >
                <ExternalLink size={12} />
                Open original
              </a>
            )}
          </div>

          {/* Status toggles */}
          <div className="flex items-center gap-2 mt-4">
            {[
              { key: "to_read", label: "To Read", icon: BookOpen },
              { key: "reading", label: "Reading", icon: Clock },
              { key: "read", label: "Read", icon: CheckCircle },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => updateStatus(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                          text-xs font-medium transition-colors border ${
                            item.reading_status === key
                              ? "border-accent bg-accent-dim text-accent"
                              : "border-border text-muted hover:text-foreground"
                          }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          {/* Citation info */}
          {citation && (
            <div className="mt-4 p-3 rounded-lg bg-surface border border-border
                          text-sm space-y-1">
              {citation.authors && (
                <p className="text-muted">
                  {citation.authors.map((a) => a.name).join(", ")}
                </p>
              )}
              <div className="flex items-center gap-2 text-xs text-muted/60">
                {citation.year && <span>{citation.year}</span>}
                {citation.venue && <span>{citation.venue}</span>}
                {citation.arxiv_id && <span>arXiv:{citation.arxiv_id}</span>}
                {citation.doi && <span>DOI:{citation.doi}</span>}
              </div>
              {citation.abstract && (
                <p className="text-xs text-muted leading-relaxed mt-2">
                  {citation.abstract.substring(0, 300)}...
                </p>
              )}
              <CopyBibtexButton itemId={item.id} />
            </div>
          )}
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          {[
            { key: "content" as const, label: "Content" },
            {
              key: "highlights" as const,
              label: `Highlights (${highlights.length})`,
            },
            { key: "notes" as const, label: "Notes" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2
                        transition-colors ${
                          tab === key
                            ? "border-accent text-accent"
                            : "border-transparent text-muted hover:text-foreground"
                        }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "content" && (
          <article className="prose prose-invert prose-sm max-w-none">
            {item.summary && (
              <div className="mb-6 p-4 rounded-lg bg-accent-dim border
                            border-accent/20 text-sm leading-relaxed">
                <strong className="text-accent text-xs uppercase
                                  tracking-wider">
                  Summary
                </strong>
                <p className="mt-2 text-foreground/80">{item.summary}</p>
              </div>
            )}
            {item.extracted_text ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed
                            text-foreground/80">
                {item.extracted_text}
              </div>
            ) : (
              <p className="text-muted text-sm">No extracted content available.</p>
            )}
          </article>
        )}

        {tab === "highlights" && <HighlightPanel highlights={highlights} />}

        {tab === "notes" && (
          <NoteEditor
            content={noteContent}
            onChange={setNoteContent}
            placeholder="Write notes about this item..."
          />
        )}
      </div>
    </div>
  );
}
