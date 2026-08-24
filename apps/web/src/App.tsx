import { useState, useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";

import { TopNavbar } from "./components/layout/TopNavbar";
import { LeftSidebar, type NavTab } from "./components/layout/LeftSidebar";
import { TopologyCanvas } from "./components/flow/TopologyCanvas";
import { InspectorDrawer } from "./components/drawer/InspectorDrawer";
import { PodLogDrawer } from "./components/drawer/PodLogDrawer";
import { IncidentsView } from "./components/views/IncidentsView";
import { MetricsView } from "./components/views/MetricsView";
import { LeaderboardView } from "./components/views/LeaderboardView";
import { SettingsView } from "./components/views/SettingsView";
import { useTopologyStore } from "./store/useTopologyStore";
import ConnectClusterWizard from "./components/onboarding/ConnectClusterWizard";
import { KubectlTerminal } from "./components/terminal/KubectlTerminal";

import "@xyflow/react/dist/style.css";
import "./index.css";

function AppContent() {
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const clusters = useTopologyStore((s) => s.clusters);
  const setActiveCluster = useTopologyStore((s) => s.setActiveCluster);
  const addCluster = useTopologyStore((s) => s.addCluster);
  const wsStatus = useTopologyStore((s) => s.wsStatus);
  const wsLatencyMs = useTopologyStore((s) => s.wsLatencyMs);
  const selectedNode = useTopologyStore((s) => s.selectedNode);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const clearSelectedNode = useTopologyStore((s) => s.clearSelectedNode);
  const pods = useTopologyStore((s) => s.pods);
  const notifications = useTopologyStore((s) => s.notifications);

  const activeIncidentsCount = useMemo(() => {
    const unhealthyPodsCount = pods.filter(
      (p) => p.status === "Failed" || (p.restarts && p.restarts > 0)
    ).length;

    const unreadAlertsCount = notifications.filter(
      (n) => !n.read && (n.severity === "CRITICAL" || n.severity === "WARNING")
    ).length;

    return unhealthyPodsCount + unreadAlertsCount;
  }, [pods, notifications]);

  const [activeTab, setActiveTab] = useState<NavTab>("topology");
  const [showConnectWizard, setShowConnectWizard] = useState(false);

  const [logDrawerState, setLogDrawerState] = useState<{
    isOpen: boolean;
    podName: string | null;
    namespace?: string;
  }>({
    isOpen: false,
    podName: null,
  });
  const handleClusterConnected = (newClusterName: string) => {
    addCluster(newClusterName);
  };

  const handleOpenLogTerminal = (
    podName: string,
    namespace?: string,
  ) => {
    setLogDrawerState({
      isOpen: true,
      podName,
      namespace: namespace || "default",
    });
  };

  const selectedKey = selectedNode
    ? `${selectedNode.type}-${selectedNode.data?.name || selectedNode.data?.id || "target"}`
    : "none";

  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-[#09090b] font-sans text-neutral-100 select-none">
      {/* Region 1: Top Floating Navbar Capsule */}
      <TopNavbar
        activeCluster={activeCluster}
        clusters={clusters}
        onSelectCluster={(cluster) => setActiveCluster(cluster)}
        onOpenConnectModal={() => setShowConnectWizard(true)}
        activeIncidentsCount={activeIncidentsCount}
        wsLatencyMs={wsLatencyMs}
        wsStatus={wsStatus}
      />

      {/* Region 2: Left Floating Sidebar Capsule */}
      <LeftSidebar
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        activeIncidentsCount={activeIncidentsCount}
      />

      {/* Region 3: Center Canvas & Auxiliary Views */}
      <main className="relative h-screen w-screen overflow-hidden bg-[#09090b]">
        {activeTab === "topology" && (
          <TopologyCanvas
            onSelectTarget={(target) => setSelectedNode(target)}
          />
        )}

        {activeTab === "incidents" && <IncidentsView />}

        {activeTab === "metrics" && <MetricsView />}

        {activeTab === "leaderboard" && <LeaderboardView />}

        {activeTab === "settings" && <SettingsView />}
      </main>

      {/* Region 4: Contextual Right Slide-out Inspector Drawer */}
      <InspectorDrawer
        key={selectedKey}
        target={selectedNode}
        onClose={() => clearSelectedNode()}
        onOpenLogTerminal={handleOpenLogTerminal}
      />

      {/* Region 5: Pod Log Terminal Drawer */}
      <PodLogDrawer
        isOpen={logDrawerState.isOpen}
        podName={logDrawerState.podName}
        namespace={logDrawerState.namespace}
        onClose={() =>
          setLogDrawerState((prev) => ({
            ...prev,
            isOpen: false,
          }))
        }
      />

      {/* ISH-01: Connect Cluster Onboarding Wizard */}
      {showConnectWizard && (
        <ConnectClusterWizard
          onClose={() => setShowConnectWizard(false)}
          onClusterConnected={handleClusterConnected}
        />
      )}

      {/* Bottom-Left Kubectl Web Terminal Shell */}
      <KubectlTerminal />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}