# Native loopback directory integration

The Windows game now builds and registers a real hosted session with the local
reference directory. This is an experimental integration, not a production
public directory or dedicated server. The settings GUI is unchanged.

## Opt-in and transport

`directory.c` starts only when Internet play is enabled and these process
variables are supplied:

| Variable | Required value |
| --- | --- |
| `HALO_DIRECTORY_PUBLIC` | Exactly `1`; absent/other values do nothing |
| `HALO_DIRECTORY_URL` | Exactly `http://127.0.0.1:<port>`, port 1-65535, no path/query |
| `HALO_DIRECTORY_ID` | Operator-provisioned lowercase UUIDv4 |
| `HALO_DIRECTORY_KEY` | Operator-provisioned 64 lowercase hex bearer credential |
| `HALO_DIRECTORY_NAME` | 1-80 ASCII letters/digits/spaces/underscore/hyphen/period |

Opt-in covers hosted sessions for this process's lifetime; it is not a per-match
GUI preference. Restart without the opt-in to disable publication. The current
invite becomes available to directory readers who select the host. Withdrawal
does not invalidate already copied invites. No public endpoint is accepted.
Do not reuse credentials across overlapping processes: generation fencing is
not implemented. Keep identity/key delivery local and out of logs and Git.

The worker uses existing socket wrappers, a two-second total request deadline,
bounded buffers, authenticated PUT/DELETE, and no redirects. It polls copied
state every 250 ms, sends changes or a 15-second heartbeat, and waits three
seconds before retrying failures. It never queues game frames or performs HTTP
under the P2P mutex. Shutdown attempts withdrawal with a bounded 4.5-second wait;
the server's 45-second lease is the fallback for a crash or unreachable service.

## Authoritative metadata

`network_game_server_idle` supplies game-reported counts, map and lobby/playing
state together through `p2p_set_game_host_state`. Disposal clears availability.
The snapshot getter additionally requires explicit opt-in, online P2P running,
a live hosting socket and invite, and valid counts up to 128. Unknown/loading
states fail closed. It copies state/map/invite under the existing mutex and
clears the caller's output on failure. Discord still receives game player counts.
Map basenames are normalized by the worker. System Link format 2 and netcode 9
come from distinct production constants. Build is currently the descriptive
`native-prototype`, not an attestation or a compatibility check.

A copied snapshot is not a liveness guarantee: the game can stop just after it
is copied. Periodic rechecks, withdrawal and lease expiry bound stale visibility.
This first worker has a fixed retry delay; production HTTPS, jitter, credential
rotation, process-generation fencing and a public/private UI remain outstanding.

## Actual native acceptance

`native_host_test.mjs` requires a prepared `build/directory-game-test` fixture,
a marker containing `local native directory fixture`, the freshly built
`halo.exe` and SDL3.dll, and legitimately owned map copies under `data/maps`.
It checks the runtime executable hash against `build/windows/halo.exe` before
launch. It never copies from or writes to a live installation itself.

```text
node tools/internet_directory/native_host_test.mjs public
node tools/internet_directory/native_host_test.mjs private
node tools/internet_directory/native_host_test.mjs match
```

`public` runs a one-player lobby; `private` checks default-off publication;
`match` prepares a second isolated fixture from the first fixture's copied maps
and runs one host plus one real LAN client. The match test uses loopback System
Link after explicit invite resolution. It does not consume that invite to
establish an encrypted tunnel. No URI is opened and no unrelated process is
joined or stopped. Only spawned processes can be terminated by the 65-second
guard. Each copy has separate data, saves, profiles and logs. Maps and raw logs
stay under ignored `build/`; raw logs contain upstream invites and must not be
shared or committed. Provisioned directory credentials exist only in memory.

The tests disable updater, UPnP, STUN/MQTT signalling and Discord. A hidden
rendering window is used. Automated instances now skip desktop clipboard access,
matching the existing automated-run URL-handler guard. Null rendering remains a
debug facility: upstream's event-pump timer returns before checking exit_after
when no window exists. It is not a reliable production shutdown mechanism.

The completed two-game test observed initial default lobby map `carousel`, then
`bloodgulch`, player count rising to two, lobby -> playing, unchanged-metadata
heartbeat renewal, selected invite resolution, and immediate withdrawal on
normal host exit. Both copies logged simulated players in the loaded match.
This was a short lifecycle/LAN check, not movement/combat/vehicle agreement,
latency measurement, WAN acceptance or 128-player validation. Results and
remaining gates are in [VALIDATION.md](VALIDATION.md) and [PLAN.md](PLAN.md).

## Compiled snapshot contract

```powershell
node tools/internet_directory/native_snapshot_test.mjs prepare
& '<LLVM_DIR>/bin/clang.exe' --target=wasm32-unknown-unknown -std=c11 -Wall -Wextra -Werror -ffreestanding -fno-builtin -nostdlib -Iport/linux/src '-Wl,--no-entry' '-Wl,--export=run_snapshot_tests' build/snapshot-contract/snapshot.c -o build/snapshot-contract/snapshot.wasm
node tools/internet_directory/native_snapshot_test.mjs check
```

The fixture extracts the unchanged getter/size assertion and uses production
headers with instrumented stand-ins for state, memory and locking. It passes
null/opt-out clearing, twelve unavailable/invalid states, all counts 0-128,
lobby/playing copies, invite terminator and balanced locks. It does not prove
real mutex concurrency. The native game build and acceptance above are separate
checks; Linux and Android remain unbuilt and untested.
