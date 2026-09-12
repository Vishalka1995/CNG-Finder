import BottomSheet, { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import type { CameraRef } from "@maplibre/maplibre-react-native";
import { useRouter } from "expo-router";
import { ChevronRight, Layers, LocateFixed, RefreshCw, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
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
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useStationStore } from "@/stores/stationStore";
import { showToast } from "@/stores/toastStore";
import type { NearbyStation } from "@/types/database";

/** How many stations the sheet lists before "View all". */
const NEARBY_COUNT = 10;

/** Zoom flown to when the driver taps "centre on me". */
const LOCATE_ZOOM = 15;

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

  const mapStyle = usePreferencesStore((state) => state.mapStyle);
  const setMapStyle = usePreferencesStore((state) => state.setMapStyle);
  const loadPreferences = usePreferencesStore((state) => state.load);

  const sheetRef = useRef<BottomSheet>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [locatingMe, setLocatingMe] = useState(false);

  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    setHeaderHeight(event.nativeEvent.layout.height);
  }, []);

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
      await Promise.all([loadCached(), loadPreferences()]);
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
  }, [fetchNearby, loadCached, loadPreferences]);

  // Tapping a pin expands the sheet so the highlighted row is actually visible.
  useEffect(() => {
    if (!selectedId) return;
    sheetRef.current?.snapToIndex(2);
  }, [selectedId]);

  /** "Centre on me" -- fetches a fresh fix and flies the camera to it, same
   *  as Google Maps' own location button. */
  const recenterOnMe = async (): Promise<void> => {
    setLocatingMe(true);
    try {
      const fix = await getCurrentCoords();
      if (fix.isFallback) {
        showToast("Turn on location to centre the map on you.");
        return;
      }

      setCenter(fix.coords);
      setHasLocation(true);
      cameraRef.current?.flyTo({
        center: [fix.coords.longitude, fix.coords.latitude],
        zoom: LOCATE_ZOOM,
        duration: 600,
      });
    } finally {
      setLocatingMe(false);
    }
  };

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
        mapStyle={mapStyle}
        cameraRef={cameraRef}
      />

      {/* Map controls, stacked below the header. Positioned from the header's
          own measured height (via onHeaderLayout) rather than a guessed
          offset, so they stay put whether or not a banner is showing. */}
      <View
        className="absolute right-4 gap-2"
        style={{ top: headerHeight + 12 }}
        pointerEvents="box-none"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            mapStyle === "satellite" ? "Switch to street map" : "Switch to satellite"
          }
          onPress={() =>
            void setMapStyle(mapStyle === "satellite" ? "streets" : "satellite")
          }
          className="h-11 w-11 items-center justify-center rounded-xl bg-white shadow active:opacity-70"
        >
          <Layers color={mapStyle === "satellite" ? COLORS.primary : COLORS.ink} size={20} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centre on my location"
          onPress={() => void recenterOnMe()}
          disabled={locatingMe}
          className="h-11 w-11 items-center justify-center rounded-xl bg-white shadow active:opacity-70"
        >
          {locatingMe ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : (
            <LocateFixed color={COLORS.ink} size={20} />
          )}
        </Pressable>
      </View>

      {/* Header. Just the search entry point -- station count and refresh live
          in the sheet's own header below, and "Add station" lives on the List
          tab, where browsing everything makes a gap more obvious. */}
      <SafeAreaView
        className="absolute left-0 right-0 top-0"
        edges={["top"]}
        onLayout={onHeaderLayout}
      >
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
        <View className="flex-row items-center justify-between border-b border-slate-100 px-4 pb-2">
          <View>
            <Text className="font-semibold text-body text-ink">Nearby stations</Text>
            <Text className="mt-0.5 font-sans text-label text-muted">
              {stations.length > 0
                ? `Closest ${Math.min(NEARBY_COUNT, stations.length)} of ${stations.length}`
                : "Nothing in range"}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh nearby stations"
            disabled={isLoading}
            onPress={() => void fetchNearby(center, true)}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
          >
            {isLoading ? (
              <ActivityIndicator color={COLORS.muted} size="small" />
            ) : (
              <RefreshCw color={COLORS.muted} size={18} />
            )}
          </Pressable>
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
