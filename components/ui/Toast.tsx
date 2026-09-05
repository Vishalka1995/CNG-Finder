import { CheckCircle2, XCircle } from "lucide-react-native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";
import { useToastStore } from "@/stores/toastStore";

const VISIBLE_MS = 2600;

/**
 * A single toast, mounted once in the root layout. Slides down from the top
 * on `showToast()` and dismisses itself after a fixed delay -- there is
 * deliberately no manual dismiss control, since a report confirmation is
 * informational, not something the user needs to act on.
 */
export function Toast() {
  const { message, tone, key } = useToastStore();
  const insets = useSafeAreaInsets();

  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!message) return undefined;

    translateY.value = withSpring(0, { damping: 16, stiffness: 180 });
    opacity.value = withTiming(1, { duration: 180 });

    const hideTimer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(-100, { duration: 220 });
    }, VISIBLE_MS);

    return () => clearTimeout(hideTimer);
    // `key` (not `message`) is the restart signal, so showing the same message
    // twice in a row still re-plays the animation and resets the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!message) return null;

  const isSuccess = tone === "success";
  const Icon = isSuccess ? CheckCircle2 : XCircle;
  const color = isSuccess ? COLORS.available : COLORS.unavailable;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", left: 16, right: 16, top: insets.top + 8, zIndex: 50 },
        style,
      ]}
    >
      <View className="flex-row items-center rounded-2xl bg-white p-4 shadow-lg">
        <Icon color={color} size={22} />
        <Text className="ml-3 flex-1 font-medium text-body text-ink">{message}</Text>
      </View>
    </Animated.View>
  );
}
