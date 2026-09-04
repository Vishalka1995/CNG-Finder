import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getDeviceId } from "@/lib/device";
import { supabase } from "@/lib/supabase";

/**
 * Settings.
 *
 * Phase 1 shows the diagnostics needed for Checkpoint 1: the device id must be
 * identical after a force-quit, and the session id proves anonymous auth
 * succeeded. The real settings (notifications, language, feedback) land in
 * Phase 3.
 */
export default function SettingsScreen() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void getDeviceId().then(setDeviceId);
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="px-6 py-6">
        <Text className="font-bold text-title text-ink">Settings</Text>

        <View className="mt-6 rounded-2xl bg-slate-50 p-4">
          <Text className="font-semibold text-caption text-ink">Diagnostics</Text>

          <Text className="mt-3 font-sans text-label text-muted">Device ID</Text>
          <Text className="font-sans text-label text-ink" selectable>
            {deviceId ?? "loading…"}
          </Text>

          <Text className="mt-3 font-sans text-label text-muted">Anonymous session</Text>
          <Text className="font-sans text-label text-ink" selectable>
            {userId ?? "not signed in"}
          </Text>

          <Text className="mt-3 font-sans text-label text-muted">Version</Text>
          <Text className="font-sans text-label text-ink">
            {Constants.expoConfig?.version ?? "1.0.0"}
          </Text>
        </View>

        <Text className="mt-6 font-sans text-label text-muted">
          Notifications, language and feedback options arrive in a later update.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
