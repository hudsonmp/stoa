"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Person, Item } from "@/lib/supabase";
import ItemCard from "@/components/ItemCard";
import NoteEditor from "@/components/NoteEditor";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  User,
  Globe,
  Twitter,
} from "lucide-react";

interface PersonItem {
  relation: string;
  items: Item;
}

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<Person | null>(null);
  const [items, setItems] = useState<PersonItem[]>([]);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (id) loadPerson();
  }, [id]);

  const loadPerson = async () => {
    const { data: personData } = await supabase
      .from("people")
      .select("*")
      .eq("id", id)
      .single();
    setPerson(personData);

    if (personData) {
      const { data: itemsData } = await supabase
        .from("person_items")
        .select("relation, items(*)")
        .eq("person_id", id);
      setItems((itemsData as unknown as PersonItem[]) || []);

      // Load notes about this person
      const { data: notesData } = await supabase
        .from("notes")
        .select("content")
        .eq("person_id", id)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (notesData && notesData.length > 0) {
        setNotes(notesData[0].content);
      }
    }
  };

  if (!person) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading...
      </div>
    );
  }

  const roleColors: Record<string, string> = {
    mentor: "bg-purple-500/20 text-purple-400",
    peer: "bg-blue-500/20 text-blue-400",
    "intellectual hero": "bg-amber-500/20 text-amber-400",
    researcher: "bg-emerald-500/20 text-emerald-400",
  };

  return (
    <div className="min-h-screen max-w-4xl mx-auto p-8">
      {/* Back */}
      <Link
        href="/people"
        className="inline-flex items-center gap-2 text-sm text-muted
                  hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        People
      </Link>

      {/* Person header */}
      <div className="flex items-start gap-6 mb-8">
        <div className="w-20 h-20 rounded-full bg-surface-2 flex items-center
                       justify-center border-2 border-border overflow-hidden">
          {person.avatar_url ? (
            <img
              src={person.avatar_url}
              alt={person.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <User size={32} className="text-muted" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{person.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            {person.affiliation && (
              <span className="text-sm text-muted">{person.affiliation}</span>
            )}
            {person.role && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium
                           ${roleColors[person.role] || "bg-surface-2 text-muted"}`}
              >
                {person.role}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-3">
            {person.website_url && (
              <a
                href={person.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted
                          hover:text-accent transition-colors"
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
                className="flex items-center gap-1 text-xs text-muted
                          hover:text-accent transition-colors"
              >
                <Twitter size={12} />
                @{person.twitter_handle}
              </a>
            )}
          </div>
          {person.bio && (
            <p className="text-sm text-muted mt-3 leading-relaxed">
              {person.bio}
            </p>
          )}
        </div>
      </div>

      {/* Tags */}
      {person.tags && person.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {person.tags.map((tag) => (
            <span
              key={tag}
              className="px-2.5 py-1 rounded-full text-xs bg-accent-dim
                        text-accent"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Their content */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider
                      mb-3">
          Content ({items.length})
        </h2>
        <div className="space-y-1">
          {items.map((pi, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-muted/60 w-16 text-right
                            flex-shrink-0">
                {pi.relation}
              </span>
              <div className="flex-1">
                <ItemCard item={pi.items} />
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted py-4">
              No content linked to this person yet
            </p>
          )}
        </div>
      </section>

      {/* Notes */}
      <section>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider
                      mb-3">
          Notes
        </h2>
        {person.notes && (
          <p className="text-sm text-foreground/80 mb-4 p-3 rounded-lg
                       bg-surface border border-border leading-relaxed">
            {person.notes}
          </p>
        )}
        <NoteEditor
          content={notes}
          onChange={setNotes}
          placeholder="Write notes about this person..."
        />
      </section>
    </div>
  );
}
