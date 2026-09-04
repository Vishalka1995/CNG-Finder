import { Stack, useRouter } from "expo-router";
import { ArrowLeft, RadioTower } from "lucide-react-native";
import { useEffect } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusBadge } from "@/components/station/StatusBadge";
import { COLORS } from "@/constants/colors";
import { timeAgo } from "@/lib/confidence";
import { useReportStore } from "@/stores/reportStore";

export default function MyReportsScreen() {
  const router = useRouter();
  const { reports, isLoaded, load, clear } = useReportStore();

  useEffect(() => {
    void load();
  }, [load]);

  const confirmClear = (): void => {
    Alert.alert(
      "Clear history?",
      "This removes your local report history. Reports you have already sent stay with other drivers.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: () => void clear() },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center border-b border-slate-100 px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          <ArrowLeft color={COLORS.ink} size={22} />
        </Pressable>

        <Text className="ml-1 flex-1 font-semibold text-body text-ink">My reports</Text>

        {reports.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={confirmClear}
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="font-medium text-label text-muted">Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {isLoaded && reports.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <RadioTower color={COLORS.unknown} size={40} strokeWidth={1.5} />
          <Text className="mt-4 font-semibold text-heading text-ink">
            No reports yet
          </Text>
          <Text className="mt-2 text-center font-sans text-caption text-muted">
            When you report a station status, it appears here so you can see what you
            have contributed.
          </Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-6 py-4 gap-3"
          ListHeaderComponent={
            <Text className="pb-1 font-sans text-label text-muted">
              {reports.length} report{reports.length === 1 ? "" : "s"} sent from this
              device
            </Text>
          }
          renderItem={({ item }) => (
            <View className="rounded-2xl border border-slate-100 bg-white p-4">
              <Text className="font-semibold text-caption text-ink" numberOfLines={1}>
                {item.stationName}
              </Text>

              <View className="mt-2 flex-row items-center justify-between">
                <StatusBadge status={item.status} />
                <Text className="font-sans text-label text-muted">
                  {timeAgo(item.createdAt)}
                </Text>
              </View>

              {item.note ? (
                <Text className="mt-2 font-sans text-label text-muted">
                  “{item.note}”
                </Text>
              ) : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
