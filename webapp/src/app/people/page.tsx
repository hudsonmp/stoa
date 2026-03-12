"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Person } from "@/lib/supabase";
import PersonCard from "@/components/PersonCard";
import Link from "next/link";
import { ArrowLeft, Plus, Search, X } from "lucide-react";

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
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

  useEffect(() => {
    loadPeople();
  }, []);

  const loadPeople = async () => {
    const { data } = await supabase
      .from("people")
      .select("*")
      .order("name");
    setPeople(data || []);
  };

  const addPerson = async () => {
    if (!form.name.trim()) return;
    await supabase.from("people").insert({
      ...form,
      user_id: (await supabase.auth.getUser()).data.user?.id,
    });
    setForm({
      name: "",
      affiliation: "",
      role: "intellectual hero",
      website_url: "",
      twitter_handle: "",
      notes: "",
    });
    setShowAdd(false);
    loadPeople();
  };

  const filtered = people.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.affiliation?.toLowerCase().includes(search.toLowerCase()) ||
      p.role?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <ArrowLeft size={18} className="text-muted" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">People</h1>
            <p className="text-sm text-muted">Your intellectual milieu</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg
                         bg-surface border border-border">
            <Search size={14} className="text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className="bg-transparent border-none outline-none text-sm w-48
                         placeholder:text-muted"
            />
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg
                      bg-accent text-white text-sm font-medium
                      hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            Add Person
          </button>
        </div>
      </div>

      {/* Add person modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center
                       justify-center p-4">
          <div className="bg-surface border border-border rounded-xl p-6
                         w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add Person</h2>
              <button onClick={() => setShowAdd(false)}>
                <X size={18} className="text-muted" />
              </button>
            </div>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Name"
              className="w-full px-3 py-2 rounded-lg border border-border
                        bg-surface-2 text-sm outline-none focus:border-accent"
            />
            <input
              type="text"
              value={form.affiliation}
              onChange={(e) =>
                setForm({ ...form, affiliation: e.target.value })
              }
              placeholder="Affiliation (e.g., CMU HCII)"
              className="w-full px-3 py-2 rounded-lg border border-border
                        bg-surface-2 text-sm outline-none focus:border-accent"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border
                        bg-surface-2 text-sm outline-none focus:border-accent"
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
              className="w-full px-3 py-2 rounded-lg border border-border
                        bg-surface-2 text-sm outline-none focus:border-accent"
            />
            <input
              type="text"
              value={form.twitter_handle}
              onChange={(e) =>
                setForm({ ...form, twitter_handle: e.target.value })
              }
              placeholder="Twitter/X handle"
              className="w-full px-3 py-2 rounded-lg border border-border
                        bg-surface-2 text-sm outline-none focus:border-accent"
            />
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notes about this person..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border
                        bg-surface-2 text-sm outline-none focus:border-accent
                        resize-none"
            />
            <button
              onClick={addPerson}
              className="w-full py-2.5 rounded-lg bg-accent text-white
                        text-sm font-medium hover:opacity-90"
            >
              Add to Milieu
            </button>
          </div>
        </div>
      )}

      {/* People grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filtered.map((person) => (
          <PersonCard key={person.id} person={person} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted">
          <p className="text-sm">No people in your milieu yet</p>
        </div>
      )}
    </div>
  );
}
