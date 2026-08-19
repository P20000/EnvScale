import { useState, useEffect, useRef, useCallback } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, Server, Globe, Plus, LayoutGrid } from "lucide-react";

import { K8sPodNode, K8sWorkerNode, K8sServiceNode } from "../canvas";
import type { K8sPodData } from "../canvas/K8sPod";
import type { K8sNodeData } from "../canvas/K8sNode";
import type { K8sServiceData } from "../canvas/K8sService";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { SelectedTarget } from "../drawer/InspectorDrawer";
import { useK8sStream, type WsTopologyMessage } from "../../hooks/useK8sStream";

const nodeTypes = {
  k8sPod: K8sPodNode,
  k8sWorker: K8sWorkerNode,
  k8sService: K8sServiceNode,
};

interface TopologyCanvasProps {
  onSelectTarget: (target: SelectedTarget) => void;
}

function TopologyCanvasContent({ onSelectTarget }: TopologyCanvasProps) {
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const onNodesChange = useTopologyStore((s) => s.onNodesChange);
  const onEdgesChange = useTopologyStore((s) => s.onEdgesChange);
  const onConnect = useTopologyStore((s) => s.onConnect);
  const createNode = useTopologyStore((s) => s.createNode);
  const applyDagreLayout = useTopologyStore((s) => s.applyDagreLayout);
  const applyDelta = useTopologyStore((s) => s.applyDelta);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const setWsStatus = useTopologyStore((s) => s.setWsStatus);

  const [paletteOpen, setPaletteOpen] = useState(false);
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
    applyDagreLayout("TB");
    setTimeout(() => {
      fitView({ duration: 400, padding: 0.2 });
    }, 50);
  };

  const nodeIds = nodes.map((n) => n.id).join(",");
  const edgeIds = edges.map((e) => `${e.source}-${e.target}`).join(",");
  const initialLayoutDone = useRef(false);

  useEffect(() => {
    if (nodes.length > 0) {
      applyDagreLayout("TB");
      if (!initialLayoutDone.current) {
        setTimeout(() => {
          fitView({ duration: 400, padding: 0.2 });
        }, 50);
        initialLayoutDone.current = true;
      }
    }
  }, [nodeIds, edgeIds, applyDagreLayout, fitView, nodes.length]);

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
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "#3f3f46", strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#3f3f46",
          },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>

      {/* Auto Layout Action Button */}
      <div className="absolute top-24 right-6 z-40">
        <button
          onClick={handleAutoLayout}
          className="flex items-center gap-2 rounded-xl bg-[#141417] border border-neutral-800 px-3.5 py-2 text-xs font-semibold text-neutral-200 shadow-xl hover:border-blue-500/50 hover:bg-neutral-800 hover:text-blue-400 transition-all active:scale-95"
          title="Auto Layout Topology Graph (Dagre Engine)"
        >
          <LayoutGrid className="h-4 w-4 text-blue-400" />
          <span>Auto Layout</span>
        </button>
      </div>

      {/* Floating Canvas Node Toolbar / Add Shape Palette */}
      <div className="absolute bottom-6 right-6 z-40 flex items-center gap-2">
        {paletteOpen && (
          <div className="flex items-center gap-2 rounded-full bg-neutral-900/90 backdrop-blur-md border border-neutral-800 p-1.5 shadow-2xl animate-in fade-in slide-in-from-right-4 duration-200">
            <button
              onClick={() => {
                createNode("k8sPod");
                setPaletteOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-medium text-neutral-200 border border-neutral-800 hover:border-blue-500/50 hover:bg-neutral-800 transition-colors"
            >
              <Box className="h-3.5 w-3.5 text-blue-400" />
              <span>+ Pod</span>
            </button>

            <button
              onClick={() => {
                createNode("k8sWorker");
                setPaletteOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-medium text-neutral-200 border border-neutral-800 hover:border-emerald-500/50 hover:bg-neutral-800 transition-colors"
            >
              <Server className="h-3.5 w-3.5 text-emerald-400" />
              <span>+ Worker Node</span>
            </button>

            <button
              onClick={() => {
                createNode("k8sService");
                setPaletteOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-medium text-neutral-200 border border-neutral-800 hover:border-amber-500/50 hover:bg-neutral-800 transition-colors"
            >
              <Globe className="h-3.5 w-3.5 text-amber-400" />
              <span>+ Service</span>
            </button>
          </div>
        )}

        <button
          onClick={() => setPaletteOpen((prev) => !prev)}
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl transition-all hover:bg-blue-500 active:scale-95 ${
            paletteOpen ? "rotate-45 bg-neutral-800 text-neutral-300" : ""
          }`}
          title="Add Node to Canvas"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function TopologyCanvas(props: TopologyCanvasProps) {
  return <TopologyCanvasContent {...props} />;
}
