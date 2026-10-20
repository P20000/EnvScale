import { createAgentToken } from "./auth.service.js";

export interface AgentManifestOptions {
  clusterId: string;
  clusterName?: string;
  serverUrl?: string;
  token?: string;
  image?: string;
}

export const generateAgentManifest = (options: AgentManifestOptions): string => {
  const {
    clusterId,
    clusterName = "cluster",
    serverUrl = process.env.STREAMER_WS_URL || "wss://envscale.duckdns.org/ws/agent",
    token = createAgentToken(options.clusterId),
    image = process.env.AGENT_IMAGE || "ghcr.io/p20000/envscale-k8s-streamer:latest",
  } = options;

  return `# ==============================================================================
# EnvScale In-Cluster Observability Agent Manifest
# Target Cluster: ${clusterName} (${clusterId})
# Generated for automated outbound streaming to: ${serverUrl}
# ==============================================================================
apiVersion: v1
kind: Namespace
metadata:
  name: envscale-agent
  labels:
    app.kubernetes.io/name: envscale-agent
    app.kubernetes.io/part-of: envscale
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: envscale-agent
  namespace: envscale-agent
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: envscale-agent-role
rules:
  - apiGroups: [""]
    resources:
      - pods
      - pods/log
      - nodes
      - services
      - endpoints
      - persistentvolumeclaims
      - persistentvolumes
      - configmaps
      - secrets
      - events
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources:
      - deployments
      - replicasets
      - statefulsets
      - daemonsets
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources:
      - jobs
      - cronjobs
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources:
      - ingresses
      - networkpolicies
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling"]
    resources:
      - horizontalpodautoscalers
    verbs: ["get", "list", "watch"]
  - apiGroups: ["policy"]
    resources:
      - poddisruptionbudgets
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources:
      - pods
      - nodes
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: envscale-agent-binding
subjects:
  - kind: ServiceAccount
    name: envscale-agent
    namespace: envscale-agent
roleRef:
  kind: ClusterRole
  name: envscale-agent-role
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: envscale-agent
  namespace: envscale-agent
  labels:
    app.kubernetes.io/name: envscale-agent
    app.kubernetes.io/part-of: envscale
spec:
  replicas: 1
  selector:
    matchLabels:
      app: envscale-agent
  template:
    metadata:
      labels:
        app: envscale-agent
    spec:
      serviceAccountName: envscale-agent
      containers:
        - name: agent
          image: ${image}
          imagePullPolicy: IfNotPresent
          env:
            - name: MODE
              value: "agent"
            - name: CLUSTER_ID
              value: "${clusterId}"
            - name: SERVER_URL
              value: "${serverUrl}"
            - name: CLUSTER_TOKEN
              value: "${token}"
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "300m"
              memory: "256Mi"
`;
};
