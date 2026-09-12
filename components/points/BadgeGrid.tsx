import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { BADGES, type BadgeDefinition } from "@/constants/badges";

interface BadgeGridProps {
  earnedIds: string[];
}

function Badge({
  badge,
  earned,
  onPress,
}: {
  badge: BadgeDefinition;
  earned: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${badge.name}. ${earned ? "Earned" : badge.description}`}
      onPress={onPress}
      className={`h-16 w-16 items-center justify-center rounded-2xl active:opacity-60 ${
        earned ? "bg-primary/10" : "bg-slate-100"
      }`}
    >
      {/* Locked badges keep their shape but lose their colour, so the grid
          reads as "things to earn" rather than a wall of question marks. */}
      <Text className={`text-2xl ${earned ? "" : "opacity-25"}`}>{badge.emoji}</Text>
    </Pressable>
  );
}

/**
 * Every badge in the catalogue, earned ones lit and the rest dimmed.
 *
 * Shows the locked ones on purpose: a badge you cannot see is not a goal. Tap
 * any of them for what it takes, since the artwork alone never explains that.
 */
export function BadgeGrid({ earnedIds }: BadgeGridProps) {
  const [selected, setSelected] = useState<BadgeDefinition | null>(null);
  const earnedCount = BADGES.filter((badge) => earnedIds.includes(badge.id)).length;

  return (
    <View className="mt-1 rounded-2xl bg-slate-50 p-4">
      <Text className="font-sans text-label text-muted">
        {earnedCount} of {BADGES.length} earned
      </Text>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {BADGES.map((badge) => (
          <Badge
            key={badge.id}
            badge={badge}
            earned={earnedIds.includes(badge.id)}
            onPress={() => setSelected(badge)}
          />
        ))}
      </View>

      {selected ? (
        <View className="mt-4 rounded-xl bg-white px-4 py-3">
          <Text className="font-semibold text-caption text-ink">
            {selected.emoji} {selected.name}
          </Text>
          <Text className="mt-1 font-sans text-label text-muted">
            {earnedIds.includes(selected.id)
              ? "Earned"
              : selected.earnable
                ? selected.description
                : `${selected.description} — not available yet`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
