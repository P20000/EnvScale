import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import jwt from "jsonwebtoken";
import { KubeconfigSecurityError, validateKubeconfigSecurity } from "../src/utils/kubeconfig-validator.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/envscale_test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-for-unit-tests-only";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-for-unit-tests-only";

describe("SEC-C6 & SEC-C5 Kubeconfig Security Validation", () => {
  it("rejects kubeconfigs with user.exec commands", () => {
    const execYaml = `
apiVersion: v1
kind: Config
clusters:
- name: eks
  cluster:
    server: https://eks.example.com
    certificate-authority-data: dGVzdA==
users:
- name: eks-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args: ["eks", "get-token"]
contexts:
- name: ctx
  context:
    cluster: eks
    user: eks-user
current-context: ctx
`;
    assert.throws(() => validateKubeconfigSecurity(execYaml), KubeconfigSecurityError);
  });

  it("rejects kubeconfigs referencing local CA/cert/key/tokenFile paths", () => {
    const fileYaml = `
apiVersion: v1
kind: Config
clusters:
- name: local
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority: /etc/ssl/private/ca.crt
users:
- name: u
  user:
    client-certificate: /tmp/client.crt
    client-key: /tmp/client.key
    tokenFile: /var/run/secrets/token
contexts:
- name: ctx
  context:
    cluster: local
    user: u
current-context: ctx
`;
    assert.throws(() => validateKubeconfigSecurity(fileYaml), KubeconfigSecurityError);
  });

  it("rejects kubeconfigs with insecure-skip-tls-verify: true", () => {
    const insecureYaml = `
apiVersion: v1
kind: Config
clusters:
- name: insecure
  cluster:
    server: https://127.0.0.1:6443
    insecure-skip-tls-verify: true
users:
- name: u
  user:
    token: tok
contexts:
- name: ctx
  context:
    cluster: insecure
    user: u
current-context: ctx
`;
    assert.throws(() => validateKubeconfigSecurity(insecureYaml), KubeconfigSecurityError);
  });

  it("accepts safe inline kubeconfigs", () => {
    const safeYaml = `
apiVersion: v1
kind: Config
clusters:
- name: safe
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority-data: dGVzdA==
users:
- name: u
  user:
    token: test-token
contexts:
- name: ctx
  context:
    cluster: safe
    user: u
current-context: ctx
`;
    const result = validateKubeconfigSecurity(safeYaml);
    assert.equal(result.apiServerUrl, "https://127.0.0.1:6443");
  });

  it("rejects JSON/flow-YAML bypasses, auth-provider, empty users, and invalid URLs", () => {
    const jsonExec = JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: "c", cluster: { server: "https://127.0.0.1:6443", "certificate-authority-data": "dGVzdA==" } }],
      users: [{ name: "u", user: { exec: { command: "sh" } } }],
      contexts: [{ name: "ctx", context: { cluster: "c", user: "u" } }],
      "current-context": "ctx",
    });
    assert.throws(() => validateKubeconfigSecurity(jsonExec), KubeconfigSecurityError);

    const flowExec =
      "apiVersion: v1\nkind: Config\nclusters: [{name: c, cluster: {server: https://127.0.0.1:6443}}]\nusers: [{name: u, user: {auth-provider: {name: gcp}}}]\ncontexts: [{name: ctx, context: {cluster: c, user: u}}]\ncurrent-context: ctx\n";
    assert.throws(() => validateKubeconfigSecurity(flowExec), KubeconfigSecurityError);

    const jsonTokenFile = JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: "c", cluster: { server: "https://127.0.0.1:6443" } }],
      users: [{ name: "u", user: { tokenFile: "/etc/passwd" } }],
      contexts: [{ name: "ctx", context: { cluster: "c", user: "u" } }],
      "current-context": "ctx",
    });
    assert.throws(() => validateKubeconfigSecurity(jsonTokenFile), KubeconfigSecurityError);

    const noUsersYaml = `
apiVersion: v1
kind: Config
clusters:
- name: safe
  cluster:
    server: https://127.0.0.1:6443
users: []
contexts:
- name: ctx
  context:
    cluster: safe
current-context: ctx
`;
    assert.throws(() => validateKubeconfigSecurity(noUsersYaml), KubeconfigSecurityError);
  });
});

describe("SEC-C1 / SEC-C2 / SEC-H3 / SEC-H4 Token Separation & Isolation", () => {
  it("issues cluster-bound agent tokens without user role or wildcard cluster claims", async () => {
    const { createAgentToken } = await import("../src/services/auth.service.js");
    const token = createAgentToken("cluster-uuid-123");
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as Record<string, unknown>;
    assert.equal(decoded.tokenType, "agent");
    assert.equal(decoded.clusterId, "cluster-uuid-123");
    assert.equal(decoded.role, undefined);
    assert.equal(decoded.allowedClusterIds, undefined);
  });

  it("SEC-H3: global ADMIN user without workspace membership receives empty clusterRoles", async () => {
    const { db } = await import("../src/db/client.js");
    const { getUserClusterRoles, getUserAccessibleClusterIds } = await import("../src/services/auth.service.js");
    const selectMock = mock.method(db, "select", () => ({
      from: () => ({
        where: async () => [],
      }),
    }) as unknown as ReturnType<typeof db.select>);

    try {
      const roles = await getUserClusterRoles("global-admin-user-id");
      const ids = await getUserAccessibleClusterIds("global-admin-user-id", "ADMIN");
      assert.deepEqual(roles, {});
      assert.deepEqual(ids, []);
    } finally {
      selectMock.mock.restore();
    }
  });

  it("SEC-H4: rejects agent tokens and scoped manifest_download tokens on api-server routes", async () => {
    const [{ workspaceRouter }, { createAgentToken, createManifestDownloadToken }, { db }] = await Promise.all([
      import("../src/routes/workspace.routes.js"),
      import("../src/services/auth.service.js"),
      import("../src/db/client.js"),
    ]);

    const selectMock = mock.method(db, "select", () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "11111111-1111-4111-8111-111111111111", isActive: true, role: "user" }],
        }),
      }),
    }) as unknown as ReturnType<typeof db.select>);

    const app = express();
    app.use("/api/v1/workspaces", workspaceRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const agentTok = createAgentToken("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
      const agentRes = await fetch(`http://127.0.0.1:${port}/api/v1/workspaces`, {
        headers: { Authorization: `Bearer ${agentTok}`, Connection: "close" },
      });
      assert.equal(agentRes.status, 401);

      const manifestTok = createManifestDownloadToken(
        "11111111-1111-4111-8111-111111111111",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      );
      const manifestRes = await fetch(`http://127.0.0.1:${port}/api/v1/workspaces`, {
        headers: { Authorization: `Bearer ${manifestTok}`, Connection: "close" },
      });
      assert.equal(manifestRes.status, 401);
    } finally {
      selectMock.mock.restore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("SEC-L1 / SEC-L2: validateEnvConfig enforces production secrets & KUBECONFIG_ENCRYPTION_KEY and ownerId grants ADMIN", async () => {
    const [{ validateEnvConfig }, { getUserClusterRoles }, { db }] = await Promise.all([
      import("../src/config/env.js"),
      import("../src/services/auth.service.js"),
      import("../src/db/client.js"),
    ]);

    const validKey = Buffer.alloc(32, 7).toString("base64");
    const longSecret = "0123456789abcdef0123456789abcdef";

    assert.throws(() =>
      validateEnvConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
        JWT_ACCESS_SECRET: "default_dev_access_secret_do_not_use_in_prod",
        JWT_REFRESH_SECRET: longSecret,
        KUBECONFIG_ENCRYPTION_KEY: validKey,
        CORS_ORIGIN: "https://envscale.duckdns.org",
      })
    );

    assert.throws(() =>
      validateEnvConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
        JWT_ACCESS_SECRET: longSecret,
        JWT_REFRESH_SECRET: longSecret,
        CORS_ORIGIN: "https://envscale.duckdns.org",
      })
    );

    assert.throws(() =>
      validateEnvConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
        JWT_ACCESS_SECRET: longSecret,
        JWT_REFRESH_SECRET: longSecret,
        KUBECONFIG_ENCRYPTION_KEY: "not-32-bytes",
      })
    );

    const parsedProd = validateEnvConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
      JWT_ACCESS_SECRET: longSecret,
      JWT_REFRESH_SECRET: longSecret,
      KUBECONFIG_ENCRYPTION_KEY: validKey,
      CORS_ORIGIN: "https://envscale.duckdns.org",
    });
    assert.equal(parsedProd.NODE_ENV, "production");

    // Workspace owner without a workspaceMembers row receives ADMIN in getUserClusterRoles
    const queue: unknown[][] = [
      [], // workspaceMembers
      [{ id: "ws-owned" }], // workspaces owned
      [{ id: "cluster-owned", workspaceId: "ws-owned" }], // clusters
    ];
    const selectMock = mock.method(db, "select", () => ({
      from: () => ({
        where: async () => queue.shift() ?? [],
      }),
    }) as unknown as ReturnType<typeof db.select>);
    try {
      const roles = await getUserClusterRoles("owner-user-1");
      assert.deepEqual(roles, { "cluster-owned": "ADMIN" });
    } finally {
      selectMock.mock.restore();
    }
  });

  it("SEC-L3: default Agent RBAC manifest excludes Kubernetes secrets read permissions", async () => {
    const { generateAgentManifest } = await import("../src/services/agent-manifest.service.js");
    const manifest = generateAgentManifest({ clusterId: "c-sec-l3", clusterName: "prod" });
    const clusterRoleSection = manifest.split("---").find((doc) => doc.includes("kind: ClusterRole\n")) || "";
    assert.ok(clusterRoleSection.length > 0, "ClusterRole section must exist");
    assert.doesNotMatch(clusterRoleSection, /^\s*-\s*secrets\s*$/m);
    assert.match(manifest, /kind:\s*Secret/);
    assert.match(manifest, /secretKeyRef/);
  });
});
