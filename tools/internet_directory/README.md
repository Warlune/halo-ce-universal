# Internet directory: local prototype

This is a dependency-free reference implementation of opt-in hosting discovery.
It is **not integrated into Halo yet**. It does not implement a dedicated server,
NAT relay, game transport or production public directory. No external service is
contacted by the demo or tests. The HTTP server binds only to `127.0.0.1` on an
ephemeral port; there is intentionally no public bind option.

The design target is **128 simultaneous active players**. The number 128 in a
listing is a permitted capacity field, not evidence that gameplay works at that
size. See [the implementation and capacity plan](PLAN.md).

## Run locally

Use an existing Node.js 24 runtime. No `npm install` or package dependencies:

```text
node --test --test-isolation=none tools/internet_directory/directory.test.mjs
node tools/internet_directory/simulate.mjs
node tools/internet_directory/demo.mjs --demo
```

The demo prints a loopback URL. Open it in a browser and press Refresh. Select
the clearly marked simulated host to exercise invite resolution. **Do not open
the synthetic invite in Halo.** The fixture is not a playable game. Ctrl+C
withdraws the listing and closes the server. Starting without `--demo` creates
an empty directory. Nothing opens a browser or game automatically.

The test option disables Node's worker-process isolation because the development
sandbox blocks child process spawning. Tests still use real loopback HTTP.
`simulate.mjs` runs stages of 16/32/64/128 registered synthetic hosts and simulated
browser clients, at most 16 concurrent HTTP operations. Its guards stop the run
after 30 seconds or when observed process RSS exceeds 512 MiB. It starts zero Halo
clients and makes zero encrypted P2P connections. It tests directory listing,
selection, heartbeat and withdrawal, not game-server connection capacity.

## Contract

`server.mjs` exports `createDirectory(options)`. An operator supplies a `hosts`
Map of random UUIDv4 listing IDs to random 32-byte hex bearer keys in memory.
Registration cannot create an identity. The demo provisions temporary credentials
and never prints or persists them. A production operator must add authenticated,
durable provisioning, key rotation and revocation before deployment. Never use a
hardware identifier or the public game invite as a registration credential.

| Request | Behavior |
| --- | --- |
| `PUT /v1/listings/{id}` | Authenticated registration/heartbeat, 45-second lease |
| `DELETE /v1/listings/{id}` | Authenticated, idempotent withdrawal |
| `GET /v1/listings?systemLinkVersion=2&netcodeVersion=9` | Compatible metadata, no invites; optional `map` filter |
| `GET /v1/listings/{id}/join?systemLinkVersion=2&netcodeVersion=9` | Current invite only after selection; expired, incompatible or full entries fail |

PUT and DELETE require `Authorization: Bearer <operator-provisioned key>`.
PUT requires JSON and exactly these fields:

```text
name, map, players, maxPlayers, build,
systemLinkVersion, netcodeVersion, state, invite
```

`state` is `lobby` or `playing`. `players` is an integer from zero through
`maxPlayers`, which is limited to 1–128. The invite must be precisely
`halo://join/` followed by 64 hex digits. Unknown fields, including personal
identifiers, are rejected. Names are bounded printable ASCII in this prototype;
localization needs a separate design. System Link format and netcode version are
independent compatibility fields. Build is display metadata, not a substitute
for either version. Counts, names and maps are host assertions, not attestations.

Success responses carry `apiVersion: 1`, except withdrawal's `{withdrawn: true}`.
Heartbeat responses include `id`, `expiresAt` (Unix milliseconds), and
`heartbeatAfterMs` (15 seconds by default). The server evaluates expiry with a
monotonic clock. The browser checks the wall-clock expiry conservatively; clock
skew may reject an otherwise usable invite. IDs remain stable across heartbeats
and host restarts if the operator reuses the same identity. Current invite data
must be replaced when the game process restarts. Directory restart discards all
listings; hosts must heartbeat again. This prototype does not persist identity.

`HostRegistration.update(snapshot)` takes the PUT fields plus two explicit
booleans: `public` and `online`. A missing/false opt-in, offline mode, stopped
state or invalid active snapshot withdraws any previous listing. Updates and
withdrawals are serialized. After an ambiguous PUT failure, a later withdrawal
still sends DELETE. A failed DELETE is retried by the next lifecycle update;
expiry bounds visibility if the host crashes or loses the network. A private
host which has never registered makes no HTTP request.

The game adapter must call update on authoritative lifecycle changes and every
15 seconds while hosting publicly. It must keep registration I/O off the game
thread, bound its queue, and retry with jitter/backoff shorter than the lease.
This timer/snapshot integration is not yet implemented in the native game.
The demo has a heartbeat timer for its synthetic snapshot only.

## Deliberate Join and privacy

Browsing reads metadata only. Selecting one host fetches its current invite.
The UI then presents a separate link to open Halo; it never auto-connects hosts,
writes the clipboard or launches processes. Opening a real invite can hand it
to an existing Halo process; afterward the player chooses the match in System
Link, as upstream currently requires. Do not test real links against an unrelated
running game. A selection can become stale even inside its lease; failed joins
must offer Refresh. The directory does not reserve player slots.

Public registration intentionally makes the game's invite available to any
directory reader who selects that host. Withdrawing cannot revoke an invite
already obtained or disconnect its peers. The native public-host UI must explain
this and support an appropriate stop/restart or invite-rotation policy before
claiming a public-to-private transition revokes access.

## Implemented protections and limits

- Per-ID bearer ownership checks; no anonymous registration; constant-time key
  comparison; operator-controlled blocked IDs; bounded listing storage.
- 4 KiB request bodies, bounded headers/paths/text, request timeouts, 64 open
  connections, and a loopback-IP request limit (120/minute by default).
- Exact Host/Origin validation, cross-site rejection, no CORS, no-store responses,
  restrictive CSP, text-only rendering of host labels, strict Halo invite scheme.
- Host client permits HTTPS origins; plain HTTP is allowed only for literal
  `127.0.0.1`. Credentials in directory URLs and redirects are rejected.
- No request logs, game-log scraping, personal configuration, assets, clipboard,
  device identifiers, public address lookup, router changes or relay activity.

This is not an Internet-hardened service. Public operation additionally needs TLS
termination, trusted-proxy rules, durable identity ownership and rate limits per
account/IP/join, moderation and reporting operations, capacity/load testing,
credential lifecycle, monitoring without invites, and a security review. The
server never fetches arbitrary URLs supplied by a listing. A directory outage
must not interrupt existing encrypted sessions or LAN play.

The client files have automated HTTP/contract tests; interactive browser layout
and native `halo://` handoff have not been manually exercised in this environment.
