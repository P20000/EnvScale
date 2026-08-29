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
import { authClient } from "../../lib/auth-client";
import { AuthModal } from "./AuthModal";
import { useTopologyStore } from "../../store/useTopologyStore";

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
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [loggedInEmail, setLoggedInEmail] = useState<string | null>(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

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
    // 1. Check local user profile / JWT storage
    const token =
      localStorage.getItem("envscale_auth_token") ||
      localStorage.getItem("envscale_access_token");
    const storedUserRaw = localStorage.getItem("envscale_user");

    if (storedUserRaw) {
      try {
        const u = JSON.parse(storedUserRaw);
        if (u.image || u.picture || u.avatar_url) {
          const imgUrl = u.image || u.picture || u.avatar_url;
          setTimeout(() => setUserAvatarUrl(imgUrl), 0);
        }
        if (u.name) setTimeout(() => setUserName(u.name), 0);
        if (u.email) setTimeout(() => setLoggedInEmail(u.email), 0);
      } catch {
        // ignore
      }
    }

    if (token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          if (payload.email) {
            setTimeout(() => setLoggedInEmail(payload.email), 0);
          }
          if (payload.picture || payload.image || payload.avatar) {
            const imgUrl = payload.picture || payload.image || payload.avatar;
            setTimeout(() => setUserAvatarUrl(imgUrl), 0);
          }
          if (payload.name) {
            setTimeout(() => setUserName(payload.name), 0);
          }
        }
      } catch {
        // ignore malformed token
      }
    }

    // 2. Fetch active session via Better-Auth (Google / GitHub OAuth)
    authClient
      .getSession()
      .then((res) => {
        if (res?.data?.user) {
          const user = res.data.user;
          if (user.email) setLoggedInEmail(user.email);
          if (user.name) setUserName(user.name);
          if (user.image) setUserAvatarUrl(user.image);
        }
      })
      .catch(() => {});
  }, []);

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
              {userAvatarUrl ? (
                <img
                  src={userAvatarUrl}
                  alt={userName || loggedInEmail || "User avatar"}
                  className="h-full w-full object-cover"
                  onError={() => setUserAvatarUrl(null)}
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
                {userAvatarUrl ? (
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

              {loggedInEmail ? (
                <button
                  onClick={async () => {
                    setUserMenuOpen(false);
                    const streamerUrl = import.meta.env.VITE_STREAMER_BASE_URL || "http://localhost:8080";
                    fetch(`${streamerUrl}/api/v1/clusters/unregister-all`, { method: "POST" }).catch(() => {});
                    localStorage.removeItem("envscale_auth_token");
                    localStorage.removeItem("envscale_access_token");
                    localStorage.removeItem("envscale_user");
                    useTopologyStore.getState().resetStore();
                    setLoggedInEmail(null);
                    setUserAvatarUrl(null);
                    setUserName(null);
                    await authClient.signOut().catch(() => {});
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
                      setAuthModalOpen(true);
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
        onClose={() => setAuthModalOpen(false)}
        onLoginSuccess={(userEmail) => {
          setLoggedInEmail(userEmail);
          setAuthModalOpen(false);
          useTopologyStore.getState().triggerWsReconnect();
          authClient
            .getSession()
            .then((res) => {
              if (res?.data?.user) {
                const user = res.data.user;
                if (user.email) setLoggedInEmail(user.email);
                if (user.name) setUserName(user.name);
                if (user.image) setUserAvatarUrl(user.image);
              }
            })
            .catch(() => {});
        }}
      />
    </aside>
  );
}

