import React, { useState } from "react";
import type { ChatMessage as ChatMessageType, SlotOption } from "../types/chat.js";

function formatDateTime(isoString?: string, timezone?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("en-US", {
      timeZone: timezone || undefined,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoString;
  }
}

interface ChatMessageProps {
  message: ChatMessageType;
  onBookSlot: (slot: SlotOption, email: string, timezone: string) => void;
  onReschedule?: () => void;
  onCancelBooking?: () => void;
  onSelectPrompt?: (prompt: string) => void;
  isPending: boolean;
  isLatest?: boolean;
}

/**
 * Editorial Markdown renderer: clean typography, headings, lists, bold text.
 */
function renderEditorialContent(content: string) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key} className="editorial-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      flushList(`flush-${idx}`);
      elements.push(
        <h4 key={`h4-${idx}`} className="editorial-h4">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList(`flush-${idx}`);
      elements.push(
        <h3 key={`h3-${idx}`} className="editorial-h3">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h3>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList(`flush-${idx}`);
      elements.push(
        <h2 key={`h2-${idx}`} className="editorial-h2">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h2>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2));
    } else if (trimmed.length === 0) {
      flushList(`flush-${idx}`);
    } else {
      flushList(`flush-${idx}`);
      elements.push(
        <p key={`p-${idx}`} className="editorial-paragraph">
          {renderInlineMarkdown(line)}
        </p>
      );
    }
  });

  flushList("flush-final");
  return elements;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-strong">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="text-inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function detectCaseStudy(content: string, sources?: any[]) {
  const projects = [
    { name: "Dipy", category: "UGC Marketplace Platform", desc: "Two-sided creator & brand marketplace built in 2026 on Bubble with semantic AI discovery." },
    { name: "Liya AI", category: "Enterprise Wellbeing", desc: "Conversational employee wellbeing platform delivering continuous sentiment analysis." },
    { name: "Galaxy Move", category: "Logistics & Moving Workflow", desc: "Interactive customer estimation and booking system with multi-step scheduling." },
    { name: "Randevmeste", category: "Field Service Booking", desc: "Real-time appointments engine built for field technicians and dispatchers." },
    { name: "Vigo", category: "Last-Mile Delivery Operations", desc: "Fleet operations and dispatch dashboard with route tracking and courier metrics." },
    { name: "Webiz", category: "Global Engineering Hub", desc: "Talent platform enabling rapid distributed team augmentation and developer matching." },
  ];

  for (const proj of projects) {
    const mentionsName = new RegExp(`\\b${proj.name}\\b`, "i").test(content);
    const inSource = sources?.some((s) =>
      s.section?.toLowerCase().includes(proj.name.toLowerCase())
    );
    if (mentionsName && inSource) {
      return proj;
    }
  }
  return null;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onBookSlot,
  onReschedule,
  onCancelBooking,
  onSelectPrompt,
  isPending,
  isLatest,
}) => {
  const isUser = message.role === "user";
  const [selectedSlot, setSelectedSlot] = useState<SlotOption | null>(null);
  const [emailInput, setEmailInput] = useState<string>("");
  const [timezoneInput] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    } catch {
      return "Asia/Kolkata";
    }
  });
  const [emailError, setEmailError] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [expandedSources, setExpandedSources] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSlotSelect = (slot: SlotOption) => {
    if (isPending) return;
    setSelectedSlot(slot);
    setEmailError("");
  };

  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailInput.trim() || !emailRegex.test(emailInput.trim())) {
      setEmailError("Please enter a valid email for your calendar invitation.");
      return;
    }

    onBookSlot(selectedSlot, emailInput.trim(), timezoneInput.trim());
    setSelectedSlot(null);
  };

  const caseStudy = !isUser ? detectCaseStudy(message.content, message.sources) : null;

  return (
    <div className={`editorial-message-row ${isUser ? "user-row" : "assistant-row"}`}>
      {/* USER BUBBLE (Restrained, elevated) */}
      {isUser ? (
        <div className="user-message-card">
          <p className="user-message-text">{message.content}</p>
          <span className="user-timestamp-text">{message.timestamp}</span>
        </div>
      ) : (
        /* ASSISTANT EDITORIAL PRESENTATION (Not a heavy box) */
        <div className="assistant-editorial-flow">
          {/* ASSISTANT LINEAGE HEADER */}
          <div className="assistant-flow-header">
            <div className="assistant-id-cluster">
              <div className="cf-mark-badge">
                <span>CF</span>
              </div>
              <span className="assistant-title-text">CloseFuture AI</span>
              {message.agent && (
                <span className="agent-subtle-tag">
                  {message.agent}
                </span>
              )}
            </div>

            <div className="assistant-header-right">
              <span className="assistant-timestamp-subtle">{message.timestamp}</span>
              <button
                type="button"
                className="btn-editorial-copy"
                onClick={handleCopy}
                title="Copy response"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* GUARDRAIL NOTICE (If blocked) */}
          {message.isBlocked && (
            <div className="guardrail-clean-notice">
              <span className="guardrail-dot" />
              <span>Studio Boundary Notice: Inquiries are restricted to verified capabilities, case studies, and scheduling.</span>
            </div>
          )}

          {/* EDITORIAL CASE STUDY SPOTLIGHT */}
          {caseStudy && (
            <div className="editorial-case-study-hero">
              <div className="case-study-topline">
                <span className="case-study-kicker">PROJECT SPOTLIGHT</span>
                <span className="case-study-sector">{caseStudy.category}</span>
              </div>
              <h3 className="case-study-heading">{caseStudy.name}</h3>
              <p className="case-study-summary">{caseStudy.desc}</p>
              <div className="case-study-divider" />
            </div>
          )}

          {/* BODY CONTENT (Clean Typography, generous whitespace) */}
          <div className="editorial-text-content">
            {renderEditorialContent(message.content)}
          </div>

          {/* CITATIONS COMPONENT (Understated, clickable) */}
          {message.sources && message.sources.length > 0 && (
            <div className="understated-citations-wrapper">
              <button
                type="button"
                className="btn-citation-understated"
                onClick={() => setExpandedSources((prev) => !prev)}
                title="Inspect verified ground truth"
              >
                <span className="citation-check-icon">✓</span>
                <span className="citation-label-strong">Verified source</span>
                <span className="citation-doc-ref">
                  CloseFuture Company Profile · Page {message.sources[0]?.page ?? "1"}
                </span>
                {message.sources.length > 1 && (
                  <span className="citation-more-pill">+{message.sources.length - 1} more</span>
                )}
                <span className="citation-arrow-glyph">{expandedSources ? "▴" : "▾"}</span>
              </button>

              {/* EXPANDED SOURCES PANEL */}
              {expandedSources && (
                <div className="citations-popover-panel">
                  <div className="popover-title-row">
                    <span className="popover-title">Ground Truth Chunks (pgvector)</span>
                  </div>
                  <ul className="popover-sources-list">
                    {message.sources.map((src, sIdx) => {
                      const label = [
                        src.page ? `Page ${src.page}` : null,
                        src.section ? src.section : null,
                      ].filter(Boolean).join(" — ");

                      return (
                        <li key={sIdx} className="popover-source-item">
                          <svg className="doc-icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                          <div className="doc-text-block">
                            <span className="doc-label-primary">{label || "Company Profile"}</span>
                            {src.category && <span className="doc-category-muted">{src.category}</span>}
                          </div>
                          <span className="doc-sim-score">
                            {Math.round(src.similarity * 100)}% match
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* NATIVE SCHEDULING INTERFACE */}
          {message.slots && message.slots.length > 0 && (
            <div className="native-scheduling-surface">
              <div className="scheduling-surface-header">
                <div className="sched-icon-wrapper">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </div>
                <div>
                  <h4 className="sched-header-title">Discovery Call</h4>
                  <p className="sched-header-meta">
                    30 minutes · Google Meet · {timezoneInput}
                  </p>
                </div>
              </div>

              <div className="scheduling-controls-body">
                <div className="sched-label-row">
                  <span className="sched-section-label">AVAILABLE SLOTS</span>
                  <span className="sched-tz-label">Timezone: {timezoneInput}</span>
                </div>

                <div className="sched-slots-modern-grid">
                  {message.slots.map((slot, sIdx) => {
                    const isSelected = selectedSlot?.start === slot.start;
                    return (
                      <button
                        key={sIdx}
                        type="button"
                        className={`sched-slot-pill ${isSelected ? "selected" : ""}`}
                        onClick={() => handleSlotSelect(slot)}
                        disabled={isPending}
                      >
                        <span className="slot-dot" />
                        <span className="slot-string">{slot.display}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* COMPACT CONFIRMATION FORM */}
              {selectedSlot && (
                <form onSubmit={handleConfirmBooking} className="sched-expand-booking-form">
                  <div className="booking-summary-banner">
                    <span className="banner-kicker">Selected Time:</span>
                    <strong className="banner-slot-val">{selectedSlot.display}</strong>
                  </div>

                  <div className="booking-field-group">
                    <label className="field-label-text" htmlFor={`email-field-${message.id}`}>
                      Email address for Google Calendar invitation & Meet link:
                    </label>
                    <input
                      id={`email-field-${message.id}`}
                      type="email"
                      required
                      placeholder="founder@company.com"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="sched-modern-email-input"
                      disabled={isPending}
                    />
                    {emailError && <p className="field-error-msg">{emailError}</p>}
                  </div>

                  <div className="booking-actions-cluster">
                    <button
                      type="submit"
                      className="btn-confirm-discovery"
                      disabled={isPending}
                    >
                      {isPending ? "Confirming on Google Calendar…" : "Confirm discovery call →"}
                    </button>
                    <button
                      type="button"
                      className="btn-cancel-selection"
                      onClick={() => setSelectedSlot(null)}
                      disabled={isPending}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* CONFIRMED BOOKING HERO CARD */}
          {message.booking && message.booking.meetLink && (
            <div className="confirmed-booking-hero">
              <div className="booking-hero-header">
                <div className="booking-confirmed-tag">
                  <span className="confirmed-check-glyph">✓</span>
                  <span>Discovery call confirmed</span>
                </div>
                <span className="booking-duration-badge">30 minutes</span>
              </div>

              <div className="booking-details-horizontal-bar">
                {message.booking.start && (
                  <div className="bar-cell">
                    <span className="bar-label">DATE & TIME</span>
                    <span className="bar-value">
                      {formatDateTime(message.booking.start, message.booking.timezone)}
                    </span>
                  </div>
                )}
                {message.booking.timezone && (
                  <div className="bar-cell">
                    <span className="bar-label">TIMEZONE</span>
                    <span className="bar-value">{message.booking.timezone}</span>
                  </div>
                )}
                {message.booking.attendeeEmail && (
                  <div className="bar-cell">
                    <span className="bar-label">GUEST</span>
                    <span className="bar-value">{message.booking.attendeeEmail}</span>
                  </div>
                )}
              </div>

              <div className="booking-controls-row">
                <a
                  href={message.booking.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-join-meet"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                  <span>Open meeting</span>
                </a>

                {message.booking.htmlLink && (
                  <a
                    href={message.booking.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-view-cal"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <span>Google Calendar</span>
                  </a>
                )}

                {onReschedule && (
                  <button
                    type="button"
                    className="btn-subtle-reschedule"
                    onClick={onReschedule}
                    disabled={isPending}
                  >
                    Reschedule
                  </button>
                )}

                {onCancelBooking && (
                  <button
                    type="button"
                    className="btn-subtle-cancel"
                    onClick={() => setShowCancelModal(true)}
                    disabled={isPending}
                  >
                    Cancel Call
                  </button>
                )}
              </div>

              {/* CANCEL MODAL */}
              {showCancelModal && (
                <div className="cancel-dialog-banner">
                  <p className="cancel-dialog-title">Cancel this discovery call?</p>
                  <p className="cancel-dialog-subtext">This will delete the event from Google Calendar and notify the host.</p>
                  <div className="cancel-dialog-action-row">
                    <button
                      type="button"
                      className="btn-confirm-delete"
                      onClick={() => {
                        setShowCancelModal(false);
                        onCancelBooking?.();
                      }}
                    >
                      Yes, Cancel Meeting
                    </button>
                    <button
                      type="button"
                      className="btn-abort-delete"
                      onClick={() => setShowCancelModal(false)}
                    >
                      Keep Meeting
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CONTEXTUAL ACTION SUGGESTIONS */}
          {isLatest && !isPending && onSelectPrompt && (
            <div className="contextual-followups-cluster">
              <button
                type="button"
                className="btn-followup-pill"
                onClick={() => onSelectPrompt("Tell me more about CloseFuture's delivery process.")}
              >
                <span>Delivery Process</span>
                <span className="pill-arrow-char">→</span>
              </button>
              <button
                type="button"
                className="btn-followup-pill"
                onClick={() => onSelectPrompt("Show me other case studies.")}
              >
                <span>Other Case Studies</span>
                <span className="pill-arrow-char">→</span>
              </button>
              <button
                type="button"
                className="btn-followup-pill"
                onClick={() => onSelectPrompt("Can I book a discovery call?")}
              >
                <span>Book Discovery Call</span>
                <span className="pill-arrow-char">→</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
