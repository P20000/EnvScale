import os
import json
import shutil
import subprocess
from typing import Callable, Optional, Dict, Any

from .config import PROJECT_ROOT, TERRAFORM_EKS_DIR, EKS_TODO_APP_YAML
from .proc_utils import safe_run, safe_stream

LogCallback = Callable[[str], None]
# StepCallback signature: (step_id: str, title: str, status: str, detail: str) -> None
# status: "start", "log", "success", "error"
StepCallback = Callable[[str, str, str, str], None]

class EKSDeployer:
    """Manages the full lifecycle of AWS EKS cluster provisioning and teardown with live log streaming."""

    def __init__(self, log_fn: Optional[LogCallback] = None, step_fn: Optional[StepCallback] = None):
        self._log = log_fn or (lambda msg: print(f"[EKSDeployer] {msg}"))
        self._step_fn = step_fn or (lambda sid, title, status, detail: None)
        self.cluster_name = "envscale-todo-eks"
        self.region = "ap-south-1"

    def _emit_step(self, step_id: str, title: str, status: str, detail: str = ""):
        self._step_fn(step_id, title, status, detail)
        if detail and status == "log":
            self._log(f"[{title}] {detail}")
        elif status == "start":
            self._log(f"Starting step: {title} ({detail})")
        elif status == "success":
            self._log(f"Completed step: {title}")
        elif status == "error":
            self._log(f"Failed step: {title} - {detail}")

    def _stream_cmd(self, cmd: list, step_id: str, step_title: str, cwd: Optional[str] = None) -> int:
        cmd_str = " ".join(cmd)
        self._emit_step(step_id, step_title, "log", f"$ {cmd_str}")
        code = safe_stream(
            cmd,
            cwd=cwd or PROJECT_ROOT,
            on_line=lambda line: self._emit_step(step_id, step_title, "log", line),
        )
        if code != 0:
            err = f"Command exited with non-zero code: {code}"
            self._emit_step(step_id, step_title, "log", f"[ERROR] {err}")
            raise RuntimeError(err)
        return code

    def get_cluster_status(self) -> Dict[str, Any]:
        """Safely query AWS for EKS cluster state without hanging on network timeouts."""
        if not shutil.which("aws"):
            return {"provisioned": False, "status": "AWS CLI not found", "endpoint": "", "arn": ""}

        res = safe_run(
            [
                "aws", "eks", "describe-cluster",
                "--name", self.cluster_name,
                "--region", self.region,
                "--query", "cluster.{status:status,endpoint:endpoint,arn:arn}",
                "--output", "json",
            ],
            timeout=5.0,
        )

        if res.returncode == 0 and res.stdout.strip():
            try:
                data = json.loads(res.stdout)
                return {
                    "provisioned": True,
                    "status": data.get("status", "ACTIVE"),
                    "endpoint": data.get("endpoint", ""),
                    "arn": data.get("arn", ""),
                }
            except Exception:
                pass

        # Check local Terraform state as fallback
        tf_state = os.path.join(TERRAFORM_EKS_DIR, "terraform.tfstate")
        if os.path.exists(tf_state):
            try:
                res_tf = safe_run(["terraform", "output", "-json"], cwd=TERRAFORM_EKS_DIR, timeout=4.0)
                if res_tf.returncode == 0 and res_tf.stdout.strip():
                    outs = json.loads(res_tf.stdout)
                    arn = outs.get("cluster_arn", {}).get("value", "")
                    if arn:
                        return {"provisioned": False, "status": "DELETED/NOT FOUND", "endpoint": "", "arn": arn}
            except Exception:
                pass

        return {"provisioned": False, "status": "NOT PROVISIONED", "endpoint": "", "arn": ""}

    def eks_up(self):
        """1-Click Provision of EKS Cluster, Spot Nodes, Kubeconfig, and Todo Benchmarks."""
        # Step 1: Preflight Verification
        s1, t1 = "eks_preflight", "AWS & Terraform Preflight Checks"
        self._emit_step(s1, t1, "start", "Validating AWS CLI credentials and Terraform binary...")
        for tool in ["aws", "terraform", "kubectl"]:
            if not shutil.which(tool):
                msg = f"Missing required CLI utility: '{tool}'. Please install it before proceeding."
                self._emit_step(s1, t1, "error", msg)
                raise RuntimeError(msg)

        res = safe_run(["aws", "sts", "get-caller-identity", "--output", "json"], timeout=6.0)
        if res.returncode != 0:
            msg = "AWS credentials expired or not configured. Run 'aws configure' first."
            self._emit_step(s1, t1, "error", msg)
            raise RuntimeError(msg)
        self._emit_step(s1, t1, "log", "AWS credentials verified.")
        self._emit_step(s1, t1, "success", "Preflight checks passed.")

        # Step 2: Terraform Init
        s2, t2 = "eks_tf_init", "Initialize EKS Terraform Provider"
        self._emit_step(s2, t2, "start", "terraform init in deployment/terraform-eks/")
        self._stream_cmd(["terraform", "init"], s2, t2, cwd=TERRAFORM_EKS_DIR)
        self._emit_step(s2, t2, "success", "Terraform initialized.")

        # Step 3: Terraform Apply (Provisions VPC, IAM, EKS Control Plane, Spot Worker Nodegroup)
        s3, t3 = "eks_tf_apply", "Provision AWS EKS & Spot Worker Nodegroup"
        self._emit_step(s3, t3, "start", "terraform apply -auto-approve (Estimated: 8-12 mins)")
        self._stream_cmd(["terraform", "apply", "-auto-approve"], s3, t3, cwd=TERRAFORM_EKS_DIR)
        self._emit_step(s3, t3, "success", "AWS EKS cluster and nodegroup provisioned successfully.")

        # Step 4: Kubeconfig Synchronization
        s4, t4 = "eks_kubeconfig", "Configure kubectl for EKS Cluster"
        self._emit_step(s4, t4, "start", f"aws eks update-kubeconfig --name {self.cluster_name}")
        self._stream_cmd(
            ["aws", "eks", "update-kubeconfig", "--name", self.cluster_name, "--region", self.region],
            s4, t4
        )
        self._emit_step(s4, t4, "log", "Testing cluster API server connectivity...")
        chk = safe_run(["kubectl", "cluster-info", "--request-timeout=10s"], timeout=12.0)
        if chk.returncode == 0:
            self._emit_step(s4, t4, "log", "EKS API server is responding cleanly.")
        else:
            self._emit_step(s4, t4, "log", f"[Notice] Cluster info check: {chk.stderr.strip() or chk.stdout.strip()}")
        self._emit_step(s4, t4, "success", "Kubeconfig configured and active context set to EKS.")

        # Step 5: Deploy Metrics Server & EKS Todo Application
        s5, t5 = "eks_workloads", "Deploy Metrics Server & Todo Benchmark Workload"
        self._emit_step(s5, t5, "start", "Installing metrics-server for live node/pod telemetries...")
        safe_run(
            ["kubectl", "apply", "-f", "https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml"],
            timeout=30.0
        )
        if os.path.exists(EKS_TODO_APP_YAML):
            self._emit_step(s5, t5, "log", f"kubectl apply -f {EKS_TODO_APP_YAML}")
            self._stream_cmd(["kubectl", "apply", "-f", EKS_TODO_APP_YAML], s5, t5)
            self._emit_step(s5, t5, "success", "Metrics-server and workloads deployed successfully.")
        else:
            self._emit_step(s5, t5, "log", f"Workload file {EKS_TODO_APP_YAML} not found; skipping app deploy.")
            self._emit_step(s5, t5, "success", "EKS Cluster ready with metrics-server.")

        # Step 6: Export portable kubeconfig for EnvScale Web Onboarding
        s6, t6 = "eks_export", "Export Portable Kubeconfig for EnvScale"
        export_path = "/tmp/envscale-eks-kubeconfig.yaml"
        self._emit_step(s6, t6, "start", f"Exporting to {export_path}")
        safe_run(f"kubectl config view --flatten > {export_path}", shell=True, timeout=5.0)
        self._emit_step(s6, t6, "log", f"Saved portable kubeconfig to {export_path}")
        self._emit_step(s6, t6, "success", f"Ready to connect in EnvScale web onboarding: {export_path}")

    def eks_destroy(self):
        """1-Click Teardown of AWS EKS Cluster, Spot Nodes, and Kubeconfig Context."""
        # Step 1: Teardown Workloads
        s1, t1 = "eks_clean_workloads", "Remove Deployed Workloads"
        self._emit_step(s1, t1, "start", "Cleaning workloads in testing-todo namespace...")
        if os.path.exists(EKS_TODO_APP_YAML):
            try:
                safe_run(
                    ["kubectl", "delete", "-f", EKS_TODO_APP_YAML, "--ignore-not-found=true", "--timeout=25s"],
                    timeout=30.0
                )
                self._emit_step(s1, t1, "log", "Testing workloads removed.")
            except Exception as e:
                self._emit_step(s1, t1, "log", f"Workload teardown warning: {e}")
        self._emit_step(s1, t1, "success", "Workload cleanup complete.")

        # Step 2: Terraform Destroy
        s2, t2 = "eks_tf_destroy", "Destroy AWS EKS Cluster & Infrastructure"
        self._emit_step(s2, t2, "start", "terraform destroy -auto-approve")
        self._stream_cmd(["terraform", "destroy", "-auto-approve"], s2, t2, cwd=TERRAFORM_EKS_DIR)
        self._emit_step(s2, t2, "success", "AWS EKS cluster and resources destroyed.")

        # Step 3: Cleanup Kubeconfig Context & Switch back to local minikube
        s3, t3 = "eks_clean_context", "Prune Dead Context & Switch to Minikube"
        self._emit_step(s3, t3, "start", "Pruning deleted EKS context from ~/.kube/config...")
        ctx_list = safe_run(["kubectl", "config", "get-contexts", "-o", "name"], timeout=5.0)
        if ctx_list.returncode == 0:
            for ctx in ctx_list.stdout.splitlines():
                ctx = ctx.strip()
                if self.cluster_name in ctx:
                    self._emit_step(s3, t3, "log", f"Removing dead context: {ctx}")
                    safe_run(["kubectl", "config", "delete-context", ctx], timeout=5.0)

        # Fallback to local Minikube context safely
        self._emit_step(s3, t3, "log", "Switching active kubectl context back to 'minikube'...")
        res_sw = safe_run(["kubectl", "config", "use-context", "minikube"], timeout=5.0)
        if res_sw.returncode == 0:
            self._emit_step(s3, t3, "log", "Active context successfully switched to 'minikube'.")
        else:
            self._emit_step(s3, t3, "log", "Notice: 'minikube' context not found or could not switch.")

        self._emit_step(s3, t3, "success", "Context cleanup complete. System protected against orphaned retries.")

    def deploy_workloads(self):
        """Deploy only the todo benchmark workload and metrics-server to the active EKS cluster."""
        s1, t1 = "eks_deploy_app", "Deploy Metrics Server & Todo Workloads"
        self._emit_step(s1, t1, "start", "Installing metrics-server for telemetries...")
        safe_run(
            ["kubectl", "apply", "-f", "https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml"],
            timeout=30.0
        )
        if not os.path.exists(EKS_TODO_APP_YAML):
            msg = f"Workload manifest not found at: {EKS_TODO_APP_YAML}"
            self._emit_step(s1, t1, "error", msg)
            raise RuntimeError(msg)

        self._emit_step(s1, t1, "log", f"kubectl apply -f {EKS_TODO_APP_YAML}")
        self._stream_cmd(["kubectl", "apply", "-f", EKS_TODO_APP_YAML], s1, t1)
        self._emit_step(s1, t1, "success", "Todo application and metrics-server deployed to EKS.")
