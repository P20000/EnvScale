import type { ScrollStageData } from "./landingTypes";

export const SCROLL_STAGES: ScrollStageData[] = [
  {
    id: "ingestion",
    stageNumber: "01",
    tag: "THE HIDDEN BLIND SPOT",
    title: "Why Periodic Checking Misses Outages",
    subtitle: "Like checking the stove every 30 seconds while dinner burns in between",
    description:
      "Most monitoring tools only check your servers once every 15 to 30 seconds. If an app crashes and restarts quickly between checks, you will never see it happened — leaving you blind to intermittent failures until frustrated users start complaining.",
    architectureDetails: [
      "Traditional tools hammer your servers with repeated, heavy snapshot requests.",
      "Crashes that happen and vanish between checks remain completely invisible.",
      "Constant polling wastes server power just to ask if anything changed.",
    ],
    metrics: [
      { label: "Check Frequency", value: "Every 15-30s", statusColor: "#F4C26B" },
      { label: "Crash Blind Spot", value: "Up to 30s", statusColor: "#F2B8B5" },
      { label: "Server Strain", value: "High Overhead", statusColor: "#F2B8B5" },
    ],
  },
  {
    id: "streaming",
    stageNumber: "02",
    tag: "REAL-TIME LIVE STREAM",
    title: "Instant Live Updates Without Repeated Asking",
    subtitle: "A direct live wire that alerts you the exact millisecond something shifts",
    description:
      "Instead of repeatedly asking 'Are we good yet?', EnvScale keeps an open line directly with your cloud. Whenever any service changes, restarts, or crashes, the news is pushed straight to your dashboard in less than a blink of an eye.",
    architectureDetails: [
      "Maintains a single open connection instead of thousands of repeated requests.",
      "Only sends updates when something actually changes, saving bandwidth.",
      "Delivers alerts to your screen in under 200 milliseconds.",
    ],
    metrics: [
      { label: "Update Speed", value: "< 0.2 Sec", statusColor: "#6DD6A8" },
      { label: "Live Connection", value: "Real-Time", statusColor: "#A8C7FA" },
      { label: "Wasted Requests", value: "Zero", statusColor: "#6DD6A8" },
    ],
  },
  {
    id: "governance",
    stageNumber: "03",
    tag: "SIMPLE SYSTEM HEALTH",
    title: "A Clear 0 to 100 Score For Your Health",
    subtitle: "No confusing graphs — just a transparent grade and streak tracker",
    description:
      "Forget guessing if your cluster is healthy from fifty different charts. EnvScale gives your entire system an objective grade from 0 to 100, taking off points only when things fail. Teams celebrate crash-free day streaks and race to fix issues faster.",
    architectureDetails: [
      "Penalties are clearly calculated so you always know why your score dropped.",
      "Warns you of rising memory before containers run out of room and freeze.",
      "Gamified team leaderboards track crash-free day streaks and recovery times.",
    ],
    metrics: [
      { label: "Health Score", value: "0 - 100 Pts", statusColor: "#6DD6A8" },
      { label: "Fix Time Goal", value: "< 5 Minutes", statusColor: "#A8C7FA" },
      { label: "Crash-Free Tracker", value: "Automatic", statusColor: "#F4C26B" },
    ],
  },
  {
    id: "security",
    stageNumber: "04",
    tag: "BANK-GRADE SAFETY",
    title: "Locked Credentials & Self-Healing Connections",
    subtitle: "Military-grade encryption keeps your cluster keys completely safe",
    description:
      "Your secret connection keys are sealed with bank-grade encryption before they ever touch our database. Nobody — not even the browser — can view them raw. If a connection ever drops, our self-healing background workers automatically restore it without downtime.",
    architectureDetails: [
      "Industry-standard AES-256 encryption seals all credentials safely.",
      "Simple team roles: Admins manage clusters, Members operate, Viewers observe.",
      "Self-healing watchers automatically reconnect when servers restart.",
    ],
    metrics: [
      { label: "Key Encryption", value: "Bank-Grade", statusColor: "#6DD6A8" },
      { label: "Exposed Secrets", value: "Zero (0%)", statusColor: "#6DD6A8" },
      { label: "Recovery", value: "Self-Healing", statusColor: "#A8C7FA" },
    ],
  },
];
