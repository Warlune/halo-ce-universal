# Internet hosting implementation and validation plan

## Verified starting point

Inspected upstream `main` at `c55e4e2b9d90550b0e761eb78dfe9d7c74880cb9`
on 2026-10-01. The repository contains CC0 in `LICENSE.md`; no CONTRIBUTING,
AGENTS, SKILL or PR template files were found in this checkout. Preserve existing
license notices and include no Microsoft game data in contributions.

[PR #20](https://github.com/cybersecurity/halo-ce-universal/pull/20) was open
at inspection. It includes a macOS port and System Link source-address/remote
advertisement work and reports Windows/Linux/Android build testing as outstanding.
This prototype touches none of its native networking paths. Re-read its current
diff before any native discovery change; do not copy or merge its full branch.

Source baseline:

- `port/linux/src/p2p.c:update_hosting`: hosting follows the game's listening
  socket; one key/token invite per process, reused across games. Hosting exit
  stops signalling. Process restart changes the invite.
- `port/linux/src/p2p.h`: `p2p_join_invite` and desktop handoff are the intended
  integration points. A joined tunnel exposes the host's match through System
  Link; it does not by itself choose the match.
- `port/linux/src/p2p.c` and `p2p_internal.h`: encrypted UDP tunnel with KCP,
  STUN/hole punching, MQTT signalling, 127 peers plus the host, and no relay.
  Discovery cannot fix a pair of incompatible NATs.
- `port/linux/include/halo_port_limits.h`: System Link message format 2;
  distributed netcode version 9 is a distinct compatibility value.
- `port/linux/game/network_test.c` and `debug.null_renderer` are test facilities,
  not a supported unattended production dedicated server. The former creates
  a player, and test automation can affect simulation.
- `tools/system_link_bots.py` explicitly says its participants do not simulate
  the game or send distributed player inputs. Its standing players cannot
  validate active 128-player combat.

## Milestones and exit gates

1. **Local directory reference (implemented here).** Opt-in lifecycle adapter,
   operator-provisioned identity, stable listing ID, heartbeats, expiry, map,
   versions, players and current invite. Browse without P2P. Resolve only a
   selected host and offer deliberate URI handoff. Unit/HTTP tests and bounded
   16/32/64/128 directory-client exercise. Zero native game modifications.
2. **Native host lifecycle integration.** A synchronized snapshot API is now
   present but uncompiled, unused and not yet connected to the directory; see
   [NATIVE_INTEGRATION.md](NATIVE_INTEGRATION.md). Add configuration for an optional
   directory origin and `public_host=false` by default, plus bounded in-memory
   credential delivery. Obtain current invite under P2P synchronization rather
   than logs/clipboard. Combine listening state with authoritative game state,
   map, player counts and protocol constants. Publish snapshots to a bounded
   worker queue; never block the render/tick thread. Coalesce updates, apply
   jitter/backoff, withdraw on close, handle restart and use generation fencing
   to prevent an old host process overwriting a replacement. Fail closed on
   unknown state. Linux and Windows builds and mocked lifecycle tests must pass.
3. **First actual browser-to-host game.** Isolated development executable/config,
   maps data location, saves and logs; updater and UPnP disabled. Do not launch
   while desktop handoff might target the user's live game. Confirm public host
   registration, browse, selected invite resolution, tunnel establishment,
   System Link selection, map change, end game, process exit and crash expiry.
   Confirm a private session never registers. Record small two-client gameplay.
4. **In-game public discovery.** Display directory metadata separately from LAN
   advertisements; no fake raw LAN broadcasts and no auto-connect to every
   listing. Selecting Join connects only that host via existing encrypted P2P,
   then matches its advertisement/identity deliberately. Preserve LAN discovery
   and existing invite workflows. Test incompatible versions, stale/full hosts,
   directory outages and cancellation. Coordinate around PR #20's current state.
5. **Unattended hosting lifecycle.** Design a real Linux dedicated path with no
   local human player, map/variant rotation, orderly shutdown, restart recovery,
   persistent listing identity and health reporting. Identify dependencies on
   renderer/audio/UI before removing them. Do not relabel debug test modes as
   production headless support. Public reachability/NAT remains a separate gate;
   evaluate relay requirements only after measured WAN failure cases and explicit
   deployment approval.
6. **128-active-player acceptance and upstream draft.** Pass the staged gameplay
   matrix below, including real remote networks. Only then prepare a narrowly
   scoped draft PR with measured results and remaining limits. Do not merge.
   A directory-only local fixture is not sufficient for the functional Internet
   hosting contribution requested here.

## Capacity target: 128 active players

Start on the development PC. Use isolated configuration and approved binaries;
no public exposure or firewall/router changes are part of this prototype. The
reported 1 Gbps symmetric connection is an input to planning, not a measurement
of usable game throughput, latency or public reachability. Public IP/CGNAT and
end-to-end encrypted tunnel reachability are unverified.

| Stage | Exercise | What it can establish |
| --- | --- | --- |
| Local directory 16/32/64/128 | Register, heartbeat, browse, select, withdraw | Directory correctness and local HTTP overhead only |
| Game connection 16/32/64/128 total players | Host plus 15/31/63/127 stand-ins; join/leave/rejoin, lobby and expiry | Protocol connection/lobby capacity, not active gameplay |
| Active local 2, then 16/32/64/128 | Real simulation clients with movement, aim/fire, kills/respawn, pickups and vehicles | Functional simulation and per-process cost; same-host resource contention remains |
| Active remote 16/32/64/128 | Multiple real networks and clients; combat plus loss/recovery and map rotation | Actual Internet hosting acceptance at each level |

Before running the existing stand-in script, review it and bind an isolated host
address/ports. Do not let it attach to a running personal game. Do not start 128
full game processes at once. Use an orchestrator with small bounded ramps, a
fixed runtime, an owned process list, graceful cleanup, memory headroom and
CPU/tick-latency stop thresholds derived from a two-client baseline. Ask for an
idle testing window if the live game prevents isolation. Obtain additional
clients/volunteers before claiming remote capacity.

Collect at every level: process and per-core CPU; working set/private bytes;
per-host and per-client bytes/s and packets/s; measured simulation tick target and
p50/p95/p99 execution time; RTT/jitter and loss; late/dropped updates; correction
and desync rates; weapon damage/kill agreement; vehicle occupants/positions;
join/disconnect time and recovery; map load and rotation time. Keep raw captures
local and remove invites, hardware IDs and addresses from shareable evidence.
Separate observed results from extrapolation. Directory event-loop delay is not
Halo simulation tick latency.

For active acceptance, require all 128 players participating in sustained
movement/combat, vehicle interactions, agreement of authoritative health/deaths,
stable map rotation and recovery from client loss. Establish explicit time and
latency budgets from measured tick settings before the full run; passing an idle
lobby does not satisfy this gate. Any failed stage stops the ramp for profiling.

## Possible later NAS host

Keep the implementation Linux-compatible. Allocated vCPU is not measured CPU
utilization, and nominal free RAM does not account for NAS services and other
consumers. No current NAS utilization or Halo host cost has been measured; no
128-player VM sizing is justified yet. Keep machine inventories and personal
deployment configuration outside the source repository.

If pursued, use a separate resource-limited VM and measure CPU scheduling, memory,
map-load storage contention and networking under normal production workload.
Do not resize or access unrelated production VMs, change NAS configuration or
repair storage as part of this task. Recommend dedicated hardware if measured
headroom cannot meet the active-player target.

## Public service security gate

Before deployment: authenticated ownership/provisioning and short-lived or
rotatable registration credentials; TLS with secure client verification; no
redirected credentials; anti-replay/generation handling; bounded JSON and output;
per-account/per-IP registration, browse and Join limits; moderation/block/report
operations; version filtering; lease cleanup; capacity bounds and load shedding;
privacy-preserving operational metrics. Treat invites as public only after the
host explicitly opts in. Never publish private sessions automatically. Persist
only necessary identity data; do not collect hardware IDs. Explain that a copied
public invite survives directory withdrawal until the game invalidates it.

No public service deployment or paid dependency is authorized by this plan.
Production TLS/identity/persistence and independent security review remain open.
