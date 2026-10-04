interface Props {
  state: 'downloading' | 'downloaded' | undefined;
  onDownload: () => void;
  onRemove: () => void;
  className?: string;
}

/** Per-item download state: outline arrow (idle) / spinner (downloading) / filled arrow (downloaded, click to remove). */
export function DownloadButton({ state, onDownload, onRemove, className = '' }: Props) {
  if (state === 'downloading') {
    return (
      <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${className}`} title="Downloading…">
        <svg className="w-4 h-4 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (state === 'downloaded') {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove download"
        className={`text-brand hover:text-red-400 transition-colors flex-shrink-0 ${className}`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3a.75.75 0 0 1 .75.75v10.19l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V3.75A.75.75 0 0 1 12 3ZM4.5 18a.75.75 0 0 1 .75.75v.75a1.5 1.5 0 0 0 1.5 1.5h10.5a1.5 1.5 0 0 0 1.5-1.5v-.75a.75.75 0 0 1 1.5 0v.75a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3v-.75A.75.75 0 0 1 4.5 18Z" />
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDownload();
      }}
      title="Download"
      className={`text-zinc-400 hover:text-zinc-50 transition-colors flex-shrink-0 ${className}`}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0-4.5-4.5m4.5 4.5 4.5-4.5M4.5 19.5h15" />
      </svg>
    </button>
  );
}
