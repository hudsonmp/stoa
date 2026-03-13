import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X } from "lucide-react";
import { usePeople } from "@/hooks/usePeople";
import { createPerson } from "@/lib/api";
import PersonCard from "@/components/PersonCard";
import SearchBar from "@/components/SearchBar";

export default function People() {
  const { people, loading, reload } = usePeople();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    affiliation: "",
    role: "intellectual hero",
    website_url: "",
    twitter_handle: "",
    notes: "",
  });

  const filtered = people.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.affiliation?.toLowerCase().includes(search.toLowerCase()) ||
      p.role?.toLowerCase().includes(search.toLowerCase()) ||
      p.tags?.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  const addPerson = async () => {
    if (!form.name.trim()) return;
    await createPerson(form);
    setForm({
      name: "",
      affiliation: "",
      role: "intellectual hero",
      website_url: "",
      twitter_handle: "",
      notes: "",
    });
    setShowAdd(false);
    reload();
  };

  // Group by role
  const roles = ["intellectual hero", "mentor", "peer", "researcher"];
  const grouped = roles
    .map((r) => ({
      role: r,
      people: filtered.filter((p) => p.role === r),
    }))
    .filter((g) => g.people.length > 0);

  const ungrouped = filtered.filter(
    (p) => !p.role || !roles.includes(p.role)
  );

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="font-serif text-2xl font-semibold text-text-primary">
            People
          </h1>
          <p className="text-sm text-text-tertiary mt-1">
            Your intellectual milieu
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-56">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search people..."
            />
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
      </motion.div>

      {loading && people.length === 0 && (
        <div className="text-center py-20">
          <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-text-tertiary mt-3">Loading people...</p>
        </div>
      )}

      {!loading && people.length === 0 && (
        <p className="text-center py-20 text-sm font-serif text-text-secondary">
          No people in your milieu yet
        </p>
      )}

      {/* Grouped by role */}
      {grouped.map((group, gIdx) => (
        <motion.section
          key={group.role}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gIdx * 0.05, duration: 0.35 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-4 px-1">
            <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em] capitalize">
              {group.role === "intellectual hero"
                ? "intellectual heroes"
                : `${group.role}s`}
            </h2>
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
              {group.people.length}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {group.people.map((person, i) => (
              <PersonCard key={person.id} person={person} index={i} />
            ))}
          </div>
        </motion.section>
      ))}

      {ungrouped.length > 0 && (
        <section className="mb-10">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {ungrouped.map((person, i) => (
              <PersonCard key={person.id} person={person} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Add person modal */}
      <AnimatePresence>
        {showAdd && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-text-primary/20 z-50"
              onClick={() => setShowAdd(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="bg-bg-primary border border-border rounded-modal
                           shadow-warm-lg w-full max-w-md p-6 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-lg font-medium">Add Person</h2>
                  <button
                    onClick={() => setShowAdd(false)}
                    className="p-1 rounded-card hover:bg-bg-secondary transition-warm"
                  >
                    <X size={16} className="text-text-tertiary" />
                  </button>
                </div>

                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Name"
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm"
                />
                <input
                  type="text"
                  value={form.affiliation}
                  onChange={(e) =>
                    setForm({ ...form, affiliation: e.target.value })
                  }
                  placeholder="Affiliation"
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm"
                />
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm"
                >
                  <option value="intellectual hero">Intellectual Hero</option>
                  <option value="mentor">Mentor</option>
                  <option value="peer">Peer</option>
                  <option value="researcher">Researcher</option>
                </select>
                <input
                  type="text"
                  value={form.website_url}
                  onChange={(e) =>
                    setForm({ ...form, website_url: e.target.value })
                  }
                  placeholder="Website URL"
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm"
                />
                <input
                  type="text"
                  value={form.twitter_handle}
                  onChange={(e) =>
                    setForm({ ...form, twitter_handle: e.target.value })
                  }
                  placeholder="Twitter/X handle"
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm"
                />
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Notes..."
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm outline-none focus:border-accent/30
                             transition-warm resize-none"
                />
                <button
                  onClick={addPerson}
                  disabled={!form.name.trim()}
                  className="w-full py-2.5 rounded-card bg-accent text-white text-sm
                             font-medium hover:bg-accent-hover transition-warm
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add to Milieu
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
