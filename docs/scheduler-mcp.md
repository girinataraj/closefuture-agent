# CloseFuture AI Assistant: Calendar MCP & Scheduler Agent Architecture

## 1. Architectural Decision: Local MCP Server vs. Google Workspace Developer Preview MCP

During system evaluation, invocation of the Google-hosted Calendar MCP server failed with:
> `Access to this tool requires that your Google Cloud project (617338225835) is enrolled in the Google Workspace Developer Preview Program.`

Enrollment in the Google Workspace Developer Preview Program is subject to administrative review and can take several days. Consequently, **the Google-hosted Calendar MCP server was not used and is not considered operational for this submission**.

To deliver a reliable, production-ready implementation compliant with the Model Context Protocol (MCP) standard, we engineered a dedicated local Calendar MCP architecture:

```
+-------------------------------------------------------------------------+
|                            Scheduler Agent                              |
|   (Interprets booking intents, validates visitor details, enforces SLA) |
+------------------------------------+------------------------------------+
                                     | (Strictly TypeScript MCP SDK types)
                                     v
+------------------------------------+------------------------------------+
|                               MCP Client                                |
|           (@modelcontextprotocol/client with StdioClientTransport)      |
+------------------------------------+------------------------------------+
                                     | (stdio JSON-RPC protocol)
                                     v
+------------------------------------+------------------------------------+
|                    Local Calendar MCP Server                            |
|             (@modelcontextprotocol/server with StdioServerTransport)    |
|             (Server Name: closefuture-calendar)                         |
+------------------------------------+------------------------------------+
                                     | (Internal Service Invocation)
                                     v
+------------------------------------+------------------------------------+
|                         Calendar Service                                |
|          (Sole layer permitted to import googleapis library)            |
+------------------------------------+------------------------------------+
                                     | (Google Calendar API v3 REST/HTTPS)
                                     v
+------------------------------------+------------------------------------+
|                    Google Calendar API & Meet                           |
|       (Real availability, event CRUD, Google Meet conference creation)  |
+------------------------------------+------------------------------------+
```

---

## 2. Strict Isolation of Concerns

To preserve architectural modularity and ensure compliance:
1. **`schedulerAgent.ts`** strictly does **NOT** import `googleapis`. It communicates exclusively through the typed MCP Client interface.
2. **`mcpClient.ts`** strictly does **NOT** import `googleapis`. It connects to the MCP server via `StdioClientTransport`.
3. **`calendarService.ts`** and **`googleAuth.ts`** are the **ONLY** files permitted to import and interact with `googleapis`.

This isolation is validated programmatically as part of the automated test suite.

---

## 3. Google OAuth 2.0 & Token Persistence

Authentication is configured via a Google Cloud OAuth 2.0 Desktop Application client (`backend/credentials.json`).

### OAuth Scopes
The client requests least-privilege scopes necessary for scheduling discovery calls:
- `https://www.googleapis.com/auth/calendar.events` (Create, view, modify, and delete events)
- `https://www.googleapis.com/auth/calendar.events.freebusy` (Inspect real-time calendar availability)
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (Inspect accessible calendars)

### Token Management & Persistence
- Authorization tokens (access token, refresh token, expiry) are securely written to `backend/tokens.json`.
- Both `credentials.json` and `tokens.json` are explicitly gitignored to protect sensitive credentials.
- Automatic token refresh events update the local `tokens.json` file in place.
- **Persistence Policy**:
  > *“Tokens are persisted and reused; re-authentication may be required if authorization is revoked or the refresh token becomes invalid.”*

---

## 4. Real Calendar Availability Computation

Availability is computed against real Google Calendar free/busy intervals—no synthetic or hardcoded schedules are permitted.

### Algorithm (`calendarService.findAvailableSlots`)
1. **Working Hours & Bounds**:
   - Business Hours: Monday through Friday, 09:00 to 18:00 (default timezone: `Asia/Kolkata` or configurable via `BUSINESS_TIMEZONE`).
   - Default Call Duration: 30 minutes.
2. **Interval Query**:
   - Queries `calendar.freebusy.query` across a 7-day candidate window to retrieve all busy time intervals.
3. **Candidate Generation**:
   - Generates candidate 30-minute intervals (e.g. 09:00–09:30, 09:30–10:00).
   - Filters out weekends (Saturday, Sunday).
   - Filters out slots in the past or within 30 minutes of current real time.
4. **Collision Detection**:
   - Evaluates slot start and end times against all returned busy intervals (`slotStart < busy.end && slotEnd > busy.start`).
   - Discards any overlapping slot.
5. **Visitor Timezone Formatting**:
   - Converts remaining slots into formatted ISO 8601 timestamps and localized display strings using `Intl.DateTimeFormat`.
6. **Output**:
   - Returns 2 to 3 available slots for the visitor to choose.

---

## 5. Race-Condition Prevention (Double-Booking Safety)

Before any event is committed to Google Calendar, `createEvent` and `updateEvent` perform an immediate, real-time availability re-check:
1. Visitor selects a candidate slot.
2. The service queries Google Calendar free/busy and active event lists specifically covering `[slotStart, slotEnd]`.
3. If another event was scheduled in the interim, booking is aborted immediately, returning:
   ```json
   {
     "success": false,
     "error_code": "SLOT_NO_LONGER_AVAILABLE",
     "retryable": false,
     "message": "The requested time slot is no longer available. Please select another slot."
   }
   ```
4. Only if the slot remains strictly unreserved does the API proceed with creation.

---

## 6. Real Event Creation with Google Meet & Attendee

When a booking is confirmed:
- **Summary**: `CloseFuture Discovery Call`
- **Description**: Concise overview of the meeting and scope review.
- **Conference Generation**:
  - `conferenceDataVersion: 1`
  - `createRequest: { requestId: uuid, conferenceSolutionKey: { type: "hangoutsMeet" } }`
  - Generates a fresh, authentic Google Meet video link (`meet.google.com/...`).
- **Attendee**:
  - Injects `visitorEmail` into the `attendees` collection.
  - Sends calendar invitations via `sendUpdates: "all"`.
- **Response**:
  ```json
  {
    "success": true,
    "eventId": "abcdef123456",
    "htmlLink": "https://www.google.com/calendar/event?eid=...",
    "meetLink": "https://meet.google.com/abc-defg-hij",
    "start": "2026-09-22T04:30:00.000Z",
    "end": "2026-09-22T05:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "attendeeEmail": "visitor@example.com"
  }
  ```

---

## 7. Event Rescheduling and Cancellation

- **Reschedule (`updateEvent`)**:
  - Re-checks availability of the requested new slot.
  - Uses `calendar.events.patch` to update `start` and `end` times.
  - **Preserves the identical `eventId`**, ensuring traceability across session states.
- **Cancellation (`deleteEvent`)**:
  - Issues `calendar.events.delete` to remove the event from Google Calendar.
  - Clears `booked_event_id: null` in the Supabase session state.

---

## 8. Local Calendar MCP Server Protocol

The server is named **`closefuture-calendar`** and communicates over `stdio` via `StdioServerTransport`:
- **Standard Output (`stdout`)**: Reserved exclusively for MCP JSON-RPC protocol frames.
- **Standard Error (`stderr`)**: Used for all operational and diagnostic logging via `console.error`.

### Exposed MCP Tools
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `get_available_slots` | `visitorTimezone`, `startDate?`, `endDate?`, `durationMinutes?` | Computes 2–3 unreserved working slots. |
| `book_discovery_call` | `slotStart`, `slotEnd`, `visitorEmail`, `visitorTimezone`, `summary?`, `description?` | Re-checks availability, provisions Google Meet, creates booking. |
| `reschedule_discovery_call` | `eventId`, `newSlotStart`, `newSlotEnd`, `visitorTimezone`, `visitorEmail?` | Moves booking to a new verified time slot while retaining `eventId`. |
| `cancel_discovery_call` | `eventId` | Deletes meeting from Google Calendar and notifies attendees. |

---

## 9. Scheduler Agent & Orchestrator Integration

### Missing Information Enforcement
The Scheduler Agent rejects ungrounded booking attempts:
- If `visitorEmail` is missing during booking: Returns `status: "needs_information"` with:
  > *"Please provide your email address so I can send the calendar invitation."*
- If `visitorTimezone` is missing: Returns `status: "needs_information"` with:
  > *"Please provide your timezone so I can show available times in your local time."*

### Multi-Intent Sequencing
For complex queries such as *"Do you build mobile apps and can I book a call tomorrow?"*:
1. Orchestrator classifies multi-intent: `intents: ["search", "booking"]`, `sequence: ["search", "booking"]`.
2. Search Agent executes first to retrieve grounded case study evidence from the company profile.
3. Scheduler Agent executes concurrently/sequentially to discover candidate slots.
4. Orchestrator synthesizes both outputs into a unified response.
5. Outgoing Guardrail evaluates the composite message before sending it to the visitor.

---

## 10. Audit Logging & Error Classification

### Telemetry Events (`logAgentEvent`)
- `SCHEDULER_REQUEST`: Inbound action dispatch.
- `MCP_CALL`: Outgoing tool request to Calendar MCP server.
- `MCP_RESULT`: Tool completion status.
- `AVAILABILITY_CHECK`: Free/busy scanning.
- `BOOKING_RECHECK`: Pre-commit collision verification.
- `BOOKING_CREATED`: Confirmed calendar entry.
- `RESCHEDULE`: Slot modification.
- `CANCELLATION`: Booking removal.
- `SCHEDULER_ERROR`: Structured failure.

### Error Classification
Errors are normalized into typed responses:
```json
{
  "status": "error",
  "error": {
    "error_code": "RATE_LIMIT_EXCEEDED",
    "message": "Temporary connectivity issue with calendar service. Please retry in a moment.",
    "retryable": true,
    "agent": "scheduler"
  }
}
```
- **Retryable**: HTTP 429, HTTP 500–599, network timeouts (`ETIMEDOUT`, `ECONNRESET`).
- **Non-Retryable**: HTTP 400, HTTP 401, HTTP 403, slot unavailable, malformed parameters.
- Raw Google API internal traces are never exposed to the visitor.
