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
import {
  MdDns as Server,
  MdGridView as LayoutGrid,
  MdFilterCenterFocus as Focus,
} from "react-icons/md";

import { K8sPodNode, K8sWorkerNode, K8sServiceNode, K8sWorkloadNode, K8sIngressNode } from "../canvas";
import type { K8sPodData } from "../canvas/K8sPod";
import type { K8sNodeData } from "../canvas/K8sNode";
import type { K8sServiceData } from "../canvas/K8sService";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { SelectedTarget } from "../drawer/InspectorDrawer";
import { useK8sStream, type WsTopologyMessage } from "../../hooks/useK8sStream";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { DeleteConfirmationModal } from "../modals/DeleteConfirmationModal";

const nodeTypes = {
  k8sPod: K8sPodNode,
  k8sWorker: K8sWorkerNode,
  k8sService: K8sServiceNode,
  k8sDeployment: K8sWorkloadNode,
  k8sReplicaSet: K8sWorkloadNode,
  k8sStatefulSet: K8sWorkloadNode,
  k8sWorkload: K8sWorkloadNode,
  k8sIngress: K8sIngressNode,
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
  const deleteModal = useTopologyStore((s) => s.deleteModal);
  const closeDeleteModal = useTopologyStore((s) => s.closeDeleteModal);

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
    applyDagreLayout("LR");
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

  const handleAutoLayout = () => {
    applyDagreLayout("LR");
    setTimeout(() => {
      fitView({ duration: 400, padding: 0.11, maxZoom: 0.92 });
    }, 50);
  };

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        deleteKeyCode={["Delete", "Backspace"]}
        fitView
        fitViewOptions={{ padding: 0.11, maxZoom: 0.92 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "bezier",
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
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shadow-2xl mb-4 animate-pulse">
            <Server className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-semibold text-neutral-200 mb-1">
            No Active Kubernetes Topology
          </h3>
          <p className="text-xs text-neutral-400 max-w-sm mb-4">
            Connect a cluster or start your local Minikube environment to stream real-time Pods, Nodes, and Ingress resources.
          </p>
        </div>
      )}

      {/* Top Right Canvas Actions Capsule (Auto Layout + Recenter View) */}
      <div className="absolute top-24 right-6 z-40 flex flex-col gap-2 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-800 p-2 shadow-2xl">
        <button
          onClick={handleAutoLayout}
          className="flex items-center gap-2 rounded-xl bg-neutral-950/80 border border-neutral-800/80 px-3.5 py-2 text-xs font-semibold text-neutral-200 shadow-md hover:border-blue-500/50 hover:bg-neutral-800/80 hover:text-blue-400 transition-all active:scale-95"
          title="Auto Layout Topology Graph (Dagre Engine)"
        >
          <LayoutGrid className="h-4 w-4 text-blue-400" />
          <span>Auto Layout</span>
        </button>

        <button
          onClick={handleRecenterView}
          className="flex items-center gap-2 rounded-xl bg-neutral-950/80 border border-neutral-800/80 px-3.5 py-2 text-xs font-semibold text-neutral-200 shadow-md hover:border-blue-500/50 hover:bg-neutral-800/80 hover:text-blue-400 transition-all active:scale-95"
          title="Fit / Center Graph View"
        >
          <Focus className="h-4 w-4 text-blue-400" />
          <span>Recenter View</span>
        </button>
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
