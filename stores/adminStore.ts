import { create } from "zustand";

import { supabase } from "@/lib/supabase";

/**
 * Whether this account is an admin.
 *
 * Kept in a store because two screens need it and it is worth asking the
 * server only once per launch. It is NOT the security boundary -- the report
 * trigger checks admin status itself, in the database, for exactly the reason
 * every other rule lives there. This copy exists so the app can skip its own
 * proximity check and show the badge; flipping it locally buys nothing,
 * because the insert would still be judged on the server's answer.
 */

interface AdminState {
  isAdmin: boolean;
  isLoaded: boolean;
  load: () => Promise<void>;
}

export const useAdminStore = create<AdminState>((set) => ({
  isAdmin: false,
  isLoaded: false,

  load: async () => {
    try {
      const { data, error } = await supabase.rpc("is_admin", {});
      set({ isAdmin: error ? false : Boolean(data), isLoaded: true });
    } catch {
      // Default to a normal driver. Failing closed here only means the app
      // applies its own proximity check, which the server would apply anyway.
      set({ isAdmin: false, isLoaded: true });
    }
  },
}));
