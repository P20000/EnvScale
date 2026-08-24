import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiCog,
  mdiKey,
  mdiShield,
  mdiLock,
  mdiContentCopy,
  mdiCheck,
  mdiTrashCanOutline,
  mdiPlus,
  mdiClose,
} from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";

export function SettingsView() {
  const tokens = useTopologyStore((s) => s.tokens);
  const generateToken = useTopologyStore((s) => s.generateToken);
  const revokeToken = useTopologyStore((s) => s.revokeToken);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [newTokenName, setNewTokenName] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCopy = (tokenId: string, tokenString: string) => {
    navigator.clipboard.writeText(tokenString);
    setCopiedTokenId(tokenId);
    setTimeout(() => setCopiedTokenId(null), 2000);
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    generateToken(newTokenName.trim() || undefined);
    setNewTokenName("");
    setIsModalOpen(false);
  };

  return (
    <div className="w-full max-w-6xl px-6 lg:px-8 pt-24 pb-12 mx-auto space-y-6 bg-background">
      <div>
        <h1 className="text-xl font-bold text-neutral-100 flex items-center gap-2 font-heading">
          <Icon path={mdiCog} size={0.83} className="text-neutral-300" />
          Workspace Settings
        </h1>
        <p className="text-sm text-neutral-400 mt-1">
          RBAC permissions, encrypted Kubeconfig vault, API key management, and PostgreSQL schemas
        </p>
      </div>

      <div className="space-y-4">
        {/* Kubeconfig Encryption Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon path={mdiLock} size={0.83} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-neutral-200 font-heading">AES-256-GCM Kubeconfig Vault</h3>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20 font-mono">
              ENCRYPTED
            </span>
          </div>
          <p className="text-xs text-neutral-400">
            Kubeconfig credentials are automatically encrypted using AES-256-GCM before storage in PostgreSQL.
          </p>
        </div>

        {/* RBAC Governance Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon path={mdiShield} size={0.83} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-neutral-200 font-heading">Workspace Access Guard (RBAC)</h3>
            </div>
            <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400 border border-blue-500/20 font-mono">
              ACTIVE (ADMIN)
            </span>
          </div>
          <p className="text-xs text-neutral-400">
            Access levels enforced across REST endpoints: <span className="font-mono text-neutral-300">ADMIN</span>, <span className="font-mono text-neutral-300">MEMBER</span>, <span className="font-mono text-neutral-300">VIEWER</span>.
          </p>
        </div>

        {/* API Tokens Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon path={mdiKey} size={0.83} className="text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-neutral-200 font-heading">Streaming Gateway Access Tokens</h3>
                <p className="text-[11px] text-neutral-400">
                  Bearer tokens for authenticating k8s-streamer WebSocket connections
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
            >
              <Icon path={mdiPlus} size={0.65} />
              <span>Generate Token</span>
            </button>
          </div>

          {/* Token List */}
          <div className="space-y-2.5 font-mono text-xs">
            {tokens.length === 0 ? (
              <div className="p-4 text-center text-neutral-500 text-xs rounded-md bg-background border border-neutral-800">
                No active access tokens found. Generate one to connect remote stream agents.
              </div>
            ) : (
              tokens.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-3 rounded-md bg-background border border-neutral-800 gap-4"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-neutral-200 font-sans">{t.name}</span>
                      <span className="text-[10px] text-neutral-500">Created: {t.createdAt}</span>
                    </div>
                    <div className="text-[11px] text-neutral-400 truncate">
                      {t.token.slice(0, 16)}...{t.token.slice(-6)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleCopy(t.id, t.token)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 hover:text-white text-[11px] transition-colors"
                    >
                      {copiedTokenId === t.id ? (
                        <>
                          <Icon path={mdiCheck} size={0.55} className="text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Icon path={mdiContentCopy} size={0.55} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => revokeToken(t.id)}
                      className="p-1.5 rounded-md text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
                      title="Revoke Token"
                    >
                      <Icon path={mdiTrashCanOutline} size={0.65} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Generate Token Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-3xl border border-neutral-800 bg-surface p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2 font-heading">
                <Icon path={mdiKey} size={0.7} className="text-amber-400" />
                Generate New Access Token
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-neutral-200 rounded-md transition-colors"
              >
                <Icon path={mdiClose} size={0.7} />
              </button>
            </div>

            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-300">Token Description / Agent Name</label>
                <input
                  type="text"
                  placeholder="e.g. CI/CD Deployment Bot"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  className="w-full rounded-sm bg-background border border-neutral-800 px-3.5 py-2 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 font-mono">
                Prefix: <span className="font-bold">envscale_</span> (Format: envscale_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-md px-4 py-2 text-xs font-medium text-neutral-400 hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
                >
                  Generate Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
