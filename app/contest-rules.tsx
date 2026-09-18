import { LegalScreen, type LegalSection } from "@/components/ui/LegalScreen";

/**
 * Rules for the monthly prize.
 *
 * Written to match what the code actually does -- the monthly reset, the
 * minimum report count, the award cooldown -- so the rules and the behaviour
 * cannot drift apart.
 *
 * Two things here are legal posture rather than product description, and are
 * deliberate. "Free to enter" and "decided by skill" are stated plainly up
 * front, because a paid-entry prize decided by chance is a very different
 * thing in Indian law from a free one decided by effort, and the difference
 * should be visible rather than implied.
 *
 * Tax is stated as the winner's responsibility rather than claiming a
 * threshold. The 194B limit became an annual aggregate rather than a
 * per-prize one, and a separate section covers winnings from online games,
 * so "no tax applies" is a claim that could easily be wrong -- and published
 * terms are the worst place to be wrong about tax.
 *
 * The commercial choices (prize amounts, the claim window, who settles a
 * dispute) are the operator's and should be reviewed before the first prize.
 */
const SECTIONS: LegalSection[] = [
  {
    heading: "Free to enter",
    body: [
      "Entering costs nothing. There is no fee, no purchase, and nothing to buy inside the app. Every driver using CNG Now is eligible on the same terms.",
      "You never have to buy fuel, or anything else, to take part or to win.",
    ],
  },
  {
    heading: "This is a contest of skill, not chance",
    body: [
      "Winners are decided by effort and accuracy, not by luck or a draw. Your position comes from how many genuine station reports you make, when you make them, and whether other drivers confirm what you reported.",
      "No element of the result is random. A driver who reports more, and more accurately, finishes higher.",
    ],
  },
  {
    heading: "Who can take part",
    body: [
      "The contest is open to residents of India only.",
      "You must be able to receive a UPI payment in your own name to claim a prize.",
      "One person, one account. The app counts reports per account, and using more than one account or device to raise your total disqualifies all of them.",
    ],
  },
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
      "Before a prize is paid, the winner's reports are checked. Where a result is disputed, the decision of CNG Now is final.",
    ],
  },
  {
    heading: "Prizes",
    body: [
      "1st place — 10kg of CNG",
      "2nd place — 5kg of CNG",
      "3rd place — 3kg of CNG",
      "Prizes are paid as their cash value by UPI, to the ID you provide when you claim. We do not deliver fuel directly.",
      "Any tax payable on a prize is the winner's responsibility.",
    ],
  },
  {
    heading: "Claiming",
    body: [
      "Winners are announced on the 1st of the following month and notified in the app.",
      "You have 7 days to claim. Claims are checked before payment, and payment is made by UPI within 48 hours of a successful check.",
      "A prize that is not claimed within 7 days is forfeited and is not carried over or reallocated.",
    ],
  },
  {
    heading: "If you win, this is shown in the app",
    body: [
      "By taking part you agree that, if you win, your chosen display name and your city may be shown to other drivers on the leaderboard and in the Hall of Fame.",
      "Your real name is never published unless you chose it as your display name. Nothing else about you is shown — not your phone number, not your UPI ID, and not where you reported from.",
    ],
  },
  {
    heading: "Fair play",
    body: [
      "Reports must be genuine and made at the station. The app only accepts a report from within 300 metres, and every report is recorded with the location it was made from.",
      "Reporting a status you know to be false is not allowed. It sends other drivers to empty pumps, which is the one thing this app exists to prevent.",
      "We may disqualify any entry, withhold any prize, and close any account showing signs of false, automated or coordinated reporting. We do not have to give notice or a reason before doing so.",
    ],
  },
  {
    heading: "Changes",
    body: [
      "These rules, the prizes and the contest itself may change or end at any time. Changes take effect from the month after they are published.",
    ],
  },
];

export default function ContestRulesScreen() {
  return (
    <LegalScreen
      title="Contest rules"
      updated="September 2026"
      intro="Every month, the drivers who report the most station statuses win free CNG. Entering is free, and winners are decided by effort rather than luck. Here is exactly how it works."
      sections={SECTIONS}
    />
  );
}
