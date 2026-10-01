/* Opt-in, aggregate development profiling. No identities or session data.
   Reuses the game's existing wall-time timers; it is not a CPU stack profiler. */
#include "platform.h"
#include <time.h>
#include <string.h>

int host_profile_enabled(void)
{
    static int enabled = -1;
    if (enabled < 0)
    {
        const char *value = getenv("HALO_HOST_PROFILE");
        enabled = value && !strcmp(value, "1");
    }
    return enabled;
}

void host_profile_frame(double frame_ms, double render_ms, double idle_ms,
    double tick_ms, long ticks, double max_tick_ms)
{
    static double began, frames_total, render_total, idle_total, tick_total, tick_max;
    static unsigned long frames, tick_count;
    struct timespec now;
    double seconds;
    if (!host_profile_enabled()) return;
    clock_gettime(CLOCK_MONOTONIC, &now);
    seconds = now.tv_sec + now.tv_nsec / 1000000000.0;
    if (!began) began = seconds;
    frames++; tick_count += ticks;
    frames_total += frame_ms; render_total += render_ms;
    idle_total += idle_ms; tick_total += tick_ms;
    if (max_tick_ms > tick_max) tick_max = max_tick_ms;
    if (seconds - began < 5.0) return;
    platform_log("host profile: seconds %.3f frames %lu ticks %lu frame_ms %.3f render_ms %.3f idle_ms %.3f tick_ms %.3f max_tick_ms %.3f",
        seconds - began, frames, tick_count, frames_total, render_total, idle_total, tick_total, tick_max);
    began = seconds;
    frames = tick_count = 0;
    frames_total = render_total = idle_total = tick_total = tick_max = 0.0;
}
