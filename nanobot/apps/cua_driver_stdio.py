"""A managed stdio launch, not a second agent runtime.

The upstream macOS launcher selects /Applications by name. Use the exact
nanobot-managed bundle and private socket instead, so another agent's daemon
is neither selected nor stopped. No OS grants are made by this launcher.
"""

from __future__ import annotations

import hashlib
import os
import platform
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path

from filelock import FileLock

from nanobot.apps.cua_driver import DRIVER_ENV, CuaDriver, DriverError


def endpoint(config_path: Path) -> Path:
    # Unix-domain endpoints have a short path limit, even when the data dir
    # lives under a long application-support path. Never share a world-readable
    # socket directory or follow a pre-created symlink.
    key = hashlib.sha256(str(config_path.resolve()).encode()).hexdigest()[:20]
    # MCP stdio deliberately filters inherited environment variables, including
    # TMPDIR. Use the same short macOS location in both gateway and child.
    root = Path("/tmp") / f"nb-cua-{os.getuid()}-{key}"
    root.mkdir(mode=0o700, exist_ok=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise DriverError("Cua Driver's socket directory is not private to this user.")
    return root / "driver.sock"


def daemon_listening(path: Path) -> bool:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(0.2)
        try:
            client.connect(str(path))
            return True
        except OSError:
            return False


def launch(config_path: Path, *, check: bool = False) -> int:
    driver = CuaDriver(config_path)
    if not driver.installed():
        raise DriverError("The managed Cua Driver package is not installed.")
    env = {**os.environ, **DRIVER_ENV}
    args = [str(driver.executable), "mcp"]
    if platform.system() == "Darwin":
        address = endpoint(config_path)
        with FileLock(str(address.with_suffix(".lock")), timeout=20):
            if not daemon_listening(address):
                if check:
                    raise DriverError("The managed driver is not running; enable it before checking permissions.")
                command = ["/usr/bin/open", "-n", "-g"]
                for key, value in DRIVER_ENV.items():
                    command.extend(["--env", f"{key}={value}"])
                command.extend([
                    "-a", str(driver.directory / "CuaDriver.app"), "--args", "serve",
                    "--socket", str(address), "--pid-file", str(address.with_suffix(".pid")),
                ])
                subprocess.run(command, check=True, timeout=15, stdout=subprocess.DEVNULL)
                deadline = time.monotonic() + 15
                while not daemon_listening(address):
                    if time.monotonic() > deadline:
                        raise DriverError("Cua Driver did not start. Check system permissions on the gateway computer.")
                    time.sleep(0.1)
        # Embedded here means 'never auto-launch another app'. The daemon was
        # started as a standalone signed app, and retains its own TCC identity.
        args.extend(["--embedded", "--socket", str(address)])
    if os.name == "nt":
        # Windows has no POSIX exec replacement; stdio remains inherited.
        return subprocess.call(args, env=env)
    os.execve(driver.executable, args, env)
    return 0


if __name__ == "__main__":
    try:
        if len(sys.argv) not in {2, 3} or (len(sys.argv) == 3 and sys.argv[2] != "--check"):
            raise DriverError("Usage: python -m nanobot.apps.cua_driver_stdio CONFIG_PATH [--check]")
        sys.exit(launch(Path(sys.argv[1]), check=len(sys.argv) == 3))
    except (DriverError, OSError, subprocess.SubprocessError) as exc:
        print(f"nanobot: {exc}", file=sys.stderr)
        sys.exit(1)
