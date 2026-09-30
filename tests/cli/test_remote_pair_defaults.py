"""Server pairing suggests a real login account, never blindly trusts SUDO_USER."""

from types import SimpleNamespace

import pytest

from nanobot.cli import remote


@pytest.mark.parametrize(
    ("uid", "sudo_user", "expected"),
    [(1001, "other", "ubuntu"), (0, "ubuntu", "ubuntu"),
     (0, "missing", None), (0, "nanobot", None), (0, "root", None)],
)
def test_pair_suggests_existing_login_account(monkeypatch, uid, sudo_user, expected):
    pwd = pytest.importorskip("pwd")
    users = [SimpleNamespace(pw_name=name, pw_uid=user_uid, pw_shell=shell) for name, user_uid, shell in
             [("root", 0, "/bin/bash"), ("ubuntu", 1001, "/bin/bash"),
              ("other", 1002, "/bin/bash"), ("nanobot", 1003, "/usr/sbin/nologin")]]
    monkeypatch.setattr(remote.os, "getuid", lambda: uid)
    monkeypatch.setattr(pwd, "getpwuid", lambda _: users[1] if uid else users[0])
    monkeypatch.setattr(pwd, "getpwall", lambda: users)
    monkeypatch.setenv("SUDO_USER", sudo_user)
    assert remote._default_ssh_user() == expected


@pytest.mark.parametrize(("connection", "expected"), [
    ("1.1.1.1 50000 8.8.8.8 22", "8.8.8.8"),
    ("1.1.1.1 50000 10.0.0.8 22", ""),
    ("1.1.1.1 50000 127.0.0.1 22", ""),
    ("1.1.1.1 50000 not-an-ip 22", ""), ("", ""),
])
def test_only_global_ssh_server_address_can_be_suggested(monkeypatch, connection, expected):
    monkeypatch.setenv("SSH_CONNECTION", connection)
    assert remote._default_host() == expected
