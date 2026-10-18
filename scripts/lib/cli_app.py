import sys
import time
import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.prompt import Confirm
from .config import SERVICES, SERVICE_ORDER
from .health_checker import check_all_services
from .process_manager import ProcessManager
from .env_sync import ensure_env_files, verify_env_parity
from .k8s_manager import K8sManager
from .chaos_runner import ChaosRunner, CHAOS_SCENARIOS
from .test_runner import TestRunner

console = Console()
pm = ProcessManager()

@click.group(invoke_without_command=True)
@click.pass_context
def cli(ctx):
    """EnvScale Local Environment Manager CLI & Headless TUI."""
    if ctx.invoked_subcommand is None:
        ctx.invoke(status)

@cli.command()
def status():
    """Display real-time status of all EnvScale services and clusters."""
    table = Table(title="EnvScale Microservice Architecture Status", header_style="bold cyan")
    table.add_column("Service", style="bold")
    table.add_column("Category", style="dim")
    table.add_column("Port", justify="center")
    table.add_column("Status", justify="center")
    table.add_column("Latency / Info")

    health_data = check_all_services()
    for sid in SERVICE_ORDER:
        svc = SERVICES[sid]
        h = health_data.get(sid, {})
        online = h.get("online", False)
        status_text = "[bold green]ONLINE[/bold green]" if online else "[bold red]OFFLINE[/bold red]"
        port_text = str(svc.get("port", "-"))
        latency = f"{h.get('latency_ms', 0)}ms" if online else "-"

        table.add_row(svc["name"], svc["category"], port_text, status_text, latency)

    console.print(table)

    # Kubernetes Cluster Panel
    km = K8sManager()
    k8s_info = km.get_cluster_status()
    k8s_text = f"[bold]Context:[/bold] {k8s_info['context']}  |  [bold]Health:[/bold] {k8s_info['status']}"
    console.print(Panel(k8s_text, title="Kubernetes Engine", border_style="blue"))

@cli.command()
@click.option("--service", "-s", default=None, help="Specific service to start (e.g., api, streamer, web, redis, postgres)")
@click.option("--all", "start_all", is_flag=True, default=False, help="Launch the full microservice application stack")
def start(service, start_all):
    """Start local services or the complete application stack."""
    ensure_env_files()
    if service:
        if service not in SERVICES:
            console.print(f"[bold red]Unknown service:[/bold red] {service}. Available: {', '.join(SERVICES.keys())}")
            sys.exit(1)
        console.print(f"[bold green]Starting {SERVICES[service]['name']}...[/bold green]")
        pm.start_service(service)
    elif start_all or not service:
        console.print("[bold green]🚀 Launching full EnvScale application stack...[/bold green]")
        pm.start_docker_infra()
        time.sleep(2)
        for sid in ["api", "streamer", "web"]:
            pm.start_service(sid)
            time.sleep(1)
        console.print("[bold green]✔ Full application stack launched![/bold green]")
        console.print("   - Web UI:           http://localhost:5173")
        console.print("   - REST API Server:  http://localhost:3000")
        console.print("   - Streamer Gateway: http://localhost:8080")

@cli.command()
@click.option("--service", "-s", default=None, help="Specific service to stop")
@click.option("--all", "stop_all", is_flag=True, default=True, help="Stop all services and containers")
def stop(service, stop_all):
    """Stop running microservices and background containers."""
    if service:
        console.print(f"[yellow]Stopping {service}...[/yellow]")
        pm.stop_service(service)
    else:
        console.print("[yellow]🛑 Stopping all EnvScale services and Docker containers...[/yellow]")
        pm.stop_all()
        console.print("[green]All services spun down cleanly.[/green]")

@cli.command()
@click.argument("service")
def restart(service):
    """Restart a specific service (e.g. api, streamer, web)."""
    if service not in SERVICES:
        console.print(f"[bold red]Unknown service:[/bold red] {service}")
        sys.exit(1)
    console.print(f"[bold cyan]Restarting {SERVICES[service]['name']}...[/bold cyan]")
    pm.restart_service(service)
    console.print(f"[bold green]Service {service} restarted.[/bold green]")

@cli.command()
@click.option("--follow", "-f", is_flag=True, default=False, help="Stream logs in real time")
@click.argument("service", default="all")
def logs(follow, service):
    """View or tail service logs."""
    console.print(f"[bold blue]Logs for [{service}]:[/bold blue]")
    entries = pm.get_logs(service)
    for svc, ts, msg in entries:
        console.print(f"[dim]{ts}[/dim] [[bold cyan]{svc}[/bold cyan]] {msg}")

    if follow:
        console.print("[dim]Streaming live logs (Press Ctrl+C to exit)...[/dim]")
        def _cb(s, ts, msg):
            if service == "all" or service == s:
                console.print(f"[dim]{ts}[/dim] [[bold cyan]{s}[/bold cyan]] {msg}")
        pm.subscribe(_cb)
        try:
            while True:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass

@cli.command()
def test():
    """Run full sequential quality and build checks across the monorepo."""
    console.print("[bold blue]🧪 Running monorepo test suite...[/bold blue]")
    tr = TestRunner(log_fn=lambda m: console.print(f"[dim]{m}[/dim]"))
    results = tr.run_all_tests()

    table = Table(title="Test Verification Results", header_style="bold magenta")
    table.add_column("Component")
    table.add_column("Result", justify="center")
    table.add_column("Duration", justify="right")

    for r in results:
        res_text = "[bold green]PASS[/bold green]" if r["passed"] else "[bold red]FAIL[/bold red]"
        table.add_row(r["name"], res_text, f"{r['duration']}s")
    console.print(table)

@cli.group()
def k8s():
    """Kubernetes cluster workload orchestration."""
    pass

@k8s.command("deploy")
def k8s_deploy():
    """Deploy test workload suite (15 manifests) to the active cluster."""
    km = K8sManager(log_fn=lambda m: console.print(f"[dim]{m}[/dim]"))
    km.deploy_test_suite()

@k8s.command("teardown")
def k8s_teardown():
    """Teardown test workloads from the active cluster."""
    km = K8sManager(log_fn=lambda m: console.print(f"[dim]{m}[/dim]"))
    km.teardown_test_suite()

@cli.group()
def chaos():
    """Chaos fault injection scenarios."""
    pass

@chaos.command("list")
def chaos_list():
    """List available chaos scenarios."""
    table = Table(title="Chaos Fault Injection Scenarios", header_style="bold red")
    table.add_column("ID", style="bold")
    table.add_column("Name")
    table.add_column("Description")
    for cid, s in CHAOS_SCENARIOS.items():
        table.add_row(cid, s["name"], s["description"])
    console.print(table)

@chaos.command("inject")
@click.argument("scenario_id")
def chaos_inject(scenario_id):
    """Inject a fault scenario into the Kubernetes test cluster."""
    cr = ChaosRunner(log_fn=lambda m: console.print(f"[dim]{m}[/dim]"))
    ok, msg = cr.inject_scenario(scenario_id)
    if ok:
        console.print(f"[bold green]✔ Success:[/bold green] {msg}")
    else:
        console.print(f"[bold red]✘ Failed:[/bold red] {msg}")

@chaos.command("recover")
@click.argument("scenario_id")
def chaos_recover(scenario_id):
    """Recover from a chaos fault scenario."""
    cr = ChaosRunner(log_fn=lambda m: console.print(f"[dim]{m}[/dim]"))
    ok, msg = cr.recover_scenario(scenario_id)
    console.print(f"[bold blue]{msg}[/bold blue]")

@cli.group()
def config():
    """Environment configuration & secrets."""
    pass

@config.command("sync")
def config_sync():
    """Synchronize environment variables and JWT secrets across services."""
    logs = ensure_env_files()
    for l in logs:
        console.print(f"[green]{l}[/green]")
    console.print("[bold green]✔ Environment files are synchronized![/bold green]")

@config.command("check")
def config_check():
    """Verify environment parity between API Server and K8s Streamer."""
    ok, issues = verify_env_parity()
    if ok:
        console.print("[bold green]✔ All environment secrets and configurations are in parity.[/bold green]")
    else:
        for i in issues:
            console.print(f"[bold red]✘ Issue:[/bold red] {i}")
