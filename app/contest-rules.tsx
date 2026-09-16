import { LegalScreen, type LegalSection } from "@/components/ui/LegalScreen";

/**
 * Rules for the monthly prize.
 *
 * Written to match what the code actually does -- the monthly reset, the
 * minimum report count, the award cooldown -- so the rules and the behaviour
 * cannot drift apart. The commercial choices in here (prize amounts, the claim
 * window, who settles a dispute) are the operator's, and should be reviewed
 * before the first prize is awarded.
 */
const SECTIONS: LegalSection[] = [
  {
    heading: "How to enter",
    body: [
      "There is nothing to enter. Every report you make from inside the app counts towards that month's total automatically.",
      "You need at least 10 scored reports in a month to be eligible for a prize. This keeps the competition to drivers who actually contributed.",
    ],
  },
  {
    heading: "How winners are decided",
    body: [
      "The three drivers with the most points at the end of the month win. Points are counted in Indian Standard Time, and the month ends at midnight on the last day.",
      "If two drivers finish on the same points, they share the same position, and the higher prize goes to whichever of them reached that total first.",
      "Monthly points reset to zero on the 1st. Your lifetime total and your badges are never reset.",
    ],
  },
  {
    heading: "Prizes",
    body: [
      "1st place — 10kg of CNG",
      "2nd place — 5kg of CNG",
      "3rd place — 3kg of CNG",
      "Prizes are paid as their cash value by UPI, to the ID you provide when you claim. We do not deliver fuel directly.",
    ],
  },
  {
    heading: "Claiming",
    body: [
      "Winners are announced on the 1st of the following month and notified in the app.",
      "You have 7 days to claim. Claims are checked before payment, and payment is made within 48 hours of a successful check.",
      "A prize that is not claimed within 7 days is forfeited and is not carried over or reallocated.",
    ],
  },
  {
    heading: "Fair play",
    body: [
      "Reports must be genuine and made at the station. The app only accepts a report from within 300 metres, and every report is recorded with the location it was made from.",
      "One person, one account. Using several accounts or devices to increase your total disqualifies all of them.",
      "Reporting a status you know to be false is not allowed. It sends other drivers to empty pumps, which is the one thing this app exists to prevent.",
      "Accounts showing signs of automated or coordinated reporting may be excluded from the competition without notice.",
    ],
  },
  {
    heading: "Changes",
    body: [
      "These rules, the prizes and the competition itself may change or end at any time. Changes take effect from the month after they are published.",
      "Where a result is disputed, the decision of CNG Now is final.",
    ],
  },
];

export default function ContestRulesScreen() {
  return (
    <LegalScreen
      title="Contest rules"
      updated="September 2026"
      intro="Every month, the drivers who report the most station statuses win free CNG. Here is exactly how that works."
      sections={SECTIONS}
    />
  );
}
