#include "../../port/linux/game/lobby_vote_model.h"
static int checks;
#define CHECK(value) do { checks++; if (!(value)) return __LINE__; } while (0)
static struct lobby_vote_player players[LOBBY_VOTE_PLAYERS];
static struct lobby_vote_round round;
static unsigned char session[16] = { 1, 2, 3, 4 };
static struct lobby_ballot ballot, decoded;
static struct { unsigned before; unsigned char data[LOBBY_BALLOT_BYTES + 1]; unsigned after; } buffer;

static void fixture(void)
{
	int i;
	for (i = 0; i < 128; i++) {
		players[i].active = players[i].supported = players[i].can_vote = 1;
		players[i].machine = i; players[i].generation = (uint32_t)(100 + i);
		players[i].eligible_options = 255;
	}
	for (i = 0; i < 16; i++) ballot.session[i] = session[i];
	ballot.round = 7; ballot.revision = 9; ballot.generation = 100;
	ballot.player = ballot.option = 0; ballot.sequence = 1;
}
static int begin(int count, int options, unsigned mask)
{
	return lobby_vote_begin(&round, session, 7, 9, 2000, 5000, players, count, options, mask);
}
int vote_test_checks(void) { return checks; }
int run_vote_tests(void)
{
	int i;
	checks = 0; fixture();
	CHECK(begin(128, 8, 255));
	for (i = 0; i < 128; i++) {
		ballot.player = (unsigned)i; ballot.option = (unsigned)i % 8;
		ballot.generation = (uint32_t)(100 + i);
		CHECK(lobby_vote_cast(&round, &ballot, i, 9, 3000));
	}
	CHECK(lobby_vote_close(&round, 9, 255, 6999) == -1 && round.status == LOBBY_VOTE_OPEN);
	CHECK(lobby_vote_close(&round, 9, 255, 7000) == 0); /* 16 each: host candidate order wins tie */
	CHECK(lobby_vote_close(&round, 9, 255, 8000) == 0 && round.status == LOBBY_VOTE_CLOSED);
	CHECK(!lobby_vote_cast(&round, &ballot, 127, 9, 8000));
	CHECK(lobby_vote_close(&round, 10, 255, 8000) == -1 && round.status == LOBBY_VOTE_CANCELLED);
	fixture(); CHECK(begin(2, 8, 255));
	CHECK(lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.option = 7; ballot.sequence = 2;
	CHECK(lobby_vote_cast(&round, &ballot, 0, 9, 3100));
	CHECK(lobby_vote_cast(&round, &ballot, 0, 9, 3200)); /* duplicate is idempotent */
	ballot.option = 3;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3300)); /* equal sequence, conflicting choice */
	ballot.sequence = 1;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3400)); /* delayed older replacement */
	CHECK(round.ballots[0] == 7 && round.last_sequence[0] == 2);
	ballot.sequence = 0;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3500));
	ballot.sequence = UINT32_MAX; ballot.option = 7;
	CHECK(lobby_vote_cast(&round, &ballot, 0, 9, 3600));
	ballot.sequence = 1; ballot.option = 3;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3700)); /* wrap is not a new vote */
	CHECK(round.ballots[0] == 7 && round.last_sequence[0] == UINT32_MAX);
	CHECK(lobby_vote_close(&round, 9, 255, 7000) == 7);
	fixture(); CHECK(begin(2, 8, 255));
	CHECK(lobby_vote_close(&round, 9, 255, 7000) == -1 && round.status == LOBBY_VOTE_CLOSED); /* no ballots */
	fixture(); CHECK(begin(2, 8, 255));
	CHECK(!lobby_vote_cast(&round, &ballot, 1, 9, 3000)); /* unowned slot */
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 1999));
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 7000));
	ballot.generation++;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.generation--; ballot.round++;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.round--; ballot.revision++;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.revision--; ballot.session[15]++;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.session[15]--; ballot.player = 128;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.player = 0; ballot.option = 8;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.option = 0;
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 10, 3000) && round.status == LOBBY_VOTE_CANCELLED);
	fixture(); players[1].supported = 0;
	CHECK(!begin(2, 8, 255) && round.status == LOBBY_VOTE_DISABLED); /* legacy peer */
	players[1].active = 0;
	CHECK(begin(2, 8, 255));
	ballot.player = 1; ballot.generation = 101;
	CHECK(!lobby_vote_cast(&round, &ballot, 1, 9, 3000));
	fixture(); players[0].eligible_options = 3; players[1].eligible_options = 6;
	CHECK(begin(2, 8, 255) && round.eligible_options == 2);
	CHECK(!lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	ballot.option = 1;
	CHECK(lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	CHECK(lobby_vote_close(&round, 9, 0, 7000) == -1 && round.status == LOBBY_VOTE_CANCELLED);
	players[1].eligible_options = 4;
	CHECK(!begin(2, 8, 255)); /* no common installed-compatible option */
	fixture(); players[0].can_vote = players[1].can_vote = 0;
	CHECK(!begin(2, 8, 255)); /* stand-ins/spectators are not automatically voters */
	players[0].can_vote = 1;
	CHECK(begin(2, 8, 255));
	ballot.player = 1; ballot.generation = 101;
	CHECK(!lobby_vote_cast(&round, &ballot, 1, 9, 3000));
	fixture(); players[1].machine = 0;
	CHECK(begin(2, 8, 255)); /* two local players owned by one machine */
	ballot.player = 1; ballot.generation = 101;
	CHECK(lobby_vote_cast(&round, &ballot, 0, 9, 3000));
	lobby_vote_cancel(&round);
	CHECK(round.winner == -1 && round.ballots[1] == -1 && round.last_sequence[1] == 0);
	fixture();
	CHECK(!begin(0, 8, 255)); CHECK(!begin(129, 8, 255));
	CHECK(!begin(2, 0, 0)); CHECK(!begin(2, 9, 255));
	CHECK(!begin(2, 8, 0)); CHECK(!begin(2, 8, 256));
	CHECK(!lobby_vote_begin(&round, session, 7, 9, UINT64_MAX - 1, 5000, players, 2, 8, 255));
	CHECK(!lobby_vote_begin(&round, session, 7, 9, 0, 4999, players, 2, 8, 255));
	CHECK(!lobby_vote_begin(&round, session, 0, 9, 0, 5000, players, 2, 8, 255));
	CHECK(!lobby_vote_begin(&round, 0, 7, 9, 0, 5000, players, 2, 8, 255));
	players[0].machine = 128; CHECK(!begin(2, 8, 255));
	fixture(); players[0].generation = 0; CHECK(!begin(2, 8, 255));
	fixture(); players[0].eligible_options = 256; CHECK(!begin(2, 8, 255));
	fixture();
	buffer.before = 0x12345678; buffer.after = 0x87654321;
	ballot.round = 0x01020304; ballot.revision = 0x11223344;
	ballot.sequence = 0x10203040; ballot.generation = 0xA1B2C3D4; ballot.player = 127; ballot.option = 7;
	CHECK(lobby_ballot_encode(buffer.data, LOBBY_BALLOT_BYTES, &ballot));
	CHECK(buffer.data[24] == 1 && buffer.data[25] == 2 && buffer.data[26] == 3 && buffer.data[27] == 4);
	CHECK(buffer.data[33] == 127 && buffer.data[35] == 7 && buffer.data[36] == 0xA1 && buffer.data[39] == 0xD4);
	CHECK(lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES));
	CHECK(decoded.round == ballot.round && decoded.revision == ballot.revision && decoded.generation == ballot.generation && decoded.sequence == ballot.sequence);
	CHECK(buffer.data[40] == 0x10 && buffer.data[41] == 0x20 && buffer.data[42] == 0x30 && buffer.data[43] == 0x40);
	buffer.data[4] = 1; buffer.data[7] = 40;
	CHECK(!lobby_ballot_decode(&decoded, buffer.data, 40)); /* obsolete offline revision */
	CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES));
	CHECK(lobby_ballot_encode(buffer.data, LOBBY_BALLOT_BYTES, &ballot));
	CHECK(lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES));
	CHECK(decoded.player == 127 && decoded.option == 7 && decoded.session[0] == 1);
	for (i = 0; i < LOBBY_BALLOT_BYTES; i++) CHECK(!lobby_ballot_decode(&decoded, buffer.data, (unsigned)i));
	CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES + 1) && decoded.round == 0 && decoded.sequence == 0 && decoded.session[0] == 0);
	for (i = 0; i < 8; i++) {
		buffer.data[i] ^= 1;
		CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES));
		buffer.data[i] ^= 1;
	}
	buffer.data[32] = 1; CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES)); buffer.data[32] = 0;
	buffer.data[34] = 1; CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES)); buffer.data[34] = 0;
	buffer.data[33] = 128; CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES)); buffer.data[33] = 127;
	buffer.data[35] = 8; CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES)); buffer.data[35] = 7;
	for (i = 0; i < 4; i++) {
		int j, offset = i == 0 ? 24 : i == 1 ? 28 : i == 2 ? 36 : 40;
		CHECK(lobby_ballot_encode(buffer.data, LOBBY_BALLOT_BYTES, &ballot));
		for (j = 0; j < 4; j++) buffer.data[offset + j] = 0;
		CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES));
	}
	CHECK(lobby_ballot_encode(buffer.data, LOBBY_BALLOT_BYTES, &ballot));
	for (i = 0; i < 16; i++) buffer.data[8 + i] = 0;
	CHECK(!lobby_ballot_decode(&decoded, buffer.data, LOBBY_BALLOT_BYTES));
	CHECK(!lobby_ballot_encode(buffer.data, LOBBY_BALLOT_BYTES - 1, &ballot));
	CHECK(!lobby_ballot_decode(0, buffer.data, LOBBY_BALLOT_BYTES));
	ballot.sequence = 0;
	CHECK(!lobby_ballot_encode(buffer.data, LOBBY_BALLOT_BYTES, &ballot));
	CHECK(!lobby_vote_cast(0, &ballot, 0, 9, 3000));
	CHECK(lobby_vote_close(0, 9, 255, 7000) == -1);
	lobby_vote_cancel(0);
	CHECK(buffer.before == 0x12345678 && buffer.after == 0x87654321);
	return 0;
}
