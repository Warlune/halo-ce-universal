#include "lobby_vote_model.h"

static int session_valid(const unsigned char *session)
{
	int i;
	if (!session) return 0;
	for (i = 0; i < 16; i++) if (session[i]) return 1;
	return 0;
}
static int session_equal(const unsigned char *a, const unsigned char *b)
{
	int i;
	for (i = 0; i < 16; i++) if (a[i] != b[i]) return 0;
	return 1;
}
void lobby_vote_cancel(struct lobby_vote_round *round)
{
	int i;
	if (!round) return;
	round->status = LOBBY_VOTE_CANCELLED; round->winner = -1;
	for (i = 0; i < LOBBY_VOTE_PLAYERS; i++) round->ballots[i] = -1;
}
int lobby_vote_begin(struct lobby_vote_round *out, const unsigned char session[16],
	uint32_t round, uint32_t revision, uint64_t now, unsigned duration_ms,
	const struct lobby_vote_player *players, int count, int options, unsigned host_eligible)
{
	int i, voters = 0;
	unsigned allowed, common;
	if (!out) return 0;
	lobby_vote_cancel(out); out->status = LOBBY_VOTE_DISABLED;
	if (!session_valid(session) || !round || !revision || !players || count < 1 || count > LOBBY_VOTE_PLAYERS ||
		options < 1 || options > LOBBY_VOTE_OPTIONS || duration_ms < 5000 || duration_ms > 60000 ||
		now > UINT64_MAX - duration_ms) return 0;
	allowed = (1u << options) - 1;
	if (!host_eligible || (host_eligible & ~allowed)) return 0;
	common = host_eligible;
	for (i = 0; i < count; i++) {
		const struct lobby_vote_player *player = &players[i];
		if (!player->active) continue;
		if (player->active != 1 || player->machine < 0 || player->machine >= LOBBY_VOTE_PLAYERS ||
			player->supported != 1 || !player->generation || (player->can_vote != 0 && player->can_vote != 1) ||
			(player->eligible_options & ~allowed)) return 0;
		common &= player->eligible_options;
		voters += player->can_vote;
	}
	if (!voters || !common) return 0;
	for (i = 0; i < 16; i++) out->session[i] = session[i];
	for (i = 0; i < count; i++) out->players[i] = players[i];
	out->round = round; out->revision = revision; out->opened = now;
	out->deadline = now + duration_ms; out->count = count; out->options = options;
	out->eligible_options = common; out->status = LOBBY_VOTE_OPEN;
	return 1;
}
int lobby_vote_cast(struct lobby_vote_round *round, const struct lobby_ballot *ballot,
	int authenticated_machine, uint32_t current_revision, uint64_t now)
{
	const struct lobby_vote_player *player;
	if (!round || round->status != LOBBY_VOTE_OPEN) return 0;
	if (current_revision != round->revision) { lobby_vote_cancel(round); return 0; }
	if (!ballot || now < round->opened || now >= round->deadline || authenticated_machine < 0 ||
		authenticated_machine >= LOBBY_VOTE_PLAYERS || ballot->player >= (unsigned)round->count ||
		ballot->option >= (unsigned)round->options || !(round->eligible_options & (1u << ballot->option)) ||
		ballot->round != round->round || ballot->revision != round->revision ||
		!session_equal(ballot->session, round->session)) return 0;
	player = &round->players[ballot->player];
	if (!player->active || !player->can_vote || player->machine != authenticated_machine ||
		ballot->generation != player->generation) return 0;
	round->ballots[ballot->player] = (int)ballot->option; /* replace own ballot, never add a second */
	return 1;
}
int lobby_vote_close(struct lobby_vote_round *round, uint32_t current_revision,
	unsigned current_eligible, uint64_t now)
{
	int totals[LOBBY_VOTE_OPTIONS] = { 0 }, i, best = 0;
	if (!round || (round->status != LOBBY_VOTE_OPEN && round->status != LOBBY_VOTE_CLOSED)) return -1;
	if (current_revision != round->revision || current_eligible != round->eligible_options) {
		lobby_vote_cancel(round); return -1;
	}
	if (round->status == LOBBY_VOTE_CLOSED) return round->winner;
	if (now < round->deadline) return -1;
	for (i = 0; i < round->count; i++) if (round->ballots[i] >= 0) totals[round->ballots[i]]++;
	for (i = 0; i < round->options; i++) if (totals[i] > best) { best = totals[i]; round->winner = i; }
	round->status = LOBBY_VOTE_CLOSED;
	return round->winner; /* -1: abstentions retain current host selection; ties use candidate order */
}

static int ballot_valid(const struct lobby_ballot *ballot)
{
	return ballot && session_valid(ballot->session) && ballot->round && ballot->revision && ballot->generation &&
		ballot->player < LOBBY_VOTE_PLAYERS && ballot->option < LOBBY_VOTE_OPTIONS;
}
static void write32(unsigned char *p, uint32_t value)
{
	p[0] = (unsigned char)(value >> 24); p[1] = (unsigned char)(value >> 16);
	p[2] = (unsigned char)(value >> 8); p[3] = (unsigned char)value;
}
static uint32_t read32(const unsigned char *p)
{
	return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}
int lobby_ballot_encode(unsigned char *out, unsigned size, const struct lobby_ballot *ballot)
{
	int i;
	if (!out || size != LOBBY_BALLOT_BYTES || !ballot_valid(ballot)) return 0;
	out[0] = 'H'; out[1] = 'V'; out[2] = 'O'; out[3] = 'T';
	out[4] = 1; out[5] = 0; out[6] = 0; out[7] = LOBBY_BALLOT_BYTES;
	for (i = 0; i < 16; i++) out[8 + i] = ballot->session[i];
	write32(out + 24, ballot->round); write32(out + 28, ballot->revision);
	out[32] = 0; out[33] = (unsigned char)ballot->player;
	out[34] = 0; out[35] = (unsigned char)ballot->option;
	write32(out + 36, ballot->generation);
	return 1;
}
int lobby_ballot_decode(struct lobby_ballot *out, const unsigned char *data, unsigned size)
{
	struct lobby_ballot value;
	int i;
	if (!out) return 0;
	for (i = 0; i < 16; i++) out->session[i] = 0;
	out->round = out->revision = out->generation = out->player = out->option = 0;
	if (!data || size != LOBBY_BALLOT_BYTES || data[0] != 'H' || data[1] != 'V' ||
		data[2] != 'O' || data[3] != 'T' || data[4] != 1 || data[5] || data[6] ||
		data[7] != LOBBY_BALLOT_BYTES || data[32] || data[34]) return 0;
	for (i = 0; i < 16; i++) value.session[i] = data[8 + i];
	value.round = read32(data + 24); value.revision = read32(data + 28);
	value.player = data[33]; value.option = data[35]; value.generation = read32(data + 36);
	if (!ballot_valid(&value)) return 0;
	*out = value;
	return 1;
}
