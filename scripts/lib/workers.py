import os
import sys
import time
import shutil
import subprocess
import webbrowser
import threading

def worker_deploy_k8s(app, project_root):
    app.is_busy = True
    app.append_log("\n[MINIKUBE] Deploying isolated multi-tab Todo App to Minikube...")
    app.set_status("Checking Minikube & Kubernetes CLI tools...", 0.1)

    for tool in ["minikube", "kubectl", "docker"]:
        if not shutil.which(tool):
            app.append_log(f"[ERROR] '{tool}' CLI tool not found in PATH! Please install {tool}.")
            app.set_status(f"Deploy Failed: Missing {tool}", 0.0)
            app.is_busy = False
            return

    app.set_status("Checking Minikube cluster status...", 0.2)
    res = subprocess.run("minikube status", shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        app.append_log("[MINIKUBE] Minikube is not running. Starting Minikube cluster...")
        code = app._exec_cmd("minikube start --force")
        if code != 0:
            app.append_log("[WARNING] Standard start failed. Cleaning dangling docker system cache and retrying...")
            subprocess.run("docker system prune -f", shell=True)
            code = app._exec_cmd("minikube delete && minikube start --force")
            if code != 0:
                app.append_log("[ERROR] Failed to start Minikube cluster even with --force.")
                app.set_status("Deploy Failed: Minikube start failed", 0.0)
                app.is_busy = False
                return

    app.set_status("Enabling Minikube NGINX Ingress controller addon...", 0.35)
    app.append_log("[MINIKUBE] Running 'minikube addons enable ingress'...")
    app._exec_cmd("minikube addons enable ingress")

    app.set_status("Waiting for Ingress Controller admission webhook to be ready...", 0.45)
    app.append_log("[MINIKUBE] Waiting for ingress-nginx controller rollout...")
    app._exec_cmd("kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx --timeout=90s")

    app.set_status("Building container images inside Minikube...", 0.6)
    app.append_log("[MINIKUBE] Building todo-backend:latest...")
    app._exec_cmd("minikube image build -t todo-backend:latest ./testing/app/backend", cwd=project_root)

    app.append_log("[MINIKUBE] Building todo-frontend:latest...")
    app._exec_cmd("minikube image build -t todo-frontend:latest ./testing/app/frontend", cwd=project_root)

    app.set_status("Applying Kubernetes manifests to 'testing-todo' namespace...", 0.8)
    app.append_log("[K8S] Running 'kubectl apply -f testing/k8s/'...")
    code = app._exec_cmd("kubectl apply -f testing/k8s/", cwd=project_root)
    if code != 0:
        app.append_log("[WARNING] Manifest apply failed. Cleaning up non-responsive admission webhook and retrying...")
        app._exec_cmd("kubectl delete validatingwebhookconfiguration ingress-nginx-admission --ignore-not-found=true")
        time.sleep(2)
        app.append_log("[K8S] Retrying 'kubectl apply -f testing/k8s/'...")
        code = app._exec_cmd("kubectl apply -f testing/k8s/", cwd=project_root)

    if code != 0:
        app.append_log("[ERROR] Failed to apply Kubernetes manifests!")
        app.set_status("Deploy Failed: Manifest apply error", 0.8)
        app.is_busy = False
        return

    app.append_log("[K8S] Generating flattened portable Kubeconfig for EnvScale integration...")
    flat_path = "/tmp/minikube-flat.yaml"
    subprocess.run(f"kubectl config view --flatten > {flat_path}", shell=True)

    ip_res = subprocess.run("minikube ip", shell=True, capture_output=True, text=True)
    mk_ip = ip_res.stdout.strip() or "127.0.0.1"

    app.set_status("Minikube Todo Application deployed successfully!", 1.0)
    app.append_log("\n[SUCCESS] MINIKUBE TODO TEST APP IS DEPLOYED! ☸️🎉")
    app.append_log(f"   - Minikube IP:        {mk_ip}")
    app.append_log(f"   - Todo Ingress URL:   http://{mk_ip}/")
    app.append_log(f"   - Backend API URL:    http://{mk_ip}/api/todos")
    app.append_log(f"   - Exported Kubeconfig: {flat_path}")
    app.append_log("   👉 Upload '/tmp/minikube-flat.yaml' in EnvScale UI to visualize live Pods, Nodes & Ingress!\n")
    app.is_busy = False

def worker_teardown_k8s(app, project_root):
    app.is_busy = True
    app.append_log("\n[MINIKUBE] Tearing down isolated Todo application...")
    app.set_status("Deleting Kubernetes namespace and resources...", 0.5)
    app._exec_cmd("kubectl delete -f testing/k8s/", cwd=project_root)
    app.set_status("Minikube Todo app torn down.", 1.0)
    app.append_log("[SUCCESS] Minikube test resources removed cleanly.\n")
    app.is_busy = False

def worker_run_tests(app, project_root):
    app.is_busy = True
    app.append_log("\n[TESTS] Starting sequential application health & build tests...")
    app.set_status("Checking environment prerequisites...", 0.1)

    reqs = ["node", "npx", "go", "docker"]
    for r in reqs:
        if not shutil.which(r):
            app.append_log(f"[ERROR] Required tool '{r}' is missing!")
            app.set_status("Test Failed: Missing prerequisites", 0.0)
            app.is_busy = False
            return

    app.set_status("Step 1/3: Testing Web UI (TypeScript & ESLint)...", 0.3)
    app.append_log("[TEST] Typechecking & linting apps/web...")
    code = app._exec_cmd("npx tsc -b && npx eslint .", cwd=os.path.join(project_root, "apps/web"))
    if code != 0:
        app.append_log("[ERROR] apps/web build or lint failed!")
        app.set_status("Test Failed: apps/web errors", 0.3)
        app.is_busy = False
        return
    app.append_log("[SUCCESS] apps/web passed all checks!")

    app.set_status("Step 2/3: Testing REST API Server (TypeScript)...", 0.6)
    app.append_log("[TEST] Typechecking apps/api-server...")
    code = app._exec_cmd("npx tsc --noEmit", cwd=os.path.join(project_root, "apps/api-server"))
    if code != 0:
        app.append_log("[ERROR] apps/api-server typecheck failed!")
        app.set_status("Test Failed: apps/api-server errors", 0.6)
        app.is_busy = False
        return
    app.append_log("[SUCCESS] apps/api-server passed all checks!")

    app.set_status("Step 3/3: Testing Streaming Gateway (Go Compilation)...", 0.9)
    app.append_log("[TEST] Compiling apps/k8s-streamer Go gateway...")
    code = app._exec_cmd("go build -o /tmp/k8s-streamer-test ./cmd/server/main.go", cwd=os.path.join(project_root, "apps/k8s-streamer"))
    if code == 0 and os.path.exists("/tmp/k8s-streamer-test"):
        os.remove("/tmp/k8s-streamer-test")
    if code != 0:
        app.append_log("[ERROR] apps/k8s-streamer Go build failed!")
        app.set_status("Test Failed: apps/k8s-streamer errors", 0.9)
        app.is_busy = False
        return
    app.append_log("[SUCCESS] apps/k8s-streamer Go build succeeded!")

    app.set_status("All tests completed successfully! Ready to launch.", 1.0)
    app.append_log("\n[SUCCESS] ALL SEQUENTIAL TESTS PASSED PERFECTLY! 🚀\n")
    app.is_busy = False
