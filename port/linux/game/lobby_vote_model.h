#ifndef HALO_LOBBY_VOTE_MODEL_H
#define HALO_LOBBY_VOTE_MODEL_H
#include <stdint.h>

/* Pure prototype, not connected to game UI, sockets or existing packet IDs.
   The host adapter must derive ownership/capability/eligibility from its own
   session state. The codec below is a test contract, not an enabled protocol. */
enum { LOBBY_VOTE_PLAYERS = 128, LOBBY_VOTE_OPTIONS = 8, LOBBY_BALLOT_BYTES = 44 };
enum { LOBBY_VOTE_DISABLED, LOBBY_VOTE_OPEN, LOBBY_VOTE_CLOSED, LOBBY_VOTE_CANCELLED };
struct lobby_vote_player {
	int active, machine, supported, can_vote;
	uint32_t generation;
	unsigned eligible_options;
};
struct lobby_ballot {
	unsigned char session[16];
	uint32_t round, revision, generation, sequence;
	unsigned player, option;
};
struct lobby_vote_round {
	unsigned char session[16];
	uint32_t round, revision;
	uint64_t opened, deadline;
	unsigned eligible_options;
	int status, winner, count, options;
	struct lobby_vote_player players[LOBBY_VOTE_PLAYERS];
	int ballots[LOBBY_VOTE_PLAYERS];
	uint32_t last_sequence[LOBBY_VOTE_PLAYERS];
};

int lobby_vote_begin(struct lobby_vote_round *out, const unsigned char session[16],
	uint32_t round, uint32_t revision, uint64_t now, unsigned duration_ms,
	const struct lobby_vote_player *players, int count, int options, unsigned host_eligible);
int lobby_vote_cast(struct lobby_vote_round *round, const struct lobby_ballot *ballot,
	int authenticated_machine, uint32_t current_revision, uint64_t now);
int lobby_vote_close(struct lobby_vote_round *round, uint32_t current_revision,
	unsigned current_eligible, uint64_t now);
void lobby_vote_cancel(struct lobby_vote_round *round);
int lobby_ballot_encode(unsigned char *out, unsigned size, const struct lobby_ballot *ballot);
int lobby_ballot_decode(struct lobby_ballot *out, const unsigned char *data, unsigned size);
#endif
