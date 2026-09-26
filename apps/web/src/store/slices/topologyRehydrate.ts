import type { Cluster } from "../types/topologyTypes";
import type { TopologyState } from "../useTopologyStore";

export const handleRehydrateStorage = () => (state: TopologyState | undefined) => {
  if (!state) return;
  let needsUpdate = false;
  const parsedClusters: Cluster[] = [];
  for (const c of (state.clusters || [])) {
    if (typeof c === "string") {
      if (c && c !== "mini-todo") parsedClusters.push({ id: `migrated-${Date.now()}`, name: c });
      needsUpdate = true;
    } else if (c && c.name && c.name !== "mini-todo") {
      parsedClusters.push(c);
    } else {
      needsUpdate = true;
    }
  }

  const cleanedActive = state.activeCluster === "mini-todo" ? parsedClusters[0]?.name || "" : state.activeCluster;
  if (state.activeCluster === "mini-todo") needsUpdate = true;

  if (needsUpdate) {
    state.clusters = parsedClusters;
    state.activeCluster = cleanedActive;
  }
};
