import { useState, useRef, useEffect } from "react";
import { Icon } from "../ui/Icon";
import { mdiChevronDown, mdiFilterVariant, mdiCheck } from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useUIStore } from "../../store/useUIStore";
import { extractAvailableNamespaces, SYSTEM_NAMESPACES } from "../../store/helpers/topologyHelpers";

export function NamespaceFilterPill() {
  const rawNodes = useTopologyStore((s) => s.rawNodes);
  const nodes = useTopologyStore((s) => s.nodes);
  const selectedNamespaces = useUIStore((s) => s.selectedNamespaces);
  const setSelectedNamespaces = useUIStore((s) => s.setSelectedNamespaces);
  const showSystemNamespaces = useUIStore((s) => s.showSystemNamespaces);

  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const allNodes = rawNodes && rawNodes.length > 0 ? rawNodes : nodes;
  const availableNamespaces = extractAvailableNamespaces(allNodes);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleNamespace = (ns: string) => {
    let currentSelected = selectedNamespaces;
    if (currentSelected.length === 0) {
      // Materialize the implicit state correctly before toggling
      currentSelected = availableNamespaces.filter((n) => showSystemNamespaces || !SYSTEM_NAMESPACES.has(n));
    }

    const isSelected = currentSelected.includes(ns);
    let next: string[];
    if (isSelected) {
      next = currentSelected.filter((item) => item !== ns && item !== "__NONE__");
      if (next.length === 0) {
        next = ["__NONE__"];
      }
    } else {
      next = [...currentSelected.filter((n) => n !== "__NONE__"), ns];
    }
    
    setSelectedNamespaces(next);
  };

  const handleSelectAll = () => {
    // Explicitly select all namespaces
    setSelectedNamespaces(availableNamespaces);
  };

  const handleClearAll = () => {
    setSelectedNamespaces(["__NONE__"]);
  };

  const getNamespaceCount = (ns: string) => {
    return allNodes.filter((n) => {
      const d = n.data as Record<string, unknown> | undefined;
      return d?.namespace === ns;
    }).length;
  };

  const labelText =
    selectedNamespaces.length === 0 ||
    (selectedNamespaces.length === availableNamespaces.length && availableNamespaces.length > 1 && !selectedNamespaces.includes("__NONE__"))
      ? "All Namespaces"
      : selectedNamespaces.includes("__NONE__")
      ? "No Namespaces"
      : selectedNamespaces.length === 1
      ? selectedNamespaces[0]
      : `${selectedNamespaces.length} Namespaces`;

  const displayCount = selectedNamespaces.length === 0 
    ? availableNamespaces.length 
    : selectedNamespaces.includes("__NONE__") 
      ? 0 
      : selectedNamespaces.length;

  return (
    <div className="relative" ref={menuRef}>
      {/* Sleek Pill Capsule Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 bg-[#18181b] border border-zinc-800 hover:border-zinc-700 h-9 px-3.5 rounded-full text-xs font-mono font-bold tracking-wider text-zinc-200 hover:text-white transition-all shadow-sm"
        title="Filter canvas by Kubernetes namespace"
      >
        <Icon path={mdiFilterVariant} size={0.65} className="text-blue-400" />
        <span className="truncate max-w-[120px]">{labelText}</span>
        <span className={`flex h-4 min-w-4 items-center justify-center rounded-full text-[10px] font-bold px-1 border ${
          displayCount > 0
            ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
            : "bg-zinc-800 text-zinc-500 border-zinc-700"
        }`}>
          {displayCount}
        </span>
        <Icon path={mdiChevronDown} size={0.65} className="text-zinc-400" />
      </button>

      {/* Checkbox Dropdown Popover */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2.5 w-64 rounded-xl border border-zinc-700 bg-[#18181c] p-2.5 z-[80] shadow-2xl space-y-2 select-none">
          <div className="flex items-center justify-between px-1 pb-1.5 border-b border-zinc-800">
            <div className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase font-heading">
              Filter Namespaces
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAll}
                className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold transition-colors"
              >
                All
              </button>
              <span className="text-zinc-700">•</span>
              <button
                onClick={handleClearAll}
                className="text-[10px] text-zinc-400 hover:text-zinc-300 font-semibold transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {availableNamespaces.map((ns) => {
              const isChecked = selectedNamespaces.length === 0 
                ? (showSystemNamespaces ? true : !SYSTEM_NAMESPACES.has(ns))
                : selectedNamespaces.includes(ns);
              const count = getNamespaceCount(ns);
              return (
                <div
                  key={ns}
                  onClick={() => toggleNamespace(ns)}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-mono cursor-pointer transition-colors ${
                    isChecked
                      ? "bg-blue-500/10 text-blue-300 border border-blue-500/20"
                      : "text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <div
                      className={`h-4 w-4 rounded flex items-center justify-center border transition-all ${
                        isChecked
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "border-zinc-700 bg-zinc-900"
                      }`}
                    >
                      {isChecked && <Icon path={mdiCheck} size={0.55} />}
                    </div>
                    <span className="truncate">{ns}</span>
                  </div>

                  {count > 0 && (
                    <span className="text-[10px] font-mono font-semibold text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-900/60 border border-zinc-800">
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
