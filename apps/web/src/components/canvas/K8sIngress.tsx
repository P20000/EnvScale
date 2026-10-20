import { Handle, Position } from '@xyflow/react';
import { MdPublic as Icon } from 'react-icons/md';
import { useUIStore } from '../../store/useUIStore';

export interface IngressRuleData {
  host: string;
  path: string;
  serviceName: string;
  servicePort: number;
}

export interface IngressTLSData {
  hosts?: string[];
  secretName?: string;
}

export interface K8sIngressData extends Record<string, unknown> {
  name: string;
  namespace: string;
  ingressClassName?: string;
  rules: IngressRuleData[];
  tls?: IngressTLSData[];
  loadBalancerIps?: string[];
  status?: string;
  labels?: Record<string, string>;
}

export function K8sIngressNode({ data }: { data: K8sIngressData }) {
  const rulesCount = data.rules?.length || 0;
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  return (
    <div className="w-[260px] h-[56px] px-3 py-2 rounded-lg border border-[#30343B] bg-[#191B20] hover:border-[#424750] flex flex-col justify-between cursor-pointer transition-colors select-none relative group">
      {/* 4-Cardinal Dynamic Handles */}
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

      {/* Row 1: Identity & Rules Chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-[#23262D] border border-[#30343B] flex items-center justify-center shrink-0 text-[#D0BCFF]">
            <Icon size={14} />
          </div>
          <span className="text-xs font-semibold text-[#E6E1E5] tracking-tight truncate max-w-[125px]" title={data.name}>
            {data.name}
          </span>
        </div>

        <span className="h-5 px-2 rounded-md inline-flex items-center font-mono text-[10px] font-medium leading-none bg-[#D0BCFF]/15 text-[#D0BCFF] shrink-0">
          {rulesCount} {rulesCount === 1 ? 'Rule' : 'Rules'}
        </span>
      </div>

      {/* Row 2: Ingress Spec & Routing Host */}
      <div className="flex items-center justify-between text-[10px] font-mono text-[#9AA0AA] leading-none">
        <span className="tracking-wider">INGRESS</span>
        <span className="text-[#777D87] truncate max-w-[130px]">
          {data.ingressClassName || data.rules?.[0]?.host || "PUBLIC ROUTE"}
        </span>
      </div>
    </div>
  );
}

K8sIngressNode.displayName = "K8sIngressNode";
