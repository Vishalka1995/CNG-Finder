import { ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { COLORS } from "@/constants/colors";
import { signInWithGoogle } from "@/lib/googleAuth";
import { showToast } from "@/stores/toastStore";

interface SaveAccountCardProps {
  /** Google address already attached, or null while the account is anonymous. */
  linkedEmail: string | null;
  /** Hidden entirely until there is something worth protecting. */
  hasPoints: boolean;
  onLinked: () => void;
}

/**
 * Offers to make the account recoverable.
 *
 * Shown here rather than during onboarding on purpose: asking someone to sign
 * in before they have used the app is friction in front of the value, and
 * "protect your points" means nothing to a driver who does not have any yet.
 * Once there are points on the account the sentence is true and the ask is
 * obvious, so that is when it appears.
 */
export function SaveAccountCard({
  linkedEmail,
  hasPoints,
  onLinked,
}: SaveAccountCardProps) {
  const [busy, setBusy] = useState(false);

  if (linkedEmail) {
    return (
      <View className="mt-1 flex-row items-center rounded-2xl bg-slate-50 p-4">
        <ShieldCheck color={COLORS.available} size={18} />
        <View className="ml-3 flex-1">
          <Text className="font-semibold text-caption text-ink">Account saved</Text>
          <Text className="mt-0.5 font-sans text-label text-muted" numberOfLines={1}>
            {linkedEmail}
          </Text>
        </View>
      </View>
    );
  }

  const link = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await signInWithGoogle();

      if (!result.ok) {
        showToast(result.message, "error");
        return;
      }

      showToast(
        result.restored
          ? "Welcome back — your points have been restored."
          : "Saved. Your points are safe now.",
      );
      onLinked();
    } finally {
      setBusy(false);
    }
  };

  return (
    // Urgent-looking once there is something to lose, quiet before then. It is
    // always offered though: someone who wants their account secured should
    // not have to earn points first to find the option.
    <View className={`mt-1 rounded-2xl p-4 ${hasPoints ? "bg-queue/15" : "bg-slate-50"}`}>
      <Text className="font-semibold text-caption text-ink">
        {hasPoints ? "Save your points" : "Save your account"}
      </Text>
      <Text className="mt-1 font-sans text-label leading-5 text-muted">
        {hasPoints
          ? "Your points live on this phone only. Sign in with Google and you will keep them if you change phone or reinstall the app."
          : "Sign in with Google so your points and badges follow you if you change phone or reinstall the app."}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign in with Google to save your account"
        onPress={() => void link()}
        disabled={busy}
        className="mt-3 min-h-[44px] flex-row items-center justify-center rounded-xl bg-white px-4 active:opacity-70"
      >
        {busy ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : (
          <Text className="font-semibold text-caption text-ink">Sign in with Google</Text>
        )}
      </Pressable>
    </View>
  );
}
