import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiBellRing,
  mdiSend,
  mdiContentSave,
  mdiCheckCircle,
} from "@mdi/js";
import { useUIStore } from "../../store/useUIStore";
import { useTopologyStore } from "../../store/useTopologyStore";
import { toast } from "../../lib/toast";

export function WebhooksTab() {
  const alertWebhookUrl = useUIStore((s) => s.alertWebhookUrl);
  const setAlertWebhookUrl = useUIStore((s) => s.setAlertWebhookUrl);
  const alertWebhookCriticalOnly = useUIStore((s) => s.alertWebhookCriticalOnly);
  const setAlertWebhookCriticalOnly = useUIStore((s) => s.setAlertWebhookCriticalOnly);
  const activeCluster = useTopologyStore((s) => s.activeCluster);

  const [inputUrl, setInputUrl] = useState(alertWebhookUrl || "");
  const [criticalOnly, setCriticalOnly] = useState(alertWebhookCriticalOnly || false);
  const [isTesting, setIsTesting] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertWebhookUrl(inputUrl.trim());
    setAlertWebhookCriticalOnly(criticalOnly);
    toast.success("Webhook Saved", "Outbound incident alerting destination updated.");
  };

  const handleSendTest = async () => {
    const url = inputUrl.trim();
    if (!url) {
      toast.warning("Missing Endpoint", "Enter a valid Webhook URL before testing.");
      return;
    }

    setIsTesting(true);
    try {
      const payload = {
        text: `🚨 [EnvScale Alert Test] Cluster: ${activeCluster || "production"} | Event: PodCrashLoopBackOff | Severity: CRITICAL`,
        cluster: activeCluster || "production",
        eventType: "INCIDENT_TRIGGERED",
        severity: "CRITICAL",
        reason: "CrashLoopBackOff",
        targetPod: "payment-service-86b4f7b6c-9k2x1",
        namespace: "prod-services",
        message: "Container payment-api exited with status 137 (OOMKilled)",
        timestamp: new Date().toISOString(),
      };

      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "no-cors",
      });

      toast.success("Test Alert Dispatched", `Notification payload transmitted to ${url.slice(0, 32)}...`);
    } catch (err: unknown) {
      console.error("[EnvScale] Webhook test failed:", err);
      toast.error("Webhook Delivery Failed", "Unable to transmit POST request. Check URL accessibility or CORS policies.");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Configuration Card */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon path={mdiBellRing} size={0.83} className="text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-200 font-heading">Outbound Incident Webhook</h3>
              <p className="text-[11px] text-neutral-400">
                Forward Kubernetes pod crashes and threshold alerts to Slack, Discord, or custom incident response systems
              </p>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border font-mono ${
            alertWebhookUrl
              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
              : "bg-neutral-800 text-neutral-400 border-neutral-700/50"
          }`}>
            {alertWebhookUrl ? "ENABLED" : "NOT CONFIGURED"}
          </span>
        </div>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300">
              Webhook URL (Slack Incoming Webhook, Discord Webhook, or HTTP Endpoint)
            </label>
            <input
              type="url"
              placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="w-full rounded-md bg-background border border-neutral-800 px-3.5 py-2.5 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={criticalOnly}
                onChange={(e) => setCriticalOnly(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-800 bg-background text-blue-500 focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-xs text-neutral-300">Only dispatch CRITICAL severity incidents</span>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-md bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <Icon path={mdiContentSave} size={0.65} />
              <span>Save Webhook</span>
            </button>

            <button
              type="button"
              onClick={handleSendTest}
              disabled={isTesting || !inputUrl.trim()}
              className="flex items-center gap-1.5 rounded-md bg-neutral-800 border border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
            >
              <Icon path={mdiSend} size={0.65} />
              <span>{isTesting ? "Sending..." : "Send Test Alert"}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Payload Reference Card */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-3">
        <h4 className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
          <Icon path={mdiCheckCircle} size={0.65} className="text-blue-400" />
          HTTP Webhook Payload Schema
        </h4>
        <p className="text-[11px] text-neutral-400">
          EnvScale sends a standard JSON POST body formatted for immediate compatibility with Slack, Discord, and automation runners.
        </p>
        <pre className="p-3.5 rounded-lg bg-background border border-neutral-800 font-mono text-[11px] text-neutral-300 overflow-x-auto leading-relaxed">
{`{
  "text": "🚨 [EnvScale Alert] Pod auth-service-9k2x in prod crashed (CrashLoopBackOff)",
  "cluster": "minikube-prod",
  "eventType": "INCIDENT_TRIGGERED",
  "severity": "CRITICAL",
  "reason": "CrashLoopBackOff",
  "targetPod": "auth-service-9k2x",
  "namespace": "production",
  "timestamp": "2026-10-18T17:40:00Z"
}`}
        </pre>
      </div>
    </div>
  );
}
