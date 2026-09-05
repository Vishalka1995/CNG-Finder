import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { STATUS_COLORS } from "@/constants/colors";
import { hapticSelect } from "@/lib/haptics";
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
 * standing at a pump, often in a hurry and sometimes one-handed. The small
 * press-scale gives immediate feedback that the tap registered, before the
 * (potentially slower) network round trip on submit.
 */
export function StatusOptionCard({
  status,
  title,
  subtitle,
  selected,
  onPress,
}: StatusOptionCardProps) {
  const color = STATUS_COLORS[status];
  const scale = useSharedValue(1);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${title}. ${subtitle}`}
        onPressIn={() => {
          // Reanimated shared values are mutated via .value by design -- this
          // is the library's documented API, not a React state violation, but
          // the immutability lint rule does not yet know that exception.
          // eslint-disable-next-line react-hooks/immutability
          scale.value = withTiming(0.97, { duration: 80 });
        }}
        onPressOut={() => {
          // eslint-disable-next-line react-hooks/immutability
          scale.value = withTiming(1, { duration: 120 });
        }}
        onPress={() => {
          hapticSelect();
          onPress();
        }}
        className="min-h-[88px] flex-row items-center rounded-2xl border-2 px-4 py-4"
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
    </Animated.View>
  );
}
