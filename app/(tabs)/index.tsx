import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { ChevronRight, Plus, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StationMap } from "@/components/map/StationMap";
import { NearbyStationRow } from "@/components/station/NearbyStationRow";
import { COLORS } from "@/constants/colors";
import { BANGALORE_CENTER, isMapConfigured } from "@/constants/config";
import {
  getCurrentCoords,
  openDirections,
  type Coords,
} from "@/lib/location";
import { useStationStore } from "@/stores/stationStore";
import type { NearbyStation } from "@/types/database";

/** How many stations the sheet lists before "View all". */
const NEARBY_COUNT = 10;

/**
 * Home / map screen.
 *
 * The map fills the screen with a persistent bottom sheet over it listing the
 * nearest stations. The sheet replaces what used to be a floating preview card
 * shown only after tapping a pin: tapping a pin now expands the sheet and
 * highlights that station's row, so station info lives on exactly one surface
 * instead of two overlays competing for the bottom of the screen.
 */
export default function MapScreen() {
  const [center, setCenter] = useState<Coords>({ ...BANGALORE_CENTER });
  const [hasLocation, setHasLocation] = useState(false);
  const [locating, setLocating] = useState(true);

  const router = useRouter();
  const { stations, isLoading, error, isStale, isDemo, fetchNearby, loadCached } =
    useStationStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sheetRef = useRef<BottomSheet>(null);

  // Peek / half / expanded. Half is the initial state so the list is visible
  // the moment the app opens without burying the map.
  const snapPoints = useMemo(() => ["14%", "42%", "88%"], []);

  // Already sorted ascending by both data paths (the nearby_stations RPC does
  // `order by n.dist`, and getDemoStations sorts too). Re-sorting is a cheap
  // no-op that keeps this correct if that invariant ever breaks upstream.
  const nearest = useMemo(
    () => [...stations].sort((a, b) => a.distance_m - b.distance_m).slice(0, NEARBY_COUNT),
    [stations],
  );

  const selected = stations.find((station) => station.id === selectedId) ?? null;

  // A pin tapped after panning the map may be outside the nearest N. Pin it to
  // the top of the list rather than leaving the tap with no visible effect.
  const pinned = selected && !nearest.some((s) => s.id === selected.id) ? selected : null;

  const rows = useMemo<NearbyStation[]>(
    () => (pinned ? [pinned, ...nearest] : nearest),
    [pinned, nearest],
  );

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

  // Tapping a pin expands the sheet so the highlighted row is actually visible.
  useEffect(() => {
    if (!selectedId) return;
    sheetRef.current?.snapToIndex(2);
  }, [selectedId]);

  const openStation = useCallback(
    (id: string) => router.push({ pathname: "/station/[id]", params: { id } }),
    [router],
  );

  const renderRow = useCallback(
    ({ item }: { item: NearbyStation }) => (
      <NearbyStationRow
        station={item}
        isSelected={item.id === selectedId}
        onPress={() => openStation(item.id)}
        onNavigate={() => openDirections(item)}
        onDismiss={
          pinned?.id === item.id ? () => setSelectedId(null) : undefined
        }
      />
    ),
    [selectedId, pinned, openStation],
  );

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
          the station count doubles as a manual refresh target. "Add station"
          lives here rather than as a floating button, because the sheet now
          owns the bottom of the screen at every snap position. */}
      <SafeAreaView className="absolute left-0 right-0 top-0" edges={["top"]}>
        <View className="mx-4 mt-2 flex-row items-center gap-2">
          <Pressable
            accessibilityRole="search"
            accessibilityLabel="Search CNG stations"
            onPress={() => router.push("/search")}
            className="flex-1 flex-row items-center rounded-2xl bg-white px-4 py-3 shadow active:opacity-70"
          >
            <Search color={COLORS.muted} size={18} />
            <Text className="ml-3 flex-1 font-sans text-body text-muted">
              Search CNG stations
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a missing station"
            onPress={() => router.push("/add-station")}
            className="h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow active:opacity-80"
          >
            <Plus color="#FFFFFF" size={22} />
          </Pressable>
        </View>

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

      {/* Must be the LAST child: a plain BottomSheet is a normal view, not a
          portal, so anything rendered after it would paint on top. */}
      <BottomSheet
        ref={sheetRef}
        index={1}
        snapPoints={snapPoints}
        handleIndicatorStyle={{ backgroundColor: COLORS.unknown }}
      >
        <View className="border-b border-slate-100 px-4 pb-2">
          <Text className="font-semibold text-body text-ink">Nearby stations</Text>
          <Text className="mt-0.5 font-sans text-label text-muted">
            {stations.length > 0
              ? `Closest ${Math.min(NEARBY_COUNT, stations.length)} of ${stations.length}`
              : "Nothing in range"}
          </Text>
        </View>

        <BottomSheetFlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 8 }}
          renderItem={renderRow}
          ListEmptyComponent={
            <View className="items-center px-2 py-8">
              <Text className="text-center font-semibold text-body text-ink">
                No stations nearby
              </Text>
              <Text className="mt-1 text-center font-sans text-caption text-muted">
                We could not find CNG stations within 30 km of you.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/add-station")}
                className="mt-4 min-h-[44px] w-full items-center justify-center rounded-xl bg-primary active:opacity-80"
              >
                <Text className="font-semibold text-caption text-white">
                  Add a station you know
                </Text>
              </Pressable>
            </View>
          }
          ListFooterComponent={
            stations.length > NEARBY_COUNT ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/(tabs)/list")}
                className="mt-1 min-h-[48px] flex-row items-center justify-center rounded-2xl border border-slate-200 active:opacity-70"
              >
                <Text className="font-semibold text-caption text-ink">
                  View all {stations.length} stations
                </Text>
                <ChevronRight color={COLORS.ink} size={16} />
              </Pressable>
            ) : null
          }
        />
      </BottomSheet>
    </View>
  );
}
