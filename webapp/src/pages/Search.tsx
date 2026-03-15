import { useState } from "react";
import { motion } from "framer-motion";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Item, Person } from "@/lib/supabase";
import ItemRow from "@/components/ItemRow";
import PersonCard from "@/components/PersonCard";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);

    const q = query.toLowerCase();

    const [itemsRes, peopleRes] = await Promise.all([
      supabase
        .from("items")
        .select("*")
        .or(`title.ilike.%${q}%,domain.ilike.%${q}%`)
        .limit(50),
      supabase
        .from("people")
        .select("*")
        .or(`name.ilike.%${q}%,affiliation.ilike.%${q}%`)
        .limit(20),
    ]);

    setItems((itemsRes.data as Item[]) || []);
    setPeople((peopleRes.data as Person[]) || []);
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-serif text-2xl font-semibold text-text-primary mb-6">
          Search
        </h1>

        {/* Search bar */}
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-card
                     border border-border focus-within:border-accent/30
                     focus-within:shadow-warm transition-warm mb-8"
        >
          <SearchIcon size={18} className="text-text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search items, people, tags..."
            className="flex-1 bg-transparent border-none outline-none
                       text-base text-text-primary placeholder:text-text-tertiary font-sans"
            autoFocus
          />
          {loading && <Loader2 size={16} className="animate-spin text-text-tertiary" />}
        </div>

        {/* Results */}
        {searched && !loading && items.length === 0 && people.length === 0 && (
          <p className="text-center py-12 text-sm font-serif text-text-secondary">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}

        {people.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-3 px-1">
              <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
                People
              </h2>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-mono text-text-tertiary">
                {people.length}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {people.map((p, i) => (
                <PersonCard key={p.id} person={p} index={i} />
              ))}
            </div>
          </section>
        )}

        {items.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-3 px-1">
              <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
                Items
              </h2>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-mono text-text-tertiary">
                {items.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {items.map((item, i) => (
                <ItemRow key={item.id} item={item} index={i} />
              ))}
            </div>
          </section>
        )}
      </motion.div>
    </div>
  );
}
