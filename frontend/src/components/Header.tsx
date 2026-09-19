import React, { useState } from "react";

interface HeaderProps {
  sessionId: string;
  onNewChat: () => void;
  showTrace: boolean;
  onToggleTrace: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  sessionId,
  onNewChat,
  showTrace,
  onToggleTrace,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopySession = () => {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const truncatedSession = sessionId
    ? `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}`
    : "Initializing...";

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-logo-badge">CF</div>
        <div>
          <h1 className="brand-title">CloseFuture AI Assistant</h1>
          <p className="brand-subtitle">AI-powered product studio assistant</p>
        </div>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="session-badge-button"
          onClick={handleCopySession}
          title="Click to copy full Session ID"
        >
          <span className="session-dot" />
          <span className="session-text">Session: {truncatedSession}</span>
          {copied ? (
            <span className="copied-pill">Copied!</span>
          ) : (
            <span className="copy-hint" aria-hidden="true">📋</span>
          )}
        </button>

        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={onNewChat}
          title="Start a fresh chat session"
        >
          <span>＋</span> New Chat
        </button>

        <button
          type="button"
          className={`btn-secondary btn-sm ${showTrace ? "btn-active" : ""}`}
          onClick={onToggleTrace}
          title="Toggle developer trace inspector"
        >
          <span>⚡</span> Trace {showTrace ? "ON" : "OFF"}
        </button>
      </div>
    </header>
  );
};
