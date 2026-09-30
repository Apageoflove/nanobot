# Connect to an existing remote nanobot

Open your local **nanobot WebUI**, click the current host (initially **Local**)
at the bottom of the sidebar, and choose **Manage connections…**. This is the
single entry point for switching and managing hosts. The page lists this computer
and your saved servers. Choose
**Add server** to copy a prepared pairing command, or choose **Other ways → Use existing SSH settings**
to enter an SSH address such as
`ubuntu@your-server` or pick a suggested host from your SSH config. Choose
**Connect**. Next time, select the saved server directly. No port-forwarding
command or `.command` launcher is needed.

With more than five saved servers, the host menu includes search by name or SSH
address. The current server and recently used servers appear first; the local
computer stays at the top. Only the host list scrolls, so **Manage connections…**
stays visible. Use the arrow keys to choose a result, Enter to connect, and Escape
to close. Recent choices are remembered in this browser, not synced to servers.

To add another server, choose **Add server** below your saved connections. Use a
server's menu to edit or forget it. Editing opens the same dialog; **Save changes**
saves without connecting or switching hosts. Disconnect an open server before
editing its connection settings. The page supports browser back/forward and the
`#/remote` route. Cancelling setup while saving or connecting prevents a later
automatic switch. A profile or SSH tunnel already created is not rolled back;
you can manage it from the directory. Adding the same connection settings again
reuses that entry, without renaming it or disconnecting an open view.

This connects to the nanobot **already running on the server**. It does not
install a worker, clone a workspace, move conversations, or start a second bot.
It is separate from remote execution/worker deployment.

## Quick pairing: copy a command, follow a link back

For a Linux server with this version of nanobot installed, you do not need to
prepare a local SSH key or know the service account/config path:

1. In your **local** WebUI choose **Add server → Copy command**. The command is
   prepared when setup opens; **View command** lets you inspect it before running.
   After a successful copy, the dialog shows what to do in your server terminal.
   This is a clipboard confirmation, not a claim that the server is connected.
   **Other ways → Requirements & help** contains prerequisites and expiry details.
2. Open your cloud provider's server terminal. Run the command in the environment
   where nanobot is installed (activate its virtual environment for source installs).
   The command discovers the default config and named nanobot systemd services;
   choose a configuration if there is more than one. Provide the server's reachable
   IP/hostname and an existing non-root SSH login account when prompted.
   A single existing login account (including the original account under sudo)
   is selected automatically and shown in the authorization summary. A global
   server address reported by the SSH session can also be selected automatically;
   private/NAT addresses are never guessed. Use `--ssh-user` or `--host` to override.
3. Review the **full nanobot access** authorization on the server and confirm it.
   If nanobot runs as another service account, the server administrator must run
   this step. Pairing does not install sudo rules or weaken config permissions.
4. Open the terminal's **Return to nanobot** link on the same computer and in the
   same browser profile that started pairing. The local WebUI opens the server
   confirmation directly; review its identity and access, then choose **Connect**.
   The link does not authorize or connect automatically. If the terminal cannot
   open links, choose **Other ways → Use a connection code instead** and paste the returned
   `nbpc1.…` code, then **Review connection**. Both paths use the same verification.

The return link targets only an HTTP loopback origin (`127.0.0.1`, `localhost`,
or `[::1]`). Its fragment contains an encrypted receipt, not a plaintext admin
secret, and is scrubbed before the WebUI signs in. A new tab can continue the
request even if the original setup tab was closed. Pending keys remain on the
local backend for the ten-minute invitation lifetime; abandoned requests are
cleaned when a new request is prepared. A link opened on another machine, an
expired request, or a modified code fails closed. Native/non-loopback origins
continue to use the code fallback. Existing local authentication is still required.

No relay, public WebUI, uploaded private key, QR scan or new firewall rule is
involved. The public invitation expires after ten minutes. The returned code is
encrypted for that local instance; another computer/request cannot import it.
The server host key is pinned from the code copied through your trusted terminal.
Do not accept a connection code supplied by someone you do not trust.

The dedicated device SSH key expires after 90 days. OpenSSH `restrict` disables
shell-adjacent features and all SSH forwarding; a forced, fixed Python stdio
bridge connects only to the selected loopback nanobot port. It cannot execute
the client's SSH command. No extra daemon is installed or started. The server
requires OpenSSH with `restrict` and `expiry-time` support, `/usr/bin/python3`,
an Ed25519 host key, and the conventional `~/.ssh/authorized_keys` layout.
Custom SSH policies/layouts may reject the grant; use existing SSH settings in
that case. Windows servers and containers are not supported by quick pairing.

This is still **full access to nanobot**, not read-only access. Its configured
tools may themselves run commands or modify files. The WebUI credential stays
in the local backend, encrypted at rest alongside a private local decryption key
and dedicated SSH identity (directories `0700`, files `0600`). This protects
against other OS users, not compromise of your logged-in account. Provider keys
are not exported by the pairing protocol. Changes to the remote WebUI secret or
port require pairing again; they are not silently refreshed through sudo.

SSH network reachability is still required. Pairing cannot fix a blocked port or
VPN route. A failed connection keeps the paired profile for retry. **Network
route…** can explicitly reuse a saved connection's proxy/bound-interface route
to the same host, without copying its identity settings. Jump-host routes should
continue to use the ordinary SSH connection flow.

If the server rejects a paired device key, the UI asks you to pair again rather
than unlock an unrelated SSH agent. This can happen after revocation or expiry.

**Disconnect** closes local streams. **Forget** removes the local directory entry,
including that device's local pairing keys, but does not revoke server authorization.
To revoke, run the command displayed
in the connection details on the server:

```bash
nanobot remote revoke DEVICE_ID --ssh-user LOGIN_ACCOUNT
```

Only that device's exact managed key entry is removed; existing login keys stay
unchanged. Close any already-open remote sessions too: removing an authorized
key prevents new SSH authentication, not existing sessions. If setup is cancelled
after server authorization, use the revoke command printed in that terminal.
Re-pairing after expiry uses a new independent key, not an extension of an old grant.

## Existing SSH setup: server, then nanobot

The setup dialog separates **Server** (SSH login) from **nanobot** (which
installation to open). Start with an address or an existing SSH host. You do
not need to know nanobot's config path in advance.

After SSH signs in, a read-only check looks for the selected account's config
and up to eight named `nanobot*.service` systemd units. It reads service metadata
and checks config-file locations; it does not read their contents, scan other
users' home directories, run sudo, install software or change permissions.
One configuration belonging to the login account opens automatically. Multiple
configurations are shown as choices. A service owned by another account always
requires an explicit **Open nanobot** choice, showing that account and path;
opening still requires existing passwordless sudo permission.

If nothing is found, the dialog confirms **SSH connected** and asks for the
server's config path and optional service account. Docker, custom service names,
user services and non-systemd deployments may need this manual step. Failure to
find a config is not proof that nanobot is absent. Finding a config is also not
proof that its WebUI is running: the normal authenticated gateway check still
happens before opening.

SSH failures keep the entered address and offer **SSH login settings** for the
local key path, SSH config and port. Connection refusal, name resolution,
connection closure and authentication rejection have distinct messages. The
application does not infer a missing key from a closed connection, nor change
VPN, proxy or network-interface settings automatically. A custom SSH config
outside standard locations must still be explicitly supplied by its owner.

## Find a server you already use

The add/edit dialog suggests named hosts from `~/.ssh/config` and the system SSH
config, including ordinary `Include` files. Typing in **SSH address** filters
these suggestions without a separate search field. Selecting a host fills the
address; it does not connect until you choose **Connect**. Arrow keys navigate
the suggestions. If your configuration lives elsewhere, expand **Connection
options** and select the file beside **SSH config file**, or enter its local path.
Suggestions update automatically; no separate file-reading step is needed.
The private key field also has a native file chooser. Selecting a file returns
only its path: it does not upload, copy or read the private key. Cancelling leaves
the existing path unchanged. Headless hosts can use the manual path fields.

Discovery is passive: it reads host names and source paths, not private keys,
and does not contact servers or execute SSH hooks. Wildcard and negated patterns
aren't destinations. Conditional includes may suggest hosts; only connecting
checks reachability. Large or dynamic configurations show a partial-list notice;
you can still enter an alias manually. Discovery is capped at 200 hosts, 64 files,
256 KiB per file, and approximately 1 MiB in total.

At connection time, the system SSH client resolves your existing `User`, `Port`,
`IdentityFile`, jump hosts and other connection settings. An empty port field
inherits SSH configuration instead of overriding it with 22. Listing a host
does not mean nanobot is installed there.

You can also paste a simple command, for example
`ssh -p 2222 -i "~/.ssh/team key" ubuntu@your-server`. The address field imports
`-p` (port), `-i` (key path), `-F` (config path) and `-l` (login user) into the
existing Connection options. Review these before connecting. Quoted paths can
contain spaces, including Windows paths. This is an importer, not a terminal:
remote commands, shell expansions, repeated options and other flags are rejected,
not executed or silently discarded. Keep advanced options such as `ProxyJump`
in your SSH config and enter the alias. An interactive alias's `RemoteCommand`
and forced TTY are disabled for the fixed nanobot probe.

## Prerequisites

- Run the local WebUI on a loopback address, using the system OpenSSH client.
- For **existing SSH settings**, your key must already have access to the server. Encrypted keys should
  be unlocked in the system SSH agent. Interactive SSH passwords are not
  collected by this UI.
- The remote server needs `python3` and an already running nanobot WebUI with
  a configured `tokenIssueSecret` (or `token`) in its configuration file.
- The remote gateway must support the authenticated `/webui/terminal`
  identity probe, protocol version 1, and have the WebUI bundle installed.
  The initial transport supports HTTP on the server's loopback address; SSH
  encrypts the connection. A configured public WebSocket URL or trusted-proxy
  authentication is not supported by this SSH connection mode.

If this machine has never connected to the server, nanobot displays its SSH
fingerprint. Compare it with the server console or your administrator before
confirming in the same dialog. **Back** returns to the filled-in form when adding
a server. The public key is pinned for this connection, without changing
your system `known_hosts`. A **changed** host key is blocked, not automatically
accepted. Jump-host-only or non-Ed25519 hosts can use a previously verified
system SSH configuration instead of the in-app first-contact verifier.

## Connection options

Most setups only need the SSH address. Expand **Connection options** when necessary.
You can also give the server a recognizable name here; otherwise its address is
used as the name.

| Option | Meaning |
| --- | --- |
| SSH port | Optional override; empty inherits SSH config (normally 22) |
| SSH config file | Existing local config, including aliases or jump hosts |
| Private key path | Path to an existing local key; key contents aren't uploaded |
| nanobot config path | Server-side config, default `~/.nanobot/config.json` |
| nanobot service account | Optional account owning the remote config; requires existing passwordless `sudo -u` permission |

For a service installation, the SSH login and nanobot owner may differ. For
example, you might sign in as `ubuntu`, with nanobot running as `nanobot` and
its config in `/var/lib/nanobot/.nanobot/config.json`. The discovery step offers
these values when it finds the service; otherwise use **Specify a different
location** in the nanobot step. Editing a saved connection also exposes these
fields. The connection does not grant new sudo privileges.

## Using the remote instance

The remote instance's **own complete WebUI** fills the main window. Its UI
version follows the server, independently of the local
installation. Model settings, channels, tools and conversations belong to that
server. The isolated remote view cannot navigate the local application's
top-level window. The first version has been exercised in macOS Chrome; native
desktop-host packaging and other platforms still need their own acceptance.

The host switcher lives beside **Settings at the bottom of the sidebar**, showing
**Local** or your saved server name. It is also available in Settings. Its menu
opens upward and shows the computer name, recent hosts, and **Manage connections…**.
With the sidebar collapsed, the icon still opens the same menu. Recent, loaded
hosts show **Ready**. Remote
connection setup is hidden inside the embedded remote view, and connecting back
to the same gateway is rejected rather than creating a nested local session.

Updated remote WebUIs put the switcher in the same sidebar location. A narrowly
scoped, origin- and frame-checked bridge sends only the current host's display
identity and allows its button to open the local shell's menu. The remote page
does not receive your host directory, SSH configuration, or connection commands.
Older remote WebUIs retain a compact bottom-strip switcher so you can always
return local without covering their controls.

Refreshing restores the selected remote instance. A failed connection stays
on a remote error screen; it never silently redirects work to your local agent.
The selected server ID is stored per browser tab, without credentials.
When the page becomes visible again or the browser reports network recovery,
nanobot immediately rechecks existing connections. It does not reload the remote
view, switch hosts, or resend messages. If the connection remains unavailable,
use **Reconnect**. Different aliases resolving to the same already-connected
gateway are rejected; choose its existing entry in the host switcher. Separate
nanobot instances on one server can still use separate profiles and config paths.

- **Switching hosts**, including returning local, keeps both pages mounted and
  keeps SSH connected. Each host retains its own chat, unsent draft, scroll
  position and UI state; nothing is copied between hosts. Up to three remote
  views are kept per tab. At the limit, explicitly disconnect one rather than
  silently discarding its work. Reloading the browser still follows each
  instance's normal draft persistence; unfinished uploads aren't guaranteed.
- A first connection prepares a hidden server page while the current page stays
  usable. It switches after the page loads; **Cancel switch** keeps you where
  you are. The most recent choice wins even if an earlier SSH request finishes
  later. Cancelling navigation does not stop an in-flight server connection.
  Older server WebUIs can still show their own sign-in/startup indicator after
  the initial page load; returning to an already loaded view avoids that startup.
- **Disconnect** in a server's menu confirms before closing its view and shared
  SSH tunnel. Unsaved view-only work can be lost; the remote bot keeps running.
  Idle views do not automatically close a tunnel another tab might be using.
- **Forget server** removes its local connection metadata and pinned public key.
  It does not delete remote conversations, keys, files, or the installation.
- Closing the local gateway cleans up its SSH processes. The independently
  running remote gateway, Linear integration, and scheduled tasks keep running.
- Connections to the same saved server share one tunnel; explicitly disconnecting
  it also disconnects other local tabs using that tunnel. Reloading a tab reuses
  a healthy connection. Up to four servers can be connected concurrently.

## Security and troubleshooting

The local connection directory is stored beside the local config under
`webui/remote-instances.json`. It contains connection metadata, not private-key
contents or model/channel credentials. A stable loopback port per saved server
keeps browser preferences scoped to that server. Changing the SSH target, config
path, service account or identity file assigns a fresh browser origin, rather
than loading the previous instance's drafts. The adjacent
`remote-origin-ports.json` records previously used ports, without credentials;
these ports are not assigned to new targets, even after forgetting a profile.
Keep that file alongside the connection directory when moving local settings.
Port conflicts fail explicitly; nanobot does not attach to an unrelated listener.

For a backup or move, stop the local gateway and preserve the entire adjacent
`webui` directory, including `remote-hosts` and `remote-pairing`, with its private
file permissions. Paired device keys and imported routes follow the restored
directory automatically. Ordinary SSH profiles still reference your external
SSH config/key paths; update those separately if they moved. Restoring only
`remote-instances.json` cannot restore pairing credentials. Do not copy this
directory to another user or untrusted computer: it grants full remote nanobot
access. A downgrade to a version without remote connections leaves these files
unused; keep the backup for upgrading again.

The local gateway owns a browser-facing proxy and a separate, private SSH
transport. Browser login, API, WebSocket and media credentials are local
capabilities: they cannot authenticate to the remote gateway. The remote
credentials stay in backend memory. System SSH's private stdin/stdout pipes,
SSH configuration and host-key verification still secure the upstream transport.
Disconnecting or forgetting closes active requests but retains disabled
listeners until local gateway shutdown. Reconnecting the same saved instance
reuses its browser origin. An offline profile can be edited without first
disconnecting it in another tab.

Closing the local gateway drains proxy requests before releasing its private
transport. If an old tab retries the browser address after shutdown, it sends
only local capabilities from the stopped proxy, not a remote login credential.
Close old tabs anyway: after shutdown another local process can serve content
at that address. This does not isolate nanobot from malware running as you.
On Windows, exclusive socket ownership may delay reusing a port after shutdown;
retry later if it remains occupied. Nanobot does not weaken socket ownership
to force a reconnect.

SSH authenticates the server. A read-only, fixed Python probe retrieves only
WebUI login information from its config. The gateway's protocol and runtime ID
are verified before navigation. Only a local proxy credential is passed in the
remote view's URL fragment and stored by its existing login UI. Local gateway
restart replaces that credential and invalidates local token/media mappings;
reopening the saved connection handles this without an extra login step.
Nothing opens a public administration port or forwards your SSH agent.

**Upgrading the earlier remote-connection prototype:** it passed the remote
WebUI login secret to browser storage. This version retires those old browser
origins, but cannot revoke a secret already saved in an old tab. Close those
tabs, clear their browser site data, and rotate the remote WebUI login secret
to invalidate the old credential. This migration does not rotate credentials
or restart your server automatically.

Remote-connection actions require an authenticated local WebUI connection, a
loopback-bound gateway, and local request origin. They are unavailable from a
public/reverse-proxied administration page. Connecting requires server admin
access; permission to mention nanobot in Linear is **not** that permission.

Common errors explain whether SSH authentication, a missing config, a service
account, WebUI authentication, protocol compatibility or networking failed.
Key-agent refusal, unsafe key-file permissions, invalid SSH configuration and
server-side port-forwarding denial have separate recovery hints. Login banners
are ignored when reading the framed probe result. A failed probe is distinct
from an invalid nanobot configuration; raw SSH output and credentials aren't
displayed in error messages. If SSH works in a terminal but not in nanobot,
check that nanobot was started with access to the same system SSH agent.
Configurations whose WebUI secret is supplied only by a service environment,
interactive SSH passwords, and remote WebUIs with a public WebSocket URL need
additional setup; this flow does not silently weaken their authentication.
