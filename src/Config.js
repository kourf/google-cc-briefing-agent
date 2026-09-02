/**
 * Google CC Briefing Agent
 * Config.js — Centralized application configuration and Script Properties manager.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const Config = (() => {
  /**
   * Persistent Script Property keys stored in PropertiesService.
   * @enum {string}
   */
  const SCRIPT_PROP_KEYS = {
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    BRIEFING_RECIPIENT_EMAIL: 'BRIEFING_RECIPIENT_EMAIL',
    WEEKEND_ENABLED: 'WEEKEND_ENABLED',
    TEST_LOOKBACK_HOURS: 'TEST_LOOKBACK_HOURS',
    GEMINI_MODEL: 'GEMINI_MODEL',
    LAST_CHECKPOINT_TIME: 'LAST_CHECKPOINT_TIME',
    LAST_BRIEFING_RUN_TIME: 'LAST_BRIEFING_RUN_TIME'
  };

  /**
   * Default operational parameters.
   * @type {Readonly<Object>}
   */
  const DEFAULTS = Object.freeze({
    TIMEZONE: 'Europe/Paris',
    BRIEFING_RECIPIENT_EMAIL: 'kouroufia15@gmail.com',
    WEEKEND_ENABLED: true,
    TEST_LOOKBACK_HOURS: 24,
    TRIGGER_HOUR: 6,
    TRIGGER_MINUTE: 0,
    GEMINI_MODEL: 'gemini-2.0-flash',
    GEMINI_FALLBACK_MODEL: 'gemini-flash-lite-latest',
    GEMINI_API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
    BATCH_SIZE: 25,
    MAX_RETRIES: 4,
    INITIAL_BACKOFF_MS: 2000,
    MAX_OUTPUT_TOKENS: 2048,
    TEMPERATURE: 0.2,
    LOCK_TIMEOUT_MS: 30000,
    MAX_BODY_CHARS: 1200
  });

  /**
   * Recognised destination accounts for multi-account email tracking.
   * @type {ReadonlyArray<Object>}
   */
  const KNOWN_ACCOUNTS = Object.freeze([
    {
      email: 'dramekouroufia.pro@gmail.com',
      label: 'Compte Pro',
      type: 'pro',
      badgeBg: '#F0FDFA',
      badgeColor: '#0F766E',
      badgeBorder: '#99F6E4',
      icon: '🏢'
    },
    {
      email: 'kouroufia15@gmail.com',
      label: 'Principal',
      type: 'main',
      badgeBg: '#EFF6FF',
      badgeColor: '#1D4ED8',
      badgeBorder: '#BFDBFE',
      icon: '👤'
    },
    {
      email: 'dkouroufia27@outlook.fr',
      label: 'Ancien Perso',
      type: 'old_personal',
      badgeBg: '#F5F3FF',
      badgeColor: '#6D28D9',
      badgeBorder: '#DDD6FE',
      icon: '✉️'
    }
  ]);

  /**
   * Safely accesses PropertiesService.getScriptProperties().
   * @returns {GoogleAppsScript.Properties.Properties|null} The ScriptProperties instance or null.
   */
  const getProps = () => {
    try {
      return PropertiesService.getScriptProperties();
    } catch (error) {
      console.warn(`PropertiesService unavailable: ${error.message}`);
      return null;
    }
  };

  /**
   * Retrieves a property from Script Properties with fallback to a default value.
   * @param {string} key - Property key.
   * @param {*} defaultValue - Fallback value if property is unset.
   * @returns {*} Stored string value or defaultValue.
   */
  const getScriptProperty = (key, defaultValue) => {
    const props = getProps();
    if (props) {
      const val = props.getProperty(key);
      if (val !== null && val !== undefined && val !== '') {
        return val;
      }
    }
    return defaultValue;
  };

  /**
   * Sets a property in Script Properties.
   * @param {string} key - Property key.
   * @param {*} value - Value to persist.
   */
  const setScriptProperty = (key, value) => {
    const props = getProps();
    if (props) {
      try {
        props.setProperty(key, String(value));
      } catch (error) {
        console.error(`Unable to persist Script Property ${key}: ${error.message}`);
      }
    }
  };

  /**
   * Retrieves the Gemini API key from Script Properties.
   * @throws {Error} If GEMINI_API_KEY is not configured.
   * @returns {string} The valid API key.
   */
  const getGeminiApiKey = () => {
    const key = getScriptProperty(SCRIPT_PROP_KEYS.GEMINI_API_KEY, null);
    if (!key) {
      throw new Error(
        'Missing GEMINI_API_KEY. Please define it in Project Settings > Script Properties.'
      );
    }
    return key;
  };

  /**
   * Retrieves the recipient email address for daily briefings.
   * @returns {string} Recipient email address.
   */
  const getRecipientEmail = () => {
    return getScriptProperty(SCRIPT_PROP_KEYS.BRIEFING_RECIPIENT_EMAIL, DEFAULTS.BRIEFING_RECIPIENT_EMAIL);
  };

  /**
   * Indicates whether briefings should run on weekends.
   * @returns {boolean} True if weekend execution is enabled.
   */
  const isWeekendEnabled = () => {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.WEEKEND_ENABLED, String(DEFAULTS.WEEKEND_ENABLED));
    return val === 'true';
  };

  /**
   * Retrieves the lookback window in hours for manual/test runs.
   * @returns {number} Lookback hours (default: 24).
   */
  const getTestLookbackHours = () => {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.TEST_LOOKBACK_HOURS, String(DEFAULTS.TEST_LOOKBACK_HOURS));
    const num = parseInt(val, 10);
    return isNaN(num) ? DEFAULTS.TEST_LOOKBACK_HOURS : num;
  };

  /**
   * Retrieves the configured Gemini model identifier.
   * Automatically migrates deprecated models to the current standard.
   * @returns {string} Active model name.
   */
  const getGeminiModel = () => {
    let model = getScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, DEFAULTS.GEMINI_MODEL);
    if (!model || model === 'gemini-2.5-flash' || model.includes('3.6')) {
      model = DEFAULTS.GEMINI_MODEL;
      setScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, model);
    }
    return model;
  };

  /**
   * Updates the configured Gemini model identifier.
   * @param {string} model - New model name.
   */
  const setGeminiModel = (model) => {
    setScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, model);
  };

  /**
   * Retrieves the UNIX timestamp (in seconds) of the last successful briefing checkpoint.
   * @returns {number|null} Timestamp in seconds, or null if uninitialized.
   */
  const getLastCheckpointTime = () => {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.LAST_CHECKPOINT_TIME, null);
    return val ? parseInt(val, 10) : null;
  };

  /**
   * Sets the UNIX timestamp (in seconds) of the briefing checkpoint.
   * @param {number} timestampSec - Timestamp in seconds.
   */
  const setLastCheckpointTime = (timestampSec) => {
    setScriptProperty(SCRIPT_PROP_KEYS.LAST_CHECKPOINT_TIME, timestampSec);
  };

  /**
   * Retrieves the UNIX timestamp (in seconds) of the last briefing execution.
   * @returns {number|null} Timestamp in seconds, or null.
   */
  const getLastBriefingRunTime = () => {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.LAST_BRIEFING_RUN_TIME, null);
    return val ? parseInt(val, 10) : null;
  };

  /**
   * Sets the UNIX timestamp (in seconds) of the last briefing execution.
   * @param {number} timestampSec - Timestamp in seconds.
   */
  const setLastBriefingRunTime = (timestampSec) => {
    setScriptProperty(SCRIPT_PROP_KEYS.LAST_BRIEFING_RUN_TIME, timestampSec);
  };

  return {
    DEFAULTS,
    KNOWN_ACCOUNTS,
    KEYS: SCRIPT_PROP_KEYS,
    getProps,
    getScriptProperty,
    setScriptProperty,
    getGeminiApiKey,
    getRecipientEmail,
    isWeekendEnabled,
    getTestLookbackHours,
    getGeminiModel,
    setGeminiModel,
    getLastCheckpointTime,
    setLastCheckpointTime,
    getLastBriefingRunTime,
    setLastBriefingRunTime
  };
})();
