/**
 * Google CC Briefing Agent
 * Config.js — Configuration centralisée : constantes, taxonomies canoniques, budgets temps
 * et accès aux Script Properties.
 *
 * IMPORTANT : aucun secret ne doit être écrit dans ce fichier (dépôt GitHub public).
 * La clé Gemini est lue exclusivement depuis les Script Properties (GEMINI_API_KEY).
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const Config = (() => {
  /**
   * Clés persistées dans PropertiesService (Script Properties).
   * @enum {string}
   */
  const SCRIPT_PROP_KEYS = Object.freeze({
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    BRIEFING_RECIPIENT_EMAIL: 'BRIEFING_RECIPIENT_EMAIL',
    WEEKEND_ENABLED: 'WEEKEND_ENABLED',
    TEST_LOOKBACK_HOURS: 'TEST_LOOKBACK_HOURS',
    GEMINI_MODEL: 'GEMINI_MODEL',
    LAST_CHECKPOINT_TIME: 'LAST_CHECKPOINT_TIME',
    LAST_BRIEFING_RUN_TIME: 'LAST_BRIEFING_RUN_TIME'
  });

  /**
   * Paramètres opérationnels par défaut.
   * @type {Readonly<Object>}
   */
  const DEFAULTS = Object.freeze({
    TIMEZONE: 'Europe/Paris',
    RECIPIENT_NAME: 'Kouroufia',
    BRIEFING_RECIPIENT_EMAIL: 'kouroufia15@gmail.com',
    WEEKEND_ENABLED: true,
    TEST_LOOKBACK_HOURS: 24,
    TRIGGER_HOUR: 6,
    TRIGGER_MINUTE: 0,
    WATCHDOG_HOUR: 7,

    // Gemini
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
    MAX_MODELS_PER_CALL: 4,
    MAX_OUTPUT_TOKENS: 4096,
    TEMPERATURE: 0.2,
    BATCH_SIZE: 12,

    // Gmail
    MAX_THREADS: 50,
    MAX_BODY_CHARS: 1000,
    MAX_SNIPPET_CHARS: 900,

    // Budget temps global (limite stricte Apps Script = 6 min)
    EXECUTION_BUDGET_MS: 300000, // 5 min : marge de 60 s avant la coupure Google
    EMAIL_ANALYSIS_MAX_MS: 140000, // Plafond absolu pour l'analyse IA des e-mails
    RESERVE_AFTER_EMAILS_MS: 120000, // Temps conservé pour météo + actualités + envoi
    SEND_RESERVE_MS: 25000, // Temps toujours conservé pour le rendu et l'envoi final
    FETCH_LOT_SIZE: 10, // Requêtes HTTP parallèles par sous-lot
    FETCH_LOT_BUDGET_MS: 25000, // Budget max par appel à fetchUrlsSafely

    // Verrou & divers
    LOCK_TIMEOUT_MS: 30000,
    MAX_LOOKBACK_HOURS: 48,
    MAX_TOMORROW_EVENTS: 5,

    // Sections optionnelles
    WEATHER_BASE_LOCATION: 'Annemasse',
    WEATHER_ENABLED: true,
    NEWS_ENABLED: true
  });

  /**
   * Cascade officielle de modèles Gemini (ordre de priorité).
   * @type {ReadonlyArray<string>}
   */
  const GEMINI_MODEL_CASCADE = Object.freeze([
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3.8-flash'
  ]);

  /**
   * Motifs de modèles obsolètes : si GEMINI_MODEL en contient un, il est migré vers le modèle par défaut.
   * @type {ReadonlyArray<string>}
   */
  const DEPRECATED_MODEL_PATTERNS = Object.freeze(['1.5', '2.0', '2.5', '3.6', '3.7', '3.8', 'latest']);

  /**
   * Sources officielles des Actus du Jour (HugoDécrypte).
   * @type {Readonly<Object>}
   */
  const NEWS_SOURCES = Object.freeze({
    HUGO_CHANNEL_ID: 'UCAcAnMF0OrCtUep3Y4M-ZPw',
    HUGO_CHANNEL_VIDEOS_URL: 'https://www.youtube.com/@hugodecrypteactus/videos',
    HUGO_YOUTUBE_FEED: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCAcAnMF0OrCtUep3Y4M-ZPw',
    HUGO_ACAST_FEED: 'https://feeds.acast.com/public/shows/61365f9fb4ac8f42e6668a5c'
  });

  /**
   * Libellés canoniques des catégories d'e-mails.
   * @enum {string}
   */
  const EMAIL_CATEGORY = Object.freeze({
    JOBS: 'Emploi & Carrière',
    ADMIN: 'Démarches & Administration',
    BANK: 'Banque & Finances',
    HEALTH: 'Santé & Soins',
    ORDERS: 'Commandes & Livraisons',
    SECURITY: 'Sécurité & Accès',
    TECH: 'Tech & Outils Numériques',
    TRAVEL: 'Voyages & Loisirs',
    SHOPPING: 'Achats & Offres',
    SOCIAL: 'Réseaux Sociaux',
    NEWS: 'Actualités & Newsletters'
  });

  /**
   * Taxonomie canonique et ordonnée des e-mails (ordre d'affichage + schéma JSON Gemini).
   * Source unique de vérité partagée par GeminiService, EmailClassifier et BriefingService.
   * @type {ReadonlyArray<{name: string, hint: string}>}
   */
  const EMAIL_CATEGORIES = Object.freeze([
    { name: EMAIL_CATEGORY.JOBS, hint: "Offres d'emploi, candidatures, cabinets de recrutement (Michael Page, Meteojob, HelloWork, Apec, Indeed, offres LinkedIn)" },
    { name: EMAIL_CATEGORY.ADMIN, hint: 'Services publics, aides, impôts, formations officielles (France Travail, CAF, Ameli, impots.gouv)' },
    { name: EMAIL_CATEGORY.BANK, hint: 'Revolut, Société Générale, PayPal, Qonto, virements, relevés bancaires' },
    { name: EMAIL_CATEGORY.HEALTH, hint: 'Consultations, médecins, ordonnances, praticiens (Doctolib, Qare)' },
    { name: EMAIL_CATEGORY.ORDERS, hint: 'Chronopost, Colissimo, Amazon, UPS, suivi de colis, commandes en cours' },
    { name: EMAIL_CATEGORY.SECURITY, hint: 'Codes de vérification, connexions suspectes, alertes de compte Google ou Microsoft' },
    { name: EMAIL_CATEGORY.TECH, hint: 'GitHub, Firebase, Google Cloud, HeyGen, Lumosity, outils logiciels' },
    { name: EMAIL_CATEGORY.TRAVEL, hint: "Billets d'avion, réservations, vacances (easyJet, GetYourGuide, SNCF, American Express)" },
    { name: EMAIL_CATEGORY.SHOPPING, hint: 'Soldes, remises, réductions e-commerce (ASOS, Twistshake)' },
    { name: EMAIL_CATEGORY.SOCIAL, hint: 'Facebook, Instagram, TikTok, LinkedIn (invitations, messages, notifications réseau)' },
    { name: EMAIL_CATEGORY.NEWS, hint: 'Articles de presse, Dribbble, newsletters générales, articles partagés sur LinkedIn' }
  ]);

  /**
   * Anciens libellés encore susceptibles d'apparaître (historique, prompts antérieurs).
   * @type {Readonly<Object<string, string>>}
   */
  const LEGACY_EMAIL_CATEGORY_ALIASES = Object.freeze({
    'réseaux sociaux & culture': EMAIL_CATEGORY.SOCIAL,
    'actualités & veille': EMAIL_CATEGORY.NEWS,
    'tech & projets': EMAIL_CATEGORY.TECH
  });

  /**
   * 9 rubriques PESTEL+ normalisées du Complément Google Actualités (ordre imposé par AGENTS.md).
   * `keywords` sert à rattacher un libellé abrégé renvoyé par l'IA à sa rubrique officielle.
   * @type {ReadonlyArray<{id: string, name: string, keywords: Array<string>}>}
   */
  const NEWS_CATEGORIES = Object.freeze([
    { id: 'P_POLITIQUE', name: 'P — Politique & Géopolitique', keywords: ['politique', 'géopolitique', 'geopolitique'] },
    { id: 'E_ECONOMIE', name: 'E — Économie, Finance & Entreprises', keywords: ['économie', 'economie', 'finance', 'entreprise'] },
    { id: 'S_SOCIAL', name: 'S — Social & Sociétal', keywords: ['social', 'sociétal', 'societal'] },
    { id: 'T_TECH', name: 'T — Technologie, IA & Innovation', keywords: ['technologie', 'tech', 'innovation'] },
    { id: 'E_ENVIRONNEMENT', name: 'E — Environnement & Écologie', keywords: ['environnement', 'écologie', 'ecologie', 'climat'] },
    { id: 'L_LEGAL', name: 'L — Légal : Justice, Lois & Procès', keywords: ['légal', 'legal', 'justice', 'procès', 'proces'] },
    { id: 'CULTURE_SAVOIR', name: 'Culture & Savoir (Cinéma, Livres, Histoire & Sciences)', keywords: ['culture', 'savoir', 'science', 'cinéma', 'histoire'] },
    { id: 'SPORT', name: 'Sport', keywords: ['sport'] },
    { id: 'FAITS_DIVERS', name: 'Faits divers (Délits, Crimes & Accidents marquants)', keywords: ['faits divers', 'fait divers', 'crime', 'délit', 'accident'] }
  ]);

  /**
   * Comptes de destination reconnus (détection de provenance des e-mails transférés).
   * @type {ReadonlyArray<Object>}
   */
  const KNOWN_ACCOUNTS = Object.freeze([
    {
      email: 'dramekouroufia.pro@gmail.com',
      label: 'Compte Pro',
      type: 'pro',
      badgeBg: '#F0FDFA',
      badgeColor: '#0F766E',
      badgeBorder: '#99F6E4'
    },
    {
      email: 'kouroufia15@gmail.com',
      label: 'Principal',
      type: 'main',
      badgeBg: '#EFF6FF',
      badgeColor: '#1D4ED8',
      badgeBorder: '#BFDBFE'
    },
    {
      email: 'dkouroufia27@outlook.fr',
      label: 'Ancien Perso',
      type: 'old_personal',
      badgeBg: '#F5F3FF',
      badgeColor: '#6D28D9',
      badgeBorder: '#DDD6FE'
    }
  ]);

  /**
   * Accès sécurisé à PropertiesService.getScriptProperties().
   * @returns {GoogleAppsScript.Properties.Properties|null}
   */
  const getProps = () => {
    try {
      return PropertiesService.getScriptProperties();
    } catch (error) {
      console.warn(`PropertiesService indisponible : ${error.message}`);
      return null;
    }
  };

  /**
   * Lit une Script Property avec valeur de repli.
   * @param {string} key - Clé.
   * @param {*} defaultValue - Valeur de repli si la propriété est absente ou vide.
   * @returns {*} Valeur stockée (string) ou defaultValue.
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
   * Écrit une Script Property.
   * @param {string} key - Clé.
   * @param {*} value - Valeur à persister.
   */
  const setScriptProperty = (key, value) => {
    const props = getProps();
    if (!props) return;
    try {
      props.setProperty(key, String(value));
    } catch (error) {
      console.error(`Impossible d'enregistrer la Script Property ${key} : ${error.message}`);
    }
  };

  /**
   * Retourne la clé API Gemini stockée dans les Script Properties.
   * @throws {Error} Si GEMINI_API_KEY n'est pas configurée.
   * @returns {string} Clé API.
   */
  const getGeminiApiKey = () => {
    const key = String(getScriptProperty(SCRIPT_PROP_KEYS.GEMINI_API_KEY, '') || '').trim();
    if (!key) {
      throw new Error(
        'GEMINI_API_KEY manquante : ajoutez-la dans Paramètres du projet > Propriétés du script.'
      );
    }
    return key;
  };

  /**
   * Indique si une clé Gemini est configurée (sans lever d'exception).
   * @returns {boolean}
   */
  const hasGeminiApiKey = () => {
    try {
      return getGeminiApiKey().length >= 10;
    } catch {
      return false;
    }
  };

  /**
   * Adresse de destination du briefing.
   * @returns {string}
   */
  const getRecipientEmail = () =>
    getScriptProperty(SCRIPT_PROP_KEYS.BRIEFING_RECIPIENT_EMAIL, DEFAULTS.BRIEFING_RECIPIENT_EMAIL);

  /**
   * Indique si le briefing doit aussi partir le week-end.
   * @returns {boolean}
   */
  const isWeekendEnabled = () =>
    String(getScriptProperty(SCRIPT_PROP_KEYS.WEEKEND_ENABLED, String(DEFAULTS.WEEKEND_ENABLED))) === 'true';

  /**
   * Fenêtre d'analyse (heures) pour les envois manuels.
   * @returns {number}
   */
  const getTestLookbackHours = () => {
    const num = parseInt(getScriptProperty(SCRIPT_PROP_KEYS.TEST_LOOKBACK_HOURS, ''), 10);
    return Number.isFinite(num) && num > 0 ? num : DEFAULTS.TEST_LOOKBACK_HOURS;
  };

  /**
   * Modèle Gemini principal, avec migration automatique des modèles obsolètes.
   * @returns {string}
   */
  const getGeminiModel = () => {
    const model = String(getScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, DEFAULTS.GEMINI_MODEL) || '').trim();
    const isDeprecated = !model || DEPRECATED_MODEL_PATTERNS.some((p) => model.includes(p));
    if (isDeprecated) {
      setScriptProperty(SCRIPT_PROP_KEYS.GEMINI_MODEL, DEFAULTS.GEMINI_MODEL);
      return DEFAULTS.GEMINI_MODEL;
    }
    return model;
  };

  /**
   * Ramène n'importe quel libellé de catégorie e-mail vers la taxonomie canonique.
   * @param {string} rawCategory - Libellé proposé (IA ou ancien libellé).
   * @returns {string} Libellé canonique (par défaut : Actualités & Newsletters).
   */
  const normalizeEmailCategory = (rawCategory) => {
    const lower = String(rawCategory || '').trim().toLowerCase();
    if (!lower) return EMAIL_CATEGORY.NEWS;
    const exact = EMAIL_CATEGORIES.find((c) => c.name.toLowerCase() === lower);
    if (exact) return exact.name;
    return LEGACY_EMAIL_CATEGORY_ALIASES[lower] || EMAIL_CATEGORY.NEWS;
  };

  /**
   * Rattache un libellé de rubrique d'actualité (éventuellement abrégé) à sa rubrique PESTEL+ officielle.
   * @param {string} rawName - Libellé renvoyé par l'IA.
   * @returns {string|null} Libellé officiel ou null.
   */
  const resolveNewsCategoryName = (rawName) => {
    const lower = String(rawName || '').trim().toLowerCase();
    if (!lower) return null;
    const exact = NEWS_CATEGORIES.find((c) => c.name.toLowerCase() === lower);
    if (exact) return exact.name;
    const byKeyword = NEWS_CATEGORIES.find((c) => c.keywords.some((k) => lower.includes(k)));
    return byKeyword ? byKeyword.name : null;
  };

  return {
    DEFAULTS,
    KEYS: SCRIPT_PROP_KEYS,
    GEMINI_MODEL_CASCADE,
    NEWS_SOURCES,
    EMAIL_CATEGORY,
    EMAIL_CATEGORIES,
    NEWS_CATEGORIES,
    KNOWN_ACCOUNTS,
    getScriptProperty,
    setScriptProperty,
    getGeminiApiKey,
    hasGeminiApiKey,
    getRecipientEmail,
    isWeekendEnabled,
    getTestLookbackHours,
    getGeminiModel,
    normalizeEmailCategory,
    resolveNewsCategoryName
  };
})();
