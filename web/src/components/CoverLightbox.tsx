import { CoverArt } from './CoverArt';
import { Modal } from './Modal';

interface Props {
  coverId: string;
  title: string;
  onClose: () => void;
}

/** Full-size album cover in a dismissable overlay (click outside, Esc, or the close button). */
export function CoverLightbox({ coverId, title, onClose }: Props) {
  return (
    <Modal
      onClose={onClose}
      label={`${title} cover`}
      className="!bg-transparent !border-0 relative max-w-[min(90vw,90vh)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-zinc-900 text-zinc-50 shadow-lg hover:bg-zinc-700 flex items-center justify-center"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <CoverArt
        id={coverId}
        size={1600}
        alt={title}
        className="block w-[min(90vw,90vh)] aspect-square object-contain rounded-lg shadow-2xl"
      />
    </Modal>
  );
}
