#include "lobby_roster_model.h"

int lobby_roster_page_offset(int count, int offset, int direction)
{
	int last;
	if (count < 0) count = 0;
	if (count > LOBBY_ROSTER_LIMIT) count = LOBBY_ROSTER_LIMIT;
	last = count ? ((count - 1) / LOBBY_ROSTER_PAGE) * LOBBY_ROSTER_PAGE : 0;
	if (offset < 0) offset = 0;
	if (offset > last) offset = last;
	offset -= offset % LOBBY_ROSTER_PAGE;
	if (direction > 0 && offset < last) offset += LOBBY_ROSTER_PAGE;
	if (direction < 0 && offset > 0) offset -= LOBBY_ROSTER_PAGE;
	return offset;
}

void lobby_roster_build(struct lobby_roster_model *out,
	const struct lobby_roster_entry *entries, int count, int local_machine, int teams, int offset)
{
	int i, j;
	if (!out) return;
	out->count = out->offset = 0;
	/* Clear removed rows as well: no stale display names after departure. */
	for (i = 0; i < LOBBY_ROSTER_LIMIT; i++) {
		out->rows[i].slot = out->rows[i].team = -1;
		out->rows[i].local = 0;
		for (j = 0; j <= LOBBY_ROSTER_NAME; j++) out->rows[i].name[j] = 0;
	}
	if (!entries || count < 0) return;
	if (count > LOBBY_ROSTER_LIMIT) count = LOBBY_ROSTER_LIMIT;
	for (i = 0; i < count; i++) {
		const struct lobby_roster_entry *entry = &entries[i];
		struct lobby_roster_row *row;
		if (!entry->valid || entry->machine < 0 || entry->machine >= LOBBY_ROSTER_LIMIT ||
			entry->controller < 0 || entry->controller >= 4) continue;
		row = &out->rows[out->count++];
		row->slot = i;
		row->team = !teams ? -2 : entry->team == 0 || entry->team == 1 ? entry->team : -1;
		row->local = entry->machine == local_machine;
		for (j = 0; j < LOBBY_ROSTER_NAME && entry->name[j]; j++) {
			unsigned short c = entry->name[j];
			/* Prevent newlines, icon control bytes, bidi controls and malformed
			UTF-16 from changing the row's presentation. Never treat names as format strings. */
			row->name[j] = c < 32 || (c >= 127 && c <= 159) ||
				(c >= 0xD800 && c <= 0xDFFF) || (c >= 0x202A && c <= 0x202E) ||
				(c >= 0x2066 && c <= 0x2069) || c >= 0xFFFE ? '?' : c;
		}
	}
	out->offset = lobby_roster_page_offset(out->count, offset, 0);
}

void lobby_roster_view_update(struct lobby_roster_view *view, int active,
	int toggle, int previous, int next, int count)
{
	int keys = (!!toggle) | ((!!previous) << 1) | ((!!next) << 2);
	if (!view) return;
	if (!active) { view->open = view->offset = 0; view->keys = keys; return; }
	if ((keys & 1) && !(view->keys & 1)) view->open = !view->open;
	view->offset = lobby_roster_page_offset(count, view->offset, 0);
	if (view->open) {
		if ((keys & 2) && !(view->keys & 2)) view->offset = lobby_roster_page_offset(count, view->offset, -1);
		else if ((keys & 4) && !(view->keys & 4)) view->offset = lobby_roster_page_offset(count, view->offset, 1);
	}
	view->keys = keys;
}
