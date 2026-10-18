import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentChecks, ENVIRONMENT_STATE_KEY, EDGE_TTS_PYPI_URL, environmentPythonCommand,
  systemUpdatesAvailable, type EnvironmentCheckOptions, type EnvironmentSnapshot, type ProcessResult } from '../src/environmentCheck.js';

function harness(overrides: Partial<EnvironmentCheckOptions> = {}) {
  let saved: EnvironmentSnapshot | undefined;
  let installed = '7.2.8';
  let now = new Date('2026-10-16T12:00:00Z');
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ info: { version: '7.3.1' } }) }) as Response);
  const process = vi.fn(async (_command: string, args: string[]): Promise<ProcessResult> => {
    if (args[0] === '--version') return { code: 0, stdout: 'Python 3.13.0', stderr: '' };
    if (args[0] === '-m') { installed = '7.3.1'; return { code: 0, stdout: 'pip output must stay private', stderr: '' }; }
    return { code: 0, stdout: installed, stderr: '' };
  });
  const confirm = vi.fn(async () => true), report = vi.fn(), log = vi.fn(), changed = vi.fn();
  const store = { get: <T>() => saved as T | undefined, update: vi.fn(async (_key: string, value: unknown) => { saved = value as EnvironmentSnapshot; }) };
  const options: EnvironmentCheckOptions = { pythonCommand: () => 'configured-python', vscodeVersion: '1.106.0', vscodeMinimum: '^1.106.0',
    detectHandy: async () => undefined, dailyEnabled: () => true, store, fetch: request as typeof fetch, runProcess: process,
    confirm, progress: async task => task(), report, log, changed, now: () => now, ...overrides };
  const checks = new EnvironmentChecks(options);
  return { checks, options, request, process, confirm, report, log, changed, store, saved: () => saved,
    installed: (value: string) => { installed = value; }, nextDate: () => { now = new Date('2026-10-17T12:00:00Z'); } };
}
afterEach(() => vi.useRealTimers());

describe('no-key environment checks', () => {
  it.each([['7.2.8', 'update'], ['7.3.1', 'ok'], ['7.10.0', 'ok']] as const)('compares installed %s numerically', async (version, status) => {
    const h = harness(); h.installed(version);
    const items = await h.checks.check();
    expect(items).toHaveLength(4);
    expect(items.find(item => item.name === 'edge-tts')).toMatchObject({ status, found: version, expected: '7.3.1',
      ...(status === 'update' ? { fix: 'updateEdgeTts' } : {}) });
    if (status === 'ok') expect(items.find(item => item.name === 'edge-tts')?.fix).toBeUndefined();
    expect(h.process.mock.calls.every(([command]) => command === 'configured-python')).toBe(true);
    expect(h.process.mock.calls[1]?.[1][0]).toBe('-c');
    expect(h.report).not.toHaveBeenCalled();
  });
  it('reports a missing distribution with an Update action', async () => {
    const h = harness(); h.process.mockImplementation(async (_command, args) => ({ code: args[0] === '--version' ? 0 : 3,
      stdout: args[0] === '--version' ? 'Python 3.13.0' : '', stderr: '' }));
    expect((await h.checks.check()).find(item => item.name === 'edge-tts')).toMatchObject({ status: 'missing', fix: 'updateEdgeTts' });
  });
  it('reports missing Python and unknown edge-tts without trying the package probe', async () => {
    const h = harness(); h.process.mockResolvedValue({ code: null, errorCode: 'ENOENT', stdout: '', stderr: '' });
    const items = await h.checks.check();
    expect(items[0]).toMatchObject({ name: 'Python', status: 'missing', fix: 'pythonSetting' });
    expect(items[0]?.explanation).toContain('kren.readAloud.edgePythonCommand');
    expect(items[1]).toMatchObject({ name: 'edge-tts', status: 'unknown' });
    expect(h.process).toHaveBeenCalledTimes(1);
    expect(h.request).not.toHaveBeenCalled();
  });
  it('times out PyPI silently and aborts its request', async () => {
    vi.useFakeTimers();
    const h = harness({ timeoutMs: 10 });
    h.request.mockImplementation(() => new Promise(() => {}));
    const pending = h.checks.check(); await vi.advanceTimersByTimeAsync(20);
    expect((await pending)[1]).toMatchObject({ status: 'unknown', found: '7.2.8' });
    expect((h.request.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    expect(h.report).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });
  it('times out Python and Handy independently', async () => {
    vi.useFakeTimers();
    const h = harness({ timeoutMs: 10, runProcess: async () => new Promise(() => {}), detectHandy: async () => new Promise(() => {}) });
    const pending = h.checks.check(); await vi.advanceTimersByTimeAsync(20);
    expect((await pending).map(item => item.status)).toEqual(['unknown', 'unknown', 'unknown', 'ok']);
    expect(h.report).not.toHaveBeenCalled();
  });
  it('turns thrown process and detection failures into unknown results', async () => {
    const h = harness({ runProcess: async () => { throw Error('process failure'); }, detectHandy: async () => { throw Error('detection failure'); } });
    expect((await h.checks.check()).map(item => item.status)).toEqual(['unknown', 'unknown', 'unknown', 'ok']);
  });
  it.each([false, true])('handles unusable PyPI responses, malformed=%s', async malformed => {
    const h = harness(); h.request.mockResolvedValue({ ok: malformed, json: async () => ({ info: {} }) } as Response);
    expect((await h.checks.check())[1]?.status).toBe('unknown');
    expect(h.report).not.toHaveBeenCalled();
  });
  it.each([['1.105.0', 'update'], ['1.106.0', 'ok'], ['1.107.0-insider', 'ok'], ['invalid', 'unknown']] as const)('checks VS Code %s against the supplied manifest minimum', async (version, status) => {
    const h = harness({ vscodeVersion: version });
    expect((await h.checks.check())[3]?.status).toBe(status);
  });
  it('uses an anonymous GET with no body, credentials, or identifying headers', async () => {
    const h = harness(); await h.checks.check();
    const [url, init] = h.request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(EDGE_TTS_PYPI_URL);
    expect(init).toEqual({ method: 'GET', signal: expect.any(AbortSignal), credentials: 'omit', redirect: 'error' });
    expect(init.body).toBeUndefined(); expect(init.headers).toBeUndefined();
  });
  it('marks Handy missing as optional information without a system notice', async () => {
    const h = harness(); h.installed('7.3.1');
    const items = await h.checks.check();
    expect(items[2]).toMatchObject({ status: 'missing', explanation: expect.stringMatching(/optional.*local tutor dictation/iu) });
    expect(systemUpdatesAvailable(h.checks.statuses)).toBe(false);
    expect(systemUpdatesAvailable({ 'edge-tts': 'update' })).toBe(true);
    expect(systemUpdatesAvailable({ Python: 'missing' })).toBe(true);
    expect(systemUpdatesAvailable({ 'VS Code': 'update' })).toBe(true);
  });
  it('stores only the date and statuses, coalesces concurrent checks, and clears a resolved notice', async () => {
    const h = harness(); const first = h.checks.check(); expect(h.checks.check()).toBe(first); await first;
    expect(systemUpdatesAvailable(h.checks.statuses)).toBe(true);
    expect(h.store.update).toHaveBeenCalledWith(ENVIRONMENT_STATE_KEY, { date: '2026-10-16', statuses: {
      Python: 'ok', 'edge-tts': 'update', Handy: 'missing', 'VS Code': 'ok' } });
    h.installed('7.3.1'); await h.checks.check();
    expect(systemUpdatesAvailable(h.checks.statuses)).toBe(false);
    expect(new EnvironmentChecks(h.options).statuses).toEqual(h.checks.statuses);
  });
});

describe('daily gate and consent-gated update', () => {
  it('never runs the daily check when the setting is false, while manual checks still run', async () => {
    const h = harness({ dailyEnabled: () => false });
    await h.checks.daily();
    expect(h.process).not.toHaveBeenCalled(); expect(h.request).not.toHaveBeenCalled(); expect(h.store.update).not.toHaveBeenCalled();
    await h.checks.check(); expect(h.request).toHaveBeenCalledOnce();
  });
  it('runs at most once per date, including concurrent calls and a restarted host', async () => {
    const h = harness(); await Promise.all([h.checks.daily(), h.checks.daily()]);
    await h.checks.daily(); await new EnvironmentChecks(h.options).daily(); expect(h.request).toHaveBeenCalledOnce();
    h.nextDate(); await h.checks.daily(); expect(h.request).toHaveBeenCalledTimes(2);
  });
  it('claims the date before an unfinished request', async () => {
    let complete!: () => void;
    const h = harness({ runProcess: async () => { await new Promise<void>(resolve => { complete = resolve; }); return { code: 1, stdout: '', stderr: '' }; } });
    const pending = h.checks.daily();
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(h.saved()?.date).toBe('2026-10-16');
    await new EnvironmentChecks(h.options).daily(); complete(); await pending;
  });
  it('does not invoke pip before confirmation and rechecks afterward', async () => {
    let approve!: (value: boolean) => void;
    const h = harness({ confirm: vi.fn(() => new Promise<boolean>(resolve => { approve = resolve; })) });
    await h.checks.check(); h.process.mockClear();
    const update = h.checks.updateEdgeTts(); await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    expect(h.process).not.toHaveBeenCalled();
    expect(h.options.confirm).toHaveBeenCalledWith('"configured-python" -m pip install -U edge-tts');
    approve(true); await update;
    expect(h.process.mock.calls[0]).toEqual(['configured-python', ['-m', 'pip', 'install', '-U', 'edge-tts'], 120_000]);
    expect(h.checks.items[1]).toMatchObject({ status: 'ok', found: '7.3.1' });
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.report).toHaveBeenCalledWith(expect.stringMatching(/edge-tts: ok/u)); expect(h.log).not.toHaveBeenCalled();
  });
  it('runs no pip command when the confirmation is canceled', async () => {
    const h = harness({ confirm: async () => false }); await h.checks.check(); h.process.mockClear();
    await h.checks.updateEdgeTts(); expect(h.process).not.toHaveBeenCalled();
  });
  it('shows and runs the configured executable path with spaces without shell escaping', async () => {
    const command = 'C:\\Python Folder\\python.exe';
    const h = harness({ pythonCommand: () => command });
    await h.checks.check(); await h.checks.updateEdgeTts();
    expect(h.confirm).toHaveBeenCalledWith(`"${command}" -m pip install -U edge-tts`);
    expect(h.process.mock.calls.every(([executable]) => executable === command)).toBe(true);
    expect(h.process.mock.calls.find(([, args]) => args[0] === '-m')?.[1]).toEqual(['-m', 'pip', 'install', '-U', 'edge-tts']);
  });
  it('reports and logs only the last pip error line, then rechecks', async () => {
    const h = harness(); await h.checks.check();
    h.process.mockImplementation(async (_command, args) => args[0] === '-m'
      ? { code: 1, stdout: 'Never log progress', stderr: 'Never log earlier lines\nERROR: installation failed\n[notice] unrelated pip notice\n' }
      : { code: 0, stdout: args[0] === '--version' ? 'Python 3.13.0' : '7.2.8', stderr: '' });
    await h.checks.updateEdgeTts();
    expect(h.log.mock.calls).toEqual([['ERROR: installation failed']]);
    expect(h.report.mock.calls).toEqual([['edge-tts update failed: ERROR: installation failed']]);
    expect(h.request).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, '', '  ', 'bad\ncommand', 'bad\0command'])('falls back safely for invalid Python command %j', value => {
    expect(environmentPythonCommand(value)).toBe('python');
  });
  it('preserves an executable path with spaces as one command', () => {
    expect(environmentPythonCommand(' C:\\Python Folder\\python.exe ')).toBe('C:\\Python Folder\\python.exe');
  });
});
