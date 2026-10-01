// Shared development fixture. Copies only owned local test assets, never the
// live installation. Lock files are conservative: stale locks are not stolen.
import { mkdir, readFile, copyFile, realpath, open, unlink } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const exec = promisify(execFile);
export const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const base = join(repository, 'build/directory-game-test');

export async function prepareNativeFixture(label, address) {
  if (process.platform !== 'win32' || !/^[a-z][a-z0-9-]{0,30}$/.test(label) || !/^127\.0\.0\.(?:2[0-4][0-9])$/.test(address))
    throw new Error('Invalid isolated Windows fixture');
  if (await readFile(join(base, '.isolated-directory-test'), 'utf8') !== 'local native directory fixture')
    throw new Error('Prepared test assets required');
  const basePath = await realpath(base), runtime = join(basePath, label);
  await mkdir(runtime, { recursive: true });
  if (!(await realpath(runtime)).startsWith(basePath + sep)) throw new Error('Fixture escapes the prepared root');
  const lockPath = join(runtime, '.owned.lock'), nonce = randomUUID();
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(JSON.stringify({ pid: process.pid, nonce }));
  await lock.close();
  const release = async () => { if (JSON.parse(await readFile(lockPath, 'utf8')).nonce === nonce) await unlink(lockPath); };
  try {
    for (const name of ['data/maps', 'saves', 'profile', 'local', 'roaming']) {
      const target = join(runtime, name); await mkdir(target, { recursive: true });
      if (!(await realpath(target)).startsWith(runtime + sep)) throw new Error('Fixture subdirectory escapes its root');
    }
    for (const name of ['ui.map', 'carousel.map', 'bloodgulch.map'])
      await copyFile(join(basePath, 'data/maps', name), join(runtime, 'data/maps', name));
    for (const name of ['halo.exe', 'SDL3.dll']) await copyFile(join(repository, 'build/windows', name), join(runtime, name));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('HALO_')));
    Object.assign(env, { HALO_DATA_ROOT: join(runtime, 'data'), HALO_SAVE_ROOT: join(runtime, 'saves'),
      LOCALAPPDATA: join(runtime, 'local'), APPDATA: join(runtime, 'roaming'), USERPROFILE: join(runtime, 'profile'),
      HALO_NET_ADDRESS: address, HALO_NET_BROADCAST: '127.0.0.250', HALO_NET_ONLINE: 'true',
      HALO_NET_BROKERS: '', HALO_NET_STUN: '', HALO_NET_ALLOW_UPNP: 'false', HALO_NET_JOIN_FROM_CLIPBOARD: 'false',
      HALO_DISCORD_APPLICATION: '', HALO_UPDATE_AUTO: 'false', HALO_NULL_RENDERER: '1', HALO_HIDDEN_WINDOW: '1',
      HALO_NO_AUDIO: '1', HALO_NETWORK_TEST: 'host:bloodgulch', HALO_NETWORK_TEST_START: '15',
      HALO_EXIT_AFTER: '150', HALO_HOST_CONTROL_STDIN: '1' });
    return { runtime, file: join(runtime, 'halo.exe'), env, release };
  } catch (error) { await release(); throw error; }
}

const cpuTimes = () => os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle,
  total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });

export class ResourceGuard {
  constructor() {
    this.previous = cpuTimes(); this.at = performance.now(); this.hot = 0; this.lagged = 0;
    this.samples = []; this.processSamples = [];
    this.delay = monitorEventLoopDelay({ resolution: 20 }); this.delay.enable();
  }
  sample() {
    const next = cpuTimes(), elapsed = performance.now() - this.at;
    const total = next.total - this.previous.total;
    const cpu = total > 0 ? 100 * (1 - (next.idle - this.previous.idle) / total) : 0;
    const freeGiB = os.freemem() / 2 ** 30;
    this.previous = next; this.at = performance.now();
    this.hot = cpu > 85 ? this.hot + 1 : 0;
    const loopDelayMs = this.delay.max / 1e6; this.delay.reset();
    this.lagged = loopDelayMs > 500 ? this.lagged + 1 : 0;
    this.samples.push({ cpu, freeGiB, elapsed });
    if (freeGiB < 4 || this.hot >= 3 || this.lagged >= 2) throw new Error('Resource guard stopped test: memory, CPU or responsiveness limit');
    return { cpu, freeGiB };
  }
  async ownedProcesses(supervisors) {
    const ids = supervisors.map(s => s.child).filter(child => child && child.exitCode === null && child.signalCode === null).map(child => child.pid);
    if (!ids.length) return;
    if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid owned process handle');
    const command = `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object CPU,WorkingSet64,PrivateMemorySize64,PeakWorkingSet64 | ConvertTo-Json -Compress`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 2500, maxBuffer: 8192 });
    if (stdout.trim()) {
      const parsed = JSON.parse(stdout), values = Array.isArray(parsed) ? parsed : [parsed];
      this.processSamples.push({ atMs: performance.now(), values });
      if (values.reduce((sum, value) => sum + value.WorkingSet64, 0) > 2 * 2 ** 30)
        throw new Error('Owned-game working set exceeded 2 GiB budget');
    }
  }
  summary() {
    const values = this.samples;
    return { samples: values.length, peakSystemCpuPercent: Math.round(Math.max(0, ...values.map(v => v.cpu))),
      minimumFreeGiB: values.length ? +Math.min(...values.map(v => v.freeGiB)).toFixed(2) : null,
      peakOwnedWorkingSetMiB: Math.round(Math.max(0, ...this.processSamples.map(s => s.values.reduce((a, v) => a + v.WorkingSet64, 0))) / 2 ** 20),
      lastOwnedCpuSeconds: this.processSamples.at(-1)?.values.map(v => v.CPU) || [] };
  }
  close() { this.delay.disable(); }
}
