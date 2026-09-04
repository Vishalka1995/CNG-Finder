import { useRouter } from "expo-router";
import { MapPin, RadioTower, Search } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";

const STEPS = [
  { Icon: Search, title: "Find", body: "Find nearby CNG stations" },
  { Icon: MapPin, title: "Check", body: "Check if they have gas now" },
  { Icon: RadioTower, title: "Report", body: "Report status after you visit" },
] as const;

/** Screen 2 of 3: explains the value before we ask for anything. */
export default function HowItWorksScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 justify-center px-6">
        <Text className="text-center font-bold text-title text-ink">How it works</Text>

        <View className="mt-12 gap-8">
          {STEPS.map(({ Icon, title, body }) => (
            <View key={title} className="flex-row items-center gap-4">
              <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Icon color={COLORS.primary} size={26} strokeWidth={1.8} />
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-heading text-ink">{title}</Text>
                <Text className="mt-1 font-sans text-caption text-muted">{body}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View className="px-6 pb-8">
        <Button
          label="Next"
          onPress={() => router.push("/(onboarding)/location-permission")}
        />
      </View>
    </SafeAreaView>
  );
}
