// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listOutputs, outputSwitchingSupported, promptForOutput } from './audioOutput';

function mockMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value });
}

const info = (kind: string, deviceId: string, label = ''): MediaDeviceInfo => ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo;

beforeEach(() => mockMediaDevices(undefined));

describe('outputSwitchingSupported', () => {
  it('follows whether media elements have setSinkId', () => {
    const had = 'setSinkId' in HTMLMediaElement.prototype;
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: () => Promise.resolve() });
    expect(outputSwitchingSupported()).toBe(true);
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId;
    expect(outputSwitchingSupported()).toBe(had);
  });
});

describe('listOutputs', () => {
  it('lists only audio outputs, without the virtual default entries', async () => {
    mockMediaDevices({
      enumerateDevices: async () => [
        info('audioinput', 'mic', 'Microphone'),
        info('audiooutput', 'default', 'Default - Speakers'),
        info('audiooutput', 'communications', 'Communications'),
        info('audiooutput', 'a', 'Headphones'),
        info('videoinput', 'cam', 'Camera'),
      ],
    });
    expect(await listOutputs()).toEqual([{ deviceId: 'a', label: 'Headphones' }]);
  });

  it('gives hidden labels a readable stand-in', async () => {
    mockMediaDevices({ enumerateDevices: async () => [info('audiooutput', 'a'), info('audiooutput', 'b')] });
    expect((await listOutputs()).map((o) => o.label)).toEqual(['Output 1', 'Output 2']);
  });

  it('is empty where the browser has no device API', async () => {
    expect(await listOutputs()).toEqual([]);
  });
});

describe('promptForOutput', () => {
  it('returns what the browser\'s picker returns', async () => {
    mockMediaDevices({ selectAudioOutput: vi.fn(async () => info('audiooutput', 'x', 'JBL Flip 6')) });
    expect(await promptForOutput()).toEqual({ deviceId: 'x', label: 'JBL Flip 6' });
  });

  it('is null when there is no picker, or the user backs out', async () => {
    expect(await promptForOutput()).toBeNull();
    mockMediaDevices({ selectAudioOutput: vi.fn(async () => { throw new DOMException('no', 'NotAllowedError'); }) });
    expect(await promptForOutput()).toBeNull();
  });
});
