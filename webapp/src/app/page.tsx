"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Item, Person, Collection, Tag } from "@/lib/supabase";
import Bookshelf from "@/components/Bookshelf";
import ItemCard from "@/components/ItemCard";
import Link from "next/link";
import {
  BookOpen,
  FileText,
  Headphones,
  Globe,
  Users,
  FolderOpen,
  Hash,
  Search,
  RotateCcw,
  Library,
} from "lucide-react";

type ContentTab = "all" | "book" | "blog" | "paper" | "podcast";

const TAB_CONFIG: {
  key: ContentTab;
  label: string;
  icon: typeof BookOpen;
}[] = [
  { key: "all", label: "All", icon: Library },
  { key: "book", label: "Books", icon: BookOpen },
  { key: "blog", label: "Blogs", icon: FileText },
  { key: "paper", label: "Papers", icon: FileText },
  { key: "podcast", label: "Podcasts", icon: Headphones },
];

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTab, setActiveTab] = useState<ContentTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSection, setSidebarSection] = useState<
    "people" | "collections" | "tags"
  >("people");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [itemsRes, peopleRes, collectionsRes, tagsRes] = await Promise.all([
      supabase
        .from("items")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("people").select("*").order("name"),
      supabase.from("collections").select("*").order("name"),
      supabase.from("tags").select("*").order("name"),
    ]);

    setItems(itemsRes.data || []);
    setPeople(peopleRes.data || []);
    setCollections(collectionsRes.data || []);
    setTags(tagsRes.data || []);
  };

  const filteredItems = items.filter((item) => {
    if (activeTab !== "all" && item.type !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.domain?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const books = items.filter((i) => i.type === "book");

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-surface
                        flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-border">
          <h1 className="text-lg font-bold tracking-wider">STOA</h1>
          <p className="text-[10px] text-muted tracking-widest uppercase mt-0.5">
            Milieu Curation
          </p>
        </div>

        {/* Search */}
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                         bg-surface-2 border border-border">
            <Search size={14} className="text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library..."
              className="flex-1 bg-transparent border-none outline-none
                         text-sm placeholder:text-muted"
            />
          </div>
        </div>

        {/* Navigation sections */}
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          <div className="flex items-center gap-1 mb-2">
            {(
              [
                { key: "people" as const, icon: Users, label: "People" },
                { key: "collections" as const, icon: FolderOpen, label: "Collections" },
                { key: "tags" as const, icon: Hash, label: "Tags" },
              ] as const
            ).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setSidebarSection(key)}
                className={`flex-1 flex items-center justify-center gap-1.5
                           py-1.5 rounded text-xs font-medium transition-colors
                           ${
                             sidebarSection === key
                               ? "bg-accent-dim text-accent"
                               : "text-muted hover:text-foreground"
                           }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          {sidebarSection === "people" && (
            <div className="space-y-0.5">
              {people.map((p) => (
                <Link
                  key={p.id}
                  href={`/people/${p.id}`}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md
                            text-sm text-muted hover:text-foreground
                            hover:bg-surface-2 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-surface-2
                                  flex items-center justify-center text-[10px]">
                    {p.name[0]}
                  </span>
                  <span className="truncate">{p.name}</span>
                </Link>
              ))}
            </div>
          )}

          {sidebarSection === "collections" && (
            <div className="space-y-0.5">
              {collections.map((c) => (
                <Link
                  key={c.id}
                  href={`/collections/${c.id}`}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md
                            text-sm text-muted hover:text-foreground
                            hover:bg-surface-2 transition-colors"
                >
                  <FolderOpen size={14} />
                  <span className="truncate">{c.name}</span>
                </Link>
              ))}
            </div>
          )}

          {sidebarSection === "tags" && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="px-2 py-0.5 rounded text-xs bg-surface-2
                            text-muted hover:text-foreground cursor-pointer
                            transition-colors"
                >
                  #{t.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="px-3 py-3 border-t border-border space-y-1">
          <Link
            href="/review"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                      text-muted hover:text-foreground hover:bg-surface-2
                      transition-colors"
          >
            <RotateCcw size={14} />
            Review Queue
          </Link>
          <Link
            href="/people"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                      text-muted hover:text-foreground hover:bg-surface-2
                      transition-colors"
          >
            <Users size={14} />
            All People
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {books.length > 0 && (
          <section className="px-8 pt-6 pb-4">
            <h2 className="text-sm font-medium text-muted uppercase
                          tracking-wider mb-4">
              Bookshelf
            </h2>
            <Bookshelf books={books} />
          </section>
        )}

        <section className="px-8 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1">
              {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                            text-sm font-medium transition-colors ${
                              activeTab === key
                                ? "bg-accent-dim text-accent"
                                : "text-muted hover:text-foreground"
                            }`}
                >
                  <Icon size={14} />
                  {label}
                  <span className="text-[10px] ml-0.5 opacity-60">
                    {key === "all"
                      ? items.length
                      : items.filter((i) => i.type === key).length}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            {filteredItems.length === 0 ? (
              <div className="text-center py-16 text-muted">
                <Globe size={32} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">No items yet</p>
                <p className="text-xs mt-1">
                  Save your first page using the Chrome extension
                </p>
              </div>
            ) : (
              filteredItems.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
