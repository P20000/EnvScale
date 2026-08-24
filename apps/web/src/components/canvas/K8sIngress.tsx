import { Handle, Position } from '@xyflow/react';
import { MdPublic as Icon } from 'react-icons/md';

export interface IngressRuleData {
  host: string;
  path: string;
  serviceName: string;
  servicePort: number;
}

export interface K8sIngressData extends Record<string, unknown> {
  name: string;
  namespace: string;
  rules: IngressRuleData[];
}

export function K8sIngressNode({ data }: { data: K8sIngressData }) {
  const rulesCount = data.rules?.length || 0;

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

      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-violet-500/20 bg-violet-500/10 text-violet-400 shrink-0">
        {rulesCount} Rules
      </span>
    </div>
  );
}

K8sIngressNode.displayName = "K8sIngressNode";
