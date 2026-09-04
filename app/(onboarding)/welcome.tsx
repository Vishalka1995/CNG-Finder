import { useRouter } from "expo-router";
import { Fuel } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";

/**
 * Screen 1 of 3.
 *
 * This is also the NativeWind smoke test: a green `bg-primary` background, Inter
 * type, and the custom spacing scale all render here. If this screen looks
 * right, the styling toolchain is wired correctly end to end.
 */
export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-primary">
      <View className="flex-1 items-center justify-center px-6">
        <View className="h-24 w-24 items-center justify-center rounded-3xl bg-white/20">
          <Fuel color="#FFFFFF" size={48} strokeWidth={1.8} />
        </View>

        <Text className="mt-8 text-center font-bold text-hero text-white">CNG Now</Text>

        <Text className="mt-4 text-center font-sans text-heading leading-7 text-white/90">
          Never wait at empty CNG stations again
        </Text>
      </View>

      <View className="px-6 pb-8">
        <Button
          label="Get Started"
          variant="secondary"
          onPress={() => router.push("/(onboarding)/how-it-works")}
        />
      </View>
    </SafeAreaView>
  );
}
