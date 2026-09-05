import { create } from "zustand";

/**
 * Global toast queue.
 *
 * A single `<Toast />` is mounted once in the root layout (outside any one
 * screen's tree), so `showToast()` works from anywhere -- including right
 * before a `router.back()`, where a screen-local toast would unmount before it
 * ever finished animating in.
 */

export type ToastTone = "success" | "error";

interface ToastState {
  message: string | null;
  tone: ToastTone;
  /** Bumped on every show() so the Toast component can restart its animation
   *  even when the same message is shown twice in a row. */
  key: number;
  show: (message: string, tone?: ToastTone) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  message: null,
  tone: "success",
  key: 0,

  show: (message, tone = "success") => {
    set({ message, tone, key: get().key + 1 });
  },

  hide: () => set({ message: null }),
}));

export function showToast(message: string, tone: ToastTone = "success"): void {
  useToastStore.getState().show(message, tone);
}
