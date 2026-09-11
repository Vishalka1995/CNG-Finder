import { Text, View } from "react-native";

import type { MapStyleId } from "@/constants/config";
import { formatDistance } from "@/lib/location";
import type { Coords } from "@/lib/location";
import type { NearbyStation } from "@/types/database";

interface StationMapProps {
  stations: NearbyStation[];
  center: Coords;
  showUserLocation: boolean;
  onSelectStation: (stationId: string) => void;
  /** Accepted to match the native component's props; unused in this stub. */
  mapStyle?: MapStyleId;
}

/**
 * Web stand-in for the map.
 *
 * MapLibre is a native module with no web build, and Metro resolves this
 * `.web.tsx` file instead of StationMap.tsx when bundling for the browser. It
 * exists so `npx expo start --web` can be used to check navigation, typography
 * and the palette during development -- the real map only runs in the Android
 * dev build.
 */
export function StationMap({ stations, onSelectStation }: StationMapProps) {
  return (
    <View className="flex-1 items-center justify-center bg-slate-100 p-6">
      <Text className="font-semibold text-heading text-ink">Map preview unavailable</Text>
      <Text className="mt-2 text-center font-sans text-caption text-muted">
        MapLibre is native-only. Run the Android dev build to see the map.
      </Text>

      {stations.length > 0 ? (
        <View className="mt-6 w-full max-w-md gap-2">
          <Text className="font-medium text-label text-muted">
            {stations.length} station{stations.length === 1 ? "" : "s"} loaded
          </Text>
          {stations.slice(0, 5).map((station) => (
            <Text
              key={station.id}
              onPress={() => onSelectStation(station.id)}
              className="rounded-xl bg-white px-4 py-3 font-sans text-caption text-ink"
            >
              {station.name} · {formatDistance(station.distance_m)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
