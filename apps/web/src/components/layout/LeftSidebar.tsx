import { useState, useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiHub,
  mdiAlertOctagon,
  mdiChartLine,
  mdiTrophy,
  mdiCog,
  mdiAccount,
} from "@mdi/js";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";
import { UserProfileMenu } from "./UserProfileMenu";
import { useAuthStore } from "../../store/useAuthStore";

export type NavTab = "topology" | "incidents" | "metrics" | "leaderboard" | "settings";

interface LeftSidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeIncidentsCount?: number;
  onOpenAuthModal?: () => void;
}

export function LeftSidebar({
  activeTab,
  onTabChange,
  activeIncidentsCount,
  onOpenAuthModal,
}: LeftSidebarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const user = useAuthStore((s) => s.user);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  const loggedInEmail = user?.email || null;
  const userName = user?.name || null;
  const userAvatarUrl = user?.image || null;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);



  const topNavItems = [
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
  ];

  const settingsNavItem = {
    id: "settings" as NavTab,
    label: "Workspace Settings",
    iconPath: mdiCog,
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-14 z-40 flex flex-col items-center py-4 bg-[#191B20] border-r border-[#30343B] select-none">
      {/* Brand Emblem Logo Header */}
      <div className="group relative flex h-10 w-10 items-center justify-center rounded-md bg-blue-500 text-white shrink-0 select-none">
        <EnvScaleLogo className="h-5 w-5 text-white" />
        <div className="absolute left-full ml-3 hidden rounded-md bg-[#23262D] px-3 py-1.5 text-xs font-bold text-[#E6E1E5] border border-[#424750] whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
          EnvScale Platform
        </div>
      </div>

      <div className="w-6 h-px bg-[#30343B] my-3 shrink-0" />

      {/* Main Navigation Items (Top Group) */}
      <div className="flex flex-col items-center gap-3">
        {topNavItems.map((item) => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={item.label}
              aria-label={item.label}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#191B20] ${
                isActive
                  ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                  : "text-[#C4C7C5] hover:bg-[#30343B] hover:text-[#E6E1E5]"
              }`}
            >
              <Icon path={item.iconPath} size={0.83} />

              {/* Incident Badge */}
              {item.badge && !isActive && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-[#410E0B] border border-[#F2B8B5]/40 text-[10px] font-bold text-[#F2B8B5] shadow-sm">
                  {item.badge}
                </span>
              )}

              {/* Tooltip on hover */}
              <div className="absolute left-full ml-3 hidden rounded-md bg-[#23262D] px-3 py-1.5 text-xs font-medium text-[#E6E1E5] border border-[#424750] whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
                {item.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Flexible Spacer - Pushes Settings and Profile icon to the bottom */}
      <div className="mt-auto flex flex-col items-center gap-3 shrink-0">
        {/* Settings Icon - Positioned JUST ABOVE the Profile Icon */}
        <button
          key={settingsNavItem.id}
          onClick={() => onTabChange(settingsNavItem.id)}
          title={settingsNavItem.label}
          aria-label={settingsNavItem.label}
          className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#191B20] ${
            activeTab === settingsNavItem.id
              ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
              : "text-[#C4C7C5] hover:bg-[#30343B] hover:text-[#E6E1E5]"
          }`}
        >
          <Icon path={settingsNavItem.iconPath} size={0.83} />

          {/* Tooltip on hover */}
          <div className="absolute left-full ml-3 hidden rounded-md bg-[#23262D] px-3 py-1.5 text-xs font-medium text-[#E6E1E5] border border-[#424750] whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
            {settingsNavItem.label}
          </div>
        </button>

        {/* Profile Avatar Icon - Positioned at the VERY BOTTOM of the Left Sidebar */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((prev) => !prev)}
            title={loggedInEmail ? `Profile (${loggedInEmail})` : "User Profile & Account"}
            aria-label="User Profile & Account Menu"
            aria-expanded={userMenuOpen}
            className="group relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#191B20]"
          >
            <div
              className={`h-9 w-9 rounded-full border-2 flex items-center justify-center overflow-hidden transition-all duration-200 shadow-md ${
                loggedInEmail
                  ? "border-blue-500/70 bg-gradient-to-tr from-blue-600 to-indigo-500 text-white group-hover:border-blue-400 group-hover:scale-105"
                  : "border-[#424750] bg-[#23262D] text-[#C4C7C5] group-hover:border-[#5C616B] group-hover:text-[#E6E1E5] group-hover:scale-105"
              }`}
            >
              {userAvatarUrl && !avatarFailed ? (
                <img
                  src={userAvatarUrl}
                  alt={userName || loggedInEmail || "User avatar"}
                  className="h-full w-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : loggedInEmail ? (
                <span className="text-xs font-bold uppercase tracking-wider">
                  {loggedInEmail.charAt(0)}
                </span>
              ) : (
                <Icon path={mdiAccount} size={0.75} />
              )}
            </div>

            {/* Status Indicator Dot */}
            <span
              className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#191B20] ${
                loggedInEmail ? "bg-[#6DD6A8]" : "bg-[#9AA0AA]"
              }`}
            />

            {/* Tooltip on hover */}
            <div className="absolute left-full ml-3 hidden rounded-md bg-[#23262D] px-3 py-1.5 text-xs font-medium text-[#E6E1E5] border border-[#424750] whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
              {loggedInEmail ? loggedInEmail : "Profile & Account"}
            </div>
          </button>

          {/* User Profile Flyout Menu */}
          <UserProfileMenu
            isOpen={userMenuOpen}
            onClose={() => setUserMenuOpen(false)}
            onOpenAuthModal={() => {
              if (onOpenAuthModal) {
                onOpenAuthModal();
              } else {
                openAuthModal();
              }
            }}
          />
        </div>
      </div>
    </aside>
  );
}

