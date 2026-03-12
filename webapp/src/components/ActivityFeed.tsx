"use client";

import type { Activity } from "@/lib/supabase";
import {
  Bookmark,
  Highlighter,
  PenLine,
  CheckCircle,
  Star,
} from "lucide-react";

const actionConfig: Record<
  string,
  { icon: typeof Bookmark; label: string; color: string }
> = {
  save: { icon: Bookmark, label: "saved", color: "text-blue-400" },
  highlight: { icon: Highlighter, label: "highlighted in", color: "text-yellow-400" },
  note: { icon: PenLine, label: "noted on", color: "text-purple-400" },
  finish: { icon: CheckCircle, label: "finished", color: "text-emerald-400" },
  recommend: { icon: Star, label: "recommended", color: "text-amber-400" },
};

interface ActivityWithItem extends Activity {
  items?: { title: string; url?: string; type: string };
}

export default function ActivityFeed({
  activities,
}: {
  activities: ActivityWithItem[];
}) {
  return (
    <div className="space-y-1">
      {activities.map((a) => {
        const config = actionConfig[a.action] || actionConfig.save;
        const Icon = config.icon;

        return (
          <div
            key={a.id}
            className="flex items-center gap-3 py-2.5 px-3 rounded-lg
                       hover:bg-surface-2 transition-colors"
          >
            <Icon size={14} className={config.color} />
            <div className="flex-1 min-w-0 text-sm">
              <span className="text-muted">{config.label}</span>{" "}
              {a.items && (
                <span className="font-medium truncate">{a.items.title}</span>
              )}
            </div>
            <time className="text-[10px] text-muted/60 flex-shrink-0">
              {new Date(a.created_at).toLocaleDateString()}
            </time>
          </div>
        );
      })}
    </div>
  );
}
