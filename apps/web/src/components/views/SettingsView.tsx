import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiCog,
  mdiServerNetwork,
  mdiBellRing,
  mdiTune,
  mdiKey,
} from "@mdi/js";
import { ClustersVaultTab } from "../settings/ClustersVaultTab";
import { WebhooksTab } from "../settings/WebhooksTab";
import { PreferencesTab } from "../settings/PreferencesTab";
import { TokensTab } from "../settings/TokensTab";

export type SettingsTabId = "clusters" | "webhooks" | "preferences" | "tokens";

interface SettingsViewProps {
  onOpenConnectModal?: () => void;
}

export function SettingsView({ onOpenConnectModal }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("clusters");

  const tabs: { id: SettingsTabId; label: string; iconPath: string }[] = [
    {
      id: "clusters",
      label: "Clusters & Vault",
      iconPath: mdiServerNetwork,
    },
    {
      id: "webhooks",
      label: "Outbound Webhooks",
      iconPath: mdiBellRing,
    },
    {
      id: "preferences",
      label: "Stream & Canvas Tuning",
      iconPath: mdiTune,
    },
    {
      id: "tokens",
      label: "Gateway Access Tokens",
      iconPath: mdiKey,
    },
  ];

  return (
    <div className="h-screen w-full max-w-5xl pt-20 pl-20 pr-6 pb-14 mx-auto space-y-6 bg-background overflow-y-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-neutral-100 flex items-center gap-2 font-heading">
          <Icon path={mdiCog} size={0.83} className="text-neutral-300" />
          Workspace & Infrastructure Settings
        </h1>
        <p className="text-sm text-neutral-400 mt-1">
          Cluster secrets vault, incident webhooks, stream performance tuning, and gateway access tokens
        </p>
      </div>

      {/* Navigation Pills Bar */}
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-3 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isActive
                  ? "bg-blue-500/15 text-blue-400 font-semibold border border-blue-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent"
              }`}
            >
              <Icon path={tab.iconPath} size={0.65} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Tab Content */}
      <div className="pt-1">
        {activeTab === "clusters" && (
          <ClustersVaultTab onOpenConnectModal={onOpenConnectModal || (() => {})} />
        )}
        {activeTab === "webhooks" && <WebhooksTab />}
        {activeTab === "preferences" && <PreferencesTab />}
        {activeTab === "tokens" && <TokensTab />}
      </div>
    </div>
  );
}
