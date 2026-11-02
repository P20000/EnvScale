import React from "react";
import { Handle, Position } from "@xyflow/react";
import {
  MdStorage as StatefulSetIcon,
  MdFlashOn as ChaosIcon,
} from "react-icons/md";
import type { K8sPodData } from "./K8sPod";
import type { VolumeClaimTemplateInfo } from "../../store/types/topologyTypes";
import { useUIStore } from "../../store/useUIStore";
import { useTopologyStore } from "../../store/useTopologyStore";
import { StatefulOrdinalBlade } from "./statefulset/StatefulOrdinalBlade";
import { extractOrdinalIndex } from "../../store/helpers/statefulSetHelpers";

export interface K8sStatefulSetNodeData extends Record<string, unknown> {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  currentReplicas?: number;
  updatedReplicas?: number;
  serviceName?: string;
  currentRevision?: string;
  updateRevision?: string;
  updateStrategy?: string;
  partition?: number;
  volumeClaimTemplates?: VolumeClaimTemplateInfo[];
  pods?: K8sPodData[];
  cpuUsagePct?: number;
}

export function K8sStatefulSetNode({ data }: { data: K8sStatefulSetNodeData }) {
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const activeChaosFaults = useTopologyStore((s) => s.activeChaosFaults);
  const isTB = layoutDirection === "TB";

  const totalReplicas = Math.max(data.replicas || 0, (data.pods || []).length);
  const readyReplicas = data.readyReplicas || 0;
  const isHealthy = readyReplicas === totalReplicas && totalReplicas > 0;
  const isProgressing = readyReplicas < totalReplicas;

  // Sorter: strictly sort pods by ordinal index (0, 1, 2, ...)
  const sortedPods = [...(data.pods || [])].sort((a, b) => {
    const ordA = extractOrdinalIndex(a.name);
    const ordB = extractOrdinalIndex(b.name);
    return ordA - ordB;
  });

  // Check if any pod or the workload has chaos injected
  const workloadFault = activeChaosFaults[data.name];
  const hasActiveChaos = Boolean(workloadFault) || sortedPods.some((p) => Boolean(activeChaosFaults[p.name]));

  // Build ordinal slots array
  const slotCount = Math.max(totalReplicas, sortedPods.length, 1);
  const ordinalSlots = Array.from({ length: slotCount }, (_, idx) => {
    const pod = sortedPods.find((p) => extractOrdinalIndex(p.name) === idx) || sortedPods[idx];
    return {
      ordinal: idx,
      pod,
      isDesired: idx < (data.replicas || 1),
    };
  });

  const vct = (data.volumeClaimTemplates && data.volumeClaimTemplates[0]) || {
    name: "data",
    storage: "10 Gi",
    accessModes: "RWO",
  };

  const handleControllerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNode({
      type: "statefulset",
      data: {
        ...data,
        pods: sortedPods,
      },
    });
  };

  const handleSelectPod = (pod: K8sPodData) => {
    setSelectedNode({
      type: "pod",
      data: {
        ...pod,
        ownerName: data.name,
      },
    });
  };

  const cardWidth = Math.max(260, slotCount * 125 + 20);

  return (
    <div
      onClick={handleControllerClick}
      className={`rounded-lg border bg-[#17191E] p-2.5 shadow-xl transition-all select-none cursor-pointer group hover:border-[#4B515D] relative box-border w-full h-full flex flex-col justify-between ${
        hasActiveChaos
          ? "border-rose-500/70 shadow-[0_0_18px_rgba(244,63,94,0.25)]"
          : isHealthy
          ? "border-[#30343B]"
          : "border-amber-500/40"
      }`}
      style={{ width: `${cardWidth}px`, height: "132px" }}
    >
      {/* 4-Cardinal Dynamic React Flow Handles */}
      <Handle type="target" position={Position.Left} id="target-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Right} id="target-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Top} id="target-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      <Handle type="source" position={Position.Left} id="source-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Right} id="source-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Top} id="source-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      {/* Legacy Fallback Handles */}
      <Handle
        type="target"
        position={isTB ? Position.Top : Position.Left}
        id="left-target"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent pointer-events-none"
      />
      <Handle
        type="source"
        position={isTB ? Position.Bottom : Position.Right}
        id="right-source"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent pointer-events-none"
      />

      {/* StatefulSet Controller Header: Identity, STS Badge, Replicas */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#2D3139]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 shrink-0">
            <StatefulSetIcon className="text-sm" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono font-bold text-[#E6E1E5] truncate uppercase tracking-tight" title={data.name}>
                {data.name}
              </span>
              <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-purple-500/15 text-purple-300 font-semibold shrink-0">
                STS
              </span>
            </div>
            <span className="text-[9px] font-mono text-zinc-400 truncate">
              {data.namespace || "default"} • Svc: {data.serviceName || "headless"}
            </span>
          </div>
        </div>

        {/* Controller Status Badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {hasActiveChaos && (
            <span className="text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 flex items-center gap-1">
              <ChaosIcon className="text-[10px]" />
              CHAOS
            </span>
          )}

          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md ${
            isHealthy
              ? "text-[#111318] bg-[#6DD6A8]"
              : isProgressing
              ? "text-[#111318] bg-[#F4C26B]"
              : "text-zinc-300 bg-zinc-800"
          }`}>
            {readyReplicas}/{totalReplicas} Ready
          </span>
        </div>
      </div>

      {/* Ordered Instance Inventory Bays with Attached Storage */}
      <div className="flex items-stretch gap-1.5 pt-1.5 overflow-x-auto flex-1">
        {ordinalSlots.map((slot) => (
          <StatefulOrdinalBlade
            key={slot.ordinal}
            ordinal={slot.ordinal}
            pod={slot.pod}
            vct={vct}
            isDesired={slot.isDesired}
            onSelectPod={handleSelectPod}
          />
        ))}
      </div>
    </div>
  );
}

K8sStatefulSetNode.displayName = "K8sStatefulSetNode";
