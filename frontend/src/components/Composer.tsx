import React, { useRef, useEffect } from "react";

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  isPending: boolean;
  errorMessage: string | null;
  onDismissError: () => void;
}

export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSend,
  isPending,
  errorMessage,
  onDismissError,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const nextHeight = Math.min(textareaRef.current.scrollHeight, 180);
      textareaRef.current.style.height = `${Math.max(nextHeight, 46)}px`;
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="composer-dock-container">
      {errorMessage && (
        <div className="composer-toast-error">
          <svg className="toast-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="toast-text">{errorMessage}</span>
          <button
            type="button"
            className="btn-close-toast"
            onClick={onDismissError}
            title="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* FLOATING LUXURY COMPOSER SURFACE */}
      <div className={`composer-floating-shell ${isPending ? "pending" : ""}`}>
        <div className="composer-input-row">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isPending}
            placeholder="Ask CloseFuture anything…"
            className="composer-native-textarea"
          />

          <button
            type="button"
            className={`btn-send-round ${value.trim() && !isPending ? "has-input" : ""}`}
            onClick={onSend}
            disabled={isPending || !value.trim()}
            title="Send prompt"
            aria-label="Send prompt"
          >
            {isPending ? (
              <span className="send-spinner" />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            )}
          </button>
        </div>

        {/* METADATA SUB-BAR */}
        <div className="composer-metadata-bar">
          <div className="metadata-left">
            <svg className="knowledge-shield-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>Grounded in CloseFuture knowledge</span>
          </div>
          <div className="metadata-right">
            <span>Enter to send</span>
            <span className="shortcut-dot">·</span>
            <span>Shift+Enter for newline</span>
          </div>
        </div>
      </div>
    </div>
  );
};
