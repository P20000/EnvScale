import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  Plus,
  Bell,
  Focus,
  User,
  Check,
  Server,
  Layers,
  CheckCheck,
} from "lucide-react";
import { useTopologyStore, type NotificationItem } from "../../store/useTopologyStore";

interface TopNavbarProps {
  activeCluster: string;
  clusters: string[];
  onSelectCluster: (cluster: string) => void;
  onOpenConnectModal: () => void;
  onFitView?: () => void;
  activeIncidentsCount?: number;
  wsLatencyMs?: number;
  wsConnected?: boolean;
}

export function TopNavbar({
  activeCluster,
  clusters,
  onSelectCluster,
  onOpenConnectModal,
  onFitView,
  wsLatencyMs = 12,
  wsConnected = true,
}: TopNavbarProps) {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useTopologyStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

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

  return (
    <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-6 rounded-full bg-neutral-900/85 backdrop-blur-md border border-neutral-800 px-5 py-2 shadow-2xl min-w-[640px] max-w-4xl w-[calc(100%-2rem)]">
      {/* Left Group: Cluster Selector Dropdown */}
      <div className="flex items-center gap-3 relative" ref={dropdownRef}>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <Layers className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
            EnvScale
          </span>
        </div>

        <div className="h-4 w-px bg-neutral-800" />

        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-2 rounded-full bg-neutral-950/80 px-3 py-1.5 text-xs font-medium text-neutral-200 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/60 transition-all active:scale-95"
        >
          <Server className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-mono text-neutral-100 font-semibold truncate max-w-[140px]">
            {activeCluster}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-neutral-400 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>

        {/* Dropdown Menu with scrollable options list */}
        {dropdownOpen && (
          <div className="absolute top-full left-12 mt-2 w-64 rounded-xl border border-neutral-800 bg-[#141417] p-1.5 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-2 py-1.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
              <span>Active Clusters</span>
              <span className="font-mono text-[9px] text-neutral-400">({clusters.length})</span>
            </div>

            {/* Scrollable list area */}
            <div className="space-y-0.5 max-h-56 overflow-y-auto pr-0.5">
              {clusters.map((cluster) => (
                <button
                  key={cluster}
                  onClick={() => {
                    onSelectCluster(cluster);
                    setDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-mono transition-colors ${
                    activeCluster === cluster
                      ? "bg-blue-500/10 text-blue-400 font-semibold"
                      : "text-neutral-300 hover:bg-neutral-800/80 hover:text-neutral-100"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${activeCluster === cluster ? "bg-emerald-500" : "bg-neutral-600"}`} />
                    <span className="truncate">{cluster}</span>
                  </span>
                  {activeCluster === cluster && <Check className="h-3.5 w-3.5 text-blue-400 shrink-0" />}
                </button>
              ))}
            </div>

            <div className="my-1 h-px bg-neutral-800" />

            <button
              onClick={() => {
                setDropdownOpen(false);
                onOpenConnectModal();
              }}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Connect New Cluster</span>
            </button>
          </div>
        )}
      </div>

      {/* Right Group: Status, Alert Bell, Re-center, Profile */}
      <div className="flex items-center gap-4">
        {/* Live WebSocket Status Indicator */}
        <div className="flex items-center gap-2 rounded-full bg-neutral-950/60 px-3 py-1 border border-neutral-800/80 text-[11px] font-medium text-neutral-300">
          <span className="relative flex h-2 w-2">
            {wsConnected && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${wsConnected ? "bg-emerald-500" : "bg-red-500"}`} />
          </span>
          <span className="font-mono">{wsConnected ? `Connected (${wsLatencyMs}ms)` : "Disconnected"}</span>
        </div>

        <div className="h-4 w-px bg-neutral-800" />

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {/* Notifications Dropdown Panel */}
          <div className="relative" ref={notifMenuRef}>
            <button
              onClick={() => setNotifMenuOpen((prev) => !prev)}
              title="Notifications"
              className="relative flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors active:scale-95"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Panel with scrollable items list */}
            {notifMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-80 rounded-2xl border border-neutral-800 bg-[#141417] p-3 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150 space-y-2">
                <div className="flex items-center justify-between px-1 pb-2 border-b border-neutral-800">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-blue-400" />
                    <span className="text-xs font-semibold text-neutral-100">Notifications</span>
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
                      <CheckCheck className="h-3 w-3" />
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
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                          !item.read
                            ? "bg-neutral-900 border-blue-500/30"
                            : "bg-neutral-950/60 border-neutral-800/80 opacity-75 hover:opacity-100"
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

          {/* Topology Fit / Re-center Canvas */}
          <button
            onClick={onFitView}
            title="Fit / Center Graph"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors active:scale-95"
          >
            <Focus className="h-4 w-4" />
          </button>

          {/* User Profile */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 border border-neutral-700 text-neutral-200 hover:border-neutral-500 transition-all active:scale-95"
            >
              <User className="h-4 w-4" />
            </button>

            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 rounded-xl border border-neutral-800 bg-[#141417] p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-2 py-1.5">
                  <div className="text-xs font-medium text-neutral-100">Dev Team Lead</div>
                  <div className="text-[10px] text-neutral-400 font-mono">admin@envscale.internal</div>
                </div>
                <div className="my-1 h-px bg-neutral-800" />
                <div className="px-2 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Role: ADMIN
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
