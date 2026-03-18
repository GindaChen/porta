/**
 * Toast notifications — in-app notification overlay.
 * Shows at the top of the screen, auto-dismisses, works everywhere.
 */

import type { Toast } from "../hooks/useNotifications";

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-item"
          onClick={() => onDismiss(toast.id)}
        >
          <div className="toast-title">{toast.title}</div>
          <div className="toast-body">{toast.body}</div>
        </div>
      ))}
    </div>
  );
}
