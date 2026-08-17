import {
  Background,
  Controls,
  ReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const initialNodes: Node[] = [
  {
    id: "cluster",
    position: { x: 250, y: 100 },
    data: { label: "Kubernetes Cluster" },
  },
];

const initialEdges: Edge[] = [];

export function TopologyCanvas() {
  return (
    <div className="h-[500px] w-full rounded-xl border border-cyan-400/20 bg-slate-950/60">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        fitView
        minZoom={0.5}
        maxZoom={2}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
