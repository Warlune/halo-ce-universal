// Development supervisor: only handles it spawned, bounded restarts/lifetime,
// no shell, process-name kills, PID-file kills, services or persistent identity.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

async function waitFor(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export class OwnedSupervisor extends EventEmitter {
  constructor({ file, args = [], cwd, env, output = 'ignore', maxRestarts = 2,
    backoffMs = 500, maxBackoffMs = 2000, stopGraceMs = 5000, maxLifetimeMs = 120000 }) {
    super();
    if (!Number.isInteger(maxRestarts) || maxRestarts < 0 || maxRestarts > 3 ||
        ![backoffMs, maxBackoffMs, stopGraceMs, maxLifetimeMs].every(Number.isSafeInteger) ||
        backoffMs < 50 || maxBackoffMs < backoffMs || maxBackoffMs > 10000 ||
        stopGraceMs < 100 || stopGraceMs > 10000 || maxLifetimeMs < 1000 || maxLifetimeMs > 300000)
      throw new Error('Invalid supervisor bounds');
    Object.assign(this, { file, args, cwd, env, output, maxRestarts, backoffMs, maxBackoffMs, stopGraceMs, maxLifetimeMs });
    this.abort = new AbortController(); this.child = null; this.attempts = 0;
    this.desired = false; this.stopping = null; this.completion = null;
  }
  start() {
    if (this.completion) throw new Error('Supervisor already started');
    this.desired = true;
    this.started = new Promise((resolve, reject) => { this.firstResolve = resolve; this.firstReject = reject; });
    this.completion = this.run();
    this.completion.catch(() => {});
    return this.started;
  }
  async run() {
    const deadline = setTimeout(() => { this.emit('state', { kind: 'lifetime' }); void this.stop(); }, this.maxLifetimeMs);
    let last;
    try {
      while (this.desired) {
        const attempt = ++this.attempts;
        const child = spawn(this.file, this.args, { cwd: this.cwd, windowsHide: true,
          env: { ...this.env, HALO_SUPERVISOR_ATTEMPT: String(attempt) }, stdio: ['pipe', this.output, this.output] });
        this.child = child;
        child.stdin.on('error', () => {});
        this.exited = new Promise(resolve => {
          child.once('spawn', () => { this.firstResolve(child); this.emit('state', { kind: 'spawn', attempt, pid: child.pid }); });
          child.once('error', () => { this.firstReject(new Error('Owned child failed to start')); resolve({ code: null, launchFailed: true }); });
          child.once('exit', (code, signal) => resolve({ code, signal }));
        });
        last = await this.exited;
        this.child = null;
        this.emit('state', { kind: 'exit', attempt, ...last });
        if (!this.desired) break;
        if (attempt > this.maxRestarts) { this.desired = false; this.emit('state', { kind: 'exhausted', attempt }); break; }
        const milliseconds = Math.min(this.maxBackoffMs, this.backoffMs * 2 ** (attempt - 1));
        this.emit('state', { kind: 'backoff', attempt, milliseconds });
        await delay(milliseconds, undefined, { signal: this.abort.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
      }
      return { attempts: this.attempts, last };
    } finally { clearTimeout(deadline); }
  }
  stop({ eof = false } = {}) {
    if (this.stopping) return this.stopping;
    this.desired = false; this.abort.abort();
    this.stopping = (async () => {
      const child = this.child, exited = this.exited;
      let forced = false;
      if (child && child.exitCode === null && child.signalCode === null) {
        try { child.stdin.end(eof ? undefined : 'stop\n'); } catch {}
        if (!await waitFor(exited, this.stopGraceMs)) {
          // ChildProcess's owned handle; never look up or terminate by name.
          forced = true; child.kill('SIGKILL');
          if (!await waitFor(exited, 2000)) throw new Error('Owned child did not terminate');
        }
      }
      await this.completion;
      return { forced };
    })();
    return this.stopping;
  }
  crashForTest() {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null)
      throw new Error('No owned child to crash');
    this.child.kill('SIGKILL');
  }
}
