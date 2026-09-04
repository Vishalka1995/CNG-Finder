import { Text, View } from "react-native";

import { colorForStatus, statusLabel } from "@/lib/confidence";
import type { StationStatus } from "@/types/database";

interface StatusBadgeProps {
  status: StationStatus | null;
  size?: "sm" | "lg";
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const color = colorForStatus(status);
  const isLarge = size === "lg";

  return (
    <View
      className={`flex-row items-center self-start rounded-full ${
        isLarge ? "px-4 py-2" : "px-3 py-1"
      }`}
      style={{ backgroundColor: `${color}1A` }}
    >
      <View
        className={`mr-2 rounded-full ${isLarge ? "h-3 w-3" : "h-2 w-2"}`}
        style={{ backgroundColor: color }}
      />
      <Text
        className={`font-semibold ${isLarge ? "text-body" : "text-label"}`}
        style={{ color }}
      >
        {statusLabel(status)}
      </Text>
    </View>
  );
}
