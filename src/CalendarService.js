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
   * Clé de rapprochement entre un événement CalendarApp et un événement de l'API avancée :
   * iCalUID (identique pour toutes les occurrences d'une série) + instant de début.
   */
  const nativeKey = (iCalUID, startMs) => `${iCalUID}|${startMs}`;

  /**
   * Liens de visioconférence natifs (Google Meet ajouté via le bouton de l'agenda, ou tout
   * outil intégré via conferenceData), lus en UN seul appel au service avancé Calendar.
   * Ces liens ne figurent ni dans le lieu ni dans la description : CalendarApp ne les voit pas.
   * Non bloquant : en cas d'indisponibilité du service, retour d'une table vide.
   *
   * @param {Date} timeMin - Début de la fenêtre.
   * @param {Date} timeMax - Fin de la fenêtre.
   * @returns {Map<string, string>} clé (iCalUID|début, puis iCalUID seul) -> lien.
   */
  const fetchNativeConferenceLinks = (timeMin, timeMax) => {
    const links = new Map();
    if (typeof Calendar === 'undefined' || !Calendar.Events) return links;
    try {
      const response = Calendar.Events.list('primary', {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        maxResults: 250,
        fields: 'items(iCalUID,start,hangoutLink,conferenceData/entryPoints(entryPointType,uri))'
      });
      for (const item of (response && response.items) || []) {
        const video = ((item.conferenceData && item.conferenceData.entryPoints) || []).find(
          (ep) => ep.entryPointType === 'video' && ep.uri
        );
        const link = item.hangoutLink || (video && video.uri);
        if (!link || !item.iCalUID) continue;
        const start = item.start && (item.start.dateTime || item.start.date);
        if (start) links.set(nativeKey(item.iCalUID, new Date(start).getTime()), link);
        if (!links.has(item.iCalUID)) links.set(item.iCalUID, link);
      }
    } catch (error) {
      console.warn(`Liens de visioconférence natifs indisponibles : ${error.message}`);
    }
    return links;
  };

  /**
   * Lien de visioconférence natif d'un événement (occurrence exacte, sinon série).
   * @param {GoogleAppsScript.Calendar.CalendarEvent} event
   * @param {Map<string, string>} nativeLinks
   * @returns {string|null}
   */
  const findNativeLink = (event, nativeLinks) => {
    if (!nativeLinks || nativeLinks.size === 0) return null;
    let id = '';
    try {
      id = event.getId();
    } catch {
      return null;
    }
    return nativeLinks.get(nativeKey(id, event.getStartTime().getTime())) || nativeLinks.get(id) || null;
  };

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
   * Priorité au lien natif (Meet / conferenceData), puis au lien trouvé dans le lieu ou la description.
   * @param {GoogleAppsScript.Calendar.CalendarEvent} event
   * @param {Map<string, string>} nativeLinks
   * @returns {Object}
   */
  const formatEvent = (event, nativeLinks) => {
    const isAllDay = event.isAllDayEvent();
    const startTime = event.getStartTime();
    const endTime = event.getEndTime();
    const diffMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    const conferenceLink = findNativeLink(event, nativeLinks) || extractConferenceLink(event);
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
   * @param {Map<string, string>} nativeLinks
   * @returns {Array<Object>}
   */
  const getEventsForDay = (cal, day, nativeLinks) =>
    cal
      .getEventsForDay(day)
      .map((event) => formatEvent(event, nativeLinks))
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

    // Fenêtre large (veille 00h -> surlendemain 00h) : couvre les événements à cheval sur minuit.
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
    const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);
    const nativeLinks = fetchNativeConferenceLinks(windowStart, windowEnd);

    const todayEvents = getEventsForDay(cal, now, nativeLinks);
    const tomorrowEvents = getEventsForDay(cal, tomorrow, nativeLinks);
    console.log(`Agenda : ${todayEvents.length} événement(s) aujourd'hui, ${tomorrowEvents.length} demain.`);
    return { todayEvents, tomorrowEvents };
  };

  return {
    getAgenda
  };
})();
