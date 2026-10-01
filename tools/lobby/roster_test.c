#include "../../port/linux/game/lobby_roster_model.h"

static int checks;
#define CHECK(value) do { checks++; if (!(value)) return __LINE__; } while (0)
static struct lobby_roster_entry entries[LOBBY_ROSTER_LIMIT];
static struct { unsigned before; struct lobby_roster_model model; unsigned after; } guarded;
static int seen[LOBBY_ROSTER_LIMIT];

int roster_test_checks(void) { return checks; }

int run_roster_tests(void)
{
	struct lobby_roster_model *model = &guarded.model;
	struct lobby_roster_view view = { 0, 0, 0 };
	int i, j, offset;
	checks = 0;
	guarded.before = 0x12345678; guarded.after = 0x87654321;
	for (i = 0; i < LOBBY_ROSTER_LIMIT; i++) {
		entries[i].valid = 1; entries[i].machine = i;
		entries[i].controller = i % 4; entries[i].team = i % 2;
		for (j = 0; j < LOBBY_ROSTER_NAME; j++) entries[i].name[j] = 'A' + i % 26;
		seen[i] = 0;
	}
	lobby_roster_build(model, entries, 128, 127, 1, 0);
	CHECK(model->count == 128 && model->rows[127].local && !model->rows[0].local);
	CHECK(model->rows[0].team == 0 && model->rows[127].team == 1);
	for (offset = 0; ; offset = lobby_roster_page_offset(model->count, offset, 1)) {
		for (i = offset; i < model->count && i < offset + LOBBY_ROSTER_PAGE; i++) seen[model->rows[i].slot]++;
		if (offset == lobby_roster_page_offset(model->count, offset, 1)) break;
	}
	CHECK(offset == 120);
	for (i = 0; i < 128; i++) {
		CHECK(seen[i] == 1);
		CHECK(model->rows[i].name[12] == 0);
	}
	CHECK(lobby_roster_page_offset(128, 2147483647, 2147483647) == 120);
	CHECK(lobby_roster_page_offset(-1, -2147483647, -2147483647) == 0);
	CHECK(lobby_roster_page_offset(13, 120, 0) == 12);
	CHECK(lobby_roster_page_offset(12, 12, 0) == 0);
	CHECK(lobby_roster_page_offset(129, 120, 1) == 120);
	entries[0].valid = 0; entries[1].machine = -1; entries[2].machine = 128;
	entries[3].controller = -1; entries[4].controller = 4;
	entries[5].team = 77;
	lobby_roster_build(model, entries, 129, -1, 1, 120);
	CHECK(model->count == 123 && model->rows[0].slot == 5 && model->rows[0].team == -1);
	CHECK(!model->rows[0].local && guarded.before == 0x12345678 && guarded.after == 0x87654321);
	entries[5].name[0] = '\n'; entries[5].name[1] = '\t'; entries[5].name[2] = 0x202E;
	entries[5].name[3] = 0xD800; entries[5].name[4] = 0x2066;
	entries[5].name[5] = '%'; entries[5].name[6] = 0x03A9; entries[5].name[7] = 0;
	lobby_roster_build(model, entries, 6, 5, 0, 120);
	CHECK(model->count == 1 && model->offset == 0 && model->rows[0].team == -2);
	for (i = 0; i < 5; i++) CHECK(model->rows[0].name[i] == '?');
	CHECK(model->rows[0].name[5] == '%' && model->rows[0].name[6] == 0x03A9 && model->rows[0].name[7] == 0);
	CHECK(model->rows[1].name[0] == 0 && model->rows[127].slot == -1);
	lobby_roster_build(model, 0, 128, 0, 1, 12);
	CHECK(model->count == 0 && model->offset == 0 && model->rows[0].name[0] == 0);
	lobby_roster_build(0, entries, 128, 0, 1, 0);
	lobby_roster_build(model, entries, -1, 0, 1, 0);
	CHECK(model->count == 0);
	lobby_roster_view_update(&view, 1, 1, 0, 0, 128);
	CHECK(view.open);
	lobby_roster_view_update(&view, 1, 1, 0, 1, 128);
	CHECK(view.open && view.offset == 12);
	lobby_roster_view_update(&view, 1, 1, 0, 1, 128);
	CHECK(view.open && view.offset == 12); /* held keys never auto-repeat */
	lobby_roster_view_update(&view, 1, 0, 0, 0, 128);
	lobby_roster_view_update(&view, 1, 0, 1, 1, 128);
	CHECK(view.offset == 0);
	view.offset = 120;
	lobby_roster_view_update(&view, 1, 0, 0, 0, 2);
	CHECK(view.offset == 0); /* players departed */
	lobby_roster_view_update(&view, 0, 1, 0, 0, 128);
	CHECK(!view.open && view.offset == 0);
	lobby_roster_view_update(&view, 1, 1, 0, 0, 128);
	CHECK(!view.open); /* held key across screen transition */
	lobby_roster_view_update(&view, 1, 0, 0, 0, 128);
	lobby_roster_view_update(&view, 1, 1, 0, 0, 128);
	CHECK(view.open);
	lobby_roster_view_update(0, 1, 1, 1, 1, 128);
	CHECK(guarded.before == 0x12345678 && guarded.after == 0x87654321);
	return 0;
}
