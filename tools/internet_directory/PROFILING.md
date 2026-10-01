# Bounded null-renderer profiling - 2026-10-01

The null renderer was running the main loop without display pacing. Native
interpolation bypasses the old frame throttle and relies on the GL swap for
vsync; no GL swap occurs with the null renderer. Actual simulation remained at
30 Hz, but thousands of invisible frames per second consumed a CPU core.

`D3DDevice_Present` now waits on the existing 60 Hz vertical-blank condition when
there is no GL context and interpolation is enabled. It does not change the
simulation clock, networking, GL presentation or interpolation-disabled path.
No sleep/busy-wait loop was added. The existing Windows clock/sleep wrappers
and their short deadline yields were not modified.

## Method and scope

The same guarded workload was measured before and after this change, one run
at a time. No count increased and no resource guard was relaxed:

| Workload | Full game processes | Scripted active players | Idle protocol stand-ins | Directory listings |
| --- | ---: | ---: | ---: | ---: |
| Active local match | 2 | 2 | 0 | 1 |
| Idle protocol match | 1 | 0 | 1 | 1 |

Both workloads exchanged actual loopback game traffic. The stand-in connects
through the existing TCP/UDP protocol and reaches an in-game state, but supplies
no distributed player inputs. A directory registration is a separate HTTP
operation and is not evidence of either a game connection or an active player.
These load profiles use System Link, not the encrypted tunnel or a WAN.

`HALO_HOST_PROFILE=1` enables five-second aggregates from the game's existing
frame/render/idle/tick wall timers. Disabled by default, it logs no identities,
addresses, invites, map/player names or payloads. `frame_ms` includes blocking
presentation time; `idle_ms` is the existing game's idle section, not all waits.
These timers are not CPU samples, tick-latency percentiles or a stack profiler.

The harness separately reads cumulative CPU and thread CPU for its own process,
its owned game children and the owned stand-in process. It samples every five
poll iterations, derives CPU rates over the steady match interval, and reports
roles rather than PIDs/thread IDs. It does not enumerate unrelated applications.
System CPU is sampled separately; subtracting approximate owned CPU leaves an
unattributed remainder, including other applications, sampling alignment and
the short-lived PowerShell counter reader. Do not attribute that remainder to
Halo, or interpret total-system peak CPU as a game-only measurement.

An initial profile exposed a test startup race: the joining client could take
slot 0 before the host created its local player. The upstream forced-kill test
assumes host-first order and did not produce scored deaths in that run. The
harness now waits for the host's one-player lobby before starting real clients.
The corrected baseline passed gameplay checks before the pacing change. No game
authority or damage code was changed to accommodate the test.

## Measurements

CPU below uses **100% for one logical CPU core**, so a multithreaded process can
exceed 100%. The active before/after intervals were 28.646/28.376 seconds; the
idle-host intervals were 22.812/23.052 seconds. These are short local samples.

| Process/workload | CPU before | CPU after | Null frames/s before | Null frames/s after | Tick rate after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Active host | 101.84% | 6.44% | 2411.06 | 59.98 | 30.006 Hz |
| Active client | 100.64% | 5.56% | 4257.29 | 60.01 | 29.990 Hz |
| Host with one idle stand-in | 119.80% | 11.12% | 3784.72 | 59.95 | 29.993 Hz |

Combined active-game CPU fell about 94%; idle-host CPU fell about 91%. Active
hottest-thread CPU fell from approximately 99% of a core to 3.7% per game.
Active render wall work fell from 767-824 ms/s to 26-29 ms/s, while measured
simulation work remained about 7 ms/s. The controlled change and process CPU
measurements support missing frame pacing as the dominant avoidable cost.
Remaining helper-thread costs are not individually stack-attributed.

The active harness used 0.38%/0.44% of one core before/after; the idle harness
used 0.41%/0.75% and the stand-in 0.27%/0.81%. Mean total system CPU was
30.04%/10.02% for active tests and 20.91%/33.75% for idle tests. The latter rose
despite the host's measured reduction: the approximate unattributed share rose
from 10.88% to 32.69%. Its 77% system peak is not a Halo-only cost. All guards
remained enabled; no higher-count inference follows from these numbers.

The paced active run passed in 66609 ms, with 35 tick reports per game, movement,
scripted shooting and forced kills/respawns. Final scores agreed: player 0 had
three kills/one death, player 1 one kill/three deaths. Two of 70 player-score
comparisons differed at the same tick-300 reporting boundary around a forced
kill; both views agreed at the next tick-330 sample and at the end. This is a
coarse sampling/propagation observation, not a zero-latency or zero-desync claim.
Sampled position differences had p95 0.130/max 0.174 game units. The corrected
baseline had p95 0.095/max 0.157, with different trajectories; this does not
establish a statistically meaningful change in synchronization accuracy.
Maximum observed tick wall times were 0.841/0.871 ms after pacing, not p99 latency.

The paced idle-host run passed in 50525 ms with 31 reports and both players
reported throughout its 30-second match hold. The coarse polling-derived rate
was 29.23 ticks/s; the internal five-second aggregates measured 29.993 Hz.
Peak owned working sets were 180 MiB for the active pair and 105 MiB for the idle
host plus stand-in. Protocol, active and directory capacities remain distinct.

## Compatibility and paused acceptance

The final Windows target compiled and linked. On the paced build, direct
encrypted matches passed with the directory **disabled** (zero HTTP requests,
unlisted private host; 21396 ms) and **unavailable** (21506 ms). The malformed
case was interrupted when the user resumed their live game; expiry was not
rerun. Both had passed on the preceding build, but remain pending on this one.
Only the verified disposable test owner was stopped; its children exited through
the control-pipe EOF path. No isolated games or fixture locks remained. Native
game tests are paused while the user plays, with no automatic restart scheduled.

The lightweight directory/signalling/supervisor suite passed all 24 tests in
3092.9 ms after the pause. No games are launched by that suite. The four completed
disabled/unavailable host/client logs contained zero profile lines with the flag
absent, confirming the aggregate profiler's default-off behavior.

The prior four-instance CPU stop and 16-connection protocol result remain the
highest attempted counts. This fix qualifies neither four active players nor
128 active players. No public service, router/firewall change, other machine,
campaign co-op change or live-install update is part of this work. Visible
rendering, other platforms, long matches/vehicles, WAN behavior and larger
populations still need separate acceptance. Lobby/voting UI work remains separate.

## Reproduce when native testing can resume

Use the prepared isolated fixture and approved existing toolchain described in
[NATIVE_INTEGRATION.md](NATIVE_INTEGRATION.md). Do not run during live play.

```text
node tools/internet_directory/native_load_test.mjs active 2 profile
node tools/internet_directory/native_load_test.mjs protocol 2 profile
```

The protocol case requires `HALO_TEST_PYTHON` pointing to an already approved
Python interpreter. The profile option requires at least three steady windows,
29-31 Hz measured simulation and no window above 65 null frames/s, in addition
to ordinary resource/gameplay acceptance. Raw logs and aggregate result files
stay in ignored `build/directory-game-test/profile-*` directories. Raw game logs
still contain upstream session data and must never be committed or shared.
