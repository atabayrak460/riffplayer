// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LinkedDevicesSection } from './LinkedDevicesSection';
import * as subsonic from '../api/subsonic';

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LinkedDevicesSection /></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getLinkedDevices').mockResolvedValue([]);
});

describe('LinkedDevicesSection', () => {
  it('links a TV with the code it shows and says which one', async () => {
    const approve = vi.spyOn(subsonic, 'approveDeviceCode').mockResolvedValue('Living room TV');
    renderIt();
    await userEvent.type(screen.getByLabelText('Code shown on the TV'), 'abcd-efgh');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() => expect(approve.mock.calls[0][0]).toBe('ABCD-EFGH')); // upper-cased as typed
    expect(await screen.findByText('Living room TV is now linked.')).toBeInTheDocument();
    expect(screen.getByLabelText('Code shown on the TV')).toHaveValue('');
  });

  it('shows the server\'s message for a wrong or expired code', async () => {
    vi.spyOn(subsonic, 'approveDeviceCode').mockRejectedValue(new Error('That code is wrong or has expired'));
    renderIt();
    await userEvent.type(screen.getByLabelText('Code shown on the TV'), 'WRONG');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText('That code is wrong or has expired')).toBeInTheDocument();
  });

  it('does nothing for an empty code', () => {
    renderIt();
    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();
  });

  it('lists linked devices and unlinks one', async () => {
    vi.spyOn(subsonic, 'getLinkedDevices').mockResolvedValue([
      { id: 5, name: 'Bedroom TV', createdAt: 1, lastUsed: null },
      { id: 6, name: 'Den TV', createdAt: 2, lastUsed: 1_700_000_000 },
    ]);
    const unlink = vi.spyOn(subsonic, 'unlinkDevice').mockResolvedValue();
    renderIt();

    const list = await screen.findByRole('list', { name: 'Linked devices' });
    expect(within(list).getByText('Not used yet')).toBeInTheDocument();
    expect(within(list).getByText(/Last used/)).toBeInTheDocument();

    await userEvent.click(within(within(list).getByText('Bedroom TV').closest('li')!).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(unlink.mock.calls[0][0]).toBe(5));
  });
});
