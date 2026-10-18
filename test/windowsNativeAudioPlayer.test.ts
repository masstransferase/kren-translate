import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { WindowsNativeAudioPlayer, WINDOWS_NATIVE_AUDIO_SCRIPT } from '../src/speech/speechCenter.js';

const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function harness() {
  vi.useFakeTimers();
  const children: Array<{ child: ChildProcess; input: PassThrough; output: PassThrough; commands: string[] }> = [];
  const spawn = vi.fn(() => {
    const child = new EventEmitter() as ChildProcess;
    const input = new PassThrough(), output = new PassThrough(), commands: string[] = [];
    input.on('data', chunk => commands.push(chunk.toString().trim()));
    Object.defineProperties(child, { stdin: { value: input }, stdout: { value: output } });
    child.kill = vi.fn(() => { child.emit('exit', 1); return true; });
    children.push({ child, input, output, commands });
    return child;
  });
  const create = vi.fn(async () => { const directory = `C:\\Temp\\native ${create.mock.calls.length}`; return { directory, file: `${directory}\\speech.mp3` }; });
  const remove = vi.fn(async () => {}), write = vi.fn(async () => {}), log = vi.fn();
  const oneShot = { playBase64: vi.fn(async (): Promise<'completed' | 'failed' | 'stopped'> => 'completed'), stop: vi.fn(() => false) };
  const player = new WindowsNativeAudioPlayer(oneShot, { platform: 'win32', spawn, createAudio: create, removeAudio: remove, writeAudio: write, log });
  const ready = async (index = children.length - 1) => { children[index]!.output.write('REA'); children[index]!.output.write('DY\r\n'); await flush(); };
  const reply = async (line: string, index = children.length - 1) => { children[index]!.output.write(line + '\n'); await flush(); };
  return { player, children, spawn, create, remove, write, log, oneShot, ready, reply };
}
it('starts hidden STA, accepts split READY, clamps volume and drives completion only from matching replies', async () => {
  const h = harness(), started = vi.fn(); h.player.beginSession();
  const pending = h.player.play('AQIDBA==', 120, started); await flush();
  expect(h.children[0]!.commands).toEqual([]);
  await vi.advanceTimersByTimeAsync(20); await h.ready();
  expect(h.spawn).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-STA', '-WindowStyle', 'Hidden']), expect.objectContaining({ windowsHide: true, shell: false }));
  expect(h.children[0]!.commands).toEqual(['PLAY 1 100 C:\\Temp\\native 1\\speech.mp3']);
  expect(h.write).toHaveBeenCalledWith('C:\\Temp\\native 1\\speech.mp3', Buffer.from('AQIDBA==', 'base64'));
  await h.reply('STARTED 99'); expect(started).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30); await h.reply('STARTED 1'); await h.reply('STARTED 1');
  expect(started).toHaveBeenCalledOnce(); expect(h.remove).not.toHaveBeenCalled();
  expect(h.log).toHaveBeenCalledWith('[speech] native player ready after 20 ms');
  expect(h.log).toHaveBeenCalledWith('[speech] clip 1 started after 30 ms');
  await h.reply('ENDED 1'); expect(await pending).toBe('completed'); expect(h.remove).toHaveBeenCalledOnce(); h.player.dispose();
});
it('never plays the second clip before the first ends and reuses the process', async () => {
  const h = harness(); h.player.beginSession(); await h.ready();
  const first = h.player.play('AQIDBA==', 40), second = h.player.play('AQIDBA==', 60); await flush();
  await h.reply('STARTED 1');
  expect(h.children[0]!.commands).toHaveLength(1); expect(h.create).toHaveBeenCalledOnce();
  await h.reply('ENDED 1'); expect(await first).toBe('completed');
  expect(h.children[0]!.commands[1]).toMatch(/^PLAY 2 60 /u);
  await h.reply('STARTED 2'); await h.reply('ENDED 2'); expect(await second).toBe('completed');
  expect(h.spawn).toHaveBeenCalledOnce(); expect(h.remove).toHaveBeenCalledTimes(2); h.player.dispose();
});
it('STOP cancels the active clip and drops queued clips, ignoring late STARTED', async () => {
  const h = harness(); h.player.beginSession(); await h.ready(); const started = vi.fn();
  const first = h.player.play('AQIDBA==', 50, started), second = h.player.play('AQIDBA==', 50); await flush();
  expect(h.player.stop()).toBe(true); expect(h.children[0]!.commands.at(-1)).toBe('STOP');
  await h.reply('STARTED 1'); expect(started).not.toHaveBeenCalled(); await h.reply('ENDED 1');
  expect(await first).toBe('stopped'); expect(await second).toBe('stopped'); expect(h.create).toHaveBeenCalledOnce();
  expect(h.remove).toHaveBeenCalledOnce(); h.player.dispose();
});
it('STOP during startup drops the clip without restarting or using one-shot', async () => {
  const h = harness(); h.player.beginSession(); const pending = h.player.play('AQIDBA==', 50); await flush();
  h.player.stop(); await h.ready(); expect(await pending).toBe('stopped');
  expect(h.children[0]!.commands).toEqual(['STOP']); expect(h.oneShot.playBase64).not.toHaveBeenCalled();
  expect(h.remove).toHaveBeenCalledOnce(); h.player.dispose();
});
it('restarts once after death, then plays the same audio one-shot for the rest of the session', async () => {
  const h = harness(); h.player.beginSession(); await h.ready(); const started = vi.fn();
  const pending = h.player.play('AQIDBA==', 50, started); await flush();
  h.children[0]!.child.emit('exit', 1); await flush(); expect(h.spawn).toHaveBeenCalledTimes(2);
  await h.ready(); expect(h.children[1]!.commands[0]).toMatch(/^PLAY 2 50 /u);
  h.children[1]!.child.emit('exit', 1); expect(await pending).toBe('completed');
  expect(h.oneShot.playBase64).toHaveBeenCalledWith('AQIDBA==', 50, started);
  expect(await h.player.play('AQIDBA==', 20)).toBe('completed');
  expect(h.spawn).toHaveBeenCalledTimes(2); expect(h.oneShot.playBase64).toHaveBeenCalledTimes(2);
  expect(h.remove).toHaveBeenCalledOnce(); h.player.dispose();
});
it('startup death restarts once then uses one-shot, and a new session can use native again', async () => {
  const h = harness(); h.player.beginSession(); const pending = h.player.play('AQIDBA==', 50); await flush();
  h.children[0]!.child.emit('exit', 1); await flush(); h.children[1]!.child.emit('exit', 1);
  expect(await pending).toBe('completed'); expect(h.spawn).toHaveBeenCalledTimes(2);
  h.player.beginSession(); await h.ready(); const next = h.player.play('AQIDBA==', 50); await flush();
  await h.reply('ENDED 1'); expect(await next).toBe('completed'); expect(h.spawn).toHaveBeenCalledTimes(3); h.player.dispose();
});
it.each(['mediaFailed', 'private-untrusted-detail'])('FAILED cleans the file, names a safe cause for %s, and never restarts', async cause => {
  const h = harness(); h.player.beginSession(); await h.ready(); const pending = h.player.play('AQIDBA==', 50); await flush();
  await h.reply(`FAILED 1 ${cause}`); expect(await pending).toBe('failed');
  expect(h.player.failureCause()).toBe(cause === 'mediaFailed' ? 'mediaFailed' : 'unknown');
  expect(h.remove).toHaveBeenCalledOnce(); expect(h.spawn).toHaveBeenCalledOnce(); expect(h.oneShot.playBase64).not.toHaveBeenCalled(); h.player.dispose();
});
it('a file write failure cleans its directory without issuing PLAY', async () => {
  const h = harness(); h.write.mockRejectedValue(new Error('private detail')); h.player.beginSession(); await h.ready();
  expect(await h.player.play('AQIDBA==', 50)).toBe('failed'); expect(h.player.failureCause()).toBe('fileError');
  expect(h.remove).toHaveBeenCalledOnce(); expect(h.children[0]!.commands).toEqual([]); h.player.dispose();
});
it('exits with QUIT after two idle minutes and starts again on demand', async () => {
  const h = harness(); h.player.beginSession(); await h.ready(); const pending = h.player.play('AQIDBA==', 50); await flush();
  await h.reply('ENDED 1'); await pending; await vi.advanceTimersByTimeAsync(119_999);
  expect(h.children[0]!.commands).not.toContain('QUIT'); await vi.advanceTimersByTimeAsync(1);
  expect(h.children[0]!.commands.at(-1)).toBe('QUIT'); h.children[0]!.child.emit('exit', 0);
  h.player.beginSession(); await h.ready(); expect(h.spawn).toHaveBeenCalledTimes(2); h.player.dispose();
});
it('QUIT on dispose exits and prohibits later playback', async () => {
  const h = harness(); h.player.beginSession(); await h.ready(); h.player.dispose();
  expect(h.children[0]!.commands).toEqual(['STOP', 'QUIT']); expect(await h.player.play('AQIDBA==', 50)).toBe('stopped');
});
it('the real helper pumps media events on the dispatcher while a background thread reads stdin', () => {
  expect(WINDOWS_NATIVE_AUDIO_SCRIPT).toMatch(/Thread reader = new Thread/u);
  expect(WINDOWS_NATIVE_AUDIO_SCRIPT).toMatch(/dispatcher.BeginInvoke\(new Action/u);
  expect(WINDOWS_NATIVE_AUDIO_SCRIPT).toMatch(/Dispatcher.Run\(\)/u);
  expect(WINDOWS_NATIVE_AUDIO_SCRIPT).toMatch(/MediaOpened[\s\S]*STARTED/u);
  expect(WINDOWS_NATIVE_AUDIO_SCRIPT).toMatch(/FromMinutes\(2\)/u);
});
