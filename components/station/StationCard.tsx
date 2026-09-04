import { Heart } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { StatusBadge } from "@/components/station/StatusBadge";
import { COLORS } from "@/constants/colors";
import { confidenceLabel, timeAgo } from "@/lib/confidence";
import { formatDistance } from "@/lib/location";
import type { NearbyStation } from "@/types/database";

interface StationCardProps {
  station: NearbyStation;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
}

/** One station row. Shared by the list, favourites and search screens. */
export function StationCard({
  station,
  isFavorite,
  onPress,
  onToggleFavorite,
}: StationCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${station.name}, ${formatDistance(station.distance_m)} away`}
      onPress={onPress}
      className="rounded-2xl border border-slate-100 bg-white p-4 active:opacity-70"
    >
      <View className="flex-row items-start">
        <View className="flex-1 pr-2">
          <Text className="font-semibold text-body text-ink" numberOfLines={1}>
            {station.name}
          </Text>

          <Text className="mt-1 font-sans text-label text-muted" numberOfLines={1}>
            {station.area ? `${station.area} · ` : ""}
            {formatDistance(station.distance_m)} away
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
          onPress={onToggleFavorite}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        >
          <Heart
            color={isFavorite ? COLORS.unavailable : COLORS.unknown}
            fill={isFavorite ? COLORS.unavailable : "transparent"}
            size={20}
          />
        </Pressable>
      </View>

      <View className="mt-3 flex-row items-center justify-between">
        <StatusBadge status={station.status} />

        <Text className="font-sans text-label text-muted">
          {station.last_reported_at ? timeAgo(station.last_reported_at) : "no reports"}
        </Text>
      </View>

      <Text className="mt-2 font-sans text-label text-muted" numberOfLines={1}>
        {confidenceLabel(station.confidence, station.report_count)}
      </Text>
    </Pressable>
  );
}
