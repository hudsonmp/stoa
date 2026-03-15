import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { Person } from "@/lib/supabase";

const roleStyles: Record<string, string> = {
  mentor: "bg-accent-green/10 text-accent-green",
  peer: "bg-accent/10 text-accent",
  "intellectual hero": "bg-accent-amber/10 text-accent-amber",
  researcher: "bg-text-tertiary/10 text-text-secondary",
};

const avatarColors = [
  "#C2410C", "#4D7C0F", "#B45309", "#9A3412",
  "#78716C", "#354F52", "#523A28", "#1A332E",
];

interface PersonCardProps {
  person: Person;
  index?: number;
}

export default function PersonCard({ person, index = 0 }: PersonCardProps) {
  const bgColor = avatarColors[person.name.charCodeAt(0) % avatarColors.length];
  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.04,
        duration: 0.35,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <Link
        to={`/people/${person.id}`}
        className="group flex flex-col items-center gap-3 p-5 rounded-card
                   bg-bg-primary border border-border
                   hover:border-accent/15 hover:shadow-warm-md
                   transition-warm"
      >
        {/* Avatar */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center
                     text-sm font-serif font-medium overflow-hidden
                     group-hover:scale-105 transition-transform duration-300"
          style={{
            backgroundColor: person.avatar_url ? undefined : `${bgColor}15`,
            color: bgColor,
          }}
        >
          {person.avatar_url ? (
            <img
              src={person.avatar_url}
              alt={person.name}
              className="w-full h-full object-cover"
            />
          ) : (
            initials
          )}
        </div>

        {/* Name */}
        <div className="text-center">
          <h3
            className="font-serif text-sm font-medium text-text-primary
                       group-hover:text-accent transition-warm"
          >
            {person.name}
          </h3>
          {person.affiliation && (
            <p className="text-[11px] text-text-tertiary mt-0.5 font-sans">
              {person.affiliation}
            </p>
          )}
        </div>

        {/* Role badge */}
        {person.role && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-tag font-mono font-medium
                       ${roleStyles[person.role] || "bg-bg-secondary text-text-secondary"}`}
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
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-tag
                           bg-bg-secondary text-text-tertiary"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </Link>
    </motion.div>
  );
}
