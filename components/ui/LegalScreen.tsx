import { Stack, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";

export interface LegalSection {
  heading: string;
  /** One paragraph per entry. Bullet-style lines may start with "— ". */
  body: string[];
}

interface LegalScreenProps {
  title: string;
  /** Shown under the intro so a reader can tell whether it has changed. */
  updated: string;
  intro: string;
  sections: LegalSection[];
}

/**
 * Shared layout for the policy documents.
 *
 * Both of these are a title, a date, an intro and a list of headed sections,
 * and the only thing that differs is the words. Keeping the chrome in one
 * place means a reading-comfort change (line height, spacing) lands on both.
 */
export function LegalScreen({ title, updated, intro, sections }: LegalScreenProps) {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center border-b border-slate-100 px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          <ArrowLeft color={COLORS.ink} size={22} />
        </Pressable>
        <Text className="ml-1 flex-1 font-semibold text-body text-ink" numberOfLines={1}>
          {title}
        </Text>
      </View>

      <ScrollView contentContainerClassName="px-6 py-6">
        <Text className="font-sans text-body leading-6 text-ink">{intro}</Text>

        <Text className="mt-3 font-sans text-label text-muted">
          Last updated {updated}
        </Text>

        {sections.map((section) => (
          <View key={section.heading} className="mt-8">
            <Text className="font-semibold text-caption text-ink">{section.heading}</Text>

            {section.body.map((paragraph) => (
              <Text
                key={paragraph}
                className="mt-2 font-sans text-label leading-5 text-muted"
              >
                {paragraph}
              </Text>
            ))}
          </View>
        ))}

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
