import { useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, Server, Globe, Plus } from "lucide-react";

import { K8sPodNode, K8sWorkerNode, K8sServiceNode } from "../canvas";
import { useTopologyStore } from "../../store/useTopologyStore";

const nodeTypes = {
  k8sPod: K8sPodNode,
  k8sWorker: K8sWorkerNode,
  k8sService: K8sServiceNode,
};

interface TopologyCanvasProps {
  onSelectTarget: (target: { type: "pod" | "node" | "service"; data: any } | null) => void;
}

function TopologyCanvasContent({ onSelectTarget }: TopologyCanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, createNode } = useTopologyStore();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    if (node.type === "k8sPod") {
      onSelectTarget({ type: "pod", data: node.data });
    } else if (node.type === "k8sWorker") {
      onSelectTarget({ type: "node", data: node.data });
    } else if (node.type === "k8sService") {
      onSelectTarget({ type: "service", data: node.data });
    }
  };

  const handlePaneClick = () => {
    onSelectTarget(null);
  };

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
