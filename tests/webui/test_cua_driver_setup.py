from unittest.mock import AsyncMock

import pytest

from nanobot.apps.cua_driver import CAPABILITY, CuaDriver
from nanobot.config.schema import Config, MCPServerConfig
from nanobot.webui.client_contract import assess_webui_contract, webui_contract
from nanobot.webui.mcp_presets_api import (
    McpPresetError,
    mcp_presets_payload,
    mcp_presets_settings_action,
)
from nanobot.webui.settings_services import WebUISettingsConfig


@pytest.fixture
def settings(tmp_path):
    from nanobot.config.loader import save_config

    config = Config()
    config.agents.defaults.workspace = str(tmp_path / "workspace")
    path = tmp_path / "config.json"
    save_config(config, path)
    return WebUISettingsConfig(path)


@pytest.mark.asyncio
async def test_install_and_access_need_separate_consent(settings, monkeypatch):
    install = AsyncMock()
    reload = AsyncMock(return_value={"ok": True, "requires_restart": False})
    monkeypatch.setattr(CuaDriver, "install", install)
    for action, values in [("install", {}), ("enable", {}), ("enable", {"mode": ["control"], "consent": [f"{CAPABILITY}:observe"]})]:
        with pytest.raises(McpPresetError, match="Confirm"):
            await mcp_presets_settings_action(action, {"name": ["cua-driver"], **values}, config=settings, reload_mcp=reload)
    install.assert_not_awaited()
    reload.assert_not_awaited()
    result = await mcp_presets_settings_action("install", {
        "name": ["cua-driver"], "consent": [f"{CAPABILITY}:install"],
    }, config=settings, reload_mcp=reload)
    assert result["last_action"]["ok"]
    install.assert_awaited_once()
    reload.assert_not_awaited()
    assert "cua-driver" not in settings.load().tools.mcp_servers


@pytest.mark.asyncio
async def test_enable_disable_reload_only_the_selected_host(settings, tmp_path, monkeypatch):
    monkeypatch.setattr(CuaDriver, "installed", lambda self: True)
    stop = AsyncMock()
    monkeypatch.setattr(CuaDriver, "stop", stop)
    reload = AsyncMock(return_value={"ok": True, "requires_restart": False})
    other = tmp_path / "other.json"
    other.write_text('{"untouched":true}')
    result = await mcp_presets_settings_action("enable", {
        "name": ["cua-driver"], "mode": ["observe"], "consent": [f"{CAPABILITY}:observe"],
    }, config=settings, reload_mcp=reload)
    server = settings.load().tools.mcp_servers["cua-driver"]
    assert "click" not in server.enabled_tools
    assert server.retry_tool_calls is False
    assert result["requires_restart"] is False
    assert other.read_text() == '{"untouched":true}'
    result = await mcp_presets_settings_action("disable", {"name": ["cua-driver"]}, config=settings, reload_mcp=reload)
    assert "cua-driver" not in settings.load().tools.mcp_servers
    assert reload.await_count == 2
    stop.assert_awaited_once()
    row = next(row for row in result["presets"] if row["name"] == "cua-driver")
    assert row["driver_setup"]["installed"] and row["driver_setup"]["mode"] == "off"


@pytest.mark.asyncio
async def test_manual_driver_is_not_replaced(settings):
    settings.update(lambda cfg: cfg.tools.mcp_servers.update({"cua-driver": MCPServerConfig(command="my-driver")}))
    with pytest.raises(McpPresetError, match="manually"):
        await mcp_presets_settings_action("enable", {
            "name": ["cua-driver"], "mode": ["control"], "consent": [f"{CAPABILITY}:control"],
        }, config=settings)
    assert settings.load().tools.mcp_servers["cua-driver"].command == "my-driver"


def test_catalog_and_core_contract_are_additive(settings):
    result = mcp_presets_payload(config_path=settings.path)
    assert CAPABILITY in result["capabilities"]
    row = next(row for row in result["presets"] if row["name"] == "cua-driver")
    assert row["driver_setup"]["schema"] == 1
    assert row["manifest"]["install"]["strategy"] == "verified-driver"
    assert webui_contract()["min_protocol"] == 1
    # Frozen old host contract, independent of the current capability list.
    assert assess_webui_contract({
        "version": "old", "min_protocol": 1, "max_protocol": 1, "capabilities": ["webui.core.v1"],
    })["status"] == "compatible"


@pytest.mark.asyncio
async def test_read_only_grants_reconnect_failed_runtime_only_when_complete(settings, monkeypatch):
    monkeypatch.setattr(CuaDriver, "installed", lambda self: True)
    settings.update(lambda cfg: cfg.tools.mcp_servers.update({"cua-driver": CuaDriver(settings.path).configuration("observe")}))
    check = {"connected": True, "accessibility": True, "screen_recording": False, "capture_verified": False}
    monkeypatch.setattr(CuaDriver, "check", AsyncMock(return_value=check))
    reload = AsyncMock(return_value={"ok": True, "requires_restart": False})
    values = {"name": ["cua-driver"]}
    await mcp_presets_settings_action("test", values, config=settings, reload_mcp=reload, mcp_runtime_status=lambda: {"cua-driver": "failed"})
    reload.assert_not_awaited()
    check["screen_recording"] = True
    result = await mcp_presets_settings_action("test", values, config=settings, reload_mcp=reload, mcp_runtime_status=lambda: {"cua-driver": "failed"})
    assert result["last_action"]["driver_check"] == check
    reload.assert_awaited_once()
    await mcp_presets_settings_action("test", values, config=settings, reload_mcp=reload, mcp_runtime_status=lambda: {"cua-driver": "connected"})
    reload.assert_awaited_once()
