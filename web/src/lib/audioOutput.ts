// Choosing where the sound comes out (speakers, headphones, a Bluetooth speaker) in the browser.
// Uses HTMLMediaElement.setSinkId — Chrome and Edge. The labels of the devices stay hidden until the
// user has granted audio permission once, which is what selectAudioOutput() (a user-gesture prompt) is for.

export interface OutputDevice {
  deviceId: string;
  label: string;
}

type SelectAudioOutput = (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;

export function outputSwitchingSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/** The audio outputs the browser knows about, with readable names even when labels are hidden. */
export async function listOutputs(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  let n = 0;
  return all
    .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || `Output ${++n}` }));
}

/** The browser's own output picker (a prompt), where it exists. Resolves null if there is none or the user backs out. */
export async function promptForOutput(): Promise<OutputDevice | null> {
  const select = (navigator.mediaDevices as unknown as { selectAudioOutput?: SelectAudioOutput } | undefined)?.selectAudioOutput;
  if (!select) return null;
  try {
    const d = await select.call(navigator.mediaDevices);
    return { deviceId: d.deviceId, label: d.label || 'Selected output' };
  } catch {
    return null; // dismissed, or not allowed
  }
}
