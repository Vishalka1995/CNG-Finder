import { Heart } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";

/** Placeholder. Built out in Phase 3. */
export default function FavoritesScreen() {
  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 items-center justify-center px-6">
        <Heart color={COLORS.unknown} size={40} strokeWidth={1.5} />
        <Text className="mt-4 font-semibold text-heading text-ink">No favorites yet</Text>
        <Text className="mt-2 text-center font-sans text-caption text-muted">
          Save your regular stations to see live status at a glance.
        </Text>
      </View>
    </SafeAreaView>
  );
}
