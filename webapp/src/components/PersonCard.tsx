"use client";

import type { Person } from "@/lib/supabase";
import Link from "next/link";
import { User } from "lucide-react";

const roleColors: Record<string, string> = {
  mentor: "bg-purple-500/20 text-purple-400",
  peer: "bg-blue-500/20 text-blue-400",
  "intellectual hero": "bg-amber-500/20 text-amber-400",
  researcher: "bg-emerald-500/20 text-emerald-400",
};

export default function PersonCard({ person }: { person: Person }) {
  return (
    <Link
      href={`/people/${person.id}`}
      className="group flex flex-col items-center gap-3 p-5 rounded-xl
                 bg-surface border border-border hover:border-accent/30
                 transition-all hover:shadow-lg hover:shadow-accent/5"
    >
      {/* Avatar */}
      <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center
                      justify-center overflow-hidden border-2 border-border
                      group-hover:border-accent/30 transition-colors">
        {person.avatar_url ? (
          <img
            src={person.avatar_url}
            alt={person.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <User size={24} className="text-muted" />
        )}
      </div>

      {/* Name */}
      <div className="text-center">
        <h3 className="text-sm font-semibold group-hover:text-accent
                       transition-colors">
          {person.name}
        </h3>
        {person.affiliation && (
          <p className="text-xs text-muted mt-0.5">{person.affiliation}</p>
        )}
      </div>

      {/* Role badge */}
      {person.role && (
        <span
          className={`text-[10px] px-2.5 py-0.5 rounded-full font-medium
                      ${roleColors[person.role] || "bg-surface-2 text-muted"}`}
        >
          {person.role}
        </span>
      )}

      {/* Tags */}
      {person.tags && person.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center">
          {person.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2
                         text-muted"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
