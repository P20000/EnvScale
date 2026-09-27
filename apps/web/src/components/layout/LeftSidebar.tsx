import { useState, useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiHub,
  mdiAlertOctagon,
  mdiChartLine,
  mdiTrophy,
  mdiCog,
  mdiAccount,
  mdiLock,
} from "@mdi/js";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";
import { AuthModal } from "./AuthModal";
import { useTopologyStore } from "../../store/useTopologyStore";
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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
  const authModalOpen = useAuthStore((s) => s.authModalOpen);
  const authModalReason = useAuthStore((s) => s.authModalReason);
  const logout = useAuthStore((s) => s.logout);
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
    <aside className="fixed left-0 top-0 h-screen w-14 z-40 flex flex-col items-center py-4 bg-[#0d0d10] border-r border-neutral-800 select-none">
      {/* Brand Emblem Logo Header */}
      <div className="group relative flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 cursor-pointer hover:bg-blue-500/20 transition-all shrink-0">
        <EnvScaleLogo className="h-5 w-5 text-blue-400" />
        <div className="absolute left-full ml-3 hidden rounded-md bg-[#18181c] px-3 py-1.5 text-xs font-bold text-neutral-100 border border-neutral-700 whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
          EnvScale Platform
        </div>
      </div>

      <div className="w-6 h-px bg-neutral-800 my-3 shrink-0" />

      {/* Main Navigation Items (Top Group) */}
      <div className="flex flex-col items-center gap-3">
        {topNavItems.map((item) => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={item.label}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-all duration-200 ${
                isActive
                  ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                  : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200"
              }`}
            >
              <Icon path={item.iconPath} size={0.83} />

              {/* Incident Badge */}
              {item.badge && !isActive && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
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
      </div>

      {/* Flexible Spacer - Pushes Settings and Profile icon to the bottom */}
      <div className="mt-auto flex flex-col items-center gap-3 shrink-0">
        {/* Settings Icon - Positioned JUST ABOVE the Profile Icon */}
        <button
          key={settingsNavItem.id}
          onClick={() => onTabChange(settingsNavItem.id)}
          title={settingsNavItem.label}
          className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-all duration-200 ${
            activeTab === settingsNavItem.id
              ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
              : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200"
          }`}
        >
          <Icon path={settingsNavItem.iconPath} size={0.83} />

          {/* Tooltip on hover */}
          <div className="absolute left-full ml-3 hidden rounded-md bg-[#18181c] px-3 py-1.5 text-xs font-medium text-neutral-100 border border-neutral-700 whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
            {settingsNavItem.label}
          </div>
        </button>

        {/* Profile Avatar Icon - Positioned at the VERY BOTTOM of the Left Sidebar */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((prev) => !prev)}
            title={loggedInEmail ? `Profile (${loggedInEmail})` : "User Profile & Account"}
            className="group relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 focus:outline-none"
          >
            <div
              className={`h-9 w-9 rounded-full border-2 flex items-center justify-center overflow-hidden transition-all duration-200 shadow-md ${
                loggedInEmail
                  ? "border-blue-500/70 bg-gradient-to-tr from-blue-600 to-indigo-500 text-white group-hover:border-blue-400 group-hover:scale-105"
                  : "border-neutral-700 bg-neutral-800 text-neutral-400 group-hover:border-neutral-500 group-hover:text-neutral-200 group-hover:scale-105"
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
              className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0d0d10] ${
                loggedInEmail ? "bg-emerald-500" : "bg-neutral-500"
              }`}
            />

            {/* Tooltip on hover */}
            <div className="absolute left-full ml-3 hidden rounded-md bg-[#18181c] px-3 py-1.5 text-xs font-medium text-neutral-100 border border-neutral-700 whitespace-nowrap group-hover:block z-[70] shadow-xl pointer-events-none font-heading">
              {loggedInEmail ? loggedInEmail : "Profile & Account"}
            </div>
          </button>

          {/* User Profile Flyout Menu */}
          {userMenuOpen && (
            <div className="absolute left-full bottom-0 ml-3 w-60 rounded-xl border border-neutral-700 bg-[#18181c] p-2.5 z-[70] shadow-2xl space-y-2 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center gap-2.5 px-1 py-1">
                {userAvatarUrl && !avatarFailed ? (
                  <img
                    src={userAvatarUrl}
                    alt="User avatar"
                    className="h-9 w-9 rounded-full object-cover border border-blue-500/40 shrink-0 shadow-sm"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center border border-blue-500/30 shrink-0">
                    {loggedInEmail ? loggedInEmail.charAt(0).toUpperCase() : "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {loggedInEmail ? (
                    <>
                      <div className="text-xs font-bold text-neutral-100 font-heading truncate">
                        {userName || "Authenticated User"}
                      </div>
                      <div className="text-[11px] text-blue-400 font-mono truncate">{loggedInEmail}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-bold text-neutral-100 font-heading">Guest Account</div>
                      <div className="text-[10px] text-neutral-400">Sign in to authenticate telemetry</div>
                    </>
                  )}
                </div>
              </div>

              <div className="h-px bg-neutral-800 my-1" />

              {isAuthenticated ? (
                <button
                  onClick={async () => {
                    setUserMenuOpen(false);
                    await logout();
                  }}
                  className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-red-400 hover:bg-neutral-800 hover:text-red-300 transition-colors"
                >
                  <Icon path={mdiLock} size={0.65} className="text-red-400" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    if (onOpenAuthModal) {
                      onOpenAuthModal();
                    } else {
                      openAuthModal();
                    }
                  }}
                  className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-blue-400 hover:bg-blue-500/10 font-medium transition-colors"
                >
                  <Icon path={mdiLock} size={0.65} className="text-blue-400" />
                  <span>Sign In / Register</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Auth Modal Triggered from Profile Icon */}
      <AuthModal
        isOpen={authModalOpen}
        reason={authModalReason}
        onClose={closeAuthModal}
        onLoginSuccess={() => {
          closeAuthModal();
          useTopologyStore.getState().triggerWsReconnect();
        }}
      />
    </aside>
  );
}

