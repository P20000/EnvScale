import { Handle, Position } from '@xyflow/react';
import { MdCompareArrows as Icon } from 'react-icons/md';

export interface K8sServiceData extends Record<string, unknown> {
  name: string;
  type: "ClusterIP" | "LoadBalancer" | "NodePort" | "Ingress";
  port: string;
  targetPort?: string;
}

export function K8sServiceNode({ data }: { data: K8sServiceData }) {
  return (
    <div className="h-11 w-[240px] border border-zinc-800 bg-[#141417] flex items-center justify-between px-3 rounded-md select-none group hover:border-zinc-700 transition-colors">
      <Handle type="target" position={Position.Left} id="left-target" isConnectable={false} className="!w-1.5 !h-1.5 !bg-zinc-700 !border-zinc-900 rounded-full" />
      <Handle type="source" position={Position.Right} id="right-source" isConnectable={false} className="!w-1.5 !h-1.5 !bg-zinc-700 !border-zinc-900 rounded-full" />

      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} className="text-zinc-400 shrink-0" />
        <span className="text-xs font-mono font-medium truncate text-zinc-300 max-w-[140px]">
          {data.name}
        </span>
      </div>

      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-blue-500/20 bg-blue-500/10 text-blue-400 shrink-0">
        {data.port}
      </span>
    </div>
  );
}

K8sServiceNode.displayName = "K8sServiceNode";
