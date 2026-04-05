import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { setupProfile } from "@/lib/api";

/**
 * ProfileSetupModal — first-time username claim.
 *
 * Rendered from AuthGate (or a wrapper) when the backend reports
 * `needs_setup: true` on /social/me. Validates the username format client-side
 * (must match `^[a-z0-9_]{3,24}$`) and surfaces server-side collision errors
 * from /social/setup inline.
 *
 * Why the username is gated at account-creation time instead of a "change
 * later in Settings" flow: in a private-salon product, handles anchor trust.
 * Letting people use the auto-generated placeholder (`hudson_ab12cd`) and
 * rename later would leak that transition through friendship graphs (a friend
 * requested `hudson_ab12cd` yesterday, sees `hudson` today — confusing and
 * trust-eroding). One-time claim, then immutable-ish (can still change later
 * via a Settings flow we build separately, but default is "pick it now").
 */
export default function ProfileSetupModal({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const usernameValid = /^[a-z0-9_]{3,24}$/.test(username);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameValid) {
      setError("Username must be 3–24 characters, lowercase letters, numbers, or underscores.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await setupProfile({
        username,
        display_name: displayName || undefined,
        bio: bio || undefined,
      });
      onComplete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Setup failed";
      if (msg.includes("409") || msg.toLowerCase().includes("taken")) {
        setError("That username is already taken. Try another.");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-text-primary/20 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="bg-bg-primary border border-border rounded-modal shadow-warm-lg w-full max-w-md p-6"
        >
          <h2 className="font-serif text-xl font-semibold text-text-primary">
            Claim your handle
          </h2>
          <p className="text-sm text-text-tertiary mt-1">
            This is how friends find you on Stoa.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5">
                Username
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary text-sm">
                  @
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="hudson"
                  autoFocus
                  className="w-full pl-7 pr-3 py-2.5 rounded-card border border-border
                             bg-bg-primary text-sm font-mono outline-none
                             focus:border-accent/30 transition-warm"
                />
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5 font-mono">
                3–24 chars · lowercase letters, numbers, underscores
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Hudson Mitchell-Pullman"
                className="w-full px-3 py-2.5 rounded-card border border-border
                           bg-bg-primary text-sm outline-none focus:border-accent/30
                           transition-warm"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5">
                Bio (optional)
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="What are you reading?"
                rows={3}
                className="w-full px-3 py-2.5 rounded-card border border-border
                           bg-bg-primary text-sm outline-none focus:border-accent/30
                           transition-warm resize-none"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 font-serif italic">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !usernameValid}
              className="w-full py-2.5 rounded-card bg-accent text-white text-sm font-medium
                         hover:bg-accent-hover transition-warm
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Claiming…" : "Claim handle"}
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
