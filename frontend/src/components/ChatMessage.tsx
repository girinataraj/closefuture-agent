import React, { useState } from "react";
import type { ChatMessage as ChatMessageType, SlotOption } from "../types/chat.js";

function formatDateTime(isoString?: string, timezone?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("en-US", {
      timeZone: timezone || "Asia/Kolkata",
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
 * Returns true for lines that are raw source metadata injected by the RAG layer or LLM.
 * Matches patterns like:
 *   "Source: Page 5 — Services"
 *   "Sources: Page 8"
 *   "**Source:** Page 5"
 *   "- **Source:** Page 5"
 *   "### Sources"
 *   "Page 5 — Services & Process"
 * These are fully hidden when a structured citation component is already rendered.
 */
function isRawSourceLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // 1. Strip leading list bullet markers: "- ", "* ", "• ", "1. "
  const withoutBullet = trimmed.replace(/^([-*•]|\d+\.)\s+/, "").trim();

  // 2. Line starts with Source / Sources (with optional bold, italics, parenthesis, bracket, colon, dash)
  // Matches:
  // "Source: ...", "Sources: ...", "Source(s): ..."
  // "**Source:** ...", "**Sources:** ...", "**Source**: ..."
  // "*Source:* ...", "*Sources:* ...", "_Source:_ ..."
  // "(Source: ...)", "[Source: ...]", "(Sources: ...)"
  // "### Sources:", "## Source:"
  if (/^(?:#{1,6}\s+)?(?:\(|\[)?\s*[*_`]*\s*sources?(?:\(s\))?\s*[*_`]*\s*[:\-—]/i.test(withoutBullet)) {
    return true;
  }

  // 3. Standalone Source header/label:
  // "Sources:", "Source:", "### Sources", "### Source", "**Sources**", "**Source:**", "Sources"
  if (/^(?:#{1,6}\s+)?(?:\(|\[)?\s*[*_`]*\s*sources?(?:\(s\))?\s*[*_`]*\s*[:\-—]?\s*(?:\)|\])?$/i.test(withoutBullet)) {
    return true;
  }

  // 4. Standalone page citation lines:
  // "Page 5 — Services & Process", "Page 5, Section 2", "Page 5", "(Page 5)", "CloseFuture Company Profile, Page 5"
  if (/^(?:closefuture\s+company\s+profile[,\s—–-]+)?page\s+\d+/i.test(withoutBullet)) {
    return true;
  }

  return false;
}

/**
 * Strips trailing inline source citations from a sentence or paragraph
 * e.g. "CloseFuture provides AI engineering (Source: Page 5)." -> "CloseFuture provides AI engineering."
 */
function stripInlineSourceCitation(text: string): string {
  return text
    .replace(/\s*(?:\(|\[)?\s*[*_`]*\s*sources?(?:\(s\))?\s*[*_`]*\s*[:\-—]\s*[^)\].\n]+(?:\)|\])?\.?\s*$/i, "")
    .trim();
}

const OUTDATED_BOOKING_REGEX = /(?:cal\.?com|closefuture\/meet|book (?:a )?(?:discovery )?call directly|direct meeting booking)/i;

/**
 * Removes sentences or fragments referencing outdated external booking routes:
 * - cal.com
 * - cal.com/closefuture/meet
 * - "book a discovery call directly at"
 * - "book a call directly at"
 * Preserves unrelated useful company contact information and normalizes whitespace/punctuation.
 */
function sanitizeOutdatedBookingReferences(content: string): string {
  if (!content) return "";

  // 1. Strip parenthetical and bracketed clauses mentioning cal.com or booking directly at:
  // e.g. "Our assistant can help (or you can book directly at cal.com/closefuture/meet)."
  // -> "Our assistant can help."
  let sanitized = content
    .replace(/\s*\([^)]*(?:cal\.?com|closefuture\/meet|book (?:a )?(?:discovery )?call directly)[^)]*\)/gi, "")
    .replace(/\s*\[[^\]]*(?:cal\.?com|closefuture\/meet|book (?:a )?(?:discovery )?call directly)[^\]]*\](?:\([^\)]*\))?/gi, "");

  const lines = sanitized.split("\n");
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      cleanedLines.push("");
      continue;
    }

    if (!OUTDATED_BOOKING_REGEX.test(trimmed)) {
      cleanedLines.push(line);
      continue;
    }

    // If the whole line is a bullet item or header referencing cal.com/booking directly:
    // e.g. "- **Direct Meeting Booking**: cal.com/closefuture/meet"
    if (/^[-*•#\d.]\s+/i.test(trimmed) && OUTDATED_BOOKING_REGEX.test(trimmed)) {
      continue;
    }

    // Sentence splitting: match text ending with sentence-ending punctuation followed by space/capital or end of line.
    // Crucially avoids splitting at internal dots inside URLs/domains (e.g. cal.com)
    const sentenceRegex = /.*?(?:[.!?](?=\s+[A-Z0-9]|\s*$)|\n|$)/g;
    const sentences = trimmed.match(sentenceRegex)?.filter((s) => s.trim().length > 0) || [trimmed];

    const keptSentences = sentences.filter((s) => !OUTDATED_BOOKING_REGEX.test(s));
    const cleanedLine = keptSentences.join(" ").trim();

    if (cleanedLine) {
      // Normalize any double spaces or punctuation spacing left over
      const normalized = cleanedLine
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.!?])/g, "$1")
        .trim();
      if (normalized && !OUTDATED_BOOKING_REGEX.test(normalized)) {
        cleanedLines.push(normalized);
      }
    }
  }

  return cleanedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Editorial Markdown renderer — clean typography, headings, lists, bold text.
 * When hasSources=true, lines matching raw "Source: Page N" patterns are fully hidden.
 * When hideCalCom=true, any lines/sentences referencing Cal.com or direct booking links are omitted.
 */
function renderEditorialContent(content: string, hasSources = false, hideCalCom = false) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let inRawSourceSection = false;

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

    // 1. Skip Cal.com and direct booking references when native scheduling is active
    if (
      hideCalCom &&
      OUTDATED_BOOKING_REGEX.test(trimmed)
    ) {
      flushList(`flush-${idx}`);
      return;
    }

    // 2. Fully hide raw source lines when structured citations are already rendered.
    if (hasSources) {
      if (isRawSourceLine(trimmed)) {
        inRawSourceSection = true;
        flushList(`flush-${idx}`);
        return;
      }
      // If following a Sources header, also skip subordinate citation items
      if (inRawSourceSection) {
        if (trimmed.length === 0) {
          return;
        }
        if (/^([-*•]|\d+\.)\s+/i.test(trimmed) || /^(page\s+\d+|closefuture)/i.test(trimmed.replace(/^[-*•\s]+/, ""))) {
          flushList(`flush-${idx}`);
          return;
        } else {
          inRawSourceSection = false;
        }
      }
    }

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
      const rawItem = trimmed.slice(2);
      let cleanedItem = hasSources ? stripInlineSourceCitation(rawItem) : rawItem;
      if (hideCalCom) {
        cleanedItem = sanitizeOutdatedBookingReferences(cleanedItem);
      }
      if (cleanedItem) {
        listItems.push(cleanedItem);
      }
    } else if (trimmed.length === 0) {
      flushList(`flush-${idx}`);
    } else {
      flushList(`flush-${idx}`);
      let cleanedLine = hasSources ? stripInlineSourceCitation(line) : line;
      if (hideCalCom) {
        cleanedLine = sanitizeOutdatedBookingReferences(cleanedLine);
      }
      if (cleanedLine) {
        elements.push(
          <p key={`p-${idx}`} className="editorial-paragraph">
            {renderInlineMarkdown(cleanedLine)}
          </p>
        );
      }
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

/**
 * Detects a known project in the response content AND in the source chunks.
 * Returns only { name, category } — NO fabricated desc, outcome, or metrics.
 * The actual project description is rendered from the response body itself.
 */
function detectCaseStudy(content: string, sources?: any[]) {
  const projects = [
    { name: "Dipy",        category: "UGC Marketplace Platform" },
    { name: "Liya AI",     category: "Enterprise Wellbeing" },
    { name: "Galaxy Move", category: "Logistics & Moving Workflow" },
    { name: "Randevmeste", category: "Field Service Booking" },
    { name: "Vigo",        category: "Last-Mile Delivery Operations" },
    { name: "Webiz",       category: "Global Engineering Hub" },
  ];

  for (const proj of projects) {
    const mentionsName = new RegExp(`\\b${proj.name}\\b`, "i").test(content);
    const inSource = sources?.some((s) =>
      s.section?.toLowerCase().includes(proj.name.toLowerCase())
    );
    // Only show spotlight when BOTH conditions are met — name in response AND in RAG source
    if (mentionsName && inSource) {
      return proj;
    }
  }
  return null;
}

const NO_ANSWER_PATTERNS = [
  /i don'?t have (reliable|sufficient|enough|verified|accurate)/i,
  /i (don'?t|do not|cannot|can'?t) (find|locate|provide|access|retrieve)/i,
  /no (reliable|verified|accurate|sufficient) (information|data|knowledge)/i,
  /not (available|found|in my knowledge|in the knowledge base)/i,
  /outside (my|the) (knowledge|scope|verified)/i,
];

/**
 * Strips contradictory no-answer disclaimers and redundant scheduling transition boilerplate
 * from response body when scheduling continuation UI or slots are rendered.
 */
function cleanSchedulingBodyText(content: string, isSchedulingFlow: boolean): string {
  if (!isSchedulingFlow) return content;

  const lines = content.split("\n");
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      cleaned.push(line);
      continue;
    }

    // Strip contradictory no-answer disclaimers when scheduling continuation UI is rendered
    if (NO_ANSWER_PATTERNS.some((re) => re.test(trimmed))) {
      const sentences = line.match(/[^.!?]+(?:[.!?]+["']?\s*|$)/g);
      if (sentences && sentences.length > 1) {
        const kept = sentences.filter((s) => !NO_ANSWER_PATTERNS.some((re) => re.test(s))).join("").trim();
        if (kept) cleaned.push(kept);
      }
      continue;
    }

    // Strip redundant scheduling transition boilerplate when scheduling UI is already rendered
    const isTransition =
      /to schedule (your|a) discovery call/i.test(trimmed) &&
      /(?:scheduling assistant|timezone|preferred day|arrange this for you)/i.test(trimmed);
    if (isTransition) {
      continue;
    }

    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
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
  const [timezoneInput] = useState<string>("Asia/Kolkata");
  const [emailError, setEmailError] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [expandedSources, setExpandedSources] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);

  // Only use the case-study spotlight when content AND sources confirm the project.
  const caseStudy = !isUser ? detectCaseStudy(message.content, message.sources) : null;
  const hasSources = !!(message.sources && message.sources.length > 0);

  /**
   * MULTI-INTENT & SCHEDULING FLOW:
   * Detect when native scheduling flow or booking intent is active.
   */
  const hasSchedulingData = !!(message.slots?.length || message.booking || message.awaitingSchedule);
  const hasSchedulingIntent = !!(
    (message.trace?.intent &&
      ["booking", "scheduling", "discovery_call", "book"].some((i) =>
        message.trace!.intent.toLowerCase().includes(i)
      )) ||
    message.agent?.toLowerCase().includes("schedul")
  );
  const shouldSanitizeBookingReferences = !!(
    hasSchedulingData ||
    hasSchedulingIntent ||
    /cal\.?com/i.test(message.content) ||
    /book (?:a )?(?:discovery )?call directly/i.test(message.content)
  );

  // When native scheduling flow or intent is present, remove outdated Cal.com references, contradictory no-answer text, and redundant transition boilerplate
  let contentToDisplay = shouldSanitizeBookingReferences
    ? sanitizeOutdatedBookingReferences(message.content)
    : message.content;
  if (hasSchedulingData) {
    contentToDisplay = cleanSchedulingBodyText(contentToDisplay, true);
  }

  const suppressBody =
    hasSchedulingData &&
    (contentToDisplay.trim().length === 0 ||
      (NO_ANSWER_PATTERNS.some((re) => re.test(message.content)) && !hasSources));

  const handleCopy = () => {
    navigator.clipboard.writeText(contentToDisplay).then(() => {
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

  return (
    <div className={`editorial-message-row ${isUser ? "user-row" : "assistant-row"}`}>
      {/* USER BUBBLE */}
      {isUser ? (
        <div className="user-message-card">
          <p className="user-message-text">{message.content}</p>
          <span className="user-timestamp-text">{message.timestamp}</span>
        </div>
      ) : (
        /* ASSISTANT EDITORIAL PRESENTATION */
        <div className="assistant-editorial-flow">
          {/* ASSISTANT LINEAGE HEADER */}
          <div className="assistant-flow-header">
            <div className="assistant-id-cluster">
              <div className="cf-mark-badge">
                <span>CF</span>
              </div>
              <span className="assistant-title-text">CloseFuture AI</span>
              {message.agent && (
                <span className="agent-subtle-tag">{message.agent.trim()}</span>
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

          {/* GUARDRAIL NOTICE */}
          {message.isBlocked && (
            <div className="guardrail-clean-notice">
              <span className="guardrail-dot" />
              <span>Studio Boundary Notice: Inquiries are restricted to verified capabilities, case studies, and scheduling.</span>
            </div>
          )}

          {/* CASE STUDY SPOTLIGHT
              — Only rendered when content + sources confirm a known project.
              — No static fabricated description: category label + kicker only.
              — The response body (rendered below) carries the actual project detail. */}
          {caseStudy && (
            <div className="editorial-case-study-hero">
              <div className="case-study-topline">
                <span className="case-study-kicker">PROJECT SPOTLIGHT</span>
                <span className="case-study-sector">{caseStudy.category}</span>
              </div>
              <h3 className="case-study-heading">{caseStudy.name}</h3>
              <div className="case-study-divider" />
            </div>
          )}

          {/* BODY CONTENT
              Suppressed when body contradicts scheduling data (multi-intent case).
              hasSources=true causes raw "Source: Page N" lines to be fully hidden.
              isNativeSchedulingFlow=true causes Cal.com sentences to be hidden. */}
          {!suppressBody && contentToDisplay.trim().length > 0 && (
            <div className="editorial-text-content">
              {renderEditorialContent(contentToDisplay, hasSources, shouldSanitizeBookingReferences)}
            </div>
          )}

          {/* CITATIONS COMPONENT */}
          {hasSources && (
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
                  CloseFuture Company Profile · Page {message.sources![0]?.page ?? "1"}
                </span>
                {message.sources!.length > 1 && (
                  <span className="citation-more-pill">+{message.sources!.length - 1} more</span>
                )}
                <span className="citation-arrow-glyph">{expandedSources ? "▴" : "▾"}</span>
              </button>

              {expandedSources && (
                <div className="citations-popover-panel">
                  <div className="popover-title-row">
                    <span className="popover-title">Ground Truth Chunks (pgvector)</span>
                  </div>
                  <ul className="popover-sources-list">
                    {message.sources!.map((src, sIdx) => {
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

          {/* INLINE SCHEDULING PROMPT
              Rendered when backend signals scheduling intent but needs
              timezone / preferred day before fetching real Google Calendar slots.
              User clicks "Check availability" which sends the natural-language booking query. */}
          {message.awaitingSchedule && !message.slots?.length && !message.booking && (
            <div className="inline-scheduling-prompt">
              <div className="isp-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span className="isp-title">Book a Discovery Call</span>
                <span className="isp-meta">30 min · Google Meet · Asia/Kolkata</span>
              </div>
              <p className="isp-description">
                We'll check real availability from the CloseFuture calendar and reserve a slot for you.
              </p>
              <button
                type="button"
                className="btn-isp-trigger"
                disabled={isPending}
                onClick={() => onSelectPrompt?.("Can I book a discovery call?")}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>Check availability →</span>
              </button>
            </div>
          )}

          {/* NATIVE SCHEDULING INTERFACE — real slots from Google Calendar */}
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
                <div className="bar-cell">
                  <span className="bar-label">TIMEZONE</span>
                  <span className="bar-value">{message.booking.timezone || "Asia/Kolkata"}</span>
                </div>
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
