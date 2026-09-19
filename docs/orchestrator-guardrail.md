# Orchestrator & Guardrail Agents Architecture Specification

## 1. Executive Summary

This document specifies the architecture, data contracts, and operational lifecycle for the **Orchestrator Agent** and **Guardrail Agent** within the CloseFuture AI Assistant system.

Together, these two components ensure that:
1. Every incoming visitor message is inspected for prompt injection, confidential PII harvesting, or system probing before entering the agent network.
2. Visitor intents are classified dynamically using structured LLM classification (rather than rigid keyword matching).
3. Complex queries spanning multiple intents (e.g., capability inquiry + meeting booking) are sequenced and executed deterministically.
4. Every outgoing assistant answer is inspected by an outgoing guardrail to verify factual grounding against retrieved sources and prevent unauthorized contractual commitments or pricing guarantees.
5. All routing, clarification, handoff, and guardrail decisions are recorded to the Supabase `agent_logs` table for observability.

---

## 2. Core Data Contracts (`backend/src/types/agent.ts`)

```typescript
export type AgentName =
  | "orchestrator"
  | "search"
  | "scheduler"
  | "lead-summary"
  | "guardrail";

export type Intent =
  | "search"
  | "booking"
  | "reschedule"
  | "cancel"
  | "lead_summary"
  | "unknown";

export interface RoutingDecision {
  intents: Intent[];
  primaryIntent: Intent;
  confidence: number;
  requiresClarification: boolean;
  sequence: Intent[];
  reason: string;
}

export interface PendingAction {
  type: "scheduler" | "lead-summary";
  reason: string;
  details?: Record<string, unknown>;
}

export type GuardrailDirection = "incoming" | "outgoing";

export type GuardrailRiskType =
  | "none"
  | "prompt_injection"
  | "pii"
  | "hallucination"
  | "unauthorized_commitment"
  | "tone"
  | "internal_information"
  | "other";

export interface GuardrailInput {
  direction: GuardrailDirection;
  sessionId: string;
  userMessage?: string;
  answer?: string;
  sources?: Array<{
    page: number | null;
    section: string | null;
    category: string | null;
    similarity: number;
  }>;
}

export interface GuardrailOutput {
  allowed: boolean;
  riskType: GuardrailRiskType;
  reason: string;
  safeFallback?: string;
}

export interface OrchestratorInput {
  sessionId: string;
  message: string;
}

export interface OrchestratorOutput {
  status: "success" | "clarification" | "blocked" | "error";
  answer: string;
  route: RoutingDecision;
  agent: AgentName;
  pendingAction?: PendingAction;
  guardrail?: {
    allowed: boolean;
    reason?: string;
    riskType?: GuardrailRiskType;
  };
  error?: {
    error_code: string;
    message: string;
    retryable: boolean;
    agent: "orchestrator";
  };
}
```

---

## 3. End-to-End Execution Flow

```
[ Visitor Message ]
        │
        ▼
[ 1. Incoming Guardrail Check ] ──(Unsafe / Injection / PII)──► Block & Return Safe Fallback
        │
        ▼ (Allowed)
[ 2. Load Conversation History ]
        │
        ▼
[ 3. Intent Classification (LLM) ]
        │
        ├──(Confidence < 0.65 / Ambiguous)──► Return Clarification ("Which would you like to do?")
        │
        ▼ (High Confidence >= 0.65)
[ 4. Multi-Intent Planning & Downstream Dispatch ]
        │
        ├── search intent ─────────► Execute Search Agent (RAG)
        ├── booking intent ────────► Formulate booking info + attach PendingAction("scheduler")
        ├── lead_summary intent ───► Conclude dialogue + attach PendingAction("lead-summary")
        └── reschedule/cancel ─────► Formulate modification info + attach PendingAction("scheduler")
        │
        ▼
[ 5. Outgoing Guardrail Check (FR-3.8) ]
        │
        ├──(Unsupported Guarantee / Pricing)──► Replace with Grounded Fallback
        ▼ (Allowed)
[ 6. Return Structured OrchestratorOutput ]
        │
        ▼
[ 7. Persist Message & Audit Logs in Supabase ]
```

---

## 4. Guardrail Agent Strategy & Mechanisms (`backend/src/agents/guardrailAgent.ts`)

To balance security and token expenditure, the Guardrail Agent employs a **two-stage architecture**:

### Stage 1: Deterministic Pattern Analysis (Zero LLM Overhead)
- **Prompt Injections**: Detects instruction-override keywords (`ignore previous instructions`, `reveal system prompt`, `show hidden instructions`, `bypass rules`, `DAN mode`, `jailbreak`).
- **Confidential PII Harvesting**: Blocks requests probing for other customers' passwords, emails, phone numbers, credit cards, or customer database dumps.
- **Internal Architecture Probing**: Intercepts requests for lead scores, qualification algorithms, database connection strings, or system prompts.
- **Unauthorized Outgoing Commitments**: Detects contractual guarantee patterns not in CloseFuture's profile (e.g., fixed-price guarantees in Rupees, 14-day delivery guarantees).

### Stage 2: Targeted Semantic Evaluation (Model-Driven)
When a candidate outgoing response contains substantive numeric commitments or pricing promises, Stage 2 verifies that the claims are strictly corroborated by the retrieved pgvector sources.

### Safe Fallback Responses:
- **Prompt Injection**: `"I can help with CloseFuture's public services, projects, and booking information, but I can't provide internal system information."`
- **PII Probing**: `"I can't provide private or sensitive personal information."`
- **Hallucinations & Unsupported Guarantees**: `"I don't have enough reliable information in the available CloseFuture content to confirm that."`

---

## 5. Intent Classification & Routing (`backend/src/agents/orchestratorPrompts.ts`)

The Orchestrator avoids rigid keyword matching by utilizing an LLM classification step with strict schema constraints:
- **`search`**: Questions about services, tech stack, case studies (Dipy, Liya AI, Webiz), delivery process, or founder contact.
- **`booking`**: Requests to schedule a discovery call or meeting.
- **`reschedule` / `cancel`**: Modification of existing appointments.
- **`lead_summary`**: Explicit signals indicating the conversation has finished (e.g., *"That's all, thanks"*, *"I'm done"*).
- **`unknown`**: Gibberish or unresolvable inputs.

### Clarification Threshold:
- Threshold: `ORCHESTRATOR_CLARIFICATION_THRESHOLD = 0.65` (configurable via `.env`).
- If `confidence < 0.65` or `requiresClarification === true`, the system returns:
  `"I can help with information about CloseFuture or help arrange a discovery call. Which would you like to do?"`
- Logged as `ROUTING_CLARIFICATION`.

---

## 6. Multi-Intent Handling & Sequencing

When a user submits compound requests, such as:
> *"Do you build mobile apps, and can I book a call tomorrow?"*

1. **Intents**: `["search", "booking"]`
2. **Sequence**: `["search", "booking"]`
3. **Execution**:
   - The Orchestrator immediately invokes the Search Agent to answer the mobile development inquiry from Page 5 of the company profile.
   - It identifies that the second action requires the Scheduler Agent.
   - Since the Scheduler Agent is not yet integrated, it appends booking context and issues a structured `PendingAction`:
     ```json
     {
       "type": "scheduler",
       "reason": "Visitor requested to schedule a discovery call alongside an inquiry."
     }
     ```
   - **Critical Safety Guarantee**: The system **never** claims a call has been booked until a real scheduler tool confirms it.

---

## 7. Audit Logging & Observability

All transitions are logged using `logAgentEvent()` in `backend/src/db/sessionRepository.ts`:
- `GUARDRAIL_INPUT`: Records incoming security verification and block reasons.
- `ROUTING_DECISION`: Records the LLM intent classification, confidence, and sequence.
- `ROUTING_CLARIFICATION`: Records low-confidence clarification triggers.
- `AGENT_HANDOFF`: Records the handoff from Orchestrator to downstream agents (e.g., Search).
- `GUARDRAIL_OUTPUT`: Records outgoing response safety and grounding clearance.
- `BLOCKED_RESPONSE`: Records instances where unsafe inputs or outputs were halted.

---

## 8. Pluggable Integration for Future Agents

The architecture is explicitly decoupled for downstream agents:
1. **Scheduler Agent (Next Step)**:
   - When `primaryIntent === "booking"` or when `sequence` includes `booking`, the Orchestrator will dispatch the request to `executeSchedulerAgent()`, which connects to Google Calendar via MCP tools.
2. **Lead-Summary Agent (Next Step)**:
   - When `primaryIntent === "lead_summary"` or session timeout occurs, the Orchestrator will dispatch to `executeLeadSummaryAgent()`, scoring lead qualification and generating an email summary via Resend.
