/* Freestanding contract fixture, not the game or a threading test. The runner
inserts the actual getter from p2p.c at the marker below, without rewriting it.
This uses the production headers and instrumented memory/mutex stand-ins. */
#include "p2p_internal.h"

typedef __SIZE_TYPE__ size_t;
static int p2p_lock;
static int locks, lock_depth, violations;
static struct
{
	int running, hosting, hosting_socket, has_token;
	int game_player_count, game_player_maximum;
	int game_host_state;
	char game_host_map[64];
	char invite[P2P_LINK_SIZE];
} p2p;

void *memset(void *destination, int value, size_t count)
{
	unsigned char *out = destination;
	while (count--) *out++ = (unsigned char)value;
	return destination;
}
void *memcpy(void *destination, const void *source, size_t count)
{
	unsigned char *out = destination;
	const unsigned char *in = source;
	if (lock_depth != 1) violations++;
	while (count--) *out++ = *in++;
	return destination;
}
int pthread_mutex_lock(int *mutex)
{
	if (mutex != &p2p_lock || lock_depth != 0) violations++;
	lock_depth++;
	locks++;
	return 0;
}
int pthread_mutex_unlock(int *mutex)
{
	if (mutex != &p2p_lock || lock_depth != 1) violations++;
	lock_depth--;
	return 0;
}

/* PRODUCTION_SNAPSHOT_FUNCTION */

static void valid_host(void)
{
	static const char prefix[] = "halo://join/";
	int index;
	memset(&p2p, 0, sizeof(p2p));
	p2p.running = p2p.hosting = p2p.has_token = 1;
	p2p.hosting_socket = 4;
	p2p.game_player_count = 1;
	p2p.game_player_maximum = 128;
	p2p.game_host_state = 1;
	p2p.game_host_map[0] = 'm';
	for (index = 0; index < 12; index++) p2p.invite[index] = prefix[index];
	for (; index < 76; index++) p2p.invite[index] = 'a';
}

static int cleared(struct p2p_host_snapshot *snapshot)
{
	const unsigned char *bytes = (const unsigned char *)snapshot;
	size_t index;
	for (index = 0; index < sizeof(*snapshot); index++)
		if (bytes[index] != 0) return 0;
	return 1;
}

int run_snapshot_tests(void)
{
	struct p2p_host_snapshot snapshot;
	int index, before;
	valid_host();
	if (p2p_get_host_snapshot(1, 0) != 0 || locks != 0) return 1;
	for (index = -1; index <= 2; index++)
	{
		if (index == 1) continue;
		memset(&snapshot, 0x7f, sizeof(snapshot));
		if (p2p_get_host_snapshot(index, &snapshot) != 0 || !cleared(&snapshot) || locks != 0) return 2;
	}
	for (index = 0; index < 12; index++)
	{
		valid_host();
		switch (index)
		{
		case 0: p2p.running = 0; break;
		case 1: p2p.hosting = 0; break;
		case 2: p2p.hosting_socket = -1; break;
		case 3: p2p.has_token = 0; break;
		case 4: p2p.game_player_maximum = 0; break;
		case 5: p2p.game_player_maximum = -1; break;
		case 6: p2p.game_player_maximum = 129; break;
		case 7: p2p.game_player_count = -1; break;
		case 8: p2p.game_player_count = 129; break;
		case 9: p2p.game_host_state = 0; break;
		case 10: p2p.game_host_state = 3; break;
		case 11: p2p.game_host_map[0] = 0; break;
		}
		memset(&snapshot, 0x7f, sizeof(snapshot));
		before = locks;
		if (p2p_get_host_snapshot(1, &snapshot) != 0 || !cleared(&snapshot) || locks != before + 1) return 10 + index;
	}
	for (index = 0; index <= 128; index++)
	{
		valid_host();
		p2p.game_player_count = index;
		before = locks;
		if (p2p_get_host_snapshot(1, &snapshot) != 1 || locks != before + 1) return 30;
		if (snapshot.player_count != index || snapshot.maximum_players != 128) return 31;
		if (snapshot.state != 1 || snapshot.map[0] != 'm') return 34;
		if (snapshot.invite[0] != 'h' || snapshot.invite[75] != 'a' || snapshot.invite[76] != 0) return 32;
		p2p.invite[12] = 'b';
		if (snapshot.invite[12] != 'a') return 33;
	}
	valid_host();
	p2p.game_host_state = 2;
	if (!p2p_get_host_snapshot(1, &snapshot) || snapshot.state != 2) return 35;
	valid_host();
	p2p.game_player_maximum = 1;
	if (p2p_get_host_snapshot(1, &snapshot) != 1 || snapshot.maximum_players != 1) return 40;
	p2p.game_player_count = 2;
	if (p2p_get_host_snapshot(1, &snapshot) != 0 || !cleared(&snapshot)) return 41;
	if (lock_depth != 0 || violations != 0) return 50;
	return 0;
}
