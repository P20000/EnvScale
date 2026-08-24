import { useState } from "react";
import {
  MdSettings as Settings,
  MdVpnKey as Key,
  MdShield as Shield,
  MdLock as Lock,
  MdContentCopy as Copy,
  MdCheck as Check,
  MdDelete as Trash2,
  MdAdd as Plus,
} from "react-icons/md";
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
    <div className="w-full max-w-6xl px-6 lg:px-8 pt-24 pb-12 mx-auto space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
          <Settings className="h-6 w-6 text-neutral-300" />
          Workspace Settings
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          RBAC permissions, encrypted Kubeconfig vault, API key management, and PostgreSQL schemas
        </p>
      </div>

      <div className="space-y-4">
        {/* Kubeconfig Encryption Card */}
        <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-5 space-y-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-emerald-400" />
              <h3 className="text-sm font-semibold text-neutral-200">AES-256-GCM Kubeconfig Vault</h3>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
              ENCRYPTED
            </span>
          </div>
          <p className="text-xs text-neutral-400">
            Kubeconfig credentials are automatically encrypted using AES-256-GCM before storage in PostgreSQL.
          </p>
          <div className="p-3 rounded-xl bg-neutral-950 font-mono text-[11px] text-neutral-400 border border-neutral-800">
            Vault Key ID: <span className="text-neutral-200">enc_v2_9a8f4c1...</span> (PostgreSQL Drizzle ORM)
          </div>
        </div>

        {/* RBAC Rules Card */}
        <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-5 space-y-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-400" />
              <h3 className="text-sm font-semibold text-neutral-200">Role-Based Access Control (RBAC)</h3>
            </div>
            <span className="text-xs font-mono text-neutral-400">Active Role: ADMIN</span>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-xs space-y-1">
              <div className="font-bold text-neutral-200">ADMIN</div>
              <div className="text-[10px] text-neutral-400">Full cluster write, chaos fault injection, RBAC governance.</div>
            </div>
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-xs space-y-1">
              <div className="font-bold text-neutral-200">MEMBER</div>
              <div className="text-[10px] text-neutral-400">Read-only topology view, metric telemetry, incident logs.</div>
            </div>
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-xs space-y-1">
              <div className="font-bold text-neutral-200">VIEWER</div>
              <div className="text-[10px] text-neutral-400">Read-only topology canvas view.</div>
            </div>
          </div>
        </div>

        {/* API Tokens Card */}
        <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-5 space-y-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-semibold text-neutral-200">API Access Tokens</h3>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Generate Access Token</span>
            </button>
          </div>

          <p className="text-xs text-neutral-400">
            Access tokens allow external CI/CD pipelines and client-go agents to stream cluster metrics.
          </p>

          {/* Scrollable list container for tokens */}
          <div className="max-h-64 overflow-y-auto space-y-2 pt-2 pr-0.5">
            {tokens.length === 0 ? (
              <div className="p-4 rounded-xl bg-neutral-950 text-xs text-neutral-400 text-center font-mono border border-neutral-800">
                No active API access tokens.
              </div>
            ) : (
              tokens.map((t) => (
                <div
                  key={t.id}
                  className="p-3.5 rounded-xl bg-neutral-950 flex items-center justify-between border border-neutral-800 hover:border-neutral-700 transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-neutral-200 flex items-center gap-2">
                      <span>{t.name}</span>
                      <span className="text-[10px] font-mono text-neutral-400">({t.createdAt})</span>
                    </div>
                    <div className="font-mono text-xs text-amber-400/90">{t.token}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(t.id, t.token)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-[11px] font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
                      title="Copy Token"
                    >
                      {copiedTokenId === t.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-neutral-400" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => revokeToken(t.id)}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-neutral-900 transition-colors"
                      title="Revoke Token"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-[#141417] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
                <Key className="h-4 w-4 text-amber-400" />
                Generate New Access Token
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-200 text-lg leading-none"
              >
                ×
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
                  className="w-full rounded-xl bg-neutral-900 border border-neutral-800 px-3.5 py-2 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 font-mono">
                Prefix: <span className="font-bold">envscale_</span> (Format: envscale_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-medium text-neutral-400 hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
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
