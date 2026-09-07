import { Stack, useRouter } from "expo-router";
import { MapPin, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";
import { isDemoMode } from "@/constants/config";
import { getDeviceId } from "@/lib/device";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { getCurrentCoords, type Coords } from "@/lib/location";
import {
  existingStationName,
  parseSubmissionError,
  supabase,
  toPointWKT,
} from "@/lib/supabase";
import { showToast } from "@/stores/toastStore";

const NAME_MAX = 120;
const OPERATOR_MAX = 60;
const ADDRESS_MAX = 240;

/** Turns a trigger error code into copy a driver can act on. */
function messageForError(
  code: ReturnType<typeof parseSubmissionError>,
  raw: string | undefined,
): string {
  switch (code) {
    case "ALREADY_EXISTS": {
      const name = existingStationName(raw);
      return name
        ? `“${name}” is already on the map here. Pull down on the map to refresh.`
        : "There is already a station listed at this spot.";
    }
    case "ALREADY_SUBMITTED":
      return "Someone has already submitted this station. It is waiting to be reviewed.";
    case "RATE_LIMITED":
      return "You have added 5 stations today. Try again tomorrow.";
    case "AUTH_REQUIRED":
      return "Could not verify your device. Check your connection and try again.";
    default:
      return "Could not add this station. Please try again.";
  }
}

/**
 * Add a missing CNG station.
 *
 * The station's coordinates come from the phone's GPS, not a map pin: the app
 * rejects status reports made more than 300m from a station, so an inaccurate
 * coordinate would make the station permanently unreportable. Requiring the
 * submitter to actually be standing there is the cheapest way to guarantee the
 * pin is right.
 *
 * Submissions are queued for review rather than published immediately -- see
 * supabase/migrations/0006_station_submissions.sql.
 */
export default function AddStationScreen() {
  const router = useRouter();

  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  const [name, setName] = useState("");
  const [operator, setOperator] = useState("");
  const [address, setAddress] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const locate = async (): Promise<void> => {
      const fix = await getCurrentCoords();
      if (cancelled) return;
      setCoords(fix.coords);
      setIsFallback(fix.isFallback);
      setLocating(false);
    };

    void locate();
    return () => {
      cancelled = true;
    };
  }, []);

  const failWith = (message: string): void => {
    hapticError();
    setError(message);
  };

  const canSubmit = name.trim().length >= 3 && coords !== null && !isFallback;

  const submit = async (): Promise<void> => {
    if (!canSubmit || !coords) return;

    setSubmitting(true);
    setError(null);

    try {
      if (isDemoMode()) {
        failWith("Connect Supabase to add stations.");
        return;
      }

      const deviceId = await getDeviceId();

      const { error: insertError } = await supabase
        .from("station_submissions")
        .insert({
          name: name.trim(),
          operator: operator.trim() || null,
          address: address.trim() || null,
          device_id: deviceId,
          location: toPointWKT(coords.longitude, coords.latitude),
        });

      if (insertError) {
        failWith(
          messageForError(parseSubmissionError(insertError.message), insertError.message),
        );
        return;
      }

      hapticSuccess();
      showToast("Thanks! We'll review it and add it to the map.");
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
          Add a station
        </Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="px-6 py-6"
          keyboardShouldPersistTaps="handled"
        >
          {/* Location status -- the submission hinges on this being real. */}
          <View className="flex-row items-start rounded-2xl bg-slate-50 p-4">
            <MapPin color={locating || isFallback ? COLORS.muted : COLORS.primary} size={18} />
            <View className="ml-3 flex-1">
              {locating ? (
                <Text className="font-sans text-caption text-muted">
                  Getting your location…
                </Text>
              ) : isFallback ? (
                <>
                  <Text className="font-semibold text-caption text-ink">
                    Location unavailable
                  </Text>
                  <Text className="mt-1 font-sans text-label text-muted">
                    Turn on location and reopen this screen. We use your exact position
                    as the location of the station, so you need to be standing at it.
                  </Text>
                </>
              ) : (
                <>
                  <Text className="font-semibold text-caption text-ink">
                    Using your current location
                  </Text>
                  <Text className="mt-1 font-sans text-label text-muted">
                    Only add a station you are standing at — the pin is placed exactly
                    where you are now.
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Name */}
          <Text className="mt-6 font-semibold text-caption text-ink">
            Station name <Text className="text-unavailable">*</Text>
          </Text>
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
            placeholder="e.g. Indian Oil CNG, Koramangala"
            placeholderTextColor={COLORS.unknown}
            maxLength={NAME_MAX}
            className="mt-2 min-h-[48px] rounded-xl bg-slate-100 px-4 font-sans text-caption text-ink"
          />

          {/* Operator */}
          <Text className="mt-4 font-semibold text-caption text-ink">
            Operator <Text className="font-sans text-label text-muted">(optional)</Text>
          </Text>
          <TextInput
            value={operator}
            onChangeText={setOperator}
            placeholder="e.g. GAIL, Indian Oil, HP, BPCL"
            placeholderTextColor={COLORS.unknown}
            maxLength={OPERATOR_MAX}
            className="mt-2 min-h-[48px] rounded-xl bg-slate-100 px-4 font-sans text-caption text-ink"
          />

          {/* Address */}
          <Text className="mt-4 font-semibold text-caption text-ink">
            Address <Text className="font-sans text-label text-muted">(optional)</Text>
          </Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Street and area"
            placeholderTextColor={COLORS.unknown}
            maxLength={ADDRESS_MAX}
            multiline
            className="mt-2 min-h-[72px] rounded-xl bg-slate-100 px-4 py-3 font-sans text-caption text-ink"
          />

          {error ? (
            <View className="mt-4 rounded-xl bg-unavailable/15 px-4 py-3">
              <Text className="font-medium text-caption text-ink">{error}</Text>
            </View>
          ) : null}

          <Text className="mt-6 font-sans text-label leading-5 text-muted">
            New stations are checked before they appear on the map, so it may take a
            little while for yours to show up.
          </Text>

          <View className="mt-6">
            {locating ? (
              <View className="min-h-[52px] items-center justify-center">
                <ActivityIndicator color={COLORS.primary} />
              </View>
            ) : (
              <Button
                label="Add this station"
                onPress={submit}
                disabled={!canSubmit}
                loading={submitting}
              />
            )}
          </View>

          <View className="h-8" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
