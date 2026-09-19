import React, { useState, useEffect, useRef } from "react";
import { Header } from "./components/Header.js";
import { EmptyState } from "./components/EmptyState.js";
import { ChatMessage } from "./components/ChatMessage.js";
import { TracePanel } from "./components/TracePanel.js";
import { sendChatMessage, fetchSessionHistory, createNewSession } from "./api/chatApi.js";
import type { ChatMessage as ChatMessageType, SanitizedTrace, SlotOption } from "./types/chat.js";
import "./App.css";

const SESSION_STORAGE_KEY = "closefuture_session_id";
const TRACE_STORAGE_KEY = "closefuture_last_trace";

export function App() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputValue, setInputValue] = useState<string>("");
  const [isPending, setIsPending] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [lastTrace, setLastTrace] = useState<SanitizedTrace | null>(null);
  const [lastAgent, setLastAgent] = useState<string | undefined>(undefined);
  const [showTrace, setShowTrace] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const initRanRef = useRef<boolean>(false);

  // ---------------------------------------------------------------------------
  // 1. SESSION INITIALIZATION & RESTORE (Reload-Safe)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;

    async function initSession() {
      const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);

      // Restore last trace from localStorage if available
      const storedTrace = localStorage.getItem(TRACE_STORAGE_KEY);
      if (storedTrace) {
        try {
          setLastTrace(JSON.parse(storedTrace));
        } catch {}
      }

      if (storedSessionId) {
        try {
          const res = await fetchSessionHistory(storedSessionId);
          if (res.success) {
            // Keep the exact same ID
            setSessionId(storedSessionId);

            if (res.messages && res.messages.length > 0) {
              const restored: ChatMessageType[] = res.messages.map((m) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                agent: m.agent || undefined,
                timestamp: new Date(m.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              }));
              setMessages(restored);

              const lastAssistant = [...restored].reverse().find((m) => m.role === "assistant");
              if (lastAssistant?.agent) {
                setLastAgent(lastAssistant.agent);
              }
            } else {
              setMessages([]);
            }
            setIsInitializing(false);
            return;
          } else if (res.status === 404 || res.error?.includes("404")) {
            console.warn(`[Session Restore]: Stored session ${storedSessionId} returned 404. Generating new UUID.`);
          }
        } catch (err) {
          console.warn("[Session Restore Error]:", err);
        }
      }

      // If no stored session or session returned 404, generate new UUID
      const newSessionId = crypto.randomUUID();
      localStorage.setItem(SESSION_STORAGE_KEY, newSessionId);
      setSessionId(newSessionId);
      setMessages([]);
      setIsInitializing(false);

      // Eagerly register session in Supabase so subsequent reload immediately finds it
      createNewSession(newSessionId).catch(() => null);
    }

    initSession();
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPending]);

  // ---------------------------------------------------------------------------
  // 2. NEW CHAT RESET
  // ---------------------------------------------------------------------------
  const handleNewChat = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(TRACE_STORAGE_KEY);
    const freshId = crypto.randomUUID();
    localStorage.setItem(SESSION_STORAGE_KEY, freshId);
    setSessionId(freshId);
    setMessages([]);
    setLastTrace(null);
    setLastAgent(undefined);
    setErrorMessage(null);
    setInputValue("");
    // Register eager session in Supabase so subsequent reload before message finds it
    createNewSession(freshId).catch(() => null);
  };

  // ---------------------------------------------------------------------------
  // 3. SEND MESSAGE HANDLER
  // ---------------------------------------------------------------------------
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isPending || !sessionId) return;

    setErrorMessage(null);
    setInputValue("");

    const userMessage: ChatMessageType = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsPending(true);

    try {
      const response = await sendChatMessage(sessionId, text);

      if (!response.success || !response.data) {
        const errorText =
          response.error ||
          "I'm unable to reach the assistant right now. Please try again in a moment.";
        setErrorMessage(errorText);

        const errorMsg: ChatMessageType = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: errorText,
          agent: "orchestrator",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      // If backend returned or canonicalized sessionId, keep localStorage in sync
      if (response.sessionId && response.sessionId !== sessionId) {
        setSessionId(response.sessionId);
        localStorage.setItem(SESSION_STORAGE_KEY, response.sessionId);
      }

      const { data } = response;
      const assistantAgent = data.agent || "orchestrator";
      setLastAgent(assistantAgent);

      if (data.trace) {
        setLastTrace(data.trace);
        try {
          localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(data.trace));
        } catch {}
      }

      const assistantMessage: ChatMessageType = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        agent: assistantAgent,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        sources: data.sources,
        slots: data.scheduler?.slots,
        booking: data.scheduler?.booking,
        trace: data.trace,
        isBlocked: data.status === "blocked",
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error("[Chat Dispatch Error]:", err?.message);
      const friendlyError =
        "A network communication error occurred. Please verify your connection and try again.";
      setErrorMessage(friendlyError);

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: friendlyError,
          agent: "orchestrator",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } finally {
      setIsPending(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 4. TWO-PHASE BOOKING CONFIRMATION DISPATCH
  // ---------------------------------------------------------------------------
  const handleBookSlot = (slot: SlotOption, email: string, timezone: string) => {
    // Send standard natural booking request to Orchestrator + Scheduler Agent
    const bookingMessage = `Please confirm and book my discovery call for slot: ${slot.start} to ${slot.end}. My email is ${email} and my timezone is ${timezone}.`;
    handleSendMessage(bookingMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="app-shell">
      {/* GLOBAL HEADER */}
      <Header
        sessionId={sessionId}
        onNewChat={handleNewChat}
        showTrace={showTrace}
        onToggleTrace={() => setShowTrace((prev) => !prev)}
      />

      {/* WORKSPACE AREA */}
      <div className="app-main-layout">
        {/* CHAT SECTION */}
        <main className="chat-viewport">
          <div className="chat-scroll-area">
            {isInitializing ? (
              <div className="chat-initializing-state">
                <div className="initializing-spinner" />
                <p>Restoring conversation session...</p>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState onSelectPrompt={(p) => handleSendMessage(p)} />
            ) : (
              <div className="messages-stream">
                {messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    onBookSlot={handleBookSlot}
                    isPending={isPending}
                  />
                ))}

                {isPending && (
                  <div className="message-row assistant-row">
                    <div className="message-bubble assistant-bubble thinking-bubble">
                      <div className="thinking-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                      <span className="thinking-text">
                        CloseFuture Assistant is thinking...
                      </span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* CHAT INPUT FORM */}
          <div className="chat-input-dock">
            {errorMessage && (
              <div className="input-error-banner">
                <span>⚠️ {errorMessage}</span>
                <button
                  type="button"
                  className="btn-dismiss-error"
                  onClick={() => setErrorMessage(null)}
                >
                  ✕
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="chat-input-form"
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about CloseFuture services, case studies, or book a discovery call..."
                rows={1}
                disabled={isPending}
                className="chat-textarea"
              />
              <button
                type="submit"
                disabled={isPending || !inputValue.trim()}
                className="btn-send-message"
                title="Send Message"
              >
                Send
              </button>
            </form>
            <p className="dock-disclaimer">
              Powered by CloseFuture Studio Multi-Agent Architecture • Verified with Google Calendar & Resend
            </p>
          </div>
        </main>

        {/* DEVELOPER TRACE PANEL */}
        {showTrace && (
          <TracePanel
            sessionId={sessionId}
            trace={lastTrace}
            lastAgent={lastAgent}
            onClose={() => setShowTrace(false)}
          />
        )}
      </div>
    </div>
  );
}

export default App;
