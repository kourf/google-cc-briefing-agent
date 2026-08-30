/**
 * Google CC Briefing Agent
 * TriggerService.js — Configuration et gestion des déclencheurs quotidiens (06:00 Europe/Paris)
 */

const TriggerService = (function () {
  const TRIGGER_FUNCTION_NAME = 'runBriefing';

  /**
   * Installe le déclencheur quotidien pour exécuter le briefing autour de 06:00 heure de Paris.
   */
  function installDailyTrigger() {
    // 1. Supprime d'abord les anciens déclencheurs pour éviter tout doublon
    removeDailyTriggers();

    // 2. Création du déclencheur temporel quotidien à 06:00
    ScriptApp.newTrigger(TRIGGER_FUNCTION_NAME)
      .timeBased()
      .atHour(6)
      .everyDays(1)
      .inTimezone(Config.DEFAULTS.TIMEZONE)
      .create();

    console.log(
      'Déclencheur quotidien installé avec succès : exécution prévue autour de 06:00 (' +
        Config.DEFAULTS.TIMEZONE +
        ').'
    );
  }

  /**
   * Supprime tous les déclencheurs associés à runBriefing.
   */
  function removeDailyTriggers() {
    const allTriggers = ScriptApp.getProjectTriggers();
    let count = 0;

    for (let i = 0; i < allTriggers.length; i++) {
      const trigger = allTriggers[i];
      if (trigger.getHandlerFunction() === TRIGGER_FUNCTION_NAME) {
        ScriptApp.deleteTrigger(trigger);
        count++;
      }
    }

    if (count > 0) {
      console.log(count + ' ancien(s) déclencheur(s) supprimé(s).');
    }
  }

  /**
   * Vérifie si le jour actuel est un jour de week-end (Samedi ou Dimanche) à Paris.
   */
  function isWeekendNow() {
    const now = new Date();
    const dayStr = Utilities.formatDate(now, Config.DEFAULTS.TIMEZONE, 'u'); // 1 = Lundi, 7 = Dimanche
    const dayNum = parseInt(dayStr, 10);
    return dayNum === 6 || dayNum === 7; // Samedi ou Dimanche
  }

  return {
    installDailyTrigger: installDailyTrigger,
    removeDailyTriggers: removeDailyTriggers,
    isWeekendNow: isWeekendNow
  };
})();
