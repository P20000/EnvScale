**1. Storage & Persistent Volumes**

* **Volume Snapshots:** No representation of `VolumeSnapshot` or `VolumeSnapshotContent` resources.

**2. Configuration & Secrets**

* **Mutating & Validating Webhooks:** Invisible interceptors that modify or reject API requests before admission.

**3. Networking & Traffic Policies**

* **NetworkPolicies:** No visual firewall/isolation boundaries indicating blocked or permitted ingress/egress rules between microservices.
* **Gateway API:** Missing next-gen networking abstractions (`Gateway`, `HTTPRoute`, `GRPCRoute`, `ReferenceGrant`).
* **Endpoints & EndpointSlices:** Only the parent Service is shown; individual `EndpointSlice` routing distributions are omitted.
* **ExternalName Services:** No visualization of DNS alias pointers routing outside the cluster.

**4. Scaling, Resource Governance & Scheduling**

* **Horizontal Pod Autoscalers (HPA):** No scaling boundary tags showing target metric thresholds (e.g., target CPU 80%) or min/max replica boundaries.
* **Vertical Pod Autoscalers (VPA):** No automated CPU/memory recommendation or in-place resizing representation.
* **PodDisruptionBudgets (PDB):** No visual markers showing allowed simultaneous evictions during node drains or chaos experiments.
* **ResourceQuotas & LimitRanges:** No visual cluster-boundary caps showing max namespace memory, CPU, or pod capacity.
* **PriorityClasses:** No indicator of pod scheduling preemption priority (e.g., system-critical vs. best-effort).

**5. Physical & Virtual Infrastructure Topology**

* **Kubernetes Node Boundary Boxes:** Pods show their host node as a string in the drawer, but the canvas lacks visual Node grouping bounding boxes, multi-zone boundaries (e.g., `us-east-1a`, `us-east-1b`), or rack layouts.
* **Taints & Tolerations:** No visual markers showing which nodes reject unscheduled workloads.
* **Node Affinity / Anti-Affinity & Topology Spread:** No visual links representing pod co-location or anti-affinity distribution rules across zones.

**6. Identity, Access & Security (RBAC)**

* **ServiceAccounts:** No representation of pod execution identity.
* **Roles & ClusterRoles:** No visual mapping of API authorization permissions.
* **RoleBindings & ClusterRoleBindings:** No link lines mapping identities to granted privileges.

**7. Custom Resource Definitions (CRDs) & Ecosystem Operators**

* **Argo Rollouts:** Canary steps, blue/green analysis runs, and pause steps.
* **Cert-Manager:** `Issuer` and `Certificate` lifecycle/expiration statuses.
* **Service Mesh Resources:** Istio/Linkerd `VirtualService`, `DestinationRule`, `EnvoyFilter`, and mTLS encryption indicators.