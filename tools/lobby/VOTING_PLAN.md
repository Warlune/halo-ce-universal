# Host selection and optional voting plan

## Current integration points

Existing host selection already calls
`network_game_server_change_map_name` and
`network_game_server_change_game_variant` from the widget event handlers. Both
operate in pregame and publish the existing game settings. Changing map clears
per-machine precache flags. The current map UI uses a fixed 13-map spinner;
`cache_files_map_plays_multiplayer` rejects unsupported map builds before applying
a choice. The mode UI loads saved/built-in `game_variant` definitions. Retain
those host-authoritative validation paths while replacing their presentation.

The first new UI increment is the read-only roster. Next, build a separate
catalog/view model for installed multiplayer maps and supported variants. Keep
map identity/content compatibility separate from a display label. Never load
arbitrary paths, download executable content, silently substitute missing maps
or treat directory metadata as proof that a client has a compatible map.
The source's map-automation files are test hooks, not a product selection API.

## Compatibility gate before live voting

No voting messages or wire fields are implemented by the roster increment.
Packet schema 1, discovery format 2 and distributed netcode 9 remain unchanged.
The current fixed packet definitions do not supply an extensible pregame vote
channel, and `network_player` contains no ready/vote capability field. Do not
repurpose names, controller/team bytes, padding, hardware IDs, Discord identity
or in-game synchronization-ready messages.

The advertisement has reserved version/flag bytes; current client logic masks
the distributed-netcode flag rather than comparing all flag bits. That is a
possible **host capability announcement**, not a completed negotiation design.
The source's version policy requires coordination when changing what peers send.
Before implementing an extension, review the full old-client decoder and version
policy and prove that legacy peers receive exactly the existing wire format.
Do not send experimental probes to peers that have not opted into an explicitly
supported extension. If a safe compatible extension is unavailable, use an
explicitly separate versioned mode, retaining ordinary legacy hosting as the
default; never disguise a required upgrade as an ordinary failed invite.

Desired matrix:

| Host/client mix | Required behavior |
| --- | --- |
| Old host, new client | Existing roster data and manual host selection; no vote traffic |
| New host, old client | Existing joining/settings/countdown; no unsupported messages sent to old client |
| Mixed lobby | Voting disabled; manual host selection remains available |
| All peers explicitly negotiate the same vote revision | Host may opt into voting |
| Directory missing/unreachable/private host/direct invite | Same capability rules; no directory dependency |
| Join or capability loss during a vote | Cancel/invalidate the round and return to host selection |

## Bounded host-authoritative state model

The pure C prototype in `port/linux/game/lobby_vote_model.c` implements the
round/ballot/eligibility logic below, **without any socket or native menu caller**.
Its eligibility masks are trusted adapter inputs, not filesystem validation or
client attestations. Installed map/mode catalog discovery and live capability
negotiation remain unimplemented.

1. The host creates a round scoped to its current session and roster revision,
   with a fresh round ID, monotonic deadline and a bounded candidate list.
2. Each candidate is an exact map/mode/rules combination validated against the
   host catalog and participating clients' declared compatibility. Declarations
   are not attestations; loading failure must still cancel start safely.
3. Each eligible human player gets one ballot. Bind it to the authenticated
   connection's owned player slot and slot generation; never trust a claimed
   player ID alone. Split-screen players count independently. Protocol test
   stand-ins and spectators are not automatically voting humans.
4. While open, a player can replace their own ballot. Reject wrong sessions,
   stale rounds/roster revisions, unowned slots, reused slot generations,
   unavailable candidates, malformed payloads and late ballots. Bound request
   rates separately from game input traffic.
5. The host freezes the result at the deadline, using a documented deterministic
   tie rule (host-provided candidate order); abstentions count as no ballot.
   With no ballots, retain the current selection rather than silently rotate.
6. Revalidate roster, eligibility, content, rules and precache state before
   applying the result through the existing host setters. The normal host
   countdown/start gate remains authoritative. Joining/leaving or map/rule
   changes invalidate the round; they cannot implicitly cast or preserve votes.
   Cancel any old countdown first; apply map/mode/rules as one validated server
   update, or prove intermediate settings broadcasts cannot start the match.
7. Rotation follows an explicit host policy between completed matches; it must
   not change a running match, hand authority to clients, or require publishing
   a private session in a directory.

These are implementation defaults for the prototype, not new network behavior.
Final UX still needs mouse/controller navigation, accessible scrolling, every
player's actual ready state, visible candidate eligibility, countdown/cancel and
clear host override. No ready state is inferred from being connected.

## Offline implementation and tests

The model bounds rounds to 128 player slots, eight candidate combinations and
5-60 second monotonic deadlines. Every active participant must have an explicit
supported-capability value. Voting eligibility is separate: spectators/stand-ins
can be excluded from ballots while their content compatibility still constrains
candidate selection. The host mask intersects every active participant's mask.
No common candidate, no eligible voter or any legacy/invalid participant disables
the round. The caller must build these inputs from authoritative state.

Ballots bind to a separate 128-bit session identifier, round/revision, player slot
and generation. The authenticated caller machine is an API argument obtained
from the connection, **not a field trusted from the ballot**. The model rejects
ownership/session/generation mismatch, stale rounds, late votes and ineligible
choices. Replacing one's vote does not add another vote. Closing is idempotent;
ties use candidate order and no ballots returns no change. A changed authoritative
revision or eligibility intersection cancels even a closed result before use.
The adapter must increment the revision on membership/catalog/rule changes.

The provisional standalone ballot codec is exactly 40 bytes in network byte
order; it is **not registered with any game packet type or emitted by any code**:

| Offset | Field |
| ---: | --- |
| 0-3 | Literal `HVOT` |
| 4-7 | Revision 1, reserved zero, unsigned 16-bit total length 40 |
| 8-23 | Separate nonzero session identifier; never an invite/credential |
| 24-27 | Nonzero round ID |
| 28-31 | Nonzero roster/catalog revision |
| 32-33 | Player slot 0-127 |
| 34-35 | Candidate index 0-7 |
| 36-39 | Nonzero slot generation |

The codec rejects unknown versions/reserved bits, truncation, trailing bytes,
out-of-range indices and zero identity fields. Decode failure clears its output.
It provides no authentication or negotiation by itself. Candidate catalogs,
capability messages, round announcements and result serialization are not
implemented. This provisional format can change after the compatibility review;
it is not a claim of a supported public protocol.

The actual C model and codec compiled with `-Wall -Wextra -Werror` to freestanding
WebAssembly and passed **251 assertions**, covering 128 individual ballots,
ownership and reused generations, legacy peers, inactive/spectator eligibility,
split-screen ownership, candidate intersections, replacements/duplicates,
deadline boundaries, ties/abstention, roster cancellation, overflow/invalid
limits, exact endian layout, every truncated length, trailing bytes, malformed
headers/indices/identities and buffer canaries. No game, socket or asset was used.
These tests do not validate installed custom-map content or legacy network
transcripts. Those remain required before attaching the model to game traffic.
The Windows target also compiled/linked the module with one build worker. A
source-reference check found zero UI/network callers of the model or codec;
no vote packets were transmitted and no game process was launched.

```powershell
& '<LLVM_DIR>/bin/clang.exe' --target=wasm32-unknown-unknown -std=c11 -O2 -Wall -Wextra -Werror -ffreestanding -fno-builtin -nostdlib '-Wl,--no-entry' '-Wl,--export=run_vote_tests' '-Wl,--export=vote_test_checks' port/linux/game/lobby_vote_model.c tools/lobby/vote_test.c -o build/lobby-tests/vote.wasm
node tools/lobby/vote_test.mjs
```

Native testing, mixed-client tests, visual QA and broader capacity runs remain
paused during live play. See [README.md](README.md) for the explicit pending
gates. Public deployment, other machines, mod loading and campaign co-op are
outside this increment.
