import { useState, useMemo, useEffect } from "react";
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
import { useUIStore } from "./store/useUIStore";
import ConnectClusterWizard from "./components/onboarding/ConnectClusterWizard";
import { ToastContainer } from "./components/ui/ToastContainer";
import { apiMe, apiGetWorkspaceClusters } from "./config/api";
import { useAuthStore } from "./store/useAuthStore";
import { LandingPage } from "./components/landing/LandingPage";
import { AuthBufferPage } from "./components/auth/AuthBufferPage";
import { GlobalErrorPresenter } from "./components/errors/GlobalErrorPresenter";
import { useErrorStore } from "./store/useErrorStore";

import { SYSTEM_NAMESPACES } from "./store/helpers/topologyHelpers";

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
  const selectedNamespaces = useUIStore((s) => s.selectedNamespaces);
  const showSystemNamespaces = useUIStore((s) => s.showSystemNamespaces);
  const wsReconnectTick = useTopologyStore((s) => s.wsReconnectTick);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    useAuthStore.getState().checkAuth();

    // 300s Series: Intercept dangling OAuth error params or loops
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const oauthError = searchParams.get("error") || searchParams.get("error_description");
      if (oauthError) {
        useErrorStore.getState().setError({
          status: 302,
          title: "OAuth Callback Interrupted",
          message: "Third-party authorization failed or was canceled.",
          details: oauthError,
          variant: "fullscreen",
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    async function hydrateUserWorkspace() {
      // If NOT authenticated, NEVER hydrate clusters!
      if (!isAuthenticated) {
        useTopologyStore.getState().resetStore();
        return;
      }

      const meData = await apiMe();
      const store = useTopologyStore.getState();

      if (meData?.workspace?.id) {
        const dbClusters = await apiGetWorkspaceClusters(meData.workspace.id);
        if (Array.isArray(dbClusters)) {
          const workspaceClusters = dbClusters
            .filter((c: { id?: string; name?: string }) => Boolean(c?.id && c?.name))
            .map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
          store.setClusters(workspaceClusters);
          return;
        }
      }

      // If user has no workspace or workspace has no clusters in DB, keep empty
      store.setClusters([]);
    }
    hydrateUserWorkspace();
  }, [wsReconnectTick, isAuthenticated]);

  const activeIncidentsCount = useMemo(() => {
    const isNsAllowed = (ns?: string) => {
      const namespace = ns || "default";
      if (Array.isArray(selectedNamespaces) && selectedNamespaces.length > 0) {
        return selectedNamespaces.includes(namespace);
      }
      return showSystemNamespaces || !SYSTEM_NAMESPACES.has(namespace);
    };

    const unhealthyPodsCount = pods.filter(
      (p) => isNsAllowed(p.namespace) && (p.status === "Failed" || (p.restarts && p.restarts > 0))
    ).length;

    const unreadAlertsCount = notifications.filter(
      (n) => isNsAllowed(n.namespace) && !n.read && (n.severity === "CRITICAL" || n.severity === "WARNING")
    ).length;

    return unhealthyPodsCount + unreadAlertsCount;
  }, [pods, notifications, selectedNamespaces, showSystemNamespaces]);

  const [loggedOutView, setLoggedOutView] = useState<"landing" | "auth-buffer">("landing");
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
  const handleClusterConnected = (newCluster: { id: string, name: string }) => {
    addCluster(newCluster);
  };

  const handleOpenLogTerminal = (
    podName: string,
    namespace?: string,
  ) => {
    const activeNs =
      namespace && namespace !== "default"
        ? namespace
        : useUIStore.getState().selectedNamespaces[0] || "default";
    setLogDrawerState({
      isOpen: true,
      podName,
      namespace: activeNs,
    });
  };

  const selectedKey = selectedNode
    ? `${selectedNode.type}-${selectedNode.data?.name || selectedNode.data?.id || "target"}`
    : "none";

  // When unauthenticated, render the landing page or the buffer auth page (neither dashboard nor landing)
  if (!isAuthenticated) {
    if (loggedOutView === "auth-buffer") {
      return (
        <div className="relative min-h-screen w-screen overflow-x-hidden bg-[#111318] font-sans text-[#E6E1E5]">
          <AuthBufferPage
            onBackToLanding={() => setLoggedOutView("landing")}
            onLoginSuccess={() => setLoggedOutView("landing")}
          />
          <GlobalErrorPresenter
            onOpenConnectModal={() => setShowConnectWizard(true)}
            onReturnToTopology={() => setActiveTab("topology")}
          />
          <ToastContainer />
        </div>
      );
    }

    return (
      <div className="relative min-h-screen w-screen overflow-x-clip bg-slate-50 font-sans text-slate-800">
        <LandingPage onGetStarted={() => setLoggedOutView("auth-buffer")} />
        <GlobalErrorPresenter
          onOpenConnectModal={() => setShowConnectWizard(true)}
          onReturnToTopology={() => setActiveTab("topology")}
        />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-[#111318] font-sans text-[#E6E1E5] select-none">
      {/* Region 1: Top Floating Navbar Capsule */}
      <TopNavbar
        activeCluster={activeCluster}
        clusters={clusters}
        onSelectCluster={(cluster) => setActiveCluster(cluster)}
        onOpenConnectModal={() => {
          if (!useAuthStore.getState().isAuthenticated) {
            useAuthStore.getState().openAuthModal("Sign in to your account or workspace to connect a new Kubernetes cluster.");
          } else {
            setShowConnectWizard(true);
          }
        }}
        activeIncidentsCount={activeIncidentsCount}
        wsLatencyMs={wsLatencyMs}
        wsStatus={wsStatus}
        onNavigateTab={(tab) => {
          setActiveTab(tab);
          if (tab !== "topology") {
            clearSelectedNode();
          }
        }}
      />

      {/* Region 2: Left Floating Sidebar Capsule */}
      <LeftSidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab !== "topology") {
            clearSelectedNode();
          }
        }}
        activeIncidentsCount={activeIncidentsCount}
      />

      {/* Region 3: Center Canvas & Auxiliary Views */}
      <main className="relative h-screen w-screen overflow-hidden bg-[#111318]">
        {activeTab === "topology" && (
          <TopologyCanvas
            onSelectTarget={(target) => setSelectedNode(target)}
          />
        )}

        {activeTab === "incidents" && <IncidentsView />}

        {activeTab === "metrics" && <MetricsView />}

        {activeTab === "leaderboard" && <LeaderboardView />}

        {activeTab === "settings" && (
          <SettingsView
            onOpenConnectModal={() => {
              if (!useAuthStore.getState().isAuthenticated) {
                useAuthStore.getState().openAuthModal("Sign in to your account or workspace to connect a new Kubernetes cluster.");
              } else {
                setShowConnectWizard(true);
              }
            }}
          />
        )}
      </main>

      {/* Region 4: Contextual Right Slide-out Inspector Drawer */}
      {activeTab === "topology" && (
        <InspectorDrawer
          key={selectedKey}
          target={selectedNode}
          onClose={() => clearSelectedNode()}
          onOpenLogTerminal={handleOpenLogTerminal}
        />
      )}

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

      {/* Global Error Fallback & Presentation System */}
      <GlobalErrorPresenter
        onOpenConnectModal={() => setShowConnectWizard(true)}
        onReturnToTopology={() => setActiveTab("topology")}
      />

      {/* Global Toast Notification System */}
      <ToastContainer />
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