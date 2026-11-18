/**
 * Google CC Briefing Agent
 * WeeklyReviewService.js — Rendez-vous hebdomadaires du briefing.
 *
 * - Vendredi : « Bilan de la semaine » — on regarde EN ARRIÈRE : ce qui s'est passé depuis lundi
 *   (mails, actions demandées, offres d'emploi, dossiers qui ont bougé) et ce qu'il reste à faire.
 * - Dimanche : « Votre semaine à venir » — on regarde DEVANT : rendez-vous des 7 prochains jours,
 *   échéances à venir et dossiers à faire avancer, pour s'organiser dès lundi.
 *
 * Un journal quotidien (propriété du script WEEKLY_JOURNAL) garde chaque matin l'essentiel du briefing,
 * pour que le bilan du vendredi puisse relire la semaine.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const WeeklyReviewService = (() => {
  const JOURNAL_KEY = 'WEEKLY_JOURNAL';
  /** Jours conservés dans le journal. */
  const KEEP_DAYS = 14;
  /** Limites d'affichage. */
  const MAX_ACTIONS = 8;
  const MAX_OFFERS = 5;
  /** Échéances signalées dans le bilan du vendredi : jusqu'à N jours. */
  const FRIDAY_DEADLINE_DAYS = 10;
  /** Fenêtre de la semaine à venir (jours). */
  const WEEK_DAYS = 7;

  const tz = () => Config.DEFAULTS.TIMEZONE;
  const isoDay = (d) => Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
  const shortText = (s, max) => {
    const t = Utils.sanitizeText(s || '');
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };

  /**
   * Journal (du plus ancien au plus récent).
   * @returns {Array<Object>}
   */
  const readJournal = () => {
    try {
      const raw = PropertiesService.getScriptProperties().getProperty(JOURNAL_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };

  /**
   * Note l'essentiel du briefing du jour dans le journal (une entrée par jour, remplacée si le
   * briefing est renvoyé le même jour). Jamais bloquant.
   *
   * @param {Object} day
   * @param {number} day.totalEmails
   * @param {Array<Object>} day.urgentItems
   * @param {Object} day.jobOffers
   * @param {Object|null} day.urgentFiles
   */
  const record = ({ totalEmails, urgentItems, jobOffers, urgentFiles }) => {
    try {
      const today = isoDay(new Date());
      const offers = (jobOffers && jobOffers.items) || [];
      const entry = {
        date: today,
        emails: Number(totalEmails) || 0,
        actions: (urgentItems || []).slice(0, MAX_ACTIONS).map((a) => ({
          title: shortText(a.actionTitle, 110),
          deadline: shortText(a.deadline || '', 30)
        })),
        offers: offers.length + ((jobOffers && jobOffers.extraCount) || 0),
        bestOffers: offers
          .filter((o) => o.matchesProfile)
          .slice(0, 3)
          .map((o) => ({ title: shortText(o.title, 80), company: shortText(o.company, 40), url: o.directUrl || o.emailUrl || '' })),
        movedFiles: ((urgentFiles && urgentFiles.files) || [])
          .filter((f) => f.isNew)
          .map((f) => ({ sender: shortText(f.sender, 50), change: shortText(f.changement || f.etat, 160) }))
      };
      const journal = readJournal().filter((e) => e.date !== today);
      journal.push(entry);
      const cutoff = isoDay(new Date(Date.now() - KEEP_DAYS * 86400000));
      let kept = journal.filter((e) => e.date >= cutoff).sort((a, b) => (a.date < b.date ? -1 : 1));
      // Sécurité de taille (une propriété du script est limitée à environ 9 Ko).
      while (JSON.stringify(kept).length > 8500 && kept.length > 1) kept = kept.slice(1);
      PropertiesService.getScriptProperties().setProperty(JOURNAL_KEY, JSON.stringify(kept));
    } catch (error) {
      console.warn(`Journal de la semaine non enregistré : ${error.message}`);
    }
  };

  /**
   * Rendez-vous hebdomadaire du jour : « friday », « sunday » ou null.
   * @param {Date} date
   * @returns {string|null}
   */
  const modeFor = (date) => {
    const weekday = Number(Utilities.formatDate(date, tz(), 'u')); // 1 = lundi … 7 = dimanche
    if (weekday === 5) return 'friday';
    if (weekday === 7) return 'sunday';
    return null;
  };

  /**
   * Lundi 00:00 de la semaine en cours (fuseau du script).
   * @param {Date} now
   * @returns {Date}
   */
  const mondayOf = (now) => {
    const weekday = Number(Utilities.formatDate(now, tz(), 'u'));
    const d = new Date(now.getTime() - (weekday - 1) * 86400000);
    return new Date(`${isoDay(d)}T00:00:00`);
  };

  /** « lundi 16 novembre » */
  const dayLabel = (d) => {
    const s = Utils.formatDateFrench(d).replace(/\s+\d{4}$/, '');
    return s.charAt(0).toLowerCase() + s.slice(1);
  };

  /**
   * Dossiers urgents avec une échéance dans les N prochains jours (ou dépassée), triés par date.
   * @param {Object|null} urgentFiles
   * @param {number} maxDays
   * @returns {Array<Object>}
   */
  const upcomingDeadlines = (urgentFiles, maxDays) =>
    ((urgentFiles && urgentFiles.files) || [])
      .filter((f) => f.deadline && f.level !== 'regle' && f.deadline.days <= maxDays)
      .sort((a, b) => a.deadline.days - b.deadline.days)
      .map((f) => ({
        sender: f.sender,
        action: f.prochaineAction,
        montant: f.montant,
        date: f.deadline.formatted,
        label: f.deadline.label,
        overdue: f.deadline.days < 0,
        webUrl: f.webUrl
      }));

  /**
   * Bilan du vendredi : la semaine écoulée (lundi -> aujourd'hui).
   * @param {Object|null} urgentFiles
   * @returns {Object}
   */
  const buildFriday = (urgentFiles) => {
    const now = new Date();
    const monday = mondayOf(now);
    const mondayIso = isoDay(monday);
    const week = readJournal().filter((e) => e.date >= mondayIso && e.date <= isoDay(now));

    const seenActions = new Set();
    const actions = [];
    week.forEach((e) =>
      (e.actions || []).forEach((a) => {
        const key = String(a.title).toLowerCase();
        if (!a.title || seenActions.has(key)) return;
        seenActions.add(key);
        actions.push(a);
      })
    );
    const seenOffers = new Set();
    const bestOffers = [];
    week.forEach((e) =>
      (e.bestOffers || []).forEach((o) => {
        const key = `${o.title}|${o.company}`.toLowerCase();
        if (seenOffers.has(key)) return;
        seenOffers.add(key);
        bestOffers.push(o);
      })
    );

    const mondayTime = monday.getTime();
    const movedFiles = ((urgentFiles && urgentFiles.files) || [])
      .filter((f) => f.lastTime && f.lastTime >= mondayTime)
      .map((f) => ({ sender: f.sender, levelLabel: f.levelLabel, levelStyle: f.levelStyle, etat: f.etat || `« ${f.subject} »`, webUrl: f.webUrl }));

    return {
      kind: 'friday',
      title: 'Bilan de la semaine',
      intro: 'Vendredi, on regarde en arrière : ce qui s’est passé depuis lundi et ce qu’il reste à régler avant de souffler.',
      period: `Du ${dayLabel(monday)} au ${dayLabel(now)}`,
      daysLogged: week.length,
      journalNote: week.length < 5 ? `Le carnet de la semaine couvre ${week.length} jour${week.length > 1 ? 's' : ''} (il a commencé en cours de semaine).` : '',
      emails: week.reduce((n, e) => n + (Number(e.emails) || 0), 0),
      actionsCount: actions.length,
      actions: actions.slice(0, MAX_ACTIONS),
      offers: week.reduce((n, e) => n + (Number(e.offers) || 0), 0),
      bestOffers: bestOffers.slice(0, MAX_OFFERS),
      movedFiles,
      deadlines: upcomingDeadlines(urgentFiles, FRIDAY_DEADLINE_DAYS)
    };
  };

  /**
   * Préparation du dimanche : les 7 prochains jours.
   * @param {Object|null} urgentFiles
   * @returns {Object}
   */
  const buildSunday = (urgentFiles) => {
    const now = new Date();
    const start = new Date(`${isoDay(new Date(now.getTime() + 86400000))}T00:00:00`);
    const end = new Date(start.getTime() + WEEK_DAYS * 86400000);

    let days = [];
    let routineCount = 0;
    try {
      const upcoming = CalendarService.getUpcomingEvents(start, end);
      routineCount = upcoming.routineCount;
      const byDay = new Map();
      for (const ev of upcoming.events) {
        const key = isoDay(ev.startTime);
        if (!byDay.has(key)) byDay.set(key, { label: Utils.formatDateFrench(ev.startTime), events: [] });
        byDay.get(key).events.push({ time: ev.isAllDay ? 'Toute la journée' : `${ev.startFormatted} – ${ev.endFormatted}`, title: ev.title, location: ev.location, conferenceLink: ev.conferenceLink });
      }
      days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
    } catch (error) {
      console.warn(`Semaine à venir : agenda illisible — ${error.message}`);
    }

    const toPush = ((urgentFiles && urgentFiles.files) || [])
      .filter((f) => f.level === 'urgent' && f.prochaineAction)
      .map((f) => ({ sender: f.sender, action: f.prochaineAction, webUrl: f.webUrl }));

    return {
      kind: 'sunday',
      title: 'Votre semaine à venir',
      intro: 'Dimanche, on regarde devant : ce qui vous attend cette semaine, pour vous organiser dès lundi.',
      period: `Du ${dayLabel(start)} au ${dayLabel(new Date(end.getTime() - 1))}`,
      days,
      routineCount,
      deadlines: upcomingDeadlines(urgentFiles, WEEK_DAYS),
      toPush
    };
  };

  /**
   * Rubrique hebdomadaire à afficher (ou null les autres jours).
   * @param {Object} params
   * @param {string|null} params.mode - « friday », « sunday » ou null.
   * @param {Object|null} params.urgentFiles
   * @returns {Object|null}
   */
  const build = ({ mode, urgentFiles }) => {
    try {
      if (mode === 'friday') return buildFriday(urgentFiles);
      if (mode === 'sunday') return buildSunday(urgentFiles);
    } catch (error) {
      console.warn(`Rubrique hebdomadaire indisponible : ${error.message}`);
    }
    return null;
  };

  return {
    record,
    modeFor,
    build
  };
})();
