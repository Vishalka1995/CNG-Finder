import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Bell, ChevronRight, Info, Mail, RadioTower, Share2, Star } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Share, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";
import { isDemoMode } from "@/constants/config";
import { getDeviceId } from "@/lib/device";
import { supabase } from "@/lib/supabase";
import { usePreferencesStore } from "@/stores/preferencesStore";

const FEEDBACK_EMAIL = "vishal.a@flatworldsolutions.com";

interface RowProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}

function SettingsRow({ icon, label, onPress }: RowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center py-4 active:opacity-60"
    >
      {icon}
      <Text className="ml-3 flex-1 font-sans text-caption text-ink">{label}</Text>
      <ChevronRight color={COLORS.unknown} size={18} />
    </Pressable>
  );
}

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

function ToggleRow({ icon, label, sublabel, value, onValueChange }: ToggleRowProps) {
  return (
    <View className="flex-row items-center py-4">
      {icon}
      <View className="ml-3 flex-1">
        <Text className="font-sans text-caption text-ink">{label}</Text>
        {sublabel ? (
          <Text className="mt-0.5 font-sans text-label text-muted">{sublabel}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#E2E8F0", true: COLORS.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const { notificationsEnabled, load: loadPreferences, setNotificationsEnabled } =
    usePreferencesStore();

  useEffect(() => {
    void getDeviceId().then(setDeviceId);
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
    void loadPreferences();
  }, [loadPreferences]);

  const version = Constants.expoConfig?.version ?? "1.0.0";

  const shareApp = (): void => {
    void Share.share({
      message:
        "CNG Now — find CNG stations near you and see which ones actually have gas right now.",
    });
  };

  const sendFeedback = (): void => {
    const subject = encodeURIComponent(`CNG Now feedback (v${version})`);
    void Linking.openURL(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="px-6 py-6">
        <Text className="font-bold text-title text-ink">Settings</Text>

        {isDemoMode() ? (
          <View className="mt-4 rounded-xl bg-queue/15 px-4 py-3">
            <Text className="font-medium text-caption text-ink">Demo mode</Text>
            <Text className="mt-1 font-sans text-label text-muted">
              Showing built-in sample stations. Add your Supabase keys to .env to see
              real data.
            </Text>
          </View>
        ) : null}

        {/* About the app */}
        <Text className="mt-8 font-semibold text-caption text-muted">HOW IT WORKS</Text>

        <View className="mt-1 flex-row rounded-2xl bg-slate-50 p-4">
          <Info color={COLORS.muted} size={18} />
          <Text className="ml-3 flex-1 font-sans text-label leading-5 text-muted">
            CNG Now shows live station availability based on reports from other drivers.
            A report counts for less as it ages, so a green station means someone
            confirmed gas recently — not hours ago.
          </Text>
        </View>

        {/* Your activity */}
        <Text className="mt-8 font-semibold text-caption text-muted">YOUR ACTIVITY</Text>

        <View className="mt-1 rounded-2xl bg-slate-50 px-4">
          <SettingsRow
            icon={<RadioTower color={COLORS.muted} size={18} />}
            label="My reports"
            onPress={() => router.push("/my-reports")}
          />
        </View>

        {/* Notifications */}
        <Text className="mt-8 font-semibold text-caption text-muted">NOTIFICATIONS</Text>

        <View className="mt-1 rounded-2xl bg-slate-50 px-4">
          <ToggleRow
            icon={<Bell color={COLORS.muted} size={18} />}
            label="Station alerts"
            sublabel="Get notified when a favourite station is reported available"
            value={notificationsEnabled}
            onValueChange={(value) => void setNotificationsEnabled(value)}
          />
        </View>

        {/* Actions */}
        <Text className="mt-8 font-semibold text-caption text-muted">SUPPORT</Text>

        <View className="mt-1 rounded-2xl bg-slate-50 px-4">
          <SettingsRow
            icon={<Share2 color={COLORS.muted} size={18} />}
            label="Share the app"
            onPress={shareApp}
          />
          <View className="h-px bg-slate-200" />
          <SettingsRow
            icon={<Mail color={COLORS.muted} size={18} />}
            label="Send feedback"
            onPress={sendFeedback}
          />
          <View className="h-px bg-slate-200" />
          <SettingsRow
            icon={<Star color={COLORS.muted} size={18} />}
            label="Rate the app"
            onPress={sendFeedback}
          />
        </View>

        {/* Version, with diagnostics hidden behind a tap */}
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowDiagnostics((value) => !value)}
          className="mt-8 active:opacity-60"
        >
          <Text className="text-center font-sans text-label text-muted">
            Version {version}
          </Text>
        </Pressable>

        {showDiagnostics ? (
          <View className="mt-3 rounded-2xl bg-slate-50 p-4">
            <Text className="font-semibold text-label text-ink">Diagnostics</Text>

            <Text className="mt-3 font-sans text-label text-muted">Device ID</Text>
            <Text className="font-sans text-label text-ink" selectable>
              {deviceId ?? "loading…"}
            </Text>

            <Text className="mt-3 font-sans text-label text-muted">Session</Text>
            <Text className="font-sans text-label text-ink" selectable>
              {userId ?? "not signed in"}
            </Text>
          </View>
        ) : null}

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
