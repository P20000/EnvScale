import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal as TerminalIcon,
  X,
  Minus,
  Trash2,
  Maximize2,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { useTopologyStore } from "../../store/useTopologyStore";

interface CommandLog {
  id: string;
  command: string;
  output: React.ReactNode;
  isError?: boolean;
}

interface K8sNodeData {
  name?: string;
  id?: string;
  phase?: string;
  status?: string;
  restartCount?: number;
  type?: string;
  clusterIp?: string;
  port?: string;
  replicas?: number;
  readyReplicas?: number;
}

export function KubectlTerminal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [copied, setCopied] = useState(false);

  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const nodes = useTopologyStore((s) => s.nodes);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const initialLogs: CommandLog[] = [
    {
      id: "welcome-1",
      command: "kubectl cluster-info",
      output: (
        <div className="space-y-1 text-emerald-400 font-mono text-[11px]">
          <div>Kubernetes control plane is running at <span className="underline text-blue-400">https://192.168.49.2:8443</span></div>
          <div>CoreDNS is running at <span className="underline text-blue-400">https://192.168.49.2:8443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy</span></div>
          <div className="text-neutral-400 mt-1">
            Type <span className="text-emerald-300 font-bold">kubectl get pods</span>, <span className="text-emerald-300 font-bold">kubectl get nodes</span>, or <span className="text-emerald-300 font-bold">kubectl help</span> to get started.
          </div>
        </div>
      ),
    },
  ];

  const [logs, setLogs] = useState<CommandLog[]>(initialLogs);

  // Auto-scroll output container on new log entries
  useEffect(() => {
    if (isOpen) {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isOpen]);

  // Focus input on terminal open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleClear = () => {
    setLogs([]);
  };

  const handleCopyLogs = () => {
    const text = logs
      ? logs
          .map((l) => `$ ${l.command}\n${typeof l.output === "string" ? l.output : "[Rich Output]"}`)
          .join("\n\n")
      : "";
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Command Interpreter for kubectl CLI
  const executeCommand = useCallback(
    (cmdRaw: string) => {
      const cmd = cmdRaw.trim();
      if (!cmd) return;

      // Update command history
      setHistory((prev) => [cmd, ...prev]);
      setHistoryIdx(-1);

      if (cmd === "clear" || cmd === "cls") {
        setLogs([]);
        return;
      }

      let output: React.ReactNode = "";
      let isError = false;

      const lower = cmd.toLowerCase();

      if (lower === "kubectl help" || lower === "help") {
        output = (
          <div className="space-y-1 text-neutral-300 text-[11px] font-mono">
            <div className="text-emerald-400 font-bold mb-1">EnvScale Kubectl CLI Cheat-Sheet:</div>
            <div className="grid grid-cols-[180px_1fr] gap-x-2 gap-y-1">
              <span className="text-blue-400">kubectl get pods</span>
              <span className="text-neutral-400">List all streaming pods in cluster</span>
              <span className="text-blue-400">kubectl get nodes</span>
              <span className="text-neutral-400">List active worker nodes</span>
              <span className="text-blue-400">kubectl get services</span>
              <span className="text-neutral-400">List cluster IP services & ports</span>
              <span className="text-blue-400">kubectl get deployments</span>
              <span className="text-neutral-400">List workloads & replica status</span>
              <span className="text-blue-400">kubectl get ingress</span>
              <span className="text-neutral-400">List ingress controllers & routes</span>
              <span className="text-blue-400">kubectl describe pod &lt;name&gt;</span>
              <span className="text-neutral-400">Detailed pod spec & event logs</span>
              <span className="text-blue-400">kubectl cluster-info</span>
              <span className="text-neutral-400">Display control plane status</span>
              <span className="text-blue-400">clear</span>
              <span className="text-neutral-400">Clear terminal screen</span>
            </div>
          </div>
        );
      } else if (lower === "kubectl get pods" || lower === "kubectl get pod" || lower === "kubectl get po") {
        const podNodes = nodes.filter((n) => n.type === "k8sPod");
        if (podNodes.length === 0) {
          output = "No pods found in default namespace.";
        } else {
          output = (
            <div className="font-mono text-[11px] space-y-0.5">
              <div className="text-neutral-400 font-semibold grid grid-cols-[240px_80px_140px_90px_60px] gap-2">
                <span>NAME</span>
                <span>READY</span>
                <span>STATUS</span>
                <span>RESTARTS</span>
                <span>AGE</span>
              </div>
              {podNodes.map((pn) => {
                const data = pn.data as unknown as K8sNodeData;
                const isRunning = data.phase === "Running";
                const isCrash = data.phase?.includes("Crash") || data.phase?.includes("OOM");

                return (
                  <div
                    key={pn.id}
                    className="grid grid-cols-[240px_80px_140px_90px_60px] gap-2 truncate hover:bg-neutral-900/60 rounded px-0.5"
                  >
                    <span className="text-neutral-200 truncate">{data.name || pn.id}</span>
                    <span className="text-neutral-400">{isRunning ? "1/1" : "0/1"}</span>
                    <span
                      className={
                        isRunning
                          ? "text-emerald-400 font-semibold"
                          : isCrash
                          ? "text-red-400 font-semibold animate-pulse"
                          : "text-amber-400"
                      }
                    >
                      {data.phase || "Unknown"}
                    </span>
                    <span className="text-neutral-300">{data.restartCount ?? 0}</span>
                    <span className="text-neutral-400">12m</span>
                  </div>
                );
              })}
            </div>
          );
        }
      } else if (lower === "kubectl get nodes" || lower === "kubectl get node" || lower === "kubectl get no") {
        const workerNodes = nodes.filter((n) => n.type === "k8sWorker");
        output = (
          <div className="font-mono text-[11px] space-y-0.5">
            <div className="text-neutral-400 font-semibold grid grid-cols-[180px_90px_160px_60px_80px] gap-2">
              <span>NAME</span>
              <span>STATUS</span>
              <span>ROLES</span>
              <span>AGE</span>
              <span>VERSION</span>
            </div>
            <div className="grid grid-cols-[180px_90px_160px_60px_80px] gap-2 text-neutral-200">
              <span className="text-emerald-400 font-semibold">minikube</span>
              <span className="text-emerald-400">Ready</span>
              <span className="text-neutral-400">control-plane,master</span>
              <span className="text-neutral-400">3d4h</span>
              <span className="text-neutral-400">v1.30.0</span>
            </div>
            {workerNodes.map((wn) => {
              const data = wn.data as unknown as K8sNodeData;
              return (
                <div key={wn.id} className="grid grid-cols-[180px_90px_160px_60px_80px] gap-2 text-neutral-200">
                  <span className="truncate">{data.name || wn.id}</span>
                  <span className="text-emerald-400">{data.status || "Ready"}</span>
                  <span className="text-neutral-400">worker</span>
                  <span className="text-neutral-400">1d</span>
                  <span className="text-neutral-400">v1.30.0</span>
                </div>
              );
            })}
          </div>
        );
      } else if (lower === "kubectl get services" || lower === "kubectl get service" || lower === "kubectl get svc") {
        const svcs = nodes.filter((n) => n.type === "k8sService");
        output = (
          <div className="font-mono text-[11px] space-y-0.5">
            <div className="text-neutral-400 font-semibold grid grid-cols-[220px_110px_140px_100px] gap-2">
              <span>NAME</span>
              <span>TYPE</span>
              <span>CLUSTER-IP</span>
              <span>PORT(S)</span>
            </div>
            {svcs.length === 0 ? (
              <div className="text-neutral-400">No services found in cluster.</div>
            ) : (
              svcs.map((sn) => {
                const data = sn.data as unknown as K8sNodeData;
                return (
                  <div key={sn.id} className="grid grid-cols-[220px_110px_140px_100px] gap-2 text-neutral-200">
                    <span className="text-blue-400 font-medium truncate">{data.name || sn.id}</span>
                    <span className="text-neutral-400">{data.type || "ClusterIP"}</span>
                    <span className="text-neutral-400 font-mono">{data.clusterIp || "10.96.14.22"}</span>
                    <span className="text-emerald-400 font-mono">{data.port || "80/TCP"}</span>
                  </div>
                );
              })
            )}
          </div>
        );
      } else if (lower === "kubectl get deployments" || lower === "kubectl get deploy") {
        const deps = nodes.filter((n) => n.type === "k8sDeployment");
        output = (
          <div className="font-mono text-[11px] space-y-0.5">
            <div className="text-neutral-400 font-semibold grid grid-cols-[220px_80px_100px_100px_60px] gap-2">
              <span>NAME</span>
              <span>READY</span>
              <span>UP-TO-DATE</span>
              <span>AVAILABLE</span>
              <span>AGE</span>
            </div>
            {deps.map((dn) => {
              const data = dn.data as unknown as K8sNodeData;
              return (
                <div key={dn.id} className="grid grid-cols-[220px_80px_100px_100px_60px] gap-2 text-neutral-200">
                  <span className="text-purple-400 font-medium truncate">{data.name || dn.id}</span>
                  <span className="text-emerald-400">{data.readyReplicas || 2}/{data.replicas || 2}</span>
                  <span className="text-neutral-300">{data.replicas || 2}</span>
                  <span className="text-neutral-300">{data.readyReplicas || 2}</span>
                  <span className="text-neutral-400">12m</span>
                </div>
              );
            })}
          </div>
        );
      } else if (lower === "kubectl get ingress" || lower === "kubectl get ing") {
        const ings = nodes.filter((n) => n.type === "k8sIngress");
        output = (
          <div className="font-mono text-[11px] space-y-0.5">
            <div className="text-neutral-400 font-semibold grid grid-cols-[200px_90px_100px_140px_80px] gap-2">
              <span>NAME</span>
              <span>CLASS</span>
              <span>HOSTS</span>
              <span>ADDRESS</span>
              <span>PORTS</span>
            </div>
            {ings.map((ing) => {
              const data = ing.data as unknown as K8sNodeData;
              return (
                <div key={ing.id} className="grid grid-cols-[200px_90px_100px_140px_80px] gap-2 text-neutral-200">
                  <span className="text-amber-400 font-medium truncate">{data.name || ing.id}</span>
                  <span className="text-neutral-400">nginx</span>
                  <span className="text-neutral-300">*</span>
                  <span className="text-neutral-400 font-mono">192.168.49.2</span>
                  <span className="text-emerald-400 font-mono">80, 443</span>
                </div>
              );
            })}
          </div>
        );
      } else if (lower.startsWith("kubectl describe pod")) {
        const targetName = cmd.split(" ")[3] || "";
        const targetNode = nodes.find((n) => n.type === "k8sPod" && (n.data as unknown as K8sNodeData).name?.includes(targetName));
        const data = targetNode ? (targetNode.data as unknown as K8sNodeData) : { name: targetName || "todo-frontend-pod", phase: "Running", restartCount: 0 };

        output = (
          <div className="font-mono text-[11px] space-y-1 text-neutral-300">
            <div><span className="text-neutral-500">Name:</span>         {data.name}</div>
            <div><span className="text-neutral-500">Namespace:</span>    default</div>
            <div><span className="text-neutral-500">Priority:</span>     0</div>
            <div><span className="text-neutral-500">Node:</span>         minikube / 192.168.49.2</div>
            <div><span className="text-neutral-500">Status:</span>       <span className={data.phase === "Running" ? "text-emerald-400" : "text-red-400"}>{data.phase}</span></div>
            <div><span className="text-neutral-500">Restarts:</span>     {data.restartCount}</div>
            <div><span className="text-neutral-500">Containers:</span>   app (Image: node:18-alpine, State: Running)</div>
            <div className="text-emerald-400 mt-1 font-semibold">Events:</div>
            <div className="text-neutral-400 text-[10px] pl-2 border-l border-neutral-800">
              <div>Type    Reason     Age    From               Message</div>
              <div>Normal  Scheduled  12m    default-scheduler  Successfully assigned default/{data.name} to minikube</div>
              <div>Normal  Pulled     12m    kubelet            Container image "node:18-alpine" already present on machine</div>
              <div>Normal  Created    12m    kubelet            Created container app</div>
              <div>Normal  Started    12m    kubelet            Started container app</div>
            </div>
          </div>
        );
      } else if (lower === "kubectl cluster-info" || lower === "kubectl version") {
        output = (
          <div className="space-y-1 text-emerald-400 font-mono text-[11px]">
            <div>Kubernetes control plane (v1.30.0) is running at <span className="underline text-blue-400">https://192.168.49.2:8443</span></div>
            <div>CoreDNS is running at <span className="underline text-blue-400">https://192.168.49.2:8443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy</span></div>
          </div>
        );
      } else {
        output = `Error: Unrecognized command '${cmd}'. Type 'kubectl help' for available commands.`;
        isError = true;
      }

      setLogs((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          command: cmd,
          output,
          isError,
        },
      ]);
    },
    [nodes]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeCommand(inputVal);
      setInputVal("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx] || "");
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setInputVal("");
      }
    }
  };

  return (
    <>
      {/* Bottom-Left Trigger Pill Button */}
      <div className="fixed bottom-6 left-20 z-40">
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className={`flex items-center gap-2 rounded-2xl bg-neutral-900/90 backdrop-blur-md border px-3.5 py-2 text-xs font-mono font-semibold shadow-2xl transition-all active:scale-95 ${
            isOpen
              ? "border-emerald-500/50 bg-neutral-900 text-emerald-400 shadow-emerald-500/10"
              : "border-neutral-800 text-neutral-300 hover:border-emerald-500/40 hover:text-emerald-400"
          }`}
          title="Toggle Kubectl Terminal Shell"
        >
          <TerminalIcon className="h-4 w-4 text-emerald-400 animate-pulse" />
          <span>kubectl shell</span>
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
        </button>
      </div>

      {/* Slide-Up Terminal Drawer */}
      {isOpen && (
        <div
          className={`fixed bottom-20 left-20 z-50 flex flex-col rounded-2xl bg-[#0c0c0e]/95 backdrop-blur-xl border border-neutral-800 shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 ${
            isMaximized
              ? "w-[calc(100vw-12rem)] h-[calc(100vh-8rem)] bottom-12 left-20"
              : "w-[620px] max-w-[calc(100vw-6rem)] h-[390px]"
          }`}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-neutral-800/80 px-4 py-2.5 bg-neutral-950/60 rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <TerminalIcon className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-mono font-semibold text-neutral-200">
                kubectl CLI — <span className="text-emerald-400">{activeCluster}</span>
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCopyLogs}
                className="p-1 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
                title="Copy Terminal Log History"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>

              <button
                onClick={handleClear}
                className="p-1 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
                title="Clear Output"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => setIsMaximized((prev) => !prev)}
                className="p-1 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
                title={isMaximized ? "Restore Size" : "Maximize Window"}
              >
                {isMaximized ? <Minus className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>

              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-red-400 transition-colors"
                title="Close Terminal"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Terminal Logs & Interactive Output Area */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs text-neutral-300 selection:bg-emerald-500/30 cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {logs.map((log) => (
              <div key={log.id} className="space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11px]">
                  <ChevronRight className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span className="text-neutral-400 font-normal">{activeCluster}:~$</span>
                  <span className="text-neutral-100">{log.command}</span>
                </div>
                <div
                  className={`pl-5 text-[11px] leading-relaxed ${
                    log.isError ? "text-red-400" : "text-neutral-300"
                  }`}
                >
                  {log.output}
                </div>
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>

          {/* Prompt Input Footer */}
          <div className="flex items-center gap-2 border-t border-neutral-800/80 px-4 py-2.5 bg-neutral-950/80 rounded-b-2xl">
            <span className="text-emerald-400 font-mono text-xs font-semibold shrink-0 flex items-center gap-1">
              <span>{activeCluster}:~$</span>
            </span>
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type kubectl command (e.g. kubectl get pods, kubectl help)..."
              className="flex-1 bg-transparent font-mono text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>
      )}
    </>
  );
}
