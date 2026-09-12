import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Clock, Heart, Navigation, Phone, Store } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking as RNLinking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReportTimeline } from "@/components/station/ReportTimeline";
import { StatusBadge } from "@/components/station/StatusBadge";
import { StatusOptionCard } from "@/components/station/StatusOptionCard";
import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";
import { REPORT_PROXIMITY_M, isDemoMode } from "@/constants/config";
import { confidenceLabel, timeAgo } from "@/lib/confidence";
import { addDemoReport, getDemoReports, getDemoStationCoords, hasDemoReport } from "@/lib/demoData";
import { getDeviceId } from "@/lib/device";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import {
  distanceMeters,
  formatDistance,
  getCurrentCoords,
  openDirections as openStationDirections,
} from "@/lib/location";
import { getPointsForReport } from "@/lib/points";
import { showcaseReports } from "@/lib/showcase";
import { parseReportError, supabase, toPointWKT } from "@/lib/supabase";
import { useFavoriteStore } from "@/stores/favoriteStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useReportStore } from "@/stores/reportStore";
import { useStationStore } from "@/stores/stationStore";
import { showToast } from "@/stores/toastStore";
import type { StationReport, StationStatus } from "@/types/database";

const NOTE_MAX = 140;

const OPTIONS: { status: StationStatus; title: string; subtitle: string }[] = [
  {
    status: "available",
    title: "Available",
    subtitle: "Gas is flowing, no long wait",
  },
  {
    status: "long_queue",
    title: "Long queue",
    subtitle: "Gas available but 20+ min wait",
  },
  {
    status: "not_available",
    title: "Not available",
    subtitle: "No gas, or the pump is shut",
  },
];

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

/** Turns a trigger error code into copy a driver can act on. */
function messageForError(code: ReturnType<typeof parseReportError>): string {
  switch (code) {
    case "RATE_LIMITED":
      return "You already reported this station recently. Try again in a little while.";
    case "TOO_FAR":
      return "You need to be at the station to report it.";
    case "LOCATION_REQUIRED":
      return "We could not get your location. Turn on location and try again.";
    case "AUTH_REQUIRED":
      return "Could not verify your device. Check your connection and try again.";
    case "STATION_NOT_FOUND":
      return "This station is no longer listed.";
    default:
      return "Could not send your report. Please try again.";
  }
}

export default function StationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const station = useStationStore((state) =>
    state.stations.find((entry) => entry.id === id),
  );
  const applyOptimisticReport = useStationStore((state) => state.applyOptimisticReport);
  const recordReport = useReportStore((state) => state.record);

  const { ids: favoriteIds, load: loadFavorites, toggle } = useFavoriteStore();
  const isFavorite = id ? favoriteIds.includes(id) : false;

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const [reports, setReports] = useState<StationReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<StationStatus | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Shared by the mount effect and pull-to-refresh; never itself cancelled. */
  const loadReports = useCallback(
    async (stationId: string, isCancelled: () => boolean = () => false): Promise<void> => {
      if (usePreferencesStore.getState().showcaseMode) {
        if (!isCancelled()) {
          setReports(showcaseReports(stationId));
          setReportsError(null);
          setLoadingReports(false);
        }
        return;
      }

      if (isDemoMode()) {
        if (!isCancelled()) {
          setReports(getDemoReports(stationId).slice(0, 5));
          setReportsError(null);
          setLoadingReports(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase.rpc("station_reports", {
          station: stationId,
          max_results: 5,
        });
        if (error) throw new Error(error.message);
        if (!isCancelled()) {
          setReports(data ?? []);
          setReportsError(null);
        }
      } catch (err) {
        if (!isCancelled()) {
          setReportsError(err instanceof Error ? err.message : "Could not load reports");
        }
      } finally {
        if (!isCancelled()) setLoadingReports(false);
      }
    },
    [],
  );

  // Refetches whenever the station id changes, and after a new report lands
  // (last_reported_at moves), so the timeline stays in step with the status.
  const lastReportedAt = station?.last_reported_at ?? null;

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    // Deferred a tick so the fetch (and its eventual setState calls) runs
    // after this render commits, rather than synchronously inside the effect.
    const handle = setTimeout(() => {
      void loadReports(id, () => cancelled);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [id, lastReportedAt, loadReports]);

  const refresh = async (): Promise<void> => {
    if (!id) return;
    setRefreshing(true);
    try {
      await loadReports(id);
    } finally {
      setRefreshing(false);
    }
  };

  const openDirections = (): void => {
    if (station) openStationDirections(station);
  };

  const callStation = (): void => {
    if (station?.phone) void RNLinking.openURL(`tel:${station.phone}`);
  };

  /** Every rejection path routes through here, so the error haptic fires once,
   *  consistently, without threading it into each individual call site. */
  const failWith = (message: string): void => {
    hapticError();
    setSubmitError(message);
  };

  const submit = async (): Promise<void> => {
    if (!selected || !id) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Demo mode: mirror the real rules (including the rate limit) locally.
      if (isDemoMode()) {
        if (hasDemoReport(id)) {
          failWith(messageForError("RATE_LIMITED"));
          return;
        }

        const stationCoords = getDemoStationCoords(id);
        const fix = await getCurrentCoords();

        // Only enforce proximity when there is a genuine fix; with the fallback
        // there is nothing meaningful to compare against.
        if (stationCoords && !fix.isFallback) {
          const away = distanceMeters(fix.coords, stationCoords);
          if (away > REPORT_PROXIMITY_M) {
            failWith(
              `You are ${formatDistance(away)} from this station. Get within ${REPORT_PROXIMITY_M} m to report.`,
            );
            return;
          }
        }

        addDemoReport(id, selected, note.trim() || null);
        applyOptimisticReport(id, selected);
        await recordReport({
          stationId: id,
          stationName: station?.name ?? "Unknown station",
          status: selected,
          note: note.trim() || null,
        });
        hapticSuccess();
        showToast("Thanks! Your report helps other drivers.");
        setSelected(null);
        setNote("");
        return;
      }

      // Real submission. The DB trigger is the authority on both the rate limit
      // and proximity; the check here only saves a pointless round trip.
      const fix = await getCurrentCoords();

      if (fix.isFallback) {
        failWith(messageForError("LOCATION_REQUIRED"));
        return;
      }

      if (station) {
        const away = distanceMeters(fix.coords, {
          latitude: station.latitude,
          longitude: station.longitude,
        });
        if (away > REPORT_PROXIMITY_M) {
          failWith(
            `You are ${formatDistance(away)} from this station. Get within ${REPORT_PROXIMITY_M} m to report.`,
          );
          return;
        }
      }

      const deviceId = await getDeviceId();

      // Selects the new row back so its id can be used to look up what the
      // award trigger scored it -- see the toast below.
      const { data: inserted, error: insertError } = await supabase
        .from("reports")
        .insert({
          station_id: id,
          status: selected,
          note: note.trim() || null,
          device_id: deviceId,
          reported_location: toPointWKT(fix.coords.longitude, fix.coords.latitude),
        })
        .select("id")
        .single();

      if (insertError) {
        failWith(messageForError(parseReportError(insertError.message)));
        return;
      }

      applyOptimisticReport(id, selected);
      await recordReport({
        stationId: id,
        stationName: station?.name ?? "Unknown station",
        status: selected,
        note: note.trim() || null,
      });
      hapticSuccess();

      // A repeat report inside the award cooldown scores zero. Say nothing
      // about points in that case rather than "+0" -- the cooldown is
      // deliberately not advertised, and the report was still worth making.
      const earned = await getPointsForReport(inserted.id);
      showToast(
        earned && earned > 0
          ? `Thanks! +${earned} points earned.`
          : "Thanks! Your report helps other drivers.",
      );

      setSelected(null);
      setNote("");
    } catch (err) {
      failWith(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
          onPress={() => void toggle(station.id)}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          <Heart
            color={isFavorite ? COLORS.unavailable : COLORS.muted}
            fill={isFavorite ? COLORS.unavailable : "transparent"}
            size={22}
          />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="px-6 py-6"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={COLORS.primary}
            />
          }
        >
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

          {/* Get directions */}
          <View className="mt-6">
            <Pressable
              accessibilityRole="button"
              onPress={openDirections}
              className="min-h-[52px] flex-row items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 active:opacity-70"
            >
              <Navigation color={COLORS.ink} size={18} />
              <Text className="ml-2 font-semibold text-body text-ink">Get directions</Text>
            </Pressable>
          </View>

          {/* Report status -- always visible, no separate screen */}
          <Text className="mt-8 font-semibold text-heading text-ink">Report status</Text>
          <Text className="mt-1 font-sans text-body text-muted">
            How is the CNG availability right now?
          </Text>

          <View className="mt-4 gap-3">
            {OPTIONS.map((option) => (
              <StatusOptionCard
                key={option.status}
                status={option.status}
                title={option.title}
                subtitle={option.subtitle}
                selected={selected === option.status}
                onPress={() => {
                  setSelected(option.status);
                  setSubmitError(null);
                }}
              />
            ))}
          </View>

          <Text className="mt-6 font-semibold text-caption text-ink">
            Add a note (optional)
          </Text>

          <TextInput
            value={note}
            onChangeText={(text) => setNote(text.slice(0, NOTE_MAX))}
            placeholder="Anything else drivers should know?"
            placeholderTextColor={COLORS.unknown}
            multiline
            maxLength={NOTE_MAX}
            className="mt-2 min-h-[80px] rounded-2xl border border-slate-300 bg-white px-4 py-3 font-sans text-caption text-ink"
            textAlignVertical="top"
          />

          <Text className="mt-1 text-right font-sans text-label text-muted">
            {note.length}/{NOTE_MAX}
          </Text>

          {submitError ? (
            <View className="mt-4 rounded-xl bg-unavailable/15 px-4 py-3">
              <Text className="font-medium text-caption text-ink">{submitError}</Text>
            </View>
          ) : null}

          <View className="mt-4">
            <Button
              label="Submit report"
              onPress={submit}
              disabled={!selected}
              loading={submitting}
            />
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
