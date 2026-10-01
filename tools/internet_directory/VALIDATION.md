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

Not established: successful native Halo compilation or launch, actual game connection bots,
active movement/combat/vehicles, 128-player gameplay, browser visual interaction,
URI handoff, WAN/CGNAT reachability, NAS load, production deployment. No game
bandwidth, tick latency or desync measurements exist yet. See [PLAN.md](PLAN.md).

Native build prerequisites are not currently available in PATH: clang/lld and
ninja; no Visual Studio Build Tools installation was located in the usual
installer directory. Bundled Python is available. Per `port/windows/README.md`,
native compilation requires Visual Studio C++ x86 libraries + Windows 10/11 SDK,
LLVM clang/lld, ninja, and SDL 3.4.16 development files downloaded by configure.
That describes the initial prototype validation. The approved LLVM 23.1.2,
Ninja 1.13.2 and SDL 3.4.16 packages were subsequently downloaded from the official
releases, verified against their published SHA-256 digests, and unpacked.
LLVM's `clang` and `lld-link` version checks and Ninja's version check succeeded.
The Microsoft bootstrapper has a valid Microsoft Authenticode signature; its
installation remains pending the explicitly requested license acceptance.

The initial tested commit consists only of the experimental tool and its
documentation. A subsequent additive native `p2p_get_host_snapshot` API is
not yet built into the native game, has no caller, and does not publish anything.
The tests above cover only the JavaScript directory, not this C API. See
[NATIVE_INTEGRATION.md](NATIVE_INTEGRATION.md) for its outstanding validation.
The settings GUI, game assets and live installation remain untouched. Test and
demo servers close after completion.

An additional freestanding C contract fixture compiled successfully with LLVM
23.1.2 (`--target=wasm32-unknown-unknown`, `-Wall -Wextra -Werror`) and passed in
Node's WebAssembly runtime. It uses the unchanged getter body extracted from
`p2p.c` and actual production headers, with instrumented stand-ins for P2P state,
memory operations and mutex calls. It checks opt-in, null/unavailable state,
clearing, copies, counts 0–128, invalid counts and balanced locks. This does not
prove Windows compilation/linking, real concurrency, game discovery or gameplay.

The reviewed configure generator subsequently ran successfully with the existing
Python and `--portable --pgo=off --lto=off --android-ndk build/no-android-ndk`.
SDL was already staged from the checksum-verified package, so configure did not
need to download it. Android was explicitly unavailable and no profile-training
target or extra compiler-rt download was enabled. Output was confined to ignored
build files and wrappers.

The targeted `ninja -j2 build/windows/obj/port/linux/src/p2p.o` attempt generated
the MSVC tag header, then reached clang's Windows compilation. It failed at
`port/windows/include/posix/time.h:11` with `fatal error: 'time.h' file not found`:
the Microsoft CRT/SDK development headers are not yet installed. No object or
game executable was produced. The initial sandboxed Ninja invocation stalled;
only that task-owned process was stopped, and the approved compiler invocation
completed outside the restricted child-process environment with this diagnostic.

Unpacked dependency sizes observed locally: LLVM approximately 4080 MiB, Ninja
0.58 MiB, SDL 57.27 MiB. These do not include retained download archives,
Microsoft components or game/build data.
