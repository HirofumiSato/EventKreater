"use client";

interface ToastProps {
  message: string;
  tone?: "success" | "error";
  onClose: () => void;
}

export function Toast({ message, tone = "success", onClose }: ToastProps) {
  return (
    <div className="toast">
      <div className={`alert ${tone === "success" ? "alert--success" : "alert--error"}`}>
        <div className="summary" style={{ border: 0, padding: 0 }}>
          <p>{message}</p>
          <button type="button" onClick={onClose} className="btn btn--ghost btn--sm">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
