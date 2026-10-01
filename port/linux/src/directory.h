#ifndef __HALO_DIRECTORY_H
#define __HALO_DIRECTORY_H

/* Experimental loopback directory registration, explicit process opt-in only.
Called after p2p_initialize, never from within the P2P lock. */
void directory_initialize(void);

#endif
