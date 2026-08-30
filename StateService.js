/**
 * Google CC Briefing Agent
 * StateService.js — Gestion des checkpoints, verrous concurrentiels et idempotence
 */

const StateService = (function () {
  let activeLock = null;

  /**
   * Acquiert un verrou exclusif pour empêcher toute double exécution simultanée.
   */
  function acquireLock() {
    const lock = LockService.getScriptLock();
    try {
      const success = lock.tryLock(Config.DEFAULTS.LOCK_TIMEOUT_MS);
      if (!success) {
        console.warn('Verrou ScriptLock non disponible : une autre exécution est déjà en cours.');
        return false;
      }
      activeLock = lock;
      return true;
    } catch (e) {
      console.error('Erreur lors de l’acquisition du verrou :', e.message);
      return false;
    }
  }

  /**
   * Libère le verrou de script.
   */
  function releaseLock() {
    if (activeLock) {
      try {
        activeLock.releaseLock();
      } catch (e) {
        console.warn('Erreur lors de la libération du verrou :', e.message);
      }
      activeLock = null;
    }
  }

  /**
   * Récupère le timestamp du dernier checkpoint réussi (en secondes).
   */
  function getLastCheckpointTime() {
    const val = Config.getProps().getProperty(Config.KEYS.LAST_CHECKPOINT_TIME);
    if (!val) return null;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Initialise le checkpoint officiel si inexistant.
   * Empêche l'analyse historique de centaines d'anciens e-mails non lus lors de la mise en service.
   */
  function initCheckpointIfMissing() {
    const current = getLastCheckpointTime();
    if (!current) {
      const nowSec = Math.floor(Date.now() / 1000);
      Config.getProps().setProperty(Config.KEYS.LAST_CHECKPOINT_TIME, String(nowSec));
      console.log('Checkpoint initial créé : ' + new Date(nowSec * 1000).toISOString());
      return nowSec;
    }
    return current;
  }

  /**
   * Réinitialise explicitement le checkpoint à l'instant présent.
   */
  function resetCheckpointToNow() {
    const nowSec = Math.floor(Date.now() / 1000);
    Config.getProps().setProperty(Config.KEYS.LAST_CHECKPOINT_TIME, String(nowSec));
    console.log('Checkpoint réinitialisé à maintenant : ' + new Date(nowSec * 1000).toISOString());
    return nowSec;
  }

  /**
   * Vérifie si un briefing de production a déjà été envoyé aujourd'hui.
   */
  function hasRunToday() {
    const lastRunVal = Config.getProps().getProperty(Config.KEYS.LAST_BRIEFING_RUN_TIME);
    if (!lastRunVal) return false;

    const lastRunSec = parseInt(lastRunVal, 10);
    if (isNaN(lastRunSec)) return false;

    const todayStr = Utilities.formatDate(new Date(), Config.DEFAULTS.TIMEZONE, 'yyyy-MM-dd');
    const lastRunDateStr = Utilities.formatDate(new Date(lastRunSec * 1000), Config.DEFAULTS.TIMEZONE, 'yyyy-MM-dd');

    return todayStr === lastRunDateStr;
  }

  /**
   * Enregistre le succès complet d'un briefing en production.
   */
  function recordSuccessfulRun(newCheckpointSec) {
    const nowSec = Math.floor(Date.now() / 1000);
    const targetCheckpoint = newCheckpointSec || nowSec;

    Config.getProps().setProperties({
      [Config.KEYS.LAST_CHECKPOINT_TIME]: String(targetCheckpoint),
      [Config.KEYS.LAST_BRIEFING_RUN_TIME]: String(nowSec)
    });

    console.log(
      'Succès enregistré. Nouveau checkpoint : ' +
        new Date(targetCheckpoint * 1000).toISOString()
    );
  }

  return {
    acquireLock: acquireLock,
    releaseLock: releaseLock,
    getLastCheckpointTime: getLastCheckpointTime,
    initCheckpointIfMissing: initCheckpointIfMissing,
    resetCheckpointToNow: resetCheckpointToNow,
    hasRunToday: hasRunToday,
    recordSuccessfulRun: recordSuccessfulRun
  };
})();
