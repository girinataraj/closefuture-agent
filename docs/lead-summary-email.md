# CloseFuture AI Assistant: Lead-Summary Agent & Email MCP Architecture

## 1. Architectural Overview

The **Lead-Summary Agent** operates as an asynchronous, non-blocking component within the CloseFuture multi-agent system. It is responsible for qualifying prospective client leads, calculating an objective lead score, synthesizing conversation history into an executive sales briefing, and dispatching the briefing to the internal sales team inbox.

Following our strict Model Context Protocol (MCP) design, email delivery is isolated behind a dedicated local MCP Server:

```
+-------------------------------------------------------------------------+
|                           Orchestrator Agent                            |
|             (Detects explicit finish OR confirmed booking)              |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                           Lead-Summary Agent                            |
|     (Deterministic lead scoring, dialogue extraction, state updates)    |
+------------------------------------+------------------------------------+
                                     | (Strictly TypeScript MCP client)
                                     v
+------------------------------------+------------------------------------+
|                               MCP Client                                |
|           (@modelcontextprotocol/client with StdioClientTransport)      |
+------------------------------------+------------------------------------+
                                     | (stdio JSON-RPC protocol)
                                     v
+------------------------------------+------------------------------------+
|                      Local Email MCP Server                             |
|             (@modelcontextprotocol/server: closefuture-email)           |
+------------------------------------+------------------------------------+
                                     | (Resend SDK)
                                     v
+------------------------------------+------------------------------------+
|                             Resend API                                  |
|            (Idempotent email dispatch with API key protection)          |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                             Sales Inbox                                 |
|                       (giriedu765@gmail.com)                            |
+-------------------------------------------------------------------------+
```

---

## 2. Strict Separation of Concerns

To guarantee maintainability, testability, and security:
1. **`server.ts` (`src/mcp/email/server.ts`)** is the **ONLY** file permitted to import and instantiate the `resend` SDK.
2. **`leadSummaryAgent.ts`**, **`orchestrator.ts`**, and **`chat.ts`** strictly do **NOT** import `resend`.
3. Communication between the agent layer and email infrastructure occurs strictly across the MCP boundary over `stdio` JSON-RPC.

This isolation is asserted programmatically in automated test suites.

---

## 3. Deterministic Lead Scoring vs. LLM Summarization

A key architectural tenet is the **separation of qualitative synthesis from quantitative qualification**:

### What the LLM Does
The LLM (via OpenAI Responses API) is used exclusively for dialogue understanding:
- Summarizing the visitor's core intent in 1–2 sentences.
- Extracting key questions asked by the visitor.
- Identifying explicit qualification signals (e.g., requested features, tech stack preferences).

### What the LLM Never Does
The LLM is strictly prohibited from inventing or modifying:
- Visitor contact details (email, phone, name).
- Meeting booking IDs, times, or statuses.
- Numerical lead scores and priority tiers.

### Scoring Rubric (`leadScoring.ts`)
Lead qualification scores are calculated using a transparent, rule-based rubric:

| Signal | Description | Weight |
| :--- | :--- | :--- |
| **Project / Business Need** | Visitor expressed a concrete product, web, mobile, or SaaS requirement. | **+20** |
| **Development Requirement** | Visitor outlined technical specifications, technology stack, or architecture. | **+20** |
| **Company Information** | Company name or corporate domain was provided in dialogue or session. | **+15** |
| **Timeline Provided** | Clear delivery expectations (e.g. "within 6 weeks", "Q2", "ASAP"). | **+15** |
| **Budget Indicated** | Budget figures, pricing expectations, or investment scale mentioned. | **+15** |
| **Meeting Booked** | Confirmed Google Calendar discovery call via Scheduler Agent. | **+15** |

- **Maximum Lead Score**: 100 points
- **Priority Tiers**:
  - `high`: 80 – 100
  - `medium`: 50 – 79
  - `early`: 0 – 49

---

## 4. Duplicate-Prevention & Concurrency State Machine

Duplicate emails to the sales team degrade user trust and cause operational noise. To prevent duplicate sends under high concurrency, the system utilizes a two-phase state machine backed by Supabase optimistic concurrency:

```
                       [Initial State: not_sent]
                                   │
                                   ▼
                       [Claim State: pending]
                         (Atomic updateSession)
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
          (MCP Send Succeeded)           (MCP Send Failed)
                    │                             │
                    ▼                             ▼
              [State: sent]                [State: failed]
          (summary_sent = true)          (Eligible for retry)
```

1. **Pre-Check**: If `summary_status === 'sent'` or `summary_sent === true`, execution exits immediately with `status: "already_sent"`.
2. **Atomic Claim**: Before invoking the Email MCP tool, the agent issues an optimistic concurrency update setting `summary_status = 'pending'`. If another process concurrently modified the session, the version conflict triggers a re-read. If the record is already `pending` or `sent`, the duplicate send is aborted.
3. **Post-Send Finalization**:
   - On confirmed delivery: Transitions to `summary_status = 'sent'`, sets `summary_sent = true`, records `summary_email_id`, and increments `summary_version`.
   - On failure: Transitions to `summary_status = 'failed'`, preserving state for safe retry.

---

## 5. Resend Native Idempotency

Every email dispatch constructs a deterministic idempotency key based on session identity and version:
```
lead-summary/<sessionId>/v<summary_version>
```

This key is passed directly to the Resend SDK's native options:
```typescript
await resend.emails.send(
  {
    from: "CloseFuture AI <onboarding@resend.dev>",
    to: [salesEmail],
    subject: `New Lead [${summary.qualificationTier.toUpperCase()}]: ...`,
    html: emailHtml,
  },
  {
    idempotencyKey,
  }
);
```
Even if network retries retransmit the payload, Resend deduplicates the request server-side and returns the original message ID.

---

## 6. Trigger Mechanisms

The Lead-Summary Agent is triggered under three distinct scenarios:

1. **Confirmed Booking (`booking_confirmed`)**:
   - Triggered immediately after the Scheduler Agent confirms a Google Calendar event ID.
   - Sets `completionStatus: "completed"`.
   - Embeds the confirmed meeting timestamp and Google Meet link.
2. **Explicit Dialogue Completion (`visitor_finished`)**:
   - Triggered when Orchestrator classifies visitor intent as `lead_summary` (*"That's all, thanks"*, *"I'm done"*).
   - Sets `completionStatus: "completed"`.
3. **Abandoned Session (`session_abandoned`)**:
   - Invoked via `triggerAbandonedSummary(sessionId)` when a session expires or goes dormant without a formal closing.
   - Sets `completionStatus: "incomplete"`.
   - Retains all partial inquiries and qualification signals captured prior to abandonment.

---

## 7. Privacy & Guardrail Policy

- **Strict Internal Confidentiality**: The lead score, qualification tier breakdown, and sales summary are intended strictly for internal business operations. They are **NEVER** transmitted to the visitor in chat responses.
- **Transcript Link Security**: The review link format (`http://localhost:5173/sessions/<sessionId>`) is sent only to the authenticated sales inbox (`SALES_EMAIL`).
- **Outgoing Guardrail**: All visitor-facing text passes through the outgoing Guardrail before delivery.
