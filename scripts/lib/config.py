import os

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../.."))

API_SERVER_DIR = os.path.join(PROJECT_ROOT, "apps/api-server")
K8S_STREAMER_DIR = os.path.join(PROJECT_ROOT, "apps/k8s-streamer")
WEB_DIR = os.path.join(PROJECT_ROOT, "apps/web")
TESTING_K8S_DIR = os.path.join(PROJECT_ROOT, "testing/k8s")
DOCKER_COMPOSE_FILE = os.path.join(PROJECT_ROOT, "docker-compose.dev.yml")

SHARED_JWT_SECRET = "342d2b89c945a82109fe28d7cfe42e9b53ff70d0ceff44316afe2250604d5a92"
SHARED_ENCRYPTION_KEY = "dGhpcy1pcy1hLTMyLWJ5dGUtYmFzZTY0LWtleS0xMjM="

SERVICES = {
    "postgres": {
        "id": "postgres",
        "name": "PostgreSQL DB",
        "category": "database",
        "port": 5432,
        "health_type": "tcp",
        "docker_service": "postgres",
        "cwd": PROJECT_ROOT,
    },
    "redis": {
        "id": "redis",
        "name": "Redis Cache",
        "category": "database",
        "port": 6379,
        "health_type": "redis",
        "docker_service": "redis",
        "cwd": PROJECT_ROOT,
    },
    "api": {
        "id": "api",
        "name": "REST API Server",
        "category": "microservice",
        "port": 3000,
        "health_type": "http",
        "health_url": "http://127.0.0.1:3000/health",
        "cmd": ["npx", "tsx", "watch", "src/index.ts"],
        "cwd": API_SERVER_DIR,
    },
    "streamer": {
        "id": "streamer",
        "name": "K8s Streamer",
        "category": "microservice",
        "port": 8080,
        "health_type": "http_json",
        "health_url": "http://127.0.0.1:8080/healthz",
        "cmd": ["go", "run", "./cmd/server/main.go"],
        "cwd": K8S_STREAMER_DIR,
    },
    "web": {
        "id": "web",
        "name": "Web Frontend",
        "category": "frontend",
        "port": 5173,
        "health_type": "tcp",
        "cmd": ["npx", "vite"],
        "cwd": WEB_DIR,
    },
}

SERVICE_ORDER = ["postgres", "redis", "api", "streamer", "web"]
