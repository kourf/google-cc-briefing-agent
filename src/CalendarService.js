/**
 * Google CC Briefing Agent
 * CalendarService.js — Agenda du jour et du lendemain (Google Calendar principal),
 * extraction des liens de visioconférence et mise en forme des événements.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const CalendarService = (() => {
  /** Motifs des liens de visioconférence reconnus (ordre de priorité). */
  const CONFERENCE_PATTERNS = Object.freeze([
    /https:\/\/meet\.google\.com\/[a-z0-9-]+/i,
    /https:\/\/(?:[a-z0-9-]+\.)?zoom\.us\/(?:j|my|w)\/[^\s"<>]+/i,
    /https:\/\/teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s"<>]+/i,
    /https:\/\/teams\.live\.com\/meet\/[^\s"<>]+/i
  ]);

  /**
   * Premier lien de visioconférence trouvé dans le lieu ou la description.
   * @param {GoogleAppsScript.Calendar.CalendarEvent} event
   * @returns {string|null}
   */
  const extractConferenceLink = (event) => {
    const text = `${event.getLocation() || ''} ${event.getDescription() || ''}`;
    for (const pattern of CONFERENCE_PATTERNS) {
      const m = text.match(pattern);
      if (m) return m[0].replace(/[).,;]+$/, '');
    }
    return null;
  };

  /**
   * Transforme un CalendarEvent en objet de présentation.
   * @param {GoogleAppsScript.Calendar.CalendarEvent} event
   * @returns {Object}
   */
  const formatEvent = (event) => {
    const isAllDay = event.isAllDayEvent();
    const startTime = event.getStartTime();
    const endTime = event.getEndTime();
    const diffMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    const conferenceLink = extractConferenceLink(event);
    const location = Utils.sanitizeText(event.getLocation() || '');

    return {
      title: Utils.sanitizeText(event.getTitle()) || '(Sans titre)',
      isAllDay,
      startTime,
      timeFormatted: isAllDay ? 'Toute la journée' : `${Utils.formatTime(startTime)} - ${Utils.formatTime(endTime)}`,
      durationFormatted: isAllDay ? '' : Utils.formatDuration(diffMinutes),
      location,
      isPhysical: Boolean(location && !conferenceLink && !/https?:\/\//i.test(location)),
      conferenceLink,
      calendarUrl: Utils.buildCalendarUrl(startTime)
    };
  };

  /**
   * Événements d'un jour, triés (journées entières d'abord, puis par heure).
   * @param {GoogleAppsScript.Calendar.Calendar} cal
   * @param {Date} day
   * @returns {Array<Object>}
   */
  const getEventsForDay = (cal, day) =>
    cal
      .getEventsForDay(day)
      .map(formatEvent)
      .sort((a, b) => (a.isAllDay === b.isAllDay ? a.startTime.getTime() - b.startTime.getTime() : a.isAllDay ? -1 : 1));

  /**
   * Agenda d'aujourd'hui et de demain (fuseau du script : Europe/Paris).
   * @returns {{todayEvents: Array<Object>, tomorrowEvents: Array<Object>}}
   */
  const getAgenda = () => {
    const cal = CalendarApp.getDefaultCalendar();
    if (!cal) {
      console.warn('Agenda principal inaccessible.');
      return { todayEvents: [], tomorrowEvents: [] };
    }
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);

    const todayEvents = getEventsForDay(cal, now);
    const tomorrowEvents = getEventsForDay(cal, tomorrow);
    console.log(`Agenda : ${todayEvents.length} événement(s) aujourd'hui, ${tomorrowEvents.length} demain.`);
    return { todayEvents, tomorrowEvents };
  };

  return {
    getAgenda
  };
})();
