import { useState, useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiChevronDown,
  mdiPlus,
  mdiBell,
  mdiAccount,
  mdiCheck,
  mdiServer,
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
  wsLatencyMs: propsWsLatencyMs,
}: TopNavbarProps) {
  const notifications = useTopologyStore((s) => s.notifications);
  const markNotificationRead = useTopologyStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useTopologyStore((s) => s.markAllNotificationsRead);
  const storeWsStatus = useTopologyStore((s) => s.wsStatus);
  const storeWsLatencyMs = useTopologyStore((s) => s.wsLatencyMs);
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
  const currentWsLatencyMs = propsWsLatencyMs ?? storeWsLatencyMs;

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

      <header className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center justify-between gap-6 rounded-full bg-surface border border-neutral-800 px-5 py-2 min-w-[640px] max-w-4xl w-[calc(100%-2rem)]">
        {/* Left Group: Cluster Selector Dropdown */}
        <div className="flex items-center gap-3 relative" ref={dropdownRef}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <EnvScaleLogo className="h-4 w-4 text-blue-400" />
            </div>
            <span className="text-xs font-bold tracking-wider uppercase font-heading text-neutral-100">
              EnvScale
            </span>
          </div>

          <div className="h-4 w-px bg-neutral-800" />

          <button
            onClick={toggleDropdown}
            className="flex items-center gap-2 rounded-full bg-background px-3 py-1 text-xs font-medium text-neutral-200 border border-neutral-800 hover:border-neutral-700 transition-colors"
          >
            <Icon path={mdiServer} size={0.65} className="text-blue-400" />
            <span className="font-mono">{activeCluster}</span>
            <Icon path={mdiChevronDown} size={0.65} className="text-neutral-400" />
          </button>

          {/* Dropdown Menu with scrollable options list */}
          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-2 w-64 rounded-xl border border-neutral-700 bg-[#18181c] p-2 z-[70] shadow-2xl">
              <div className="px-2 py-1.5 text-[10px] font-bold tracking-wider text-neutral-400 uppercase font-heading">
                Active Kubernetes Clusters
              </div>

              {/* Scrollable list area */}
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
                        : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${activeCluster === cluster ? "bg-emerald-500" : "bg-neutral-600"}`} />
                      <span className="truncate">{cluster}</span>
                    </span>
                    {activeCluster === cluster && <Icon path={mdiCheck} size={0.65} className="text-blue-400 shrink-0" />}
                  </button>
                ))}
              </div>

              <div className="my-1 h-px bg-neutral-800" />

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
        </div>

        {/* Right Group: Status, Alert Bell, Profile */}
        <div className="flex items-center gap-4">
          {/* Live WebSocket Status Indicator */}
          <div className="flex items-center gap-2 rounded-full bg-background px-3 py-1 border border-neutral-800 text-[11px] font-medium text-neutral-300">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                isConnected
                  ? "bg-emerald-500"
                  : isConnecting
                  ? "bg-amber-500"
                  : "bg-red-500"
              }`}
            />
            <span className="font-mono">
              {isConnected
                ? `Connected (${currentWsLatencyMs}ms)`
                : currentWsStatus === "RECONNECTING"
                ? "Reconnecting..."
                : isConnecting
                ? "Connecting..."
                : "Disconnected"}
            </span>
          </div>

          <div className="h-4 w-px bg-neutral-800" />

          {/* Action Controls */}
          <div className="flex items-center gap-1.5">
            {/* Notifications Dropdown Panel */}
            <div className="relative" ref={notifMenuRef}>
              <button
                onClick={toggleNotif}
                title="Notifications"
                className="relative flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
              >
                <Icon path={mdiBell} size={0.7} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Panel with scrollable items list */}
              {notifMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-80 rounded-xl border border-neutral-700 bg-[#18181c] p-3 z-[70] shadow-2xl space-y-2">
                  <div className="flex items-center justify-between px-1 pb-2 border-b border-neutral-800">
                    <div className="flex items-center gap-2">
                      <Icon path={mdiBell} size={0.7} className="text-blue-400" />
                      <span className="text-xs font-semibold text-neutral-100 font-heading">Notifications</span>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-blue-500/10 px-1.5 py-0.2 text-[10px] font-semibold text-blue-400 border border-blue-500/20">
                          {unreadCount} unread
                        </span>
                      )}
                    </div>

                    {unreadCount > 0 && (
                      <button
                        onClick={markAllNotificationsRead}
                        className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-blue-400 transition-colors"
                        title="Mark all as read"
                      >
                        <Icon path={mdiCheckAll} size={0.65} />
                        <span>Mark all read</span>
                      </button>
                    )}
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-1.5 pr-0.5">
                    {notifications.length === 0 ? (
                      <div className="py-6 text-center text-xs text-neutral-400 font-mono">
                        No notifications
                      </div>
                    ) : (
                      notifications.map((item: NotificationItem) => (
                        <div
                          key={item.id}
                          onClick={() => markNotificationRead(item.id)}
                          className={`p-2.5 rounded-md border transition-all cursor-pointer ${
                            !item.read
                              ? "bg-neutral-900 border-blue-500/30"
                              : "bg-background border-neutral-800 opacity-75 hover:opacity-100"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              {!item.read && (
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                              )}
                              <span className="text-xs font-semibold text-neutral-200">
                                {item.title}
                              </span>
                            </div>
                            <span className="text-[10px] text-neutral-400 font-mono shrink-0">
                              {item.time}
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-300 mt-1 leading-snug">
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
                className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 border border-neutral-700 text-neutral-200 hover:border-neutral-500 transition-all"
              >
                <Icon path={mdiAccount} size={0.7} />
              </button>

              {userMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-52 rounded-xl border border-neutral-700 bg-[#18181c] p-2 z-[70] shadow-2xl space-y-1">
                  <div className="px-2 py-1.5">
                    <div className="text-xs font-medium text-neutral-100">Dev Team Lead</div>
                    <div className="text-[10px] text-neutral-400 font-mono">admin@envscale.internal</div>
                  </div>

                  <div className="my-1 h-px bg-neutral-800" />

                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      setAuthModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                  >
                    <Icon path={mdiLock} size={0.65} className="text-blue-400" />
                    <span>Sign In (Auth API)</span>
                  </button>

                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      setWorkspaceModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                  >
                    <EnvScaleLogo className="h-3.5 w-3.5 text-blue-400" />
                    <span>New Workspace</span>
                  </button>
                </div>
              )}
            </div>
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
