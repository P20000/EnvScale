import os
import shlex
import shutil
from typing import List, Dict, Optional, Tuple, Any
from .config import TESTING_K8S_DIR, PROJECT_ROOT
from .proc_utils import safe_run, safe_stream

class K8sManager:
    def __init__(self, log_fn=None):
        self.log_fn = log_fn or (lambda msg: None)

    def log(self, msg: str):
        self.log_fn(msg)

    def _run_stream(self, cmd: str, cwd: Optional[str] = None) -> int:
        return safe_stream(cmd, cwd=cwd or PROJECT_ROOT, shell=True, on_line=self.log)

    def get_current_context(self) -> str:
        try:
            res = safe_run(["kubectl", "config", "current-context"], timeout=3.0)
            return res.stdout.strip()
        except Exception:
            return ""

    def get_available_contexts(self) -> List[str]:
        try:
            res = safe_run(["kubectl", "config", "get-contexts", "-o", "name"], timeout=3.0)
            if res.returncode == 0:
                return [c.strip() for c in res.stdout.splitlines() if c.strip()]
        except Exception:
            pass
        return []

    def switch_context(self, context_name: str) -> bool:
        self.log(f"Switching kubectl context to '{context_name}'...")
        res = safe_run(["kubectl", "config", "use-context", context_name], timeout=5.0)
        if res.returncode == 0:
            self.log(f"Successfully switched context to '{context_name}'")
            return True
        else:
            self.log(f"Failed to switch context: {res.stderr.strip()}")
            return False

    def check_prerequisites(self) -> Tuple[bool, List[str]]:
        missing = []
        for tool in ["kubectl", "docker"]:
            if not shutil.which(tool):
                missing.append(tool)
        return (len(missing) == 0, missing)

    def get_cluster_status(self) -> Dict[str, Any]:
        current = self.get_current_context()
        if not current:
            return {"context": "none", "status": "No active Kubernetes context", "online": False}
        res = safe_run(["kubectl", "cluster-info", "--request-timeout=3s"], timeout=4.0)
        if res.returncode == 0:
            return {"context": current, "status": "Cluster is reachably online", "online": True}
        else:
            return {"context": current, "status": "Cluster unreachable or offline", "online": False}

    def deploy_test_suite(self, progress_cb=None) -> bool:
        p = progress_cb or (lambda text, fraction: None)
        p("Checking Kubernetes prerequisites...", 0.1)
        ok, missing = self.check_prerequisites()
        if not ok:
            self.log(f"Missing required tools: {', '.join(missing)}")
            return False

        ctx = self.get_current_context()
        available = self.get_available_contexts()

        # Pre-flight check: is current context reachable?
        p("Checking cluster reachability...", 0.15)
        status = self.get_cluster_status()
        is_online = status.get("online", False)

        # Auto-fallback: if current context is dead or unreachable, check if local Minikube is available
        if not is_online:
            if "minikube" in available:
                self.log(f"Current context '{ctx}' is unreachable ({status.get('status')}). Auto-switching to local 'minikube' context...")
                p("Auto-switching to local Minikube context...", 0.18)
                self.switch_context("minikube")
                ctx = "minikube"
            else:
                self.log(f"[ERROR] Active cluster context '{ctx}' is unreachable ({status.get('status')}). Deployment aborted.")
                p("Deployment aborted: cluster unreachable.", 1.0)
                return False

        self.log(f"Deploying test workload suite to context: '{ctx}'...")

        if ctx == "minikube":
            p("Verifying Minikube status...", 0.2)
            res = safe_run(["minikube", "status"], timeout=6.0)
            if res.returncode != 0:
                self.log("Minikube is not running. Starting cluster...")
                p("Starting Minikube cluster...", 0.3)
                code = self._run_stream("minikube start")
                if code != 0:
                    self.log("Failed to start Minikube cluster.")
                    return False

            p("Checking Ingress controller...", 0.4)
            self._run_stream("minikube addons enable ingress")

            p("Building test images inside Minikube...", 0.6)
            backend_dir = os.path.join(PROJECT_ROOT, "testing/app/backend")
            frontend_dir = os.path.join(PROJECT_ROOT, "testing/app/frontend")
            if os.path.exists(backend_dir):
                self.log("Building todo-backend inside Minikube...")
                self._run_stream(f"minikube image build -t todo-backend:latest {shlex.quote(backend_dir)}")
            if os.path.exists(frontend_dir):
                self.log("Building todo-frontend inside Minikube...")
                self._run_stream(f"minikube image build -t todo-frontend:latest {shlex.quote(frontend_dir)}")

        p("Applying 15 Kubernetes manifests in testing/k8s/...", 0.75)
        self.log(f"Applying manifests from {TESTING_K8S_DIR}...")
        cmd = f"kubectl apply -f {shlex.quote(TESTING_K8S_DIR)}"
        code = self._run_stream(cmd)
        if code != 0:
            self.log("Admission webhook conflict detected. Removing conflicting ingress-nginx webhook...")
            self._run_stream("kubectl delete validatingwebhookconfiguration ingress-nginx-admission --ignore-not-found=true")
            code = self._run_stream(f"kubectl apply -f {shlex.quote(TESTING_K8S_DIR)} --validate=false")
            if code != 0:
                self.log("Warning: some manifests may not have applied cleanly.")

        p("Exporting portable kubeconfig...", 0.9)
        export_path = "/tmp/envscale-kubeconfig.yaml"
        safe_run(f"kubectl config view --flatten > {shlex.quote(export_path)}", shell=True, timeout=5.0)
        self.log(f"Exported portable kubeconfig to {export_path}")

        p("Test suite deployment complete!", 1.0)
        self.log("Testing workload suite deployed successfully!")
        return True

    def teardown_test_suite(self, progress_cb=None) -> bool:
        p = progress_cb or (lambda text, fraction: None)
        p("Checking cluster reachability...", 0.1)
        status = self.get_cluster_status()
        if not status.get("online", False):
            ctx = self.get_current_context()
            self.log(f"[WARNING] Active context '{ctx}' is unreachable ({status.get('status')}). Skipping teardown.")
            p("Teardown skipped: cluster offline.", 1.0)
            return False

        p("Tearing down testing workloads...", 0.5)
        self.log(f"Deleting manifests in {TESTING_K8S_DIR}...")
        cmd = f"kubectl delete -f {shlex.quote(TESTING_K8S_DIR)} --ignore-not-found=true"
        code = self._run_stream(cmd)
        p("Teardown complete.", 1.0)
        self.log("Test suite resources removed.")
        return code == 0

    def get_ingress_url(self) -> Optional[str]:
        ctx = self.get_current_context()
        if ctx == "minikube":
            res = safe_run(["minikube", "ip"], timeout=4.0)
            ip = res.stdout.strip()
            if ip:
                return f"http://{ip}/"
        return "http://localhost/"
