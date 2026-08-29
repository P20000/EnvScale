import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiTrophy,
  mdiFire,
  mdiStar,
  mdiShieldCheck,
  mdiServer,
  mdiAlert,
  mdiAccountGroup,
} from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";

export function LeaderboardView() {
  const [tab, setTab] = useState<"members" | "clusters">("clusters");
  const clusters = useTopologyStore((s) => s.clusters);

  // Existing Members Leaderboard
  const membersLeaderboard = [
    { rank: 1, name: "Pranav (Core System)", score: 985, streak: "14 Days", status: "Optimal", badge: "Gold" },
    { rank: 2, name: "Vinit (Backend CRUD)", score: 940, streak: "9 Days", status: "Optimal", badge: "Silver" },
    { rank: 3, name: "Neha (Frontend UI)", score: 915, streak: "7 Days", status: "Optimal", badge: "Bronze" },
    { rank: 4, name: "Ishika (Docs & QA)", score: 890, streak: "5 Days", status: "Warning", badge: "Participant" },
  ];

  // Dynamic Clusters Leaderboard derived from store clusters
  const clusterMetrics = clusters.map((cluster, index) => {
    const clusterName = cluster.name;
    let healthScore = 95 - (index % 5) * 6;
    let cpuPct = 38 + (index % 4) * 12;
    let memPct = 45 + (index % 5) * 10;
    let activeIncidents = index % 3 === 0 ? 1 : index % 4 === 0 ? 2 : 0;
    const podHealth = index % 2 === 0 ? "8/9 Healthy" : "12/12 Healthy";

    if (clusterName.toLowerCase().includes("prod") && index === 0) {
      healthScore = 94;
      cpuPct = 42;
      memPct = 68;
      activeIncidents = 1;
    } else if (clusterName.toLowerCase().includes("staging")) {
      healthScore = 87;
      cpuPct = 64;
      memPct = 78;
      activeIncidents = 2;
    } else if (clusterName.toLowerCase().includes("eks") || clusterName.toLowerCase().includes("dev")) {
      healthScore = 98;
      cpuPct = 28;
      memPct = 34;
      activeIncidents = 0;
    }

    const status = healthScore >= 90 ? "Healthy" : healthScore >= 80 ? "Warning" : "Critical";

    return {
      name: clusterName,
      healthScore,
      cpuPct,
      memPct,
      podHealth,
      activeIncidents,
      status,
      rank: index + 1,
    };
  });

  const sortedClusters = [...clusterMetrics].sort((a, b) => b.healthScore - a.healthScore);

  return (
    <div className="h-screen w-full max-w-7xl pt-20 pl-20 pr-6 pb-14 mx-auto space-y-6 bg-background overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2.5 font-heading">
            <Icon path={mdiTrophy} size={1} className="text-amber-400" />
            Governance Leaderboard
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Cluster stability scores, resource efficiency rankings, and team zero-downtime streaks
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center bg-surface p-1 rounded-md border border-neutral-800">
          <button
            onClick={() => setTab("clusters")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === "clusters"
                ? "bg-blue-500 text-white"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Icon path={mdiServer} size={0.65} />
            <span>Cluster Rankings ({clusters.length})</span>
          </button>
          <button
            onClick={() => setTab("members")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === "members"
                ? "bg-blue-500 text-white"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Icon path={mdiAccountGroup} size={0.65} />
            <span>Team Members ({membersLeaderboard.length})</span>
          </button>
        </div>
      </div>

      {/* CLUSTERS LEADERBOARD TAB */}
      {tab === "clusters" && (
        <div className="rounded-2xl border border-neutral-800 bg-surface overflow-hidden">
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-background border-b border-neutral-800 text-neutral-400 uppercase font-semibold text-[10px] tracking-wider font-heading">
                <tr>
                  <th className="p-4">Rank</th>
                  <th className="p-4">Cluster Name</th>
                  <th className="p-4">Health Score</th>
                  <th className="p-4">CPU / Memory Load</th>
                  <th className="p-4">Workload Status</th>
                  <th className="p-4">Active Alerts</th>
                  <th className="p-4">Governance State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {sortedClusters.map((cluster, idx) => (
                  <tr key={cluster.name} className="hover:bg-neutral-900 transition-colors">
                    <td className="p-4 font-mono font-bold text-neutral-200">
                      <span
                        className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold ${
                          idx === 0
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : idx === 1
                            ? "bg-neutral-400/20 text-neutral-300 border border-neutral-400/30"
                            : idx === 2
                            ? "bg-amber-700/20 text-amber-600 border border-amber-700/30"
                            : "bg-neutral-900 text-neutral-400"
                        }`}
                      >
                        {idx + 1}
                      </span>
                    </td>

                    <td className="p-4 font-medium text-neutral-100 font-mono">
                      <div className="flex items-center gap-2">
                        <Icon path={mdiServer} size={0.7} className="text-blue-400 shrink-0" />
                        <span className="font-semibold text-sm text-neutral-200">{cluster.name}</span>
                      </div>
                    </td>

                    <td className="p-4 font-mono font-bold text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            cluster.healthScore >= 90
                              ? "text-emerald-400"
                              : cluster.healthScore >= 80
                              ? "text-amber-400"
                              : "text-red-400"
                          }
                        >
                          {cluster.healthScore} / 100
                        </span>
                      </div>
                    </td>

                    <td className="p-4 font-mono text-neutral-300">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] gap-4">
                          <span>CPU: {cluster.cpuPct}%</span>
                          <span>RAM: {cluster.memPct}%</span>
                        </div>
                        <div className="h-1.5 w-36 bg-background rounded-full overflow-hidden flex border border-neutral-800">
                          <div className="bg-blue-500 h-full" style={{ width: `${cluster.cpuPct}%` }} />
                          <div className="bg-emerald-500 h-full" style={{ width: `${cluster.memPct}%` }} />
                        </div>
                      </div>
                    </td>

                    <td className="p-4 font-mono text-neutral-300">{cluster.podHealth}</td>

                    <td className="p-4 font-mono">
                      {cluster.activeIncidents === 0 ? (
                        <span className="text-emerald-400 text-xs font-semibold">0 Active</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-400 font-semibold bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                          <Icon path={mdiAlert} size={0.55} />
                          {cluster.activeIncidents} Triggered
                        </span>
                      )}
                    </td>

                    <td className="p-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                          cluster.status === "Healthy"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : cluster.status === "Warning"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        <Icon path={mdiShieldCheck} size={0.55} />
                        {cluster.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MEMBERS LEADERBOARD TAB */}
      {tab === "members" && (
        <div className="rounded-2xl border border-neutral-800 bg-surface overflow-hidden">
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-background border-b border-neutral-800 text-neutral-400 uppercase font-semibold text-[10px] tracking-wider font-heading">
                <tr>
                  <th className="p-4">Rank</th>
                  <th className="p-4">Member / Module Owner</th>
                  <th className="p-4">Governance Score</th>
                  <th className="p-4">Zero-Downtime Streak</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {membersLeaderboard.map((user) => (
                  <tr key={user.rank} className="hover:bg-neutral-900 transition-colors">
                    <td className="p-4 font-mono font-bold text-neutral-200 flex items-center gap-2">
                      <span className="w-5 text-center">{user.rank}</span>
                      <span className="text-xs font-semibold text-amber-400 font-mono">[{user.badge}]</span>
                    </td>
                    <td className="p-4 font-medium text-neutral-100">{user.name}</td>
                    <td className="p-4 font-mono font-bold text-blue-400">
                      <div className="flex items-center gap-1">
                        <Icon path={mdiStar} size={0.65} className="text-amber-400" />
                        <span>{user.score} pts</span>
                      </div>
                    </td>
                    <td className="p-4 font-mono text-neutral-300">
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <Icon path={mdiFire} size={0.65} />
                        <span>{user.streak}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                        <Icon path={mdiShieldCheck} size={0.55} />
                        {user.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
