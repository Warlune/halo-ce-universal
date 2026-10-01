#ifndef HALO_HOST_CONTROL_H
#define HALO_HOST_CONTROL_H

/* Explicit, process-owned stdin control for unattended development hosts. */
void host_control_initialize(void);
int host_control_should_stop(void);

#endif
