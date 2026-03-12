"use client";

import type { Highlight } from "@/lib/supabase";
import { MessageSquare } from "lucide-react";

const colorMap: Record<string, string> = {
  yellow: "border-l-yellow-400 bg-yellow-500/5",
  green: "border-l-green-400 bg-green-500/5",
  blue: "border-l-blue-400 bg-blue-500/5",
  pink: "border-l-pink-400 bg-pink-500/5",
  purple: "border-l-purple-400 bg-purple-500/5",
};

export default function HighlightPanel({
  highlights,
}: {
  highlights: Highlight[];
}) {
  if (highlights.length === 0) {
    return (
      <div className="text-center py-8 text-muted text-sm">
        No highlights yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {highlights.map((h) => (
        <div
          key={h.id}
          className={`border-l-2 rounded-r-lg p-3 ${
            colorMap[h.color] || colorMap.yellow
          }`}
        >
          <p className="text-sm leading-relaxed">{h.text}</p>
          {h.note && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-muted">
              <MessageSquare size={12} className="mt-0.5 flex-shrink-0" />
              <span>{h.note}</span>
            </div>
          )}
          <time className="block mt-1.5 text-[10px] text-muted/60">
            {new Date(h.created_at).toLocaleDateString()}
          </time>
        </div>
      ))}
    </div>
  );
}
