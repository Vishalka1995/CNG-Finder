import { Check, Clock, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { STATUS_COLORS } from "@/constants/colors";
import type { StationStatus } from "@/types/database";

interface StatusPickerProps {
  onSelect: (status: StationStatus) => void;
  disabled?: boolean;
}

const OPTIONS: {
  status: StationStatus;
  label: string;
  Icon: typeof Check;
}[] = [
  { status: "available", label: "Available", Icon: Check },
  { status: "long_queue", label: "Queue", Icon: Clock },
  { status: "not_available", label: "No gas", Icon: X },
];

/**
 * The whole report, in one tap.
 *
 * Three cards stacked with a note field and a submit button was four
 * interactions and most of a screen, for something done standing at a pump
 * with the engine running. One row of three, a tap each, is the shape the job
 * actually has.
 *
 * Labels are shortened to fit a third of the width: "No gas" rather than "Not
 * available", which is also closer to what a driver would say.
 */
export function StatusPicker({ onSelect, disabled = false }: StatusPickerProps) {
  return (
    <View className="flex-row gap-2">
      {OPTIONS.map(({ status, label, Icon }) => {
        const color = STATUS_COLORS[status];

        return (
          <Pressable
            key={status}
            accessibilityRole="button"
            accessibilityLabel={`Report ${label}`}
            disabled={disabled}
            onPress={() => onSelect(status)}
            style={{ borderColor: color, backgroundColor: `${color}14` }}
            className={`flex-1 items-center rounded-2xl border-2 py-3 active:opacity-60 ${
              disabled ? "opacity-40" : ""
            }`}
          >
            <Icon color={color} size={22} strokeWidth={2.5} />
            <Text
              style={{ color }}
              className="mt-1 font-semibold text-label"
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
