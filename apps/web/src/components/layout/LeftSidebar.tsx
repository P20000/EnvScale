import {
  Network,
  AlertTriangle,
  BarChart3,
  Trophy,
  Settings,
} from "lucide-react";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

export type NavTab = "topology" | "incidents" | "metrics" | "leaderboard" | "settings";

interface LeftSidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export function LeftSidebar({ activeTab, onTabChange }: LeftSidebarProps) {
  const navItems = [
    {
      id: "topology" as NavTab,
      label: "Topology Graph",
      icon: Network,
    },
    {
      id: "incidents" as NavTab,
      label: "Incidents & Alerts",
      icon: AlertTriangle,
      badge: 2,
    },
    {
      id: "metrics" as NavTab,
      label: "Metrics Inspector",
      icon: BarChart3,
    },
    {
      id: "leaderboard" as NavTab,
      label: "Cluster Leaderboard",
      icon: Trophy,
    },
    {
      id: "settings" as NavTab,
      label: "Workspace Settings",
      icon: Settings,
    },
  ];

  return (
    <aside className="fixed left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col rounded-3xl bg-neutral-900/85 backdrop-blur-md border border-neutral-800 p-2.5 gap-2.5 shadow-xl items-center">
      {/* Brand Emblem Logo Header */}
      <div className="group relative flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 cursor-pointer hover:bg-blue-500/20 transition-all">
        <EnvScaleLogo className="h-5 w-5 text-blue-400" />
        <div className="absolute left-full ml-3 hidden rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-bold text-neutral-100 border border-neutral-800 shadow-xl whitespace-nowrap group-hover:block z-50 animate-in fade-in slide-in-from-left-2 duration-150">
          EnvScale Platform
        </div>
      </div>

      <div className="w-6 h-px bg-neutral-800 my-0.5" />
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;

        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            title={item.label}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-200 active:scale-95 ${
              isActive
                ? "bg-blue-500 text-white shadow-md shadow-blue-500/25"
                : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200"
            }`}
          >
            <Icon className="h-5 w-5" />

            {/* Incident Badge */}
            {item.badge && !isActive && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                {item.badge}
              </span>
            )}

            {/* Tooltip on hover */}
            <div className="absolute left-full ml-3 hidden rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-100 border border-neutral-800 shadow-xl whitespace-nowrap group-hover:block z-50 animate-in fade-in slide-in-from-left-2 duration-150">
              {item.label}
            </div>
          </button>
        );
      })}
    </aside>
  );
}
