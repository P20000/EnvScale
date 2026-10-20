import React from 'react';
import { type NodeProps } from '@xyflow/react';
import { MdOutlineShield } from 'react-icons/md';
import type { K8sDaemonSetData } from '../../store/types/topologyTypes';

export const K8sDaemonSetNode: React.FC<NodeProps> = ({ data }) => {
  const ds = data as unknown as K8sDaemonSetData;
  const ready = ds?.numberReady ?? 0;
  const desired = ds?.desiredNumberScheduled ?? 0;

  const isComplete = ready === desired && desired > 0;

  return (
    <div className="w-[260px] h-[56px] px-3 py-2 rounded-lg bg-[#191B20] border border-[#30343B] hover:border-[#424750] flex flex-col justify-between cursor-pointer transition-colors select-none group">
      {/* Row 1: Identity & Scheduled Nodes Chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-[#23262D] border border-[#30343B] flex items-center justify-center shrink-0 text-[#9AA0AA]">
            <MdOutlineShield className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-[#E6E1E5] tracking-tight truncate max-w-[120px]" title={ds?.name}>
            {ds?.name || 'daemonset'}
          </span>
        </div>

        <div className="h-5 px-2 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium leading-none shrink-0 bg-[#23262D] text-[#C4C7C5]">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isComplete ? "bg-[#6DD6A8]" : "bg-[#F4C26B]"
            }`}
          />
          {ready}/{desired} Nodes
        </div>
      </div>

      {/* Row 2: Workload Spec & Host Classification */}
      <div className="flex items-center justify-between text-[10px] font-mono text-[#9AA0AA] leading-none">
        <span className="tracking-wider">DAEMONSET</span>
        <span className="text-[#777D87]">HOST AGENT</span>
      </div>
    </div>
  );
};

K8sDaemonSetNode.displayName = "K8sDaemonSetNode";
