/**
 * ISH-09: EnvScale Automated Screenshot Capture
 *
 * Captures 10 demo-quality screenshots of the running EnvScale web app
 * using system Chrome (no Playwright browser download needed).
 *
 * Prerequisites:
 *   - Vite dev server running at http://localhost:5173  (pnpm dev from apps/web)
 *
 * Run: node capture-screenshots.mjs
 * Output: docs/demo/screenshots/
 */

import { chromium } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "demo", "screenshots");
const APP_URL = "http://localhost:5173";

// System Chrome path on Windows
const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/** Wait for a CSS selector to be visible */
async function waitFor(page, selector, timeout = 8000) {
  try {
    await page.waitForSelector(selector, { state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/** Take a labelled screenshot with console confirmation */
async function shot(page, filename, label) {
  const dest = join(OUTPUT_DIR, filename);
  await page.screenshot({ path: dest, fullPage: false });
  console.log(`  ✓ ${label.padEnd(50)} → screenshots/${filename}`);
}

/** Sleep helper */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Main ────────────────────────────────────────────────────────────────────
console.log("\n[ISH-09] EnvScale Screenshot Capture");
console.log(`[ISH-09] App URL  : ${APP_URL}`);
console.log(`[ISH-09] Output   : ${OUTPUT_DIR}`);
console.log(`[ISH-09] Chrome   : ${CHROME_PATH}\n`);

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--hide-scrollbars",
    "--disable-gpu",
  ],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  locale: "en-US",
  timezoneId: "Asia/Kolkata",
});

// Suppress console noise from the app
context.on("console", () => {});
context.on("pageerror", () => {});

const page = await context.newPage();

// ─── Navigate & wait for app shell ──────────────────────────────────────────
console.log("[ISH-09] Navigating to app...");
try {
  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 20000 });
} catch {
  console.error(
    `[ISH-09] ✗ Could not connect to ${APP_URL}. Is the Vite dev server running?`
  );
  console.error(
    "[ISH-09]   Run:  cd apps/web && pnpm dev   then re-run this script."
  );
  await browser.close();
  process.exit(1);
}

// Wait for the main app shell to render (navbar + sidebar)
const shellReady = await waitFor(page, "nav, [class*='navbar'], [class*='sidebar'], .bg-\\[\\#09090b\\]", 10000);
if (!shellReady) {
  // Try a more lenient check — just wait for body to have content
  await sleep(3000);
}

console.log("[ISH-09] App shell ready. Capturing screenshots...\n");

// ─── SCREENSHOT 1: Full app shell — topology empty state ────────────────────
await sleep(1500); // Let React Flow & fonts settle
await shot(page, "01-app-shell-topology-empty.png", "App shell — topology empty state");

// ─── SCREENSHOT 2: TopNavbar close-up (crop via clip) ────────────────────────
await page.screenshot({
  path: join(OUTPUT_DIR, "02-topnavbar-cluster-selector.png"),
  clip: { x: 0, y: 0, width: 1920, height: 56 },
});
console.log(`  ✓ ${"TopNavbar — cluster selector strip".padEnd(50)} → screenshots/02-topnavbar-cluster-selector.png`);

// ─── SCREENSHOT 3: Open cluster dropdown ─────────────────────────────────────
// Click the cluster selector pill in the navbar center
const clusterPillSelectors = [
  'button:has-text("mini-todo")',
  '[data-testid="cluster-selector"]',
  'button:has-text("▾")',
  'button[class*="cluster"]',
];
let dropdownOpened = false;
for (const sel of clusterPillSelectors) {
  try {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      await sleep(600);
      dropdownOpened = true;
      break;
    }
  } catch { /* try next */ }
}
if (!dropdownOpened) {
  // Fallback: click center of navbar where the cluster pill should be
  await page.mouse.click(960, 28);
  await sleep(600);
}
await shot(page, "03-cluster-dropdown-open.png", "Cluster selector dropdown");

// Close dropdown by pressing Escape
await page.keyboard.press("Escape");
await sleep(400);

// ─── SCREENSHOT 4: Connect Cluster Wizard — Step 1 ──────────────────────────
// Try to open it: look for "Connect New Cluster" text in page
// Re-open dropdown first
for (const sel of clusterPillSelectors) {
  try {
    const el = await page.$(sel);
    if (el) { await el.click(); await sleep(500); break; }
  } catch { /* */ }
}
// fallback
await page.mouse.click(960, 28);
await sleep(500);

const connectBtn = await page.$('button:has-text("Connect New Cluster"), button:has-text("Connect")');
if (connectBtn) {
  await connectBtn.click();
  await sleep(800);
  await waitFor(page, '[class*="wizard"], [class*="modal"], form, input[placeholder*="cluster"], input[placeholder*="Cluster"]', 5000);
  await sleep(500);
  await shot(page, "04-connect-cluster-wizard-step1.png", "Connect Cluster Wizard — Step 1");

  // Fill in cluster name and advance to step 2
  const nameInput = await page.$('input[placeholder*="cluster"], input[placeholder*="Cluster"], input[type="text"]');
  if (nameInput) {
    await nameInput.fill("production-demo");
    await sleep(300);

    // Click Next button
    const nextBtn = await page.$('button:has-text("Next"), button:has-text("Continue"), button[type="submit"]');
    if (nextBtn) {
      await nextBtn.click();
      await sleep(700);
      await shot(page, "05-connect-cluster-wizard-step2-dropzone.png", "Connect Cluster Wizard — Step 2 (kubeconfig dropzone)");
    }
  }

  // Close wizard
  const closeBtn = await page.$('button[aria-label*="close"], button[aria-label*="Close"], button:has-text("×"), button:has-text("✕"), button:has-text("Cancel"), [class*="close"]');
  if (closeBtn) {
    await closeBtn.click();
    await sleep(500);
  } else {
    await page.keyboard.press("Escape");
    await sleep(500);
  }
} else {
  await page.keyboard.press("Escape");
  await sleep(300);
  console.log("  ⚠  Could not open Connect Cluster Wizard — skipping shots 04–05");
}

// ─── SCREENSHOT 6: LeftSidebar close-up ─────────────────────────────────────
await page.screenshot({
  path: join(OUTPUT_DIR, "06-left-sidebar.png"),
  clip: { x: 0, y: 0, width: 80, height: 1080 },
});
console.log(`  ✓ ${"LeftSidebar — navigation capsule".padEnd(50)} → screenshots/06-left-sidebar.png`);

// ─── SCREENSHOT 7: Incidents View — empty state ──────────────────────────────
// Navigate to incidents tab — find the sidebar icon
const sidebarIcons = await page.$$('nav button, aside button, [class*="sidebar"] button');
let incidentsClicked = false;
for (const icon of sidebarIcons) {
  const title = await icon.getAttribute("title") || "";
  const ariaLabel = await icon.getAttribute("aria-label") || "";
  const text = await icon.textContent() || "";
  if (/incident|alert/i.test(title + ariaLabel + text)) {
    await icon.click();
    await sleep(800);
    incidentsClicked = true;
    break;
  }
}
if (!incidentsClicked) {
  // Fallback: click 2nd sidebar icon (position ~16, ~230 based on design spec)
  await page.mouse.click(28, 230);
  await sleep(800);
}
await shot(page, "07-incidents-view-empty.png", "IncidentsView — empty state");

// Click Alert Rules sub-tab
const alertRulesTab = await page.$('button:has-text("Alert Rules"), [role="tab"]:has-text("Alert Rules")');
if (alertRulesTab) {
  await alertRulesTab.click();
  await sleep(500);
  await shot(page, "08-incidents-alert-rules-tab.png", "IncidentsView — Alert Rules sub-tab");
}

// ─── SCREENSHOT 9: Metrics View ──────────────────────────────────────────────
for (const icon of await page.$$('nav button, aside button, [class*="sidebar"] button')) {
  const title = await icon.getAttribute("title") || "";
  const ariaLabel = await icon.getAttribute("aria-label") || "";
  const text = await icon.textContent() || "";
  if (/metric|chart|monitor/i.test(title + ariaLabel + text)) {
    await icon.click();
    await sleep(1200); // Let 60s rolling chart initialise
    break;
  }
}
// Fallback: try 3rd icon
await page.mouse.click(28, 310);
await sleep(1200);
await shot(page, "09-metrics-view.png", "MetricsView — rolling telemetry charts");

// ─── SCREENSHOT 10: Leaderboard View ─────────────────────────────────────────
for (const icon of await page.$$('nav button, aside button, [class*="sidebar"] button')) {
  const title = await icon.getAttribute("title") || "";
  const ariaLabel = await icon.getAttribute("aria-label") || "";
  const text = await icon.textContent() || "";
  if (/leaderboard|trophy|governance|rank/i.test(title + ariaLabel + text)) {
    await icon.click();
    await sleep(700);
    break;
  }
}
await page.mouse.click(28, 390);
await sleep(700);
await shot(page, "10-leaderboard-cluster-rankings.png", "LeaderboardView — Cluster Rankings tab");

// Switch to Team Members tab
const membersTab = await page.$('button:has-text("Team Members"), button:has-text("Members"), [role="tab"]:has-text("Members")');
if (membersTab) {
  await membersTab.click();
  await sleep(500);
  await shot(page, "11-leaderboard-team-members.png", "LeaderboardView — Team Members tab");
}

// ─── SCREENSHOT 12: Settings View ────────────────────────────────────────────
for (const icon of await page.$$('nav button, aside button, [class*="sidebar"] button')) {
  const title = await icon.getAttribute("title") || "";
  const ariaLabel = await icon.getAttribute("aria-label") || "";
  const text = await icon.textContent() || "";
  if (/setting|cog|config|workspace/i.test(title + ariaLabel + text)) {
    await icon.click();
    await sleep(600);
    break;
  }
}
await page.mouse.click(28, 470);
await sleep(600);
await shot(page, "12-settings-view.png", "SettingsView — workspace settings");

// ─── SCREENSHOT 13: Return to Topology (full final state) ────────────────────
// Navigate back to topology
await page.mouse.click(28, 150);
await sleep(600);
await shot(page, "13-topology-final-state.png", "Topology canvas — final state (empty, no streamer)");

// ─── Done ────────────────────────────────────────────────────────────────────
await browser.close();

console.log("\n[ISH-09] Screenshot capture complete.");
console.log(`[ISH-09] Output directory: ${OUTPUT_DIR}`);
console.log(`[ISH-09] Files saved:\n`);

import { readdirSync, statSync } from "fs";
const files = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".png"));
files.forEach((f) => {
  const size = statSync(join(OUTPUT_DIR, f)).size;
  console.log(`  ${f}  (${(size / 1024).toFixed(0)} KB)`);
});
console.log(`\n[ISH-09] Total: ${files.length} screenshots\n`);
