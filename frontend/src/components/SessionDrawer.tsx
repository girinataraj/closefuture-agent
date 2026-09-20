import React, { useState } from "react";
import type { SessionIndexItem } from "../types/chat.js";

interface SessionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSessionId: string;
  sessions: SessionIndexItem[];
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return "";
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return new Date(isoString).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export const SessionDrawer: React.FC<SessionDrawerProps> = ({
  isOpen,
  onClose,
  activeSessionId,
  sessions,
  onSelectSession,
  onNewSession,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const filteredSessions = sessions
    .filter((s) => s.title && s.title.trim() !== "New Conversation")
    .filter(
      (s) =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <>
      {/* BACKDROP OVERLAY */}
      <div className="session-overlay-backdrop" onClick={onClose} aria-hidden="true" />

      {/* SLIDE-OUT SESSIONS DRAWER */}
      <aside className="session-slideover-drawer">
        <div className="drawer-header-bar">
          <div className="drawer-header-left">
            <span className="drawer-kicker">CONVERSATIONS</span>
          </div>
          <button
            type="button"
            className="btn-drawer-exit"
            onClick={onClose}
            title="Close sessions"
            aria-label="Close sessions"
          >
            ✕
          </button>
        </div>

        {/* NEW SESSION ACTION */}
        <div className="drawer-action-block">
          <button
            type="button"
            className="btn-new-session-cta"
            onClick={() => {
              onNewSession();
              onClose();
            }}
          >
            <svg className="plus-icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>New Conversation</span>
          </button>
        </div>

        {/* SEARCH INPUT */}
        <div className="drawer-search-row">
          <svg className="search-glyph" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="drawer-search-input"
            placeholder="Search recent conversations…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="btn-clear-search"
              onClick={() => setSearchQuery("")}
            >
              ✕
            </button>
          )}
        </div>

        {/* RECENT SESSIONS LIST */}
        <div className="drawer-sessions-scroll">
          <span className="session-group-kicker">RECENT SESSIONS</span>

          {filteredSessions.length === 0 ? (
            <div className="drawer-quiet-empty">
              <svg className="empty-bubble-svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p className="empty-lead">{searchQuery ? "No matching conversations" : "No recent conversations"}</p>
              <p className="empty-subtext">Conversations you start are stored in Supabase and will appear here.</p>
            </div>
          ) : (
            <ul className="sessions-list-ul">
              {filteredSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`session-list-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        onSelectSession(session.id);
                        onClose();
                      }}
                    >
                      <div className="item-title-row">
                        <span className="item-title" title={session.title}>
                          {session.title}
                        </span>
                        {isActive && <span className="active-dot-glyph" />}
                      </div>
                      <div className="item-meta-row">
                        <span className="item-relative-time">
                          {formatRelativeTime(session.lastActive)}
                        </span>
                        <span className="item-compact-id">
                          {session.id.slice(0, 6)}…
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* FOOTER */}
        <div className="drawer-quiet-footer">
          <span className="studio-engine-tag">CloseFuture Studio v1.0 • Supabase</span>
        </div>
      </aside>
    </>
  );
};
