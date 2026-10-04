import { useState, type ComponentType, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSystemViewSettings, setSystemViewDescription, uploadSystemViewCover, removeSystemViewCover,
  type SystemViewKey,
} from '../api/subsonic';
import { CoverUploadControl } from './CoverUploadControl';

interface Props {
  viewKey: SystemViewKey;
  title: string;
  /** Shown in the description box when no custom description is set. */
  defaultDescription: string;
  /** Stock SVG shown when no custom cover is set. */
  StockCover: ComponentType<{ className?: string }>;
  /** Existing per-page info (track count, etc.), rendered under the title. */
  meta?: ReactNode;
}

export function SystemViewHeader({ viewKey, title, defaultDescription, StockCover, meta }: Props) {
  const qc = useQueryClient();
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');

  const settingsKey = ['system-view-settings', viewKey];
  const { data: settings } = useQuery({
    queryKey: settingsKey,
    queryFn: () => getSystemViewSettings(viewKey),
  });

  const coverMutation = useMutation({
    mutationFn: (file: File) => uploadSystemViewCover(viewKey, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKey }),
  });
  const removeCoverMutation = useMutation({
    mutationFn: () => removeSystemViewCover(viewKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKey }),
  });
  const descriptionMutation = useMutation({
    mutationFn: (description: string) => setSystemViewDescription(viewKey, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKey });
      setEditingDescription(false);
    },
  });

  const coverError = coverMutation.isError
    ? coverMutation.error instanceof Error
      ? coverMutation.error.message
      : 'Upload failed'
    : null;

  const hasCover = settings?.hasCover ?? false;
  const description = settings?.description || null;

  return (
    <div className="flex gap-6 mb-6">
      <CoverUploadControl
        coverId={hasCover ? `sv-${viewKey}` : undefined}
        coverSize={440}
        coverClassName="w-56 h-56 rounded-lg object-cover shadow-xl"
        alt={title}
        fallback={<StockCover className="w-full h-full" />}
        shape="square"
        hasCover={hasCover}
        uploadTitle="Upload cover"
        removeTitle="Reset to default cover"
        onUpload={(file) => coverMutation.mutate(file)}
        onRemove={() => removeCoverMutation.mutate()}
        error={coverError}
      />

      <div className="flex flex-col flex-1 min-w-0 h-56">
        <h1 className="text-3xl font-bold text-zinc-50">{title}</h1>
        {meta && <div className="text-sm text-zinc-400 mt-1.5">{meta}</div>}

        {editingDescription ? (
          <form
            onSubmit={(e) => { e.preventDefault(); descriptionMutation.mutate(descriptionValue); }}
            className="flex flex-col gap-1.5 mt-3 flex-1 min-h-0"
          >
            <textarea
              autoFocus
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value)}
              placeholder={defaultDescription}
              className="bg-zinc-900/50 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-50 text-sm resize-none focus:outline-none focus:border-brand flex-1 min-h-0"
            />
            <div className="flex gap-2">
              <button type="submit" className="text-brand text-sm">Save</button>
              {description && (
                <button
                  type="button"
                  onClick={() => descriptionMutation.mutate('')}
                  className="text-zinc-500 hover:text-zinc-300 text-sm"
                >
                  Reset to default
                </button>
              )}
              <button type="button" onClick={() => setEditingDescription(false)} className="text-zinc-400 text-sm">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div
            className="mt-3 flex-1 min-h-0 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 overflow-y-auto cursor-pointer hover:border-zinc-700 transition-colors"
            onClick={() => { setDescriptionValue(description ?? ''); setEditingDescription(true); }}
            title="Click to edit description"
          >
            <p className="text-sm text-zinc-400 whitespace-pre-wrap">
              {description || <span className="italic text-zinc-500">{defaultDescription}</span>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
