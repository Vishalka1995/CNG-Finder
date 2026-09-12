import { Tabs } from "expo-router";
import { List, Map, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { COLORS } from "@/constants/colors";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.muted,
        // A fixed height ignored the system navigation bar (Back/Home/Recents)
        // on devices without physical buttons, so its own tap area sat under
        // the OS bar and was unreachable. insets.bottom pushes the bar up by
        // exactly that much on every device, including ones with none.
        tabBarStyle: {
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 12, fontFamily: "Inter_500Medium" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Map",
          tabBarIcon: ({ color, size }) => <Map color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: "List",
          tabBarIcon: ({ color, size }) => <List color={color} size={size} />,
        }}
      />
      {/* Favourites is not a tab: it is a filter on the List tab, over exactly
          the same station data. That freed a slot for the leaderboard, and
          profile/stats sit with settings under "You" rather than claiming
          another one. */}
      <Tabs.Screen
        name="you"
        options={{
          title: "You",
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
