import { useState, useEffect, useRef } from "react";
import { Header } from "./components/Header.js";
import { SessionDrawer } from "./components/SessionDrawer.js";
import { EmptyState } from "./components/EmptyState.js";
import { ChatMessage } from "./components/ChatMessage.js";
import { Composer } from "./components/Composer.js";
import { TracePanel } from "./components/TracePanel.js";
import { sendChatMessage, fetchSessionHistory, createNewSession } from "./api/chatApi.js";
import type {
  ChatMessage as ChatMessageType,
  SanitizedTrace,
  SlotOption,
  SessionIndexItem,
} from "./types/chat.js";
import "./App.css";

const SESSION_STORAGE_KEY = "closefuture_session_id";
const SESSIONS_INDEX_KEY = "closefuture_sessions_index";
const TRACE_STORAGE_KEY = "closefuture_last_trace";

export function App() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputValue, setInputValue] = useState<string>("");
  const [isPending, setIsPending] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [lastTrace, setLastTrace] = useState<SanitizedTrace | null>(null);
  const [lastAgent, setLastAgent] = useState<string | undefined>(undefined);
  const [showTrace, setShowTrace] = useState<boolean>(false);
  const [showSessions, setShowSessions] = useState<boolean>(false);
  const [sessions, setSessions] = useState<SessionIndexItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const initRanRef = useRef<boolean>(false);

  const loadSessionsIndex = (): SessionIndexItem[] => {
    try {
      const raw = localStorage.getItem(SESSIONS_INDEX_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // CLEANUP: remove stale entries whose title is exactly "New Conversation"
          const cleaned = parsed.filter(
            (s: SessionIndexItem) => s && s.title && s.title.trim() !== "New Conversation"
          );
          if (cleaned.length !== parsed.length) {
            try {
              localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(cleaned));
            } catch {}
          }
          return cleaned;
        }
      }
    } catch {}
    return [];
  };

  const saveSessionsIndex = (items: SessionIndexItem[]) => {
    try {
      localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(items));
      setSessions(items);
    } catch {}
  };

  // ---------------------------------------------------------------------------
  // 1. SESSION INITIALIZATION & RESTORE (Reload-Safe)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;

    async function initSession() {
      const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      const existingIndex = loadSessionsIndex();
      setSessions(existingIndex);

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

      const newSessionId = crypto.randomUUID();
      localStorage.setItem(SESSION_STORAGE_KEY, newSessionId);
      setSessionId(newSessionId);
      setMessages([]);
      setIsInitializing(false);

      createNewSession(newSessionId).catch(() => null);
      // NOTE: Do not add empty session to visible session index yet.
      // It will be added on the user's first message with a message-derived title.
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

    createNewSession(freshId).catch(() => null);

    // Refresh visible sessions without adding the empty session
    setSessions(loadSessionsIndex());
  };

  // ---------------------------------------------------------------------------
  // 3. SELECT EXISTING SESSION FROM DRAWER
  // ---------------------------------------------------------------------------
  const handleSelectSession = async (targetId: string) => {
    if (targetId === sessionId || isPending) return;

    setIsPending(true);
    setErrorMessage(null);

    try {
      const res = await fetchSessionHistory(targetId);
      if (res.success) {
        setSessionId(targetId);
        localStorage.setItem(SESSION_STORAGE_KEY, targetId);

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
      } else {
        setErrorMessage("Could not load session history. The session may have expired.");
      }
    } catch {
      setErrorMessage("Failed to switch session.");
    } finally {
      setIsPending(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 4. SEND MESSAGE HANDLER
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

    const currentList = loadSessionsIndex();
    const existing = currentList.find((s) => s.id === sessionId);
    const summaryTitle = text.length > 38 ? `${text.slice(0, 38)}…` : text;

    const updatedList = [
      {
        id: sessionId,
        title: existing && existing.title !== "New Conversation" ? existing.title : summaryTitle,
        lastActive: new Date().toISOString(),
      },
      ...currentList.filter((s) => s.id !== sessionId),
    ];
    saveSessionsIndex(updatedList);

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

      const routeIntents: string[] = [
        ...(data.route?.intents ?? []),
        ...(data.route?.primaryIntent ? [data.route.primaryIntent] : []),
        ...(data.trace?.intent ? [data.trace.intent] : []),
      ];
      const hasBookingIntent = routeIntents.some((i: string) =>
        ["booking", "scheduling", "discovery_call", "book"].includes(i.toLowerCase())
      );
      const awaitingSchedule =
        !data.scheduler?.slots?.length &&
        !data.scheduler?.booking &&
        hasBookingIntent;

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
        awaitingSchedule,
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
  // 5. BOOKING & SCHEDULING ACTION HANDLERS
  // ---------------------------------------------------------------------------
  const handleBookSlot = (slot: SlotOption, email: string, timezone: string) => {
    const bookingMessage = `Please confirm and book my discovery call for slot: ${slot.start} to ${slot.end}. My email is ${email} and my timezone is ${timezone}.`;
    handleSendMessage(bookingMessage);
  };

  const handleReschedule = () => {
    handleSendMessage("Please reschedule my discovery call to another available time.");
  };

  const handleCancelBooking = () => {
    handleSendMessage("Please cancel my scheduled discovery call.");
  };

  return (
    <div className="app-shell">
      {/* FLOATING WEIGHTLESS HEADER */}
      <Header
        sessionId={sessionId}
        onNewChat={handleNewChat}
        showTrace={showTrace}
        onToggleTrace={() => setShowTrace((prev) => !prev)}
        onToggleSessions={() => setShowSessions((prev) => !prev)}
      />

      {/* SESSIONS SLIDE-OUT OVERLAY */}
      <SessionDrawer
        isOpen={showSessions}
        onClose={() => setShowSessions(false)}
        activeSessionId={sessionId}
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewChat}
      />

      {/* MAIN VIEWPORT (SPACIOUS & LUXURIOUS) */}
      <main className="app-main-viewport">
        <div className="messages-scroll-area">
          {isInitializing ? (
            <div className="quiet-loading-state">
              <div className="quiet-loading-dot" />
              <span>Restoring session…</span>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState onSelectPrompt={(p) => handleSendMessage(p)} />
          ) : (
            <div className="messages-stream-container">
              {messages.map((msg, index) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onBookSlot={handleBookSlot}
                  onReschedule={handleReschedule}
                  onCancelBooking={handleCancelBooking}
                  onSelectPrompt={(p) => handleSendMessage(p)}
                  isPending={isPending}
                  isLatest={index === messages.length - 1}
                />
              ))}

              {isPending && (
                <div className="editorial-message-row assistant-row">
                  <div className="assistant-editorial-flow">
                    <div className="assistant-flow-header">
                      <div className="assistant-id-cluster">
                        <div className="cf-mark-badge">
                          <span>CF</span>
                        </div>
                        <span className="assistant-title-text">CloseFuture AI</span>
                        <span className="agent-subtle-tag thinking-tag">
                          Thinking…
                        </span>
                      </div>
                    </div>
                    <div className="thinking-quiet-indicator">
                      <span className="dot-wave" />
                      <span className="dot-wave" />
                      <span className="dot-wave" />
                      <span className="thinking-meta-note">Coordinating agents & checking verified sources</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* FLOATING COMPOSER */}
        <Composer
          value={inputValue}
          onChange={setInputValue}
          onSend={() => handleSendMessage()}
          isPending={isPending}
          errorMessage={errorMessage}
          onDismissError={() => setErrorMessage(null)}
        />
      </main>

      {/* RIGHT INSPECTOR SLIDE-OUT OVERLAY */}
      {showTrace && (
        <TracePanel
          sessionId={sessionId}
          trace={lastTrace}
          lastAgent={lastAgent}
          onClose={() => setShowTrace(false)}
        />
      )}
    </div>
  );
}

export default App;
