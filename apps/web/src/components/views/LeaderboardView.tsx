import { useState } from "react";
import { Trophy, Flame, Star, ShieldCheck, Server, AlertTriangle, Activity, Users, Layers } from "lucide-react";
import { useTopologyStore } from "../../store/useTopologyStore";

export function LeaderboardView() {
  const [tab, setTab] = useState<"members" | "clusters">("clusters");
  const { clusters, nodes } = useTopologyStore();

  // Existing Members Leaderboard
  const membersLeaderboard = [
    { rank: 1, name: "Pranav (Core System)", score: 985, streak: "14 Days", status: "Optimal", badge: "🥇 Gold" },
    { rank: 2, name: "Vinit (Backend CRUD)", score: 940, streak: "9 Days", status: "Optimal", badge: "🥈 Silver" },
    { rank: 3, name: "Neha (Frontend UI)", score: 915, streak: "7 Days", status: "Optimal", badge: "🥉 Bronze" },
    { rank: 4, name: "Ishika (Docs & QA)", score: 890, streak: "5 Days", status: "Warning", badge: "Participant" },
  ];

  // Dynamic Clusters Leaderboard derived from store clusters
  const clusterMetrics = clusters.map((clusterName, index) => {
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
    };
  });

  // Sort clusters by health score descending
  const sortedClusters = [...clusterMetrics].sort((a, b) => b.healthScore - a.healthScore);

  return (
    <div className="p-8 pt-24 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Header & Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-400" />
            Gamified Governance Leaderboard
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Cluster Health Index rankings, fault recovery streaks, and team governance scorecards
          </p>
        </div>

        {/* Tab Toggle: Members vs Clusters */}
        <div className="flex items-center rounded-xl bg-neutral-900 border border-neutral-800 p-1">
          <button
            onClick={() => setTab("clusters")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "clusters"
                ? "bg-blue-600 text-white shadow"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Clusters ({clusters.length})</span>
          </button>

          <button
            onClick={() => setTab("members")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "members"
                ? "bg-blue-600 text-white shadow"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Team Members</span>
          </button>
        </div>
      </div>

      {/* CLUSTERS LEADERBOARD TAB */}
      {tab === "clusters" && (
        <div className="rounded-2xl border border-neutral-800 bg-[#141417] overflow-hidden shadow-xl">
          <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
            <div className="text-xs font-semibold text-neutral-200 flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              <span>Kubernetes Cluster Health Index Rankings</span>
            </div>
            <div className="text-[11px] font-mono text-neutral-400">
              Total Managed Nodes: {nodes.length}
            </div>
          </div>

          {/* Scrollable table container */}
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800 text-neutral-400 uppercase font-semibold text-[10px] tracking-wider shadow-sm">
                <tr>
                  <th className="p-4">Rank</th>
                  <th className="p-4">Cluster Name</th>
                  <th className="p-4">Health Index</th>
                  <th className="p-4">Resource Load (CPU / Mem)</th>
                  <th className="p-4">Pod Status</th>
                  <th className="p-4">Incidents</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono">
                {sortedClusters.map((cluster, idx) => (
                  <tr key={`${cluster.name}-${idx}`} className="hover:bg-neutral-900/40 transition-colors">
                    <td className="p-4 font-bold text-neutral-200">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          idx === 0
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : idx === 1
                            ? "bg-slate-400/20 text-slate-300 border border-slate-400/30"
                            : idx === 2
                            ? "bg-amber-700/20 text-amber-600 border border-amber-700/30"
                            : "bg-neutral-800 text-neutral-400"
                        }`}
                      >
                        #{idx + 1}
                      </span>
                    </td>
                    <td className="p-4 font-sans font-medium text-neutral-100 flex items-center gap-2 truncate max-w-[180px]">
                      <Server className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="truncate">{cluster.name}</span>
                    </td>
                    <td className="p-4 font-bold">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 rounded-full bg-neutral-900 overflow-hidden shrink-0">
                          <div
                            className={`h-full rounded-full ${
                              cluster.healthScore >= 90
                                ? "bg-emerald-500"
                                : cluster.healthScore >= 80
                                ? "bg-amber-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${cluster.healthScore}%` }}
                          />
                        </div>
                        <span
                          className={
                            cluster.healthScore >= 90
                              ? "text-emerald-400"
                              : cluster.healthScore >= 80
                              ? "text-amber-400"
                              : "text-red-400"
                          }
                        >
                          {cluster.healthScore}%
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-neutral-300 text-[11px]">
                      CPU: <span className="text-neutral-100 font-semibold">{cluster.cpuPct}%</span> | Mem:{" "}
                      <span className="text-neutral-100 font-semibold">{cluster.memPct}%</span>
                    </td>
                    <td className="p-4 text-neutral-300">{cluster.podHealth}</td>
                    <td className="p-4">
                      {cluster.activeIncidents > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400 border border-red-500/20">
                          <AlertTriangle className="h-3 w-3" />
                          {cluster.activeIncidents} Active
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-[11px]">0 Incidents</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${
                          cluster.status === "Healthy"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : cluster.status === "Warning"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        <ShieldCheck className="h-3 w-3" />
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
        <div className="rounded-2xl border border-neutral-800 bg-[#141417] overflow-hidden shadow-xl">
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800 text-neutral-400 uppercase font-semibold text-[10px] tracking-wider shadow-sm">
                <tr>
                  <th className="p-4">Rank</th>
                  <th className="p-4">Member / Module Owner</th>
                  <th className="p-4">Governance Score</th>
                  <th className="p-4">Zero-Downtime Streak</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {membersLeaderboard.map((user) => (
                  <tr key={user.rank} className="hover:bg-neutral-900/40 transition-colors">
                    <td className="p-4 font-mono font-bold text-neutral-200 flex items-center gap-2">
                      <span className="w-5 text-center">{user.rank}</span>
                      <span className="text-base">{user.badge.split(" ")[0]}</span>
                    </td>
                    <td className="p-4 font-medium text-neutral-100">{user.name}</td>
                    <td className="p-4 font-mono font-bold text-blue-400">
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                        <span>{user.score} pts</span>
                      </div>
                    </td>
                    <td className="p-4 font-mono text-neutral-300">
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <Flame className="h-3.5 w-3.5" />
                        <span>{user.streak}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                        <ShieldCheck className="h-3 w-3" />
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
