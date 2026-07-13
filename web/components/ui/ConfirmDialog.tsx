'use client';

import { Button } from './Button';
import { Overlay } from './Overlay';

/**
 * A themed yes/no confirmation, reusing the same Overlay + Button language as
 * the rest of the app instead of the browser's native `confirm()` (which would
 * look jarring against the dark card-table aesthetic).
 */
export function ConfirmDialog({
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Overlay>
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-table ring-1 ring-gold/30">
        <p className="text-ink">{message}</p>
        <div className="mt-5 flex justify-center gap-3">
          <Button variant="secondary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
