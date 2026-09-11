import { Navigation, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { StatusBadge } from "@/components/station/StatusBadge";
import { COLORS } from "@/constants/colors";
import { timeAgo } from "@/lib/confidence";
import { formatDistance } from "@/lib/location";
import type { NearbyStation } from "@/types/database";

interface NearbyStationRowProps {
  station: NearbyStation;
  /** Highlights the row -- set when this station's pin was tapped on the map. */
  isSelected?: boolean;
  onPress: () => void;
  onNavigate: () => void;
  /** When provided, shows a dismiss button. Used for the pinned selected row. */
  onDismiss?: () => void;
}

/**
 * A compact station row for the map screen's nearby-stations sheet.
 *
 * Deliberately not a variant of `StationCard`: that component is shared by the
 * List, Favourites and Search screens with a favourite-toggle contract tied to
 * `useFavoriteStore`, and it stacks four rows of text. Widening it for this one
 * surface would risk three working screens, and its height would make ten of
 * them a long scroll. This row shows only what the sheet needs -- name, status,
 * distance, freshness -- plus a one-tap navigate action.
 */
export function NearbyStationRow({
  station,
  isSelected = false,
  onPress,
  onNavigate,
  onDismiss,
}: NearbyStationRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${station.name}, ${formatDistance(station.distance_m)} away`}
      onPress={onPress}
      className={`flex-row items-center rounded-2xl border bg-white px-4 py-3 active:opacity-70 ${
        isSelected ? "border-2 border-primary bg-primary/5" : "border-slate-100"
      }`}
    >
      <View className="flex-1 pr-3">
        <Text className="font-semibold text-body text-ink" numberOfLines={1}>
          {station.name}
        </Text>

        <View className="mt-1.5 flex-row items-center">
          <StatusBadge status={station.status} />
          <Text className="ml-2 font-sans text-label text-muted" numberOfLines={1}>
            {formatDistance(station.distance_m)}
            {station.last_reported_at ? ` · ${timeAgo(station.last_reported_at)}` : ""}
          </Text>
        </View>
      </View>

      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear selection"
          onPress={onDismiss}
          hitSlop={10}
          className="mr-1 h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          <X color={COLORS.muted} size={18} />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Get directions to ${station.name}`}
        onPress={onNavigate}
        hitSlop={10}
        className="h-11 w-11 items-center justify-center rounded-full bg-primary active:opacity-80"
      >
        <Navigation color="#FFFFFF" size={18} />
      </Pressable>
    </Pressable>
  );
}
