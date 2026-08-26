import os
import socket
import shutil
import subprocess

def check_port(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.4)
    res = sock.connect_ex(('127.0.0.1', port))
    sock.close()
    return res == 0

def check_cli_tools(tools):
    missing = []
    for tool in tools:
        if not shutil.which(tool):
            missing.append(tool)
    return missing

def exec_cmd_silent(cmd: str, cwd: str = None) -> int:
    try:
        res = subprocess.run(cmd, shell=True, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return res.returncode
    except Exception:
        return -1
