'use client';
import { useEffect, useRef } from 'react';

export default function useDialogFocus(ref, open, onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')]
      .filter((el) => el.getClientRects().length > 0);
    (controls()[0] || dialog).focus();
    const keydown = (e) => {
      const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]')];
      if (dialogs.at(-1) !== dialog) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const targets = controls();
        const first = targets[0], last = targets.at(-1);
        if (!first) { e.preventDefault(); dialog.focus(); }
        else if (!dialog.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = oldOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, open]);
}
