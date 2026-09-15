import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { STORAGE_KEYS } from "@/constants/config";

/**
 * Whether the user has finished onboarding.
 *
 * This lives in a store rather than in the root layout's own state because two
 * places need it: the layout's redirect guard reads it, and the last onboarding
 * screen writes it. While the layout held it privately, finishing onboarding
 * persisted the flag but left the guard's copy stale, so the guard immediately
 * bounced the user from the tabs back to the first onboarding screen.
 */
interface OnboardingState {
  hasOnboarded: boolean;
  load: () => Promise<void>;
  complete: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasOnboarded: false,

  load: async () => {
    try {
      const flag = await AsyncStorage.getItem(STORAGE_KEYS.onboarded);
      set({ hasOnboarded: flag === "true" });
    } catch {
      // Treat an unreadable flag as "not yet onboarded": showing onboarding a
      // second time is recoverable, skipping it on a first run is not.
      set({ hasOnboarded: false });
    }
  },

  complete: async () => {
    // Flips in memory before persisting, so the redirect guard already sees a
    // finished user on the render that follows.
    set({ hasOnboarded: true });
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.onboarded, "true");
    } catch {
      // Non-fatal: onboarding still ends for this session.
    }
  },
}));
