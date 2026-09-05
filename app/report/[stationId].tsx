import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusOptionCard } from "@/components/station/StatusOptionCard";
import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";
import { REPORT_PROXIMITY_M, isDemoMode } from "@/constants/config";
import { addDemoReport, getDemoStationCoords, hasDemoReport } from "@/lib/demoData";
import { getDeviceId } from "@/lib/device";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { distanceMeters, formatDistance, getCurrentCoords } from "@/lib/location";
import { parseReportError, supabase, toPointWKT } from "@/lib/supabase";
import { useReportStore } from "@/stores/reportStore";
import { useStationStore } from "@/stores/stationStore";
import { showToast } from "@/stores/toastStore";
import type { StationStatus } from "@/types/database";

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

export default function ReportScreen() {
  const { stationId } = useLocalSearchParams<{ stationId: string }>();
  const router = useRouter();

  const station = useStationStore((state) =>
    state.stations.find((entry) => entry.id === stationId),
  );
  const applyOptimisticReport = useStationStore((state) => state.applyOptimisticReport);
  const recordReport = useReportStore((state) => state.record);

  const [selected, setSelected] = useState<StationStatus | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Every rejection path routes through here, so the error haptic fires once,
   *  consistently, without threading it into each individual call site. */
  const failWith = (message: string): void => {
    hapticError();
    setError(message);
  };

  const submit = async (): Promise<void> => {
    if (!selected || !stationId) return;

    setSubmitting(true);
    setError(null);

    try {
      // Demo mode: mirror the real rules (including the rate limit) locally.
      if (isDemoMode()) {
        if (hasDemoReport(stationId)) {
          failWith(messageForError("RATE_LIMITED"));
          return;
        }

        const stationCoords = getDemoStationCoords(stationId);
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

        addDemoReport(stationId, selected, note.trim() || null);
        applyOptimisticReport(stationId, selected);
        await recordReport({
          stationId,
          stationName: station?.name ?? "Unknown station",
          status: selected,
          note: note.trim() || null,
        });
        hapticSuccess();
        showToast("Thanks! Your report helps other drivers.");
        router.back();
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

      const { error: insertError } = await supabase.from("reports").insert({
        station_id: stationId,
        status: selected,
        note: note.trim() || null,
        device_id: deviceId,
        reported_location: toPointWKT(fix.coords.longitude, fix.coords.latitude),
      });

      if (insertError) {
        failWith(messageForError(parseReportError(insertError.message)));
        return;
      }

      applyOptimisticReport(stationId, selected);
      await recordReport({
        stationId,
        stationName: station?.name ?? "Unknown station",
        status: selected,
        note: note.trim() || null,
      });
      hapticSuccess();
      showToast("Thanks! Your report helps other drivers.");
      router.back();
    } catch (err) {
      failWith(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center border-b border-slate-100 px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          <X color={COLORS.ink} size={22} />
        </Pressable>
        <Text className="ml-1 flex-1 font-semibold text-body text-ink">
          Report status
        </Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerClassName="px-6 py-6" keyboardShouldPersistTaps="handled">
          {station ? (
            <Text className="font-semibold text-heading text-ink">{station.name}</Text>
          ) : null}

          <Text className="mt-2 font-sans text-body text-muted">
            How is the CNG availability right now?
          </Text>

          <View className="mt-6 gap-3">
            {OPTIONS.map((option) => (
              <StatusOptionCard
                key={option.status}
                status={option.status}
                title={option.title}
                subtitle={option.subtitle}
                selected={selected === option.status}
                onPress={() => {
                  setSelected(option.status);
                  setError(null);
                }}
              />
            ))}
          </View>

          {/* Optional note */}
          <Text className="mt-8 font-semibold text-caption text-ink">
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

          {error ? (
            <View className="mt-4 rounded-xl bg-unavailable/15 px-4 py-3">
              <Text className="font-medium text-caption text-ink">{error}</Text>
            </View>
          ) : null}

          <View className="mt-6">
            <Button
              label="Submit report"
              onPress={submit}
              disabled={!selected}
              loading={submitting}
            />
          </View>

          <Text className="mt-4 text-center font-sans text-label text-muted">
            Your report helps other drivers avoid empty stations.
          </Text>

          <View className="h-8" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
