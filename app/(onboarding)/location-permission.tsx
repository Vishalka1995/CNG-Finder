import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { MapPin } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";
import { STORAGE_KEYS } from "@/constants/config";
import { requestLocationPermission } from "@/lib/location";

/**
 * Screen 3 of 3.
 *
 * The permission prompt lives here, on the last screen, rather than at launch:
 * asking before the user understands the value gets it denied, and a denial is
 * far harder to recover from than a delayed ask.
 */
export default function LocationPermissionScreen() {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);

  const finish = async (): Promise<void> => {
    await AsyncStorage.setItem(STORAGE_KEYS.onboarded, "true").catch(() => undefined);
    router.replace("/(tabs)");
  };

  const handleAllow = async (): Promise<void> => {
    setRequesting(true);
    try {
      // A denial is not a dead end -- the map falls back to the city centre.
      await requestLocationPermission();
      await finish();
    } finally {
      setRequesting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 items-center justify-center px-6">
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
          <MapPin color={COLORS.primary} size={40} strokeWidth={1.8} />
        </View>

        <Text className="mt-8 text-center font-bold text-title text-ink">
          Find stations near you
        </Text>

        <Text className="mt-4 text-center font-sans text-body leading-6 text-muted">
          We need your location to show CNG stations near you. Your location is never
          shared with other users.
        </Text>
      </View>

      <View className="gap-4 px-6 pb-8">
        <Button label="Allow Location" onPress={handleAllow} loading={requesting} />

        <Pressable
          accessibilityRole="button"
          onPress={finish}
          className="items-center py-2 active:opacity-60"
        >
          <Text className="font-medium text-caption text-muted">Skip for now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
