# Next milestone: an actual Halo host

The directory prototype is executable and tested. The added
`p2p_get_host_snapshot` API is an **uncompiled integration seam**, not a connected
directory implementation. It has no caller yet and adds no network request,
configuration setting, background thread or automatic publication.

## Authoritative snapshot seam

`port/linux/src/p2p.h` declares a copied `p2p_host_snapshot` with player count,
maximum players and current invite. The getter in `p2p.c` takes the existing
P2P mutex, copies data, then releases it. It requires an explicit opt-in value
of 1, a live hosting socket, active Internet hosting, an existing invite and
valid game-reported counts. It clears output on unavailable/private calls and
rejects null output. It never substitutes peer counts for authoritative player
counts. An invite-size compile-time assertion checks the structure's capacity.

Call only after `p2p_initialize` has completed, from a worker which does not hold
the P2P mutex. Perform HTTP outside that lock. A snapshot is not a continuing
liveness guarantee: closure, restart or opt-out can happen after copying.

Before publication, combine this with authoritative map and lobby/playing state
from `network_game_server_idle` and disposal, separate System Link/netcode
versions, and a user-chosen public name. Preserve existing player-count/Discord
behavior. Fail closed for loading, unknown, stopped, offline and private states
until their transitions have tests. Do not infer hosting from logs or clipboard.

## Worker and transport work still required

1. Add a default-off publication setting and explicitly configured directory
   origin, coordinating around unrelated settings GUI work. Explain that
   publication reveals the current invite and withdrawal does not revoke copies.
2. Deliver operator-provisioned identity/key without logging or committing them.
   Combine snapshots with a process/session generation. Use one bounded
   latest-value mailbox, not a queued update on every game tick.
3. Perform registration on a worker every 15 seconds against the 45-second lease.
   Serialize updates/withdrawals, recheck generation/opt-in before sending, bound
   time and response size, reject redirects, and retry with backoff/jitter.
4. Use WinHTTP with certificate validation on Windows and existing mbedTLS
   infrastructure on Linux. Updater helpers are GET-to-file with redirects;
   do not reuse them unchanged with registration bearer credentials. Implement
   dedicated bounded PUT/DELETE transport and preserve the loopback mock.
5. Withdraw on graceful stop; expire after crash. Add generation fencing before
   supporting overlapping replacement processes. Keep the existing tunnel's
   invite lifecycle until deliberate rotation/revocation is implemented.

## First actual game acceptance

Compile and launch only the isolated development binary, with separate config,
data root, save root and logs. Disable updater, UPnP and automatic link-handler
takeover for test instances. Never use the live installation as a writable data
root. Keep copied proprietary assets outside Git. Do not invoke `halo://` while
it could hand the invite to an unrelated running game.

Start with one real host and one real client. First test loopback registration
and local System Link, then selected-host encrypted P2P in an authorized WAN
test. Use a process-specific Join test entrypoint where needed. Verify actual
map/player metadata, zero P2P activity on browse, exactly one selected host
connection and an actual joined match. Exercise map changes, stop, crash,
restart and private hosting. The latter must send no registration requests.

Next, the existing stand-in script can test 15/31/63/127 clients plus a host.
It has not been run here and cannot validate active movement/combat/vehicles.
The HTTP simulator has connected zero players to Halo. The 128-active-player
gate in PLAN.md remains open.

## Native snapshot tests still required

Compile the Windows target and test unavailable/offline, unknown counts, opt-out,
active lobby/match, socket closure before `update_hosting`, disposal and restart.
Check counts at 0/1/127/128, cleared output on failure, no truncated invite, and
concurrent game-count changes. Build/test Linux before claiming cross-platform
support. The JavaScript tests do not compile, link or execute this C function.
