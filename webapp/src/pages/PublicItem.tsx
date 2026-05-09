import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Globe,
  MessageCircle,
  Video,
  Headphones,
  PenLine,
  Bookmark,
  ExternalLink,
  Highlighter,
} from "lucide-react";
import { getPublicItem } from "@/lib/api";

const typeIcons: Record<string, typeof BookOpen> = {
  book: BookOpen,
  blog: FileText,
  paper: FileText,
  podcast: Headphones,
  page: Globe,
  tweet: MessageCircle,
  video: Video,
  writing: PenLine,
};

type PublicItemResponse = Awaited<ReturnType<typeof getPublicItem>>;

export default function PublicItem() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicItemResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    getPublicItem(token)
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="reader-loading">
        <div className="reader-loading-pulse" />
        <div className="reader-loading-pulse short" />
        <div className="reader-loading-pulse" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h1 className="font-serif text-2xl text-text-primary mb-2">
            This link isn't active.
          </h1>
          <p className="text-sm text-text-secondary">
            The owner may have disabled sharing, or the link may have been rotated.
          </p>
          <Link
            to="/"
            className="inline-block mt-6 text-sm text-accent hover:text-accent-hover transition-warm"
          >
            Go to Stoa
          </Link>
        </div>
      </div>
    );
  }

  const { item, highlights, source_note, citation, owner } = data;
  const Icon = typeIcons[item.type] || Bookmark;

  // Prefer the curator's source note; fall back to the item's summary;
  // fall back to the extracted text for papers/articles.
  const bodyHtml = source_note?.content || "";
  const summary = item.summary || "";
  const extractedText = item.extracted_text || "";

  return (
    <div className="reader-page min-h-screen" data-reader-scroll>
      {/* Top bar */}
      <div className="reader-topbar">
        <Link to="/" className="reader-back">
          <ArrowLeft size={14} />
          Stoa
        </Link>
        <div className="reader-topbar-actions">
          {highlights.length > 0 && (
            <span className="reader-hl-toggle" aria-label="highlight count">
              <Highlighter size={14} />
              {highlights.length}
            </span>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="reader-external-link"
            >
              <ExternalLink size={12} />
              Original
            </a>
          )}
        </div>
      </div>

      <div className="reader-body">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="reader-content-wrapper"
        >
          {/* Header */}
          <header className="reader-header">
            {item.cover_image_url ? (
              <img
                src={item.cover_image_url}
                alt={item.title}
                className="reader-cover"
              />
            ) : (
              <div className="reader-icon-wrap">
                <Icon size={20} className="text-text-tertiary" />
              </div>
            )}

            <div className="reader-header-text">
              <h1 className="reader-title">{item.title}</h1>

              <div className="reader-header-meta">
                {item.domain && (
                  <span className="reader-domain">{item.domain}</span>
                )}
                <span className="px-2 py-0.5 rounded-tag text-[11px] font-sans capitalize bg-accent/10 text-accent">
                  {item.type}
                </span>
              </div>

              {owner && (
                <p className="mt-3 text-[12px] text-text-tertiary">
                  Shared by{" "}
                  <Link
                    to={`/@${owner.username}`}
                    className="text-accent hover:text-accent-hover transition-warm"
                  >
                    {owner.display_name || owner.username}
                  </Link>
                  {item.public_shared_at && (
                    <span>
                      {" "}· {new Date(item.public_shared_at).toLocaleDateString()}
                    </span>
                  )}
                </p>
              )}
            </div>
          </header>

          {/* Citation metadata */}
          {citation && (
            <section className="mb-8 pb-6 border-b border-border">
              {citation.authors && citation.authors.length > 0 && (
                <p className="text-sm text-text-secondary mb-1">
                  {citation.authors.map((a) => a.name).join(", ")}
                  {citation.year && ` · ${citation.year}`}
                </p>
              )}
              {citation.venue && (
                <p className="text-[12px] text-text-tertiary italic">
                  {citation.venue}
                </p>
              )}
              {citation.abstract && (
                <p className="mt-3 text-sm text-text-secondary leading-relaxed">
                  {citation.abstract}
                </p>
              )}
            </section>
          )}

          {/* Source note (curator's write-up) */}
          {bodyHtml && (
            <section className="prose-reader mb-10">
              <div
                className="text-text-primary leading-relaxed"
                // Content is HTML produced by the curator's own rich-text
                // editor in ItemDetail; the owner is trusted for their
                // own item.
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </section>
          )}

          {/* Fallback: summary */}
          {!bodyHtml && summary && (
            <section className="mb-10">
              <p className="text-text-primary leading-relaxed whitespace-pre-wrap">
                {summary}
              </p>
            </section>
          )}

          {/* Highlights */}
          {highlights.length > 0 && (
            <section className="mb-10">
              <h2 className="font-serif text-lg text-text-primary mb-4">
                Highlights
              </h2>
              <ul className="space-y-4">
                {highlights.map((h) => (
                  <li
                    key={h.id}
                    className="pl-4 border-l-2 border-accent/40 py-1"
                  >
                    <blockquote className="text-text-primary italic leading-relaxed">
                      "{h.text}"
                    </blockquote>
                    {h.note && (
                      <p className="mt-2 text-[13px] text-text-secondary not-italic">
                        {h.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Fallback: extracted text, clipped */}
          {!bodyHtml && !summary && extractedText && (
            <section className="mb-10">
              <p className="text-text-primary leading-relaxed whitespace-pre-wrap">
                {extractedText.slice(0, 4000)}
                {extractedText.length > 4000 && "…"}
              </p>
            </section>
          )}

          {/* Footer attribution */}
          <footer className="mt-16 pt-6 border-t border-border text-center text-[12px] text-text-tertiary">
            Curated with{" "}
            <Link
              to="/"
              className="text-accent hover:text-accent-hover transition-warm"
            >
              Stoa
            </Link>
          </footer>
        </motion.div>
      </div>
    </div>
  );
}
