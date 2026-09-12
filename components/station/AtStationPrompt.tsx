import { ChevronRight, Radio } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { NearbyStation } from "@/types/database";

interface AtStationPromptProps {
  station: NearbyStation;
  onPress: () => void;
}

/**
 * "You are at X -- is there gas?"
 *
 * Shown only when the driver is inside the reporting radius, which is the
 * whole point. A report button on every station row would be a button that
 * fails for all but one of them: the database rejects any report from beyond
 * 300 m, so on a list sorted by distance at most the first row could ever
 * succeed. Asking once, at the station, catches people while they are filling
 * up and never teaches them that the prompt does not work.
 *
 * Deliberately promises points rather than the monthly prize. Points are paid
 * on every report; the prize goes to one driver a month, and putting it on a
 * banner most people see repeatedly would over-promise to nearly all of them.
 * No specific number either -- the real figure depends on whether the station
 * is stale and who reported first today, which only the server knows.
 */
export function AtStationPrompt({ station, onPress }: AtStationPromptProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Report the status of ${station.name}`}
      onPress={onPress}
      className="flex-row items-center rounded-2xl bg-primary px-4 py-3 active:opacity-80"
    >
      <Radio color="#FFFFFF" size={20} />

      <View className="ml-3 flex-1">
        <Text className="font-semibold text-caption text-white" numberOfLines={1}>
          You&apos;re at {station.name}
        </Text>
        <Text className="mt-0.5 font-sans text-label text-white/80">
          Is there gas right now? Report it and earn points.
        </Text>
      </View>

      <ChevronRight color="#FFFFFF" size={18} />
    </Pressable>
  );
}
