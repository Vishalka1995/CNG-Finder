import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ArrowLeft, Clock, Navigation, Phone, Store } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking as RNLinking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReportTimeline } from "@/components/station/ReportTimeline";
import { StatusBadge } from "@/components/station/StatusBadge";
import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";
import { isDemoMode } from "@/constants/config";
import { confidenceLabel, timeAgo } from "@/lib/confidence";
import { getDemoReports } from "@/lib/demoData";
import { formatDistance } from "@/lib/location";
import { supabase } from "@/lib/supabase";
import { useStationStore } from "@/stores/stationStore";
import type { StationReport } from "@/types/database";

/** Formats "06:00:00" as "6:00 am"; returns null for missing times. */
function formatTime(value: string | null): string | null {
  if (!value) return null;
  const [hourPart, minutePart] = value.split(":");
  const hour = Number(hourPart);
  if (!Number.isFinite(hour)) return null;

  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minutePart ?? "00"} ${suffix}`;
}

export default function StationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const station = useStationStore((state) =>
    state.stations.find((entry) => entry.id === id),
  );

  const [reports, setReports] = useState<StationReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);

  // Refetches whenever the station id changes, and after a new report lands
  // (last_reported_at moves), so the timeline stays in step with the status.
  const lastReportedAt = station?.last_reported_at ?? null;

  useEffect(() => {
    if (!id) return undefined;

    let cancelled = false;

    const load = async (): Promise<void> => {
      if (isDemoMode()) {
        if (!cancelled) {
          setReports(getDemoReports(id).slice(0, 5));
          setReportsError(null);
          setLoadingReports(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase.rpc("station_reports", {
          station: id,
          max_results: 5,
        });
        if (error) throw new Error(error.message);
        if (!cancelled) {
          setReports(data ?? []);
          setReportsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setReportsError(
            err instanceof Error ? err.message : "Could not load reports",
          );
        }
      } finally {
        if (!cancelled) setLoadingReports(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, lastReportedAt]);

  const openDirections = (): void => {
    if (!station) return;
    const label = encodeURIComponent(station.name);
    const url = `https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}&destination_place_id=${label}`;
    void Linking.openURL(url);
  };

  const callStation = (): void => {
    if (station?.phone) void RNLinking.openURL(`tel:${station.phone}`);
  };

  // Station not in the store -- usually a deep link or a reload on this screen.
  if (!station) {
    return (
      <SafeAreaView className="flex-1 bg-surface">
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-semibold text-heading text-ink">Station not found</Text>
          <Text className="mt-2 text-center font-sans text-caption text-muted">
            Go back to the map and pick a station again.
          </Text>
          <View className="mt-6 w-full">
            <Button label="Back to map" onPress={() => router.replace("/(tabs)")} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const opens = formatTime(station.opening_time);
  const closes = formatTime(station.closing_time);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
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
          Station details
        </Text>
      </View>

      <ScrollView contentContainerClassName="px-6 py-6">
        <Text className="font-bold text-title text-ink">{station.name}</Text>

        {station.address ? (
          <Text className="mt-1 font-sans text-caption text-muted">
            {station.address}
          </Text>
        ) : null}

        <Text className="mt-2 font-medium text-caption text-primary">
          {formatDistance(station.distance_m)} away
        </Text>

        {/* Live status */}
        <View className="mt-6 rounded-2xl bg-slate-50 p-4">
          <StatusBadge status={station.status} size="lg" />

          <Text className="mt-3 font-sans text-caption text-muted">
            {confidenceLabel(station.confidence, station.report_count)}
          </Text>

          {station.last_reported_at ? (
            <Text className="mt-1 font-sans text-label text-muted">
              Last reported {timeAgo(station.last_reported_at)}
            </Text>
          ) : null}
        </View>

        {/* Actions */}
        <View className="mt-6 gap-3">
          <Button
            label="Report status"
            onPress={() =>
              router.push({
                pathname: "/report/[stationId]",
                params: { stationId: station.id },
              })
            }
          />

          <Pressable
            accessibilityRole="button"
            onPress={openDirections}
            className="min-h-[52px] flex-row items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 active:opacity-70"
          >
            <Navigation color={COLORS.ink} size={18} />
            <Text className="ml-2 font-semibold text-body text-ink">Get directions</Text>
          </Pressable>
        </View>

        {/* Station info */}
        <Text className="mt-8 font-semibold text-heading text-ink">Information</Text>

        <View className="mt-3 gap-3">
          {station.operator ? (
            <View className="flex-row items-center">
              <Store color={COLORS.muted} size={18} />
              <Text className="ml-3 font-sans text-caption text-ink">
                {station.operator}
              </Text>
            </View>
          ) : null}

          <View className="flex-row items-center">
            <Clock color={COLORS.muted} size={18} />
            <Text className="ml-3 font-sans text-caption text-ink">
              {station.is_24x7
                ? "Open 24 hours"
                : opens && closes
                  ? `${opens} to ${closes}`
                  : "Hours not known"}
            </Text>
          </View>

          {station.phone ? (
            <Pressable
              accessibilityRole="button"
              onPress={callStation}
              className="flex-row items-center active:opacity-60"
            >
              <Phone color={COLORS.muted} size={18} />
              <Text className="ml-3 font-medium text-caption text-primary">
                {station.phone}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Recent reports */}
        <Text className="mt-8 font-semibold text-heading text-ink">Recent reports</Text>

        <View className="mt-3">
          {reportsError ? (
            <View className="rounded-xl bg-unavailable/15 px-4 py-3">
              <Text className="font-medium text-label text-ink">{reportsError}</Text>
            </View>
          ) : (
            <ReportTimeline reports={reports} isLoading={loadingReports} />
          )}
        </View>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
