import { useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, Crown, Pencil, Trophy } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NameDialog } from "@/components/points/NameDialog";
import { COLORS } from "@/constants/colors";
import { getDisplayName, getLeaderboard, getMyPlace } from "@/lib/points";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { LeaderboardRow, MyPlaceRow } from "@/types/database";

/** IST, to match the period the database scores against. */
function monthLabel(): string {
  return new Date().toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function daysLeftInMonth(): number {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(0, end.getDate() - now.getDate());
}

function Row({ row }: { row: LeaderboardRow }) {
  return (
    <View
      className={`flex-row items-center rounded-2xl px-4 py-3 ${
        row.is_me ? "border-2 border-primary bg-primary/5" : "bg-white"
      }`}
    >
      <Text className="w-10 font-bold text-caption text-muted">#{row.place}</Text>

      <View className="flex-1 pr-3">
        <Text className="font-semibold text-caption text-ink" numberOfLines={1}>
          {row.driver_name}
          {row.is_me ? " (you)" : ""}
        </Text>
        {row.driver_city ? (
          <Text className="mt-0.5 font-sans text-label text-muted" numberOfLines={1}>
            {row.driver_city}
          </Text>
        ) : null}
      </View>

      <Text className="font-bold text-caption text-ink">{row.points}</Text>
    </View>
  );
}

/**
 * This month's national standings.
 *
 * Ranking, tie handling and the city shown against each driver are all decided
 * in SQL (migration 0010) -- this screen only renders what comes back. Points
 * will eventually decide a payout, so nothing about a driver's standing is
 * computed anywhere the client could reach it.
 */
export default function LeaderboardScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [myPlace, setMyPlace] = useState<MyPlaceRow | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const loadPreferences = usePreferencesStore((state) => state.load);

  const load = useCallback(async (): Promise<void> => {
    // Showcase mode lives in preferences, and this tab can be the first one
    // opened after a cold start -- reading it before the load finishes would
    // show the real (empty) board during a demo.
    await loadPreferences();

    const [board, place, displayName] = await Promise.all([
      getLeaderboard(),
      getMyPlace(),
      getDisplayName(),
    ]);

    setRows(board);
    setMyPlace(place);
    setName(displayName);
    setIsLoading(false);
  }, [loadPreferences]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        await load();
        if (cancelled) return;
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const days = daysLeftInMonth();

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="px-6 pb-3 pt-4">
        <View className="flex-row items-center">
          <Trophy color={COLORS.queue} size={22} />
          <Text className="ml-2 flex-1 font-bold text-title text-ink">Leaderboard</Text>
        </View>

        <Text className="mt-1 font-sans text-caption text-muted">
          {monthLabel()} — {days} {days === 1 ? "day" : "days"} left
        </Text>

        <View className="mt-3 flex-row items-center gap-2">
          {/* Once set, the name is fixed (migration 0014), so it stops being a
              control and becomes a label. Offered here rather than at
              onboarding: a name is only worth choosing once there is a board
              to appear on. */}
          {name ? (
            <View className="max-w-[38%] rounded-xl bg-slate-100 px-3 py-2">
              <Text className="font-medium text-label text-ink" numberOfLines={1}>
                {name}
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set your leaderboard name"
              onPress={() => setEditingName(true)}
              className="flex-row items-center rounded-xl bg-slate-100 px-3 py-2 active:opacity-70"
            >
              <Pencil color={COLORS.muted} size={14} />
              <Text className="ml-2 font-medium text-label text-ink">Set your name</Text>
            </Pressable>
          )}

          {/* Up here rather than below the list: past winners are what make the
              prize feel real, and nobody scrolls 100 rows to find out. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See past monthly winners"
            onPress={() => router.push("/hall-of-fame")}
            className="flex-1 flex-row items-center rounded-xl bg-queue/15 px-3 py-2 active:opacity-70"
          >
            <Crown color={COLORS.queue} size={14} />
            <Text
              className="ml-2 flex-1 font-medium text-label text-ink"
              numberOfLines={1}
            >
              See past winners
            </Text>
            <ChevronRight color={COLORS.muted} size={14} />
          </Pressable>
        </View>
      </View>

      {/* Your standing, pinned above the list -- most drivers are nowhere near
          the visible top of it. */}
      {myPlace ? (
        <View className="mx-6 mb-3 flex-row items-center rounded-2xl bg-primary/10 px-4 py-3">
          <Text className="flex-1 font-semibold text-caption text-ink">
            You are #{myPlace.place} of {myPlace.total_drivers}
          </Text>
          <Text className="font-bold text-body text-primary">{myPlace.points}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => `${item.place}-${item.driver_name}`}
          contentContainerClassName="px-6 pb-8 gap-2"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={COLORS.primary}
            />
          }
          renderItem={({ item }) => <Row row={item} />}
          ListEmptyComponent={
            <View className="items-center px-6 py-12">
              <Trophy color={COLORS.unknown} size={40} strokeWidth={1.5} />
              <Text className="mt-4 text-center font-semibold text-body text-ink">
                Nobody has scored yet this month
              </Text>
              <Text className="mt-2 text-center font-sans text-caption leading-5 text-muted">
                Report a station while you are there and you will be the first name
                on this board.
              </Text>
            </View>
          }
        />
      )}

      {editingName ? (
        <NameDialog
          initialValue={name}
          onClose={() => setEditingName(false)}
          onSaved={(saved) => {
            setName(saved);
            void load();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
