import { Icon } from "../ui/Icon";
import {
  mdiHub,
  mdiAlertOctagon,
  mdiChartLine,
  mdiTrophy,
  mdiCog,
} from "@mdi/js";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

export type NavTab = "topology" | "incidents" | "metrics" | "leaderboard" | "settings";

interface LeftSidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeIncidentsCount?: number;
}

export function LeftSidebar({ activeTab, onTabChange, activeIncidentsCount }: LeftSidebarProps) {
  const navItems = [
    {
      id: "topology" as NavTab,
      label: "Topology Graph",
      iconPath: mdiHub,
    },
    {
      id: "incidents" as NavTab,
      label: "Incidents & Alerts",
      iconPath: mdiAlertOctagon,
      badge: activeIncidentsCount && activeIncidentsCount > 0 ? activeIncidentsCount : undefined,
    },
    {
      id: "metrics" as NavTab,
      label: "Metrics Inspector",
      iconPath: mdiChartLine,
    },
    {
      id: "leaderboard" as NavTab,
      label: "Cluster Leaderboard",
      iconPath: mdiTrophy,
    },
    {
      id: "settings" as NavTab,
      label: "Workspace Settings",
      iconPath: mdiCog,
    },
  ];

  return (
    <aside className="fixed left-0 top-0 h-screen w-14 z-40 flex flex-col items-center py-4 bg-background border-r border-neutral-800 gap-3">
      {/* Brand Emblem Logo Header */}
      <div className="group relative flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 cursor-pointer hover:bg-blue-500/20 transition-all">
        <EnvScaleLogo className="h-5 w-5 text-blue-400" />
        <div className="absolute left-full ml-3 hidden rounded-md bg-[#18181c] px-3 py-1.5 text-xs font-bold text-neutral-100 border border-neutral-700 whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
          EnvScale Platform
        </div>
      </div>

      <div className="w-6 h-px bg-neutral-800 my-0.5" />
      {navItems.map((item) => {
        const isActive = activeTab === item.id;

        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            title={item.label}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-all duration-200 ${
              isActive
                ? "bg-blue-500 text-white"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
          >
            <Icon path={item.iconPath} size={0.83} />

            {/* Incident Badge */}
            {item.badge && !isActive && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {item.badge}
              </span>
            )}

            {/* Tooltip on hover */}
            <div className="absolute left-full ml-3 hidden rounded-md bg-[#18181c] px-3 py-1.5 text-xs font-medium text-neutral-100 border border-neutral-700 whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
              {item.label}
            </div>
          </button>
        );
      })}
    </aside>
  );
}
