import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiChevronDown,
  mdiAccount,
  mdiCheckCircle,
  mdiPlus,
  mdiLock,
  mdiLogout,
  mdiDeleteOutline,
  mdiKeyOutline,
} from "@mdi/js";
import { useAuthStore, type AuthMedium, type StoredAccount } from "../../store/useAuthStore";
import { toast } from "../../lib/toast";

interface UserProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuthModal: () => void;
}

export function GoogleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export function GithubIcon({ className = "h-4 w-4 text-white" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function MediumBadge({
  medium,
  className = "h-3.5 w-3.5",
}: {
  medium: AuthMedium;
  className?: string;
}) {
  if (medium === "google") {
    return <GoogleIcon className={className} />;
  }
  if (medium === "github") {
    return <GithubIcon className={className} />;
  }
  return <Icon path={mdiKeyOutline} size={0.55} className="text-amber-400" />;
}

export function UserProfileMenu({ isOpen, onClose, onOpenAuthModal }: UserProfileMenuProps) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const savedAccounts = useAuthStore((s) => s.savedAccounts);
  const switchAccount = useAuthStore((s) => s.switchAccount);
  const removeAccount = useAuthStore((s) => s.removeAccount);
  const logoutCurrentAccount = useAuthStore((s) => s.logoutCurrentAccount);
  const logoutAll = useAuthStore((s) => s.logoutAll);

  const [expandedMediums, setExpandedMediums] = useState<Record<AuthMedium, boolean>>({
    google: true,
    github: true,
    credentials: true,
  });

  if (!isOpen) return null;

  const currentEmail = (user?.email || "").trim().toLowerCase();
  const userName = user?.name || (user?.email ? user.email.split("@")[0] : "Authenticated User");
  const userEmail = user?.email || "";
  const userAvatarUrl = user?.image || null;
  const currentMedium: AuthMedium = user?.medium || "credentials";

  const googleAccounts = savedAccounts.filter((a) => a.medium === "google");
  const githubAccounts = savedAccounts.filter((a) => a.medium === "github");
  const credentialAccounts = savedAccounts.filter((a) => a.medium === "credentials");

  const toggleMedium = (m: AuthMedium) => {
    setExpandedMediums((prev) => ({ ...prev, [m]: !prev[m] }));
  };

  const handleSwitch = async (account: StoredAccount) => {
    if (account.email.trim().toLowerCase() === currentEmail) {
      return;
    }
    const success = await switchAccount(account.id || account.email);
    if (success) {
      toast.show({
        title: "Account Switched",
        description: `Switched active session to ${account.name || account.email}`,
        variant: "success",
      });
      onClose();
    } else {
      toast.show({
        title: "Switch Failed",
        description: `Unable to switch to ${account.name || account.email}. Please sign in again.`,
        variant: "error",
      });
    }
  };

  const handleRemove = async (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    await removeAccount(accountId);
    toast.show({
      title: "Account Removed",
      description: "Session removed from this browser",
      variant: "info",
    });
  };

  const mediumConfig: Array<{
    id: AuthMedium;
    label: string;
    icon: React.ReactNode;
    accounts: StoredAccount[];
  }> = [
    {
      id: "google",
      label: "Google Accounts",
      icon: <GoogleIcon className="h-4 w-4 shrink-0" />,
      accounts: googleAccounts,
    },
    {
      id: "github",
      label: "GitHub Accounts",
      icon: <GithubIcon className="h-4 w-4 shrink-0 text-white" />,
      accounts: githubAccounts,
    },
    {
      id: "credentials",
      label: "Standard Login Sessions",
      icon: <Icon path={mdiKeyOutline} size={0.65} className="text-amber-400 shrink-0" />,
      accounts: credentialAccounts,
    },
  ];

  return (
    <div
      role="dialog"
      aria-label="User Account Switcher"
      className="absolute left-full bottom-0 ml-3 w-72 rounded-2xl border border-[#424750] bg-[#1E2128] p-3 z-[70] shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150 select-none max-h-[85vh] overflow-y-auto"
    >
      {/* Current Active User Profile Header */}
      <div className="flex items-center gap-3 p-1.5 rounded-xl bg-[#282B33] border border-[#3A3E47]/70">
        <div className="relative shrink-0">
          <div className="h-10 w-10 rounded-full border-2 border-[#A8C7FA]/60 bg-gradient-to-tr from-[#284568] to-[#1E2127] flex items-center justify-center overflow-hidden shadow-md">
            {userAvatarUrl ? (
              <img
                src={userAvatarUrl}
                alt={userName}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = "none";
                }}
              />
            ) : userEmail ? (
              <span className="text-sm font-bold uppercase text-white font-heading">
                {userEmail.charAt(0)}
              </span>
            ) : (
              <Icon path={mdiAccount} size={0.75} className="text-white" />
            )}
          </div>
          {/* Medium Indicator Icon on Avatar */}
          <div
            title={`Authenticated via ${currentMedium}`}
            className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[#191B20] border border-[#424750] flex items-center justify-center shadow"
          >
            <MediumBadge medium={currentMedium} className="h-2.5 w-2.5" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {isAuthenticated ? (
            <>
              {/* Name */}
              <div className="text-xs font-bold text-[#E6E1E5] font-heading truncate">
                {userName}
              </div>
              {/* Email - same color as name, clean non-monospace typography */}
              <div className="text-[11px] text-[#E6E1E5]/80 font-sans truncate">
                {userEmail}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-[#E6E1E5] font-heading">Guest Account</div>
              <div className="text-[11px] text-[#E6E1E5]/80 font-sans">Not Authenticated</div>
            </>
          )}
        </div>

        {isAuthenticated && (
          <div className="shrink-0 flex items-center pr-1 text-[#6DD6A8]" title="Active Session">
            <Icon path={mdiCheckCircle} size={0.75} />
          </div>
        )}
      </div>

      <div className="h-px bg-[#30343B]" />

      {/* Medium Sections: ONLY rendered if user has accounts in that medium */}
      <div className="space-y-2">
        {mediumConfig.map((group) => {
          // Rule: these dropdowns shouldn't appear if they were not logged in with those mediums
          if (group.accounts.length === 0) {
            return null;
          }

          const isExpanded = expandedMediums[group.id];

          return (
            <div key={group.id} className="rounded-xl border border-[#30343B] bg-[#23262D]/60 overflow-hidden">
              {/* Dropdown Section Header with Downward Facing Compact Arrow */}
              <button
                type="button"
                onClick={() => toggleMedium(group.id)}
                className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-semibold text-[#E6E1E5] hover:bg-[#30343B]/50 transition-colors"
                aria-expanded={isExpanded}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {group.icon}
                  <span className="truncate">{group.label}</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#30343B] text-[#C4C7C5] font-mono">
                    {group.accounts.length}
                  </span>
                </div>

                {/* Downward facing compact arrow icon that rotates when expanded/collapsed */}
                <Icon
                  path={mdiChevronDown}
                  size={0.65}
                  className={`text-[#C4C7C5] transition-transform duration-200 shrink-0 ${
                    isExpanded ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </button>

              {/* Expanded Accounts List */}
              {isExpanded && (
                <div className="p-1.5 space-y-1 border-t border-[#30343B]/60 bg-[#191B20]/50">
                  {group.accounts.map((acc) => {
                    const isActive = acc.email.trim().toLowerCase() === currentEmail;

                    return (
                      <div
                        key={acc.id || acc.email}
                        onClick={() => handleSwitch(acc)}
                        className={`group w-full flex items-center justify-between gap-2.5 rounded-lg px-2 py-1.5 cursor-pointer transition-all duration-150 ${
                          isActive
                            ? "bg-[#A8C7FA]/15 border border-[#A8C7FA]/40 text-white shadow-sm"
                            : "hover:bg-[#30343B]/70 border border-transparent text-[#E6E1E5]"
                        }`}
                        title={isActive ? "Current Active Account" : `Switch to ${acc.email}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {/* Account Avatar */}
                          <div className="relative h-7 w-7 rounded-full border border-[#424750] bg-[#282B33] flex items-center justify-center overflow-hidden shrink-0">
                            {acc.image ? (
                              <img
                                src={acc.image}
                                alt={acc.name}
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  (e.currentTarget as HTMLElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <span className="text-[11px] font-bold uppercase text-[#E6E1E5]">
                                {acc.email.charAt(0)}
                              </span>
                            )}
                          </div>

                          {/* Account Name and Email with SAME color tone */}
                          <div className="min-w-0 flex-1 text-left">
                            <div className="text-xs font-semibold text-[#E6E1E5] font-heading truncate leading-tight">
                              {acc.name}
                            </div>
                            <div className="text-[10px] text-[#E6E1E5]/80 font-sans truncate leading-tight">
                              {acc.email}
                            </div>
                          </div>
                        </div>

                        {/* Status / Action Indicator */}
                        <div className="flex items-center gap-1 shrink-0">
                          {isActive ? (
                            <span className="text-[#6DD6A8] p-0.5" title="Active Account">
                              <Icon path={mdiCheckCircle} size={0.7} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => handleRemove(e, acc.id || acc.email)}
                              title="Remove session"
                              aria-label="Remove session"
                              className="opacity-0 group-hover:opacity-100 p-1.5 text-[#9AA0AA] hover:text-[#F2B8B5] hover:bg-[#373d49] rounded-lg transition-all"
                            >
                              <Icon path={mdiDeleteOutline} size={0.6} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="h-px bg-[#30343B]" />

      {/* Footer Controls: Add Account & Sign Out */}
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenAuthModal();
          }}
          className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[#C4C7C5] hover:bg-[#373d49] hover:text-[#E6E1E5] transition-colors"
        >
          <Icon path={mdiPlus} size={0.65} className="text-[#A8C7FA] shrink-0" />
          <span>Add another account</span>
        </button>

        {isAuthenticated ? (
          <>
            {savedAccounts.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    onClose();
                    await logoutCurrentAccount();
                  }}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[#C4C7C5] hover:bg-[#373d49] hover:text-[#E6E1E5] transition-colors"
                >
                  <Icon path={mdiLock} size={0.65} className="text-[#A8C7FA] shrink-0" />
                  <span>Sign out of current account</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    onClose();
                    await logoutAll();
                  }}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[#C4C7C5] hover:bg-[#373d49] hover:text-[#E6E1E5] transition-colors"
                >
                  <Icon path={mdiLogout} size={0.65} className="text-[#A8C7FA] shrink-0" />
                  <span>Sign out of all accounts</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  onClose();
                  await logoutAll();
                }}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[#C4C7C5] hover:bg-[#373d49] hover:text-[#E6E1E5] transition-colors"
              >
                <Icon path={mdiLogout} size={0.65} className="text-[#A8C7FA] shrink-0" />
                <span>Sign Out</span>
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAuthModal();
            }}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#A8C7FA] px-2.5 py-2 text-xs font-bold text-[#102F50] hover:bg-[#D3E3FD] transition-colors shadow-sm cursor-pointer"
          >
            <Icon path={mdiLock} size={0.65} className="text-[#102F50]" />
            <span>Sign In / Register</span>
          </button>
        )}
      </div>
    </div>
  );
}
