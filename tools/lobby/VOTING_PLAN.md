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

Use a pure model first, without attaching it to a socket or native menu:

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
7. Rotation follows an explicit host policy between completed matches; it must
   not change a running match, hand authority to clients, or require publishing
   a private session in a directory.

These are implementation defaults for the prototype, not new network behavior.
Final UX still needs mouse/controller navigation, accessible scrolling, every
player's actual ready state, visible candidate eligibility, countdown/cancel and
clear host override. No ready state is inferred from being connected.

## Tests before attaching the model

Pure tests must cover zero/128 players, sparse/reused slots, mixed capabilities,
invalid ownership, candidate intersections, unknown/custom maps, incompatible
mode/rules, duplicate/replaced/late ballots, ties/abstentions, roster changes and
idempotent close/cancel. A future serializer needs strict version and length
bounds, exact fields, integer ranges, truncation/unknown-message rejection and
replay/session checks. It must be tested against legacy transcripts **before**
network integration; currently no vote serializer is used by the game.

Native testing, mixed-client tests, visual QA and broader capacity runs remain
paused during live play. See [README.md](README.md) for the explicit pending
gates. Public deployment, other machines, mod loading and campaign co-op are
outside this increment.
