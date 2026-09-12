/**
 * The badge catalogue.
 *
 * Display only. What has actually been earned is decided by award_badges()
 * (migration 0011) and read back from the badges table -- this file never
 * grants anything, it only knows how to draw it.
 *
 * `earnable: false` marks badges whose award logic belongs to a later phase:
 * accuracy scoring and monthly winners do not exist yet. They are listed
 * anyway, greyed out, because a locked badge someone can work towards is the
 * point; hiding them until the machinery exists would make the grid look
 * complete when it is not.
 */

export interface BadgeDefinition {
  id: string;
  emoji: string;
  name: string;
  description: string;
  earnable: boolean;
}

export const BADGES: BadgeDefinition[] = [
  {
    id: "first_report",
    emoji: "🌱",
    name: "First Step",
    description: "Submit your first report",
    earnable: true,
  },
  {
    id: "streak_7",
    emoji: "🔥",
    name: "On Fire",
    description: "Report on 7 days in a row",
    earnable: true,
  },
  {
    id: "streak_30",
    emoji: "🔥",
    name: "Unstoppable",
    description: "Report on 30 days in a row",
    earnable: true,
  },
  {
    id: "early_bird",
    emoji: "🌅",
    name: "Early Bird",
    description: "Report before 8am, 10 times",
    earnable: true,
  },
  {
    id: "city_scout",
    emoji: "🏙️",
    name: "City Scout",
    description: "Report at 10 different stations",
    earnable: true,
  },
  {
    id: "explorer",
    emoji: "🗺️",
    name: "Explorer",
    description: "Report at 25 different stations",
    earnable: true,
  },
  {
    id: "century",
    emoji: "💯",
    name: "Century",
    description: "100 reports in total",
    earnable: true,
  },
  {
    id: "five_hundred",
    emoji: "🚀",
    name: "500 Club",
    description: "500 reports in total",
    earnable: true,
  },
  {
    id: "sharp_eye",
    emoji: "🎯",
    name: "Sharp Eye",
    description: "90% accuracy over 20+ reports",
    earnable: false,
  },
  {
    id: "top_ten",
    emoji: "⭐",
    name: "Top 10",
    description: "Finish a month in the top 10",
    earnable: false,
  },
  {
    id: "runner_up",
    emoji: "🥈",
    name: "Runner Up",
    description: "Finish a month in second place",
    earnable: false,
  },
  {
    id: "legend",
    emoji: "👑",
    name: "Legend",
    description: "Win the monthly leaderboard",
    earnable: false,
  },
];
