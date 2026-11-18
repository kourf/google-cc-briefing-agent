/**
 * Google CC Briefing Agent
 * TriggerService.js — Déclencheur exact de 06:00:00 (Europe/Paris) auto-reprogrammé chaque jour,
 * watchdog quotidien de 07h00 et nettoyage des déclencheurs obsolètes.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const TriggerService = (() => {
  const TRIGGER_FUNCTION_NAME = 'runDailyBriefing';
  const WATCHDOG_FUNCTION_NAME = 'watchdogSafetyCheck';
  /** Analyse des dossiers urgents (mails + PDF), toutes les 2 heures, hors briefing (accord de l'utilisateur du 18/11/2026). */
  const URGENT_FILES_FUNCTION_NAME = 'preparerDossiersUrgents';
  const URGENT_FILES_EVERY_HOURS = 2;
  const LEGACY_FUNCTION_NAMES = Object.freeze(['runBriefing', 'runBriefingPrecise']);

  /**
   * Supprime tous les déclencheurs dont la fonction cible figure dans la liste.
   * @param {Array<string>} handlerNames
   * @returns {number} Nombre de déclencheurs supprimés.
   */
  const deleteTriggersFor = (handlerNames) => {
    let count = 0;
    for (const trigger of ScriptApp.getProjectTriggers()) {
      if (!handlerNames.includes(trigger.getHandlerFunction())) continue;
      try {
        ScriptApp.deleteTrigger(trigger);
        count++;
      } catch (error) {
        console.warn(`Suppression impossible (${trigger.getHandlerFunction()}) : ${error.message}`);
      }
    }
    return count;
  };

  /**
   * Décalage UTC (minutes) d'un fuseau à un instant donné, via Utilities.formatDate (format "Z" : +0100).
   * @param {Date} date
   * @param {string} tz
   * @returns {number}
   */
  const offsetMinutes = (date, tz) => {
    const m = Utilities.formatDate(date, tz, 'Z').match(/([+-])(\d{2})(\d{2})/);
    if (!m) return 0;
    const value = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    return m[1] === '-' ? -value : value;
  };

  /**
   * Convertit une heure murale (fuseau tz) en instant absolu, en tenant compte
   * du changement d'heure (deux itérations suffisent à converger).
   */
  const zonedTimeToDate = (year, monthIndex, day, hour, minute, tz) => {
    const wallUtc = Date.UTC(year, monthIndex, day, hour, minute, 0, 0);
    let instant = wallUtc;
    for (let i = 0; i < 2; i++) {
      instant = wallUtc - offsetMinutes(new Date(instant), tz) * 60000;
    }
    return new Date(instant);
  };

  /**
   * Prochaine occurrence de TRIGGER_HOUR:TRIGGER_MINUTE (06:00:00) à Paris,
   * calculée explicitement dans le fuseau (indépendante du fuseau du moteur JavaScript).
   * @returns {Date}
   */
  const calculateNextTargetDate = () => {
    const tz = Config.DEFAULTS.TIMEZONE;
    const { TRIGGER_HOUR, TRIGGER_MINUTE } = Config.DEFAULTS;
    const now = new Date();
    const [y, m, d] = Utilities.formatDate(now, tz, 'yyyy-MM-dd').split('-').map((v) => parseInt(v, 10));

    const todayTarget = zonedTimeToDate(y, m - 1, d, TRIGGER_HOUR, TRIGGER_MINUTE, tz);
    if (now.getTime() < todayTarget.getTime()) return todayTarget;

    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
    return zonedTimeToDate(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), TRIGGER_HOUR, TRIGGER_MINUTE, tz);
  };

  /**
   * Installe l'unique déclencheur ponctuel de 06:00:00 (remplace les précédents).
   * @returns {Date} Instant programmé.
   */
  const setupDailyTrigger = () => {
    const purged = deleteTriggersFor([TRIGGER_FUNCTION_NAME, ...LEGACY_FUNCTION_NAMES]);
    if (purged > 0) console.log(`${purged} ancien(s) déclencheur(s) supprimé(s).`);

    const tz = Config.DEFAULTS.TIMEZONE;
    const targetDate = calculateNextTargetDate();
    ScriptApp.newTrigger(TRIGGER_FUNCTION_NAME).timeBased().at(targetDate).inTimezone(tz).create();
    console.log(`Prochain briefing programmé le ${Utilities.formatDate(targetDate, tz, 'dd/MM/yyyy à HH:mm:ss')} (${tz}).`);
    ensureUrgentFilesTrigger(); // réinstallé automatiquement s'il a disparu
    return targetDate;
  };

  /**
   * Installe le watchdog quotidien (créneau 07h-08h) qui rattrape un briefing manqué.
   */
  const setupWatchdogTrigger = () => {
    deleteTriggersFor([WATCHDOG_FUNCTION_NAME]);
    const tz = Config.DEFAULTS.TIMEZONE;
    ScriptApp.newTrigger(WATCHDOG_FUNCTION_NAME)
      .timeBased()
      .everyDays(1)
      .atHour(Config.DEFAULTS.WATCHDOG_HOUR)
      .inTimezone(tz)
      .create();
    console.log(`Watchdog quotidien installé à ${Config.DEFAULTS.WATCHDOG_HOUR}h00 (${tz}).`);
  };

  /**
   * Installe (une seule fois) l'analyse des dossiers urgents toutes les 2 heures. Elle tourne dans sa
   * propre exécution : même lente, elle ne peut ni retarder ni bloquer l'envoi du briefing de 06:00.
   * @returns {boolean} true si le déclencheur existe (déjà présent ou créé).
   */
  const ensureUrgentFilesTrigger = () => {
    try {
      if (ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === URGENT_FILES_FUNCTION_NAME)) return true;
      ScriptApp.newTrigger(URGENT_FILES_FUNCTION_NAME).timeBased().everyHours(URGENT_FILES_EVERY_HOURS).create();
      console.log(`Analyse des dossiers urgents programmée toutes les ${URGENT_FILES_EVERY_HOURS} heures.`);
      return true;
    } catch (error) {
      console.warn(`Analyse des dossiers urgents non programmée : ${error.message}`);
      return false;
    }
  };

  /** Installe l'architecture complète : 06:00:00 exact + watchdog 07h00 + dossiers urgents (toutes les 2 h). */
  const setupAllTriggers = () => {
    setupDailyTrigger();
    setupWatchdogTrigger();
    ensureUrgentFilesTrigger();
  };

  /**
   * Liste des déclencheurs actifs (diagnostic).
   * @returns {Array<{handler: string, type: string}>}
   */
  const getTriggersSummary = () =>
    ScriptApp.getProjectTriggers().map((t) => ({
      handler: t.getHandlerFunction(),
      type: t.getEventType() ? String(t.getEventType()) : 'CLOCK'
    }));

  /** @returns {{hasMain: boolean, hasWatchdog: boolean, hasUrgentFiles: boolean}} État des déclencheurs. */
  const getTriggerHealth = () => {
    const handlers = getTriggersSummary().map((t) => t.handler);
    return {
      hasMain: handlers.includes(TRIGGER_FUNCTION_NAME),
      hasWatchdog: handlers.includes(WATCHDOG_FUNCTION_NAME),
      hasUrgentFiles: handlers.includes(URGENT_FILES_FUNCTION_NAME)
    };
  };

  /** @returns {boolean} true le samedi et le dimanche (Europe/Paris). */
  const isWeekendNow = () => {
    const dayNum = parseInt(Utilities.formatDate(new Date(), Config.DEFAULTS.TIMEZONE, 'u'), 10); // 1 = lundi
    return dayNum === 6 || dayNum === 7;
  };

  return {
    setupDailyTrigger,
    setupAllTriggers,
    ensureUrgentFilesTrigger,
    getTriggersSummary,
    getTriggerHealth,
    calculateNextTargetDate,
    isWeekendNow
  };
})();
