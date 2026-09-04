import { Pressable, Text, View } from "react-native";

import { STATUS_COLORS } from "@/constants/colors";
import type { StationStatus } from "@/types/database";

interface StatusOptionCardProps {
  status: StationStatus;
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * One of the three big choices on the report screen.
 *
 * The shared `Button` cannot express this (no per-status colour, no subtitle,
 * no selected state), and these are deliberately large: the person tapping is
 * standing at a pump, often in a hurry and sometimes one-handed.
 */
export function StatusOptionCard({
  status,
  title,
  subtitle,
  selected,
  onPress,
}: StatusOptionCardProps) {
  const color = STATUS_COLORS[status];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      className="min-h-[88px] flex-row items-center rounded-2xl border-2 px-4 py-4 active:opacity-70"
      style={{
        borderColor: selected ? color : "#E2E8F0",
        backgroundColor: selected ? `${color}14` : "#FFFFFF",
      }}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}26` }}
      >
        <View className="h-6 w-6 rounded-full" style={{ backgroundColor: color }} />
      </View>

      <View className="ml-4 flex-1">
        <Text className="font-semibold text-body text-ink">{title}</Text>
        <Text className="mt-1 font-sans text-caption text-muted">{subtitle}</Text>
      </View>

      {selected ? (
        <View
          className="h-6 w-6 items-center justify-center rounded-full"
          style={{ backgroundColor: color }}
        >
          <Text className="font-bold text-label text-white">✓</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
