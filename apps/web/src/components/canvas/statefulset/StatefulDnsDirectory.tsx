import React, { useState } from "react";
import { MdDns as DnsIcon, MdContentCopy as CopyIcon, MdCheck as CheckIcon } from "react-icons/md";

export interface StatefulDnsDirectoryProps {
  serviceName?: string;
  namespace?: string;
  podNames: string[];
  port?: string | number;
}

export const StatefulDnsDirectory: React.FC<StatefulDnsDirectoryProps> = ({
  serviceName = "headless-service",
  namespace = "default",
  podNames,
  port = 6379,
}) => {
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const handleCopy = (fqdn: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fqdn);
    setCopiedName(fqdn);
    setTimeout(() => setCopiedName(null), 1500);
  };

  if (podNames.length === 0) return null;

  return (
    <div className="pt-2 border-t border-[#2D3139] mt-2 space-y-1">
      <div className="flex items-center justify-between text-[8px] font-mono tracking-wider uppercase text-zinc-400 font-bold px-0.5">
        <span className="flex items-center gap-1">
          <DnsIcon className="text-cyan-400 text-xs" />
          Network Identity Directory (Direct SRV / A-Record Discovery)
        </span>
        <span className="text-purple-300 font-semibold">{serviceName}</span>
      </div>

      <div className="space-y-1 bg-[#121418] p-1.5 rounded border border-[#23262D]">
        {podNames.map((podName, idx) => {
          const fqdn = `${podName}.${serviceName}.${namespace}.svc.cluster.local`;
          const isCopied = copiedName === fqdn;

          return (
            <div
              key={podName || idx}
              onClick={(e) => handleCopy(fqdn, e)}
              className="flex items-center justify-between text-[8.5px] font-mono py-0.5 px-1.5 rounded hover:bg-[#1C1F26] transition-colors cursor-pointer group/item"
              title="Click to copy cluster FQDN"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-purple-400 font-semibold shrink-0">#{idx}</span>
                <span className="text-zinc-300 font-bold truncate max-w-[85px]">{podName}</span>
                <span className="text-zinc-400">→</span>
                <span className="text-cyan-300 truncate max-w-[200px]" title={`${fqdn}:${port}`}>
                  {fqdn}:{port}
                </span>
              </div>

              <button
                type="button"
                className="text-zinc-400 group-hover/item:text-zinc-200 transition-colors ml-1.5 shrink-0"
              >
                {isCopied ? <CheckIcon className="text-emerald-400 text-xs" /> : <CopyIcon className="text-[10px]" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
