from __future__ import annotations

import hashlib
import io
import tarfile
import zipfile
from pathlib import Path

import httpx
import pytest

from nanobot.apps import cua_driver
from nanobot.apps.cua_driver import CuaDriver, DriverError, Release


def package(target="linux-x86_64", *, unsafe=False):
    release = Release(target, "")
    output = io.BytesIO()
    if target.startswith("windows-"):
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr(f"{release.directory}/{release.executable}", b"driver")
    else:
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            member = tarfile.TarInfo(f"{release.directory}/{release.executable}")
            member.size = 6
            member.mode = 0o755
            archive.addfile(member, io.BytesIO(b"driver"))
            if unsafe:
                link = tarfile.TarInfo(f"{release.directory}/escape")
                link.type = tarfile.SYMTYPE
                link.linkname = "../../../outside"
                archive.addfile(link)
    data = output.getvalue()
    return Release(target, hashlib.sha256(data).hexdigest()), data


def serve(monkeypatch, release, data):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(200, content=data)

    monkeypatch.setattr(cua_driver, "host_release", lambda: release)
    monkeypatch.setattr(cua_driver, "PinnedDNSAsyncTransport", lambda: httpx.MockTransport(handler))
    return requests


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["linux-x86_64", "linux-arm64", "windows-x86_64", "windows-arm64"])
async def test_install_is_verified_idempotent_and_does_not_enable(tmp_path, monkeypatch, target):
    release, data = package(target)
    requests = serve(monkeypatch, release, data)
    driver = CuaDriver(tmp_path / "config.json")
    await driver.install()
    assert driver.executable.read_bytes() == b"driver"
    assert driver.info(None)["installed"]
    assert driver.info(None)["mode"] == "off"
    assert not driver.config_path.exists()
    await driver.install()
    assert len(requests) == 1
    config = driver.configuration("observe")
    assert config.enabled_tools == cua_driver.OBSERVE_TOOLS
    assert config.retry_tool_calls is False and config.image_output == "inline"
    assert "click" not in config.enabled_tools
    assert "check_permissions" not in config.enabled_tools  # setup is never agent-controlled
    assert driver.owns(config)
    assert "click" in driver.configuration("control").enabled_tools


@pytest.mark.asyncio
async def test_checksum_failure_publishes_nothing_and_can_retry(tmp_path, monkeypatch):
    release, data = package()
    serve(monkeypatch, release, data + b"tampered")
    driver = CuaDriver(tmp_path / "config.json")
    with pytest.raises(DriverError, match="checksum"):
        await driver.install()
    assert not driver.directory.exists()
    assert list(driver.root.glob("install-*")) == []
    serve(monkeypatch, release, data)
    await driver.install()
    assert driver.installed()


@pytest.mark.asyncio
async def test_archive_cannot_escape_staging(tmp_path, monkeypatch):
    release, data = package(unsafe=True)
    serve(monkeypatch, release, data)
    driver = CuaDriver(tmp_path / "config.json")
    with pytest.raises(DriverError, match="safely unpacked"):
        await driver.install()
    assert not driver.directory.exists()
    assert not (tmp_path / "outside").exists()


@pytest.mark.asyncio
async def test_install_does_not_overwrite_unverified_or_redirected_directory(tmp_path, monkeypatch):
    release, data = package()
    requests = serve(monkeypatch, release, data)
    driver = CuaDriver(tmp_path / "config.json")
    driver.directory.mkdir(parents=True)
    user_file = driver.directory / "keep.txt"
    user_file.write_text("keep")
    with pytest.raises(DriverError, match="not been overwritten"):
        await driver.install()
    assert user_file.read_text() == "keep"
    assert not requests
    isolated = tmp_path / "other"
    isolated.mkdir()
    (isolated / "apps").symlink_to(tmp_path / "apps", target_is_directory=True)
    with pytest.raises(DriverError, match="outside"):
        await CuaDriver(isolated / "config.json").install()


def test_supported_host_selects_pinned_package(monkeypatch):
    for system, arch, target in [
        ("Darwin", "arm64", "darwin-universal"), ("Darwin", "x86_64", "darwin-universal"),
        ("Windows", "AMD64", "windows-x86_64"), ("Windows", "ARM64", "windows-arm64"),
        ("Linux", "aarch64", "linux-arm64"), ("Linux", "x86_64", "linux-x86_64"),
    ]:
        monkeypatch.setattr(cua_driver.platform, "system", lambda: system)
        monkeypatch.setattr(cua_driver.platform, "machine", lambda: arch)
        monkeypatch.setattr(cua_driver.platform, "mac_ver", lambda: ("14.0", (), ""))
        selected = cua_driver.host_release()
        assert selected is not None and selected.target == target
        assert len(selected.digest) == 64


@pytest.mark.asyncio
async def test_installer_refuses_concurrent_download(tmp_path, monkeypatch):
    from filelock import FileLock

    release, data = package()
    requests = serve(monkeypatch, release, data)
    driver = CuaDriver(tmp_path / "config.json")
    driver.root.mkdir(parents=True)
    with FileLock(str(driver.root / "install.lock")):
        with pytest.raises(DriverError, match="already being installed"):
            await driver.install()
    assert not requests


@pytest.mark.asyncio
async def test_cancelled_download_leaves_no_partial_install(tmp_path, monkeypatch):
    import asyncio

    started = asyncio.Event()

    async def download(_release: Release, destination: Path):
        destination.write_bytes(b"partial")
        started.set()
        await asyncio.Event().wait()

    release, _ = package()
    monkeypatch.setattr(cua_driver, "host_release", lambda: release)
    monkeypatch.setattr(cua_driver, "_download", download)
    driver = CuaDriver(tmp_path / "config.json")
    task = asyncio.create_task(driver.install())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not driver.directory.exists()
    assert list(driver.root.glob("install-*")) == []


@pytest.mark.skipif(cua_driver.platform.system() != "Darwin", reason="macOS app/socket launch")
def test_mcp_sanitized_environment_keeps_same_private_endpoint(tmp_path):
    import os
    import subprocess
    import sys

    from nanobot.apps.cua_driver_stdio import endpoint

    path = tmp_path / "config.json"
    address = endpoint(path)
    try:
        child = subprocess.check_output([
            sys.executable, "-c",
            "from pathlib import Path; import sys; from nanobot.apps.cua_driver_stdio import endpoint; print(endpoint(Path(sys.argv[1])))",
            str(path),
        ], env={"PATH": os.defpath}, text=True).strip()
        assert child == str(address)
        assert address.parent.stat().st_mode & 0o077 == 0
        assert endpoint(tmp_path / "other.json") != address
    finally:
        address.parent.rmdir()
        endpoint(tmp_path / "other.json").parent.rmdir()


def test_read_only_check_does_not_launch_app_or_substitute_terminal_grants(tmp_path, monkeypatch):
    from unittest.mock import Mock

    from nanobot.apps import cua_driver_stdio

    monkeypatch.setattr(CuaDriver, "installed", lambda self: True)
    monkeypatch.setattr(cua_driver_stdio.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(cua_driver_stdio, "endpoint", lambda path: tmp_path / "driver.sock")
    monkeypatch.setattr(cua_driver_stdio, "daemon_listening", lambda path: False)
    run = Mock()
    monkeypatch.setattr(cua_driver_stdio.subprocess, "run", run)
    with pytest.raises(DriverError, match="not running"):
        cua_driver_stdio.launch(tmp_path / "config.json", check=True)
    run.assert_not_called()


@pytest.mark.asyncio
async def test_pending_permission_check_does_not_launch_or_claim_grants(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock

    from nanobot.apps import cua_driver_stdio

    monkeypatch.setattr(CuaDriver, "installed", lambda self: True)
    monkeypatch.setattr(cua_driver.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(cua_driver_stdio, "endpoint", lambda path: tmp_path / "driver.sock")
    monkeypatch.setattr(cua_driver_stdio, "daemon_listening", lambda path: False)
    spawn = AsyncMock()
    monkeypatch.setattr(cua_driver.asyncio, "create_subprocess_exec", spawn)
    assert await CuaDriver(tmp_path / "config.json").check() == {
        "connected": False, "accessibility": None, "screen_recording": None, "capture_verified": False,
    }
    spawn.assert_not_awaited()


@pytest.mark.asyncio
async def test_setup_opens_only_fixed_panes_or_this_gateways_bundle(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock

    monkeypatch.setattr(CuaDriver, "installed", lambda self: True)
    monkeypatch.setattr(cua_driver.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(cua_driver, "host_release", lambda: cua_driver._RELEASES["darwin-universal"])
    spawn = AsyncMock(return_value=AsyncMock(wait=AsyncMock(return_value=0)))
    monkeypatch.setattr(cua_driver.asyncio, "create_subprocess_exec", spawn)
    driver = CuaDriver(tmp_path / "config.json")
    await driver.open_setup("finder")
    assert spawn.call_args.args == ("/usr/bin/open", "-R", str(driver.directory / "CuaDriver.app"))
    for target, pane in [("accessibility", "Privacy_Accessibility"), ("screen_recording", "Privacy_ScreenCapture")]:
        await driver.open_setup(target)
        assert spawn.call_args.args == ("/usr/bin/open", f"x-apple.systempreferences:com.apple.preference.security?{pane}")
    with pytest.raises(DriverError, match="Choose"):
        await driver.open_setup("https://example.com")
    assert spawn.await_count == 3
    monkeypatch.setattr(cua_driver.platform, "system", lambda: "Linux")
    with pytest.raises(DriverError, match="macOS"):
        await driver.open_setup("finder")
    assert spawn.await_count == 3
