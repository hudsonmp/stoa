import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Star, Plus, X, Mail, Globe, ExternalLink } from "lucide-react";
import type { Person } from "@/lib/supabase";
import { getAuthors, createPerson, updatePerson } from "@/lib/api";
import SearchBar from "@/components/SearchBar";

type Author = Person & { paper_count: number };

export default function Authors() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    affiliation: "",
    role: "researcher",
    website_url: "",
    twitter_handle: "",
    notes: "",
  });

  useEffect(() => {
    loadAuthors();
  }, []);

  const loadAuthors = async () => {
    setLoading(true);
    try {
      const data = await getAuthors();
      setAuthors((data.authors as Author[]) || []);
    } catch {
      setAuthors([]);
    }
    setLoading(false);
  };

  const filtered = authors.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.affiliation?.toLowerCase().includes(search.toLowerCase())
  );

  // Split into favorites and rest
  const favorites = filtered.filter((a) => a.tags?.includes("favorite"));
  const rest = filtered.filter((a) => !a.tags?.includes("favorite"));

  const toggleFavorite = async (author: Author) => {
    const tags = author.tags || [];
    const isFav = tags.includes("favorite");
    const newTags = isFav ? tags.filter((t) => t !== "favorite") : [...tags, "favorite"];
    try {
      await updatePerson(author.id, { tags: newTags });
      setAuthors((prev) =>
        prev.map((a) => (a.id === author.id ? { ...a, tags: newTags } : a))
      );
    } catch { /* ignore */ }
  };

  const addAuthor = async () => {
    if (!form.name.trim()) return;
    await createPerson({ ...form, role: "researcher" });
    setForm({ name: "", affiliation: "", role: "researcher", website_url: "", twitter_handle: "", notes: "" });
    setShowAdd(false);
    loadAuthors();
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-text-primary">
              Authors
            </h1>
            <p className="text-sm text-text-tertiary mt-1">
              {authors.length} author{authors.length !== 1 ? "s" : ""} from your papers
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-56">
              <SearchBar value={search} onChange={setSearch} placeholder="Search authors..." />
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-card
                         bg-accent text-white text-sm font-medium
                         hover:bg-accent-hover transition-warm"
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>

        {loading && authors.length === 0 && (
          <p className="text-center py-20 text-sm text-text-tertiary">Loading...</p>
        )}

        {!loading && authors.length === 0 && (
          <p className="text-center py-20 text-sm font-serif text-text-secondary">
            No authors yet. Save some papers to auto-detect authors.
          </p>
        )}

        {/* Favorites section */}
        {favorites.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-3 px-1">
              <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
                Favorites
              </h2>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
                {favorites.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {favorites.map((a, i) => (
                <AuthorRow key={a.id} author={a} index={i} onToggleFavorite={toggleFavorite} />
              ))}
            </div>
          </section>
        )}

        {/* All authors */}
        <section>
          {favorites.length > 0 && (
            <div className="flex items-center gap-3 mb-3 px-1">
              <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
                All Authors
              </h2>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
                {rest.length}
              </span>
            </div>
          )}
          <div className="space-y-0.5">
            {rest.map((a, i) => (
              <AuthorRow key={a.id} author={a} index={i} onToggleFavorite={toggleFavorite} />
            ))}
          </div>
        </section>
      </motion.div>

      {/* Add author modal */}
      {showAdd && (
        <>
          <div className="fixed inset-0 bg-text-primary/20 z-50" onClick={() => setShowAdd(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-bg-primary border border-border rounded-modal
                         shadow-warm-lg w-full max-w-md p-6 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg font-medium">Add Author</h2>
                <button onClick={() => setShowAdd(false)}>
                  <X size={16} className="text-text-tertiary" />
                </button>
              </div>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Name"
                autoFocus
                className="w-full px-3 py-2.5 rounded-card border border-border bg-bg-primary text-sm outline-none focus:border-accent/30 transition-warm"
              />
              <input
                type="text"
                value={form.affiliation}
                onChange={(e) => setForm({ ...form, affiliation: e.target.value })}
                placeholder="Affiliation (e.g., CMU HCII)"
                className="w-full px-3 py-2.5 rounded-card border border-border bg-bg-primary text-sm outline-none focus:border-accent/30 transition-warm"
              />
              <input
                type="text"
                value={form.website_url}
                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                placeholder="Website URL"
                className="w-full px-3 py-2.5 rounded-card border border-border bg-bg-primary text-sm outline-none focus:border-accent/30 transition-warm"
              />
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notes (research interests, why you follow them...)"
                rows={2}
                className="w-full px-3 py-2.5 rounded-card border border-border bg-bg-primary text-sm outline-none focus:border-accent/30 transition-warm resize-none"
              />
              <button
                onClick={addAuthor}
                disabled={!form.name.trim()}
                className="w-full py-2.5 rounded-card bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-warm disabled:opacity-40"
              >
                Add Author
              </button>
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}

function AuthorRow({
  author,
  index,
  onToggleFavorite,
}: {
  author: Author;
  index: number;
  onToggleFavorite: (a: Author) => void;
}) {
  const isFav = author.tags?.includes("favorite");
  const initials = author.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.25 }}
    >
      <div className="group flex items-center gap-3 px-3 py-2.5 rounded-card hover:bg-bg-secondary/70 transition-warm">
        {/* Avatar */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                     bg-bg-secondary text-text-tertiary text-[11px] font-medium font-mono"
        >
          {initials}
        </div>

        {/* Name + affiliation */}
        <Link to={`/people/${author.id}`} className="flex-1 min-w-0">
          <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-warm">
            {author.name}
          </span>
          {author.affiliation && (
            <span className="ml-2 text-[12px] text-text-tertiary">
              {author.affiliation}
            </span>
          )}
        </Link>

        {/* Paper count */}
        <span className="text-[11px] font-mono text-text-tertiary tabular-nums flex-shrink-0">
          {author.paper_count} paper{author.paper_count !== 1 ? "s" : ""}
        </span>

        {/* Website */}
        {author.website_url && (
          <a
            href={author.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-tertiary hover:text-accent transition-warm flex-shrink-0"
            title="Website"
          >
            <Globe size={13} />
          </a>
        )}

        {/* Favorite toggle */}
        <button
          onClick={(e) => { e.preventDefault(); onToggleFavorite(author); }}
          className={`flex-shrink-0 p-1 rounded transition-warm ${
            isFav
              ? "text-amber-500"
              : "text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-amber-500"
          }`}
          title={isFav ? "Remove from favorites" : "Add to favorites"}
        >
          <Star size={14} fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>
    </motion.div>
  );
}
