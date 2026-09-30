"""Server-console commands for explicit remote WebUI device authorization."""

from __future__ import annotations

import ipaddress
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import NoReturn

import typer
from click import IntRange

app = typer.Typer(help="Pair this server with a local nanobot. No public WebUI or relay.")


def _default_host() -> str:
    """Use only a globally reachable address reported by this SSH session.

    A cloud's outbound address or a NAT/private address is not evidence of the
    inbound SSH destination. Do not contact an external IP lookup service.
    """
    fields = os.environ.get("SSH_CONNECTION", "").split()
    try:
        address = ipaddress.ip_address(fields[2]) if len(fields) == 4 else None
        return str(address) if address and address.is_global else ""
    except ValueError:
        return ""


def _default_ssh_user() -> str | None:
    """Suggest the existing login account, including when invoked through sudo."""
    import pwd

    current = pwd.getpwuid(os.getuid())
    if current.pw_uid:
        return current.pw_name
    users = [u.pw_name for u in pwd.getpwall() if 1000 <= u.pw_uid < 65534 and u.pw_shell.endswith(("/bash", "/sh", "/zsh"))]
    sudo_user = os.environ.get("SUDO_USER")
    if sudo_user in users:
        return sudo_user
    return users[0] if len(users) == 1 else None


def _pair_as_administrator(request: str, config: Path, host: str, ssh_user: str, port: int) -> NoReturn:
    """Continue the same request only with the operator's explicit sudo consent."""
    typer.echo("\nnanobot's configuration is protected by another server account.")
    typer.echo(f"Config: {config}\nAdministrator access is needed to continue. File permissions will not change.")
    # Keep the installed environment (resolving a venv Python symlink loses it).
    # Isolated mode excludes CWD/PYTHONPATH; never forward the caller's environment
    # with sudo -E or re-evaluate a shell command supplied in the invitation.
    command = [str(Path(sys.executable).absolute()), "-I", "-m", "nanobot", "remote", "pair",
               request, "--config", str(config), "--port", str(port)]
    for option, value in (("--host", host or _default_host()),
                          ("--ssh-user", ssh_user or _default_ssh_user())):
        if value:
            command.extend([option, value])
    sudo = shutil.which("sudo")
    if os.getuid() == 0 or sudo is None:
        typer.echo("Ask the administrator to run this in nanobot's installation environment:")
        typer.echo(shlex.join(command))
        typer.echo("Do not make the config publicly readable.")
        raise typer.Exit(1)
    typer.echo("You may be asked for your server login password. You'll review device access next.")
    if not typer.confirm("Continue as server administrator?", default=False):
        typer.echo("Cancelled. No device was authorized. Run the pairing command again when ready.")
        raise typer.Exit(0)
    result = subprocess.run([sudo, "--", *command], check=False)
    if result.returncode:
        typer.echo("Pairing did not finish. Follow the message above, or ask your server administrator.\n"
                   "To retry, run the pairing command again; get a new command if it has expired.", err=True)
    raise typer.Exit(result.returncode if result.returncode >= 0 else 1)


@app.command()
def pair(
    request: str = typer.Argument(help="Public pairing request copied from your local WebUI"),
    host: str = typer.Option("", help="Server IP or hostname reachable from your computer"),
    ssh_user: str = typer.Option("", help="Existing non-root SSH login account"),
    port: int = typer.Option(22, min=1, max=65535, help="Existing SSH port; not changed"),
    config: Path | None = typer.Option(None, help="Existing nanobot config; discovered if omitted"),
) -> None:
    """Run in your server terminal, then open the returned link on your computer."""
    from nanobot.webui.remote_pairing import fingerprint, read_request, return_link
    from nanobot.webui.remote_ssh import RemoteError

    try:
        if sys.platform != "linux":
            raise RemoteError("pair_linux_required")
        from nanobot.webui.remote_pair_server import authorize, metadata

        invitation = read_request(request)
        host_key = " ".join(Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()[:2])
        if config is None:
            from nanobot.webui.remote_discovery import (
                _LOCATE,  # pyright: ignore[reportPrivateUsage]
                RemoteInspection,
            )

            result = subprocess.run([sys.executable, "-c", _LOCATE, str(Path.home() / ".nanobot/config.json")], capture_output=True, text=True, timeout=8)
            records = [line.partition("NANOBOT_REMOTE:")[2] for line in result.stdout.splitlines() if "NANOBOT_REMOTE:" in line]
            candidates = RemoteInspection.model_validate_json(records[-1]).candidates if records else []
            if len(candidates) == 1:
                config = Path(candidates[0].config_path)
            elif candidates:
                for index, item in enumerate(candidates, 1):
                    typer.echo(f'{index}. {item.service or "nanobot"} — {item.config_path}')
                choice = int(typer.prompt("Which nanobot?", type=IntRange(1, len(candidates))))
                config = Path(candidates[choice - 1].config_path)
            else:
                config = Path(typer.prompt("Path to your nanobot config"))
        config = config.expanduser().absolute()
        try:
            config = config.resolve()
            details = metadata(config)
        except (PermissionError, RemoteError) as exc:
            if not isinstance(exc, PermissionError) and str(exc) != "config_permission":
                raise
            _pair_as_administrator(request, config, host, ssh_user, port)
        if not ssh_user:
            ssh_user = _default_ssh_user() or typer.prompt("SSH login account")
        if not host:
            host = _default_host() or typer.prompt("Server public IP or hostname (shown in your cloud console)")
        typer.echo(f"\nAuthorize {invitation.label} to use nanobot on {ssh_user}@{host}?\nConfig: {config}\nServer fingerprint: {fingerprint(host_key)}")
        typer.echo("This grants full nanobot WebUI access, including configured tools and settings.\nA dedicated SSH key can only reach this nanobot port; no shell or other forwarding.\nAuthorization lasts 90 days. No existing keys, firewall rules or model settings change.")
        if not typer.confirm("Authorize this computer?", default=False):
            typer.echo("Cancelled. No device was authorized. Run the pairing command again when ready.")
            return
        # Check the service is running before granting access; no credential is sent.
        import socket

        with socket.create_connection(("127.0.0.1", details["port"]), timeout=5):
            pass
        code = authorize(invitation, host=host, user=ssh_user, ssh_port=port, config=config,
                         host_key=host_key, until=int(time.time()) + 90 * 86400)
        link = return_link(invitation, code)
        if link:
            typer.echo("\nReturn to nanobot on your computer to finish connecting:")
            typer.echo("Open this link in the same computer/browser that started pairing.\n")
            typer.echo(link)
            typer.echo("\nIf your terminal cannot open links, paste this connection code into nanobot:\n")
        else:
            typer.echo("\nPaste this connection code into the same local nanobot window:\n")
        typer.echo(code)
        typer.echo(f"\nTo revoke new connections: nanobot remote revoke {invitation.id} --ssh-user {ssh_user}")
        typer.echo("Close any already-open remote sessions as well. Re-pair after changing the WebUI secret or port.")
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, RemoteError) as exc:
        typer.echo(f"Pairing not completed: {str(exc) if isinstance(exc, RemoteError) else 'check server config, login account and SSH installation'}. Existing settings were not reset.", err=True)
        if str(exc) == "config_permission":
            typer.echo("The nanobot config belongs to another account. Run this command in its installation environment as the server administrator, or ask that administrator to pair it. Do not make the config publicly readable.", err=True)
        raise typer.Exit(1) from None


@app.command()
def revoke(device: str, ssh_user: str = typer.Option("", help="SSH account used when pairing")) -> None:
    """Remove only this device's managed SSH authorization, preserving other keys."""
    import getpass

    from nanobot.webui.remote_ssh import RemoteError

    try:
        if sys.platform != "linux":
            raise RemoteError("pair_linux_required")
        from nanobot.webui.remote_pair_server import as_account

        user = ssh_user or getpass.getuser()
        typer.confirm(f"Revoke device {device} for SSH account {user}?", abort=True, default=False)
        as_account(user, "revoke", {"id": device})
        typer.echo("Authorization removed. Already-open SSH sessions must also be closed.")
    except (OSError, KeyError, RemoteError, subprocess.SubprocessError):
        typer.echo("Could not revoke. Check the device ID and run as the SSH account or server administrator.", err=True)
        raise typer.Exit(1) from None


if __name__ == "__main__":
    app()
