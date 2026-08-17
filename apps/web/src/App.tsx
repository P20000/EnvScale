import { useCallback, useState } from "react";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import WorkflowNode, {
  type WorkflowNodeData,
} from "./components/nodes/WorkflowNode";

import ShapePalette from "./components/ShapePalette";

import "./index.css";

type ShapeType =
  | "rectangle"
  | "circle"
  | "diamond"
  | "cylinder"
  | "hexagon";

const nodeTypes = {
  workflow: WorkflowNode,
};

const initialNodes: Node<WorkflowNodeData>[] = [
  {
    id: "cluster-1",
    type: "workflow",
    position: {
      x: 450,
      y: 180,
    },
    data: {
      label: "Kubernetes Cluster",
      shape: "hexagon",
    },
  },
];

const initialEdges: Edge[] = [];

export default function App() {
  const [nodes, setNodes, onNodesChange] =
    useNodesState(initialNodes);

  const [edges, setEdges, onEdgesChange] =
    useEdgesState(initialEdges);

  const [showPalette, setShowPalette] =
    useState(false);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: {
              stroke: "#00e5ff",
              strokeWidth: 2,
            },
          },
          currentEdges,
        ),
      );
    },
    [setEdges],
  );

  const addShape = (
    shape: ShapeType,
    label: string,
  ) => {
    const id = `${shape}-${Date.now()}`;

    const newNode: Node<WorkflowNodeData> = {
      id,
      type: "workflow",
      position: {
        x: 200 + Math.random() * 700,
        y: 100 + Math.random() * 400,
      },
      data: {
        label,
        shape,
      },
    };

    setNodes((currentNodes) => [
      ...currentNodes,
      newNode,
    ]);
  };

  return (
    <div className="app-shell">

      <header className="app-header">
        <div>
          <h1>EnvScale</h1>
          <span>Kubernetes Observability Platform</span>
        </div>

        <button
          className="add-shape-button"
          onClick={() =>
            setShowPalette((visible) => !visible)
          }
        >
          <span>＋</span>
          Add Shape
        </button>
      </header>

      <main className="workflow-area">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          connectionLineStyle={{
            stroke: "#00e5ff",
            strokeWidth: 2,
          }}
        >
          <Background
            gap={30}
            size={1}
            color="#334155"
          />

          <Controls />

          <MiniMap
            nodeColor="#00e5ff"
            maskColor="rgba(8, 15, 31, 0.75)"
          />
        </ReactFlow>

        {showPalette && (
          <ShapePalette
            onAddShape={addShape}
            onClose={() =>
              setShowPalette(false)
            }
          />
        )}
      </main>
    </div>
  );
}