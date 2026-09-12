import { useRouter } from "expo-router";
import { Plus, Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StationCard } from "@/components/station/StationCard";
import { COLORS } from "@/constants/colors";
import { getCurrentCoords } from "@/lib/location";
import { useFavoriteStore } from "@/stores/favoriteStore";
import { useStationStore } from "@/stores/stationStore";
import type { NearbyStation } from "@/types/database";

type Filter = "all" | "available" | "open_now" | "saved";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "open_now", label: "Open 24h" },
  { key: "saved", label: "Saved" },
];

/**
 * Saved is a filter rather than its own screen: it is the same station list
 * with the same cards, differing only by which rows survive. A separate tab
 * for that was a whole navigation slot spent on a `filter()` call.
 */
function applyFilter(
  stations: NearbyStation[],
  filter: Filter,
  favoriteIds: string[],
): NearbyStation[] {
  switch (filter) {
    case "available":
      return stations.filter((station) => station.status === "available");
    case "open_now":
      return stations.filter((station) => station.is_24x7);
    case "saved":
      return stations.filter((station) => favoriteIds.includes(station.id));
    default:
      return stations;
  }
}

export default function ListScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const { stations, isLoading, error, isDemo, fetchNearby } = useStationStore();
  const { ids: favoriteIds, load: loadFavorites, toggle } = useFavoriteStore();

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const visible = useMemo(
    () => applyFilter(stations, filter, favoriteIds),
    [stations, filter, favoriteIds],
  );

  // A station can be saved and still be absent here, because `stations` only
  // holds what is within range right now. Saying so beats leaving someone to
  // wonder where a station they saved went.
  const savedOutOfRange =
    filter === "saved" ? favoriteIds.length - visible.length : 0;

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const fix = await getCurrentCoords();
      await fetchNearby(fix.coords, true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header */}
      <View className="px-6 pb-2 pt-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-bold text-title text-ink">Stations</Text>

          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search stations"
              onPress={() => router.push("/search")}
              className="h-10 w-10 items-center justify-center rounded-full bg-slate-100 active:opacity-60"
            >
              <Search color={COLORS.ink} size={18} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a missing station"
              onPress={() => router.push("/add-station")}
              className="h-10 w-10 items-center justify-center rounded-full bg-primary active:opacity-80"
            >
              <Plus color="#FFFFFF" size={18} />
            </Pressable>
          </View>
        </View>

        {isDemo ? (
          <Text className="mt-1 font-sans text-label text-queue">
            Demo data — connect Supabase for real stations
          </Text>
        ) : null}
      </View>

      {/* Filter chips */}
      <View className="flex-row gap-2 px-6 pb-3">
        {FILTERS.map((entry) => {
          const active = filter === entry.key;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(entry.key)}
              className={`rounded-full px-4 py-2 active:opacity-70 ${
                active ? "bg-primary" : "bg-slate-100"
              }`}
            >
              <Text
                className={`font-medium text-label ${active ? "text-white" : "text-muted"}`}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Content */}
      {isLoading && stations.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.primary} />
          <Text className="mt-3 font-sans text-caption text-muted">
            Loading stations…
          </Text>
        </View>
      ) : error && stations.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center font-semibold text-body text-ink">
            Could not load stations
          </Text>
          <Text className="mt-2 text-center font-sans text-caption text-muted">
            {error}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-6 pb-8 gap-3"
          refreshing={refreshing}
          onRefresh={refresh}
          ListHeaderComponent={
            savedOutOfRange > 0 ? (
              <View className="mb-1 rounded-xl bg-queue/15 px-4 py-2">
                <Text className="font-medium text-label text-ink">
                  {savedOutOfRange} saved{" "}
                  {savedOutOfRange === 1 ? "station is" : "stations are"} outside the
                  30 km range
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View className="items-center px-6 py-12">
              <Text className="text-center font-semibold text-body text-ink">
                {filter === "all"
                  ? "No stations nearby"
                  : filter === "saved"
                    ? "No saved stations"
                    : "Nothing matches this filter"}
              </Text>
              <Text className="mt-2 text-center font-sans text-caption text-muted">
                {filter === "all"
                  ? "We could not find CNG stations within 30 km."
                  : filter === "saved"
                    ? "Tap the heart on any station to keep it here."
                    : "Try the All filter to see every nearby station."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <StationCard
              station={item}
              isFavorite={favoriteIds.includes(item.id)}
              onPress={() =>
                router.push({ pathname: "/station/[id]", params: { id: item.id } })
              }
              onToggleFavorite={() => void toggle(item.id)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
