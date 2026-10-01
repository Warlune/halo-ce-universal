# Local validation — 2026-10-01

Baseline: `c55e4e2b9d90550b0e761eb78dfe9d7c74880cb9`.
Runtime: existing Node.js `v24.19.0` on Windows. No package installation.

`node --test --test-isolation=none tools/internet_directory/directory.test.mjs`
passed **12 tests, 0 failures** in 687.6 ms. Coverage includes opt-in lifecycle,
heartbeat/crash expiry, fresh invite resolution, separate protocol compatibility,
ownership, unknown/personal-field rejection, request/origin bounds, rate limiting,
moderation, capacity bounds, transport requirements and serialized withdrawal
after an ambiguous registration failure. Initial test-runner child spawning was
blocked by the sandbox; disabling worker isolation let the tests run without
expanded permissions. One test initially used fetch to set Host; because fetch
rewrites that header, it was corrected to use raw HTTP before the successful run.

`node tools/internet_directory/simulate.mjs` passed all four stages:

| Simulated hosts and browser clients | Elapsed ms | Process CPU ms | End-stage RSS MiB | Directory event-loop p95 ms |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 97 | 126 | 64 | 17 |
| 32 | 125 | 156 | 71 | 14 |
| 64 | 189 | 188 | 84 | 13 |
| 128 | 462 | 250 | 105 | 16 |

These are one short local run, with server and clients in the same Node process,
at most 16 concurrent HTTP operations. CPU can exceed wall time because it sums
thread CPU. RSS is a stage-end sample, not a peak or a per-client estimate. The
event-loop histogram has few samples; it is not a sustained-load benchmark.
The simulator registered/renewed/withdrew the listed number of synthetic hosts
and browsed/resolved selected invites. It opened no game/P2P connections.

Not tested: native Halo compilation or launch, actual game connection bots,
active movement/combat/vehicles, 128-player gameplay, browser visual interaction,
URI handoff, WAN/CGNAT reachability, NAS load, production deployment. No game
bandwidth, tick latency or desync measurements exist yet. See [PLAN.md](PLAN.md).

Native build prerequisites are not currently available in PATH: clang/lld and
ninja; no Visual Studio Build Tools installation was located in the usual
installer directory. Bundled Python is available. Per `port/windows/README.md`,
native compilation requires Visual Studio C++ x86 libraries + Windows 10/11 SDK,
LLVM clang/lld, ninja, and SDL 3.4.16 development files downloaded by configure.
No repository build/download script was executed and no toolchain was installed.

This change consists only of the experimental tool and its documentation. It
does not modify native game networking, the settings GUI, game assets or any
live installation. Test and demo servers close after completion.
