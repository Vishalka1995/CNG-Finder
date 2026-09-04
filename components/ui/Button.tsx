import { ActivityIndicator, Pressable, Text } from "react-native";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

const CONTAINER: Record<Variant, string> = {
  primary: "bg-primary active:opacity-80",
  secondary: "bg-white border border-slate-300 active:opacity-70",
  ghost: "bg-transparent active:opacity-60",
};

const LABEL: Record<Variant, string> = {
  primary: "text-white",
  secondary: "text-ink",
  ghost: "text-muted",
};

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  fullWidth = true,
}: ButtonProps) {
  const isInactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      disabled={isInactive}
      onPress={onPress}
      className={[
        "min-h-[52px] flex-row items-center justify-center rounded-2xl px-6",
        CONTAINER[variant],
        fullWidth ? "w-full" : "self-start",
        isInactive ? "opacity-50" : "",
      ].join(" ")}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#FFFFFF" : "#0F172A"} />
      ) : (
        <Text className={`font-semibold text-body ${LABEL[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}
