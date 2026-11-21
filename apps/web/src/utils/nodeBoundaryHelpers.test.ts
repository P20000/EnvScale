import { describe, it } from "node:test";
import assert from "node:assert";
import {
  extractNodeMetadata,
  getWorkloadNodePlacement,
  calculateNodeBoundaries,
  formatNodeName,
} from "./nodeBoundaryHelpers";
import type { Node } from "@xyflow/react";

describe("nodeBoundaryHelpers", () => {
  describe("extractNodeMetadata", () => {
    it("extracts AWS EKS zone, region, instance type, and role correctly", () => {
      const labels = {
        "topology.kubernetes.io/zone": "us-east-1a",
        "topology.kubernetes.io/region": "us-east-1",
        "node.kubernetes.io/instance-type": "t3.medium",
        "node-role.kubernetes.io/worker": "",
      };

      const meta = extractNodeMetadata(labels);
      assert.strictEqual(meta.zone, "us-east-1a");
      assert.strictEqual(meta.region, "us-east-1");
      assert.strictEqual(meta.instanceType, "t3.medium");
      assert.strictEqual(meta.role, "worker");
    });

    it("detects control-plane nodes and legacy zone labels", () => {
      const labels = {
        "failure-domain.beta.kubernetes.io/zone": "us-west-2b",
        "node-role.kubernetes.io/control-plane": "",
      };

      const meta = extractNodeMetadata(labels);
      assert.strictEqual(meta.zone, "us-west-2b");
      assert.strictEqual(meta.role, "control-plane");
    });

    it("falls back gracefully when labels are empty or missing", () => {
      const meta = extractNodeMetadata(undefined);
      assert.strictEqual(meta.zone, "local-zone");
      assert.strictEqual(meta.role, "worker");
      assert.strictEqual(meta.instanceType, "standard");
    });
  });

  describe("getWorkloadNodePlacement", () => {
    it("reports single-node placement for pods on the same host", () => {
      const pods = [
        { nodeName: "ip-192-168-10-42.ec2.internal" },
        { nodeName: "ip-192-168-10-42.ec2.internal" },
      ];

      const placement = getWorkloadNodePlacement(pods);
      assert.strictEqual(placement.isMultiNode, false);
      assert.strictEqual(placement.primaryNode, "ip-192-168-10-42.ec2.internal");
      assert.deepStrictEqual(placement.nodes, ["ip-192-168-10-42.ec2.internal"]);
    });

    it("reports multi-node HA distribution when pods span multiple nodes", () => {
      const pods = [
        { nodeName: "node-1" },
        { nodeName: "node-2" },
      ];

      const placement = getWorkloadNodePlacement(pods);
      assert.strictEqual(placement.isMultiNode, true);
      assert.ok(placement.nodes.includes("node-1"));
      assert.ok(placement.nodes.includes("node-2"));
    });
  });

  describe("calculateNodeBoundaries", () => {
    it("calculates enclosing boundary dimensions for workloads scheduled on a node", () => {
      const workerNodes: Node[] = [
        {
          id: "node-worker-1",
          type: "k8sWorker",
          position: { x: 1000, y: 100 },
          data: {
            name: "worker-1",
            status: "Ready",
            cpuPct: 35,
            memoryPct: 50,
            podCapacity: 110,
            labels: {
              "topology.kubernetes.io/zone": "us-east-1a",
              "node.kubernetes.io/instance-type": "t3.medium",
            },
          },
        },
      ];

      const canvasNodes: Node[] = [
        {
          id: "group-todo-backend",
          type: "k8sGroup",
          position: { x: 100, y: 100 },
          data: {
            name: "todo-backend",
            pods: [{ nodeName: "worker-1" }],
          },
        },
        {
          id: "group-todo-redis",
          type: "k8sGroup",
          position: { x: 100, y: 300 },
          data: {
            name: "todo-redis",
            pods: [{ nodeName: "worker-1" }],
          },
        },
      ];

      const boundaries = calculateNodeBoundaries(canvasNodes, workerNodes);
      assert.strictEqual(boundaries.length, 1);
      const b = boundaries[0];
      assert.strictEqual(b.id, "boundary-worker-1");
      assert.strictEqual(b.type, "k8sNodeBoundary");
      assert.ok(b.position.x < 100);
      assert.ok(b.position.y < 100);
      assert.strictEqual((b.data as { zone: string }).zone, "us-east-1a");
      assert.strictEqual((b.data as { podCount: number }).podCount, 2);
    });
  });

  describe("formatNodeName", () => {
    it("formats AWS EKS private DNS internal hostnames to short node identifiers", () => {
      assert.strictEqual(
        formatNodeName("ip-10-100-2-229.ap-south-1.compute.internal"),
        "ip-10-100-2-229"
      );
      assert.strictEqual(
        formatNodeName("ip-172-31-0-12.ec2.internal"),
        "ip-172-31-0-12"
      );
      assert.strictEqual(
        formatNodeName("ip-10-0-1-5.us-west-2.compute.internal"),
        "ip-10-0-1-5"
      );
    });

    it("handles standard non-cloud and local node names cleanly", () => {
      assert.strictEqual(formatNodeName("minikube"), "minikube");
      assert.strictEqual(formatNodeName("k8s-worker-1"), "k8s-worker-1");
      assert.strictEqual(formatNodeName(""), "");
      assert.strictEqual(formatNodeName(undefined), "");
    });
  });
});
