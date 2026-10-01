# Connected lobby roster prototype

The existing network lobby is a **four-machine display**, not a four-player
session limit. `network_pregame_status_screen_update` in
`source/interface/ui_widget_game_data_input_functions.c` fills one local machine
panel and only three remote-machine panels, stopping at the first three remotes.
Local panels have player names/team selectors; remote panels have machine names
and controller icons. The authoritative session array already has 128 player
slots. Display capacity and tested active-gameplay capacity are separate.

The new read-only overlay is available in the connected pregame screen:

- **F8:** open/close the roster; the closed hint shows the actual valid-row count.
- **PgUp / PgDn:** previous/next page, 12 players per page, up to 11 pages.
- Rows show bounded player names, team (Red/Blue/Unassigned or FFA), and
  Local/Remote membership. Original slot numbers remain stable across holes.
- Leaving the screen, opening a modal/error or virtual keyboard, or entering
  gameplay closes the view. Held keys do not repeatedly toggle or page.

This is a keyboard-operated display prototype, not the final mouse/controller
scrolling UI. It does not replace team selection, host map/mode controls or the
start countdown. It changes no packets, version constants, directory fields,
P2P invites, game settings, player ownership or proprietary widget assets.
The overlay is nonmodal: existing menu/game controls keep their normal behavior.

There is no per-player lobby-ready boolean in `network_player`. The in-game
distributed `client_ready` message concerns synchronization, not a player's
lobby consent. No fabricated ready indicator is displayed. Ready/voting UX
requires a separate negotiated feature; see [VOTING_PLAN.md](VOTING_PLAN.md).

## Implementation and evidence

`port/linux/game/lobby_roster_model.c` is a bounded pure C model. It validates
machine/controller ranges, ignores invalid slots, clamps page offsets after
departures, clears stale rows, and terminates/sanitizes UTF-16 display names.
It never reads session pointers or sends traffic. The native adapter in
`lobby_roster.c` copies existing game data and draws with the existing small UI
font. `render_ui_widgets` gates it to the exact connected-pregame root and client
pregame state, excluding modal/keyboard/loading situations.

The production model compiled to freestanding WebAssembly with
`-Wall -Wextra -Werror` and passed **285 assertions**: every one of 128 slots
appears exactly once across pages, sparse/invalid entries, final/empty pages,
oversized counts and offsets, null input, bounded full-length names, control and
malformed UTF-16 filtering, FFA/team/local labels, stale-row clearing, departure
clamping, held-key edges and screen transitions. Canary values stayed intact.
These are display-model tests, not 128 live connections or active players.

The Windows target compiled and linked using the already approved toolchain
with a single build worker. No game was launched. **Visual layout, actual F8/
PgUp/PgDn routing, font clipping, widescreen/controller behavior and native mixed-
client acceptance remain untested** because the user is playing their live game.
The source checkout's build was updated; the live executable/settings were not.

```powershell
New-Item -ItemType Directory -Force build/lobby-tests | Out-Null
& '<LLVM_DIR>/bin/clang.exe' --target=wasm32-unknown-unknown -std=c11 -O2 -Wall -Wextra -Werror -ffreestanding -fno-builtin -nostdlib '-Wl,--no-entry' '-Wl,--export=run_roster_tests' '-Wl,--export=roster_test_checks' port/linux/game/lobby_roster_model.c tools/lobby/roster_test.c -o build/lobby-tests/roster.wasm
node tools/lobby/roster_test.mjs
```

## Pending idle-window acceptance

Native game tests stay paused until an idle window is established. Do not
automatically launch games or increase process counts during live play.

| Gate | Current status |
| --- | --- |
| Roster visual/input tests with isolated fixtures | Pending |
| Old/new client roster compatibility, unchanged direct invite/LAN play | Pending native confirmation; no wire changes |
| Paced-build malformed/expired-directory direct joins | Pending (disabled/unavailable passed before roster addition) |
| Post-pacing 16/32/64/128 protocol stages | Pending; only one host plus one idle stand-in profiled after pacing |
| Post-pacing larger active-player stages | Pending; only two real active games qualified |
| Sustained combat/vehicles/map rotation/WAN | Pending |

The earlier 16-connection protocol result predates pacing. It used idle
stand-ins, not 16 active players. No campaign co-op support is added here.
