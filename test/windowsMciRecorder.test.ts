import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  WindowsMciRecorder,
  buildMciPowerShellScript
} from '../src/windowsMciRecorder.js';

function wav(sampleRate = 11_025, channels = 1, bitsPerSample = 16): Buffer {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  bytes.writeUInt16LE(channels * bitsPerSample / 8, 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(2, 40);
  return bytes;
}

async function temporaryTestRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'kren-recorder-test-'));
}

describe('KREN owned Windows MCI recorder', () => {
  it('uses the proven synchronous MCI sequence and lets the device keep its sample rate', () => {
    const script = buildMciPowerShellScript('temporary recording.wav');
    const commands = [
      'open new type waveaudio alias krenrecorder',
      'set krenrecorder format tag pcm',
      'set krenrecorder samplespersecond 16000',
      'set krenrecorder channels 1',
      'set krenrecorder bitspersample 16',
      'set krenrecorder alignment 2',
      'record krenrecorder',
      'stop krenrecorder',
      'save krenrecorder',
      'close krenrecorder'
    ];
    const positions = commands.map((command) => script.indexOf(command));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(script).toMatch(/Try-Mci[^\n]+samplespersecond 16000/iu);
  });

  it.runIf(process.platform === 'win32')(
    'builds a PowerShell program that parses without opening the microphone',
    () => {
      const scriptBase64 = Buffer.from(
        buildMciPowerShellScript('temporary recording.wav'),
        'utf16le'
      ).toString('base64');
      const parser = `$source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${scriptBase64}'))
$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }`;
      const encodedParser = Buffer.from(parser, 'utf16le').toString('base64');
      const result = spawnSync(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedParser],
        { encoding: 'utf8', windowsHide: true }
      );
      expect(result.status, result.stderr).toBe(0);
    }
  );

  it('creates exactly one WAV and deletes it after successful transcription', async () => {
    const root = await temporaryTestRoot();
    try {
      const recorder = new WindowsMciRecorder({
        platform: 'win32',
        temporaryRoot: root,
        startNative: async (filePath) => ({
          stop: async () => { await writeFile(filePath, wav()); },
          cancel: vi.fn(async () => undefined)
        })
      });
      const recording = await recorder.start();
      const result = await recording.finish(async (_audio, format) => {
        expect(await readdir(dirname(recording.filePath))).toEqual(['dictation.wav']);
        expect(format).toEqual({ sampleRate: 11_025, channels: 1, bitsPerSample: 16 });
        return 'transcribed';
      });
      expect(result).toBe('transcribed');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('deletes the exact one WAV when transcription throws', async () => {
    const root = await temporaryTestRoot();
    try {
      const recorder = new WindowsMciRecorder({
        platform: 'win32',
        temporaryRoot: root,
        startNative: async (filePath) => ({
          stop: async () => { await writeFile(filePath, wav()); },
          cancel: vi.fn(async () => undefined)
        })
      });
      const recording = await recorder.start();
      await expect(recording.finish(async () => {
        expect(await readdir(dirname(recording.filePath))).toEqual(['dictation.wav']);
        throw new Error('provider rejected audio');
      })).rejects.toThrow('provider rejected audio');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes a partial WAV when the microphone cannot start', async () => {
    const root = await temporaryTestRoot();
    try {
      const recorder = new WindowsMciRecorder({
        platform: 'win32',
        temporaryRoot: root,
        startNative: async (filePath) => {
          await writeFile(filePath, wav());
          throw new Error('no microphone');
        }
      });
      await expect(recorder.start()).rejects.toThrow('no microphone');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
