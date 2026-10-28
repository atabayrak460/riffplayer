// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DownloadButton } from './DownloadButton';

describe('DownloadButton', () => {
  it('idle: shows a Download button that calls onDownload only', async () => {
    const onDownload = vi.fn();
    const onRemove = vi.fn();
    render(<DownloadButton state={undefined} onDownload={onDownload} onRemove={onRemove} />);

    await userEvent.click(screen.getByTitle('Download'));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('downloading: shows a non-interactive spinner', () => {
    render(<DownloadButton state="downloading" onDownload={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByTitle('Downloading…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('downloaded: shows Remove download that calls onRemove only', async () => {
    const onDownload = vi.fn();
    const onRemove = vi.fn();
    render(<DownloadButton state="downloaded" onDownload={onDownload} onRemove={onRemove} />);

    await userEvent.click(screen.getByTitle('Remove download'));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('exposes an accessible name for each icon-only state', () => {
    const { unmount } = render(
      <DownloadButton state={undefined} onDownload={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    unmount();

    render(<DownloadButton state="downloaded" onDownload={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove download' })).toBeInTheDocument();
  });

  it('does not let the click bubble to a clickable parent row', async () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <DownloadButton state={undefined} onDownload={vi.fn()} onRemove={vi.fn()} />
        <DownloadButton state="downloaded" onDownload={vi.fn()} onRemove={vi.fn()} />
      </div>,
    );

    await userEvent.click(screen.getByTitle('Download'));
    await userEvent.click(screen.getByTitle('Remove download'));

    expect(parentClick).not.toHaveBeenCalled();
  });
});
