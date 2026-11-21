# EnvScale Web Frontend (`apps/web`)

Interactive Kubernetes topology visualizer, log explorer, metrics dashboard, incident/alert rule console, and cluster onboarding UI for **EnvScale**.

## Stack

- **Framework & Build:** React 19, TypeScript, Vite 8
- **Topology & Layout:** `@xyflow/react` (`13` custom node components across `15` `nodeTypes` keys + custom `K8sEdge` / `ArgoEdge`), `@dagrejs/dagre`
- **State & Auth:** Zustand 5 (`useTopologyStore`, `useAuthStore`, `useUIStore`, `useMetricsStore`, `useAlertStore`) + Better Auth client
- **Styling & Icons:** Tailwind CSS (Material Design 3 dark palette), `@mdi/react` / `@mdi/js`, `lucide-react`, `@base-ui/react`

## Local Development

```bash
# From monorepo root (or inside apps/web)
cp apps/web/.env.example apps/web/.env
pnpm --filter web dev       # Starts Vite dev server on http://localhost:5173
```

### Scripts ([`package.json`](package.json))
- `pnpm --filter web dev`: Start Vite HMR server (`:5173`)
- `pnpm --filter web build`: Type-check (`tsc -b`) and build production bundle (`dist/`)
- `pnpm --filter web lint`: Run ESLint (`eslint .`)
- `pnpm --filter web preview`: Preview built production assets

### Environment Variables ([`.env.example`](.env.example))
- `VITE_API_BASE_URL`: REST API base URL (Dev: `http://localhost:3000`; Prod relative proxy: `""`)
- `VITE_STREAMER_BASE_URL`: Streaming gateway base URL (Dev: `http://localhost:8080`; Prod relative proxy: `""`)
- `VITE_WS_URL`: WebSocket topology stream URL (Dev: `ws://localhost:8080/ws/k8s`; Prod: `/ws/k8s`)

## Structure & Docs

- `src/components/`: `canvas/`, `flow/`, `drawer/`, `views/`, `onboarding/`, `landing/`, `layout/`, `alerts/`, `incidents/`, `settings/`, `ui/`
- `src/store/`: 5 Zustand stores, `slices/` (6 topology slices), `helpers/` (16 domain reducers)
- `src/hooks/`: `useK8sStream`, `useResourceLogs`, `usePodLogs`, `useClusterLayoutPersistence`, `useKeyboardShortcuts`
- [Frontend Views & Interactions](../../docs/frontend-views-and-interactions.md)
- [Frontend State & Store Architecture](../../docs/frontend-state-and-store-architecture.md)
- [UI & UX Design System](../../docs/design.md)
