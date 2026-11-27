import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = "test-access-secret-for-unit-tests-only";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/envscale_test";
process.env.JWT_ACCESS_SECRET = JWT_SECRET;
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-for-unit-tests-only";

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const BOB_ID = "22222222-2222-4222-8222-222222222222";
const VIEWER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const WS_ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLUSTER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RULE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INCIDENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const makeUser = (id: string, email: string, name: string, role = "user") => ({
  id,
  email,
  name,
  emailVerified: true,
  image: null,
  passwordHash: "hash",
  avatar: null,
  role,
  isActive: true,
  lastLogin: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const ALICE = makeUser(ALICE_ID, "alice@envscale.dev", "Alice");
const VIEWER = makeUser(VIEWER_ID, "viewer@envscale.dev", "Viewer");
const ADMIN_USER = makeUser(ADMIN_ID, "admin@envscale.dev", "Admin", "ADMIN");

const signJwt = (sub: string, role = "user") =>
  jwt.sign({ sub, role, tokenType: "user" }, JWT_SECRET, { expiresIn: "1h" });

const signServiceJwt = (sub: "k8s-streamer" | "api-server" = "k8s-streamer") =>
  jwt.sign({ sub, role: "SERVICE", tokenType: "service" }, JWT_SECRET, { expiresIn: "15m" });

type QueryMock = {
  selectQueue: unknown[][];
  updateQueue: unknown[][];
  insertQueue: unknown[][];
  updatePayloads: Array<Record<string, unknown>>;
};

const queryState: QueryMock = {
  selectQueue: [],
  updateQueue: [],
  insertQueue: [],
  updatePayloads: [],
};

let mockedSessionUser: { id: string } | null = null;
let server: http.Server;
let baseUrl = "";
let cleanupFns: Array<() => Promise<void> | void> = [];

const makeAwaitableChain = <T extends object>(rows: unknown[], extra: T): T & PromiseLike<unknown[]> => {
  const promise = Promise.resolve(rows);
  return Object.assign(extra, {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  });
};

describe("Phase 1 Auth & Tenant Security Boundaries", () => {
  before(async () => {
    const [{ authRouter }, { clusterRouter, topLevelClusterRouter }, { topLevelIncidentRouter }, { db, pool }, { auth }] =
      await Promise.all([
        import("../src/routes/auth.routes.js"),
        import("../src/routes/cluster.routes.js"),
        import("../src/routes/incident.routes.js"),
        import("../src/db/client.js"),
        import("../src/lib/auth.js"),
      ]);

    const selectMock = mock.method(db, "select", () => {
      const makeFrom = () =>
        makeAwaitableChain([], {
          innerJoin: () => makeFrom(),
          leftJoin: () => makeFrom(),
          where: () => {
            const rows = queryState.selectQueue.shift() ?? [];
            return makeAwaitableChain(rows, { limit: async () => rows });
          },
          limit: async () => queryState.selectQueue.shift() ?? [],
        });
      return { from: makeFrom } as unknown as ReturnType<typeof db.select>;
    });

    const updateMock = mock.method(db, "update", () => ({
      set: (values: Record<string, unknown>) => {
        queryState.updatePayloads.push(values);
        const rows = queryState.updateQueue.shift() ?? [];
        return {
          where: () => makeAwaitableChain(rows, { returning: async () => rows }),
        };
      },
    }) as unknown as ReturnType<typeof db.update>);

    const insertMock = mock.method(db, "insert", () => ({
      values: () => ({
        returning: async () => queryState.insertQueue.shift() ?? [],
      }),
    }) as unknown as ReturnType<typeof db.insert>);

    const sessionMock = mock.method(auth.api, "getSession", async () =>
      mockedSessionUser ? { user: mockedSessionUser } : null
    );

    const app = express();
    app.use(express.json());
    app.use("/api/v1/auth", authRouter);
    app.use("/api/v1/workspaces/:id/clusters", clusterRouter);
    app.use("/api/v1/clusters", topLevelClusterRouter);
    app.use("/api/v1/incidents", topLevelIncidentRouter);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    cleanupFns = [
      () => selectMock.mock.restore(),
      () => updateMock.mock.restore(),
      () => insertMock.mock.restore(),
      () => sessionMock.mock.restore(),
      () => {
        server.closeAllConnections?.();
        return new Promise<void>((resolve) => server.close(() => resolve()));
      },
      () => pool.end(),
    ];
  });

  after(async () => {
    for (const fn of cleanupFns) {
      await fn();
    }
  });

  beforeEach(() => {
    queryState.selectQueue = [];
    queryState.updateQueue = [];
    queryState.insertQueue = [];
    queryState.updatePayloads = [];
    mockedSessionUser = null;
  });

  describe("POST /api/v1/auth/switch-session", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/switch-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify({ email: ALICE.email }),
      });
      assert.equal(res.status, 401);
    });

    it("rejects empty or invalid payloads with 400", async () => {
      queryState.selectQueue.push([ALICE]);
      const res = await fetch(`${baseUrl}/api/v1/auth/switch-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${signJwt(ALICE_ID)}`,
          Connection: "close",
        },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });

    it("rejects internal service tokens with 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/switch-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${signServiceJwt("k8s-streamer")}`,
          Connection: "close",
        },
        body: JSON.stringify({ accountId: ALICE_ID }),
      });
      assert.equal(res.status, 403);
    });

    it("rejects cross-account impersonation attempts with 403", async () => {
      queryState.selectQueue.push([ALICE], [ALICE]);
      const res = await fetch(`${baseUrl}/api/v1/auth/switch-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${signJwt(ALICE_ID)}`,
          Connection: "close",
        },
        body: JSON.stringify({ accountId: BOB_ID, email: "bob@envscale.dev" }),
      });
      assert.equal(res.status, 403);
    });

    it("issues a refreshed token for matching authenticated Bearer owner", async () => {
      queryState.selectQueue.push(
        [ALICE],
        [ALICE],
        [{ workspaceId: WS_ALICE, role: "ADMIN" }],
        [],
        [{ id: CLUSTER_ID, workspaceId: WS_ALICE }],
        [{ workspace: { id: WS_ALICE, name: "Alice WS", slug: "alice-ws" }, role: "ADMIN" }]
      );
      const res = await fetch(`${baseUrl}/api/v1/auth/switch-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${signJwt(ALICE_ID)}`,
          Connection: "close",
        },
        body: JSON.stringify({ accountId: ALICE_ID, email: ALICE.email }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { token: string; user: { id: string } };
      assert.equal(body.user.id, ALICE_ID);
      const decoded = jwt.verify(body.token, JWT_SECRET) as { sub: string };
      assert.equal(decoded.sub, ALICE_ID);
    });

    it("accepts a matching Better Auth session fallback", async () => {
      mockedSessionUser = { id: ALICE_ID };
      queryState.selectQueue.push(
        [ALICE],
        [ALICE],
        [{ workspaceId: WS_ALICE, role: "ADMIN" }],
        [],
        [{ id: CLUSTER_ID, workspaceId: WS_ALICE }],
        [{ workspace: { id: WS_ALICE, name: "Alice WS", slug: "alice-ws" }, role: "ADMIN" }]
      );
      const res = await fetch(`${baseUrl}/api/v1/auth/switch-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify({ email: ALICE.email }),
      });
      assert.equal(res.status, 200);
    });
  });

  describe("Cluster agent.yaml & layout Tenant RBAC", () => {
    it("returns 401 without auth and 403 for service tokens", async () => {
      const noAuth = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/layout`, {
        headers: { Connection: "close" },
      });
      assert.equal(noAuth.status, 401);

      const svcRes = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/agent.yaml`, {
        headers: {
          Authorization: `Bearer ${signServiceJwt("k8s-streamer")}`,
          Connection: "close",
        },
      });
      assert.equal(svcRes.status, 403);
    });

    it("returns 404 when cluster does not exist and 403 for non-members", async () => {
      queryState.selectQueue.push([ALICE], []);
      const notFound = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/layout`, {
        headers: { Authorization: `Bearer ${signJwt(ALICE_ID)}`, Connection: "close" },
      });
      assert.equal(notFound.status, 404);

      for (const req of [
        { path: `/api/v1/clusters/${CLUSTER_ID}/agent.yaml`, method: "GET" },
        { path: `/api/v1/workspaces/${WS_ALICE}/clusters/${CLUSTER_ID}/layout`, method: "GET" },
        { path: `/api/v1/clusters/${CLUSTER_ID}/layout`, method: "PUT", body: { positions: { n1: { x: 1, y: 2 } } } },
        { path: `/api/v1/clusters/${CLUSTER_ID}/layout`, method: "DELETE" },
      ]) {
        queryState.selectQueue.push(
          [ALICE],
          [{ clusterId: CLUSTER_ID, workspaceId: WS_ALICE, ownerId: BOB_ID, memberRole: null }]
        );
        const denied = await fetch(`${baseUrl}${req.path}`, {
          method: req.method,
          headers: {
            Authorization: `Bearer ${signJwt(ALICE_ID)}`,
            ...(req.body ? { "Content-Type": "application/json" } : {}),
            Connection: "close",
          },
          ...(req.body ? { body: JSON.stringify(req.body) } : {}),
        });
        assert.equal(denied.status, 403);
      }
    });

    it("enforces VIEWER read-only vs MEMBER write/manifest permissions", async () => {
      const viewerMembership = [{ clusterId: CLUSTER_ID, workspaceId: WS_ALICE, ownerId: BOB_ID, memberRole: "VIEWER" }];

      queryState.selectQueue.push([VIEWER], viewerMembership);
      const viewerYaml = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/agent.yaml`, {
        headers: { Authorization: `Bearer ${signJwt(VIEWER_ID)}`, Connection: "close" },
      });
      assert.equal(viewerYaml.status, 403);

      queryState.selectQueue.push([VIEWER], viewerMembership);
      const viewerPut = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt(VIEWER_ID)}`, Connection: "close" },
        body: JSON.stringify({ positions: { n1: { x: 1, y: 2 } } }),
      });
      assert.equal(viewerPut.status, 403);

      queryState.selectQueue.push(
        [VIEWER],
        viewerMembership,
        [{ id: CLUSTER_ID, metadata: { userLayouts: { [VIEWER_ID]: { n1: { x: 10, y: 20 } } } } }]
      );
      const viewerGet = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/layout`, {
        headers: { Authorization: `Bearer ${signJwt(VIEWER_ID)}`, Connection: "close" },
      });
      assert.equal(viewerGet.status, 200);
      assert.deepEqual(await viewerGet.json(), { positions: { n1: { x: 10, y: 20 } } });
    });

    it("allows authorized MEMBER manifest download via scoped manifest-token and layout updates/resets", async () => {
      const memberMembership = [{ clusterId: CLUSTER_ID, workspaceId: WS_ALICE, ownerId: BOB_ID, memberRole: "MEMBER" }];

      // SEC-H4: Reject long-lived user JWT in ?token= query parameter
      const queryUserJwtRes = await fetch(
        `${baseUrl}/api/v1/clusters/${CLUSTER_ID}/agent.yaml?token=${encodeURIComponent(signJwt(ALICE_ID))}`,
        { headers: { Connection: "close" } }
      );
      assert.equal(queryUserJwtRes.status, 401);

      // SEC-H4: Mint 5m scoped single-use manifest_download token for authorized MEMBER
      queryState.selectQueue.push([ALICE], memberMembership);
      const tokenMintRes = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/manifest-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${signJwt(ALICE_ID)}`, Connection: "close" },
      });
      assert.equal(tokenMintRes.status, 200);
      assert.equal(tokenMintRes.headers.get("cache-control"), "no-store");
      const minted = (await tokenMintRes.json()) as { token: string; expiresInSeconds: number };
      assert.equal(minted.expiresInSeconds, 300);

      queryState.selectQueue.push([ALICE], memberMembership, [{ id: CLUSTER_ID, name: "prod-k8s" }]);
      const yamlUrl = `${baseUrl}/api/v1/clusters/${CLUSTER_ID}/agent.yaml?token=${encodeURIComponent(minted.token)}`;
      const yamlRes = await fetch(yamlUrl, { headers: { Connection: "close" } });
      assert.equal(yamlRes.status, 200);
      assert.equal(yamlRes.headers.get("cache-control"), "no-store");
      assert.match(yamlRes.headers.get("content-type") || "", /application\/yaml/);
      const yamlBody = await yamlRes.text();
      assert.match(yamlBody, new RegExp(CLUSTER_ID));
      assert.match(yamlBody, /kind:\s*Secret/);
      assert.match(yamlBody, /secretKeyRef/);

      // Replaying single-use manifest_download token fails 401; injected serverUrl fails 400; service token fails 403
      const replayRes = await fetch(yamlUrl, { headers: { Connection: "close" } });
      assert.equal(replayRes.status, 401);

      queryState.selectQueue.push([ALICE], memberMembership);
      const minted2 = (await (await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/manifest-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${signJwt(ALICE_ID)}`, Connection: "close" },
      })).json()) as { token: string };
      queryState.selectQueue.push([ALICE], memberMembership, [{ id: CLUSTER_ID, name: "prod-k8s" }]);
      const badServerUrlRes = await fetch(
        `${baseUrl}/api/v1/clusters/${CLUSTER_ID}/agent.yaml?token=${encodeURIComponent(minted2.token)}&serverUrl=${encodeURIComponent("http://evil\"\nenv: injected")}`,
        { headers: { Connection: "close" } }
      );
      assert.equal(badServerUrlRes.status, 400);

      const svcListRes = await fetch(`${baseUrl}/api/v1/clusters`, {
        headers: { Authorization: `Bearer ${signServiceJwt("k8s-streamer")}`, Connection: "close" },
      });
      assert.equal(svcListRes.status, 403);

      // SEC-H6: Top-level DELETE /api/v1/clusters/:clusterId rejects MEMBER/VIEWER with 403
      queryState.selectQueue.push([ALICE], memberMembership);
      const memberDelRes = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${signJwt(ALICE_ID)}`, Connection: "close" },
      });
      assert.equal(memberDelRes.status, 403);

      queryState.selectQueue.push([ALICE]);
      const badLayout = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt(ALICE_ID)}`, Connection: "close" },
        body: JSON.stringify({ positions: "invalid" }),
      });
      assert.equal(badLayout.status, 400);

      queryState.selectQueue.push(
        [ALICE],
        memberMembership,
        [{ id: CLUSTER_ID, metadata: { userLayouts: { [BOB_ID]: { b: { x: 5, y: 6 } } }, layout: { b: { x: 5, y: 6 } } } }]
      );
      const saveRes = await fetch(`${baseUrl}/api/v1/clusters/${CLUSTER_ID}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${signJwt(ALICE_ID)}`, Connection: "close" },
        body: JSON.stringify({ positions: { a: { x: 1, y: 2 } } }),
      });
      assert.equal(saveRes.status, 200);

      queryState.selectQueue.push(
        [ALICE],
        memberMembership,
        [{ id: CLUSTER_ID, metadata: { userLayouts: { [ALICE_ID]: { a: { x: 1, y: 2 } }, [BOB_ID]: { b: { x: 5, y: 6 } } }, layout: { b: { x: 5, y: 6 } } } }]
      );
      const delRes = await fetch(`${baseUrl}/api/v1/workspaces/${WS_ALICE}/clusters/${CLUSTER_ID}/layout`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${signJwt(ALICE_ID)}`, Connection: "close" },
      });
      assert.equal(delRes.status, 200);
      const delMeta = queryState.updatePayloads.at(-1)?.metadata as { layout?: unknown; userLayouts: Record<string, unknown> };
      assert.ok(delMeta.layout, "fallback layout preserved while another user layout remains");
      assert.equal(delMeta.userLayouts[ALICE_ID], undefined);
    });
  });

  describe("POST /api/v1/incidents/internal/trigger", () => {
    it("blocks unauthenticated, human admin, and query-param service tokens", async () => {
      const unauth = await fetch(`${baseUrl}/api/v1/incidents/internal/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify({}),
      });
      assert.equal(unauth.status, 401);

      queryState.selectQueue.push([ADMIN_USER]);
      const human = await fetch(`${baseUrl}/api/v1/incidents/internal/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${signJwt(ADMIN_ID, "ADMIN")}`,
          Connection: "close",
        },
        body: JSON.stringify({ ruleId: RULE_ID, clusterId: CLUSTER_ID, targetKind: "Pod", targetName: "api-0" }),
      });
      assert.equal(human.status, 403);

      const queryService = await fetch(
        `${baseUrl}/api/v1/incidents/internal/trigger?token=${encodeURIComponent(signServiceJwt("k8s-streamer"))}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "close" },
          body: JSON.stringify({ ruleId: RULE_ID, clusterId: CLUSTER_ID, targetKind: "Pod", targetName: "api-0" }),
        }
      );
      assert.equal(queryService.status, 401);
    });

    it("validates Zod schema and creates incidents for valid Bearer service tokens", async () => {
      const serviceHeader = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signServiceJwt("k8s-streamer")}`,
        Connection: "close",
      };

      const invalid = await fetch(`${baseUrl}/api/v1/incidents/internal/trigger`, {
        method: "POST",
        headers: serviceHeader,
        body: JSON.stringify({ ruleId: "not-a-uuid" }),
      });
      assert.equal(invalid.status, 400);

      queryState.selectQueue.push(
        [{ id: RULE_ID, workspaceId: WS_ALICE, clusterId: CLUSTER_ID, name: "High CPU", metric: "CPU", severity: "critical" }],
        []
      );
      queryState.insertQueue.push([{ id: INCIDENT_ID, status: "open", severity: "critical" }]);

      const valid = await fetch(`${baseUrl}/api/v1/incidents/internal/trigger`, {
        method: "POST",
        headers: serviceHeader,
        body: JSON.stringify({
          ruleId: RULE_ID,
          clusterId: CLUSTER_ID,
          targetKind: "Pod",
          targetName: "api-0",
          namespace: "default",
          measured: 95,
          threshold: 80,
          severity: "CRITICAL",
          message: "CPU threshold exceeded",
        }),
      });
      assert.equal(valid.status, 201);
      const created = (await valid.json()) as { id: string; status: string };
      assert.equal(created.id, INCIDENT_ID);
      assert.equal(created.status, "open");
    });
  });
});
