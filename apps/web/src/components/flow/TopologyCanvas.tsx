import { useEffect, useRef, useCallback } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Icon } from "../ui/Icon";
import {
  mdiServer,
  mdiViewGrid,
  mdiCrosshairsGps,
} from "@mdi/js";

import { K8sPodNode, K8sWorkerNode, K8sServiceNode, K8sWorkloadNode, K8sIngressNode, K8sGroupNode, K8sDaemonSetNode, K8sCronJobNode, K8sJobNode, K8sCompletedJobsNode, K8sPVCNode, K8sEdge } from "../canvas";
import type { K8sPodData } from "../canvas/K8sPod";
import type { K8sNodeData } from "../canvas/K8sNode";
import type { K8sServiceData } from "../canvas/K8sService";
import type { K8sIngressData } from "../canvas/K8sIngress";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useUIStore } from "../../store/useUIStore";
import type { SelectedTarget } from "../drawer/InspectorDrawer";
import { useK8sStream, type WsTopologyMessage } from "../../hooks/useK8sStream";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useClusterLayoutPersistence } from "../../hooks/useClusterLayoutPersistence";
import { DeleteConfirmationModal } from "../modals/DeleteConfirmationModal";

import type { K8sDaemonSetData, K8sCronJobData, K8sJobData, K8sPVCData } from "../../store/types/topologyTypes";

const nodeTypes = {
  k8sPod: K8sPodNode,
  k8sWorker: K8sWorkerNode,
  k8sService: K8sServiceNode,
  k8sDeployment: K8sWorkloadNode,
  k8sReplicaSet: K8sWorkloadNode,
  k8sStatefulSet: K8sWorkloadNode,
  k8sDaemonSet: K8sDaemonSetNode,
  k8sCronJob: K8sCronJobNode,
  k8sJob: K8sJobNode,
  k8sCompletedJobs: K8sCompletedJobsNode,
  k8sPVC: K8sPVCNode,
  k8sWorkload: K8sWorkloadNode,
  k8sIngress: K8sIngressNode,
  k8sGroup: K8sGroupNode,
};

const edgeTypes = {
  argo: K8sEdge,
  k8sEdge: K8sEdge,
};

interface TopologyCanvasProps {
  onSelectTarget: (target: SelectedTarget) => void;
}

function TopologyCanvasContent({ onSelectTarget }: TopologyCanvasProps) {
  useKeyboardShortcuts();
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const onNodesChange = useTopologyStore((s) => s.onNodesChange);
  const onEdgesChange = useTopologyStore((s) => s.onEdgesChange);
  const onConnect = useTopologyStore((s) => s.onConnect);
  const applyDagreLayout = useTopologyStore((s) => s.applyDagreLayout);
  const applyDelta = useTopologyStore((s) => s.applyDelta);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const setWsStatus = useTopologyStore((s) => s.setWsStatus);
  const jobs = useTopologyStore((s) => s.jobs);
  const deleteModal = useUIStore((s) => s.deleteModal);
  const closeDeleteModal = useUIStore((s) => s.closeDeleteModal);

  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const setLayoutDirection = useUIStore((s) => s.setLayoutDirection);
  const showCompletedJobs = useUIStore((s) => s.showCompletedJobs);
  const setShowCompletedJobs = useUIStore((s) => s.setShowCompletedJobs);
  const showStorage = useUIStore((s) => s.showStorage);
  const setShowStorage = useUIStore((s) => s.setShowStorage);

  const completedJobsCount = (jobs || []).filter(
    (j) => (j.succeeded ?? 0) >= (j.completions ?? 1) || (j.active === 0 && (j.failed ?? 0) === 0)
  ).length;

  const { fitView } = useReactFlow();

  const handleWsMessage = useCallback(
    (msg: WsTopologyMessage) => {
      applyDelta(msg);
    },
    [applyDelta]
  );

  const { status, latencyMs } = useK8sStream(handleWsMessage);

  useEffect(() => {
    setWsStatus(status, latencyMs);
  }, [status, latencyMs, setWsStatus]);

  useEffect(() => {
    applyDagreLayout();
  }, [applyDagreLayout]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      let target: SelectedTarget = null;
      if (node.type === "k8sPod") {
        target = { type: "pod", data: node.data as K8sPodData };
      } else if (node.type === "k8sWorker") {
        target = { type: "node", data: node.data as K8sNodeData };
      } else if (node.type === "k8sService") {
        target = { type: "service", data: node.data as K8sServiceData };
      } else if (node.type === "k8sIngress") {
        target = { type: "ingress", data: node.data as K8sIngressData };
      } else if (node.type === "k8sDaemonSet") {
        target = { type: "daemonset", data: node.data as K8sDaemonSetData };
      } else if (node.type === "k8sCronJob") {
        target = { type: "cronjob", data: node.data as K8sCronJobData };
      } else if (node.type === "k8sJob") {
        target = { type: "job", data: node.data as K8sJobData };
      } else if (node.type === "k8sPVC") {
        target = { type: "pvc", data: node.data as K8sPVCData };
      } else if (node.type === "k8sGroup") {
        const groupData = node.data as { name?: string; podSummaries?: Array<{ podData?: K8sPodData }>; pods?: K8sPodData[] };
        const firstPod = groupData.podSummaries?.[0]?.podData || groupData.pods?.[0];
        if (firstPod) {
          target = { type: "pod", data: { ...firstPod, ownerName: groupData.name } };
        }
      } else if (node.type === "k8sWorkload") {
        const wData = node.data as { name?: string; pods?: K8sPodData[] };
        if (wData.pods && wData.pods[0]) {
          target = { type: "pod", data: { ...wData.pods[0], ownerName: wData.name } };
        }
      }
      setSelectedNode(target);
      onSelectTarget(target);
    },
    [setSelectedNode, onSelectTarget]
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    onSelectTarget(null);
  }, [setSelectedNode, onSelectTarget]);

  const {
    handleNodeDragStop,
    handleAutoLayoutReset,
    hasCustomPositions,
  } = useClusterLayoutPersistence({
    onLayoutReset: () => {
      setTimeout(() => {
        fitView({ duration: 400, padding: 0.11, maxZoom: 0.92 });
      }, 50);
    },
  });

  const handleRecenterView = () => {
    fitView({ duration: 400, padding: 0.11, maxZoom: 0.92 });
  };

  const initialLayoutDone = useRef(false);

  useEffect(() => {
    if (nodes.length > 0) {
      if (!initialLayoutDone.current) {
        setTimeout(() => {
          fitView({ duration: 400, padding: 0.11, maxZoom: 0.92 });
        }, 100);
        initialLayoutDone.current = true;
      }
    }
  }, [nodes.length, fitView]);

  return (
    <div className="h-screen w-screen bg-[#09090b] relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        deleteKeyCode={["Delete", "Backspace"]}
        fitView
        fitViewOptions={{ padding: 0.11, maxZoom: 0.92 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "argo",
          style: { stroke: "#3f3f46", strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#3f3f46",
          },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
      </ReactFlow>

      {/* Empty State Overlay when no active cluster nodes are present */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-4">
            <Icon path={mdiServer} size={1.8} />
          </div>
          <h3 className="text-lg font-semibold text-neutral-200 mb-1 font-heading">
            No Active Kubernetes Topology
          </h3>
          <p className="text-xs text-neutral-400 max-w-sm mb-4">
            Connect a cluster or start your local Minikube environment to stream real-time Pods, Nodes, and Ingress resources.
          </p>
        </div>
      )}

      {/* Top Right Canvas Actions Capsule (Layout Direction Toggle + Auto Layout + Recenter View) */}
      <div className="absolute top-20 right-6 z-40 flex flex-col gap-1.5 rounded-2xl bg-surface border border-neutral-800 p-2">
        {/* Layout Direction Segmented Pill */}
        <div className="flex items-center rounded-lg bg-background border border-neutral-800 p-0.5 text-xs font-medium select-none">
          <button
            onClick={() => {
              if (layoutDirection !== "TB") {
                setLayoutDirection("TB");
                setTimeout(() => fitView({ duration: 400, padding: 0.11, maxZoom: 0.92 }), 50);
              }
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              layoutDirection === "TB"
                ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold shadow-xs"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent"
            }`}
            title="Switch to Vertical Layout (Top-to-Bottom)"
          >
            <span className="font-bold">↕</span>
            <span>Vertical</span>
          </button>
          <button
            onClick={() => {
              if (layoutDirection !== "LR") {
                setLayoutDirection("LR");
                setTimeout(() => fitView({ duration: 400, padding: 0.11, maxZoom: 0.92 }), 50);
              }
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              layoutDirection === "LR"
                ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold shadow-xs"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent"
            }`}
            title="Switch to Horizontal Layout (Left-to-Right)"
          >
            <span className="font-bold">↔</span>
            <span>Horizontal</span>
          </button>
        </div>

        <button
          onClick={handleAutoLayoutReset}
          className="flex items-center justify-between gap-2 rounded-md bg-background border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-blue-500/50 hover:bg-neutral-800 hover:text-blue-400 transition-colors font-heading cursor-pointer"
          title={hasCustomPositions ? "Reset to Auto Layout (Dagre Engine)" : "Auto Layout Topology Graph (Dagre Engine)"}
        >
          <div className="flex items-center gap-2">
            <Icon path={mdiViewGrid} size={0.65} className="text-blue-400" />
            <span>Auto Layout</span>
          </div>
          {hasCustomPositions && (
            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Reset
            </span>
          )}
        </button>

        <button
          onClick={handleRecenterView}
          className="flex items-center gap-2 rounded-md bg-background border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-blue-500/50 hover:bg-neutral-800 hover:text-blue-400 transition-colors font-heading cursor-pointer"
          title="Fit / Center Graph View"
        >
          <Icon path={mdiCrosshairsGps} size={0.65} className="text-blue-400" />
          <span>Recenter View</span>
        </button>

        <button
          onClick={() => setShowStorage(!showStorage)}
          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors font-heading cursor-pointer ${
            showStorage
              ? "border-cyan-500/50 bg-cyan-950/20 text-cyan-400"
              : "bg-background border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
          }`}
          title={showStorage ? "Hide Storage (PVC) Nodes" : "Show Storage (PVC) Nodes"}
        >
          <span className={showStorage ? "text-cyan-400 font-bold" : "text-neutral-500"}>💾</span>
          <span>{showStorage ? "Storage Visible" : "Storage Hidden"}</span>
        </button>

        {completedJobsCount > 0 && (
          <button
            onClick={() => setShowCompletedJobs(!showCompletedJobs)}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors font-heading cursor-pointer ${
              showCompletedJobs
                ? "border-emerald-500/50 bg-emerald-950/20 text-emerald-400"
                : "bg-background border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
            title={showCompletedJobs ? "Collapse Completed Jobs" : "Show Completed Jobs"}
          >
            <span className={showCompletedJobs ? "text-emerald-400 font-bold" : "text-neutral-500"}>✓</span>
            <span>{showCompletedJobs ? "Hide Done Jobs" : "Show Done Jobs"}</span>
            <span className="text-[10px] font-mono px-1 rounded bg-neutral-800 border border-neutral-700 text-neutral-300">
              {completedJobsCount}
            </span>
          </button>
        )}
      </div>

      {/* Delete Intent Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={deleteModal.isOpen}
        onClose={closeDeleteModal}
        targetId={deleteModal.targetId}
        targetName={deleteModal.targetName}
        targetKind={deleteModal.targetKind}
        namespace={deleteModal.namespace}
      />
    </div>
  );
}


export function TopologyCanvas(props: TopologyCanvasProps) {
  return <TopologyCanvasContent {...props} />;
}
