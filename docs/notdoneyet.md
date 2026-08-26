**1. Compute & Workload Subtypes**

* **DaemonSets:** No representation of system workloads that run a replica on every physical node (e.g., Fluentd, Node Exporter, Cilium agents).
* **Jobs & CronJobs:** No visual cards for run-to-completion batch tasks, scheduled execution timelines, or completion/failure states.
* **ReplicaSets (Direct):** Workload cards represent the top-level Deployment, but the underlying ReplicaSet revision history and rollout rollbacks are invisible.
* **Static Pods & Mirror Pods:** Kubelet-managed control plane pods (e.g., `kube-apiserver`, `etcd`, `kube-scheduler`) are not shown.

**2. Storage & Persistent Volumes**

* **PersistentVolumeClaims (PVCs):** No nodes or links indicating which pods request storage.
* **PersistentVolumes (PVs):** No representation of actual bound physical storage volumes.
* **StorageClasses:** No indicators for dynamic provisioning backends (e.g., AWS EBS `gp3`, Ceph, local-path).
* **Volume Snapshots:** No representation of `VolumeSnapshot` or `VolumeSnapshotContent` resources.

**3. Configuration & Secrets**

* **ConfigMaps:** No visual nodes or injection lines showing which workloads consume specific configuration data.
* **Secrets:** No representation of mounted TLS certs, basic auth tokens, or sealed secrets.
* **Mutating & Validating Webhooks:** Invisible interceptors that modify or reject API requests before admission.

**4. Networking & Traffic Policies**

* **NetworkPolicies:** No visual firewall/isolation boundaries indicating blocked or permitted ingress/egress rules between microservices.
* **Gateway API:** Missing next-gen networking abstractions (`Gateway`, `HTTPRoute`, `GRPCRoute`, `ReferenceGrant`).
* **Endpoints & EndpointSlices:** Only the parent Service is shown; individual `EndpointSlice` routing distributions are omitted.
* **ExternalName Services:** No visualization of DNS alias pointers routing outside the cluster.

**5. Scaling, Resource Governance & Scheduling**

* **Horizontal Pod Autoscalers (HPA):** No scaling boundary tags showing target metric thresholds (e.g., target CPU 80%) or min/max replica boundaries.
* **Vertical Pod Autoscalers (VPA):** No automated CPU/memory recommendation or in-place resizing representation.
* **PodDisruptionBudgets (PDB):** No visual markers showing allowed simultaneous evictions during node drains or chaos experiments.
* **ResourceQuotas & LimitRanges:** No visual cluster-boundary caps showing max namespace memory, CPU, or pod capacity.
* **PriorityClasses:** No indicator of pod scheduling preemption priority (e.g., system-critical vs. best-effort).

**6. Physical & Virtual Infrastructure Topology**

* **Kubernetes Node Boundary Boxes:** Pods show their host node as a string in the drawer, but the canvas lacks visual Node grouping bounding boxes, multi-zone boundaries (e.g., `us-east-1a`, `us-east-1b`), or rack layouts.
* **Taints & Tolerations:** No visual markers showing which nodes reject unscheduled workloads.
* **Node Affinity / Anti-Affinity & Topology Spread:** No visual links representing pod co-location or anti-affinity distribution rules across zones.

**7. Identity, Access & Security (RBAC)**

* **ServiceAccounts:** No representation of pod execution identity.
* **Roles & ClusterRoles:** No visual mapping of API authorization permissions.
* **RoleBindings & ClusterRoleBindings:** No link lines mapping identities to granted privileges.

**8. Custom Resource Definitions (CRDs) & Ecosystem Operators**

* **Argo Rollouts:** Canary steps, blue/green analysis runs, and pause steps.
* **Cert-Manager:** `Issuer` and `Certificate` lifecycle/expiration statuses.
* **Service Mesh Resources:** Istio/Linkerd `VirtualService`, `DestinationRule`, `EnvoyFilter`, and mTLS encryption indicators.