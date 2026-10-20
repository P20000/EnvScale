// ============================================================================
// VIN-13: k6 REST API Load Testing & Performance Benchmarks
// ============================================================================
// Simulates realistic API traffic with ramping Virtual Users against key
// EnvScale API endpoints. Run with: k6 run tests/load/api-load-test.js
//
// Thresholds:
//   - P95 latency < 50ms for read endpoints
//   - P99 latency < 100ms
//   - HTTP error rate < 1%
// ============================================================================

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ── Custom Metrics ──────────────────────────────────────────────────────────
const healthLatency = new Trend("health_endpoint_latency", true);
const loginLatency = new Trend("login_endpoint_latency", true);
const leaderboardLatency = new Trend("leaderboard_endpoint_latency", true);
const workspacesLatency = new Trend("workspaces_endpoint_latency", true);
const errorRate = new Rate("errors");

// ── Configuration ───────────────────────────────────────────────────────────
const BASE_URL = __ENV.API_BASE_URL || "http://localhost:3000";

const TEST_USER = {
  email: __ENV.TEST_USER_EMAIL || "loadtest@envscale.dev",
  password: __ENV.TEST_USER_PASSWORD || "LoadTest@2026",
};

// ── k6 Options ──────────────────────────────────────────────────────────────
export const options = {
  // Ramping scenario: ramp up → steady state → ramp down
  stages: [
    { duration: "10s", target: 20 },  // Warm-up: ramp to 20 VUs
    { duration: "20s", target: 50 },  // Ramp to 50 VUs
    { duration: "30s", target: 100 }, // Peak: sustain 100 VUs
    { duration: "20s", target: 50 },  // Cool-down: ramp to 50
    { duration: "10s", target: 0 },   // Drain: ramp down to 0
  ],

  thresholds: {
    // Global HTTP thresholds
    http_req_duration: [
      "p(95)<50",  // P95 latency under 50ms
      "p(99)<100", // P99 latency under 100ms
    ],
    http_req_failed: ["rate<0.01"], // Less than 1% error rate

    // Per-endpoint latency thresholds
    health_endpoint_latency: ["p(95)<30"],
    login_endpoint_latency: ["p(95)<100"],
    leaderboard_endpoint_latency: ["p(95)<50"],
    workspaces_endpoint_latency: ["p(95)<50"],

    // Custom error rate
    errors: ["rate<0.01"],
  },
};

// ── Helper: Shared HTTP params ──────────────────────────────────────────────
function jsonHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return { headers };
}

// ── Setup: Authenticate once and share token across VUs ─────────────────────
export function setup() {
  console.log(`🚀 Load test starting against: ${BASE_URL}`);

  // Verify server is reachable
  const healthRes = http.get(`${BASE_URL}/health`);
  if (healthRes.status !== 200) {
    console.error(`❌ Server not reachable at ${BASE_URL}/health (status: ${healthRes.status})`);
    return { token: null };
  }

  // Attempt login to get an auth token for protected endpoints
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    jsonHeaders()
  );

  let token = null;
  if (loginRes.status === 200) {
    try {
      const body = JSON.parse(loginRes.body);
      token = body.accessToken || body.token || null;
      console.log("✅ Authentication successful — protected endpoints will be tested.");
    } catch {
      console.warn("⚠️  Login succeeded but could not parse token. Testing public endpoints only.");
    }
  } else {
    console.warn(
      `⚠️  Login failed (status: ${loginRes.status}). Testing public endpoints only. ` +
      `Create a test user with email '${TEST_USER.email}' to enable authenticated tests.`
    );
  }

  return { token };
}

// ── Main VU Function ────────────────────────────────────────────────────────
export default function (data) {
  const { token } = data;

  // ────────────────────────────────────────────────────────────
  // 1. Health Check (Public)
  // ────────────────────────────────────────────────────────────
  group("GET /health", () => {
    const res = http.get(`${BASE_URL}/health`);
    healthLatency.add(res.timings.duration);

    const passed = check(res, {
      "health: status is 200": (r) => r.status === 200,
      "health: body has status ok": (r) => {
        try {
          return JSON.parse(r.body).status === "ok";
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!passed);
  });

  sleep(0.1);

  // ────────────────────────────────────────────────────────────
  // 2. Login Endpoint (Public)
  // ────────────────────────────────────────────────────────────
  group("POST /api/v1/auth/login", () => {
    const res = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
      jsonHeaders()
    );
    loginLatency.add(res.timings.duration);

    const passed = check(res, {
      "login: status is 200 or 401 or 429": (r) =>
        [200, 401, 429].includes(r.status),
    });
    errorRate.add(!passed);
  });

  sleep(0.1);

  // ────────────────────────────────────────────────────────────
  // 3. Leaderboard (Authenticated)
  // ────────────────────────────────────────────────────────────
  group("GET /api/v1/leaderboard", () => {
    const params = token ? jsonHeaders(token) : jsonHeaders();
    const res = http.get(`${BASE_URL}/api/v1/leaderboard`, params);
    leaderboardLatency.add(res.timings.duration);

    const passed = check(res, {
      "leaderboard: status is 200 or 401": (r) =>
        [200, 401].includes(r.status),
    });
    errorRate.add(!passed);
  });

  sleep(0.1);

  // ────────────────────────────────────────────────────────────
  // 4. Workspaces List (Authenticated)
  // ────────────────────────────────────────────────────────────
  if (token) {
    group("GET /api/v1/workspaces", () => {
      const res = http.get(
        `${BASE_URL}/api/v1/workspaces`,
        jsonHeaders(token)
      );
      workspacesLatency.add(res.timings.duration);

      const passed = check(res, {
        "workspaces: status is 200": (r) => r.status === 200,
        "workspaces: returns array": (r) => {
          try {
            const body = JSON.parse(r.body);
            return Array.isArray(body) || Array.isArray(body.workspaces);
          } catch {
            return false;
          }
        },
      });
      errorRate.add(!passed);
    });

    sleep(0.1);
  }
}

// ── Teardown ────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log("🏁 Load test completed.");
  if (!data.token) {
    console.log("ℹ️  Authenticated endpoints were skipped (no valid token).");
  }
}
