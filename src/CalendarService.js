/**
 * Google CC Briefing Agent
 * CalendarService.js — Google Calendar agenda retrieval, conference link extraction, and event formatting.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const CalendarService = (() => {
  /**
   * Detects and extracts video conferencing URLs (Google Meet, Zoom, Teams) from event fields.
   * @param {GoogleAppsScript.Calendar.CalendarEvent} event - Calendar event instance.
   * @returns {string|null} Conference link if found, otherwise null.
   */
  const extractConferenceLink = (event) => {
    const loc = event.getLocation() || '';
    const desc = event.getDescription() || '';
    const textToSearch = `${loc} ${desc}`;

    // Google Meet link
    const meetMatch = textToSearch.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
    if (meetMatch) return meetMatch[0];

    // Zoom link
    const zoomMatch = textToSearch.match(/https:\/\/[a-z0-9.-]+\.zoom\.us\/j\/[0-9?=&_-]+/i);
    if (zoomMatch) return zoomMatch[0];

    // Microsoft Teams link
    const teamsMatch = textToSearch.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/i);
    if (teamsMatch) return teamsMatch[0];

    return null;
  };

  /**
   * Formats a raw CalendarEvent into a clean structured presentation object.
   * @param {GoogleAppsScript.Calendar.CalendarEvent} event - Calendar event.
   * @returns {Object} Structured event data.
   */
  const formatEvent = (event) => {
    const isAllDay = event.isAllDayEvent();
    const startTime = event.getStartTime();
    const endTime = event.getEndTime();
    const diffMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (60 * 1000));

    const timeRangeStr = isAllDay
      ? 'Toute la journée'
      : `${Utils.formatTime(startTime)} - ${Utils.formatTime(endTime)}`;

    const confLink = extractConferenceLink(event);
    const location = event.getLocation() || '';
    const title = event.getTitle() || '(Sans titre)';

    return {
      id: event.getId(),
      title,
      isAllDay,
      startTime,
      endTime,
      timeFormatted: timeRangeStr,
      startFormatted: Utils.formatTime(startTime),
      durationFormatted: isAllDay ? '' : Utils.formatDuration(diffMinutes),
      location,
      isPhysical: Boolean(location && !confLink && !location.match(/http/i)),
      conferenceLink: confLink,
      calendarUrl: Utils.buildCalendarUrl(event.getId())
    };
  };

  /**
   * Retrieves events from the primary calendar for Today and Tomorrow.
   * @returns {{ todayEvents: Array<Object>, tomorrowEvents: Array<Object> }} Sorted calendar events.
   */
  const getAgenda = () => {
    const cal = CalendarApp.getDefaultCalendar();
    if (!cal) {
      console.warn('Primary Google Calendar is inaccessible.');
      return { todayEvents: [], tomorrowEvents: [] };
    }

    const now = new Date();

    // Today's range (00:00:00 to 23:59:59)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // Tomorrow's range (00:00:00 to 23:59:59)
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);

    const todayRaw = cal.getEvents(todayStart, todayEnd);
    const tomorrowRaw = cal.getEvents(tomorrowStart, tomorrowEnd);

    const todayEvents = todayRaw.map(formatEvent);
    const tomorrowEvents = tomorrowRaw.map(formatEvent);

    // Chronological ordering
    todayEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    tomorrowEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    console.log(
      `Calendar events fetched: ${todayEvents.length} today, ${tomorrowEvents.length} tomorrow.`
    );

    return {
      todayEvents,
      tomorrowEvents
    };
  };

  return {
    getAgenda
  };
})();
