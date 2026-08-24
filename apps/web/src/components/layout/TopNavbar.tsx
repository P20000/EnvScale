import { useState, useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiChevronDown,
  mdiPlus,
  mdiBell,
  mdiAccount,
  mdiCheck,
  mdiCheckAll,
  mdiLock,
} from "@mdi/js";
import { useTopologyStore, type NotificationItem } from "../../store/useTopologyStore";
import { AuthModal } from "./AuthModal";
import { WorkspaceModal } from "./WorkspaceModal";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

import type { WsConnectionStatus } from "../../hooks/useK8sStream";

interface TopNavbarProps {
  activeCluster: string;
  clusters: string[];
  onSelectCluster: (cluster: string) => void;
  onOpenConnectModal: () => void;
  activeIncidentsCount?: number;
  wsLatencyMs?: number;
  wsStatus?: WsConnectionStatus;
  wsConnected?: boolean;
}

export function TopNavbar({
  activeCluster,
  clusters,
  onSelectCluster,
  onOpenConnectModal,
  wsStatus: propsWsStatus,
}: TopNavbarProps) {
  const notifications = useTopologyStore((s) => s.notifications);
  const markNotificationRead = useTopologyStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useTopologyStore((s) => s.markAllNotificationsRead);
  const storeWsStatus = useTopologyStore((s) => s.wsStatus);
  const addCluster = useTopologyStore((s) => s.addCluster);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target as Node)) {
        setNotifMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentWsStatus = propsWsStatus ?? storeWsStatus;

  const isConnected = currentWsStatus === "CONNECTED";
  const isConnecting = currentWsStatus === "CONNECTING" || currentWsStatus === "RECONNECTING";

  const toggleDropdown = () => {
    setDropdownOpen((prev) => !prev);
    setNotifMenuOpen(false);
    setUserMenuOpen(false);
  };

  const toggleNotif = () => {
    setNotifMenuOpen((prev) => !prev);
    setDropdownOpen(false);
    setUserMenuOpen(false);
  };

  const toggleUser = () => {
    setUserMenuOpen((prev) => !prev);
    setDropdownOpen(false);
    setNotifMenuOpen(false);
  };

  const closeAllMenus = () => {
    setDropdownOpen(false);
    setNotifMenuOpen(false);
    setUserMenuOpen(false);
  };

  return (
    <>
      {/* Click-outside dimming backdrop overlay for popover menus */}
      {(dropdownOpen || notifMenuOpen || userMenuOpen) && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={closeAllMenus}
        />
      )}

      <header className="fixed top-0 left-0 w-full h-14 bg-[#141417] border-b border-zinc-800 flex items-center justify-between px-4 select-none shrink-0 z-[60]">
        
        {/* Absolute Background Layer (Clips only the mandala to the header bounds) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
          <div className="absolute left-[30px] top-[28px] -translate-x-1/2 -translate-y-1/2 w-60 h-60 opacity-20">
            <svg viewBox="-100 -100 200 200" className="w-full h-full text-blue-500 animate-[spin_180s_linear_infinite] transform-gpu will-change-transform">
              <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <circle r="18" strokeWidth="4" />
                <circle r="23" strokeWidth="1" />
                
                {/* 12-fold symmetry mandala */}
                {Array.from({ length: 12 }).map((_, i) => (
                  <g key={i} transform={`rotate(${i * 30})`}>
                    <path d="M 0 -23 C 10 -40 8 -55 0 -70 C -8 -55 -10 -40 0 -23 Z" fill="currentColor" fillOpacity="0.1" />
                    <path d="M 0 -23 L 0 -65" />
                    <path d="M 0 -35 L 4 -45 M 0 -45 L 5 -52 M 0 -35 L -4 -45 M 0 -45 L -5 -52" strokeWidth="1" />
                    <path d="M 0 -70 C 15 -75 22 -80 22 -88 C 22 -95 10 -98 0 -96 C -10 -98 -22 -95 -22 -88 C -22 -80 -15 -75 0 -70 Z" />
                    <path d="M 0 -75 C 8 -78 12 -82 12 -86 C 12 -90 5 -92 0 -90 C -5 -92 -12 -90 -12 -86 C -12 -82 -8 -78 0 -75 Z" fill="currentColor" fillOpacity="0.1" />
                    <circle cx="0" cy="-82" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="-78" r="1.5" fill="currentColor" />
                    <circle cx="-12" cy="-78" r="1.5" fill="currentColor" />
                  </g>
                ))}
                
                <circle r="98" strokeWidth="2" strokeDasharray="4 8" />
              </g>
            </svg>
          </div>
        </div>

        {/* Left Group: Foreground Brand Elements */}
        <div className="relative z-10 flex items-center gap-3 h-full">
          <EnvScaleLogo className="w-7 h-7 text-blue-500 shrink-0 select-none" />
          <span className="text-sm font-mono font-black tracking-widest text-white uppercase">
            ENVSCALE
          </span>
        </div>

        {/* Center Group: Navigation Pill Controls */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-4 bg-[#18181b] border border-zinc-800 h-9 px-3.5 rounded-full z-10" ref={dropdownRef}>

          {/* Cluster Selector */}
          <button
            onClick={toggleDropdown}
            className="flex items-center gap-2 text-xs font-mono font-bold tracking-wider text-zinc-100 hover:text-white transition-colors"
          >
            <span>{activeCluster}</span>
            <Icon path={mdiChevronDown} size={0.65} className="text-zinc-400" />
          </button>

          {/* Dropdown Menu */}
          {dropdownOpen && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-64 rounded-xl border border-zinc-700 bg-[#18181c] p-2 z-[70] shadow-2xl">
              <div className="px-2 py-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase font-heading">
                Active Kubernetes Clusters
              </div>
              <div className="space-y-1">
                {clusters.map((cluster) => (
                  <button
                    key={cluster}
                    onClick={() => {
                      onSelectCluster(cluster);
                      setDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-mono transition-colors ${
                      activeCluster === cluster
                        ? "bg-blue-500/10 text-blue-400 font-semibold"
                        : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${activeCluster === cluster ? "bg-emerald-500" : "bg-zinc-600"}`} />
                      <span className="truncate">{cluster}</span>
                    </span>
                    {activeCluster === cluster && <Icon path={mdiCheck} size={0.65} className="text-blue-400 shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="my-1 h-px bg-zinc-800" />
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  onOpenConnectModal();
                }}
                className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
              >
                <Icon path={mdiPlus} size={0.65} />
                <span>Connect New Cluster</span>
              </button>
            </div>
          )}

          <div className="h-4 w-px bg-zinc-800" />

          {/* Live WebSocket Status Indicator */}
          <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-wider text-zinc-100">
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                isConnected
                  ? "bg-emerald-400 shadow-[0_0_8px_#10b981]"
                  : isConnecting
                  ? "bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-pulse"
                  : "bg-red-500"
              }`}
            />
            <span>
              {isConnected
                ? "CONNECTED"
                : currentWsStatus === "RECONNECTING"
                ? "RECONNECTING"
                : isConnecting
                ? "CONNECTING"
                : "DISCONNECTED"}
            </span>
          </div>
        </div>

        {/* Right Group: Action Controls */}
        <div className="flex items-center justify-end w-32 gap-3">
          {/* Notifications Dropdown Panel */}
          <div className="relative" ref={notifMenuRef}>
            <button
              onClick={toggleNotif}
              title="Notifications"
              className="relative h-8 w-8 rounded-full border border-zinc-800 bg-[#18181b] flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
            >
              <Icon path={mdiBell} size={0.7} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Panel */}
            {notifMenuOpen && (
              <div className="absolute top-full right-0 mt-3 w-80 rounded-xl border border-zinc-700 bg-[#18181c] p-3 z-[70] shadow-2xl space-y-2">
                <div className="flex items-center justify-between px-1 pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Icon path={mdiBell} size={0.7} className="text-blue-400" />
                    <span className="text-xs font-semibold text-zinc-100 font-heading">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="rounded-full bg-blue-500/10 px-1.5 py-0.2 text-[10px] font-semibold text-blue-400 border border-blue-500/20">
                        {unreadCount} unread
                      </span>
                    )}
                  </div>

                  {unreadCount > 0 && (
                    <button
                      onClick={markAllNotificationsRead}
                      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-blue-400 transition-colors"
                      title="Mark all as read"
                    >
                      <Icon path={mdiCheckAll} size={0.65} />
                      <span>Mark all read</span>
                    </button>
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-0.5">
                  {notifications.length === 0 ? (
                    <div className="py-6 text-center text-xs text-zinc-400 font-mono">
                      No notifications
                    </div>
                  ) : (
                    notifications.map((item: NotificationItem) => (
                      <div
                        key={item.id}
                        onClick={() => markNotificationRead(item.id)}
                        className={`p-2.5 rounded-md border transition-all cursor-pointer ${
                          !item.read
                            ? "bg-zinc-900 border-blue-500/30"
                            : "bg-background border-zinc-800 opacity-75 hover:opacity-100"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {!item.read && (
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-zinc-200">
                              {item.title}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                            {item.time}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-300 mt-1 leading-snug">
                          {item.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile / Auth & Workspace Actions */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={toggleUser}
              className="h-8 w-8 rounded-full border border-zinc-800 bg-[#18181b] flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
            >
              <Icon path={mdiAccount} size={0.7} />
            </button>

            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-3 w-52 rounded-xl border border-zinc-700 bg-[#18181c] p-2 z-[70] shadow-2xl space-y-1">
                <div className="px-2 py-1.5">
                  <div className="text-xs font-medium text-zinc-100">Dev Team Lead</div>
                  <div className="text-[10px] text-zinc-400 font-mono">admin@envscale.internal</div>
                </div>

                <div className="my-1 h-px bg-zinc-800" />

                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    setAuthModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  <Icon path={mdiLock} size={0.65} className="text-blue-400" />
                  <span>Sign In (Auth API)</span>
                </button>

                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    setWorkspaceModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  <EnvScaleLogo className="h-3.5 w-3.5 text-blue-400" />
                  <span>New Workspace</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Auth & Workspace Modals */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />

      <WorkspaceModal
        isOpen={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        onWorkspaceCreated={(name) => {
          addCluster(`${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-cluster`);
        }}
      />
    </>
  );
}
