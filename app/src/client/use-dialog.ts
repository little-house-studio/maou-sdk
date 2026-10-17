import { useEffect, useRef } from "react";

/** Keep keyboard focus inside the active dialog and restore its opener on close. */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((el) => !el.closest('[hidden], [inert]') && el.getClientRects().length > 0);
    (focusable()[0] ?? dialog).focus();
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialog || e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab") {
        const items = focusable();
        const first = items[0] ?? dialog;
        const last = items[items.length - 1] ?? dialog;
        if (!dialog.contains(document.activeElement) ||
            (e.shiftKey && document.activeElement === first) ||
            (!e.shiftKey && document.activeElement === last) || items.length === 0) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus();
    };
  }, [open]);
  return ref;
}
