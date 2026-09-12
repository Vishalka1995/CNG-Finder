import { Stack, useRouter } from "expo-router";
import { ArrowLeft, Crown } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";
import { getHallOfFame } from "@/lib/points";
import type { HallOfFameRow } from "@/types/database";

/** '2026-08' -> 'August 2026'. Parsed rather than Date-constructed, because
 *  `new Date('2026-08')` is parsed as UTC and can land in the previous month. */
function monthName(month: string): string {
  const [year, index] = month.split("-");
  const monthIndex = Number(index) - 1;

  if (!year || Number.isNaN(monthIndex)) return month;

  const label = new Date(2000, monthIndex, 1).toLocaleString("en-IN", {
    month: "long",
  });
  return `${label} ${year}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

interface Podium {
  month: string;
  places: HallOfFameRow[];
}

/** Rows arrive newest month first, gold to bronze within each -- see
 *  hall_of_fame(). Grouping preserves that order rather than re-sorting. */
function groupByMonth(rows: HallOfFameRow[]): Podium[] {
  const months: Podium[] = [];

  for (const row of rows) {
    const current = months.at(-1);
    if (current && current.month === row.month) {
      current.places.push(row);
    } else {
      months.push({ month: row.month, places: [row] });
    }
  }

  return months;
}

function PodiumCard({ podium }: { podium: Podium }) {
  return (
    <View className="rounded-2xl bg-slate-50 p-4">
      <Text className="font-semibold text-caption text-ink">
        {monthName(podium.month)}
      </Text>

      <View className="mt-3 gap-2">
        {podium.places.map((row) => (
          <View key={row.place} className="flex-row items-center">
            <Text className="w-7 text-lg">{MEDALS[row.place - 1] ?? ""}</Text>

            <View className="flex-1 pr-2">
              <Text className="font-medium text-caption text-ink" numberOfLines={1}>
                {row.winner_name}
              </Text>
              <Text className="font-sans text-label text-muted" numberOfLines={1}>
                {row.winner_city ? `${row.winner_city} · ` : ""}
                {row.prize ?? "—"}
              </Text>
            </View>

            <Text className="font-bold text-caption text-ink">{row.points}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Past monthly champions.
 *
 * Reads through the hall_of_fame() function rather than the winners table
 * directly: that table holds each winner's UPI id, and no screen should be one
 * policy mistake away from publishing it.
 */
export default function HallOfFameScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<HallOfFameRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const data = await getHallOfFame();
      if (cancelled) return;
      setRows(data);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
        <Text className="ml-1 flex-1 font-semibold text-body text-ink">
          Hall of Fame
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={groupByMonth(rows)}
          keyExtractor={(item) => item.month}
          contentContainerClassName="px-6 py-6 gap-3"
          renderItem={({ item }) => <PodiumCard podium={item} />}
          ListEmptyComponent={
            <View className="items-center px-6 py-12">
              <Crown color={COLORS.unknown} size={40} strokeWidth={1.5} />
              <Text className="mt-4 text-center font-semibold text-body text-ink">
                No champions yet
              </Text>
              <Text className="mt-2 text-center font-sans text-caption leading-5 text-muted">
                The first monthly winner will be crowned at the end of this month.
                Report stations to put your name in.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
