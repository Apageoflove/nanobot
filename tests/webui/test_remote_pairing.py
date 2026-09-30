"""Pairing protocol, restricted authorization and local API regression tests."""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from nanobot.webui import remote_pair_server, remote_pairing, remote_ssh
from nanobot.webui.remote_instances import RemoteInstances
from nanobot.webui.remote_pairing import PairReceipt, PairStore, read_request, seal
from nanobot.webui.remote_ssh import (
    PairedSSHProfile,
    RemoteError,
    ssh_arguments,
    transport_arguments,
)


def ssh_public():
    return Ed25519PrivateKey.generate().public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()


def receipt(request, **updates):
    return PairReceipt(**dict(id=request.id, ssh_key=request.ssh_key, host="203.0.113.1", user="ubuntu",
                             ssh_port=22, host_key=ssh_public(), hostname="team", config_path="/srv/nanobot/config.json",
                             port=8765, secret="private-webui-credential", authorized_until=int(time.time()) + 86400,
                             **updates))


@pytest.fixture
def pair(tmp_path):
    store = PairStore(tmp_path)
    start = store.start()
    request = read_request(start["command"].split()[-1])
    value = receipt(request)
    return store, start, request, value, seal(request, value)


def test_round_trip_only_preview_public_fields_and_restart(pair):
    store, start, request, value, code = pair
    assert "secret" not in json.dumps(start)
    assert "private-webui-credential" not in code
    preview = store.preview(request.id, code)
    assert preview["host"] == "ubuntu@203.0.113.1"
    assert "secret" not in json.dumps(preview)
    store.finish(request.id, code)
    assert PairStore(store.root.parent).connection(request.id)["secret"] == value.secret
    assert store.finish(request.id, code) == value
    for path in store.path(request.id).iterdir():
        assert path.stat().st_mode & 0o777 == 0o600
    assert store.path(request.id).stat().st_mode & 0o777 == 0o700
    assert value.secret not in (store.path(request.id) / "receipt").read_text()


def test_expiry_and_reconnect_have_distinct_lifetimes(pair, monkeypatch):
    store, _, request, _, code = pair
    store.finish(request.id, code)
    monkeypatch.setattr(remote_pairing.time, "time", lambda: request.expires + 1)
    with pytest.raises(RemoteError, match="pair_expired"):
        store.preview(request.id, code)
    assert store.connection(request.id)["secret"]


def test_wrong_request_and_tampering_fail_closed(pair):
    store, _, request, _, code = pair
    another = store.start()
    for invalid in [code[:-20] + "AAAAAAAAAAAAAAAAAAAA", "garbage", "nbpc1." + "A" * 32769]:
        with pytest.raises(RemoteError, match="pair_invalid"):
            store.preview(request.id, invalid)
    with pytest.raises(RemoteError, match="pair_invalid"):
        store.preview(another["id"], code)
    assert not (store.path(request.id) / "receipt").exists()


def test_wrapped_console_code_is_accepted(pair):
    store, _, request, _, code = pair
    wrapped = "\n".join(code[i:i + 80] for i in range(0, len(code), 80))
    assert store.preview(request.id, wrapped)["id"] == request.id


@pytest.mark.parametrize("origin", ["http://127.0.0.1:8870", "http://localhost:5173", "http://[::1]:8765"])
def test_return_link_is_loopback_fragment_only_and_survives_new_store(tmp_path, origin):
    from urllib.parse import urlsplit

    store = PairStore(tmp_path)
    started = store.start(origin)
    request = read_request(started["command"].split()[-1])
    value = receipt(request)
    code = seal(request, value)
    link = remote_pairing.return_link(request, code)
    assert link == origin + "/#/remote?pairing=" + code
    assert not urlsplit(link).query
    assert "private-webui-credential" not in link
    assert PairStore(tmp_path).preview(request.id, code)["host"] == "ubuntu@203.0.113.1"


@pytest.mark.parametrize("origin", ["https://example.com", "http://127.0.0.1.evil.test", "http://127.0.0.1@evil.test", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1/path", "http://127.0.0.1?redirect=bad", "http://127.0.0.1#bad", "http://127.0.0.1\n", "http://2130706433", "file:///tmp"])
def test_return_link_rejects_external_or_ambiguous_targets_before_creating_key(tmp_path, origin):
    store = PairStore(tmp_path)
    with pytest.raises(RemoteError, match="pair_invalid"):
        store.start(origin)
    assert not store.root.exists()


def test_legacy_request_still_has_copy_code_fallback(pair):
    _, _, request, _, code = pair
    assert remote_pairing.return_link(request, code) == ""


def test_cancel_only_deletes_pending_pair_files(pair):
    store, _, request, _, code = pair
    pending = store.start()
    store.cancel(pending["id"])
    assert not store.path(pending["id"]).exists()
    store.finish(request.id, code)
    store.cancel(request.id)
    assert store.connection(request.id)["secret"]
    with pytest.raises(RemoteError):
        store.cancel("../../outside")


def test_server_appends_restricted_key_and_revoke_preserves_existing(pair, tmp_path):
    _, _, request, _, _ = pair
    home = tmp_path / "server-home"
    home.mkdir()
    (home / ".ssh").mkdir(mode=0o700)
    original = ssh_public() + " existing-admin\n"
    keys = home / ".ssh/authorized_keys"
    keys.write_text(original)
    remote_pair_server.write_authorization(home, request, 8765, int(time.time()) + 86400)
    lines = keys.read_text().splitlines()
    assert lines[0] + "\n" == original
    assert lines[1].startswith('restrict,expiry-time="')
    assert "port-forwarding" not in lines[1]
    assert request.ssh_key in lines[1]
    assert "private-webui" not in (home / ".ssh/nanobot-remote" / request.id / "bridge.py").read_text()
    with pytest.raises(RemoteError, match="pair_used"):
        remote_pair_server.write_authorization(home, request, 8765, int(time.time()) + 86400)
    remote_pair_server.remove_authorization(home, request.id)
    assert keys.read_text() == original
    remote_pair_server.remove_authorization(home, request.id)
    assert keys.read_text() == original


def test_server_refuses_symlink_authorized_keys_without_touching_target(pair, tmp_path):
    _, _, request, _, _ = pair
    home = tmp_path / "server"
    (home / ".ssh").mkdir(parents=True, mode=0o700)
    outside = tmp_path / "important"
    outside.write_text("untouched")
    (home / ".ssh/authorized_keys").symlink_to(outside)
    with pytest.raises(OSError):
        remote_pair_server.write_authorization(home, request, 8765, int(time.time()) + 86400)
    assert outside.read_text() == "untouched"


def test_paired_transport_cannot_fall_back_to_generic_probe_or_forwarding(pair, monkeypatch):
    store, _, request, value, _ = pair
    monkeypatch.setattr(remote_ssh.shutil, "which", lambda _: "/usr/bin/ssh")
    profile = PairedSSHProfile(**store.profile(value).model_dump())
    args = ssh_arguments(profile)
    assert "IdentityAgent=none" in args and "IdentitiesOnly=yes" in args
    assert args[1:3] == ["-F", os.devnull]
    transport = transport_arguments(profile, value.port, store.path(request.id) / "known_hosts")
    assert "-W" not in transport
    assert transport[-1] == "nanobot-remote-bridge"
    assert "sudo" not in " ".join(transport)


def test_fixed_bridge_streams_only_to_baked_in_loopback_port():
    # Real bidirectional bytes, no SSH_ORIGINAL_COMMAND interpolation.
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    def serve():
        with listener:
            connection, _ = listener.accept()
            with connection:
                data = bytearray()
                while chunk := connection.recv(8192):
                    data.extend(chunk)
                connection.sendall(b"received:" + data)
    worker = threading.Thread(target=serve, daemon=True)
    worker.start()
    result = subprocess.run([sys.executable, "-I", "-S", "-c", remote_pair_server._BRIDGE.replace("PORT", str(port))],
                            input=b"hello-webui", capture_output=True, timeout=5,
                            env={**os.environ, "SSH_ORIGINAL_COMMAND": "echo MUST-NOT-EXECUTE"})
    worker.join(2)
    assert result.returncode == 0
    assert result.stdout == b"received:hello-webui"


async def test_api_pair_finalization_pins_host_and_hides_credentials(tmp_path):
    manager = RemoteInstances(tmp_path)
    started = await manager.action("pair_start", {})
    request = read_request(started["command"].split()[-1])
    value = receipt(request)
    code = seal(request, value)
    preview = await manager.action("pair_preview", {"id": request.id, "code": code})
    assert "secret" not in preview
    result = await manager.action("pair_finish", {"id": request.id, "code": code})
    assert result["profiles"][0]["paired"] is True
    assert "private-webui" not in json.dumps(result)
    assert "private-webui" not in manager.path.read_text()
    assert manager._known_hosts(request.id).read_text() == "nanobot-remote " + value.host_key + "\n"
    again = await manager.action("pair_finish", {"id": request.id, "code": code})
    assert again["id"] == request.id and len(again["profiles"]) == 1
    with pytest.raises(RemoteError, match="pair_managed"):
        await manager.action("save", {"id": request.id, "profile": manager.pairing.profile(value).model_dump()})
    await manager.action("pair_cancel", {"id": request.id})
    assert manager.pairing.connection(request.id)["secret"]
    await manager.action("remove", {"id": request.id})
    assert not manager.pairing.path(request.id).exists()
    assert manager.snapshot()["profiles"] == []


def test_model_keys_never_enter_pairing_metadata(tmp_path):
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"providers": {"deepseek": {"apiKey": "not-exported"}},
                                "channels": {"websocket": {"enabled": True, "tokenIssueSecret": "webui-only"}}}))
    assert "not-exported" not in json.dumps(remote_pair_server.metadata(path))


async def test_route_import_only_copies_network_options(monkeypatch, tmp_path):
    config = tmp_path / "config"
    config.write_text("")
    process = SimpleNamespace(returncode=0, communicate=AsyncMock(return_value=(
        b"hostname 203.0.113.1\nuser ubuntu\nport 22\nidentityfile /private/admin-key\nproxycommand nc -b en0 %h %p\nbindaddress none\nbindinterface none\nproxyjump none\n", b"")))
    monkeypatch.setattr(remote_ssh.asyncio, "create_subprocess_exec", AsyncMock(return_value=process))
    monkeypatch.setattr(remote_ssh, "stop_process", AsyncMock())
    profile = remote_ssh.RemoteProfile(name="existing", host="alias", ssh_config=str(config))
    route = await remote_ssh.pairing_route(profile, "203.0.113.1")
    assert route == "Host *\n    proxycommand nc -b en0 %h %p\n"
    assert "identity" not in route and "admin" not in route
    with pytest.raises(RemoteError, match="pair_route_mismatch"):
        await remote_ssh.pairing_route(profile, "different.example")


def test_request_cannot_inject_authorized_keys_options(pair):
    _, start, _, _, _ = pair
    raw = remote_pairing.unpack("nbpr1.", start["command"].split()[-1])
    raw["ssh_key"] = 'command="sh" ' + raw["ssh_key"]
    with pytest.raises(RemoteError, match="pair_invalid"):
        read_request(remote_pairing.pack("nbpr1.", raw))


def test_expired_device_cannot_connect(pair, monkeypatch):
    store, _, request, value, code = pair
    store.finish(request.id, code)
    monkeypatch.setattr(remote_pairing.time, "time", lambda: value.authorized_until + 1)
    with pytest.raises(RemoteError, match="pair_authorization_expired"):
        store.connection(request.id)
    # The UI can explain expiry without opening a path around connection().
    assert store.authorization_until(request.id) == value.authorized_until


def test_authorization_expiry_does_not_hide_other_profiles_on_corrupt_receipt(pair):
    store, _, request, _, code = pair
    store.finish(request.id, code)
    (store.path(request.id) / "receipt").write_text("invalid")
    assert store.authorization_until(request.id) is None
    with pytest.raises(RemoteError, match="pair_invalid"):
        store.connection(request.id)


async def test_saved_pair_exposes_only_expiry_and_public_metadata(pair, monkeypatch):
    store, _, request, value, code = pair
    manager = RemoteInstances(store.root.parent)
    await manager.action("pair_finish", {"id": request.id, "code": code})
    monkeypatch.setattr(remote_pairing.time, "time", lambda: value.authorized_until + 1)
    profile = manager.snapshot()["profiles"][0]
    assert profile["authorized_until"] == value.authorized_until
    assert value.secret not in json.dumps(profile)
    assert "receipt" not in profile and "exchange_key" not in profile
    with pytest.raises(RemoteError, match="pair_authorization_expired"):
        await manager.action("connect", {"id": request.id})


def test_failure_before_authorizing_does_not_write_keys(pair, monkeypatch, tmp_path):
    _, _, request, value, _ = pair
    install = AsyncMock()
    monkeypatch.setattr(remote_pair_server, "as_account", install)
    with pytest.raises(RemoteError):
        remote_pair_server.authorize(request, host=value.host, user=value.user, ssh_port=22,
                                    config=tmp_path / "missing", host_key=value.host_key,
                                    until=value.authorized_until)
    install.assert_not_called()
