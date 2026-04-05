import { useCallback, useEffect, useState } from "react";
import { getMyProfile, type Profile } from "@/lib/api";

/**
 * useProfile — loads the authenticated user's Stoa profile and surfaces the
 * `needsSetup` flag so AuthGate can show the ProfileSetupModal on first login.
 *
 * "Needs setup" is true when the backend returned an auto-backfilled profile
 * with a placeholder username (first login after migration 006 applied to a
 * legacy user). After the user claims a real username via /social/setup, call
 * `reload()` to pick up the new state.
 */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyProfile();
      setProfile(res.profile);
      setNeedsSetup(res.needs_setup);
    } catch {
      // Backend may be down or migration not applied — fail silent, let the
      // rest of the app work without a profile.
      setProfile(null);
      setNeedsSetup(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { profile, needsSetup, loading, reload: load };
}
