/* A supervisor owns this anonymous input pipe, not a global port or PID file.
Disabled unless HALO_HOST_CONTROL_STDIN is exactly 1. "stop\n" or EOF asks the
main event loop to exit normally, allowing registered shutdown handlers to run.
EOF also stops the game if its owning supervisor disappears. */
#include "platform.h"
#include "host_control.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static pthread_mutex_t control_lock = PTHREAD_MUTEX_INITIALIZER;
static int control_started, control_stop;

static void *read_control(void *unused)
{
	char line[8];
	int length = 0, overflow = 0, character;
	(void)unused;
	while ((character = fgetc(stdin)) != EOF)
	{
		if (character == '\n')
		{
			if (!overflow && ((length == 4 && !memcmp(line, "stop", 4)) ||
				(length == 5 && !memcmp(line, "stop\r", 5)))) break;
			length = overflow = 0;
		}
		else if (length < (int)sizeof(line)) line[length++] = (char)character;
		else overflow = 1;
	}
	pthread_mutex_lock(&control_lock);
	control_stop = 1;
	pthread_mutex_unlock(&control_lock);
	return NULL;
}

void host_control_initialize(void)
{
	const char *enabled = getenv("HALO_HOST_CONTROL_STDIN");
	pthread_t thread;
	if (control_started || !enabled || strcmp(enabled, "1")) return;
	if (pthread_create(&thread, NULL, read_control, NULL))
	{
		/* Explicit supervision must not silently start without its stop path. */
		platform_log("Host control: cannot start control reader");
		exit(EXIT_FAILURE);
	}
	pthread_detach(thread);
	control_started = 1;
}

int host_control_should_stop(void)
{
	int stop;
	if (!control_started) return 0;
	pthread_mutex_lock(&control_lock);
	stop = control_stop;
	pthread_mutex_unlock(&control_lock);
	return stop;
}
