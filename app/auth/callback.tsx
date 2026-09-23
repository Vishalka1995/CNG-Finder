import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";
import { supabase } from "@/lib/supabase";

/**
 * Where Google sends the driver back to.
 *
 * openAuthSessionAsync is supposed to catch the redirect itself and hand the
 * URL straight back to the caller, but Android also delivers `cngnow://` to
 * the app as an ordinary deep link -- so the router navigates here as well.
 * Without a screen at this path that showed as "Unmatched Route", a 404 on top
 * of a sign-in that had actually succeeded.
 *
 * So this exists to catch that navigation and get out of the way. It finishes
 * the exchange only if the caller has not already: the code is single-use, and
 * redeeming it twice fails.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    let cancelled = false;

    const finish = async (): Promise<void> => {
      try {
        const { data } = await supabase.auth.getSession();

        // Nothing to do when openAuthSessionAsync already redeemed the code.
        if (!data.session && typeof code === "string" && code.length > 0) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch {
        // Falling through still beats stranding the driver on a blank screen;
        // an unfinished sign-in simply leaves the account as it was.
      }

      if (cancelled) return;
      router.replace("/(tabs)/you");
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-1 items-center justify-center px-6">
        <ActivityIndicator color={COLORS.primary} />
        <Text className="mt-4 font-sans text-caption text-muted">Signing you in…</Text>
      </View>
    </SafeAreaView>
  );
}
