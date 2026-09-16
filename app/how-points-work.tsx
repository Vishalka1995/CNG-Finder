import { Stack, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";
import { REPORT_PROXIMITY_M } from "@/constants/config";

/**
 * What earns points, in the driver's words.
 *
 * Every figure here mirrors award_report_points() in migration 0008. If the
 * scoring changes there, it has to change here -- an explanation that quietly
 * stops matching the awards is worse than none.
 *
 * The city multiplier is explained rather than hidden. The original spec kept
 * it invisible, but a Kolhapur driver earning 41 points from a "5 + 10 + 12"
 * breakdown can see the arithmetic does not add up, and unexplained numbers
 * read as broken. Said plainly it reads as what it is: a fairness rule.
 */

interface EarnRow {
  points: string;
  title: string;
  detail: string;
}

const EARNING: EarnRow[] = [
  {
    points: "+5",
    title: "Every report",
    detail: "Just for telling other drivers what you found.",
  },
  {
    points: "+10",
    title: "First report of the day",
    detail: "Nobody else has checked this station today.",
  },
  {
    points: "+8",
    title: "Rush hour",
    detail: "Reported between 6–10am or 5–8pm, when it helps most.",
  },
  {
    points: "+12",
    title: "Nobody has checked lately",
    detail: "The station has had no report for two hours or more.",
  },
];

function Rule({ title, detail }: { title: string; detail: string }) {
  return (
    <View className="mt-4">
      <Text className="font-semibold text-caption text-ink">{title}</Text>
      <Text className="mt-1 font-sans text-label leading-5 text-muted">{detail}</Text>
    </View>
  );
}

export default function HowPointsWorkScreen() {
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
        <Text className="ml-1 flex-1 font-semibold text-body text-ink">
          How points work
        </Text>
      </View>

      <ScrollView contentContainerClassName="px-6 py-6">
        <Text className="font-sans text-body leading-6 text-muted">
          You earn points by telling other drivers whether a station has gas. The harder a
          report is to come by, the more it is worth.
        </Text>

        <Text className="mt-8 font-semibold text-caption text-muted">WHAT YOU EARN</Text>

        <View className="mt-1 gap-2">
          {EARNING.map((row) => (
            <View
              key={row.title}
              className="flex-row items-start rounded-2xl bg-slate-50 p-4"
            >
              <Text className="w-12 font-bold text-body text-primary">{row.points}</Text>
              <View className="flex-1">
                <Text className="font-semibold text-caption text-ink">{row.title}</Text>
                <Text className="mt-0.5 font-sans text-label leading-5 text-muted">
                  {row.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Text className="mt-4 font-sans text-label leading-5 text-muted">
          These add up. A first report of the day at a station nobody has checked, during
          rush hour, earns all four.
        </Text>

        <Text className="mt-8 font-semibold text-caption text-muted">THE RULES</Text>

        <View className="mt-1 rounded-2xl bg-slate-50 px-4 pb-4">
          <Rule
            title={`You have to be at the station`}
            detail={`Reports are only accepted within ${REPORT_PROXIMITY_M} metres, so nobody can report a pump they have not seen.`}
          />
          <Rule
            title="Smaller cities are worth more"
            detail="Kolhapur has far fewer stations than Bengaluru, so points there are scaled up. A driver in a small city can win without driving further."
          />
          <Rule
            title="Repeat reports do not keep paying"
            detail="You earn points from a station once every couple of hours. Reporting again sooner still helps other drivers, it just does not add points."
          />
          <Rule
            title="The month resets, your total does not"
            detail="Monthly points start again at zero on the 1st, so a new driver can win. Your lifetime total and badges are yours forever."
          />
        </View>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
