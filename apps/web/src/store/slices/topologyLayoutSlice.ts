import type { TopologyState } from "../useTopologyStore";
import { useUIStore } from "../useUIStore";
import { getLayoutedElements } from "../../utils/layout";
import { aggregateNodesWithWorkloads, generateDynamicEdges } from "../helpers/topologyHelpers";
import { filterPVCsForDisplay, createPVCReactFlowNodes } from "../helpers/storageHelpers";

export function handleApplyDagreLayout(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  direction?: "TB" | "LR",
  options?: { resetUserPositions?: boolean }
) {
  if (options?.resetUserPositions) {
    set({ userNodePositions: {} });
  }

  const {
    layoutDirection,
    showCompletedPods,
    showCompletedJobs,
    showStorage,
    showSystemNamespaces,
    selectedNamespaces,
  } = useUIStore.getState();

  const targetDir = direction || layoutDirection || "TB";
  const {
    rawNodes,
    nodes,
    edges,
    deployments,
    replicaSets,
    daemonSets,
    cronJobs,
    jobs,
    pvcs,
    hpas,
    networkPolicies,
    pdbs,
  } = get();

  const baseNodes = rawNodes && rawNodes.length > 0 ? rawNodes : nodes;
  if (
    baseNodes.length === 0 &&
    (!daemonSets || daemonSets.length === 0) &&
    (!cronJobs || cronJobs.length === 0) &&
    (!jobs || jobs.length === 0) &&
    (!pvcs || pvcs.length === 0)
  ) {
    return;
  }

  const aggregatedNodes = aggregateNodesWithWorkloads(
    baseNodes,
    showCompletedPods,
    showSystemNamespaces,
    selectedNamespaces,
    deployments,
    replicaSets,
    daemonSets,
    cronJobs,
    jobs,
    showCompletedJobs,
    hpas,
    networkPolicies,
    pdbs
  );

  const visiblePVCs = filterPVCsForDisplay(pvcs, showStorage, showSystemNamespaces, selectedNamespaces);
  const pvcNodes = createPVCReactFlowNodes(visiblePVCs);

  // Preserve existing live positions and dragging states from active canvas nodes
  const existingNodeMap = new Map((nodes || []).map((n) => [n.id, n]));
  const allCanvasNodes = [...aggregatedNodes, ...pvcNodes].map((node) => {
    const existing = existingNodeMap.get(node.id);
    if (existing) {
      return {
        ...node,
        position: existing.position,
        dragging: existing.dragging,
      };
    }
    return node;
  });

  const dynamicEdges = generateDynamicEdges(allCanvasNodes, edges);
  const effectivePositions = options?.resetUserPositions ? {} : get().userNodePositions;

  const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
    allCanvasNodes,
    dynamicEdges,
    targetDir,
    effectivePositions
  );

  set({ nodes: layoutedNodes, edges: layoutedEdges });
}
