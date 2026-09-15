import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import { ArrowLeft, Clock, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StationCard } from "@/components/station/StationCard";
import { COLORS } from "@/constants/colors";
import { STORAGE_KEYS } from "@/constants/config";
import { getCurrentCoords } from "@/lib/location";
import { rankStations } from "@/lib/search";
import { useFavoriteStore } from "@/stores/favoriteStore";
import { useStationStore } from "@/stores/stationStore";

const MAX_RECENT = 5;

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const stations = useStationStore((state) => state.stations);
  const allStations = useStationStore((state) => state.allStations);
  const fetchNearby = useStationStore((state) => state.fetchNearby);
  const loadAllStations = useStationStore((state) => state.loadAllStations);
  const { ids: favoriteIds, load: loadFavorites, toggle } = useFavoriteStore();

  useEffect(() => {
    void loadFavorites();

    // Pulled when the search screen opens rather than at launch: it is only
    // needed here, and it keeps it off the critical path of the map.
    void getCurrentCoords().then((fix) => loadAllStations(fix.coords));

    void AsyncStorage.getItem(STORAGE_KEYS.recentSearches)
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          setRecent(parsed.filter((v): v is string => typeof v === "string"));
        }
      })
      .catch(() => undefined);
  }, [loadFavorites, loadAllStations]);

  // Searches every station, not just the nearby list. Bounding search to the
  // 30 km radius meant typing a station's name from another city returned
  // nothing, which reads as "it is not in this app" rather than "it is far
  // away". Falls back to the nearby list until the full one has arrived.
  const searchable = allStations.length > 0 ? allStations : stations;

  const results = useMemo(
    () => rankStations(searchable, query),
    [searchable, query],
  );

  /** Saves a term once the user acts on it, not on every keystroke. */
  const rememberTerm = (term: string): void => {
    const trimmed = term.trim();
    if (!trimmed) return;

    const next = [trimmed, ...recent.filter((r) => r !== trimmed)].slice(0, MAX_RECENT);
    setRecent(next);
    void AsyncStorage.setItem(STORAGE_KEYS.recentSearches, JSON.stringify(next)).catch(
      () => undefined,
    );
  };

  const clearRecent = (): void => {
    setRecent([]);
    void AsyncStorage.removeItem(STORAGE_KEYS.recentSearches).catch(() => undefined);
  };

  const openStation = (id: string): void => {
    rememberTerm(query);
    router.push({ pathname: "/station/[id]", params: { id } });
  };

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
      <Stack.Screen options={{ headerShown: false }} />

      {/* Search bar */}
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          <ArrowLeft color={COLORS.ink} size={22} />
        </Pressable>

        <View className="flex-1 flex-row items-center rounded-2xl bg-slate-100 px-4">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or area"
            placeholderTextColor={COLORS.unknown}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => rememberTerm(query)}
            className="h-11 flex-1 font-sans text-caption text-ink"
          />

          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery("")}
              hitSlop={10}
              className="active:opacity-60"
            >
              <X color={COLORS.muted} size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {query.trim().length === 0 ? (
        // Idle state: recent searches
        <View className="px-6 pt-2">
          {recent.length > 0 ? (
            <>
              <View className="flex-row items-center justify-between">
                <Text className="font-semibold text-caption text-ink">
                  Recent searches
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={clearRecent}
                  className="active:opacity-60"
                >
                  <Text className="font-medium text-label text-muted">Clear</Text>
                </Pressable>
              </View>

              <View className="mt-3 gap-1">
                {recent.map((term) => (
                  <Pressable
                    key={term}
                    accessibilityRole="button"
                    onPress={() => setQuery(term)}
                    className="flex-row items-center py-3 active:opacity-60"
                  >
                    <Clock color={COLORS.unknown} size={16} />
                    <Text className="ml-3 font-sans text-caption text-ink">{term}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Text className="mt-8 text-center font-sans text-caption text-muted">
              Search for a station by name, area or operator.
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-6 pb-8 gap-3"
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={refresh}
          ListEmptyComponent={
            <View className="items-center px-6 py-12">
              <Text className="text-center font-semibold text-body text-ink">
                No matches
              </Text>
              <Text className="mt-2 text-center font-sans text-caption text-muted">
                Nothing nearby matches “{query.trim()}”.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <StationCard
              station={item}
              isFavorite={favoriteIds.includes(item.id)}
              onPress={() => openStation(item.id)}
              onToggleFavorite={() => void toggle(item.id)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
