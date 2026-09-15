// Must be imported in the ROOT layout, and first. Importing global.css from a
// nested layout is the single most common reason NativeWind silently does
// nothing.
import "@/global.css";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { StatusBar } from "expo-status-bar";

import { Toast } from "@/components/ui/Toast";
import { ensureSession } from "@/lib/device";
import { useOnboardingStore } from "@/stores/onboardingStore";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [bootstrapped, setBootstrapped] = useState(false);
  const hasOnboarded = useOnboardingStore((state) => state.hasOnboarded);
  const loadOnboarding = useOnboardingStore((state) => state.load);

  const router = useRouter();
  const segments = useSegments();

  // Cold-start work: anonymous session + onboarding flag. Deliberately does not
  // block on the session succeeding -- a Supabase outage should still let the
  // user see cached stations.
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      const [, session] = await Promise.all([loadOnboarding(), ensureSession()]);

      if (!session.ok) {
        console.warn("[bootstrap] anonymous session unavailable:", session.error);
      }

      if (!cancelled) setBootstrapped(true);
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadOnboarding]);

  const ready = bootstrapped && (fontsLoaded || fontError !== null);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Route to onboarding or the tabs once we know which the user needs.
  useEffect(() => {
    if (!ready) return;

    const inOnboarding = segments[0] === "(onboarding)";

    if (!hasOnboarded && !inOnboarding) {
      router.replace("/(onboarding)/welcome");
    } else if (hasOnboarded && inOnboarding) {
      router.replace("/(tabs)");
    }
  }, [ready, hasOnboarded, segments, router]);

  if (!ready) return null;

  return (
    // GestureHandlerRootView must wrap everything, or the bottom sheet is
    // silently non-draggable.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="station/[id]" />
          <Stack.Screen name="search" />
          <Stack.Screen name="my-reports" />
          <Stack.Screen name="hall-of-fame" />
          <Stack.Screen name="add-station" options={{ presentation: "modal" }} />
        </Stack>
        <Toast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
