import os
import shlex
import json
import urllib.request
import urllib.error
import subprocess
from typing import Dict, Any, Tuple
from .config import TESTING_K8S_DIR

CHAOS_SCENARIOS = {
    "crashloop": {
        "name": "Simulate CrashLoopBackOff",
        "description": "Deploys a pod that panics and terminates immediately on boot.",
        "manifest": "13-fault-scenarios.yaml",
        "deployment": "simulated-crashloop-app",
        "namespace": "testing-todo",
    },
    "oom": {
        "name": "Simulate OOMKilled",
        "description": "Deploys a container with tight memory constraints designed to breach limits.",
        "manifest": "13-fault-scenarios.yaml",
        "deployment": "simulated-oom-app",
        "namespace": "testing-todo",
    },
    "pod_kill": {
        "name": "Random Pod Kill",
        "description": "Terminates an active pod in the testing-todo namespace to trigger rescheduling.",
        "namespace": "testing-todo",
    },
}

class ChaosRunner:
    def __init__(self, log_fn=None):
        self.log_fn = log_fn or (lambda msg: None)

    def log(self, msg: str):
        self.log_fn(msg)

    def inject_scenario(self, scenario_id: str) -> Tuple[bool, str]:
        scenario = CHAOS_SCENARIOS.get(scenario_id)
        if not scenario:
            return (False, f"Unknown chaos scenario: {scenario_id}")

        self.log(f"Triggering chaos scenario: '{scenario['name']}'...")

        if scenario_id in ("crashloop", "oom"):
            manifest_path = os.path.join(TESTING_K8S_DIR, scenario["manifest"])
            cmd = f"kubectl apply -f {shlex.quote(manifest_path)}"
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if res.returncode == 0:
                self.log(f"Scenario '{scenario_id}' injected! Observe status in EnvScale UI.")
                return (True, f"Injected {scenario['name']}")
            else:
                self.log(f"Failed to inject scenario: {res.stderr.strip()}")
                return (False, res.stderr.strip())

        elif scenario_id == "pod_kill":
            ns = scenario["namespace"]
            get_cmd = f"kubectl get pods -n {ns} -o jsonpath='{{.items[0].metadata.name}}'"
            res = subprocess.run(get_cmd, shell=True, capture_output=True, text=True)
            pod_name = res.stdout.strip()
            if not pod_name:
                self.log(f"No pods found in namespace '{ns}' to terminate.")
                return (False, f"No pods in {ns}")
            del_cmd = f"kubectl delete pod {pod_name} -n {ns} --now"
            res = subprocess.run(del_cmd, shell=True, capture_output=True, text=True)
            self.log(f"Terminated pod '{pod_name}' in namespace '{ns}'. Rescheduling initiated.")
            return (True, f"Killed pod {pod_name}")

        return (False, "Unhandled scenario type")

    def recover_scenario(self, scenario_id: str) -> Tuple[bool, str]:
        scenario = CHAOS_SCENARIOS.get(scenario_id)
        if not scenario:
            return (False, f"Unknown scenario: {scenario_id}")

        self.log(f"Clearing chaos scenario: '{scenario['name']}'...")
        if "deployment" in scenario:
            dep = scenario["deployment"]
            ns = scenario["namespace"]
            cmd = f"kubectl delete deployment {dep} -n {ns} --ignore-not-found=true"
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            self.log(f"Cleared deployment '{dep}'.")
            return (True, f"Cleared {dep}")

        return (True, "Scenario cleared")
