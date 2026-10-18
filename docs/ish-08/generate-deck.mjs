/**
 * ISH-08: EnvScale Project Defense Presentation Generator
 * Generates: docs/ish-08/output/EnvScale_Project_Defense.pptx
 * Tool: pptxgenjs 3.12.0
 *
 * Run: node generate-deck.mjs
 */

import PptxGenJS from "pptxgenjs";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "output");
const OUTPUT_FILE = join(OUTPUT_DIR, "EnvScale_Project_Defense");

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  // Backgrounds
  canvasBg:   "09090B",   // near-black canvas
  surfaceCard:"141417",   // card/navbar surface
  surfaceMid: "18181B",   // slightly lighter surface
  surfaceMute:"27272A",   // muted surface / borders

  // Text
  textPrimary:  "F4F4F5",  // neutral-100
  textSecondary:"A1A1AA",  // neutral-400
  textMuted:    "71717A",  // neutral-500

  // Accent
  blue:    "3B82F6",  // primary action blue
  blueDim: "1D4ED8",  // darker blue
  blueGlow:"1E3A5F",  // blue tint surface

  // Semi-transparent tints (6-digit approximations — pptxgenjs only accepts 6-digit hex)
  blueTint:   "1E3A5F",  // blue/10 tint
  emerTint:   "064E3B",  // emerald/10 tint
  amberTint:  "451A03",  // amber/10 tint
  redTint:    "450A0A",  // red/10 tint
  purpleTint: "2E1065",  // purple/10 tint
  blueHalf:   "1D4ED8",  // blue/60 mid
  emerHalf:   "047857",  // emerald/60 mid
  amberHalf:  "92400E",  // amber/60 mid
  redHalf:    "7F1D1D",  // red/60 mid

  // Status
  emerald: "10B981",  // running / success
  amber:   "F59E0B",  // warning
  red:     "EF4444",  // error / critical
  redDim:  "7F1D1D",  // error surface

  // Neutral grays
  zinc800: "27272A",
  zinc700: "3F3F46",
  zinc600: "52525B",
  zinc300: "D4D4D8",

  white:   "FFFFFF",
};

// Slide dimensions (widescreen 16:9 in inches)
const W = 13.33;
const H = 7.5;

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.title  = "EnvScale — Project Defense";
pptx.subject = "Semester 5 Engineering Project";
pptx.author  = "EnvScale Team";

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Full-slide dark background rect */
function addBg(slide, color = C.canvasBg) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: H,
    fill: { color },
    line: { color, width: 0 },
  });
}

/** Thin top accent bar */
function addTopBar(slide, color = C.blue) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.055,
    fill: { color },
    line: { color, width: 0 },
  });
}

/** Footer bar with slide number and branding */
function addFooter(slide, slideNum, total = 15) {
  // footer bg strip
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: H - 0.36, w: W, h: 0.36,
    fill: { color: C.surfaceCard },
    line: { color: C.zinc800, width: 0.5 },
  });
  // brand
  slide.addText("ENVSCALE", {
    x: 0.35, y: H - 0.32, w: 3, h: 0.26,
    fontSize: 7, bold: true, color: C.blue,
    fontFace: "Calibri", align: "left",
  });
  // center subtitle
  slide.addText("Semester 5 Engineering Project Defense", {
    x: 3.5, y: H - 0.32, w: 6.33, h: 0.26,
    fontSize: 7, color: C.textMuted,
    fontFace: "Calibri", align: "center",
  });
  // slide number
  slide.addText(`${slideNum} / ${total}`, {
    x: W - 1.2, y: H - 0.32, w: 0.9, h: 0.26,
    fontSize: 7, color: C.textMuted,
    fontFace: "Calibri", align: "right",
  });
}

/** Section title (large heading) */
function addTitle(slide, text, y = 0.42, color = C.textPrimary, size = 28) {
  slide.addText(text, {
    x: 0.5, y, w: W - 1, h: 0.55,
    fontSize: size, bold: true, color,
    fontFace: "Calibri", align: "left",
    charSpacing: 0.5,
  });
}

/** Subtitle / tagline under title */
function addSubtitle(slide, text, y = 0.95, color = C.textSecondary, size = 13) {
  slide.addText(text, {
    x: 0.5, y, w: W - 1, h: 0.35,
    fontSize: size, color,
    fontFace: "Calibri", align: "left",
  });
}

/** Horizontal divider line */
function addDivider(slide, y = 1.28, color = C.zinc700) {
  slide.addShape(pptx.ShapeType.line, {
    x: 0.5, y, w: W - 1, h: 0,
    line: { color, width: 0.75 },
  });
}

/** Bordered card */
function addCard(slide, x, y, w, h, fillColor = C.surfaceCard, borderColor = C.zinc800) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: fillColor },
    line: { color: borderColor, width: 0.75 },
    rectRadius: 0.08,
  });
}

/** Small colored dot */
function addDot(slide, x, y, color = C.emerald, size = 0.1) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y, w: size, h: size,
    fill: { color },
    line: { color, width: 0 },
  });
}

/** Pill / badge shape */
function addBadge(slide, x, y, w, h, fillColor, textStr, textColor = C.white, fontSize = 8) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: fillColor },
    line: { color: fillColor, width: 0 },
    rectRadius: 0.12,
  });
  slide.addText(textStr, {
    x, y, w, h,
    fontSize, bold: true, color: textColor,
    fontFace: "Calibri", align: "center", valign: "middle",
  });
}

/** Bullet list helper — renders an array of bullet strings */
function addBullets(slide, items, x, y, w, h, size = 11, color = C.textSecondary, lineSpacing = 1.4) {
  const rows = items.map((item) => {
    if (typeof item === "string") {
      return { text: item, options: { bullet: { code: "25AA", color: C.blue }, color, fontSize: size, fontFace: "Calibri", paraSpaceAfter: 4 } };
    }
    return item; // pre-formatted object
  });
  slide.addText(rows, { x, y, w, h, valign: "top", lineSpacingMultiple: lineSpacing });
}

/** Arrow pointing right made from two shapes */
function addArrow(slide, x, y, color = C.zinc600) {
  slide.addShape(pptx.ShapeType.rightArrow, {
    x, y, w: 0.35, h: 0.22,
    fill: { color },
    line: { color, width: 0 },
  });
}

/** Return a solid tint colour (no alpha — pptxgenjs only accepts 6-digit hex) */
function tint(color) {
  const map = {
    "3B82F6": "1E3A5F", // blue tint
    "10B981": "064E3B", // emerald tint
    "F59E0B": "451A03", // amber tint
    "EF4444": "450A0A", // red tint
    "8B5CF6": "2E1065", // purple tint
    "52525B": "27272A",
    "6B7280": "27272A",
  };
  return map[color.toUpperCase()] || "27272A";
}

/** Return a mid-shade border colour */
function midShade(color) {
  const map = {
    "3B82F6": "1D4ED8",
    "10B981": "047857",
    "F59E0B": "92400E",
    "EF4444": "7F1D1D",
    "8B5CF6": "5B21B6",
    "52525B": "3F3F46",
  };
  return map[color.toUpperCase()] || "3F3F46";
}

/** Box with centred label — used for architecture diagrams */
function addBox(slide, x, y, w, h, label, sublabel, fillColor = C.surfaceMid, borderColor = C.zinc700, textColor = C.textPrimary, subColor = C.textSecondary, labelSize = 10) {
  addCard(slide, x, y, w, h, fillColor, borderColor);
  slide.addText(label, {
    x, y: y + h * 0.18, w, h: h * 0.45,
    fontSize: labelSize, bold: true, color: textColor,
    fontFace: "Calibri", align: "center",
  });
  if (sublabel) {
    slide.addText(sublabel, {
      x, y: y + h * 0.56, w, h: h * 0.36,
      fontSize: 8, color: subColor,
      fontFace: "Calibri", align: "center",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 1 — TITLE SLIDE
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide, C.canvasBg);

  // Top accent bar (thicker on title)
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.08,
    fill: { color: C.blue },
    line: { color: C.blue, width: 0 },
  });

  // Large ENV wordmark block
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.0, w: 0.08, h: 2.2,
    fill: { color: C.blue },
    line: { color: C.blue, width: 0 },
  });

  // Main title
  slide.addText("EnvScale", {
    x: 0.85, y: 1.05, w: 8.5, h: 1.0,
    fontSize: 52, bold: true, color: C.textPrimary,
    fontFace: "Calibri",
  });

  // Subtitle
  slide.addText("Multi-Tenant Kubernetes Observability\n& Gamified Governance Platform", {
    x: 0.85, y: 2.1, w: 9, h: 0.9,
    fontSize: 17, color: C.textSecondary,
    fontFace: "Calibri",
  });

  // Divider
  slide.addShape(pptx.ShapeType.line, {
    x: 0.85, y: 3.08, w: 8.5, h: 0,
    line: { color: C.zinc700, width: 0.75 },
  });

  // Team row
  const team = [
    { name: "Pranav", role: "Kubernetes Streamer" },
    { name: "Vinit",  role: "API Server & Database" },
    { name: "Neha",   role: "Frontend Visualization" },
    { name: "Ishika", role: "Documentation & QA" },
  ];
  team.forEach((m, i) => {
    const cx = 0.85 + i * 2.7;
    addCard(slide, cx, 3.3, 2.5, 0.95, C.surfaceCard, C.zinc700);
    slide.addText(m.name, {
      x: cx, y: 3.38, w: 2.5, h: 0.3,
      fontSize: 12, bold: true, color: C.textPrimary,
      fontFace: "Calibri", align: "center",
    });
    slide.addText(m.role, {
      x: cx, y: 3.7, w: 2.5, h: 0.45,
      fontSize: 9, color: C.textSecondary,
      fontFace: "Calibri", align: "center",
    });
  });

  // Bottom meta
  slide.addText("Semester 5 Engineering Project Defense  ·  2026", {
    x: 0.85, y: 4.55, w: 9, h: 0.3,
    fontSize: 10, color: C.textMuted,
    fontFace: "Calibri",
  });

  addFooter(slide, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 2 — PROBLEM STATEMENT
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "The Problem", 0.42);
  addSubtitle(slide, "Engineering teams running Kubernetes face compounding operational complexity", 0.95);
  addDivider(slide, 1.3);

  const problems = [
    { icon: "01", head: "Terminal-Heavy Workflows", body: "All cluster inspection requires memorising kubectl commands — no visual overview of running workloads." },
    { icon: "02", head: "No Unified Visibility",    body: "Pod status, logs, events, and metrics exist in separate tools with no single coherent view." },
    { icon: "03", head: "Delayed Issue Detection",  body: "Failures surface only after a service is already down; proactive health awareness is missing." },
    { icon: "04", head: "Fragmented Monitoring",    body: "Teams juggle Grafana dashboards, kubectl, and incident channels instead of one integrated surface." },
  ];

  problems.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 6.3;
    const y = 1.55 + row * 1.85;
    addCard(slide, x, y, 6.0, 1.62, C.surfaceMid, C.zinc700);

    // Number badge
    addCard(slide, x + 0.18, y + 0.18, 0.44, 0.44, C.blueGlow, C.blue);
    slide.addText(p.icon, {
      x: x + 0.18, y: y + 0.18, w: 0.44, h: 0.44,
      fontSize: 10, bold: true, color: C.blue,
      fontFace: "Calibri", align: "center", valign: "middle",
    });

    slide.addText(p.head, {
      x: x + 0.75, y: y + 0.18, w: 5.0, h: 0.3,
      fontSize: 12, bold: true, color: C.textPrimary,
      fontFace: "Calibri",
    });
    slide.addText(p.body, {
      x: x + 0.75, y: y + 0.52, w: 5.0, h: 0.88,
      fontSize: 10, color: C.textSecondary,
      fontFace: "Calibri",
    });
  });

  addFooter(slide, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 3 — PROPOSED SOLUTION
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Proposed Solution");
  addSubtitle(slide, "A unified visual Kubernetes observability and governance platform");
  addDivider(slide, 1.3);

  // Central value proposition box
  addCard(slide, 0.5, 1.45, W - 1, 1.0, C.blueGlow, C.blue);
  slide.addText(
    "EnvScale connects engineering teams to their Kubernetes clusters and translates live infrastructure state into an interactive visual canvas — eliminating terminal-only workflows.",
    {
      x: 0.7, y: 1.52, w: W - 1.4, h: 0.86,
      fontSize: 13, color: C.textPrimary,
      fontFace: "Calibri", align: "center", valign: "middle",
    }
  );

  const pillars = [
    { label: "Visual Topology",    desc: "React Flow canvas renders pods, nodes, services in a live interactive graph",  color: C.blue },
    { label: "Real-Time Streaming",desc: "client-go Informers push K8s events via WebSocket — sub-second updates",       color: C.emerald },
    { label: "Alerts & Incidents", desc: "Custom threshold-based alert rules and a persistent incident log",              color: C.amber },
    { label: "Governance",         desc: "Cluster health scores (0–100) and leaderboards promote operational excellence", color: "8B5CF6" },
  ];

  pillars.forEach((p, i) => {
    const x = 0.5 + i * 3.08;
    addCard(slide, x, 2.65, 2.85, 1.88, C.surfaceCard, C.zinc700);
    // Colour top strip
    slide.addShape(pptx.ShapeType.rect, {
      x, y: 2.65, w: 2.85, h: 0.06,
      fill: { color: p.color },
      line: { color: p.color, width: 0 },
    });
    slide.addText(p.label, {
      x: x + 0.15, y: 2.78, w: 2.55, h: 0.35,
      fontSize: 12, bold: true, color: C.textPrimary,
      fontFace: "Calibri",
    });
    slide.addText(p.desc, {
      x: x + 0.15, y: 3.17, w: 2.55, h: 1.2,
      fontSize: 9.5, color: C.textSecondary,
      fontFace: "Calibri",
    });
  });

  addFooter(slide, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 4 — PROJECT OBJECTIVES
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Project Objectives");
  addSubtitle(slide, "Six core engineering goals delivered this semester");
  addDivider(slide, 1.3);

  const objectives = [
    { num: "01", text: "Connect one or more Kubernetes clusters via kubeconfig upload and stream live resource state to the web dashboard." },
    { num: "02", text: "Provide an interactive visual topology canvas showing nodes, workloads, pods, services, and their relationships." },
    { num: "03", text: "Enable real-time resource inspection — pod logs, resource usage, restart counts — without any local CLI tooling." },
    { num: "04", text: "Allow teams to define custom metric-based alert rules (CPU, memory, pod crash) with configurable thresholds and severities." },
    { num: "05", text: "Persist incident events with lifecycle management (Triggered → Resolved) and a filterable history log." },
    { num: "06", text: "Generate per-cluster health scores (0–100) and display governance leaderboards to encourage operational excellence." },
  ];

  objectives.forEach((obj, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 6.3;
    const y = 1.52 + row * 1.6;
    addCard(slide, x, y, 6.0, 1.4, C.surfaceCard, C.zinc800);

    // Number
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.15, y: y + 0.18, w: 0.45, h: 0.45,
      fill: { color: C.blueGlow },
      line: { color: C.blue, width: 0.75 },
      rectRadius: 0.05,
    });
    slide.addText(obj.num, {
      x: x + 0.15, y: y + 0.18, w: 0.45, h: 0.45,
      fontSize: 10, bold: true, color: C.blue,
      fontFace: "Calibri", align: "center", valign: "middle",
    });

    slide.addText(obj.text, {
      x: x + 0.73, y: y + 0.12, w: 5.1, h: 1.16,
      fontSize: 10, color: C.textSecondary,
      fontFace: "Calibri", valign: "top",
    });
  });

  addFooter(slide, 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 5 — SYSTEM OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "System Architecture Overview");
  addSubtitle(slide, "Three-service architecture — Browser · REST API · Go Streaming Gateway");
  addDivider(slide, 1.3);

  // ── Layer labels on left ──
  const layers = [
    { label: "Client Layer",    y: 1.72 },
    { label: "API Layer",       y: 3.22 },
    { label: "Streaming Layer", y: 4.52 },
  ];
  layers.forEach((l) => {
    slide.addText(l.label, {
      x: 0.1, y: l.y, w: 1.15, h: 0.3,
      fontSize: 7.5, color: C.textMuted,
      fontFace: "Calibri", align: "right",
    });
  });

  // ── Row 1: Browser ──
  addBox(slide, 1.45, 1.6, 3.0, 1.0, "React Web App", "Vite + TypeScript + Tailwind", C.surfaceMid, C.blue, C.textPrimary, C.textSecondary, 11);
  addBox(slide, 5.3,  1.6, 2.2, 1.0, "Zustand Store", "Topology State", C.surfaceMid, C.zinc700, C.textPrimary, C.textSecondary, 10);
  addBox(slide, 8.4,  1.6, 2.4, 1.0, "React Flow Canvas", "Visual Topology", C.surfaceMid, C.zinc700, C.textPrimary, C.textSecondary, 10);

  // Row1 arrows
  addArrow(slide, 4.5,  1.98, C.zinc600);
  addArrow(slide, 7.65, 1.98, C.zinc600);

  // ── Row 2: API Server ──
  addBox(slide, 1.45, 3.12, 3.0, 1.0, "REST API Server", "Node.js · Express · JWT/RBAC", C.surfaceMid, C.zinc700, C.textPrimary, C.textSecondary, 11);
  addBox(slide, 5.3,  3.12, 2.2, 1.0, "PostgreSQL", "Drizzle ORM", C.surfaceMid, C.zinc700, C.textPrimary, C.textSecondary, 10);
  addBox(slide, 8.4,  3.12, 2.4, 1.0, "AES-256 Vault", "Kubeconfig Storage", C.surfaceMid, C.zinc700, C.textPrimary, C.textSecondary, 10);

  addArrow(slide, 4.5,  3.5,  C.zinc600);
  addArrow(slide, 7.65, 3.5,  C.zinc600);

  // ── Row 3: Streamer ──
  addBox(slide, 1.45, 4.45, 3.0, 1.0, "Go K8s Streamer", "client-go Informers · WebSocket Hub", C.surfaceMid, C.emerHalf, C.textPrimary, C.textSecondary, 11);
  addBox(slide, 5.3,  4.45, 2.2, 1.0, "Redis Pub/Sub", "Multi-instance sync", C.surfaceMid, C.zinc700, C.textPrimary, C.textSecondary, 10);
  addBox(slide, 8.4,  4.45, 2.4, 1.0, "K8s Cluster", "Pods · Nodes · Services", C.surfaceMid, C.zinc700, C.textPrimary, C.textSecondary, 10);

  addArrow(slide, 4.5,  4.83, C.zinc600);
  addArrow(slide, 7.65, 4.83, C.zinc600);

  // Vertical connectors between rows
  const vx = 2.88;
  [[2.62, 3.1], [4.12, 4.43], [3.12, 4.43]].forEach(([y1, y2]) => {
    slide.addShape(pptx.ShapeType.line, {
      x: vx, y: y1, w: 0, h: y2 - y1,
      line: { color: C.zinc600, width: 0.75, dashType: "dash" },
    });
  });

  // WebSocket label
  slide.addText("WebSocket (ws://8080)", {
    x: 0.5, y: 2.68, w: 2.2, h: 0.22,
    fontSize: 7.5, color: C.emerald,
    fontFace: "Calibri", align: "center",
  });
  slide.addText("REST (http://3000)", {
    x: 0.5, y: 3.9, w: 2.2, h: 0.22,
    fontSize: 7.5, color: C.textMuted,
    fontFace: "Calibri", align: "center",
  });

  addFooter(slide, 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 6 — CORE FEATURES
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Core Features");
  addSubtitle(slide, "Capabilities delivered in the EnvScale web application");
  addDivider(slide, 1.3);

  const features = [
    { label: "Visual Cluster Topology",    color: C.blue,    desc: "React Flow canvas — pods, nodes,\nservices, workloads in live graph" },
    { label: "Resource Inspection",        color: C.emerald, desc: "Click any node → slide-out drawer\nwith status, restarts, IP, CPU/mem" },
    { label: "Live Log Streaming",         color: C.emerald, desc: "kubectl logs -f in-browser\nwith level filters and search" },
    { label: "Custom Alert Rules",         color: C.amber,   desc: "Threshold-based CPU / Memory /\nPod Crash alert policies" },
    { label: "Incident History",           color: C.amber,   desc: "Triggered → Resolved lifecycle\nwith severity and status filters" },
    { label: "Health Scores & Leaderboard",color: "8B5CF6",  desc: "0–100 cluster health index\nwith team governance rankings" },
  ];

  features.forEach((f, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.5 + col * 4.2;
    const y = 1.52 + row * 2.4;
    addCard(slide, x, y, 3.9, 2.15, C.surfaceCard, C.zinc800);

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: 3.9, h: 0.07,
      fill: { color: f.color },
      line: { color: f.color, width: 0 },
    });

    slide.addText(f.label, {
      x: x + 0.18, y: y + 0.22, w: 3.54, h: 0.38,
      fontSize: 12, bold: true, color: C.textPrimary,
      fontFace: "Calibri",
    });
    slide.addText(f.desc, {
      x: x + 0.18, y: y + 0.65, w: 3.54, h: 1.35,
      fontSize: 10, color: C.textSecondary,
      fontFace: "Calibri",
    });
  });

  addFooter(slide, 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 7 — CLUSTER ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Cluster Onboarding Wizard");
  addSubtitle(slide, "ISH-01 · Step-by-step guided cluster connection — no CLI required");
  addDivider(slide, 1.3);

  // 3-step flow
  const steps = [
    { num: "1", title: "Name Your Cluster",  items: ["Enter a display name for\nthe cluster", "Required field validation\nprevents empty submission"] },
    { num: "2", title: "Upload Kubeconfig",  items: ["Drag-and-drop or browse\nfor YAML kubeconfig file", "Only .yaml / .yml accepted\nInvalid files are rejected"] },
    { num: "3", title: "Confirm & Connect",  items: ["Registers with Go streamer\nPOST /api/v1/clusters/register", "Cluster added to the\ntopology canvas selector"] },
  ];

  steps.forEach((step, i) => {
    const x = 0.5 + i * 3.95;
    addCard(slide, x, 1.55, 3.7, 2.85, C.surfaceMid, C.zinc700);

    // Step circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 1.45, y: 1.68, w: 0.8, h: 0.8,
      fill: { color: C.blueGlow },
      line: { color: C.blue, width: 1.5 },
    });
    slide.addText(step.num, {
      x: x + 1.45, y: 1.68, w: 0.8, h: 0.8,
      fontSize: 18, bold: true, color: C.blue,
      fontFace: "Calibri", align: "center", valign: "middle",
    });

    slide.addText(step.title, {
      x: x + 0.18, y: 2.58, w: 3.34, h: 0.36,
      fontSize: 12, bold: true, color: C.textPrimary,
      fontFace: "Calibri", align: "center",
    });

    step.items.forEach((item, j) => {
      addDot(slide, x + 0.28, 3.0 + j * 0.52 + 0.08, C.blue, 0.09);
      slide.addText(item, {
        x: x + 0.45, y: 3.0 + j * 0.52, w: 3.0, h: 0.46,
        fontSize: 9.5, color: C.textSecondary,
        fontFace: "Calibri",
      });
    });
  });

  // Arrows between steps
  addArrow(slide, 4.25, 2.9, C.blue);
  addArrow(slide, 8.2,  2.9, C.blue);

  // QA evidence box
  addCard(slide, 0.5, 4.62, W - 1, 0.6, C.surfaceCard, C.zinc800);
  addBadge(slide, 0.65, 4.75, 1.1, 0.3, C.emerald, "QA VERIFIED", C.white, 8);
  slide.addText("10 / 10 black-box test cases PASS  ·  Wizard, validation, file upload all verified  ·  docs/qa/ISH-05-QA-Test-Matrix.md", {
    x: 1.9, y: 4.75, w: W - 2.5, h: 0.3,
    fontSize: 8.5, color: C.textSecondary,
    fontFace: "Calibri",
  });

  addFooter(slide, 7);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 8 — KUBERNETES VISUALIZATION
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Kubernetes Visual Topology");
  addSubtitle(slide, "NEH · ArgoCD-style nested hybrid graph — nodes, workloads, pods, services, ingresses");
  addDivider(slide, 1.3);

  // Left panel — node types list
  addCard(slide, 0.5, 1.5, 3.8, 4.6, C.surfaceCard, C.zinc800);
  slide.addText("Canvas Node Types", {
    x: 0.68, y: 1.6, w: 3.44, h: 0.32,
    fontSize: 11, bold: true, color: C.textPrimary,
    fontFace: "Calibri",
  });

  const nodeTypes = [
    { name: "K8sGroup",    desc: "Namespace / topology container",     color: C.zinc600 },
    { name: "K8sNode",     desc: "Physical/virtual worker node",       color: C.blue },
    { name: "K8sWorkload", desc: "Deployment · ReplicaSet · StatefulSet", color: "8B5CF6" },
    { name: "K8sPod",      desc: "Running workload unit, status badge", color: C.emerald },
    { name: "K8sService",  desc: "ClusterIP · LoadBalancer endpoint",  color: C.amber },
    { name: "K8sIngress",  desc: "HTTP routing / external traffic",    color: C.red },
  ];
  nodeTypes.forEach((n, i) => {
    const y = 2.08 + i * 0.66;
    addDot(slide, 0.7, y + 0.12, n.color, 0.12);
    slide.addText(n.name, {
      x: 0.98, y, w: 3.1, h: 0.28,
      fontSize: 10, bold: true, color: C.textPrimary,
      fontFace: "Calibri",
    });
    slide.addText(n.desc, {
      x: 0.98, y: y + 0.27, w: 3.1, h: 0.3,
      fontSize: 8.5, color: C.textSecondary,
      fontFace: "Calibri",
    });
  });

  // Right panel — topology diagram (shapes)
  addCard(slide, 4.55, 1.5, 8.3, 4.6, C.canvasBg, C.zinc700);

  // Cluster group outer box
  addCard(slide, 4.75, 1.7, 7.9, 4.1, C.surfaceMid, C.zinc700);
  slide.addText("default  (namespace)", {
    x: 4.9, y: 1.72, w: 4, h: 0.25,
    fontSize: 7.5, bold: true, color: C.zinc300,
    fontFace: "Calibri",
  });

  // Worker node box
  addCard(slide, 4.9, 2.05, 2.5, 1.1, C.surfaceCard, C.blue);
  slide.addText("minikube-worker", {
    x: 4.92, y: 2.08, w: 2.46, h: 0.25,
    fontSize: 8.5, bold: true, color: C.textPrimary,
    fontFace: "Calibri", align: "center",
  });
  slide.addText("CPU 42%  ·  Mem 68%", {
    x: 4.92, y: 2.33, w: 2.46, h: 0.22,
    fontSize: 7.5, color: C.textSecondary,
    fontFace: "Calibri", align: "center",
  });
  addDot(slide, 5.07, 2.62, C.emerald, 0.1);
  slide.addText("Ready", { x: 5.22, y: 2.58, w: 1.5, h: 0.2, fontSize: 7.5, color: C.emerald, fontFace: "Calibri" });

  // Deployment workload
  addCard(slide, 7.75, 2.05, 2.3, 0.65, C.surfaceCard, "8B5CF6");
  slide.addText("nginx-deploy  (Deployment)", {
    x: 7.78, y: 2.08, w: 2.24, h: 0.24,
    fontSize: 8, bold: true, color: C.textPrimary,
    fontFace: "Calibri", align: "center",
  });
  slide.addText("3 / 3 replicas ready", {
    x: 7.78, y: 2.32, w: 2.24, h: 0.2,
    fontSize: 7.5, color: C.textSecondary,
    fontFace: "Calibri", align: "center",
  });

  // Pods
  const pods = [
    { name: "nginx-7d4b  ", status: "Running",          statusColor: C.emerald, y: 3.05 },
    { name: "api-pod-2c3a",  status: "CrashLoopBackOff", statusColor: C.red,     y: 3.55 },
    { name: "worker-9f1e  ", status: "Pending",          statusColor: C.amber,   y: 4.05 },
  ];
  pods.forEach((p) => {
    addCard(slide, 7.75, p.y, 2.3, 0.4, C.surfaceCard, C.zinc700);
    addDot(slide, 7.9, p.y + 0.15, p.statusColor, 0.1);
    slide.addText(p.name, { x: 8.05, y: p.y + 0.08, w: 1.4, h: 0.24, fontSize: 8, color: C.textPrimary, fontFace: "Calibri" });
    slide.addText(p.status, { x: 8.05, y: p.y + 0.22, w: 1.9, h: 0.18, fontSize: 7.5, color: p.statusColor, fontFace: "Calibri" });
  });

  // Service box
  addCard(slide, 11.05, 2.7, 1.9, 0.5, C.surfaceCard, C.amber);
  slide.addText("nginx-svc  :80", { x: 11.08, y: 2.73, w: 1.84, h: 0.44, fontSize: 8.5, bold: true, color: C.amber, fontFace: "Calibri", align: "center", valign: "middle" });

  // Arrows on diagram
  addArrow(slide, 7.45, 2.27, C.zinc600);      // node → workload
  addArrow(slide, 10.1, 2.27, C.zinc600);      // workload → service (approx)

  slide.addText("Conceptual diagram — actual topology populates from live cluster stream", {
    x: 4.55, y: 5.78, w: 8.3, h: 0.25,
    fontSize: 7.5, color: C.textMuted,
    fontFace: "Calibri", align: "center", italic: true,
  });

  addFooter(slide, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 9 — REAL-TIME MONITORING ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Real-Time Monitoring Architecture");
  addSubtitle(slide, "PRN · client-go Informers → WebSocket Hub → React store → Canvas");
  addDivider(slide, 1.3);

  // Pipeline flow boxes
  const pipeline = [
    { label: "Kubernetes\nAPI Server", sub: "k8s.io/api", color: C.blue },
    { label: "client-go\nInformer Factory", sub: "Pods · Nodes · Services\nDeployments · Ingresses", color: C.blue },
    { label: "DedupCache\n+ Parser", sub: "FNV hash dedup\nOOMKilled / CrashLoop detection", color: C.amber },
    { label: "WebSocket Hub\n(Gorilla)", sub: "ws://localhost:8080\nGo 1.24 server", color: C.emerald },
    { label: "useK8sStream\nhook", sub: "Exp backoff reconnect\nPing/pong latency", color: C.emerald },
    { label: "Zustand Store\n→ React Flow", sub: "Delta apply\nDagre layout", color: "8B5CF6" },
  ];

  pipeline.forEach((p, i) => {
    const x = 0.5 + i * 2.06;
    addCard(slide, x, 1.55, 1.85, 1.7, C.surfaceMid, midShade(p.color));
    slide.addShape(pptx.ShapeType.rect, { x, y: 1.55, w: 1.85, h: 0.06, fill: { color: p.color }, line: { color: p.color, width: 0 } });
    slide.addText(p.label, { x: x + 0.06, y: 1.66, w: 1.73, h: 0.55, fontSize: 9.5, bold: true, color: C.textPrimary, fontFace: "Calibri", align: "center" });
    slide.addText(p.sub, { x: x + 0.06, y: 2.24, w: 1.73, h: 0.9, fontSize: 8, color: C.textSecondary, fontFace: "Calibri", align: "center" });

    if (i < pipeline.length - 1) {
      addArrow(slide, x + 1.88, 2.25, C.zinc600);
    }
  });

  // Redis side note
  addCard(slide, 9.5, 1.55, 3.3, 1.7, C.surfaceCard, C.zinc700);
  slide.addText("Redis Pub/Sub", { x: 9.65, y: 1.65, w: 3.0, h: 0.3, fontSize: 10, bold: true, color: C.textPrimary, fontFace: "Calibri" });
  slide.addText("Synchronises topology state across\nmultiple streamer instances.\nFuture scope: horizontal scaling.", { x: 9.65, y: 2.0, w: 3.0, h: 0.95, fontSize: 9, color: C.textSecondary, fontFace: "Calibri" });
  addBadge(slide, 11.45, 1.65, 1.2, 0.28, C.zinc700, "FUTURE SCALE", C.textMuted, 7);

  // Event types
  addCard(slide, 0.5, 3.5, W - 1, 1.65, C.surfaceCard, C.zinc800);
  slide.addText("WebSocket Event Types (from apps/web/src/hooks/useK8sStream.ts)", {
    x: 0.65, y: 3.58, w: 12.03, h: 0.28,
    fontSize: 9.5, bold: true, color: C.textPrimary,
    fontFace: "Calibri",
  });

  const events = [
    "EVENT_TOPOLOGY_SNAPSHOT", "EVENT_POD_ADDED", "EVENT_POD_MODIFIED",
    "EVENT_POD_DELETED", "EVENT_POD_STATUS_CHANGED", "EVENT_NODE_MUTATED",
    "EVENT_SERVICE_ADDED", "EVENT_LOG_LINE", "EVENT_ALERT_TRIGGERED", "EVENT_HEARTBEAT",
  ];
  events.forEach((ev, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    addBadge(slide, 0.65 + col * 2.52, 3.94 + row * 0.54, 2.38, 0.36, C.surfaceMid, ev, C.textSecondary, 6.5);
  });

  addFooter(slide, 9);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 10 — HEALTH AND ALERTS
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Health Monitoring & Alerts");
  addSubtitle(slide, "VIN + NEH · Health score algorithm, custom alert rules, real-time anomaly detection");
  addDivider(slide, 1.3);

  // Left: Health score
  addCard(slide, 0.5, 1.5, 5.9, 4.62, C.surfaceCard, C.zinc800);
  slide.addText("Cluster Health Score  (0 – 100)", {
    x: 0.68, y: 1.6, w: 5.54, h: 0.32,
    fontSize: 12, bold: true, color: C.textPrimary,
    fontFace: "Calibri",
  });

  // Score gauge — visual ring (use shapes)
  const scoreColors = [
    { range: "90 – 100", label: "Healthy",  color: C.emerald },
    { range: "80 – 89",  label: "Warning",  color: C.amber },
    { range: "0 – 79",   label: "Critical", color: C.red },
  ];
  scoreColors.forEach((s, i) => {
    const y = 2.05 + i * 0.5;
    addCard(slide, 0.7, y, 5.5, 0.42, C.surfaceMid, C.zinc700);
    addDot(slide, 0.88, y + 0.16, s.color, 0.12);
    slide.addText(s.range, { x: 1.1, y: y + 0.1, w: 1.3, h: 0.25, fontSize: 10, bold: true, color: s.color, fontFace: "Calibri" });
    slide.addText(s.label, { x: 2.5, y: y + 0.1, w: 3.5, h: 0.25, fontSize: 10, color: C.textSecondary, fontFace: "Calibri" });
  });

  slide.addText("Algorithm  (apps/api-server/src/services/health-calculator.service.ts)", {
    x: 0.68, y: 3.6, w: 5.54, h: 0.26,
    fontSize: 8.5, color: C.textMuted, italic: true, fontFace: "Calibri",
  });

  const penalties = [
    { sev: "Critical incident",  pen: "−25 points" },
    { sev: "Error   incident",   pen: "−15 points" },
    { sev: "Warning incident",   pen: "−8 points"  },
    { sev: "Info    incident",   pen: "−3 points"  },
  ];
  penalties.forEach((p, i) => {
    const y = 3.9 + i * 0.48;
    slide.addText(p.sev, { x: 0.9, y, w: 3.2, h: 0.34, fontSize: 9.5, color: C.textSecondary, fontFace: "Calibri" });
    addBadge(slide, 4.2, y + 0.04, 1.8, 0.28, C.redDim, p.pen, C.red, 9);
  });

  // Right: Alert rules
  addCard(slide, 6.65, 1.5, 6.2, 4.62, C.surfaceCard, C.zinc800);
  slide.addText("Custom Alert Policies", {
    x: 6.83, y: 1.6, w: 5.84, h: 0.32,
    fontSize: 12, bold: true, color: C.textPrimary,
    fontFace: "Calibri",
  });

  const alertFields = [
    { field: "Metric Type",  values: "CPU Usage · Memory · Pod Crash Rate" },
    { field: "Condition",    values: "> · < · >= · <= threshold" },
    { field: "Threshold",    values: "User-defined numeric value" },
    { field: "Duration",     values: "Sustained breach window (seconds)" },
    { field: "Severity",     values: "CRITICAL · WARNING · INFO" },
    { field: "Enable/Disable",values:"Toggle rule without deleting it" },
  ];
  alertFields.forEach((a, i) => {
    const y = 2.05 + i * 0.62;
    addCard(slide, 6.83, y, 5.84, 0.52, C.surfaceMid, C.zinc700);
    slide.addText(a.field, { x: 7.0, y: y + 0.08, w: 2.1, h: 0.36, fontSize: 9.5, bold: true, color: C.textSecondary, fontFace: "Calibri" });
    slide.addText(a.values, { x: 9.15, y: y + 0.08, w: 3.4, h: 0.36, fontSize: 9.5, color: C.textPrimary, fontFace: "Calibri" });
  });

  slide.addText("Alert rules stored in PostgreSQL  ·  Full CRUD via REST API", {
    x: 6.83, y: 5.85, w: 5.84, h: 0.2,
    fontSize: 8, color: C.textMuted, italic: true, fontFace: "Calibri",
  });

  addFooter(slide, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 11 — INCIDENT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Incident Management");
  addSubtitle(slide, "ISH-03 · VIN · Persistent incident log, lifecycle tracking, severity classification");
  addDivider(slide, 1.3);

  // Lifecycle flow
  const lifecycle = [
    { label: "Alert Triggers",   sub: "Anomaly detected\nby streamer / alert rule", color: C.red },
    { label: "TRIGGERED",        sub: "Incident created\nin PostgreSQL",             color: C.red },
    { label: "ACKNOWLEDGED",     sub: "Team member\nmarks seen",                    color: C.amber },
    { label: "RESOLVED",         sub: "Issue fixed,\ntimestamp logged",             color: C.emerald },
  ];
  lifecycle.forEach((l, i) => {
    const x = 0.5 + i * 3.0;
    addCard(slide, x, 1.5, 2.7, 1.55, C.surfaceMid, midShade(l.color));
    slide.addText(l.label, { x: x + 0.12, y: 1.62, w: 2.46, h: 0.38, fontSize: 12, bold: true, color: l.color, fontFace: "Calibri", align: "center" });
    slide.addText(l.sub,   { x: x + 0.12, y: 2.05, w: 2.46, h: 0.72, fontSize: 9,  color: C.textSecondary, fontFace: "Calibri", align: "center" });
    if (i < lifecycle.length - 1) addArrow(slide, x + 2.73, 2.18, C.zinc600);
  });

  // Severity table header
  slide.addText("Severity Levels", {
    x: 0.5, y: 3.25, w: 5.5, h: 0.3,
    fontSize: 11, bold: true, color: C.textPrimary, fontFace: "Calibri",
  });

  const severities = [
    { level: "CRITICAL", desc: "OOMKilled · CrashLoopBackOff · ImagePullBackOff", color: C.red },
    { level: "WARNING",  desc: "High restart count · Resource pressure",           color: C.amber },
    { level: "INFO",     desc: "Pod status changes · Scheduled events",            color: C.blue },
  ];
  severities.forEach((s, i) => {
    const y = 3.62 + i * 0.62;
    addCard(slide, 0.5, y, 5.5, 0.52, C.surfaceCard, C.zinc800);
    addBadge(slide, 0.65, y + 0.12, 1.5, 0.28, tint(s.color), s.level, s.color, 8.5);
    slide.addText(s.desc, { x: 2.35, y: y + 0.1, w: 3.5, h: 0.34, fontSize: 9.5, color: C.textSecondary, fontFace: "Calibri" });
  });

  // Filter panel on right
  addCard(slide, 6.25, 3.25, 6.6, 2.87, C.surfaceCard, C.zinc800);
  slide.addText("Incident Log — Filter Controls", {
    x: 6.43, y: 3.35, w: 6.22, h: 0.3,
    fontSize: 11, bold: true, color: C.textPrimary, fontFace: "Calibri",
  });

  const filters = [
    { label: "Severity Filter",  options: "ALL · CRITICAL · WARNING · INFO" },
    { label: "Status Filter",    options: "ALL · TRIGGERED · RESOLVED" },
    { label: "Cluster Filter",   options: "ALL · (dynamic cluster list)" },
    { label: "Source",           options: "Kubernetes v1.Events + pod telemetry" },
  ];
  filters.forEach((f, i) => {
    const y = 3.78 + i * 0.54;
    slide.addText(f.label + ":", { x: 6.43, y, w: 2.4, h: 0.36, fontSize: 9.5, bold: true, color: C.textSecondary, fontFace: "Calibri" });
    slide.addText(f.options,     { x: 8.88, y, w: 3.8, h: 0.36, fontSize: 9.5, color: C.textPrimary, fontFace: "Calibri" });
  });

  slide.addText("Source: apps/web/src/components/views/IncidentsView.tsx  ·  apps/api-server/src/controllers/incident.controller.ts", {
    x: 0.5, y: 6.8, w: W - 1, h: 0.2,
    fontSize: 7.5, color: C.textMuted, italic: true, fontFace: "Calibri",
  });

  addFooter(slide, 11);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 12 — GAMIFICATION AND LEADERBOARDS
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Governance & Gamification");
  addSubtitle(slide, "VIN + NEH · Engineering teams rewarded for infrastructure stability and zero-downtime streaks");
  addDivider(slide, 1.3);

  // Left: concept
  addCard(slide, 0.5, 1.5, 5.7, 2.2, C.surfaceCard, C.zinc800);
  slide.addText("Why Gamify Operations?", {
    x: 0.7, y: 1.6, w: 5.3, h: 0.3,
    fontSize: 12, bold: true, color: C.textPrimary, fontFace: "Calibri",
  });
  const motivations = [
    "Transforms passive monitoring into active engineering ownership",
    "Health scores create shared team responsibility for cluster stability",
    "Streak tracking discourages reactive fire-fighting habits",
    "Public leaderboards encourage proactive incident resolution",
  ];
  motivations.forEach((m, i) => {
    addDot(slide, 0.7, 2.0 + i * 0.45 + 0.1, C.blue, 0.09);
    slide.addText(m, { x: 0.9, y: 2.0 + i * 0.45, w: 5.1, h: 0.38, fontSize: 9.5, color: C.textSecondary, fontFace: "Calibri" });
  });

  // Right: leaderboard mockup
  addCard(slide, 6.5, 1.5, 6.3, 4.6, C.surfaceCard, C.zinc800);
  slide.addText("Governance Leaderboard", {
    x: 6.68, y: 1.6, w: 5.94, h: 0.3,
    fontSize: 12, bold: true, color: C.textPrimary, fontFace: "Calibri",
  });

  const rows = [
    { rank: "🥇", cluster: "prod-us-east",  score: 97, status: "Healthy",  incidents: 0, statusColor: C.emerald },
    { rank: "🥈", cluster: "dev-k3s",       score: 89, status: "Warning",  incidents: 1, statusColor: C.amber },
    { rank: "🥉", cluster: "staging-minik", score: 76, status: "Critical", incidents: 3, statusColor: C.red },
  ];

  // table header
  addCard(slide, 6.65, 2.0, 5.97, 0.36, C.surfaceMid, C.zinc700);
  ["Rank", "Cluster", "Score", "Incidents", "Status"].forEach((h, j) => {
    slide.addText(h, { x: 6.65 + j * 1.2, y: 2.04, w: 1.15, h: 0.28, fontSize: 8.5, bold: true, color: C.textSecondary, fontFace: "Calibri", align: "center" });
  });

  rows.forEach((r, i) => {
    const y = 2.44 + i * 0.56;
    addCard(slide, 6.65, y, 5.97, 0.48, i % 2 === 0 ? C.surfaceCard : C.surfaceMid, C.zinc800);
    slide.addText(r.rank,            { x: 6.65,  y: y + 0.1, w: 1.15, h: 0.28, fontSize: 10, color: C.textPrimary,    fontFace: "Calibri", align: "center" });
    slide.addText(r.cluster,         { x: 7.85,  y: y + 0.1, w: 1.15, h: 0.28, fontSize: 9,  color: C.textPrimary,    fontFace: "Calibri", align: "center" });
    slide.addText(r.score.toString(),{ x: 9.05,  y: y + 0.1, w: 1.15, h: 0.28, fontSize: 10, bold: true, color: r.statusColor, fontFace: "Calibri", align: "center" });
    slide.addText(r.incidents.toString(),{ x:10.25, y:y+0.1,  w: 1.15, h: 0.28, fontSize: 10, color: r.incidents > 0 ? C.red : C.emerald, fontFace: "Calibri", align: "center" });
    addBadge(slide, 11.45, y + 0.1, 1.0, 0.28, tint(r.statusColor), r.status, r.statusColor, 8);
  });

  // Bottom note
  slide.addText("Note: Cluster names and scores shown are illustrative mockup values.\nActual data populated dynamically from connected cluster state.", {
    x: 6.65, y: 4.55, w: 5.97, h: 0.4,
    fontSize: 7.5, color: C.textMuted, italic: true, fontFace: "Calibri",
  });

  // Bottom left: implementation note
  addCard(slide, 0.5, 3.88, 5.7, 1.22, C.surfaceCard, C.zinc800);
  slide.addText("Implementation Status", { x: 0.68, y: 3.96, w: 5.3, h: 0.26, fontSize: 10, bold: true, color: C.textPrimary, fontFace: "Calibri" });
  addBadge(slide, 0.68, 4.26, 2.4, 0.26, C.emerTint, "IMPLEMENTED: Leaderboard UI + Backend Queries", C.emerald, 7.5);
  addBadge(slide, 0.68, 4.58, 2.4, 0.26, C.amberTint, "PARTIAL: Frontend uses in-memory store data",   C.amber,   7.5);

  addFooter(slide, 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 13 — TECHNOLOGY STACK
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Technology Stack");
  addSubtitle(slide, "Verified from actual repository files — all technologies listed are confirmed present");
  addDivider(slide, 1.3);

  const columns = [
    {
      header: "Frontend",
      headerColor: C.blue,
      x: 0.5,
      techs: [
        { name: "React 18",          note: "Component UI framework" },
        { name: "Vite",              note: "Build tool, dev server" },
        { name: "TypeScript",        note: "End-to-end type safety" },
        { name: "Tailwind CSS",      note: "Utility-first styling" },
        { name: "React Flow",        note: "@xyflow/react — topology canvas" },
        { name: "Zustand",           note: "State management" },
        { name: "class-variance-authority", note: "Component variants" },
        { name: "Material Design Icons",    note: "@mdi/react icon system" },
      ],
    },
    {
      header: "Backend API",
      headerColor: C.emerald,
      x: 4.65,
      techs: [
        { name: "Node.js",           note: "Runtime v18+" },
        { name: "Express 5",         note: "HTTP server framework" },
        { name: "PostgreSQL",        note: "Primary database" },
        { name: "Drizzle ORM",       note: "Type-safe DB queries" },
        { name: "JWT + bcrypt",      note: "Auth & password hashing" },
        { name: "Zod",               note: "Request validation" },
        { name: "express-rate-limit",note: "100 req/min IP limiter" },
        { name: "AES-256-GCM",       note: "Kubeconfig encryption" },
      ],
    },
    {
      header: "Streaming Engine",
      headerColor: C.amber,
      x: 8.8,
      techs: [
        { name: "Go 1.24",           note: "Streaming gateway language" },
        { name: "k8s.io/client-go",  note: "Kubernetes Informers v0.30.2" },
        { name: "Gorilla WebSocket", note: "ws://localhost:8080 hub" },
        { name: "Redis (go-redis v9)", note: "Pub/Sub adapter" },
        { name: "k8s.io/metrics",    note: "Metrics API client" },
        { name: "pnpm + Turborepo",  note: "Monorepo build tooling" },
        { name: "Docker Compose",    note: "Local dev orchestration" },
        { name: "GitHub Actions",    note: "CI pipeline (.github/workflows)" },
      ],
    },
  ];

  columns.forEach((col) => {
    addCard(slide, col.x, 1.45, 4.0, 4.7, C.surfaceCard, C.zinc800);
    slide.addShape(pptx.ShapeType.rect, { x: col.x, y: 1.45, w: 4.0, h: 0.07, fill: { color: col.headerColor }, line: { color: col.headerColor, width: 0 } });
    slide.addText(col.header, {
      x: col.x + 0.15, y: 1.55, w: 3.7, h: 0.32,
      fontSize: 11, bold: true, color: C.textPrimary, fontFace: "Calibri",
    });

    col.techs.forEach((t, i) => {
      const ty = 1.96 + i * 0.49;
      addDot(slide, col.x + 0.18, ty + 0.09, col.headerColor, 0.08);
      slide.addText(t.name, { x: col.x + 0.35, y: ty, w: 3.4, h: 0.24, fontSize: 9.5, bold: true, color: C.textPrimary, fontFace: "Calibri" });
      slide.addText(t.note, { x: col.x + 0.35, y: ty + 0.22, w: 3.4, h: 0.22, fontSize: 8, color: C.textSecondary, fontFace: "Calibri" });
    });
  });

  addFooter(slide, 13);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 14 — TEAM CONTRIBUTIONS
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide);
  addTitle(slide, "Team Contributions");
  addSubtitle(slide, "Clear module ownership — each member led a distinct engineering domain");
  addDivider(slide, 1.3);

  const members = [
    {
      name: "Pranav",
      role: "Core Infrastructure",
      color: C.blue,
      prefix: "PRN-*",
      items: [
        "Go Kubernetes Streamer (k8s-streamer)",
        "client-go SharedInformerFactory — Pods, Nodes, Services, Deployments, Ingresses",
        "WebSocket Hub (Gorilla) — real-time event broadcast",
        "Log anomaly parser — OOMKilled, CrashLoopBackOff detection",
        "Redis Pub/Sub adapter for multi-instance state sync",
        "Chaos Engine — crash, OOM, network fault injection",
        "Monorepo architecture (pnpm + Turborepo)",
      ],
    },
    {
      name: "Vinit",
      role: "Backend API & Database",
      color: C.emerald,
      prefix: "VIN-*",
      items: [
        "Express 5 REST API server (apps/api-server)",
        "Drizzle ORM schema — users, clusters, incidents, alerts, health snapshots",
        "JWT auth + bcrypt + HTTP-only refresh cookie",
        "RBAC middleware — ADMIN / MEMBER / VIEWER roles",
        "AES-256-GCM kubeconfig encryption vault",
        "Cluster health score algorithm (0–100, severity penalties)",
        "Leaderboard DB queries + health history API",
        "5 SQL migration files, seed data, rate limiting",
      ],
    },
    {
      name: "Neha",
      role: "Frontend Visualization",
      color: C.amber,
      prefix: "NEH-*",
      items: [
        "React Flow topology canvas (TopologyCanvas.tsx)",
        "6 custom K8s node types: Pod, WorkerNode, Service, Workload, Group, Ingress",
        "Dagre auto-layout engine (LR direction)",
        "Zustand topology store — delta apply, undo/redo, history",
        "useK8sStream WebSocket hook with exponential backoff",
        "Inspector Drawer — pod/node/service inspection tabs",
        "Alert Rule Builder UI and Leaderboard view",
      ],
    },
    {
      name: "Ishika",
      role: "Documentation & QA",
      color: "8B5CF6",
      prefix: "ISH-*",
      items: [
        "Connect Cluster onboarding wizard (3-step, Dropzone, validation)",
        "Reusable UI library — Button, Badge, Card, Modal, Toast, EmptyState",
        "Global Error Boundary with retry (React class component)",
        "Empty state components used across topology, incidents, alerts",
        "Black-box QA test matrix — 10 test cases, all PASS",
        "IEEE Software Requirements Specification (docs/EnvScale-SRS.md)",
        "Project Final Report + this defense presentation",
      ],
    },
  ];

  members.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 6.3;
    const y = 1.45 + row * 2.65;
    addCard(slide, x, y, 6.05, 2.45, C.surfaceCard, C.zinc800);
    slide.addShape(pptx.ShapeType.rect, { x, y, w: 6.05, h: 0.07, fill: { color: m.color }, line: { color: m.color, width: 0 } });

    // Name + role
    slide.addText(m.name, { x: x + 0.15, y: y + 0.14, w: 2.5, h: 0.32, fontSize: 13, bold: true, color: C.textPrimary, fontFace: "Calibri" });
    addBadge(slide, x + 2.7, y + 0.17, 1.1, 0.26, tint(m.color), m.prefix, m.color, 8);
    slide.addText(m.role, { x: x + 0.15, y: y + 0.46, w: 5.7, h: 0.22, fontSize: 9, color: C.textSecondary, fontFace: "Calibri" });

    m.items.slice(0, 5).forEach((item, j) => {
      addDot(slide, x + 0.2, y + 0.78 + j * 0.33 + 0.1, m.color, 0.08);
      slide.addText(item, { x: x + 0.38, y: y + 0.78 + j * 0.33, w: 5.5, h: 0.3, fontSize: 8.5, color: C.textSecondary, fontFace: "Calibri" });
    });
    if (m.items.length > 5) {
      slide.addText(`+${m.items.length - 5} more tasks completed`, { x: x + 0.38, y: y + 0.78 + 5 * 0.33, w: 5.5, h: 0.28, fontSize: 8, color: C.textMuted, fontFace: "Calibri", italic: true });
    }
  });

  addFooter(slide, 14);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 15 — CONCLUSION & FUTURE SCOPE
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = pptx.addSlide();
  addBg(slide);
  addTopBar(slide, C.blue);

  addTitle(slide, "Conclusion & Future Scope", 0.38, C.textPrimary, 26);
  addSubtitle(slide, "What we built this semester — and where EnvScale can go next", 0.9);
  addDivider(slide, 1.25);

  // What we built
  addCard(slide, 0.5, 1.38, 5.8, 4.1, C.surfaceCard, C.zinc800);
  slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.38, w: 5.8, h: 0.06, fill: { color: C.emerald }, line: { color: C.emerald, width: 0 } });
  slide.addText("What We Built This Semester", { x: 0.68, y: 1.5, w: 5.44, h: 0.3, fontSize: 11, bold: true, color: C.textPrimary, fontFace: "Calibri" });

  const built = [
    "Go WebSocket streaming gateway with client-go Informers",
    "Full REST API with JWT/RBAC and PostgreSQL schema",
    "React Flow topology canvas with 6 custom K8s node types",
    "Inspector drawer, live log streaming, kubectl web terminal",
    "Custom alert rule builder and persistent incident log",
    "Cluster health score algorithm (0–100) and leaderboard",
    "Connect Cluster onboarding wizard and reusable UI library",
    "IEEE SRS documentation, QA matrix, and design system",
  ];
  built.forEach((b, i) => {
    addDot(slide, 0.68, 1.92 + i * 0.41 + 0.12, C.emerald, 0.09);
    slide.addText(b, { x: 0.86, y: 1.92 + i * 0.41, w: 5.24, h: 0.36, fontSize: 9.5, color: C.textSecondary, fontFace: "Calibri" });
  });

  // Future scope
  addCard(slide, 6.55, 1.38, 6.28, 4.1, C.surfaceCard, C.zinc800);
  slide.addShape(pptx.ShapeType.rect, { x: 6.55, y: 1.38, w: 6.28, h: 0.06, fill: { color: C.blue }, line: { color: C.blue, width: 0 } });
  slide.addText("Future Scope", { x: 6.73, y: 1.5, w: 5.94, h: 0.3, fontSize: 11, bold: true, color: C.textPrimary, fontFace: "Calibri" });

  const future = [
    "Full end-to-end session auth flow across all web views",
    "Leaderboard driven by live API queries (not store cache)",
    "AWS EKS cluster support and Helm chart deployment",
    "Multi-tenant workspace with live RBAC management UI",
    "k6 load tests — P95 latency benchmarking at 1000 req/s",
    "Cross-browser visual QA and mobile responsive audit",
    "Product demo video scripting and screen recording",
    "Horizontal scaling with Redis-backed multi-streamer mesh",
  ];
  future.forEach((f, i) => {
    addDot(slide, 6.73, 1.92 + i * 0.41 + 0.12, C.blue, 0.09);
    slide.addText(f, { x: 6.91, y: 1.92 + i * 0.41, w: 5.74, h: 0.36, fontSize: 9.5, color: C.textSecondary, fontFace: "Calibri" });
  });

  // Thank you banner
  addCard(slide, 0.5, 5.7, W - 1, 1.4, C.blueGlow, C.blue);
  slide.addText("Thank You", {
    x: 0.5, y: 5.8, w: W - 1, h: 0.56,
    fontSize: 28, bold: true, color: C.textPrimary,
    fontFace: "Calibri", align: "center",
  });
  slide.addText("Questions?  ·  EnvScale  ·  Semester 5 Engineering Project  ·  2026", {
    x: 0.5, y: 6.36, w: W - 1, h: 0.26,
    fontSize: 10, color: C.textSecondary,
    fontFace: "Calibri", align: "center",
  });

  addFooter(slide, 15);
}

// ─── Save ─────────────────────────────────────────────────────────────────────
console.log(`\n[ISH-08] Generating presentation…`);
console.log(`[ISH-08] Output: ${OUTPUT_FILE}.pptx\n`);

try {
  await pptx.writeFile({ fileName: OUTPUT_FILE });
  console.log("[ISH-08] ✓ Presentation generated successfully.");
  console.log(`[ISH-08] File: ${OUTPUT_FILE}.pptx`);
  console.log(`[ISH-08] Slides: 15`);
} catch (err) {
  console.error("[ISH-08] ✗ Generation failed:", err);
  process.exit(1);
}
