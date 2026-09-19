import React from "react";
import type { SanitizedTrace } from "../types/chat.js";

interface TracePanelProps {
  sessionId: string;
  trace: SanitizedTrace | null;
  lastAgent?: string;
  onClose?: () => void;
}

export const TracePanel: React.FC<TracePanelProps> = ({
  sessionId,
  trace,
  lastAgent,
  onClose,
}) => {
  const truncatedSession = sessionId
    ? `${sessionId.slice(0, 10)}...${sessionId.slice(-6)}`
    : "None";

  return (
    <aside className="trace-panel-container">
      <div className="trace-panel-header">
        <div className="trace-title-row">
          <span className="trace-icon">⚡</span>
          <h3 className="trace-panel-title">Developer Trace</h3>
        </div>
        {onClose && (
          <button type="button" className="btn-close-trace" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      <div className="trace-section">
        <span className="trace-label">Active Session:</span>
        <code className="trace-code-inline" title={sessionId}>
          {truncatedSession}
        </code>
      </div>

      {!trace ? (
        <div className="trace-empty-notice">
          <p>No messages processed yet.</p>
          <small>Send a prompt to inspect real multi-agent pipeline routing and MCP tool executions.</small>
        </div>
      ) : (
        <div className="trace-body">
          {/* PIPELINE EXECUTION STAGES */}
          <div className="trace-section">
            <span className="trace-label">Pipeline Execution Stages:</span>
            <div className="trace-stages-list">
              {trace.stages && trace.stages.length > 0 ? (
                trace.stages.map((stage, sIdx) => {
                  const isBlocked = stage.status === "blocked";
                  const isFailed = stage.status === "failed";
                  const isSuccess = stage.status === "success";

                  const statusClass = isBlocked
                    ? "stage-blocked"
                    : isFailed
                    ? "stage-failed"
                    : isSuccess
                    ? "stage-success"
                    : "stage-skipped";

                  const icon = isBlocked ? "✕" : isFailed ? "!" : "✓";

                  return (
                    <div key={sIdx} className={`trace-stage-item ${statusClass}`}>
                      <span className="stage-icon-badge">{icon}</span>
                      <div className="stage-info">
                        <span className="stage-name">{stage.name}</span>
                        {stage.details && (
                          <span className="stage-details">{stage.details}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="trace-subtext">No stages recorded.</div>
              )}
            </div>
          </div>

          {/* INTENT & CONFIDENCE */}
          <div className="trace-grid-two">
            <div className="trace-metric-card">
              <span className="trace-label">Intent:</span>
              <span className="trace-metric-value">{trace.intent || "unknown"}</span>
            </div>
            <div className="trace-metric-card">
              <span className="trace-label">Confidence:</span>
              <span className="trace-metric-value">
                {trace.confidence !== undefined
                  ? `${Math.round(trace.confidence * 100)}%`
                  : "N/A"}
              </span>
            </div>
          </div>

          {/* ACTIVE AGENT */}
          {lastAgent && (
            <div className="trace-section">
              <span className="trace-label">Active Agent:</span>
              <span className="trace-agent-pill">{lastAgent.toUpperCase()}</span>
            </div>
          )}

          {/* RETRIEVED CHUNKS & SOURCES */}
          <div className="trace-section">
            <span className="trace-label">
              Grounding Chunks: {trace.retrievedChunks ?? 0}
            </span>
            {trace.sources && trace.sources.length > 0 ? (
              <ul className="trace-sources-list">
                {trace.sources.map((src, idx) => (
                  <li key={idx} className="trace-source-item">
                    <span>
                      Page {src.page ?? "?"} — {src.section || "General"}
                    </span>
                    <span className="trace-sim-badge">
                      {(src.similarity * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="trace-subtext">No RAG retrieval for this intent.</div>
            )}
          </div>

          {/* MCP TOOLS */}
          {trace.mcpTools && trace.mcpTools.length > 0 && (
            <div className="trace-section">
              <span className="trace-label">MCP Tools Invoked:</span>
              <div className="trace-mcp-tags">
                {trace.mcpTools.map((tool, idx) => (
                  <span key={idx} className="mcp-tool-tag">
                    🔧 {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* PRIVACY & SECURITY FOOTER */}
          <div className="trace-security-footer">
            <span className="security-icon">🔒</span>
            <span>
              Telemetry Sanitized: Internal lead scores, system prompts, and OAuth secrets are strictly excluded.
            </span>
          </div>
        </div>
      )}
    </aside>
  );
};
