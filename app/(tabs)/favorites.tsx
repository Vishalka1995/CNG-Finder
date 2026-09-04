import { useRouter } from "expo-router";
import { Heart } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StationCard } from "@/components/station/StationCard";
import { COLORS } from "@/constants/colors";
import { useFavoriteStore } from "@/stores/favoriteStore";
import { useStationStore } from "@/stores/stationStore";

export default function FavoritesScreen() {
  const router = useRouter();

  const stations = useStationStore((state) => state.stations);
  const { ids: favoriteIds, isLoaded, load, toggle } = useFavoriteStore();

  useEffect(() => {
    void load();
  }, [load]);

  // Favourites are ids; resolve them against the loaded station list so the
  // cards show live status. Ordered by the nearby list, i.e. by distance.
  const favorites = useMemo(
    () => stations.filter((station) => favoriteIds.includes(station.id)),
    [stations, favoriteIds],
  );

  // Ids that no longer resolve -- e.g. saved on the map, then filtered out of
  // the current radius. Worth telling the user rather than silently dropping.
  const missingCount = favoriteIds.length - favorites.length;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="px-6 pb-3 pt-4">
        <Text className="font-bold text-title text-ink">Favorites</Text>
      </View>

      {isLoaded && favorites.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Heart color={COLORS.unknown} size={40} strokeWidth={1.5} />
          <Text className="mt-4 font-semibold text-heading text-ink">
            No favorites yet
          </Text>
          <Text className="mt-2 text-center font-sans text-caption text-muted">
            Save your regular stations to see live status at a glance. Tap the heart on
            any station to add it.
          </Text>
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-6 pb-8 gap-3"
          ListFooterComponent={
            missingCount > 0 ? (
              <Text className="mt-4 text-center font-sans text-label text-muted">
                {missingCount} saved station{missingCount === 1 ? "" : "s"} not in range
                right now
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <StationCard
              station={item}
              isFavorite
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
