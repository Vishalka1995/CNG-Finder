import { Flame } from "lucide-react-native";
import { ActivityIndicator, Text, View } from "react-native";

import { COLORS } from "@/constants/colors";
import type { UserPointsRow } from "@/types/database";

interface PointsCardProps {
  points: UserPointsRow | null;
  isLoading: boolean;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="font-bold text-title text-ink">{value}</Text>
      <Text className="mt-0.5 font-sans text-label text-muted">{label}</Text>
    </View>
  );
}

/**
 * The driver's own scoring summary.
 *
 * Shows this month separately from all time because only the monthly figure
 * competes for anything -- the lifetime total is there so a month that starts
 * at zero does not read as losing everything earned so far.
 */
export function PointsCard({ points, isLoading }: PointsCardProps) {
  if (isLoading) {
    return (
      <View className="mt-1 items-center rounded-2xl bg-slate-50 py-8">
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  // Null covers both "never reported" and "could not reach the server". Both
  // are better served by the invitation than by a wall of zeroes.
  if (!points || points.total_reports === 0) {
    return (
      <View className="mt-1 rounded-2xl bg-slate-50 p-4">
        <Text className="font-semibold text-body text-ink">No points yet</Text>
        <Text className="mt-1 font-sans text-label leading-5 text-muted">
          Report a station&apos;s availability while you are there and you will start
          earning points. Reporting somewhere no one has checked in a while is worth
          the most.
        </Text>
      </View>
    );
  }

  return (
    <View className="mt-1 gap-3">
      <View className="rounded-2xl bg-primary/10 p-4">
        <Text className="font-semibold text-label text-primary">THIS MONTH</Text>

        <View className="mt-2 flex-row">
          <Stat label="Points" value={String(points.monthly_points)} />
          <Stat label="Reports" value={String(points.monthly_reports)} />
        </View>
      </View>

      <View className="rounded-2xl bg-slate-50 p-4">
        <Text className="font-semibold text-label text-muted">ALL TIME</Text>

        <View className="mt-2 flex-row">
          <Stat label="Points" value={String(points.total_points)} />
          <Stat label="Reports" value={String(points.total_reports)} />
        </View>
      </View>

      {points.current_streak > 0 ? (
        <View className="flex-row items-center rounded-2xl bg-queue/15 px-4 py-3">
          <Flame color={COLORS.queue} size={18} />
          <Text className="ml-3 flex-1 font-medium text-caption text-ink">
            {points.current_streak}-day streak
          </Text>
          {points.longest_streak > points.current_streak ? (
            <Text className="font-sans text-label text-muted">
              best {points.longest_streak}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
