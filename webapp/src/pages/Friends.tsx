import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  UserPlus,
  UserMinus,
  Check,
  X,
  Clock,
  Search as SearchIcon,
} from "lucide-react";
import {
  searchUsers,
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  getFeed,
  type Profile,
  type PendingRequest,
  type FeedItem,
} from "@/lib/api";

/**
 * Friends page — the main social surface.
 *
 * Layout (top to bottom):
 *   1. Search bar (find people by username/name) — inline results with Add button
 *   2. Feed — "what my friends are reading" (from accepted friends only)
 *   3. Incoming requests inbox (accept / reject)
 *   4. Friends list
 *   5. Outgoing pending (withdraw)
 *
 * State management: all data loads in one Promise.all on mount. Actions are
 * optimistic (insert/remove locally, then call API, roll back on error). This
 * keeps the UI instant while still staying eventually-consistent.
 */
export default function Friends() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  const loadAll = async () => {
    try {
      const [friendsRes, incomingRes, outgoingRes, feedRes] = await Promise.all([
        listFriends(),
        listIncomingRequests(),
        listOutgoingRequests(),
        getFeed(),
      ]);
      setFriends(friendsRes.friends);
      setIncoming(incomingRes.requests);
      setOutgoing(outgoingRes.requests);
      setFeed(feedRes.feed);
    } catch (err) {
      console.warn("Friends load failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await searchUsers(query.trim());
        setSearchResults(res.users);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query]);

  const friendIds = new Set(friends.map((f) => f.user_id));
  const outgoingIds = new Set(outgoing.map((o) => o.user_id));
  const incomingIds = new Set(incoming.map((i) => i.user_id));

  const handleSendRequest = async (target: Profile) => {
    // Optimistic: add to outgoing pending
    const optimistic: PendingRequest = {
      ...target,
      requested_at: new Date().toISOString(),
    };
    setOutgoing((cur) => [optimistic, ...cur]);
    try {
      const res = await sendFriendRequest(target.username);
      // auto_accepted case: target had already sent US a request, so now we're friends.
      if (res.friendship_state === "accepted") {
        setOutgoing((cur) => cur.filter((o) => o.user_id !== target.user_id));
        setIncoming((cur) => cur.filter((i) => i.user_id !== target.user_id));
        setFriends((cur) => [target, ...cur]);
        loadAll();  // refresh feed since we have a new friend
      }
    } catch (err) {
      console.warn("Send request failed:", err);
      setOutgoing((cur) => cur.filter((o) => o.user_id !== target.user_id));
    }
  };

  const handleAccept = async (req: PendingRequest) => {
    setIncoming((cur) => cur.filter((i) => i.user_id !== req.user_id));
    setFriends((cur) => [req, ...cur]);
    try {
      await acceptFriendRequest(req.username);
      loadAll();
    } catch (err) {
      console.warn("Accept failed:", err);
      loadAll();
    }
  };

  const handleRemove = async (username: string, userId: string) => {
    const prevFriends = friends;
    const prevIncoming = incoming;
    const prevOutgoing = outgoing;
    setFriends((cur) => cur.filter((f) => f.user_id !== userId));
    setIncoming((cur) => cur.filter((i) => i.user_id !== userId));
    setOutgoing((cur) => cur.filter((o) => o.user_id !== userId));
    try {
      await removeFriend(username);
    } catch (err) {
      console.warn("Remove failed:", err);
      setFriends(prevFriends);
      setIncoming(prevIncoming);
      setOutgoing(prevOutgoing);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-serif text-2xl font-semibold text-text-primary">
          Friends
        </h1>
        <p className="text-sm text-text-tertiary mt-1">
          A small circle of people whose reading you trust
        </p>
      </motion.div>

      {/* Search */}
      <div className="relative mb-10">
        <SearchIcon
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find people by name or @username…"
          className="w-full pl-9 pr-3 py-2.5 rounded-card border border-border
                     bg-bg-primary text-sm outline-none focus:border-accent/30
                     transition-warm"
        />
        {query.trim().length >= 2 && (
          <div className="mt-2 border border-border rounded-card bg-bg-primary overflow-hidden">
            {searching && (
              <div className="px-3 py-3 text-xs text-text-tertiary">Searching…</div>
            )}
            {!searching && searchResults.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-tertiary">No matches</div>
            )}
            {searchResults.map((p) => {
              const isFriend = friendIds.has(p.user_id);
              const isOutgoing = outgoingIds.has(p.user_id);
              const isIncoming = incomingIds.has(p.user_id);
              return (
                <div
                  key={p.user_id}
                  className="flex items-center justify-between px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-bg-secondary/40 transition-warm"
                >
                  <Link
                    to={`/@${p.username}`}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <Avatar profile={p} size={32} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">
                        {p.display_name || p.username}
                      </div>
                      <div className="text-[11px] text-text-tertiary font-mono truncate">
                        @{p.username}
                      </div>
                    </div>
                  </Link>
                  {isFriend ? (
                    <StatusChip label="Friends" icon={<Check size={11} />} />
                  ) : isOutgoing ? (
                    <StatusChip label="Requested" icon={<Clock size={11} />} />
                  ) : isIncoming ? (
                    <button
                      onClick={() =>
                        handleAccept({ ...p, requested_at: "" })
                      }
                      className="flex items-center gap-1 px-2.5 py-1 rounded-card bg-accent text-white text-[11px] hover:bg-accent-hover transition-warm"
                    >
                      <Check size={11} />
                      Accept
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSendRequest(p)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-card bg-accent text-white text-[11px] hover:bg-accent-hover transition-warm"
                    >
                      <UserPlus size={11} />
                      Request
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Incoming requests inbox */}
      {incoming.length > 0 && (
        <section className="mb-10">
          <SectionHeader label="Friend Requests" count={incoming.length} />
          <div className="space-y-2">
            {incoming.map((req) => (
              <div
                key={req.user_id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-card border border-border bg-bg-primary"
              >
                <Link to={`/@${req.username}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar profile={req} size={36} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">
                      {req.display_name || req.username}
                    </div>
                    <div className="text-[11px] text-text-tertiary font-mono truncate">
                      @{req.username}
                    </div>
                  </div>
                </Link>
                <button
                  onClick={() => handleAccept(req)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-card bg-accent text-white text-[11px] hover:bg-accent-hover transition-warm"
                >
                  <Check size={11} />
                  Accept
                </button>
                <button
                  onClick={() => handleRemove(req.username, req.user_id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-card border border-border text-[11px] text-text-secondary hover:bg-bg-secondary transition-warm"
                >
                  <X size={11} />
                  Decline
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Feed */}
      <section className="mb-10">
        <SectionHeader label="Feed" count={feed.length} />
        {loading && (
          <div className="text-xs text-text-tertiary px-1">Loading…</div>
        )}
        {!loading && feed.length === 0 && (
          <p className="text-sm font-serif text-text-secondary px-1">
            {friends.length === 0
              ? "Add friends to see what they're reading"
              : "Your friends haven't saved anything yet"}
          </p>
        )}
        <div className="space-y-2">
          {feed.map((f, i) => (
            <FeedRow key={f.id} feed={f} delay={i * 0.02} />
          ))}
        </div>
      </section>

      {/* Friends grid */}
      <section className="mb-10">
        <SectionHeader label="Friends" count={friends.length} />
        {!loading && friends.length === 0 && (
          <p className="text-sm font-serif text-text-secondary px-1">
            No friends yet — search above to send your first request
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {friends.map((p) => (
            <Link
              key={p.user_id}
              to={`/@${p.username}`}
              className="flex items-center gap-3 p-3 rounded-card border border-border bg-bg-primary hover:bg-bg-secondary/40 transition-warm"
            >
              <Avatar profile={p} size={36} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary truncate">
                  {p.display_name || p.username}
                </div>
                <div className="text-[11px] text-text-tertiary font-mono truncate">
                  @{p.username}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Outgoing pending */}
      {outgoing.length > 0 && (
        <section>
          <SectionHeader label="Pending" count={outgoing.length} />
          <div className="space-y-2">
            {outgoing.map((req) => (
              <div
                key={req.user_id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-card border border-border bg-bg-primary"
              >
                <Avatar profile={req} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">
                    {req.display_name || req.username}
                  </div>
                  <div className="text-[11px] text-text-tertiary font-mono truncate">
                    @{req.username} · waiting
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(req.username, req.user_id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-card border border-border text-[11px] text-text-secondary hover:bg-bg-secondary transition-warm"
                >
                  <UserMinus size={11} />
                  Withdraw
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-4 px-1">
      <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
        {label}
      </h2>
      <div className="flex-1 h-px bg-border" />
      <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
        {count}
      </span>
    </div>
  );
}

function StatusChip({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 px-2.5 py-1 rounded-card border border-border text-[11px] text-text-tertiary">
      {icon}
      {label}
    </span>
  );
}

function Avatar({
  profile,
  size,
}: {
  profile: Pick<Profile, "username" | "display_name" | "avatar_url">;
  size: number;
}) {
  const initial = (profile.display_name || profile.username || "?")
    .slice(0, 1)
    .toUpperCase();
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        className="rounded-full flex-shrink-0 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex-shrink-0 flex items-center justify-center bg-bg-secondary text-text-secondary font-serif font-medium"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}

function FeedRow({ feed, delay }: { feed: FeedItem; delay: number }) {
  const verb =
    feed.action === "save"
      ? "saved"
      : feed.action === "highlight"
      ? "highlighted"
      : feed.action === "finish"
      ? "finished"
      : feed.action === "recommend"
      ? "recommended"
      : "noted";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-card border border-border bg-bg-primary hover:bg-bg-secondary/30 transition-warm"
    >
      <Avatar profile={feed} size={28} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary truncate">
          <Link to={`/@${feed.username}`} className="font-medium hover:underline">
            {feed.display_name || feed.username}
          </Link>
          <span className="text-text-tertiary"> {verb} </span>
          {feed.item_url ? (
            <a
              href={feed.item_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-serif italic hover:underline"
            >
              {feed.item_title || "untitled"}
            </a>
          ) : (
            <span className="font-serif italic">
              {feed.item_title || "untitled"}
            </span>
          )}
        </div>
        {feed.item_domain && (
          <div className="text-[11px] text-text-tertiary font-mono truncate">
            {feed.item_domain}
          </div>
        )}
      </div>
    </motion.div>
  );
}
