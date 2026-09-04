import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Placeholder. Built out in Phase 3 (list view with filters). */
export default function ListScreen() {
  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="font-semibold text-heading text-ink">List view</Text>
        <Text className="mt-2 text-center font-sans text-caption text-muted">
          Coming in Phase 3.
        </Text>
      </View>
    </SafeAreaView>
  );
}
