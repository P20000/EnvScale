import { useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";

import { TopNavbar } from "./components/layout/TopNavbar";
import { LeftSidebar, type NavTab } from "./components/layout/LeftSidebar";
import { ConnectClusterModal } from "./components/layout/ConnectClusterModal";
import { TopologyCanvas } from "./components/flow/TopologyCanvas";
import { InspectorDrawer, type SelectedTarget } from "./components/drawer/InspectorDrawer";

import { IncidentsView } from "./components/views/IncidentsView";
import { MetricsView } from "./components/views/MetricsView";
import { LeaderboardView } from "./components/views/LeaderboardView";
import { SettingsView } from "./components/views/SettingsView";
import { useTopologyStore } from "./store/useTopologyStore";

import "./index.css";

function AppContent() {
  const { activeCluster, clusters, setActiveCluster, addCluster, wsStatus, wsLatencyMs } =
    useTopologyStore();
  const [activeTab, setActiveTab] = useState<NavTab>("topology");
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>(null);

  const { fitView } = useReactFlow();

  const handleClusterConnected = (newClusterName: string) => {
    addCluster(newClusterName);
  };

  const handleFitView = () => {
    fitView({ duration: 400, padding: 0.2 });
  };

  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-[#09090b] text-neutral-100 font-sans select-none">
      {/* Region 1: Top Floating Navbar Capsule */}
      <TopNavbar
        activeCluster={activeCluster}
        clusters={clusters}
        onSelectCluster={(cluster) => setActiveCluster(cluster)}
        onOpenConnectModal={() => setConnectModalOpen(true)}
        onFitView={handleFitView}
        activeIncidentsCount={2}
        wsLatencyMs={wsLatencyMs}
        wsStatus={wsStatus}
      />

      {/* Region 2: Left Floating Sidebar Capsule */}
      <LeftSidebar
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
      />

      {/* Region 3: Center Canvas & Auxiliary Views */}
      <main className="relative h-screen w-screen overflow-hidden bg-[#09090b]">
        {activeTab === "topology" && (
          <TopologyCanvas onSelectTarget={(target) => setSelectedTarget(target)} />
        )}

        {activeTab === "incidents" && <IncidentsView />}

        {activeTab === "metrics" && <MetricsView />}

        {activeTab === "leaderboard" && <LeaderboardView />}

        {activeTab === "settings" && <SettingsView />}
      </main>

      {/* Region 4: Contextual Right Slide-out Inspector Drawer */}
      <InspectorDrawer
        key={selectedTarget?.data?.name || "none"}
        target={selectedTarget}
        onClose={() => setSelectedTarget(null)}
      />

      {/* Connect Cluster Modal */}
      <ConnectClusterModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        onClusterConnected={handleClusterConnected}
      />
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