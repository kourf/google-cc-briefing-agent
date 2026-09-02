/**
 * Google CC Briefing Agent
 * TriggerService.js — Gestion des déclencheurs exacts auto-reprogrammés (06:00:00 Europe/Paris)
 * Élimine la fenêtre aléatoire de 60 minutes de Google Apps Script pour garantir une exécution à 06h00 pile.
 */

const TriggerService = (function () {
  const TRIGGER_FUNCTION_NAME = 'runDailyBriefing';
  const LEGACY_FUNCTION_NAMES = ['runBriefing', 'runBriefingPrecise'];

  /**
   * Supprime de façon sécurisée tous les déclencheurs de projet orphelins ou existants.
   */
  function clearAllTriggers() {
    const allTriggers = ScriptApp.getProjectTriggers();
    let count = 0;
    const targets = [TRIGGER_FUNCTION_NAME].concat(LEGACY_FUNCTION_NAMES);

    for (let i = 0; i < allTriggers.length; i++) {
      const trigger = allTriggers[i];
      const handler = trigger.getHandlerFunction();
      if (targets.indexOf(handler) !== -1) {
        try {
          ScriptApp.deleteTrigger(trigger);
          count++;
        } catch (e) {
          console.warn('Impossible de supprimer le déclencheur ' + handler + ' : ' + e.message);
        }
      }
    }

    if (count > 0) {
      console.log(count + ' ancien(s) déclencheur(s) supprimé(s) pour éviter les doublons.');
    }
  }

  /**
   * Calcule le prochain horodatage exact à 06:00:00 dans le fuseau horaire Europe/Paris.
   * Si l'heure actuelle est avant 06:00, planifie pour aujourd'hui à 06:00.
   * Si l'heure actuelle est après 06:00, planifie pour demain à 06:00.
   *
   * @return {Date} Date exacte de la prochaine exécution
   */
  function calculateNextTargetDate() {
    const tz = Config.DEFAULTS.TIMEZONE || 'Europe/Paris';
    const targetHour = Config.DEFAULTS.TRIGGER_HOUR !== undefined ? Config.DEFAULTS.TRIGGER_HOUR : 6;
    const targetMinute = Config.DEFAULTS.TRIGGER_MINUTE !== undefined ? Config.DEFAULTS.TRIGGER_MINUTE : 0;

    const now = new Date();
    const todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const currentHour = parseInt(Utilities.formatDate(now, tz, 'HH'), 10);
    const currentMinute = parseInt(Utilities.formatDate(now, tz, 'mm'), 10);

    const parts = todayStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let day = parseInt(parts[2], 10);

    // Si 06:00 est déjà passé aujourd'hui (ou en cours d'exécution), on planifie pour demain
    if (currentHour > targetHour || (currentHour === targetHour && currentMinute >= targetMinute)) {
      day += 1;
    }

    // Le constructeur Date gère nativement le passage au mois ou à l'année suivante
    const targetDate = new Date(year, month, day, targetHour, targetMinute, 0, 0);
    return targetDate;
  }

  /**
   * Installe le déclencheur exact auto-reprogrammé à 06:00:00 pile.
   * Utilise .timeBased().at(targetDate) pour une précision horaire absolue.
   *
   * @return {Date} La date et l'heure exacte programmée
   */
  function setupDailyTrigger() {
    // 1. Purge préalable des déclencheurs existants
    clearAllTriggers();

    // 2. Calcul du prochain passage à 06:00:00
    const targetDate = calculateNextTargetDate();
    const tz = Config.DEFAULTS.TIMEZONE || 'Europe/Paris';

    // 3. Création du déclencheur ponctuel exact à l'horodatage cible
    ScriptApp.newTrigger(TRIGGER_FUNCTION_NAME)
      .timeBased()
      .at(targetDate)
      .inTimezone(tz)
      .create();

    const formattedTarget = Utilities.formatDate(targetDate, tz, 'dd/MM/yyyy à HH:mm:ss');
    console.log(
      '✓ Déclencheur précis configuré avec succès : prochaine exécution programmée pour le ' +
        formattedTarget +
        ' (' +
        tz +
        ').'
    );

    return targetDate;
  }

  /**
   * Alias de compatibilité.
   */
  function installDailyTrigger() {
    return setupDailyTrigger();
  }

  /**
   * Alias de compatibilité pour la suppression.
   */
  function removeDailyTriggers() {
    clearAllTriggers();
  }

  /**
   * Vérifie si le jour actuel est un jour de week-end (Samedi ou Dimanche) à Paris.
   */
  function isWeekendNow() {
    const now = new Date();
    const dayStr = Utilities.formatDate(now, Config.DEFAULTS.TIMEZONE, 'u'); // 1 = Lundi, 7 = Dimanche
    const dayNum = parseInt(dayStr, 10);
    return dayNum === 6 || dayNum === 7;
  }

  return {
    setupDailyTrigger: setupDailyTrigger,
    clearAllTriggers: clearAllTriggers,
    installDailyTrigger: installDailyTrigger,
    removeDailyTriggers: removeDailyTriggers,
    calculateNextTargetDate: calculateNextTargetDate,
    isWeekendNow: isWeekendNow
  };
})();
