/**
 * Google CC Briefing Agent
 * Config.js — Configuration centralisée & gestion des Script Properties
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
    GEMINI_MODEL: 'gemini-3.6-flash',
    GEMINI_FALLBACK_MODEL: 'gemini-3.7-flash',
    GEMINI_API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
    BATCH_SIZE: 6,
    MAX_RETRIES: 4,
    INITIAL_BACKOFF_MS: 1500,
    LOCK_TIMEOUT_MS: 30000,
    MAX_BODY_CHARS: 3500 // Longueur maximale par e-mail après nettoyage pour respecter les tokens
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
      type: 'legacy',
      badgeBg: '#FAF5FF',
      badgeColor: '#6B21A8',
      badgeBorder: '#E9D5FF',
      icon: '✉️'
    }
  ];

  function getProps() {
    return PropertiesService.getScriptProperties();
  }

  function getGeminiApiKey() {
    let key = getProps().getProperty(SCRIPT_PROP_KEYS.GEMINI_API_KEY);
    if (!key || key.trim() === '') {
      // Clé API dédiée fournie par l'utilisateur
      const initialKey = 'AQ.Ab8RN6I5W0UV9IYPwcO_fsKetGxHhskNP3sK1NiQusYxsJjJVA';
      try {
        getProps().setProperty(SCRIPT_PROP_KEYS.GEMINI_API_KEY, initialKey);
        console.log('Clé GEMINI_API_KEY enregistrée automatiquement dans ScriptProperties.');
      } catch (e) {
        console.warn('Impossible de sauvegarder dans ScriptProperties :', e.message);
      }
      return initialKey;
    }
    return key.trim();
  }

  function getRecipientEmail() {
    const custom = getProps().getProperty(SCRIPT_PROP_KEYS.BRIEFING_RECIPIENT_EMAIL);
    if (custom && custom.trim()) {
      return custom.trim();
    }
    return DEFAULTS.BRIEFING_RECIPIENT_EMAIL;
  }

  function isWeekendEnabled() {
    const val = getProps().getProperty(SCRIPT_PROP_KEYS.WEEKEND_ENABLED);
    if (val === null || val === undefined) {
      return DEFAULTS.WEEKEND_ENABLED;
    }
    return val.toLowerCase() === 'true';
  }

  function getTestLookbackHours() {
    const val = getProps().getProperty(SCRIPT_PROP_KEYS.TEST_LOOKBACK_HOURS);
    if (val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULTS.TEST_LOOKBACK_HOURS;
  }

  function getGeminiModel() {
    const val = getProps().getProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL);
    return val && val.trim() ? val.trim() : DEFAULTS.GEMINI_MODEL;
  }

  return {
    KEYS: SCRIPT_PROP_KEYS,
    DEFAULTS: DEFAULTS,
    KNOWN_ACCOUNTS: KNOWN_ACCOUNTS,
    getProps: getProps,
    getGeminiApiKey: getGeminiApiKey,
    getRecipientEmail: getRecipientEmail,
    isWeekendEnabled: isWeekendEnabled,
    getTestLookbackHours: getTestLookbackHours,
    getGeminiModel: getGeminiModel
  };
})();
