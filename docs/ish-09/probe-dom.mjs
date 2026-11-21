import { chromium } from "playwright";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

// Capture all console messages from the app
const logs = [];
page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

// Wait for JS to execute
await page.waitForTimeout(8000);

const title = await page.title();
const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
const divCount = await page.evaluate(() => document.querySelectorAll("div").length);
const buttonCount = await page.evaluate(() => document.querySelectorAll("button").length);
const svgCount = await page.evaluate(() => document.querySelectorAll("svg").length);

console.log(`title: ${title}`);
console.log(`body innerHTML length: ${bodyLen}`);
console.log(`div count: ${divCount}`);
console.log(`button count: ${buttonCount}`);
console.log(`svg count: ${svgCount}`);
console.log(`console logs (first 20):`);
logs.slice(0, 20).forEach((l) => console.log("  " + l));

// If buttons exist, list them
if (buttonCount > 0) {
  const btns = await page.$$eval("button", (bs) =>
    bs.map((b) => ({
      text: b.textContent?.trim().slice(0, 50),
      title: b.title,
      rect: `${Math.round(b.getBoundingClientRect().x)},${Math.round(b.getBoundingClientRect().y)},${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`,
    }))
  );
  console.log("\n=== BUTTONS ===");
  btns.forEach((b, i) => console.log(`[${i}] "${b.text}" title="${b.title}" rect=${b.rect}`));
}

// Also get first few class names to see what rendered
const firstDivClasses = await page.$$eval("div", (ds) => ds.slice(0, 5).map((d) => d.className.slice(0, 80)));
console.log("\n=== FIRST 5 DIV CLASSES ===");
firstDivClasses.forEach((c, i) => console.log(`[${i}] ${c}`));

await browser.close();
