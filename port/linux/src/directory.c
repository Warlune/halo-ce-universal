/* Experimental native -> loopback directory bridge. No public-network endpoint
is accepted. A future public service needs authenticated HTTPS and review.
Only this worker does HTTP; the game supplies copied metadata through p2p.c. */
#include "platform.h"
#include "posix.h"
#include "p2p_internal.h"
#include "directory.h"
#include <stdio.h>
#include <string.h>

static pthread_mutex_t directory_lock = PTHREAD_MUTEX_INITIALIZER;
static struct
{
	int started, stop, done;
	unsigned short port;
	char id[37], key[65], name[81];
} directory;

static int hex_character(char c)
{
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
}

static int safe_text(const char *text, int maximum, int spaces)
{
	int i;
	if (!text || !*text) return 0;
	for (i = 0; text[i]; i++)
		if (i >= maximum || !((text[i] >= 'a' && text[i] <= 'z') ||
			(text[i] >= 'A' && text[i] <= 'Z') || (text[i] >= '0' && text[i] <= '9') ||
			text[i] == '_' || text[i] == '-' || (spaces && (text[i] == ' ' || text[i] == '.')))) return 0;
	return 1;
}

static int ready(int socket, int writing, unsigned long started)
{
	while (p2p_now() - started < 2000)
	{
		int read = socket, write = socket, error = socket;
		int nr = !writing, nw = writing, ne = 1;
		int result = posix_socket_select(&read, &nr, &write, &nw, &error, &ne, 0, 100000, 0);
		if (result < 0 || ne) return 0;
		if (nr || nw) return 1;
	}
	return 0;
}

static int request(const struct p2p_host_snapshot *snapshot)
{
	char body[512], message[1024], response[1024];
	struct sockaddr_in address;
	int socket = -1, length, sent = 0, received = 0, status = 0, error = 0, error_size = sizeof(error);
	unsigned long started = p2p_now();
	body[0] = 0;
	if (snapshot)
	{
		const char *map = snapshot->map, *cursor;
		for (cursor = map; *cursor; cursor++) if (*cursor == '/' || *cursor == '\\') map = cursor + 1;
		if (!safe_text(map, 63, 0)) return 0;
		length = snprintf(body, sizeof(body),
			"{\"name\":\"%s\",\"map\":\"%s\",\"players\":%d,\"maxPlayers\":%d,"
			"\"build\":\"native-prototype\",\"systemLinkVersion\":%d,\"netcodeVersion\":%d,"
			"\"state\":\"%s\",\"invite\":\"%s\"}",
			directory.name, map, snapshot->player_count, snapshot->maximum_players,
			HALO_PORT_NETWORK_GAME_MESSAGE_VERSION, HALO_PORT_NETWORK_VERSION,
			snapshot->state == 1 ? "lobby" : "playing", snapshot->invite);
		if (length < 0 || length >= (int)sizeof(body)) return 0;
	}
	length = snprintf(message, sizeof(message),
		"%s /v1/listings/%s HTTP/1.1\r\nHost: 127.0.0.1:%u\r\nAuthorization: Bearer %s\r\n"
		"Content-Type: application/json\r\nContent-Length: %u\r\nConnection: close\r\n\r\n%s",
		snapshot ? "PUT" : "DELETE", directory.id, directory.port, directory.key, (unsigned)strlen(body), body);
	if (length < 0 || length >= (int)sizeof(message)) return 0;
	memset(&address, 0, sizeof(address));
	address.sin_family = AF_INET;
	address.sin_addr.s_addr = __builtin_bswap32(0x7f000001);
	address.sin_port = (unsigned short)(directory.port << 8 | directory.port >> 8);
	socket = posix_socket(AF_INET, SOCK_STREAM, 0);
	if (socket < 0) return 0;
	if (posix_socket_set_nonblocking(socket, 1) < 0) goto done;
	if (posix_socket_connect(socket, &address, sizeof(address)) < 0 && !ready(socket, 1, started)) goto done;
	/* The socket bridge accepts Xbox/Winsock option numbers on every platform. */
	if (posix_socket_getsockopt(socket, SOL_SOCKET, 0x1007 /* SO_ERROR */, &error, &error_size) < 0 || error) goto done;
	while (sent < length)
	{
		int count;
		if (!ready(socket, 1, started)) goto done;
		count = posix_socket_send(socket, message + sent, length - sent, 0);
		if (count <= 0) goto done;
		sent += count;
	}
	while (received < (int)sizeof(response) - 1)
	{
		int count;
		if (!ready(socket, 0, started)) goto done;
		count = posix_socket_recv(socket, response + received, sizeof(response) - 1 - received, 0);
		if (count <= 0) goto done;
		received += count;
		response[received] = 0;
		if (strstr(response, "\r\n\r\n"))
		{
			if (sscanf(response, "HTTP/1.%*d %d", &status) != 1) status = 0;
			break;
		}
	}
done:
	posix_socket_close(socket);
	/* Never follow redirects or log a response, bearer credential or invite. */
	return status == 200;
}

static int stopping(void)
{
	int stop;
	pthread_mutex_lock(&directory_lock);
	stop = directory.stop;
	pthread_mutex_unlock(&directory_lock);
	return stop;
}

static void *worker(void *unused)
{
	struct p2p_host_snapshot previous = { 0 }, snapshot;
	int registered = 0, failed = 0;
	unsigned long last_attempt = 0;
	(void)unused;
	while (!stopping())
	{
		int available = p2p_get_host_snapshot(1, &snapshot);
		unsigned long now = p2p_now();
		int changed = available && (!registered || memcmp(&snapshot, &previous, sizeof(snapshot)));
		if ((!failed || now - last_attempt >= 3000) &&
			((available && (changed || now - last_attempt >= 15000)) || (!available && registered)))
		{
			int success;
			last_attempt = now;
			/* An ambiguous PUT must still be withdrawn after a later stop. */
			if (available) registered = 1;
			success = request(available ? &snapshot : NULL);
			if (success)
			{
				registered = available;
				if (available) previous = snapshot;
			}
			if (!success && !failed) platform_log("Directory: local update failed; will retry");
			failed = !success;
		}
		Sleep(250);
	}
	if (registered) request(NULL);
	pthread_mutex_lock(&directory_lock);
	directory.done = 1;
	pthread_mutex_unlock(&directory_lock);
	return NULL;
}

static void shutdown_directory(void)
{
	unsigned long started = p2p_now();
	pthread_mutex_lock(&directory_lock);
	directory.stop = 1;
	pthread_mutex_unlock(&directory_lock);
	while (p2p_now() - started < 4500)
	{
		int done;
		pthread_mutex_lock(&directory_lock);
		done = directory.done;
		pthread_mutex_unlock(&directory_lock);
		if (done) break;
		Sleep(10);
	}
	/* If shutdown cannot withdraw, the short lease expires the listing. */
}

void directory_initialize(void)
{
	const char *opt_in = getenv("HALO_DIRECTORY_PUBLIC");
	const char *url = getenv("HALO_DIRECTORY_URL"), *id = getenv("HALO_DIRECTORY_ID");
	const char *key = getenv("HALO_DIRECTORY_KEY"), *name = getenv("HALO_DIRECTORY_NAME");
	char *end;
	unsigned long port;
	int i;
	pthread_t thread;
	if (!opt_in || strcmp(opt_in, "1") || directory.started) return;
	if (!url || strncmp(url, "http://127.0.0.1:", 17) || !id || strlen(id) != 36 ||
		!key || strlen(key) != 64 || !safe_text(name, 80, 1)) goto invalid;
	if (url[17] < '0' || url[17] > '9') goto invalid;
	port = strtoul(url + 17, &end, 10);
	if (port < 1 || port > 65535 || end == url + 17 || *end) goto invalid;
	for (i = 0; i < 64; i++) if (!hex_character(key[i])) goto invalid;
	for (i = 0; i < 36; i++)
		if (i == 8 || i == 13 || i == 18 || i == 23) { if (id[i] != '-') goto invalid; }
		else if (!hex_character(id[i])) goto invalid;
	if (id[14] != '4' || !strchr("89ab", id[19])) goto invalid;
	directory.port = (unsigned short)port;
	strcpy(directory.id, id); strcpy(directory.key, key); strcpy(directory.name, name);
	if (pthread_create(&thread, NULL, worker, NULL) != 0) return;
	pthread_detach(thread);
	directory.started = 1;
	atexit(shutdown_directory);
	platform_log("Directory: explicitly enabled local test registration");
	return;
invalid:
	platform_log("Directory: invalid opt-in configuration; registration disabled");
}
