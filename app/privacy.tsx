import { LegalScreen, type LegalSection } from "@/components/ui/LegalScreen";

/**
 * Terms and privacy.
 *
 * Describes what the app actually does, checked against the code rather than
 * written from a template: foreground-only location, an anonymous account, the
 * location stored with each report, and what other drivers can and cannot see.
 *
 * Deliberately promises nothing the app cannot do. Deleting an account is
 * offered as a request to a human, because no in-app deletion exists yet --
 * claiming otherwise would be the easiest possible thing to get wrong.
 */
const SECTIONS: LegalSection[] = [
  {
    heading: "What we collect",
    body: [
      "Your location, while the app is open. It is used to show stations near you, to sort them by distance, and to check you are at a station when you report one. The app never asks for background location and cannot track you while it is closed.",
      "An anonymous account. There is no sign-up, no email and no password. The app creates an anonymous identity so your points and reports belong to you, and so the same person cannot report one station repeatedly to inflate a score.",
      "Your reports. Each one records the station, the status you chose, the time, and the location you were at when you made it.",
      "A name, if you choose one. This is optional, and it is only used to identify you on the leaderboard.",
      "Things kept only on your phone: your saved stations, your recent searches, your report history and your settings.",
    ],
  },
  {
    heading: "What other people can see",
    body: [
      "Your reports, as part of a station's status — the status, the time, and any note. Not your name, not your account, and not where you were.",
      "Your chosen name, your city and your points, on the leaderboard. Your city comes from the last station you reported at.",
      "If you never set a name, the leaderboard shows a short anonymous handle instead.",
      "The location recorded with a report is never shown to other drivers. It is used to verify you were at the station and to check prize claims.",
    ],
  },
  {
    heading: "Who else is involved",
    body: [
      "Supabase stores the station data, reports and points. Its servers for this app are in Singapore.",
      "MapTiler provides the map itself. Loading map tiles tells them roughly which part of the map you are looking at.",
      "We do not sell your data, and we do not share it for advertising.",
    ],
  },
  {
    heading: "How long it is kept",
    body: [
      "Reports are kept permanently. They are what the app is built on, and a station's history cannot be rewritten without making its live status untrustworthy.",
      "Only the last 24 hours of reports are readable by the app at all. Older ones are used for totals and prize checks.",
      "Data kept on your phone stays until you clear it or uninstall the app.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      "You do not have to set a name. Without one you can still report, earn points and appear on the leaderboard anonymously.",
      "You can turn off location permission at any time in your phone's settings. The app will still show stations, but it cannot sort them by distance and you will not be able to report.",
      "You can clear your local report history from My reports.",
      "To have your account and reports removed, contact us and we will do it. There is no in-app button for this yet.",
    ],
  },
  {
    heading: "Using the app",
    body: [
      "Station availability comes from other drivers, not from the fuel companies. It can be wrong or out of date. Check before you rely on it, and do not use the app while driving.",
      "Report honestly. A false report sends other drivers to an empty pump.",
      "We may suspend an account that abuses reporting or the monthly competition.",
      "The app is provided as is. We cannot guarantee a station has gas, is open, or exists as described.",
    ],
  },
  {
    heading: "Contact",
    body: [
      "Questions, corrections, or a request to delete your data: vishal.a@flatworldsolutions.com",
    ],
  },
];

export default function PrivacyScreen() {
  return (
    <LegalScreen
      title="Terms & privacy"
      updated="September 2026"
      intro="CNG Now needs your location to be useful, and almost nothing else. This explains what is collected, what other drivers can see, and what stays on your phone."
      sections={SECTIONS}
    />
  );
}
