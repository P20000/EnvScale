import { useEffect, useState, useRef, useCallback } from "react";

interface MotionNode {
  id: string;
  kind: "ING" | "SVC" | "DEPLOY" | "POD";
  label: string;
  metric: string;
  x: number;
  y: number;
  visible: boolean;
}

interface MotionEdge {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  visible: boolean;
}

interface TreeCluster {
  id: string;
  quadrant: 0 | 1 | 2 | 3;
  phase: number; // 0: root appearing, 1: child 1 branching, 2: child 2 branching, 3: mature, 4: fading
  createdAt: number;
  fading: boolean;
  nodes: MotionNode[];
  edges: MotionEdge[];
}

const ROOT_SERVICES = [
  { kind: "ING", name: "ing/ingress-edge", metric: "< 2ms" },
  { kind: "SVC", name: "svc/gateway-api", metric: "Active" },
  { kind: "SVC", name: "svc/auth-core", metric: "Healthy" },
  { kind: "SVC", name: "svc/streamer-hub", metric: "Sub-200ms" },
  { kind: "SVC", name: "svc/metric-collector", metric: "99.9%" },
  { kind: "ING", name: "ing/traefik-proxy", metric: "Online" },
] as const;

const CHILD_WORKERS = [
  { kind: "DEPLOY", name: "deploy/auth-engine", metric: "3/3" },
  { kind: "DEPLOY", name: "deploy/streamer-gw", metric: "2/2" },
  { kind: "DEPLOY", name: "deploy/redis-mesh", metric: "Active" },
  { kind: "POD", name: "pod/auth-87df", metric: "Running" },
  { kind: "POD", name: "pod/streamer-x1", metric: "Running" },
  { kind: "POD", name: "pod/worker-c4", metric: "Live" },
  { kind: "POD", name: "pod/collector-9a", metric: "Ready" },
  { kind: "POD", name: "pod/vault-sync", metric: "Running" },
  { kind: "POD", name: "pod/informer-queue", metric: "Running" },
] as const;

export function LandingTopologyMotion() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 650 });
  const [clusters, setClusters] = useState<TreeCluster[]>([]);
  const idCounter = useRef(0);

  // Measure container dimensions
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Generate a distinct tree blueprint for a given quadrant
  const createBlueprint = useCallback(
    (quadrant: 0 | 1 | 2 | 3, w: number, h: number): TreeCluster => {
      const cx = w / 2;
      const cy = h / 2;

      // Small natural random offsets (+/- 15px)
      const jitterX = (Math.random() - 0.5) * 30;
      const jitterY = (Math.random() - 0.5) * 25;

      // Safe outer positioning ensuring >= 280px distance from center
      let rootX: number;
      let rootY: number;
      let c1X: number;
      let c1Y: number;
      let c2X: number;
      let c2Y: number;

      // Layout geometry per quadrant (Tree branches horizontally or vertically away from center)
      if (quadrant === 0) {
        // Top-Left: Root at outer left, children branch rightward towards perimeter boundary
        rootX = Math.max(cx - 430 + jitterX, 90);
        rootY = Math.max(cy - 120 + jitterY, 60);
        c1X = rootX + 140;
        c1Y = rootY - 48;
        c2X = rootX + 140;
        c2Y = rootY + 48;
      } else if (quadrant === 1) {
        // Top-Right: Root at inner-right boundary, children branch outward right
        rootX = Math.min(cx + 290 + jitterX, w - 240);
        rootY = Math.max(cy - 120 + jitterY, 60);
        c1X = rootX + 140;
        c1Y = rootY - 48;
        c2X = rootX + 140;
        c2Y = rootY + 48;
      } else if (quadrant === 2) {
        // Bottom-Left: Root at outer left, children branch towards bottom-left
        rootX = Math.max(cx - 430 + jitterX, 90);
        rootY = Math.min(cy + 130 + jitterY, h - 80);
        c1X = rootX + 140;
        c1Y = rootY - 48;
        c2X = rootX + 140;
        c2Y = rootY + 48;
      } else {
        // Bottom-Right: Root at inner-right, children branch outward
        rootX = Math.min(cx + 290 + jitterX, w - 240);
        rootY = Math.min(cy + 130 + jitterY, h - 80);
        c1X = rootX + 140;
        c1Y = rootY - 48;
        c2X = rootX + 140;
        c2Y = rootY + 48;
      }

      const rootSpec =
        ROOT_SERVICES[Math.floor(Math.random() * ROOT_SERVICES.length)];
      const childSpec1 =
        CHILD_WORKERS[Math.floor(Math.random() * CHILD_WORKERS.length)];
      let childSpec2 =
        CHILD_WORKERS[Math.floor(Math.random() * CHILD_WORKERS.length)];
      if (childSpec2.name === childSpec1.name) {
        childSpec2 = CHILD_WORKERS[(CHILD_WORKERS.indexOf(childSpec1) + 1) % CHILD_WORKERS.length];
      }

      const clusterId = `cluster-${quadrant}-${++idCounter.current}`;
      const rId = `node-${++idCounter.current}`;
      const c1Id = `node-${++idCounter.current}`;
      const c2Id = `node-${++idCounter.current}`;

      const rootNode: MotionNode = {
        id: rId,
        kind: rootSpec.kind,
        label: rootSpec.name,
        metric: rootSpec.metric,
        x: rootX,
        y: rootY,
        visible: false,
      };

      const child1: MotionNode = {
        id: c1Id,
        kind: childSpec1.kind,
        label: childSpec1.name,
        metric: childSpec1.metric,
        x: c1X,
        y: c1Y,
        visible: false,
      };

      const child2: MotionNode = {
        id: c2Id,
        kind: childSpec2.kind,
        label: childSpec2.name,
        metric: childSpec2.metric,
        x: c2X,
        y: c2Y,
        visible: false,
      };

      const edge1: MotionEdge = {
        id: `edge-${rId}-${c1Id}`,
        sourceX: rootX,
        sourceY: rootY,
        targetX: c1X,
        targetY: c1Y,
        visible: false,
      };

      const edge2: MotionEdge = {
        id: `edge-${rId}-${c2Id}`,
        sourceX: rootX,
        sourceY: rootY,
        targetX: c2X,
        targetY: c2Y,
        visible: false,
      };

      return {
        id: clusterId,
        quadrant,
        phase: 0,
        createdAt: Date.now(),
        fading: false,
        nodes: [rootNode, child1, child2],
        edges: [edge1, edge2],
      };
    },
    []
  );

  // Initialize and run the lifecycle of trees across the 4 quadrants
  useEffect(() => {
    const { width, height } = dimensions;
    if (width < 320 || height < 300) return;

    // Seed 4 initial clusters with staggered phases for organic feel
    const initial: TreeCluster[] = [
      { ...createBlueprint(0, width, height), phase: 2 }, // Top-Left: fully grown
      { ...createBlueprint(1, width, height), phase: 1 }, // Top-Right: 1st child branching
      { ...createBlueprint(2, width, height), phase: 0 }, // Bottom-Left: root just appeared
      { ...createBlueprint(3, width, height), phase: 3 }, // Bottom-Right: mature
    ];

    const initTimer = setTimeout(() => {
      setClusters(initial);
    }, 0);

    // Dynamic progression ticker
    const timer = setInterval(() => {
      setClusters((prev) =>
        prev.map((cluster) => {
          const now = Date.now();
          const age = now - cluster.createdAt;

          // If cluster has aged past 15 seconds, fade it out
          if (age > 15000 && !cluster.fading) {
            return { ...cluster, fading: true };
          }

          // If fully faded, respawn fresh tree blueprint in this quadrant
          if (cluster.fading && age > 17000) {
            return createBlueprint(cluster.quadrant, width, height);
          }

          // Advance iterative phase (root -> child 1 -> child 2)
          if (cluster.phase < 3 && !cluster.fading) {
            return { ...cluster, phase: cluster.phase + 1 };
          }

          return cluster;
        })
      );
    }, 1600);

    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [dimensions, createBlueprint]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 w-full h-full overflow-hidden"
    >
      {/* SVG Connecting Edges Layer */}
      <svg className="w-full h-full absolute inset-0">
        <defs>
          <linearGradient id="topologyLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {clusters.map((cluster) =>
          cluster.edges.map((edge, idx) => {
            // Edge becomes visible as cluster phase unlocks it
            const isEdgeVisible = cluster.phase >= idx + 1 && !cluster.fading;
            const midX = (edge.sourceX + edge.targetX) / 2;

            // Smooth horizontal stepped cubic curve
            const d = `M ${edge.sourceX} ${edge.sourceY} C ${midX} ${edge.sourceY}, ${midX} ${edge.targetY}, ${edge.targetX} ${edge.targetY}`;

            return (
              <g
                key={edge.id}
                className="transition-opacity duration-700 ease-in-out"
                style={{ opacity: isEdgeVisible ? 1 : 0 }}
              >
                {/* Background Line Guide */}
                <path
                  d={d}
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeDasharray="3,3"
                />

                {/* Animated Flowing Signal Line */}
                <path
                  d={d}
                  fill="none"
                  stroke="url(#topologyLineGrad)"
                  strokeWidth="2"
                  strokeDasharray="4,6"
                  className="animate-topology-flow"
                />

                {/* Pulsing Junction Joint Circle */}
                <circle
                  cx={edge.targetX}
                  cy={edge.targetY}
                  r="3"
                  fill="#3B82F6"
                  className="animate-pulse"
                />
              </g>
            );
          })
        )}
      </svg>

      {/* HTML Node Micro-Cards Layer */}
      {clusters.map((cluster) =>
        cluster.nodes.map((node, nodeIdx) => {
          // Node 0 (root) visible at phase >= 0. Node 1 visible at phase >= 1. Node 2 visible at phase >= 2.
          const isNodeVisible = cluster.phase >= nodeIdx && !cluster.fading;

          const kindStyles = {
            ING: "bg-indigo-50 text-indigo-700 border-indigo-200/80",
            SVC: "bg-blue-50 text-blue-700 border-blue-200/80",
            DEPLOY: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
            POD: "bg-sky-50 text-sky-700 border-sky-200/80",
          }[node.kind];

          return (
            <div
              key={node.id}
              className="absolute transition-all duration-700 ease-out"
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                transform: `translate(-50%, -50%) scale(${
                  isNodeVisible ? 1 : 0.4
                })`,
                opacity: isNodeVisible ? 1 : 0,
              }}
            >
              <div className="flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white/95 backdrop-blur-md px-2.5 py-1.5 shadow-md shadow-blue-950/5 hover:border-blue-300">
                {/* Kind Badge */}
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-bold border ${kindStyles}`}
                >
                  {node.kind}
                </span>

                {/* Node Name */}
                <span className="font-mono text-[11px] font-semibold text-slate-800 tracking-tight whitespace-nowrap">
                  {node.label}
                </span>

                {/* Pulsing Live Status Dot */}
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>

                {/* Metric/State Tag */}
                <span className="font-mono text-[9px] text-slate-400 font-medium whitespace-nowrap">
                  {node.metric}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
