import {
  MdDescription as ConfigIcon,
  MdLockOutline as SecretIcon,
  MdWarningAmber as WarningIcon,
  MdSecurity as SecurityShieldIcon,
  MdInfoOutline as InfoIcon,
} from "react-icons/md";
import type { K8sPodData } from "../../canvas/K8sPod";
import { useTopologyStore } from "../../../store/useTopologyStore";
import { findMissingConfigReferences } from "../../../store/helpers/configHelpers";

interface ConfigOverviewSectionProps {
  pod: K8sPodData;
}

export function ConfigOverviewSection({ pod }: ConfigOverviewSectionProps) {
  const configMaps = useTopologyStore((s) => s.configMaps);
  const secrets = useTopologyStore((s) => s.secrets);

  const missingAudits = findMissingConfigReferences(
    [pod],
    configMaps,
    secrets,
    pod.namespace || "default"
  );

  const podConfigs = pod.configMaps || [];
  const podSecrets = pod.secrets || [];

  return (
    <div className="space-y-3">
      {/* 1. Missing Reference Diagnostic Banner (CreateContainerConfigError Protection) */}
      {missingAudits.length > 0 && (
        <div className="rounded-xl border border-rose-500/50 bg-rose-950/30 p-3 space-y-2 text-rose-200 shadow-md shadow-rose-950/20">
          <div className="flex items-center gap-2 font-bold text-xs tracking-tight">
            <WarningIcon className="text-rose-400 text-base shrink-0" />
            <span>Missing Reference Fault Detected</span>
          </div>
          {missingAudits.map((audit, idx) => (
            <div
              key={`${audit.kind}-${audit.name}-${idx}`}
              className="rounded-lg bg-rose-900/30 border border-rose-500/30 p-2.5 text-[11px] font-mono space-y-1 text-rose-300"
            >
              <div className="font-semibold text-rose-100">
                ⚠️ Missing Reference Fault Detected: {audit.kind} &quot;{audit.name}&quot; was not found in namespace &quot;{audit.namespace}&quot;.
              </div>
              <div className="text-[9.5px] text-rose-400">
                Injection Method: <span className="uppercase font-semibold">{audit.refType}</span>
                {audit.key ? ` (key: ${audit.key})` : ""}
                {audit.mountPath ? ` (path: ${audit.mountPath})` : ""}
              </div>
              <div className="text-[10px] text-rose-300 font-medium">
                Will trigger Kubernetes runtime fault: <span className="font-bold underline text-rose-100">CreateContainerConfigError</span>.
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2. Referenced ConfigMaps */}
      <div className="rounded-xl border border-amber-500/20 bg-zinc-900/60 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
            <ConfigIcon className="h-4 w-4 text-amber-400" />
            Mounted ConfigMaps
          </h4>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
            {podConfigs.length} Ref{podConfigs.length !== 1 ? "s" : ""}
          </span>
        </div>

        {podConfigs.length > 0 ? (
          <div className="space-y-2">
            {podConfigs.map((cmRef, idx) => {
              const liveCM = configMaps.find(
                (c) => c.name === cmRef.name && c.namespace === (pod.namespace || "default")
              );
              return (
                <div
                  key={`${cmRef.name}-${idx}`}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-xs space-y-1 font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-amber-300 font-semibold truncate" title={cmRef.name}>
                      {cmRef.name}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase">
                      {cmRef.type}
                    </span>
                  </div>
                  {cmRef.mountPath && (
                    <div className="text-[10px] text-zinc-400 truncate">
                      Mount Path: <span className="text-zinc-200">{cmRef.mountPath}</span>
                    </div>
                  )}
                  {cmRef.key && (
                    <div className="text-[10px] text-zinc-400 truncate">
                      Key Ref: <span className="text-zinc-200">{cmRef.key}</span>
                    </div>
                  )}
                  {liveCM && liveCM.keys.length > 0 && (
                    <div className="text-[9px] text-zinc-500 pt-0.5">
                      Keys Defined ({liveCM.keys.length}): {liveCM.keys.join(", ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-[11px] font-mono text-zinc-500 italic py-1 flex items-center gap-1">
            <InfoIcon className="text-zinc-600" />
            No ConfigMaps attached to this pod
          </div>
        )}
      </div>

      {/* 3. Referenced Secrets */}
      <div className="rounded-xl border border-purple-500/20 bg-zinc-900/60 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <SecretIcon className="h-4 w-4 text-purple-400" />
            <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Mounted Secrets
            </h4>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex items-center gap-0.5" title="Enterprise Security Guard: Secret payloads are never stored or streamed">
              <SecurityShieldIcon className="text-[10px]" />
              Redacted
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300">
              {podSecrets.length} Ref{podSecrets.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {podSecrets.length > 0 ? (
          <div className="space-y-2">
            {podSecrets.map((secRef, idx) => {
              const liveSec = secrets.find(
                (s) => s.name === secRef.name && s.namespace === (pod.namespace || "default")
              );
              return (
                <div
                  key={`${secRef.name}-${idx}`}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-xs space-y-1 font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-purple-300 font-semibold truncate" title={secRef.name}>
                      {secRef.name}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase">
                      {secRef.type}
                    </span>
                  </div>
                  {secRef.mountPath && (
                    <div className="text-[10px] text-zinc-400 truncate">
                      Mount Path: <span className="text-zinc-200">{secRef.mountPath}</span>
                    </div>
                  )}
                  {secRef.key && (
                    <div className="text-[10px] text-zinc-400 truncate">
                      Key Ref: <span className="text-zinc-200">{secRef.key}</span>
                    </div>
                  )}
                  {liveSec && (
                    <div className="flex items-center justify-between text-[9px] text-zinc-500 pt-0.5">
                      <span>Type: {liveSec.type}</span>
                      <span>Keys ({liveSec.keys.length}): {liveSec.keys.join(", ")}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-[11px] font-mono text-zinc-500 italic py-1 flex items-center gap-1">
            <InfoIcon className="text-zinc-600" />
            No Secrets attached to this pod
          </div>
        )}
      </div>
    </div>
  );
}
