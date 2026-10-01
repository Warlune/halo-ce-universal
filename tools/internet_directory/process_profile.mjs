// Read only counters for handles owned by this harness. No machine-wide process
// inventory, stacks, command lines, paths, credentials or network payloads.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
const exec = promisify(execFile);

export class ProcessProfile {
  samples = [];
  async sample(participants, phase) {
    const owned = [{ label: 'harness', pid: process.pid }, ...participants
      .filter(p => p.child && p.child.exitCode === null && p.child.signalCode === null)
      .map(p => ({ label: p.label, pid: p.child.pid }))];
    if (owned.some(p => !Number.isSafeInteger(p.pid) || p.pid < 1)) throw new Error('Invalid owned profile handle');
    const command = `$items=@(Get-Process -Id ${owned.map(p => p.pid).join(',')} -ErrorAction Stop | ForEach-Object {
      [pscustomobject]@{Id=$_.Id;Cpu=$_.TotalProcessorTime.TotalSeconds;Threads=@($_.Threads | ForEach-Object {
        [pscustomobject]@{Id=$_.Id;Cpu=$_.TotalProcessorTime.TotalSeconds}
      })}
    }); ConvertTo-Json -InputObject $items -Depth 4 -Compress`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 3000, maxBuffer: 32768 });
    const values = JSON.parse(stdout);
    this.samples.push({ at: performance.now(), phase, values: values.map(v => ({
      label: owned.find(p => p.pid === v.Id).label, cpu: v.Cpu, threads: v.Threads
    })) });
  }
  summary(systemSamples = []) {
    const selected = this.samples.filter(s => s.phase === 'playing');
    if (selected.length < 2) return { samples: selected.length };
    const first = selected[0], last = selected.at(-1), seconds = (last.at - first.at) / 1000;
    const processes = last.values.map(value => {
      const before = first.values.find(v => v.label === value.label);
      if (!before) return null;
      const cpuSeconds = value.cpu - before.cpu;
      const threads = value.threads.map(t => t.Cpu - (before.threads.find(b => b.Id === t.Id)?.Cpu ?? t.Cpu));
      return { role: value.label, cpuSeconds: +cpuSeconds.toFixed(3),
        oneCoreCpuPercent: +(100 * cpuSeconds / seconds).toFixed(2),
        machineCpuPercent: +(100 * cpuSeconds / seconds / os.availableParallelism()).toFixed(2),
        hottestThreadCpuPercent: +(100 * Math.max(0, ...threads) / seconds).toFixed(2), threadCount: value.threads.length };
    }).filter(Boolean);
    const system = systemSamples.filter(s => s.at >= first.at && s.at <= last.at);
    const meanSystem = system.reduce((sum, s) => sum + s.cpu * s.elapsed, 0) / system.reduce((sum, s) => sum + s.elapsed, 0);
    const ownedCpu = processes.reduce((sum, p) => sum + p.machineCpuPercent, 0);
    return { samples: selected.length, intervalSeconds: +seconds.toFixed(3), processes,
      approximateMeanSystemCpuPercent: Number.isFinite(meanSystem) ? +meanSystem.toFixed(2) : null,
      approximateUnattributedCpuPercent: Number.isFinite(meanSystem) ? +(meanSystem - ownedCpu).toFixed(2) : null };
  }
}
