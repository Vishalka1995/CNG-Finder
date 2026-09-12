import { X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { COLORS } from "@/constants/colors";

interface ReportingTipProps {
  onDismiss: () => void;
}

/**
 * Explains that reporting exists, once.
 *
 * The contextual prompt only appears when a driver happens to be standing at a
 * station, which could be days after they install the app. Until then nothing
 * on screen says the reporting half exists at all. This fills that gap without
 * nagging: it is dismissible, and the dismissal sticks.
 */
export function ReportingTip({ onDismiss }: ReportingTipProps) {
  return (
    <View className="flex-row items-start rounded-2xl bg-slate-100 px-4 py-3">
      <View className="flex-1 pr-2">
        <Text className="font-semibold text-caption text-ink">
          Green means someone checked
        </Text>
        <Text className="mt-1 font-sans text-label leading-5 text-muted">
          Station status comes from drivers like you. Next time you fill up, report
          what you found — it takes a tap, and you earn points for it.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        hitSlop={10}
        className="h-6 w-6 items-center justify-center rounded-full active:opacity-60"
      >
        <X color={COLORS.muted} size={16} />
      </Pressable>
    </View>
  );
}
