import type { LeadSummary } from "../types/leadSummary.js";

/**
 * Generates an executive-ready, responsive HTML email template for internal sales triage.
 */
export function generateLeadSummaryHtml(summary: LeadSummary): string {
  const isCompleted = summary.completionStatus === "completed";
  const statusColor = isCompleted ? "#10b981" : "#f59e0b";
  const statusBg = isCompleted ? "#ecfdf5" : "#fffbeb";
  const statusBorder = isCompleted ? "#a7f3d0" : "#fde68a";

  const tierColors: Record<string, { color: string; bg: string }> = {
    high: { color: "#166534", bg: "#dcfce7" },
    medium: { color: "#1e40af", bg: "#dbeafe" },
    early: { color: "#92400e", bg: "#fef3c7" },
  };
  const tierStyle = tierColors[summary.qualificationTier] || tierColors.early;

  const meetingHtml = summary.meeting?.booked
    ? `
      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; margin: 12px 0; border-radius: 4px;">
        <p style="margin: 0; font-weight: 600; color: #166534;">Discovery Call Confirmed</p>
        <p style="margin: 4px 0 0; color: #374151; font-size: 14px;"><strong>Start:</strong> ${summary.meeting.start || "Scheduled"}</p>
        <p style="margin: 4px 0 0; color: #374151; font-size: 14px;"><strong>End:</strong> ${summary.meeting.end || "Scheduled"}</p>
        ${summary.meeting.timezone ? `<p style="margin: 4px 0 0; color: #374151; font-size: 14px;"><strong>Timezone:</strong> ${summary.meeting.timezone}</p>` : ""}
        ${summary.meeting.meetLink ? `<p style="margin: 8px 0 0;"><a href="${summary.meeting.meetLink}" style="color: #2563eb; font-weight: 600; text-decoration: underline;">Join Google Meet</a></p>` : ""}
      </div>
    `
    : `
      <div style="background-color: #f9fafb; border-left: 4px solid #9ca3af; padding: 12px 16px; margin: 12px 0; border-radius: 4px;">
        <p style="margin: 0; color: #4b5563; font-size: 14px;">No meeting booked yet.</p>
      </div>
    `;

  const questionsList =
    summary.keyQuestions && summary.keyQuestions.length > 0
      ? summary.keyQuestions
          .map((q) => `<li style="margin-bottom: 6px; color: #374151;">${escapeHtml(q)}</li>`)
          .join("")
      : "<li style=\"color: #6b7280;\">No specific questions recorded.</li>";

  const signalsList =
    summary.qualificationSignals && summary.qualificationSignals.length > 0
      ? summary.qualificationSignals
          .map((s) => `<li style="margin-bottom: 6px; color: #374151;">${escapeHtml(s)}</li>`)
          .join("")
      : "<li style=\"color: #6b7280;\">No explicit qualification signals noted.</li>";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>CloseFuture New Sales Lead</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 24px; color: #1f2937;">
  <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    
    <!-- HEADER -->
    <div style="background-color: #111827; padding: 20px 24px;">
      <h1 style="color: #ffffff; margin: 0; font-size: 18px; letter-spacing: 0.5px; font-weight: 700;">CLOSEFUTURE NEW SALES LEAD</h1>
      <p style="color: #9ca3af; margin: 4px 0 0; font-size: 12px;">Automated Assistant Lead Qualification & Summary</p>
    </div>

    <!-- STATUS & SCORE HERO -->
    <div style="padding: 20px 24px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background-color: #fafafa;">
      <div>
        <span style="display: inline-block; background-color: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusBorder}; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
          Status: ${summary.completionStatus}
        </span>
      </div>
      <div style="text-align: right;">
        <span style="font-size: 13px; color: #6b7280; margin-right: 6px;">Lead Score:</span>
        <strong style="font-size: 18px; color: #111827;">${summary.leadScore} / 100</strong>
        <span style="display: inline-block; margin-left: 8px; background-color: ${tierStyle.bg}; color: ${tierStyle.color}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase;">
          ${summary.qualificationTier} Priority
        </span>
      </div>
    </div>

    <div style="padding: 24px;">
      <!-- VISITOR PROFILE -->
      <h2 style="font-size: 14px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; margin: 0 0 12px;">Visitor Details</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #6b7280; width: 120px;"><strong>Name:</strong></td>
          <td style="padding: 6px 0; color: #111827;">${escapeHtml(summary.visitor.name || "Not provided")}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280;"><strong>Email:</strong></td>
          <td style="padding: 6px 0; color: #111827;">${escapeHtml(summary.visitor.email || "Not provided")}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280;"><strong>Company:</strong></td>
          <td style="padding: 6px 0; color: #111827;">${escapeHtml(summary.visitor.company || "Not provided")}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280;"><strong>Timezone:</strong></td>
          <td style="padding: 6px 0; color: #111827;">${escapeHtml(summary.visitor.timezone || "Not provided")}</td>
        </tr>
      </table>

      <!-- CORE INTENT -->
      <h2 style="font-size: 14px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; margin: 0 0 8px;">Core Intent & Inquiries</h2>
      <p style="background-color: #f9fafb; padding: 12px 14px; border-radius: 6px; color: #1f2937; margin: 0 0 20px; font-size: 14px; line-height: 1.5;">
        ${escapeHtml(summary.intent)}
      </p>

      <!-- KEY QUESTIONS -->
      <h2 style="font-size: 14px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; margin: 0 0 8px;">Key Questions Asked</h2>
      <ul style="margin: 0 0 20px; padding-left: 20px; font-size: 14px;">
        ${questionsList}
      </ul>

      <!-- QUALIFICATION SIGNALS -->
      <h2 style="font-size: 14px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; margin: 0 0 8px;">Qualification Signals</h2>
      <ul style="margin: 0 0 20px; padding-left: 20px; font-size: 14px;">
        ${signalsList}
      </ul>

      <!-- MEETING DETAILS -->
      <h2 style="font-size: 14px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; margin: 0 0 8px;">Meeting Status</h2>
      ${meetingHtml}

      <!-- CALL TO ACTION LINK -->
      <div style="text-align: center; margin: 32px 0 16px;">
        <a href="${summary.conversationLink}" style="display: inline-block; background-color: #111827; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px;">
          Review Full Conversation Transcript
        </a>
      </div>

      <!-- FOOTER NOTE -->
      <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 24px 0 0; border-top: 1px solid #f3f4f6; padding-top: 16px;">
        Generated on ${summary.generatedAt} (Session: ${summary.sessionId})<br>
        <strong>CONFIDENTIAL:</strong> Internal Sales Summary Only — Do not forward to visitor.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
