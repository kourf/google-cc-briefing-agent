/**
 * Google CC Briefing Agent
 * StateService.js — Verrou d'exécution, checkpoint horaire des e-mails et protection anti-double envoi.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const StateService = (() => {
  let activeLock = null;

  const props = () => PropertiesService.getScriptProperties();
  const nowSec = () => Math.floor(Date.now() / 1000);

  /**
   * Lit une propriété numérique (secondes UNIX).
   * @param {string} key
   * @returns {number|null}
   */
  const readTimestamp = (key) => {
    try {
      const parsed = parseInt(props().getProperty(key), 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
      console.warn(`Lecture impossible de ${key} : ${error.message}`);
      return null;
    }
  };

  /**
   * Acquiert le verrou exclusif du script (évite deux briefings simultanés).
   * @returns {boolean} true si le verrou est obtenu.
   */
  const acquireLock = () => {
    try {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(Config.DEFAULTS.LOCK_TIMEOUT_MS)) {
        console.warn('Verrou indisponible : une autre exécution est déjà en cours.');
        return false;
      }
      activeLock = lock;
      return true;
    } catch (error) {
      console.error(`Échec d'acquisition du verrou : ${error.message}`);
      return false;
    }
  };

  /** Libère le verrou s'il est détenu. */
  const releaseLock = () => {
    if (!activeLock) return;
    try {
      activeLock.releaseLock();
    } catch (error) {
      console.warn(`Libération du verrou : ${error.message}`);
    }
    activeLock = null;
  };

  /** @returns {number|null} Checkpoint courant (secondes UNIX). */
  const getLastCheckpointTime = () => readTimestamp(Config.KEYS.LAST_CHECKPOINT_TIME);

  /**
   * Fixe le checkpoint à une valeur donnée.
   * @param {number} timestampSec
   * @returns {number}
   */
  const resetCheckpointTo = (timestampSec) => {
    try {
      props().setProperty(Config.KEYS.LAST_CHECKPOINT_TIME, String(timestampSec));
    } catch (error) {
      console.warn(`Écriture du checkpoint impossible : ${error.message}`);
    }
    console.log(`Checkpoint défini à : ${new Date(timestampSec * 1000).toISOString()}`);
    return timestampSec;
  };

  /**
   * Retourne le checkpoint, en le (ré)initialisant sur les dernières 24 h s'il est absent
   * ou plus ancien que MAX_LOOKBACK_HOURS (évite d'analyser un historique massif).
   * @returns {number}
   */
  const initCheckpointIfMissing = () => {
    const current = getLastCheckpointTime();
    const now = nowSec();
    if (!current || now - current > Config.DEFAULTS.MAX_LOOKBACK_HOURS * 3600) {
      return resetCheckpointTo(now - 24 * 3600);
    }
    return current;
  };

  /**
   * Indique si un briefing de production a déjà été envoyé aujourd'hui (Europe/Paris).
   * @returns {boolean}
   */
  const hasRunToday = () => {
    const lastRunSec = readTimestamp(Config.KEYS.LAST_BRIEFING_RUN_TIME);
    if (!lastRunSec) return false;
    const tz = Config.DEFAULTS.TIMEZONE;
    return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') === Utilities.formatDate(new Date(lastRunSec * 1000), tz, 'yyyy-MM-dd');
  };

  /**
   * Enregistre un envoi réussi et avance le checkpoint.
   * @param {number} newCheckpointSec - Début de l'exécution réussie.
   */
  const recordSuccessfulRun = (newCheckpointSec) => {
    const now = nowSec();
    const checkpoint = newCheckpointSec || now;
    try {
      props().setProperties({
        [Config.KEYS.LAST_CHECKPOINT_TIME]: String(checkpoint),
        [Config.KEYS.LAST_BRIEFING_RUN_TIME]: String(now)
      });
    } catch (error) {
      console.warn(`Enregistrement de l'envoi impossible : ${error.message}`);
    }
    console.log(`Envoi enregistré. Checkpoint avancé à ${new Date(checkpoint * 1000).toISOString()}`);
  };

  return {
    acquireLock,
    releaseLock,
    getLastCheckpointTime,
    initCheckpointIfMissing,
    resetCheckpointTo,
    hasRunToday,
    recordSuccessfulRun
  };
})();
