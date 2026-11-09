/**
 * Google CC Briefing Agent
 * StateService.js — Concurrency locking, timestamp checkpointing, and execution idempotence.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const StateService = (() => {
  let activeLock = null;

  /**
   * Acquires an exclusive script lock to prevent concurrent executions.
   * @returns {boolean} True if lock was acquired, false otherwise.
   */
  const acquireLock = () => {
    const lock = LockService.getScriptLock();
    try {
      const success = lock.tryLock(Config.DEFAULTS.LOCK_TIMEOUT_MS);
      if (!success) {
        console.warn('ScriptLock unavailable: another execution is already active.');
        return false;
      }
      activeLock = lock;
      return true;
    } catch (error) {
      console.error(`Lock acquisition failure: ${error.message}`);
      return false;
    }
  };

  /**
   * Releases the active script lock safely.
   */
  const releaseLock = () => {
    if (activeLock) {
      try {
        activeLock.releaseLock();
      } catch (error) {
        console.warn(`Lock release warning: ${error.message}`);
      }
      activeLock = null;
    }
  };

  /**
   * Retrieves the UNIX timestamp (in seconds) of the last successful briefing checkpoint.
   * @returns {number|null} Timestamp in seconds, or null if uninitialized.
   */
  const getLastCheckpointTime = () => {
    try {
      const val = PropertiesService.getScriptProperties().getProperty(Config.KEYS.LAST_CHECKPOINT_TIME);
      if (!val) return null;
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? null : parsed;
    } catch (error) {
      console.warn(`Unable to read LAST_CHECKPOINT_TIME: ${error.message}`);
      return null;
    }
  };

  /**
   * Initializes the checkpoint if missing or too old, preventing historical backlog timeout.
   * Clamps lookback to 24-48 hours maximum if the last run was weeks ago.
   * @returns {number} Active checkpoint timestamp in seconds.
   */
  const initCheckpointIfMissing = () => {
    const current = getLastCheckpointTime();
    const nowSec = Math.floor(Date.now() / 1000);
    const MAX_LOOKBACK_SEC = 48 * 3600; // 48h limit

    if (!current || (nowSec - current) > MAX_LOOKBACK_SEC) {
      const safeStartSec = nowSec - (24 * 3600); // 24h
      resetCheckpointTo(safeStartSec);
      console.log(`Checkpoint initialisé/recalibré sur 24h : ${new Date(safeStartSec * 1000).toISOString()}`);
      return safeStartSec;
    }
    return current;
  };

  /**
   * Explicitly sets the checkpoint timestamp to a specific value in seconds.
   * @param {number} timestampSec - UNIX timestamp in seconds.
   * @returns {number} Set timestamp in seconds.
   */
  const resetCheckpointTo = (timestampSec) => {
    try {
      PropertiesService.getScriptProperties().setProperty(
        Config.KEYS.LAST_CHECKPOINT_TIME,
        String(timestampSec)
      );
    } catch (error) {
      console.warn(`resetCheckpointTo error: ${error.message}`);
    }
    console.log(`Checkpoint défini à : ${new Date(timestampSec * 1000).toISOString()}`);
    return timestampSec;
  };

  /**
   * Explicitly resets the checkpoint timestamp to the current instant.
   * @returns {number} Reset timestamp in seconds.
   */
  const resetCheckpointToNow = () => {
    const nowSec = Math.floor(Date.now() / 1000);
    return resetCheckpointTo(nowSec);
  };

  /**
   * Verifies whether a production briefing has already run today (idempotence protection).
   * @returns {boolean} True if briefing already ran today.
   */
  const hasRunToday = () => {
    try {
      const lastRunVal = PropertiesService.getScriptProperties().getProperty(Config.KEYS.LAST_BRIEFING_RUN_TIME);
      if (!lastRunVal) return false;

      const lastRunSec = parseInt(lastRunVal, 10);
      if (isNaN(lastRunSec)) return false;

      const todayStr = Utilities.formatDate(new Date(), Config.DEFAULTS.TIMEZONE, 'yyyy-MM-dd');
      const lastRunDateStr = Utilities.formatDate(new Date(lastRunSec * 1000), Config.DEFAULTS.TIMEZONE, 'yyyy-MM-dd');

      return todayStr === lastRunDateStr;
    } catch {
      return false;
    }
  };

  /**
   * Records a successful briefing execution and advances the checkpoint.
   * @param {number} [newCheckpointSec] - Checkpoint timestamp to store.
   */
  const recordSuccessfulRun = (newCheckpointSec) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const targetCheckpoint = newCheckpointSec || nowSec;

    try {
      PropertiesService.getScriptProperties().setProperties({
        [Config.KEYS.LAST_CHECKPOINT_TIME]: String(targetCheckpoint),
        [Config.KEYS.LAST_BRIEFING_RUN_TIME]: String(nowSec)
      });
    } catch (error) {
      console.warn(`recordSuccessfulRun error: ${error.message}`);
    }

    console.log(`Run recorded. Advanced checkpoint to ${new Date(targetCheckpoint * 1000).toISOString()}`);
  };

  return {
    acquireLock,
    releaseLock,
    getLastCheckpointTime,
    initCheckpointIfMissing,
    resetCheckpointTo,
    resetCheckpointToNow,
    hasRunToday,
    recordSuccessfulRun
  };
})();
