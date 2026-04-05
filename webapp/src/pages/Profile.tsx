import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { UserPlus, UserMinus, Clock, Check } from "lucide-react";
import {
  getProfileByUsername,
  getProfileItems,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  type ProfileView,
  type FriendBookshelfItem,
  type FriendshipState,
} from "@/lib/api";

/**
 * Public profile view at /@:username.
 *
 * Renders in three possible states depending on the friendship relation:
 *   - self        → show your own profile, no friend button
 *   - accepted    → show friend's full bookshelf
 *   - none/pending → show header only; bookshelf is 403 from the API and we
 *                    render "You're not friends" instead of trying to show it
 *
 * Friend action button behavior:
 *   none              → "Add friend" (sends request)
 *   pending_outgoing  → "Request sent" (click to withdraw)
 *   pending_incoming  → "Accept request"
 *   accepted          → "Friends" (click to unfriend — with implicit confirm via button label)
 */
export default function Profile() {
  const { username } = useParams<{ username: string }>();
  const [view, setView] = useState<ProfileView | null>(null);
  const [items, setItems] = useState<FriendBookshelfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [shelfForbidden, setShelfForbidden] = useState(false);

  const load = async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    setShelfForbidden(false);
    try {
      const prof = await getProfileByUsername(username);
      setView(prof);

      if (
        prof.friendship_state === "accepted" ||
        prof.friendship_state === "self"
      ) {
        try {
          const shelf = await getProfileItems(username);
          setItems(shelf.items);
        } catch (err) {
          // 403 is expected if friendship was removed between calls
          setShelfForbidden(true);
          setItems([]);
        }
      } else {
        setItems([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile not found");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [username]);

  const handleAction = async () => {
    if (!view || !username) return;
    setActionBusy(true);
    const prev = view;
    try {
      let next: FriendshipState = view.friendship_state;
      if (view.friendship_state === "none") {
        const res = await sendFriendRequest(username);
        next = res.friendship_state;
      } else if (view.friendship_state === "pending_incoming") {
        await acceptFriendRequest(username);
        next = "accepted";
      } else if (
        view.friendship_state === "pending_outgoing" ||
        view.friendship_state === "accepted"
      ) {
        await removeFriend(username);
        next = "none";
      }
      setView({ ...view, friendship_state: next });
      // If we just became friends, reload to fetch the bookshelf
      if (next === "accepted") {
        await load();
      }
      // If we just unfriended, clear the shelf
      if (next === "none") {
        setItems([]);
      }
    } catch (err) {
      console.warn("Friendship action failed:", err);
      setView(prev);
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-20 text-center">
        <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-20 text-center">
        <p className="text-sm font-serif text-text-secondary">
          {error || "Profile not found"}
        </p>
      </div>
    );
  }

  const p = view.profile;
  const initial = (p.display_name || p.username).slice(0, 1).toUpperCase();
  const state = view.friendship_state;

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-6 mb-10"
      >
        {p.avatar_url ? (
          <img
            src={p.avatar_url}
            alt=""
            className="w-24 h-24 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-bg-secondary flex items-center justify-center text-text-secondary font-serif text-4xl flex-shrink-0">
            {initial}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-serif text-2xl font-semibold text-text-primary">
            {p.display_name || p.username}
          </h1>
          <div className="text-sm text-text-tertiary font-mono mt-0.5">
            @{p.username}
          </div>
          {p.bio && (
            <p className="text-sm text-text-secondary mt-3 max-w-xl leading-relaxed">
              {p.bio}
            </p>
          )}
          <div className="flex items-center gap-5 mt-4 text-sm">
            <span>
              <span className="font-mono font-medium text-text-primary tabular-nums">
                {view.friend_count}
              </span>
              <span className="text-text-tertiary ml-1.5">friends</span>
            </span>
          </div>
        </div>
        {state !== "self" && (
          <FriendButton
            state={state}
            busy={actionBusy}
            onClick={handleAction}
          />
        )}
      </motion.div>

      {/* Bookshelf (friends only) */}
      <section>
        <div className="flex items-center gap-3 mb-5 px-1">
          <h2 className="text-[11px] font-mono text-text-tertiary uppercase tracking-[0.15em]">
            Shelf
          </h2>
          <div className="flex-1 h-px bg-border" />
          {(state === "accepted" || state === "self") && (
            <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
              {items.length}
            </span>
          )}
        </div>

        {state !== "accepted" && state !== "self" && (
          <p className="text-sm font-serif text-text-secondary px-1">
            {state === "pending_outgoing"
              ? "Your request is pending — their shelf will appear once accepted"
              : state === "pending_incoming"
              ? "Accept their request to see their shelf"
              : "Send a friend request to see their shelf"}
          </p>
        )}

        {shelfForbidden && (
          <p className="text-sm font-serif text-text-secondary px-1">
            You're not friends with this user
          </p>
        )}

        {(state === "accepted" || state === "self") && items.length === 0 && !shelfForbidden && (
          <p className="text-sm font-serif text-text-secondary px-1">
            Nothing saved yet
          </p>
        )}

        {(state === "accepted" || state === "self") && items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {items.map((item, i) => (
              <motion.a
                key={item.id}
                href={item.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02, duration: 0.3 }}
                className="p-4 rounded-card border border-border bg-bg-primary hover:bg-bg-secondary/40 transition-warm group"
              >
                <div className="flex items-start gap-3">
                  {item.favicon_url && (
                    <img
                      src={item.favicon_url}
                      alt=""
                      className="w-4 h-4 rounded-sm flex-shrink-0 mt-0.5"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-1">
                      {item.type}
                    </div>
                    <div className="font-serif text-sm text-text-primary leading-snug line-clamp-2 group-hover:text-accent transition-warm">
                      {item.title}
                    </div>
                    {item.domain && (
                      <div className="text-[11px] text-text-tertiary font-mono mt-1.5 truncate">
                        {item.domain}
                      </div>
                    )}
                    {item.summary && (
                      <p className="text-[12px] text-text-secondary mt-2 line-clamp-2 leading-relaxed">
                        {item.summary}
                      </p>
                    )}
                  </div>
                </div>
              </motion.a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FriendButton({
  state,
  busy,
  onClick,
}: {
  state: FriendshipState;
  busy: boolean;
  onClick: () => void;
}) {
  const config = (() => {
    switch (state) {
      case "none":
        return {
          label: "Add friend",
          icon: <UserPlus size={13} />,
          style: "bg-accent text-white hover:bg-accent-hover",
        };
      case "pending_outgoing":
        return {
          label: "Requested",
          icon: <Clock size={13} />,
          style: "border border-border text-text-secondary hover:bg-bg-secondary",
        };
      case "pending_incoming":
        return {
          label: "Accept",
          icon: <Check size={13} />,
          style: "bg-accent text-white hover:bg-accent-hover",
        };
      case "accepted":
        return {
          label: "Friends",
          icon: <UserMinus size={13} />,
          style: "border border-border text-text-secondary hover:bg-bg-secondary",
        };
      default:
        return null;
    }
  })();

  if (!config) return null;

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-card text-sm font-medium transition-warm disabled:opacity-40 ${config.style}`}
    >
      {config.icon}
      {config.label}
    </button>
  );
}
