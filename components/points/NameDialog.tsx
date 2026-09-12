import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { COLORS } from "@/constants/colors";
import { DISPLAY_NAME_MAX, setDisplayName } from "@/lib/points";

interface NameDialogProps {
  initialValue: string | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}

/**
 * Names the driver on the leaderboard.
 *
 * A chosen handle rather than a real name: this is a public board, and nobody
 * agreed to publish who they are by reporting that a pump had gas.
 *
 * Only mounted while open (see the caller), so the draft and any error reset
 * themselves on the way out -- no effect needed to clear an abandoned edit.
 */
export function NameDialog({ initialValue, onClose, onSaved }: NameDialogProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const message = await setDisplayName(value);
      if (message) {
        setError(message);
        return;
      }
      onSaved(value.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onClose}
        className="flex-1 justify-center bg-black/40 px-6"
      >
        {/* Swallows taps so pressing inside the card does not dismiss it. */}
        <Pressable onPress={() => undefined} className="rounded-2xl bg-white p-5">
          <Text className="font-semibold text-heading text-ink">
            Your leaderboard name
          </Text>
          <Text className="mt-1 font-sans text-label leading-5 text-muted">
            This is shown to other drivers. Pick anything you like — it does not have
            to be your real name.
          </Text>

          <TextInput
            value={value}
            onChangeText={(text) => setValue(text.slice(0, DISPLAY_NAME_MAX))}
            placeholder="e.g. Kolhapur Rider"
            placeholderTextColor={COLORS.unknown}
            maxLength={DISPLAY_NAME_MAX}
            autoCapitalize="words"
            autoCorrect={false}
            className="mt-4 rounded-2xl border border-slate-300 bg-white px-4 py-3 font-sans text-body text-ink"
          />

          <Text className="mt-1 text-right font-sans text-label text-muted">
            {value.trim().length}/{DISPLAY_NAME_MAX}
          </Text>

          {error ? (
            <View className="mt-3 rounded-xl bg-unavailable/15 px-4 py-3">
              <Text className="font-medium text-label text-ink">{error}</Text>
            </View>
          ) : null}

          <View className="mt-4">
            <Button label="Save" onPress={save} loading={saving} />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            className="mt-2 items-center py-2 active:opacity-60"
          >
            <Text className="font-medium text-caption text-muted">Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
