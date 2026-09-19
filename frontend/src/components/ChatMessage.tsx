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
  isPending: boolean;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onBookSlot,
  isPending,
}) => {
  const isUser = message.role === "user";
  const [selectedSlot, setSelectedSlot] = useState<SlotOption | null>(null);
  const [emailInput, setEmailInput] = useState<string>("");
  const [timezoneInput, setTimezoneInput] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    } catch {
      return "Asia/Kolkata";
    }
  });
  const [emailError, setEmailError] = useState<string>("");

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
      setEmailError("Please provide a valid email address for the calendar invite.");
      return;
    }

    onBookSlot(selectedSlot, emailInput.trim(), timezoneInput.trim());
    setSelectedSlot(null);
  };

  const agentBadgeClass =
    message.agent === "search"
      ? "badge-search"
      : message.agent === "scheduler"
      ? "badge-scheduler"
      : message.agent === "guardrail"
      ? "badge-guardrail"
      : "badge-orchestrator";

  return (
    <div className={`message-row ${isUser ? "user-row" : "assistant-row"}`}>
      <div className={`message-bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}>
        
        {/* ASSISTANT HEADER */}
        {!isUser && (
          <div className="message-meta-header">
            <span className={`agent-badge ${agentBadgeClass}`}>
              {message.agent ? message.agent.toUpperCase() : "CLOSEFUTURE"}
            </span>
            <span className="message-timestamp">{message.timestamp}</span>
          </div>
        )}

        {/* MESSAGE BODY TEXT */}
        <div className="message-text">
          {message.content.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        {/* GROUNDED CITATIONS (Backend-driven only) */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="sources-container">
            <span className="sources-label">Sources:</span>
            <div className="sources-list">
              {message.sources.map((src, idx) => {
                const label = [
                  src.page ? `Page ${src.page}` : null,
                  src.section ? src.section : null,
                ]
                  .filter(Boolean)
                  .join(" — ");

                return (
                  <span key={idx} className="source-chip" title={`Relevance: ${(src.similarity * 100).toFixed(1)}%`}>
                    📄 {label || "Company Profile"}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* INTERACTIVE SCHEDULER: AVAILABLE SLOTS */}
        {!isUser && message.slots && message.slots.length > 0 && (
          <div className="slots-section">
            <p className="slots-heading">Available Discovery Call Slots</p>
            <div className="slots-grid">
              {message.slots.map((slot, sIdx) => {
                const isSelected = selectedSlot?.start === slot.start;
                return (
                  <button
                    key={sIdx}
                    type="button"
                    className={`slot-card-button ${isSelected ? "slot-selected" : ""}`}
                    onClick={() => handleSlotSelect(slot)}
                    disabled={isPending}
                  >
                    <span className="slot-clock-icon">🕒</span>
                    <span className="slot-display-text">{slot.display}</span>
                  </button>
                );
              })}
            </div>

            {/* TWO-PHASE BOOKING CONFIRMATION FORM */}
            {selectedSlot && (
              <form onSubmit={handleConfirmBooking} className="booking-modal-form">
                <div className="booking-form-header">
                  <strong>Confirm Discovery Call</strong>
                  <button
                    type="button"
                    className="btn-text-close"
                    onClick={() => setSelectedSlot(null)}
                  >
                    ✕
                  </button>
                </div>
                <p className="booking-selected-time">
                  Selected: <strong>{selectedSlot.display}</strong>
                </p>

                <div className="booking-form-inputs">
                  <label className="input-label" htmlFor="booking-email-input">
                    Your Email Address (for Calendar invite & Meet link):
                  </label>
                  <input
                    id="booking-email-input"
                    type="email"
                    required
                    placeholder="alex@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="booking-text-input"
                    disabled={isPending}
                  />

                  <label className="input-label" htmlFor="booking-timezone-input">
                    Timezone:
                  </label>
                  <input
                    id="booking-timezone-input"
                    type="text"
                    required
                    value={timezoneInput}
                    onChange={(e) => setTimezoneInput(e.target.value)}
                    className="booking-text-input"
                    disabled={isPending}
                  />

                  {emailError && <p className="form-error-text">{emailError}</p>}
                </div>

                <div className="booking-form-actions">
                  <button
                    type="submit"
                    className="btn-primary btn-sm"
                    disabled={isPending}
                  >
                    {isPending ? "Scheduling on Google Calendar..." : "Confirm & Book Call"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
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

        {/* BOOKING CONFIRMATION CARD */}
        {!isUser && message.booking && message.booking.meetLink && (
          <div className="booking-confirmation-card">
            <div className="confirmation-header">
              <span className="confirmation-check">✓</span>
              <h4>Discovery Call Booked</h4>
            </div>
            <div className="confirmation-details">
              {message.booking.start && (
                <p>
                  <strong>Start:</strong> {formatDateTime(message.booking.start, message.booking.timezone)}
                </p>
              )}
              {message.booking.end && (
                <p>
                  <strong>End:</strong> {formatDateTime(message.booking.end, message.booking.timezone)}
                </p>
              )}
              {message.booking.timezone && (
                <p>
                  <strong>Timezone:</strong> {message.booking.timezone}
                </p>
              )}
              {message.booking.attendeeEmail && (
                <p>
                  <strong>Attendee:</strong> {message.booking.attendeeEmail}
                </p>
              )}
            </div>
            <div className="confirmation-actions">
              <a
                href={message.booking.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-meet-link"
              >
                📹 Join Google Meet
              </a>
            </div>
          </div>
        )}

        {isUser && <span className="message-timestamp user-timestamp">{message.timestamp}</span>}
      </div>
    </div>
  );
};
