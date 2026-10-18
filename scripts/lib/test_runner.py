import os
import time
import subprocess
from typing import List, Dict, Any, Callable
from .config import PROJECT_ROOT, API_SERVER_DIR, K8S_STREAMER_DIR, WEB_DIR

class TestRunner:
    def __init__(self, log_fn=None):
        self.log_fn = log_fn or (lambda msg: None)

    def log(self, msg: str):
        self.log_fn(f"[TEST] {msg}")

    def run_command(self, cmd: str, cwd: str) -> Tuple_Res:
        start = time.time()
        res = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
        dur = round(time.time() - start, 2)
        return (res.returncode == 0, res.stdout, res.stderr, dur)

    def run_all_tests(self, progress_cb=None) -> List[Dict[str, Any]]:
        p = progress_cb or (lambda text, fraction: None)
        results = []

        # Step 1: Web UI Typecheck & Lint
        p("Step 1/3: Checking apps/web (TypeScript & ESLint)...", 0.2)
        self.log("Running TypeScript typecheck and ESLint on apps/web...")
        ok, out, err, dur = self.run_command("npx tsc -b && npx eslint .", WEB_DIR)
        results.append({
            "name": "apps/web (TS & Lint)",
            "passed": ok,
            "duration": dur,
            "error": err if not ok else "",
        })
        if ok:
            self.log(f"apps/web checks passed in {dur}s")
        else:
            self.log(f"apps/web checks failed: {err.strip() or out.strip()}")

        # Step 2: API Server Typecheck
        p("Step 2/3: Checking apps/api-server (TypeScript)...", 0.5)
        self.log("Running TypeScript typecheck on apps/api-server...")
        ok, out, err, dur = self.run_command("npx tsc --noEmit", API_SERVER_DIR)
        results.append({
            "name": "apps/api-server (TypeScript)",
            "passed": ok,
            "duration": dur,
            "error": err if not ok else "",
        })
        if ok:
            self.log(f"apps/api-server checks passed in {dur}s")
        else:
            self.log(f"apps/api-server checks failed: {err.strip() or out.strip()}")

        # Step 3: K8s Streamer Go Tests & Build
        p("Step 3/3: Checking apps/k8s-streamer (Go Compilation & Tests)...", 0.8)
        self.log("Compiling Go binary and running chaos unit tests...")
        ok, out, err, dur = self.run_command("go test -v ./pkg/chaos/... && go build -o /dev/null ./cmd/server/main.go", K8S_STREAMER_DIR)
        results.append({
            "name": "apps/k8s-streamer (Go)",
            "passed": ok,
            "duration": dur,
            "error": err if not ok else "",
        })
        if ok:
            self.log(f"apps/k8s-streamer tests passed in {dur}s")
        else:
            self.log(f"apps/k8s-streamer checks failed: {err.strip() or out.strip()}")

        p("All tests completed!", 1.0)
        return results

Tuple_Res = Any
