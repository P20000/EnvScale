import type { ScrollStageData } from "./landingTypes";

export const SCROLL_STAGES: ScrollStageData[] = [
  {
    id: "ingestion",
    stageNumber: "01",
    tag: "THE OBSERVABILITY BOTTLENECK",
    title: "Why Polling Fails Kubernetes Clusters",
    subtitle: "High cluster overhead & blind spots on ephemeral crashes",
    description:
      "Conventional Kubernetes monitoring tools execute interval polling loops (e.g., querying GET /api/v1/pods every 15 to 30 seconds). Under heavy cluster workloads, this triggers API server throttling while completely missing transient CrashLoopBackOff spikes and OOM exits that occur between polling cycles.",
    architectureDetails: [
      "Traditional polling generates O(N) API calls per user session.",
      "Transient crash spikes occurring between intervals vanish unseen.",
      "API server kube-apiserver experiences heavy serialization CPU spikes.",
    ],
    metrics: [
      { label: "Polling Interval", value: "15 - 30s", statusColor: "#F4C26B" },
      { label: "Crash Blind Spot", value: "Up to 30s", statusColor: "#F2B8B5" },
      { label: "API Throttling Risk", value: "High (429)", statusColor: "#F2B8B5" },
    ],
  },
  {
    id: "streaming",
    stageNumber: "02",
    tag: "CLIENT-GO SHARED INFORMER PIPELINE",
    title: "Sub-200ms WebSocket State Deltas",
    subtitle: "Zero-polling Informers with in-memory DeltaFIFO queues",
    description:
      "EnvScale replaces interval polling with Go client-go SharedInformerFactory (PodInformer, NodeInformer, ServiceInformer). The streamer gateway maintains a local DeltaFIFO cache and immediately emits delta payloads over WebSockets with Redis Pub/Sub multiplexing, delivering updates in under 200ms.",
    architectureDetails: [
      "SharedInformerFactory holds a continuous watch stream with zero repetitive calls.",
      "Only delta state changes (EVENT_POD_STATUS_CHANGED) are emitted over the wire.",
      "Gorilla WebSocket gateway multiplexes streams across multiple browser clients.",
    ],
    metrics: [
      { label: "State Latency", value: "< 200ms", statusColor: "#6DD6A8" },
      { label: "Network Protocol", value: "RFC 6455 WS", statusColor: "#A8C7FA" },
      { label: "API Polling Calls", value: "Zero", statusColor: "#6DD6A8" },
    ],
  },
  {
    id: "governance",
    stageNumber: "03",
    tag: "ALGORITHMIC HEALTH GOVERNANCE",
    title: "Deterministic 0–100 Cluster Health",
    subtitle: "Mathematical penalty scoring, MTTR tracking & streak gamification",
    description:
      "Rather than relying on subjective status discussions, EnvScale executes a deterministic cluster health algorithm: Score = max(0, min(100, 100 - (FailingPods × 15) - (Restarts × 2) - (MemoryPressure × 10))). Teams compete on objective crash-free streak milestones and verifiable Mean Time to Recovery (MTTR).",
    architectureDetails: [
      "CrashLoopBackOff penalties apply instantaneously upon delta receipt.",
      "Memory pressure warnings deducted before kernel OOM killer terminates containers.",
      "Team leaderboard ranks workspaces by crash-free streak days and resolution speed.",
    ],
    metrics: [
      { label: "Health Index Range", value: "0 - 100", statusColor: "#6DD6A8" },
      { label: "MTTR Benchmark", value: "Sub-5 Min", statusColor: "#A8C7FA" },
      { label: "Streak Verification", value: "Automated", statusColor: "#F4C26B" },
    ],
  },
  {
    id: "security",
    stageNumber: "04",
    tag: "AUTHENTICATED ENCRYPTION & RBAC",
    title: "AES-256-GCM Vault & Self-Healing",
    subtitle: "Zero plaintext credentials with strict workspace access boundaries",
    description:
      "Raw Kubeconfig credentials are encrypted with a 256-bit Galois/Counter Mode (GCM) cipher using 12-byte initialization vectors and authentication tags before database persistence. Ephemeral client-go sessions authenticate without exposing raw tokens to the browser. Background reconcilers self-heal out-of-order cluster restarts.",
    architectureDetails: [
      "AES-256-GCM authenticated encryption guarantees ciphertext integrity.",
      "Three discrete workspace roles: ADMIN (Cluster CRUD), MEMBER (Ops), VIEWER (Read).",
      "Background worker automatically reconnects clusters following infrastructure restarts.",
    ],
    metrics: [
      { label: "Encryption Cipher", value: "AES-256-GCM", statusColor: "#6DD6A8" },
      { label: "Plaintext Exposure", value: "Zero (0%)", statusColor: "#6DD6A8" },
      { label: "Reconciliation", value: "Self-Healing", statusColor: "#A8C7FA" },
    ],
  },
];
