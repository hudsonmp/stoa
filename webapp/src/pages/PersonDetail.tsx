import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Globe, ExternalLink } from "lucide-react";
import type { Person, Item } from "@/lib/supabase";
import { getPerson } from "@/lib/api";
import ItemRow from "@/components/ItemRow";
import TagPill from "@/components/TagPill";

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<Person | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPerson = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await getPerson(id);
      setPerson(data.person as Person);
      setItems((data.items as Item[]) || []);
    } catch {
      setPerson(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadPerson();
  }, [loadPerson]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-8">
        <p className="text-sm text-text-secondary">Person not found</p>
      </div>
    );
  }

  const avatarColors = [
    "#C2410C", "#4D7C0F", "#B45309", "#9A3412", "#78716C",
  ];
  const bgColor =
    avatarColors[person.name.charCodeAt(0) % avatarColors.length];
  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <Link
        to="/people"
        className="inline-flex items-center gap-1.5 text-sm text-text-tertiary
                   hover:text-text-primary transition-warm mb-6"
      >
        <ArrowLeft size={14} />
        People
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {/* Header */}
        <div className="flex items-start gap-5 mb-8">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center
                       text-lg font-serif font-medium flex-shrink-0"
            style={{
              backgroundColor: person.avatar_url ? undefined : `${bgColor}15`,
              color: bgColor,
            }}
          >
            {person.avatar_url ? (
              <img
                src={person.avatar_url}
                alt={person.name}
                className="w-full h-full object-cover rounded-full"
              />
            ) : (
              initials
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-2xl font-semibold text-text-primary">
              {person.name}
            </h1>
            {person.affiliation && (
              <p className="text-sm text-text-secondary mt-1">
                {person.affiliation}
              </p>
            )}
            {person.role && (
              <span className="inline-block mt-2 text-[11px] font-mono px-2 py-0.5 rounded-tag bg-bg-secondary text-text-secondary capitalize">
                {person.role}
              </span>
            )}

            <div className="flex items-center gap-3 mt-3">
              {person.website_url && (
                <a
                  href={person.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent
                             hover:text-accent-hover transition-warm"
                >
                  <Globe size={12} />
                  Website
                </a>
              )}
              {person.twitter_handle && (
                <a
                  href={`https://x.com/${person.twitter_handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent
                             hover:text-accent-hover transition-warm"
                >
                  <ExternalLink size={12} />@{person.twitter_handle}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Tags */}
        {person.tags && person.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-8">
            {person.tags.map((t) => (
              <TagPill key={t} name={t} />
            ))}
          </div>
        )}

        {/* Bio / Notes */}
        {(person.bio || person.notes) && (
          <div className="mb-8 p-4 bg-bg-secondary rounded-card">
            <p className="text-sm text-text-secondary leading-relaxed">
              {person.bio || person.notes}
            </p>
          </div>
        )}

        {/* Connected items */}
        {items.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-3 px-1">
              <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
                Connected Items
              </h2>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
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
