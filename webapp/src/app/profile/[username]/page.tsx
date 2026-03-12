"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Item, Activity } from "@/lib/supabase";
import ActivityFeed from "@/components/ActivityFeed";
import ItemCard from "@/components/ItemCard";
import { User } from "lucide-react";

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [activity, setActivity] = useState<(Activity & { items?: { title: string; url?: string; type: string } })[]>([]);
  const [publicItems, setPublicItems] = useState<Item[]>([]);

  useEffect(() => {
    if (username) loadProfile();
  }, [username]);

  const loadProfile = async () => {
    // Load public activity
    const { data: activityData } = await supabase
      .from("activity")
      .select("*, items(title, url, type)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(30);

    setActivity(activityData || []);
  };

  return (
    <div className="min-h-screen max-w-3xl mx-auto p-8">
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center
                       justify-center border-2 border-border">
          <User size={24} className="text-muted" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{username}</h1>
          <p className="text-sm text-muted">Stoa Profile</p>
        </div>
      </div>

      {/* Activity feed */}
      <section>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider
                      mb-4">
          Recent Activity
        </h2>
        <ActivityFeed activities={activity} />
        {activity.length === 0 && (
          <p className="text-center py-12 text-muted text-sm">
            No public activity yet
          </p>
        )}
      </section>
    </div>
  );
}
