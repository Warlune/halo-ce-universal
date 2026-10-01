# Local validation - 2026-10-01

Baseline: `c55e4e2b9d90550b0e761eb78dfe9d7c74880cb9`.
No public service, firewall/router change or upstream PR is part of this result.
Live game files, personal saves and unrelated systems were not modified.

## Bounded supervision, compatibility and resource qualification

The Windows target rebuilt successfully with opt-in stdin control. The new
`native_supervision_test.mjs` passed in 61384 ms: an owned host crashed, restarted
once after 500 ms with the same listing ID and a different process invite, then
exhausted its restart budget after a second intentional crash. Its real lease
expired 44997 ms later and Join returned 404. A subsequent host withdrew on
explicit `stop`; a private replacement stayed absent and stopped on control-pipe
EOF. Both normal stops used shutdown handlers without forced termination.
Peak sampled owned working set was 85 MiB. This is a bounded development
supervisor with a local player, not a production dedicated service.

`native_invite_regression.mjs` passed all four direct encrypted-join cases with
ordinary mutual LAN discovery disabled:

| Directory condition | Two real games reached simulation | Runtime ms |
| --- | --- | ---: |
| Disabled | Yes; zero directory requests and no public listing | 21803 |
| Unavailable | Yes; registration connection failures exercised | 21385 |
| Malformed response | Yes; browser rejected invalid JSON | 21323 |
| Listing expired | Yes; directory Join returned 404 first | 21429 |

Only disposable fixture invites were read in memory from their own isolated
logs for this compatibility test. Production registration uses native snapshots.
A directory lease expiring does not revoke a still-running process's invite.
These checks used local encrypted transport, not WAN or desktop URI handoff.

Resource qualification used one-second system CPU/free-memory samples and
periodic owned-process working-set/CPU samples. Entry required system CPU below
70% and at least 8 GiB free; stop guards were CPU above 85% for three samples,
less than 4 GiB free, repeated event-loop stalls over 500 ms or combined owned
working set over 2 GiB. These are development safety bounds, not server sizing.
All full-game processes used the null renderer and isolated local configuration.

| Exercise | Outcome | Runtime ms | Peak system CPU | Peak owned working set MiB | Minimum free GiB |
| --- | --- | ---: | ---: | ---: | ---: |
| 2 real scripted active players | Passed | 54690 | 55% | 181 | 13.66 |
| 4 real game instances | CPU guard stopped startup | 18488 | 100% | 345 | 12.31 |
| 1 host + 1 idle protocol stand-in | Passed | 34710 | 31% | 105 | 19.07 |
| 1 host + 15 idle protocol stand-ins | Passed | 51243 | 83% | 107 | 16.74 |

The two active games each produced 35 tick reports, advancing from tick 30 to
1050 at an observed 29.52 ticks/s. Their local positions changed in 35/31 sampled
reports; movement, shooting and the upstream forced kill/respawn test ran. Both
reported a death. Same-tick position differences had p95 0.150 and max 0.169 game
units over 66 coarse samples. These are debug observations, not an authoritative
damage/score agreement check or tick-latency measurement. Vehicles were untested.

The four-instance attempt reached four connected players but no gameplay tick
reports before the guard stopped it. All four stopped gracefully. Total system
CPU includes other applications; this does not establish a Halo-only CPU cost.
No higher full-game stage was attempted. The 16-connection protocol run held all
16 reported players in a match for 30 seconds and produced 31 host tick reports,
ticks 30-930, observed 30.74 ticks/s from coarse log polling. Its 83% peak system
CPU left insufficient headroom to increase load; 32/64/128 protocol stages were
not run. Stand-ins send no distributed player input and cannot establish active
gameplay capacity. The earlier two-connection protocol run held for 15 seconds.

The stand-in tool was corrected for Windows empty-selector waits and the current
join payload's 32-byte optional identifier field, filled entirely with zeros.
It reads no hardware identifier. Serialized packet schema **1**, System Link
discovery compatibility **2**, and distributed netcode **9** are distinct; no
native wire protocol was changed.

The final combined Node regression run passed **24 tests, zero failures** in
2987.9 ms: 16 directory, three signalling and five supervisor tests, including
restart backoff/exhaustion, cancellation, graceful/EOF stop, forced fallback for
an intentionally unresponsive owned fixture and the total-lifetime guard.
No isolated fixture game processes or ownership locks remained afterward.

## Subsequent encrypted-join and unattended milestone

After `a18d32e9`, the Windows target rebuilt successfully with isolated automated
invite handling and a null-renderer event-timer fix. The final
`native_host_test.mjs tunnel` run **passed** in 45876 ms: first listing at 4141 ms,
two actual players, lobby -> playing, valid selected invite, authenticated
encrypted peer connections on both games, 30148 ms lease advance with an
unchanged-metadata heartbeat, and normal exit/withdrawal. Ordinary LAN discovery
was directed away from both games. The loopback signalling fixture recorded two
connections, four sealed publishes/forwards (380 payload bytes), zero protocol
rejects and zero remaining connections. A prior tunnel run also passed in
46845 ms. Neither run used public brokers, STUN, UPnP or the desktop URI handler.
This is same-machine encrypted-join evidence, **not WAN reachability**.

`native_host_test.mjs restart` **passed both cycles**: two sequential 30-second
null-renderer hosts, one in-memory listing identity, distinct process invites,
one unchanged-metadata heartbeat each and graceful withdrawal before expiry.
Cycle one completed at 30332 ms; both completed at 60643 ms. Both exit codes
were zero. A preliminary 20-second run exited correctly but was too short for
the heartbeat assertion after metadata settled; it was extended, not counted
as a heartbeat pass. The game still creates a local player and this does not
prove a production dedicated server. Later crash/supervision evidence is above.

The hardened directory and local signalling fixture passed **19 tests**
(16 directory + 3 signalling, 771.8 ms). New cases cover duplicate/escaped JSON
keys, malformed UTF-8, nested values, streamed response byte bounds, metadata
types, duplicate listings, conservative expiry, invalid operator limits, strict
opt-in and queued opt-out before registration starts. An already in-flight
ambiguous PUT still receives a serialized withdrawal. Test-only signalling
checks fragmentation, opaque routing, malformed/oversized frames and rejection
of wildcard subscriptions and retained publishes.

The revised HTTP-only simulation also passed 16/32/64/128 stages. At 128 it took
459 ms, used 485 ms summed process CPU, sampled 109 MiB end-stage RSS and 18 ms
event-loop p95. These remain directory participants, not game players.
This HTTP simulation preceded the bounded resource qualification above. Full
active-gameplay qualification remains open. The executor briefly disconnected during an app
update, then recovered; owned-process state was checked before resuming.
Final native test processes and fixture connections were stopped.

## Native build and actual games

The complete Windows target compiled and linked successfully with LLVM 23.1.2,
Ninja 1.13.2, SDL 3.4.16, Python 3.12.14, VS Build Tools 2022 17.14.41,
MSVC 14.44.35207 and Windows SDK 10.0.26100.0. Configuration used
`--portable --pgo=off --lto=off --android-ndk build/no-android-ndk`, then
`ninja -j2 windows`. Dependencies were explicitly approved and official portable
archives were verified against published SHA-256 digests. Microsoft installation
completed with no reboot after explicit license acceptance. See
[WINDOWS_BUILD.md](WINDOWS_BUILD.md) for component/source details.

`node tools/internet_directory/native_host_test.mjs match` **passed**:

| Observation | Result |
| --- | --- |
| Real processes | One modified native host and one real LAN game client |
| First listing observed | 3100 ms after test start |
| Map metadata | Initial default `carousel`, then `bloodgulch` |
| States observed | `lobby`, then `playing` |
| Maximum observed players | 2; configured capacity 128 |
| Lease expiry advance | 41095 ms over the run; one renewal with unchanged metadata |
| Selected invite | Valid real invite resolved; never printed or opened |
| Process shutdown | Both exited normally; host exit code 0 |
| Listing removal | Empty immediately after normal host exit, before lease expiry |
| Total test runtime | 45663 ms |

Both game copies logged players in the loaded match. The selected invite was
resolved through the browser's HTTP API; the second game separately joined via
loopback System Link. This did **not** establish an encrypted invite tunnel or
exercise browser clicks. STUN, MQTT signalling, UPnP, updater, Discord and
clipboard interaction were disabled. Each copy used isolated config, data,
saves/profile paths and ignored logs, with a bounded process guard. Proprietary
map copies and logs are local only and are not part of the contribution.

`node tools/internet_directory/native_host_test.mjs private` **passed** in
12523 ms: an actual Internet-enabled host ran without the public opt-in variable,
no listing appeared, the worker did not start, and the game exited normally.
No P2P peer-connection log or clipboard-copy event occurred in either acceptance.

During bring-up, an initial assertion incorrectly assumed the test starts on
Blood Gulch immediately; upstream first creates its default lobby. The test was
corrected to check that legitimate transition. A null-renderer attempt could
not use upstream's window-based exit timer and its polling reached the directory
rate limit; the harness stopped only its own child. Tests now use a hidden
rendering window and one-second polling. A one-player run could not enter a
match because upstream requires two players; the two-real-game test above
resolved that acceptance gap. No production headless claim is made.

## Directory contract and load fixture

Existing Node.js `v24.19.0` was used with no package installation.

`node --test --test-isolation=none tools/internet_directory/directory.test.mjs`
passed **12 tests, 0 failures**; latest run 717.3 ms. Coverage includes opt-in
lifecycle, heartbeat/crash expiry, fresh invite resolution, separate protocol
compatibility, ownership, field rejection, request/origin bounds, rate limiting,
moderation, capacity bounds, transport requirements and serialized withdrawal
after ambiguous registration. Same-process execution avoids sandbox child-spawn
restrictions while retaining actual loopback HTTP.

The earlier `node tools/internet_directory/simulate.mjs` passed all four stages:

| Simulated hosts and browser clients | Elapsed ms | Process CPU ms | End-stage RSS MiB | Directory event-loop p95 ms |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 97 | 126 | 64 | 17 |
| 32 | 125 | 156 | 71 | 14 |
| 64 | 189 | 188 | 84 | 13 |
| 128 | 462 | 250 | 105 | 16 |

These are one short local run with server/clients in the same Node process,
at most 16 concurrent HTTP operations. CPU sums thread CPU; RSS is a stage-end
sample, not a peak. The event-loop histogram has few samples. This is not a
sustained benchmark and opened zero game/P2P connections.

## C snapshot contract

The expanded fixture compiled with LLVM 23.1.2 for freestanding WebAssembly
(`-Wall -Wextra -Werror`) and passed in Node. It extracts the unchanged production
getter and uses production headers with stand-ins for state/memory/mutex calls.
It covers null output, opt-in refusal, twelve invalid/unavailable states,
cleared output, counts 0-128, map/state/invite copies and balanced locks. This
does not prove real concurrency; the full Windows build and game runs above
provide separate integration evidence.

## Remaining gates

Not established: WAN encrypted tunnel reachability, actual browser visual
interaction or URI handoff, Linux/Android compilation, WAN/CGNAT reachability,
public-service TLS/identity/generation fencing, production dedicated hosting,
NAS load, or 128 active players. The later two-player scripted check covers
movement/shooting and forced kill/respawn, but not sustained combat, vehicles,
authoritative damage agreement, bandwidth, tick latency, packet loss or desync
recovery. No capacity
claim follows from a listing's 128-player maximum or HTTP simulation.
See [PLAN.md](PLAN.md) for staged 16/32/64/128 acceptance. Test processes and local
directory servers exited after their runs. No upstream PR is ready yet.
