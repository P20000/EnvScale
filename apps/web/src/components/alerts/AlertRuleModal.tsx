import { useState, useEffect, useCallback } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiClose,
  mdiAlertOctagon,
  mdiEyeOutline,
} from "@mdi/js";
import { useAlertStore } from "../../store/useAlertStore";
import { AlertRuleBuilder } from "./AlertRuleBuilder";
import { cn } from "../../lib/utils";

import type { AlertMetric, AlertOperator, AlertSeverity } from "../../types/alerts";

interface AlertRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type FormState = {
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  duration: string;
  namespace: string;
  severity: AlertSeverity;
  enabled: boolean;
};

const defaultFormState: FormState = {
  name: "",
  metric: "cpu",
  operator: "greater_than",
  threshold: 80,
  duration: "5 minutes",
  namespace: "all",
  severity: "critical",
  enabled: true,
};

export function AlertRuleModal({ isOpen, onClose }: AlertRuleModalProps) {
  const selectedAlertRule = useAlertStore((s) => s.selectedAlertRule);
  const setSelectedAlertRule = useAlertStore((s) => s.setSelectedAlertRule);
  const addAlertRule = useAlertStore((s) => s.addAlertRule);
  const updateAlertRule = useAlertStore((s) => s.updateAlertRule);

  const [prevRule, setPrevRule] = useState(selectedAlertRule);
  const [formState, setFormState] = useState<FormState>(() => {
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

  if (selectedAlertRule !== prevRule) {
    setPrevRule(selectedAlertRule);
    setFormState(
      selectedAlertRule
        ? {
            name: selectedAlertRule.name,
            metric: selectedAlertRule.metric,
            operator: selectedAlertRule.operator,
            threshold: selectedAlertRule.threshold,
            duration: selectedAlertRule.duration,
            namespace: selectedAlertRule.namespace,
            severity: selectedAlertRule.severity,
            enabled: selectedAlertRule.enabled,
          }
        : defaultFormState
    );
    setTouched(false);
  }

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

  const handleChange = (fields: Partial<FormState>) => {
    setFormState((prev) => ({ ...prev, ...fields }));
    setTouched(true);
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!formState.name.trim()) {
      errors.name = "Alert rule name is required";
    }
    if (formState.threshold < 0) {
      errors.threshold = "Threshold must be non-negative";
    }
    return errors;
  };

  const errors = touched ? validate() : {};
  const isValid = Object.keys(validate()).length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;

    if (selectedAlertRule) {
      updateAlertRule(selectedAlertRule.id, formState);
    } else {
      addAlertRule(formState);
    }

    handleClose();
  };

  const getLivePreview = () => {
    const op =
      formState.operator === "greater_than"
        ? "exceeds"
        : formState.operator === "less_than"
        ? "drops below"
        : formState.operator === "greater_than_or_equal"
        ? "meets or exceeds"
        : "is less than or equal to";

    const metric =
      formState.metric === "cpu"
        ? "CPU Usage"
        : formState.metric === "memory"
        ? "Memory Usage"
        : "Pod Restarts Count";

    const unit = formState.metric === "pod_crash" ? " restarts" : "%";
    const ns = formState.namespace === "all" ? "across all namespaces" : `in namespace "${formState.namespace}"`;

    return `Triggers a "${formState.severity.toUpperCase()}" alert when ${metric} ${op} ${formState.threshold}${unit} for ${formState.duration} ${ns}.`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative w-full max-w-xl rounded-3xl border border-neutral-800 bg-surface p-5 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md border",
                selectedAlertRule
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-blue-500/10 text-blue-400 border-blue-500/20"
              )}
            >
              <Icon path={mdiAlertOctagon} size={0.7} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-100 font-heading">
                {selectedAlertRule ? "Edit Alert Rule" : "Create Alert Rule"}
              </h3>
              <p className="text-[10px] text-neutral-500">
                Configure threshold evaluation metrics for Kubernetes targets
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            <Icon path={mdiClose} size={0.7} />
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
          <div className="rounded-2xl border border-neutral-800 bg-background p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider font-heading">
              <Icon path={mdiEyeOutline} size={0.55} className="text-blue-400" />
              <span>Dynamic Live Preview</span>
            </div>
            <div className="flex gap-2.5 items-start">
              <div
                className={cn(
                  "mt-0.5 shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide font-mono uppercase border",
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

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md px-3.5 py-1.5 text-xs font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold text-white transition-colors",
              isValid
                ? "bg-blue-500 hover:bg-blue-600"
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
