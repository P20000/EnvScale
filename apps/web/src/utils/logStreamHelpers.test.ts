import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyNormalizedLogFrame,
  buildLogStreamWebSocketUrl,
  createInitialLogStreamState,
} from "./logStreamHelpers.ts";

describe("logStreamHelpers", () => {
  it("builds unified log stream WebSocket URL with optional filters", () => {
    const url = buildLogStreamWebSocketUrl({
      wsBaseUrl: "ws://localhost:8080",
      clusterId: "cluster-1",
      namespace: "prod",
      kind: "Pod",
      name: "web-0",
      container: "api",
      tailLines: 50,
      follow: true,
      previous: true,
      timestamps: true,
      sinceSeconds: 300,
    });

    assert.ok(url.startsWith("ws://localhost:8080/api/v1/stream/logs?"));
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("clusterId"), "cluster-1");
    assert.equal(parsed.searchParams.get("namespace"), "prod");
    assert.equal(parsed.searchParams.get("kind"), "Pod");
    assert.equal(parsed.searchParams.get("name"), "web-0");
    assert.equal(parsed.searchParams.get("container"), "api");
    assert.equal(parsed.searchParams.get("tailLines"), "50");
    assert.equal(parsed.searchParams.get("follow"), "true");
    assert.equal(parsed.searchParams.get("previous"), "true");
    assert.equal(parsed.searchParams.get("timestamps"), "true");
    assert.equal(parsed.searchParams.get("sinceSeconds"), "300");
  });

  it("handles normalized log, diagnostic, status, end, and disconnect frames with sequence dedup", () => {
    const seen = new Set<string>();
    let state = createInitialLogStreamState("streaming");

    state = applyNormalizedLogFrame(
      state,
      {
        type: "log",
        streamId: "s-1",
        sequence: 1,
        timestamp: "2026-11-27T12:00:00Z",
        namespace: "prod",
        pod: "web-0",
        container: "app",
        level: "INFO",
        message: "boot complete",
      },
      "web-0",
      "prod",
      100,
      seen
    );
    assert.equal(state.logs.length, 1);
    assert.equal(state.streamId, "s-1");

    // Duplicate sequence is ignored without duplicating rendered lines
    state = applyNormalizedLogFrame(
      state,
      {
        type: "log",
        streamId: "s-1",
        sequence: 1,
        timestamp: "2026-11-27T12:00:00Z",
        message: "boot complete",
      },
      "web-0",
      "prod",
      100,
      seen
    );
    assert.equal(state.logs.length, 1);

    // Sequence gap (#1 -> #5) surfaces an explicit backpressure diagnostic cleanly
    state = applyNormalizedLogFrame(
      state,
      {
        type: "log",
        streamId: "s-1",
        sequence: 5,
        timestamp: "2026-11-27T12:00:01Z",
        message: "after burst",
      },
      "web-0",
      "prod",
      100,
      seen
    );
    assert.equal(state.logs.length, 2);
    assert.equal(state.lastSequence, 5);
    assert.ok(
      state.diagnostics.some(
        (d) => d.status === "backpressure" && d.code === "sequence_gap" && d.reason.includes("3 frame(s) missed")
      )
    );

    state = applyNormalizedLogFrame(
      state,
      {
        type: "end",
        streamId: "s-1",
        status: "ended",
        reason: "Stream completed",
      },
      "web-0",
      "prod",
      100,
      seen
    );
    assert.equal(state.status, "ended");

    state = applyNormalizedLogFrame(
      state,
      {
        type: "error",
        streamId: "s-1",
        status: "interrupted",
        code: "agent_disconnected",
        reason: "Agent WebSocket disconnected",
      },
      "web-0",
      "prod",
      100,
      seen
    );
    assert.equal(state.status, "disconnected");
    assert.equal(state.streamError, "Agent WebSocket disconnected");
    assert.ok(state.diagnostics.some((d) => d.status === "disconnected" && d.code === "agent_disconnected"));
  });
});

