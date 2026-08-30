/**
 * Google CC Briefing Agent
 * CalendarService.js — Analyse de l'agenda Google Calendar (Aujourd'hui & À anticiper demain)
 */

const CalendarService = (function () {
  /**
   * Extrait le lien de visioconférence (Google Meet, Zoom, Teams) depuis l'événement.
   */
  function extractConferenceLink(event) {
    const loc = event.getLocation() || '';
    const desc = event.getDescription() || '';
    const textToSearch = loc + ' ' + desc;

    // Détection Meet
    const meetMatch = textToSearch.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
    if (meetMatch) return meetMatch[0];

    // Détection Zoom
    const zoomMatch = textToSearch.match(/https:\/\/[a-z0-9.-]+\.zoom\.us\/j\/[0-9?=&_-]+/i);
    if (zoomMatch) return zoomMatch[0];

    // Détection Teams
    const teamsMatch = textToSearch.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/i);
    if (teamsMatch) return teamsMatch[0];

    return null;
  }

  /**
   * Formate les détails d'un événement Calendar en objet structuré.
   */
  function formatEvent(event) {
    const isAllDay = event.isAllDayEvent();
    const startTime = event.getStartTime();
    const endTime = event.getEndTime();
    const diffMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (60 * 1000));

    let timeRangeStr = '';
    if (isAllDay) {
      timeRangeStr = 'Toute la journée';
    } else {
      timeRangeStr = Utils.formatTime(startTime) + ' - ' + Utils.formatTime(endTime);
    }

    const confLink = extractConferenceLink(event);
    const location = event.getLocation() || '';
    const title = event.getTitle() || '(Sans titre)';

    return {
      id: event.getId(),
      title: title,
      isAllDay: isAllDay,
      startTime: startTime,
      endTime: endTime,
      timeFormatted: timeRangeStr,
      startFormatted: Utils.formatTime(startTime),
      durationFormatted: isAllDay ? '' : Utils.formatDuration(diffMinutes),
      location: location,
      isPhysical: Boolean(location && !confLink && !location.match(/http/i)),
      conferenceLink: confLink,
      calendarUrl: Utils.buildCalendarUrl(event.getId())
    };
  }

  /**
   * Récupère les événements du calendrier principal pour Aujourd'hui et Demain.
   */
  function getAgenda() {
    const cal = CalendarApp.getDefaultCalendar();
    if (!cal) {
      console.warn('Calendrier principal inaccessible.');
      return { todayEvents: [], tomorrowEvents: [] };
    }

    const now = new Date();

    // Calcul de début et fin d'Aujourd'hui (Europe/Paris)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // Calcul de début et fin de Demain
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);

    const todayRaw = cal.getEvents(todayStart, todayEnd);
    const tomorrowRaw = cal.getEvents(tomorrowStart, tomorrowEnd);

    const todayEvents = [];
    for (let i = 0; i < todayRaw.length; i++) {
      todayEvents.push(formatEvent(todayRaw[i]));
    }

    const tomorrowEvents = [];
    for (let j = 0; j < tomorrowRaw.length; j++) {
      tomorrowEvents.push(formatEvent(tomorrowRaw[j]));
    }

    // Tri chronologique
    todayEvents.sort(function (a, b) {
      return a.startTime.getTime() - b.startTime.getTime();
    });
    tomorrowEvents.sort(function (a, b) {
      return a.startTime.getTime() - b.startTime.getTime();
    });

    console.log(
      'Agenda récupéré : ' +
        todayEvents.length +
        ' événement(s) aujourd’hui, ' +
        tomorrowEvents.length +
        ' événement(s) demain.'
    );

    return {
      todayEvents: todayEvents,
      tomorrowEvents: tomorrowEvents
    };
  }

  return {
    getAgenda: getAgenda
  };
})();
