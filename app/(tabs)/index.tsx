import { useRouter } from "expo-router";
import { ChevronRight, Plus, Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StationMap } from "@/components/map/StationMap";
import { StatusBadge } from "@/components/station/StatusBadge";
import { COLORS } from "@/constants/colors";
import { BANGALORE_CENTER, isMapConfigured } from "@/constants/config";
import { confidenceLabel, timeAgo } from "@/lib/confidence";
import { formatDistance, getCurrentCoords, type Coords } from "@/lib/location";
import { useStationStore } from "@/stores/stationStore";

/**
 * Home / map screen.
 *
 * Phase 1 scope: map, live-coloured markers, clustering, and a simple preview
 * card for the tapped station. The draggable bottom sheet, directions, and the
 * report flow arrive in Phase 2.
 */
export default function MapScreen() {
  const [center, setCenter] = useState<Coords>({ ...BANGALORE_CENTER });
  const [hasLocation, setHasLocation] = useState(false);
  const [locating, setLocating] = useState(true);

  const router = useRouter();
  const { stations, isLoading, error, isStale, isDemo, fetchNearby, loadCached } =
    useStationStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = stations.find((station) => station.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;

    const init = async (): Promise<void> => {
      await loadCached();
      const result = await getCurrentCoords();
      if (cancelled) return;

      setCenter(result.coords);
      setHasLocation(!result.isFallback);
      setLocating(false);
      await fetchNearby(result.coords);
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [fetchNearby, loadCached]);

  // Without a MapTiler key the basemap renders as a blank grey grid, which
  // looks like a bug. Say so explicitly instead.
  if (!isMapConfigured()) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface px-6">
        <Text className="text-center font-semibold text-heading text-ink">
          Map key missing
        </Text>
        <Text className="mt-2 text-center font-sans text-caption text-muted">
          Set EXPO_PUBLIC_MAPTILER_KEY in your .env file and restart the dev server.
        </Text>
      </SafeAreaView>
    );
  }

  if (locating) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator color={COLORS.primary} />
        <Text className="mt-3 font-sans text-caption text-muted">Finding you…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface">
      <StationMap
        stations={stations}
        center={center}
        showUserLocation={hasLocation}
        onSelectStation={setSelectedId}
      />

      {/* Header. A map has no scroll gesture to hook pull-to-refresh into, so
          the station count doubles as a manual refresh target. Search sits
          here rather than only on the List tab, since this is the screen
          people actually start on. */}
      <SafeAreaView className="absolute left-0 right-0 top-0" edges={["top"]}>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search CNG stations"
          onPress={() => router.push("/search")}
          className="mx-4 mt-2 flex-row items-center rounded-2xl bg-white px-4 py-3 shadow active:opacity-70"
        >
          <Search color={COLORS.muted} size={18} />
          <Text className="ml-3 flex-1 font-sans text-body text-muted">
            Search CNG stations
          </Text>
        </Pressable>

        <View className="mx-4 mt-2 flex-row items-center justify-between rounded-2xl bg-white px-4 py-2 shadow">
          <Text className="font-semibold text-caption text-ink">CNG Now</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh nearby stations"
            disabled={isLoading}
            onPress={() => void fetchNearby(center, true)}
            hitSlop={8}
            className="active:opacity-60"
          >
            <Text className="font-sans text-label text-muted">
              {isLoading ? "Updating…" : `${stations.length} nearby · tap to refresh`}
            </Text>
          </Pressable>
        </View>

        {isDemo ? (
          <View className="mx-4 mt-2 rounded-xl bg-queue/15 px-4 py-2">
            <Text className="font-medium text-label text-ink">
              Demo data — connect Supabase to see real stations
            </Text>
          </View>
        ) : null}

        {isStale ? (
          <View className="mx-4 mt-2 rounded-xl bg-queue/15 px-4 py-2">
            <Text className="font-medium text-label text-ink">
              Showing saved data — you appear to be offline
            </Text>
          </View>
        ) : null}

        {error && !isStale ? (
          <View className="mx-4 mt-2 rounded-xl bg-unavailable/15 px-4 py-2">
            <Text className="font-medium text-label text-ink">{error}</Text>
          </View>
        ) : null}
      </SafeAreaView>

      {/* Empty state */}
      {!isLoading && stations.length === 0 && !error ? (
        <View className="absolute bottom-6 left-4 right-4 rounded-2xl bg-white p-4 shadow">
          <Text className="font-semibold text-body text-ink">No stations nearby</Text>
          <Text className="mt-1 font-sans text-caption text-muted">
            We could not find CNG stations within 30 km of you.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/add-station")}
            className="mt-3 min-h-[44px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="font-semibold text-caption text-white">
              Add a station you know
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Add-a-station button, shown whenever the preview card is not up so the
          two never overlap at the bottom of the screen. */}
      {!selected && stations.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a missing station"
          onPress={() => router.push("/add-station")}
          className="absolute bottom-6 right-4 h-14 flex-row items-center rounded-full bg-primary px-5 shadow-lg active:opacity-80"
        >
          <Plus color="#FFFFFF" size={20} />
          <Text className="ml-2 font-semibold text-caption text-white">Add station</Text>
        </Pressable>
      ) : null}

      {/* Selected station preview -- becomes a draggable sheet in Phase 2 */}
      {selected ? (
        <View className="absolute bottom-6 left-4 right-4 rounded-2xl bg-white p-4 shadow-lg">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="font-semibold text-body text-ink">{selected.name}</Text>
              <Text className="mt-1 font-sans text-caption text-muted">
                {formatDistance(selected.distance_m)} away
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelectedId(null)}
              className="px-2 py-1 active:opacity-60"
            >
              <Text className="font-medium text-caption text-muted">Close</Text>
            </Pressable>
          </View>

          <View className="mt-3">
            <StatusBadge status={selected.status} />
          </View>

          <Text className="mt-2 font-sans text-label text-muted">
            {confidenceLabel(selected.confidence, selected.report_count)}
            {selected.last_reported_at
              ? ` · last report ${timeAgo(selected.last_reported_at)}`
              : ""}
          </Text>

          <View className="mt-4 flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/station/[id]", params: { id: selected.id } })
              }
              className="min-h-[44px] flex-1 flex-row items-center justify-center rounded-xl border border-slate-300 active:opacity-70"
            >
              <Text className="font-semibold text-caption text-ink">Details</Text>
              <ChevronRight color={COLORS.ink} size={16} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/report/[stationId]",
                  params: { stationId: selected.id },
                })
              }
              className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-primary active:opacity-80"
            >
              <Text className="font-semibold text-caption text-white">Report</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
