/** @type {import('tailwindcss').Config} */
module.exports = {
  // Deliberately scoped to source dirs only. Including node_modules makes every
  // Metro rebuild visibly slower, especially on a OneDrive-synced path.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  // "class", not the default "media". NativeWind's web runtime throws
  // "Cannot manually set color scheme, as dark mode is type 'media'" when
  // anything (e.g. expo-status-bar) sets the scheme at runtime. The app is
  // light-only by design, so class mode is correct as well as safe.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#00A86B",
        available: "#22C55E",
        queue: "#F59E0B",
        unavailable: "#EF4444",
        unknown: "#94A3B8",
        surface: "#FFFFFF",
        ink: "#0F172A",
        muted: "#64748B",
      },
      fontFamily: {
        sans: ["Inter_400Regular"],
        medium: ["Inter_500Medium"],
        semibold: ["Inter_600SemiBold"],
        bold: ["Inter_700Bold"],
      },
      fontSize: {
        hero: "32px",
        title: "24px",
        heading: "18px",
        body: "16px",
        caption: "14px",
        label: "12px",
      },
      spacing: {
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        6: "24px",
        8: "32px",
        12: "48px",
      },
    },
  },
  plugins: [],
};
