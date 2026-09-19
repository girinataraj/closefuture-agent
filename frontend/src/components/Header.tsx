import React, { useState, useEffect } from "react";

interface HeaderProps {
  sessionId: string;
  onNewChat: () => void;
  showTrace: boolean;
  onToggleTrace: () => void;
  onToggleSessions: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  sessionId,
  onNewChat,
  showTrace,
  onToggleTrace,
  onToggleSessions,
}) => {
  const [copied, setCopied] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Scroll-aware header opacity
  useEffect(() => {
    const scrollArea = document.querySelector(".messages-scroll-area");
    if (!scrollArea) return;
    const onScroll = () => setScrolled(scrollArea.scrollTop > 16);
    scrollArea.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollArea.removeEventListener("scroll", onScroll);
  }, []);

  const handleCopySession = () => {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isActive = !!sessionId;
  // Short tooltip-style ID: first 8 + last 4 chars
  const shortId = sessionId
    ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
    : "";

  return (
    <header className={`minimal-header${scrolled ? " scrolled" : ""}`}>

      {/* ── LEFT: MENU + BRAND ──────────────────────────────────── */}
      <div className="header-left-cluster">
        <button
          type="button"
          className="btn-menu-drawer"
          onClick={onToggleSessions}
          title="Session history"
          aria-label="Toggle session history"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.75"
            strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6"  x2="21" y2="6"  />
            <line x1="3" y1="12" x2="14" y2="12" />
            <line x1="3" y1="18" x2="17" y2="18" />
          </svg>
        </button>

        <div className="header-brand-lockup">
          <div className="brand-mark">
            <span>CF</span>
          </div>
          <div className="brand-text-stack">
            <span className="brand-wordmark">CloseFuture AI</span>
            <span className="brand-sub">AI Product Studio</span>
          </div>
        </div>
      </div>

      {/* ── CENTER: AMBIENT STATUS ──────────────────────────────── */}
      <div className="header-ambient-status" aria-hidden="true">
        <span className="status-pulse-dot" />
        <span className="status-ambient-label">AI assistant online</span>
      </div>

      {/* ── RIGHT: CONTROLS ─────────────────────────────────────── */}
      <div className="header-right-cluster">

        {/* Session — quiet utility, tooltip reveals ID */}
        <button
          type="button"
          className={`btn-session-state${isActive ? " is-active" : ""}`}
          onClick={handleCopySession}
          aria-label="Session status — click to copy session ID"
          data-tooltip={copied ? "Copied!" : shortId || "No session"}
        >
          <span className={`session-state-dot${isActive ? " dot-active" : " dot-idle"}`} />
          <span className="session-state-label">
            {copied ? "Copied" : isActive ? "Session active" : "No session"}
          </span>
        </button>

        <span className="header-ctrl-divider" aria-hidden="true" />

        {/* New Chat — primary */}
        <button
          type="button"
          className="btn-new-chat"
          onClick={onNewChat}
          title="Start a new conversation"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5"  x2="12" y2="19" />
            <line x1="5"  y1="12" x2="19" y2="12" />
          </svg>
          <span>New Chat</span>
        </button>

        {/* Inspector — secondary */}
        <button
          type="button"
          className={`btn-inspector${showTrace ? " active" : ""}`}
          onClick={onToggleTrace}
          title={showTrace ? "Close inspector" : "Open developer inspector"}
        >
          <svg className="inspector-icon" width="11" height="11"
            viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Inspector</span>
        </button>

      </div>
    </header>
  );
};
