# Local validation - 2026-10-01

Baseline: `c55e4e2b9d90550b0e761eb78dfe9d7c74880cb9`.
No public service, firewall/router change or upstream PR is part of this result.
Live game files, personal saves and unrelated systems were not modified.

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

Not established: encrypted Internet tunnel selection/join, actual browser visual
interaction or URI handoff, Linux/Android compilation, WAN/CGNAT reachability,
public-service TLS/identity/generation fencing, host crash/restart recovery with
real games, dedicated hosting, NAS load, or 128 active players. This brief
two-player run did not exercise movement/combat/vehicles, authoritative damage
agreement, bandwidth, tick latency, packet loss or desync recovery. No capacity
claim follows from a listing's 128-player maximum or HTTP simulation.
See [PLAN.md](PLAN.md) for staged 16/32/64/128 acceptance. Test processes and local
directory servers exited after their runs. No upstream PR is ready yet.
