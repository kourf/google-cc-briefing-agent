/**
 * Google CC Briefing Agent
 * Config.js — Configuration centralisée, modèles Gemini fiables et gestion des Script Properties
 */

const Config = (function () {
  const SCRIPT_PROP_KEYS = {
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    BRIEFING_RECIPIENT_EMAIL: 'BRIEFING_RECIPIENT_EMAIL',
    WEEKEND_ENABLED: 'WEEKEND_ENABLED',
    TEST_LOOKBACK_HOURS: 'TEST_LOOKBACK_HOURS',
    GEMINI_MODEL: 'GEMINI_MODEL',
    LAST_CHECKPOINT_TIME: 'LAST_CHECKPOINT_TIME',
    LAST_BRIEFING_RUN_TIME: 'LAST_BRIEFING_RUN_TIME'
  };

  const DEFAULTS = {
    TIMEZONE: 'Europe/Paris',
    BRIEFING_RECIPIENT_EMAIL: 'kouroufia15@gmail.com',
    WEEKEND_ENABLED: true,
    TEST_LOOKBACK_HOURS: 24,
    // Modèle principal configuré sur gemini-2.5-flash
    GEMINI_MODEL: 'gemini-2.5-flash',
    // Modèle de repli haute disponibilité
    GEMINI_FALLBACK_MODEL: 'gemini-flash-lite-latest',
    GEMINI_API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
    // Traitement par lot unique jusqu'à 25 e-mails pour éliminer les erreurs de quota 429
    BATCH_SIZE: 25,
    MAX_RETRIES: 4,
    INITIAL_BACKOFF_MS: 2000,
    MAX_OUTPUT_TOKENS: 2048,
    TEMPERATURE: 0.2,
    LOCK_TIMEOUT_MS: 30000,
    MAX_BODY_CHARS: 1200
  };

  // Comptes connus pour le routage et l'étiquetage des messages transférés
  const KNOWN_ACCOUNTS = [
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
  ];

  function getScriptProperty(key, defaultValue) {
    try {
      const val = PropertiesService.getScriptProperties().getProperty(key);
      if (val !== null && val !== undefined && val !== '') {
        return val;
      }
    } catch (e) {
      console.warn('Impossible de lire la Script Property ' + key + ' : ' + e.message);
    }
    return defaultValue;
  }

  function setScriptProperty(key, value) {
    try {
      PropertiesService.getScriptProperties().setProperty(key, String(value));
    } catch (e) {
      console.error('Impossible d’écrire la Script Property ' + key + ' : ' + e.message);
    }
  }

  /**
   * Récupère la clé API Gemini depuis les Script Properties sécurisées.
   */
  function getGeminiApiKey() {
    const key = getScriptProperty(SCRIPT_PROP_KEYS.GEMINI_API_KEY, null);
    if (!key) {
      throw new Error(
        'La clé GEMINI_API_KEY est manquante dans les Paramètres du projet > Propriétés du script.'
      );
    }
    return key;
  }

  function getRecipientEmail() {
    return getScriptProperty(SCRIPT_PROP_KEYS.BRIEFING_RECIPIENT_EMAIL, DEFAULTS.BRIEFING_RECIPIENT_EMAIL);
  }

  function isWeekendEnabled() {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.WEEKEND_ENABLED, String(DEFAULTS.WEEKEND_ENABLED));
    return val === 'true';
  }

  function getTestLookbackHours() {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.TEST_LOOKBACK_HOURS, String(DEFAULTS.TEST_LOOKBACK_HOURS));
    const num = parseInt(val, 10);
    return isNaN(num) ? DEFAULTS.TEST_LOOKBACK_HOURS : num;
  }

  /**
   * Renvoie le modèle Gemini configuré.
   * Nettoie automatiquement les anciennes valeurs dépréciées (ex: gemini-2.0-flash) pour éviter les erreurs 404.
   */
  function getGeminiModel() {
    let model = getScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, DEFAULTS.GEMINI_MODEL);
    if (!model || model === 'gemini-2.0-flash' || model.indexOf('3.6') !== -1) {
      model = DEFAULTS.GEMINI_MODEL;
      setScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, model);
    }
    return model;
  }

  function setGeminiModel(model) {
    setScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, model);
  }

  function getLastCheckpointTime() {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.LAST_CHECKPOINT_TIME, null);
    return val ? parseInt(val, 10) : null;
  }

  function setLastCheckpointTime(timestampMs) {
    setScriptProperty(SCRIPT_PROP_KEYS.LAST_CHECKPOINT_TIME, timestampMs);
  }

  function getLastBriefingRunTime() {
    const val = getScriptProperty(SCRIPT_PROP_KEYS.LAST_BRIEFING_RUN_TIME, null);
    return val ? parseInt(val, 10) : null;
  }

  function setLastBriefingRunTime(timestampMs) {
    setScriptProperty(SCRIPT_PROP_KEYS.LAST_BRIEFING_RUN_TIME, timestampMs);
  }

  return {
    DEFAULTS: DEFAULTS,
    KNOWN_ACCOUNTS: KNOWN_ACCOUNTS,
    getGeminiApiKey: getGeminiApiKey,
    getRecipientEmail: getRecipientEmail,
    isWeekendEnabled: isWeekendEnabled,
    getTestLookbackHours: getTestLookbackHours,
    getGeminiModel: getGeminiModel,
    setGeminiModel: setGeminiModel,
    getLastCheckpointTime: getLastCheckpointTime,
    setLastCheckpointTime: setLastCheckpointTime,
    getLastBriefingRunTime: getLastBriefingRunTime,
    setLastBriefingRunTime: setLastBriefingRunTime
  };
})();
