#ifndef HALO_LOBBY_ROSTER_MODEL_H
#define HALO_LOBBY_ROSTER_MODEL_H

/* Pure display model. No game/network dependencies or mutable session state. */
enum { LOBBY_ROSTER_LIMIT = 128, LOBBY_ROSTER_NAME = 12, LOBBY_ROSTER_PAGE = 12 };
struct lobby_roster_entry {
	unsigned short name[LOBBY_ROSTER_NAME];
	int valid, machine, controller, team;
};
struct lobby_roster_row {
	unsigned short name[LOBBY_ROSTER_NAME + 1];
	int slot, team, local;
};
struct lobby_roster_model {
	struct lobby_roster_row rows[LOBBY_ROSTER_LIMIT];
	int count, offset;
};
struct lobby_roster_view { int open, offset, keys; };

void lobby_roster_build(struct lobby_roster_model *out,
	const struct lobby_roster_entry *entries, int count, int local_machine, int teams, int offset);
int lobby_roster_page_offset(int count, int offset, int direction);
void lobby_roster_view_update(struct lobby_roster_view *view, int active,
	int toggle, int previous, int next, int count);

#endif
