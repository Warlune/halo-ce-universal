/* Read-only connected-pregame overlay; uses existing session data and fonts.
   No packets, ready state, voting, persistent preferences or asset changes. */
#include "cseries.h"
#include "interface/lobby_roster.h"
#include "lobby_roster_model.h"
#include "networking/network_game_manager.h"
#include "networking/network_game_globals.h"
#include "input/input.h"
#include "cutscene/cinematics.h"
#include "rasterizer/rasterizer.h"
#include "tag_files/tag_groups.h"
#include "text/draw_string.h"
#include "text/unicode.h"

static struct lobby_roster_view roster_view;
static struct lobby_roster_model roster;
static struct lobby_roster_entry entries[LOBBY_ROSTER_LIMIT];
typedef char lobby_roster_capacity_check[HALO_PORT_MAXIMUM_NETWORK_PLAYERS == LOBBY_ROSTER_LIMIT ? 1 : -1];
typedef char lobby_roster_wchar_check[sizeof(wchar_t) == sizeof(unsigned short) ? 1 : -1];

void lobby_roster_update(int active)
{
	struct network_game *game = active ? network_game_get_game() : NULL;
	int i, j;
	if (game) {
		for (i = 0; i < LOBBY_ROSTER_LIMIT; i++) {
			const struct network_player *player = &game->players[i];
			entries[i].valid = 1; /* The pure model validates machine/controller bounds. */
			entries[i].machine = player->machine_index;
			entries[i].controller = player->controller_index;
			entries[i].team = player->team_index;
			for (j = 0; j < LOBBY_ROSTER_NAME; j++) entries[i].name[j] = player->name[j];
		}
		lobby_roster_build(&roster, entries, LOBBY_ROSTER_LIMIT,
			network_game_client_get_local_machine_index(), game->variant.universal_variant.teams, roster_view.offset);
	}
	lobby_roster_view_update(&roster_view, game != NULL,
		input_key_is_down(_key_f8), input_key_is_down(_key_page_up), input_key_is_down(_key_page_down), game ? roster.count : 0);
	roster.offset = roster_view.offset;
}

static void roster_text(short x, short y, short right, const wchar_t *text)
{
	rectangle2d bounds = { y, x, (short)(y + 22), right };
	rasterizer_draw_unicode_string(&bounds, &bounds, NULL, 0, text);
}

void lobby_roster_render(void)
{
	real_argb_color color = { 1.0f, 1.0f, 1.0f, 1.0f };
	long font = tag_loaded('font', "ui\\small_ui");
	wchar_t text[80];
	int i, end;
	rectangle2d panel;
	if (font == NONE) return;
	draw_string_set_draw_mode(font, NONE, 0, 0, &color);
	draw_string_set_indents(0, 0);
	if (!roster_view.open) {
		panel.y0 = 8; panel.x0 = 408; panel.y1 = 30; panel.x1 = 624;
		draw_quad(&panel, 0xD0101824);
		usnprintf(text, NUMBEROF(text), L"F8: Players (%d)", roster.count);
		roster_text(418, 8, 618, text);
		return;
	}
	panel.y0 = 48; panel.x0 = 32; panel.y1 = 438; panel.x1 = 608;
	draw_quad(&panel, 0xF0101824);
	end = MIN(roster.count, roster.offset + LOBBY_ROSTER_PAGE);
	usnprintf(text, NUMBEROF(text), L"Players %d-%d of %d", roster.count ? roster.offset + 1 : 0, end, roster.count);
	roster_text(48, 62, 592, text);
	roster_text(48, 94, 330, L"Player");
	roster_text(350, 94, 454, L"Team");
	roster_text(470, 94, 592, L"Connection");
	for (i = roster.offset; i < end; i++) {
		const struct lobby_roster_row *row = &roster.rows[i];
		short y = (short)(120 + (i - roster.offset) * 22);
		usnprintf(text, NUMBEROF(text), L"%d. %ls", row->slot + 1,
			row->name[0] ? (const wchar_t *)row->name : L"(unnamed)");
		roster_text(48, y, 334, text);
		roster_text(350, y, 460, row->team == -2 ? L"FFA" : row->team == 0 ? L"Red" : row->team == 1 ? L"Blue" : L"Unassigned");
		roster_text(470, y, 592, row->local ? L"Local" : L"Remote");
	}
	usnprintf(text, NUMBEROF(text), L"Page %d/%d   F8 close   PgUp/PgDn pages",
		roster.offset / LOBBY_ROSTER_PAGE + 1, MAX(1, (roster.count + LOBBY_ROSTER_PAGE - 1) / LOBBY_ROSTER_PAGE));
	roster_text(48, 405, 592, text);
}
