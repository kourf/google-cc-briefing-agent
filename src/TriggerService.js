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

  /** Installe l'architecture complète : 06:00:00 exact + watchdog 07h00. */
  const setupAllTriggers = () => {
    setupDailyTrigger();
    setupWatchdogTrigger();
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

  /** @returns {{hasMain: boolean, hasWatchdog: boolean}} État des deux déclencheurs indispensables. */
  const getTriggerHealth = () => {
    const handlers = getTriggersSummary().map((t) => t.handler);
    return {
      hasMain: handlers.includes(TRIGGER_FUNCTION_NAME),
      hasWatchdog: handlers.includes(WATCHDOG_FUNCTION_NAME)
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
    getTriggersSummary,
    getTriggerHealth,
    calculateNextTargetDate,
    isWeekendNow
  };
})();
