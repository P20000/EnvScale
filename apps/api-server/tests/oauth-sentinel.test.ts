import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/envscale_test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-for-unit-tests-only";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-for-unit-tests-only";

let normalizeOptionalCredential: (value: unknown) => string | undefined;
let envSchema: typeof import("../src/config/env.js").envSchema;
let buildSocialProviders: typeof import("../src/lib/auth.js").buildSocialProviders;

describe("OAuth DISABLED sentinel handling", () => {
  before(async () => {
    const [envMod, authMod] = await Promise.all([
      import("../src/config/env.js"),
      import("../src/lib/auth.js"),
    ]);
    normalizeOptionalCredential = envMod.normalizeOptionalCredential;
    envSchema = envMod.envSchema;
    buildSocialProviders = authMod.buildSocialProviders;
  });

  it("normalizes empty strings and DISABLED sentinels to undefined", () => {
    for (const sentinel of ["DISABLED", "disabled", "  Disabled  ", "", "   ", undefined]) {
      assert.equal(normalizeOptionalCredential(sentinel), undefined);
    }
    assert.equal(normalizeOptionalCredential("  real-client-id  "), "real-client-id");
  });

  it("strips DISABLED OAuth credentials in envSchema parsing", () => {
    const parsed = envSchema.parse({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@postgres:5432/envscale",
      JWT_ACCESS_SECRET: "real-prod-access-secret",
      JWT_REFRESH_SECRET: "real-prod-refresh-secret",
      CORS_ORIGIN: "https://envscale.duckdns.org",
      GOOGLE_CLIENT_ID: "DISABLED",
      GOOGLE_CLIENT_SECRET: "disabled",
      GITHUB_CLIENT_ID: "gh-id-123",
      GITHUB_CLIENT_SECRET: "  DISABLED ",
    });

    assert.equal(parsed.GOOGLE_CLIENT_ID, undefined);
    assert.equal(parsed.GOOGLE_CLIENT_SECRET, undefined);
    assert.equal(parsed.GITHUB_CLIENT_ID, "gh-id-123");
    assert.equal(parsed.GITHUB_CLIENT_SECRET, undefined);
  });

  it("returns undefined or only fully-configured non-DISABLED providers from buildSocialProviders", () => {
    assert.equal(
      buildSocialProviders({
        GOOGLE_CLIENT_ID: "DISABLED",
        GOOGLE_CLIENT_SECRET: "DISABLED",
        GITHUB_CLIENT_ID: "DISABLED",
        GITHUB_CLIENT_SECRET: "DISABLED",
      }),
      undefined,
    );

    assert.equal(
      buildSocialProviders({
        GOOGLE_CLIENT_ID: "real-google-id",
        GOOGLE_CLIENT_SECRET: "DISABLED",
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: "real-github-secret",
      }),
      undefined,
    );

    const googleOnly = buildSocialProviders({
      GOOGLE_CLIENT_ID: "real-google-id",
      GOOGLE_CLIENT_SECRET: "real-google-secret",
      GITHUB_CLIENT_ID: "DISABLED",
      GITHUB_CLIENT_SECRET: "DISABLED",
    });
    assert.deepEqual(Object.keys(googleOnly ?? {}), ["google"]);
    assert.equal(googleOnly?.google.clientId, "real-google-id");

    const both = buildSocialProviders({
      GOOGLE_CLIENT_ID: "real-google-id",
      GOOGLE_CLIENT_SECRET: "real-google-secret",
      GITHUB_CLIENT_ID: "real-github-id",
      GITHUB_CLIENT_SECRET: "real-github-secret",
    });
    assert.deepEqual(Object.keys(both ?? {}), ["google", "github"]);
  });
});

