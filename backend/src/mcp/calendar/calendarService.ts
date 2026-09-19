import { google, type calendar_v3 } from "googleapis";
import { getGoogleAuthClient } from "./googleAuth.js";

export interface SlotOption {
  start: string;
  end: string;
  display: string;
}

export interface AvailableSlotsQuery {
  startDate?: string;
  endDate?: string;
  visitorTimezone?: string;
  durationMinutes?: number;
}

export interface BookingRequest {
  summary?: string;
  description?: string;
  start: string;
  end: string;
  visitorEmail: string;
  timezone: string;
}

export interface BookingResult {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  meetLink?: string;
  start?: string;
  end?: string;
  timezone?: string;
  attendeeEmail?: string;
  error_code?: string;
  message?: string;
  retryable?: boolean;
}

export interface RescheduleRequest {
  eventId: string;
  newStart: string;
  newEnd: string;
  timezone: string;
  visitorEmail?: string;
}

export interface CalendarServiceConfig {
  calendarId: string;
  businessTimezone: string;
  businessHours: {
    startHour: number; // 9 = 09:00
    endHour: number;   // 18 = 18:00
  };
  defaultDurationMinutes: number;
}

export const DEFAULT_CONFIG: CalendarServiceConfig = {
  calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  businessTimezone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
  businessHours: {
    startHour: 9,
    endHour: 18,
  },
  defaultDurationMinutes: 30,
};

/**
 * Initializes and returns the authenticated Google Calendar API v3 client.
 */
export async function getCalendarApi(): Promise<calendar_v3.Calendar> {
  const auth = await getGoogleAuthClient();
  return google.calendar({ version: "v3", auth });
}

/**
 * Retrieves all accessible calendars.
 */
export async function getCalendars() {
  const calendar = await getCalendarApi();
  const res = await calendar.calendarList.list();
  return res.data.items || [];
}

/**
 * Lists events in a given time window for the calendar.
 */
export async function listEvents(
  calendarId = DEFAULT_CONFIG.calendarId,
  startTime?: string,
  endTime?: string
) {
  const calendar = await getCalendarApi();
  const res = await calendar.events.list({
    calendarId,
    timeMin: startTime,
    timeMax: endTime,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items || [];
}

/**
 * Queries Free/Busy information for the primary calendar within a time range.
 */
export async function getFreeBusy(
  timeMin: string,
  timeMax: string,
  calendarId = DEFAULT_CONFIG.calendarId
) {
  const calendar = await getCalendarApi();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    },
  });

  const calendarBusy = res.data.calendars?.[calendarId]?.busy || [];
  return calendarBusy.map((b) => ({
    start: new Date(b.start!).getTime(),
    end: new Date(b.end!).getTime(),
  }));
}

/**
 * Verifies whether a specific time slot is strictly available without conflicts.
 * Checks both freebusy query and existing non-cancelled events.
 */
export async function isSlotAvailable(
  startIso: string,
  endIso: string,
  excludeEventId?: string,
  calendarId = DEFAULT_CONFIG.calendarId
): Promise<boolean> {
  const checkStart = new Date(startIso).getTime();
  const checkEnd = new Date(endIso).getTime();

  if (isNaN(checkStart) || isNaN(checkEnd) || checkStart >= checkEnd) {
    return false;
  }

  // 1. Check freebusy intervals
  const busyIntervals = await getFreeBusy(startIso, endIso, calendarId);
  for (const interval of busyIntervals) {
    if (checkStart < interval.end && checkEnd > interval.start) {
      return false;
    }
  }

  // 2. Query events directly as second verification layer
  const calendar = await getCalendarApi();
  const eventsRes = await calendar.events.list({
    calendarId,
    timeMin: startIso,
    timeMax: endIso,
    singleEvents: true,
  });

  const events = eventsRes.data.items || [];
  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    if (excludeEventId && ev.id === excludeEventId) continue;

    const evStart = new Date(ev.start?.dateTime || ev.start?.date || "").getTime();
    const evEnd = new Date(ev.end?.dateTime || ev.end?.date || "").getTime();

    if (checkStart < evEnd && checkEnd > evStart) {
      return false;
    }
  }

  return true;
}

/**
 * Generates human-friendly display label for a slot formatted in the visitor's timezone.
 */
export function formatSlotDisplay(
  startDate: Date,
  endDate: Date,
  timeZone: string
): string {
  try {
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const tzFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    });

    const dateStr = dateFormatter.format(startDate);
    const startStr = timeFormatter.format(startDate);
    const endStr = timeFormatter.format(endDate);
    const parts = tzFormatter.formatToParts(startDate);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || timeZone;

    return `${dateStr}, ${startStr} – ${endStr} (${tzPart})`;
  } catch {
    return `${startDate.toISOString()} – ${endDate.toISOString()}`;
  }
}

/**
 * Finds 2-3 genuine available slots within business hours, verified against real calendar data.
 */
export async function findAvailableSlots(
  query: AvailableSlotsQuery = {}
): Promise<SlotOption[]> {
  const visitorTz = query.visitorTimezone || DEFAULT_CONFIG.businessTimezone;
  const duration = query.durationMinutes || DEFAULT_CONFIG.defaultDurationMinutes;

  const now = new Date();
  // Search range: start tomorrow or requested date
  let searchStart = query.startDate ? new Date(query.startDate) : new Date(now);
  if (isNaN(searchStart.getTime()) || searchStart < now) {
    searchStart = new Date(now);
  }

  // If searchStart is today and it's already late in the day, start tomorrow
  const searchEnd = query.endDate
    ? new Date(query.endDate)
    : new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days window

  // Query busy intervals for the entire candidate window from Google
  const busyIntervals = await getFreeBusy(
    searchStart.toISOString(),
    searchEnd.toISOString()
  );

  const availableSlots: SlotOption[] = [];
  const currentDay = new Date(searchStart);

  // Iterate day by day looking for open slots
  while (currentDay < searchEnd && availableSlots.length < 3) {
    // Determine day of week in business timezone
    // 0 = Sunday, 6 = Saturday -> Skip weekends
    const dayOfWeek = currentDay.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Build working hours for this day (09:00 to 18:00)
      for (
        let hour = DEFAULT_CONFIG.businessHours.startHour;
        hour < DEFAULT_CONFIG.businessHours.endHour;
        hour++
      ) {
        for (let minute = 0; minute < 60; minute += duration) {
          if (availableSlots.length >= 3) break;

          const slotStart = new Date(currentDay);
          slotStart.setHours(hour, minute, 0, 0);

          const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

          // Must be at least 30 minutes in the future
          if (slotStart.getTime() <= now.getTime() + 30 * 60 * 1000) {
            continue;
          }

          // Check if slot falls completely outside working hours
          if (
            slotEnd.getHours() > DEFAULT_CONFIG.businessHours.endHour ||
            (slotEnd.getHours() === DEFAULT_CONFIG.businessHours.endHour &&
              slotEnd.getMinutes() > 0)
          ) {
            continue;
          }

          // Check collision against busy intervals
          const isBusy = busyIntervals.some(
            (b) => slotStart.getTime() < b.end && slotEnd.getTime() > b.start
          );

          if (!isBusy) {
            availableSlots.push({
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
              display: formatSlotDisplay(slotStart, slotEnd, visitorTz),
            });
          }
        }
      }
    }

    // Advance to next day
    currentDay.setDate(currentDay.getDate() + 1);
    currentDay.setHours(0, 0, 0, 0);
  }

  return availableSlots;
}

/**
 * Creates an actual Google Calendar event with Google Meet conference and attendee invite.
 * Enforces race-condition safety: Re-checks slot availability before creating event.
 */
export async function createEvent(booking: BookingRequest): Promise<BookingResult> {
  const { summary, description, start, end, visitorEmail, timezone } = booking;

  // Race-condition safety check: Verify slot is STILL available
  const stillAvailable = await isSlotAvailable(start, end);
  if (!stillAvailable) {
    return {
      success: false,
      error_code: "SLOT_NO_LONGER_AVAILABLE",
      retryable: false,
      message: "The requested time slot is no longer available. Please select another slot.",
    };
  }

  const calendar = await getCalendarApi();
  const requestId = `meet-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  try {
    const res = await calendar.events.insert({
      calendarId: DEFAULT_CONFIG.calendarId,
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary: summary || "CloseFuture Discovery Call",
        description:
          description ||
          "Discovery call for the CloseFuture case study assistant. We will discuss your project requirements, scope, and next steps.",
        start: {
          dateTime: start,
          timeZone: timezone,
        },
        end: {
          dateTime: end,
          timeZone: timezone,
        },
        attendees: visitorEmail ? [{ email: visitorEmail }] : [],
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: {
              type: "hangoutsMeet",
            },
          },
        },
      },
    });

    const event = res.data;
    const meetLink =
      event.hangoutLink ||
      event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri;

    return {
      success: true,
      eventId: event.id!,
      htmlLink: event.htmlLink || undefined,
      meetLink: meetLink || undefined,
      start,
      end,
      timezone,
      attendeeEmail: visitorEmail,
    };
  } catch (error: any) {
    console.error("[CalendarService] Event creation failed:", error?.message || error);
    return {
      success: false,
      error_code: "EVENT_CREATION_FAILED",
      retryable: error?.code ? error.code >= 500 : true,
      message: error?.message || "Failed to create Google Calendar event.",
    };
  }
}

/**
 * Reschedules an existing Google Calendar event to a new verified time slot.
 * Preserves the existing event ID.
 */
export async function updateEvent(
  request: RescheduleRequest
): Promise<BookingResult> {
  const { eventId, newStart, newEnd, timezone, visitorEmail } = request;

  // Race-condition safety check: Verify new slot is available
  const stillAvailable = await isSlotAvailable(newStart, newEnd, eventId);
  if (!stillAvailable) {
    return {
      success: false,
      error_code: "SLOT_NO_LONGER_AVAILABLE",
      retryable: false,
      message: "The requested reschedule slot is no longer available. Please choose a different time.",
    };
  }

  const calendar = await getCalendarApi();

  try {
    const res = await calendar.events.patch({
      calendarId: DEFAULT_CONFIG.calendarId,
      eventId,
      sendUpdates: "all",
      requestBody: {
        start: {
          dateTime: newStart,
          timeZone: timezone,
        },
        end: {
          dateTime: newEnd,
          timeZone: timezone,
        },
        ...(visitorEmail ? { attendees: [{ email: visitorEmail }] } : {}),
      },
    });

    const event = res.data;
    const meetLink =
      event.hangoutLink ||
      event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri;

    return {
      success: true,
      eventId: event.id!,
      htmlLink: event.htmlLink || undefined,
      meetLink: meetLink || undefined,
      start: newStart,
      end: newEnd,
      timezone,
      attendeeEmail: visitorEmail,
    };
  } catch (error: any) {
    console.error("[CalendarService] Event reschedule failed:", error?.message || error);
    return {
      success: false,
      error_code: "EVENT_UPDATE_FAILED",
      retryable: error?.code ? error.code >= 500 : true,
      message: error?.message || "Failed to update Google Calendar event.",
    };
  }
}

/**
 * Cancels/deletes an existing Google Calendar event.
 */
export async function deleteEvent(
  eventId: string,
  calendarId = DEFAULT_CONFIG.calendarId
): Promise<{ success: boolean; eventId: string; message?: string }> {
  const calendar = await getCalendarApi();

  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: "all",
    });

    return { success: true, eventId };
  } catch (error: any) {
    console.error("[CalendarService] Event cancellation failed:", error?.message || error);
    return {
      success: false,
      eventId,
      message: error?.message || "Failed to delete Google Calendar event.",
    };
  }
}
