// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileSection } from './ProfileSection';
import * as subsonic from '../api/subsonic';
import { useAuthStore } from '../store/auth';

const profile = (over: Partial<subsonic.MyProfile> = {}): subsonic.MyProfile => ({
  displayName: null, bio: null, hasAvatar: false, avatarVersion: null, showListening: false, ...over,
});

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProfileSection /></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: { id: 1, username: 'atabay', role: 'user' } } as never);
  vi.spyOn(subsonic, 'getSocialStatus').mockResolvedValue(true);
  vi.spyOn(subsonic, 'getMyProfile').mockResolvedValue(profile());
});

describe('ProfileSection', () => {
  it('shows the saved profile and offers to add a picture', async () => {
    vi.spyOn(subsonic, 'getMyProfile').mockResolvedValue(profile({ displayName: 'Atabay', bio: 'Hi' }));
    renderIt();
    expect(await screen.findByDisplayValue('Atabay')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a picture' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove picture' })).not.toBeInTheDocument();
  });

  it('saves the name and about text, blank meaning "none"', async () => {
    const update = vi.spyOn(subsonic, 'updateMyProfile').mockResolvedValue();
    renderIt();
    await userEvent.type(await screen.findByLabelText('Display name'), '  Atabay  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ displayName: 'Atabay', bio: null }));
  });

  it('"Show what I\'m listening to" is off by default, with an honest explanation, and toggles', async () => {
    const update = vi.spyOn(subsonic, 'updateMyProfile').mockResolvedValue();
    renderIt();
    const box = await screen.findByLabelText(/Show what I.m listening to/);
    expect(box).not.toBeChecked();
    expect(screen.getByText(/Off by default/)).toBeInTheDocument();
    expect(screen.getByText(/admin can already read/)).toBeInTheDocument();

    await userEvent.click(box);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ showListening: true }));
  });

  it('uploads a picture and can remove it', async () => {
    const upload = vi.spyOn(subsonic, 'uploadAvatar').mockResolvedValue();
    const { container } = renderIt();
    await screen.findByRole('button', { name: 'Add a picture' });
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
  });

  it('can remove an existing picture', async () => {
    vi.spyOn(subsonic, 'getMyProfile').mockResolvedValue(profile({ hasAvatar: true, avatarVersion: 5 }));
    const del = vi.spyOn(subsonic, 'deleteAvatar').mockResolvedValue();
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove picture' }));
    await waitFor(() => expect(del).toHaveBeenCalled());
  });

  it('tells the user when an admin has switched social features off', async () => {
    vi.spyOn(subsonic, 'getSocialStatus').mockResolvedValue(false);
    renderIt();
    expect(await screen.findByText(/turned social features off/)).toBeInTheDocument();
  });

  it('shows an error from the server', async () => {
    vi.spyOn(subsonic, 'updateMyProfile').mockRejectedValue(new Error('displayName must be text'));
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('displayName must be text')).toBeInTheDocument();
  });
});
