import { useState, useEffect, useCallback } from "react";
import {
  MdClose as X,
  MdSecurity as ShieldAlert,
  MdAutoAwesome as Sparkles,
} from "react-icons/md";
import { useAlertStore } from "../../store/useAlertStore";
import { AlertRuleBuilder } from "./AlertRuleBuilder";
import { cn } from "../../lib/utils";

interface AlertRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const defaultFormState = {
  name: "",
  metric: "cpu" as const,
  operator: "greater_than" as const,
  threshold: 80,
  duration: "5 minutes",
  namespace: "all",
  severity: "critical" as const,
  enabled: true,
};

export function AlertRuleModal({ isOpen, onClose }: AlertRuleModalProps) {
  const selectedAlertRule = useAlertStore((s) => s.selectedAlertRule);
  const setSelectedAlertRule = useAlertStore((s) => s.setSelectedAlertRule);
  const addAlertRule = useAlertStore((s) => s.addAlertRule);
  const updateAlertRule = useAlertStore((s) => s.updateAlertRule);

  const [formState, setFormState] = useState(() => {
    if (selectedAlertRule) {
      return {
        name: selectedAlertRule.name,
        metric: selectedAlertRule.metric,
        operator: selectedAlertRule.operator,
        threshold: selectedAlertRule.threshold,
        duration: selectedAlertRule.duration,
        namespace: selectedAlertRule.namespace,
        severity: selectedAlertRule.severity,
        enabled: selectedAlertRule.enabled,
      };
    }
    return defaultFormState;
  });

  const [touched, setTouched] = useState(false);

  const handleClose = useCallback(() => {
    setSelectedAlertRule(null);
    onClose();
  }, [setSelectedAlertRule, onClose]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Perform validation
  const validateForm = (state: typeof formState) => {
    const errs: Record<string, string> = {};
    if (!state.name.trim()) {
      errs.name = "Rule name is required";
    }
    if (state.threshold === undefined || state.threshold === null || isNaN(state.threshold)) {
      errs.threshold = "Threshold must be a valid number";
    } else {
      if (state.metric === "cpu" || state.metric === "memory") {
        if (state.threshold < 0 || state.threshold > 100) {
          errs.threshold = "Threshold must be a percentage between 0 and 100";
        }
      } else if (state.metric === "pod_crash") {
        if (state.threshold < 0) {
          errs.threshold = "Threshold restarts cannot be negative";
        }
      }
    }
    return errs;
  };

  const handleChange = (fields: Partial<typeof formState>) => {
    setTouched(true);
    setFormState((prev) => ({ ...prev, ...fields }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const validationErrors = validateForm(formState);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    if (selectedAlertRule) {
      updateAlertRule(selectedAlertRule.id, formState);
    } else {
      addAlertRule(formState);
    }
    handleClose();
  };

  // Compute validation errors dynamically at render time
  const validationErrors = validateForm(formState);
  const errors = touched ? validationErrors : {};
  const isValid = Object.keys(validationErrors).length === 0;

  // Generate dynamic live preview sentence
  const getLivePreview = () => {
    const metricLabel =
      formState.metric === "cpu"
        ? "CPU usage"
        : formState.metric === "memory"
        ? "Memory usage"
        : "Pod restarts/crashes";

    const operatorLabel =
      formState.operator === "greater_than"
        ? "is greater than"
        : formState.operator === "less_than"
        ? "is less than"
        : formState.operator === "greater_than_or_equal"
        ? "is greater than or equal to"
        : "is less than or equal to";

    const unit = formState.metric === "pod_crash" ? (formState.threshold === 1 ? " restart" : " restarts") : "%";
    const thresholdLabel = isNaN(formState.threshold) ? "?" : `${formState.threshold}${unit}`;
    const durationLabel = formState.duration === "Immediately" ? "immediately" : `for ${formState.duration}`;
    const scopeLabel = formState.namespace === "all" ? "in all namespaces" : `in namespace "${formState.namespace}"`;
    const severityLabel = formState.severity.toUpperCase();

    return `${severityLabel} alert when ${metricLabel} ${operatorLabel} ${thresholdLabel} ${durationLabel} ${scopeLabel}.`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl rounded-2xl border border-neutral-800 bg-[#121214] p-5 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Glow decoration */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-60" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg border",
                selectedAlertRule
                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                  : "bg-blue-500/10 text-blue-500 border-blue-500/20"
              )}
            >
              <ShieldAlert className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-100">
                {selectedAlertRule ? "Edit Alert Rule" : "Create Alert Rule"}
              </h3>
              <p className="text-[10px] text-neutral-500">
                Configure threshold evaluation metrics for Kubernetes targets
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Form Area */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          <AlertRuleBuilder
            rule={formState}
            onChange={handleChange}
            errors={errors}
          />

          {/* Live Preview Capsule */}
          <div className="rounded-xl border border-neutral-800/80 bg-neutral-950/70 p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
              <Sparkles className="h-3 w-3 text-blue-400" />
              <span>Dynamic Live Preview</span>
            </div>
            <div className="flex gap-2.5 items-start">
              <div
                className={cn(
                  "mt-0.5 shrink-0 px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide font-mono uppercase border",
                  formState.severity === "critical"
                    ? "bg-red-500/10 text-red-400 border-red-500/25"
                    : formState.severity === "warning"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/25"
                )}
              >
                {formState.severity}
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed font-sans font-medium">
                {getLivePreview()}
              </p>
            </div>
          </div>
        </form>

        {/* Modal Footer (Action Buttons) */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-all active:scale-95",
              isValid
                ? "bg-blue-500 hover:bg-blue-600 shadow-md shadow-blue-500/20"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed opacity-60"
            )}
          >
            <span>{selectedAlertRule ? "Save Changes" : "Create Alert Rule"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
