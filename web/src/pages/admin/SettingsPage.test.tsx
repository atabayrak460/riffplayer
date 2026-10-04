// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './SettingsPage';
import * as subsonic from '../../api/subsonic';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

/** The on/off switch in the settings row with the given label. */
async function toggleFor(label: RegExp) {
  const row = (await screen.findByText(label)).closest('div.flex')!;
  return within(row as HTMLElement).getByRole('button');
}

let patch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  patch = vi.spyOn(subsonic, 'adminPatchSettings').mockResolvedValue(undefined as never);
});

describe('SettingsPage — external metadata lookups', () => {
  it('shows both lookups as on when nothing has been saved (default on)', async () => {
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({});
    renderPage();

    expect((await toggleFor(/lyrics online/i)).className).toContain('bg-brand');
    expect((await toggleFor(/album covers online/i)).className).toContain('bg-brand');
  });

  it('shows a lookup as off when it was saved as "false"', async () => {
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({ lyrics_lookup_enabled: 'false' });
    renderPage();

    expect((await toggleFor(/lyrics online/i)).className).toContain('bg-zinc-700');
    expect((await toggleFor(/album covers online/i)).className).toContain('bg-brand');
  });

  it('saves lyrics_lookup_enabled=false when the lyrics switch is turned off', async () => {
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({});
    renderPage();

    await userEvent.click(await toggleFor(/lyrics online/i));

    await waitFor(() => expect(patch.mock.calls[0][0]).toEqual({ lyrics_lookup_enabled: 'false' }));
  });

  it('saves cover_lookup_enabled=false when the cover switch is turned off', async () => {
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({});
    renderPage();

    await userEvent.click(await toggleFor(/album covers online/i));

    await waitFor(() => expect(patch.mock.calls[0][0]).toEqual({ cover_lookup_enabled: 'false' }));
  });
});

describe('SettingsPage — social features', () => {
  it('is on by default and saves "false" when switched off', async () => {
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({});
    renderPage();
    const toggle = await toggleFor(/see each other/i);
    expect(toggle.className).toContain('bg-brand');

    await userEvent.click(toggle);
    await waitFor(() => expect(patch.mock.calls[0][0]).toEqual({ social_enabled: 'false' }));
  });

  it('shows as off when it was saved as "false"', async () => {
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({ social_enabled: 'false' });
    renderPage();
    expect((await toggleFor(/see each other/i)).className).not.toContain('bg-brand');
  });
});
