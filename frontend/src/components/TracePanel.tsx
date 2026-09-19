import React from "react";
import type { SanitizedTrace } from "../types/chat.js";

interface TracePanelProps {
  sessionId: string;
  trace: SanitizedTrace | null;
  lastAgent?: string;
  onClose: () => void;
}

export const TracePanel: React.FC<TracePanelProps> = ({
  sessionId,
  trace,
  lastAgent,
  onClose,
}) => {
  const compactId = sessionId
    ? `${sessionId.slice(0, 8)}…${sessionId.slice(-6)}`
    : "None";

  return (
    <>
      {/* BACKDROP OVERLAY */}
      <div className="inspector-overlay-backdrop" onClick={onClose} aria-hidden="true" />

      {/* FLOATING OVERLAY DRAWER */}
      <aside className="inspector-slideover-drawer">
        {/* HEADER */}
        <div className="inspector-drawer-header">
          <div className="inspector-header-meta">
            <svg className="inspector-bolt-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <div>
              <h3 className="drawer-title-main">Developer Inspector</h3>
              <span className="drawer-subtitle-muted">Agent Orchestration & Observability</span>
            </div>
          </div>
          <button
            type="button"
            className="btn-drawer-exit"
            onClick={onClose}
            title="Close inspector"
            aria-label="Close inspector"
          >
            ✕
          </button>
        </div>

        {/* ACTIVE SESSION ROW */}
        <div className="inspector-row-session">
          <span className="session-section-kicker">SESSION</span>
          <code className="session-id-display" title={sessionId}>
            {compactId}
          </code>
        </div>

        {/* BODY */}
        {!trace ? (
          <div className="inspector-quiet-empty-state">
            <svg className="empty-sparkle-svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <h4 className="empty-state-title">No execution trace yet</h4>
            <p className="empty-state-text">
              Send a prompt to inspect live agent routing, intent classification, and MCP tool execution in real time.
            </p>
          </div>
        ) : (
          <div className="inspector-drawer-scroll-body">
            {/* INTENT & CONFIDENCE */}
            <div className="drawer-metric-grid">
              <div className="metric-card-box">
                <span className="metric-header-kicker">DETECTED INTENT</span>
                <span className="metric-display-val intent-accent">
                  {trace.intent ? trace.intent.toUpperCase() : "UNKNOWN"}
                </span>
              </div>
              <div className="metric-card-box">
                <span className="metric-header-kicker">CONFIDENCE</span>
                <span className="metric-display-val confidence-green">
                  {trace.confidence !== undefined
                    ? `${Math.round(trace.confidence * 100)}%`
                    : "N/A"}
                </span>
              </div>
            </div>

            {/* ACTIVE EXECUTOR AGENT */}
            {lastAgent && (
              <div className="drawer-section-group">
                <span className="section-kicker-label">EXECUTOR AGENT</span>
                <div className="active-agent-chip">
                  <span className="agent-status-dot" />
                  <span className="agent-display-name">{lastAgent.toUpperCase()}</span>
                </div>
              </div>
            )}

            {/* AGENT PIPELINE TRANSITIONS */}
            <div className="drawer-section-group">
              <span className="section-kicker-label">PIPELINE FLOW</span>
              <div className="pipeline-flow-tree">
                {trace.stages && trace.stages.length > 0 ? (
                  trace.stages.map((stage, sIdx) => {
                    const isSuccess = stage.status === "success";
                    const isBlocked = stage.status === "blocked";
                    const isFailed = stage.status === "failed";

                    const statusBadgeClass = isBlocked
                      ? "badge-blocked"
                      : isFailed
                      ? "badge-failed"
                      : isSuccess
                      ? "badge-success"
                      : "badge-skipped";

                    const iconGlyph = isBlocked ? "✕" : isFailed ? "!" : isSuccess ? "✓" : "–";

                    return (
                      <div key={sIdx} className={`pipeline-stage-card ${statusBadgeClass}`}>
                        <span className="stage-glyph">{iconGlyph}</span>
                        <div className="stage-text-block">
                          <span className="stage-name-text">{stage.name}</span>
                          {stage.details && <span className="stage-detail-sub">{stage.details}</span>}
                        </div>
                        <span className="stage-status-text">{stage.status}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="no-data-notice">No pipeline stages recorded.</div>
                )}
              </div>
            </div>

            {/* GROUNDING SOURCES (RAG) */}
            <div className="drawer-section-group">
              <div className="section-kicker-row">
                <span className="section-kicker-label">GROUNDING SOURCES</span>
                <span className="chunks-badge">{trace.retrievedChunks ?? 0} Chunks</span>
              </div>

              {trace.sources && trace.sources.length > 0 ? (
                <ul className="grounding-chunks-list">
                  {trace.sources.map((src, idx) => (
                    <li key={idx} className="grounding-chunk-row">
                      <svg className="doc-icon-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <div className="doc-detail-col">
                        <span className="doc-title-string">
                          Page {src.page ?? "?"} — {src.section || "Company Profile"}
                        </span>
                        {src.category && <span className="doc-category-pill">{src.category}</span>}
                      </div>
                      <span className="doc-match-val">
                        {Math.round(src.similarity * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="no-data-notice">No vector search chunks required for this intent.</div>
              )}
            </div>

            {/* MCP TOOLS */}
            {trace.mcpTools && trace.mcpTools.length > 0 && (
              <div className="drawer-section-group">
                <span className="section-kicker-label">MCP TOOLS (STDIO JSON-RPC)</span>
                <div className="mcp-tags-row">
                  {trace.mcpTools.map((tool, idx) => (
                    <span key={idx} className="mcp-tool-pill">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                      </svg>
                      <span>{tool}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* SECURITY ASSURANCE */}
            <div className="drawer-security-footer">
              <svg className="security-icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <p>
                Sanitized Telemetry: Internal lead scores, sales priority tiers, and OAuth credentials are never sent to the client.
              </p>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
