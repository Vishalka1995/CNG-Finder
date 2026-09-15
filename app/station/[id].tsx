import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  Clock,
  Heart,
  Navigation,
  Phone,
  Store,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking as RNLinking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReportTimeline } from "@/components/station/ReportTimeline";
import { StatusBadge } from "@/components/station/StatusBadge";
import { StatusPicker } from "@/components/station/StatusPicker";
import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";
import { REPORT_COOLDOWN_MIN, REPORT_PROXIMITY_M, isDemoMode } from "@/constants/config";
import { confidenceLabel, timeAgo } from "@/lib/confidence";
import {
  addDemoReport,
  getDemoReports,
  getDemoStationCoords,
  hasDemoReport,
} from "@/lib/demoData";
import { getDeviceId } from "@/lib/device";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import {
  distanceMeters,
  formatDistance,
  getCurrentCoords,
  openDirections as openStationDirections,
} from "@/lib/location";
import { getPointsForReport } from "@/lib/points";
import { SHOWCASE_REPORT_POINTS, showcaseReports } from "@/lib/showcase";
import { parseReportError, supabase, toPointWKT } from "@/lib/supabase";
import { useFavoriteStore } from "@/stores/favoriteStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useReportStore } from "@/stores/reportStore";
import { useStationStore } from "@/stores/stationStore";
import { showToast } from "@/stores/toastStore";
import type { StationReport, StationStatus } from "@/types/database";

/** Minutes before the same driver may report this station again. Mirrors the
 *  rate limit enforced by enforce_report_rules() in the database. */
const COOLDOWN_MS = REPORT_COOLDOWN_MIN * 60_000;

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
  const myReports = useReportStore((state) => state.reports);
  const loadMyReports = useReportStore((state) => state.load);

  const { ids: favoriteIds, load: loadFavorites, toggle } = useFavoriteStore();
  const isFavorite = id ? favoriteIds.includes(id) : false;

  useEffect(() => {
    void loadFavorites();
    void loadMyReports();
  }, [loadFavorites, loadMyReports]);

  const [reports, setReports] = useState<StationReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Set the moment a report succeeds, so the confirmation appears even where
   * nothing was written to the history -- showcase mode reports nowhere, and
   * should still demonstrate this state.
   */
  const [justReported, setJustReported] = useState<{
    status: StationStatus;
    at: string;
  } | null>(null);

  /** The clock, held in state so the cooldown countdown is derived from a
   *  stable value rather than read fresh on every render. */
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Shared by the mount effect and pull-to-refresh; never itself cancelled. */
  const loadReports = useCallback(
    async (
      stationId: string,
      isCancelled: () => boolean = () => false,
    ): Promise<void> => {
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

  /**
   * Sends the report. Only ever called from the undo timer (or from leaving
   * the screen), never straight from the tap -- see startReport.
   */
  const commitReport = async (selected: StationStatus): Promise<void> => {
    if (!id) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Showcase mode: accept it locally so a demo can be walked all the way
      // through. Nothing is sent -- a synthetic report in the real table would
      // tell actual drivers a pump has gas on the strength of a demo. The
      // optimistic update still runs, so the station visibly changes colour,
      // which is the part worth showing.
      if (usePreferencesStore.getState().showcaseMode) {
        applyOptimisticReport(id, selected);
        hapticSuccess();
        setJustReported({ status: selected, at: new Date().toISOString() });
        showToast(`Thanks! +${SHOWCASE_REPORT_POINTS} points earned.`);
        return;
      }

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

        addDemoReport(id, selected, null);
        applyOptimisticReport(id, selected);
        await recordReport({
          stationId: id,
          stationName: station?.name ?? "Unknown station",
          status: selected,
          note: null,
        });
        hapticSuccess();
        setJustReported({ status: selected, at: new Date().toISOString() });
        showToast("Thanks! Your report helps other drivers.");
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
          note: null,
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
        note: null,
      });
      hapticSuccess();
      setJustReported({ status: selected, at: new Date().toISOString() });

      // A repeat report inside the award cooldown scores zero. Say nothing
      // about points in that case rather than "+0" -- the cooldown is
      // deliberately not advertised, and the report was still worth making.
      const earned = await getPointsForReport(inserted.id);
      showToast(
        earned && earned > 0
          ? `Thanks! +${earned} points earned.`
          : "Thanks! Your report helps other drivers.",
      );
    } catch (err) {
      failWith(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * This driver's own last report for this station, if it is recent enough to
   * still be inside the cooldown.
   *
   * Read from the persisted history rather than component state so it survives
   * leaving the screen: coming back to a station you reported two minutes ago
   * should not offer buttons that the database is about to reject.
   */
  const recentReport = useMemo(() => {
    // myReports is newest-first, so the first hit is the latest report.
    const mine = id ? myReports.find((entry) => entry.stationId === id) : undefined;

    const candidate =
      justReported ?? (mine ? { status: mine.status, at: mine.createdAt } : null);

    if (!candidate) return null;

    return now - new Date(candidate.at).getTime() < COOLDOWN_MS ? candidate : null;
  }, [justReported, myReports, id, now]);

  /** Whole minutes until this station can be reported again. */
  const minutesLeft = recentReport
    ? Math.max(
        1,
        Math.ceil((COOLDOWN_MS - (now - new Date(recentReport.at).getTime())) / 60_000),
      )
    : 0;

  // Ticks only while a cooldown is actually running, so the confirmation
  // gives way to the buttons the moment reporting is allowed again rather
  // than waiting for the screen to be revisited.
  const recentAt = recentReport?.at ?? null;

  useEffect(() => {
    if (!recentAt) return undefined;

    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [recentAt]);

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

      {/* No keyboard avoidance: with the note field gone, nothing on this
          screen takes text input. */}
      <ScrollView
        contentContainerClassName="px-6 py-6"
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

        <View className="mt-4">
          {recentReport ? (
            // Replaces the picker rather than sitting above it. Leaving the
            // buttons up after a report gives no sense that anything happened,
            // and invites a second tap that the database would reject for the
            // next half hour anyway.
            <View className="rounded-2xl bg-primary/10 p-4">
              <View className="flex-row items-center">
                <Check color={COLORS.primary} size={18} strokeWidth={2.5} />
                <Text className="ml-2 flex-1 font-semibold text-caption text-ink">
                  Thanks — you reported this {timeAgo(recentReport.at)}
                </Text>
              </View>

              <View className="mt-3 flex-row items-center">
                <StatusBadge status={recentReport.status} />
                <Text className="ml-2 font-sans text-label text-muted">
                  is what you reported
                </Text>
              </View>

              <Text className="mt-3 font-sans text-label text-muted">
                You can report this station again in {minutesLeft}{" "}
                {minutesLeft === 1 ? "minute" : "minutes"}.
              </Text>
            </View>
          ) : (
            <StatusPicker
              onSelect={(status) => void commitReport(status)}
              disabled={submitting}
            />
          )}
        </View>

        {submitError ? (
          <View className="mt-4 rounded-xl bg-unavailable/15 px-4 py-3">
            <Text className="font-medium text-caption text-ink">{submitError}</Text>
          </View>
        ) : null}

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
