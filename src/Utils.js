/**
 * Google CC Briefing Agent
 * Utils.js — Boîte à outils transverse : budget temps d'exécution, décodage HTML unifié,
 * nettoyage de texte, requêtes HTTP résilientes, dates et URLs.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const Utils = (() => {
  /**
   * Horodatage de début de l'exécution courante.
   * Apps Script recharge tous les fichiers à chaque exécution : cette valeur correspond donc
   * au démarrage réel du déclencheur ou de la fonction manuelle.
   * @type {number}
   */
  const EXECUTION_START_MS = Date.now();

  // ---------------------------------------------------------------------------
  // 1. Budget temps (garde-fou anti-timeout 6 minutes)
  // ---------------------------------------------------------------------------

  /** @returns {number} Millisecondes écoulées depuis le début de l'exécution. */
  const elapsedMs = () => Date.now() - EXECUTION_START_MS;

  /** @returns {number} Millisecondes restantes avant la fin du budget global. */
  const remainingMs = () => Config.DEFAULTS.EXECUTION_BUDGET_MS - elapsedMs();

  /**
   * Indique s'il reste au moins `ms` millisecondes de budget.
   * @param {number} ms - Durée requise.
   * @returns {boolean}
   */
  const hasTimeFor = (ms) => remainingMs() >= ms;

  // ---------------------------------------------------------------------------
  // 2. Décodage HTML / XML unifié
  // ---------------------------------------------------------------------------

  /**
   * Table unique des entités nommées (HTML de base + typographie + lettres accentuées françaises).
   * @type {Readonly<Object<string, string>>}
   */
  const NAMED_ENTITIES = Object.freeze({
    quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ',
    euro: '€', copy: '©', reg: '®', trade: '™', deg: '°', percnt: '%',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
    sbquo: '‚', bdquo: '„', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
    eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
    agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä',
    icirc: 'î', iuml: 'ï', iacute: 'í',
    ocirc: 'ô', ouml: 'ö', oacute: 'ó',
    ucirc: 'û', ugrave: 'ù', uuml: 'ü', uacute: 'ú',
    ccedil: 'ç', yuml: 'ÿ', ntilde: 'ñ', oelig: 'œ', aelig: 'æ', szlig: 'ß',
    Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Euml: 'Ë',
    Agrave: 'À', Acirc: 'Â', Auml: 'Ä',
    Icirc: 'Î', Iuml: 'Ï', Ocirc: 'Ô', Ouml: 'Ö',
    Ucirc: 'Û', Ugrave: 'Ù', Uuml: 'Ü',
    Ccedil: 'Ç', OElig: 'Œ', AElig: 'Æ'
  });

  /**
   * Convertit un point de code en caractère sans jamais lever d'exception.
   * @param {number} code - Point de code Unicode.
   * @returns {string}
   */
  const safeFromCodePoint = (code) => {
    try {
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    } catch {
      return '';
    }
  };

  /**
   * Décode toutes les entités HTML/XML (nommées, décimales, hexadécimales), y compris
   * les entités doublement encodées (ex. `&amp;#039;` -> `'`, `&amp;eacute;` -> `é`).
   * Décodeur unique du projet (utilisé par NewsService, GmailService et le nettoyeur de texte).
   *
   * @param {string} str - Texte potentiellement encodé.
   * @returns {string} Texte décodé.
   */
  const decodeHtmlEntities = (str) => {
    if (!str) return '';
    let text = String(str);
    for (let pass = 0; pass < 4 && text.includes('&'); pass++) {
      const before = text;
      text = text
        .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
        .replace(/&#([0-9]{1,7});/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-zA-Z][a-zA-Z0-9]{1,8});/g, (match, name) => {
          if (NAMED_ENTITIES[name] !== undefined) return NAMED_ENTITIES[name];
          const lower = name.toLowerCase();
          return NAMED_ENTITIES[lower] !== undefined ? NAMED_ENTITIES[lower] : match;
        });
      if (text === before) break;
    }
    return text;
  };

  /**
   * Nettoie un fragment XML/HTML : CDATA, entités, balises et espaces superflus.
   * @param {string} str - Fragment brut.
   * @returns {string} Texte brut sur une ligne.
   */
  const stripMarkup = (str) => {
    if (!str) return '';
    return decodeHtmlEntities(String(str).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Échappe les caractères HTML sensibles.
   * @param {string} str - Texte brut.
   * @returns {string} Texte sûr pour l'insertion HTML.
   */
  const escapeHtml = (str) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // ---------------------------------------------------------------------------
  // 3. Nettoyage de texte
  // ---------------------------------------------------------------------------

  /**
   * Nettoyeur universel :
   * - décode les entités HTML et supprime les caractères de remplacement Unicode ;
   * - supprime tous les emojis et pictogrammes (règle Zéro Emoji) ;
   * - normalise (m/w/d) en (H/F), retire les délimiteurs LaTeX et balises résiduelles ;
   * - harmonise l'apostrophe typographique et les espaces.
   *
   * @param {string} str - Texte brut.
   * @returns {string} Texte propre.
   */
  const sanitizeText = (str) => {
    if (!str) return '';
    let text = decodeHtmlEntities(String(str));

    // 1. Surrogates isolés et caractères de remplacement
    text = text.replace(/[\uD800-\uDFFF�￾￿]/g, '');
    if (typeof text.toWellFormed === 'function') {
      text = text.toWellFormed();
    }

    // 2. Emojis, pictogrammes, sélecteurs de variante, keycaps (\p{Emoji_Component} évité : il inclut 0-9)
    text = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}⃣︀-️‍]/gu, '');

    // 3. Caractères de contrôle non imprimables
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

    // 4. Mentions de genre : (m/w/d) -> (H/F)
    text = text.replace(/\(?\$?\(?\s*m\s*\/\s*w\s*\/\s*d\s*\)?\$?\)?/gi, '(H/F)');
    text = text.replace(/\(\s*h\s*\/\s*f\s*\)/gi, '(H/F)');

    // 5. Délimiteurs LaTeX ($...$, \(...\), \[...\])
    text = text.replace(/\$([^$\n]+)\$/g, '$1');
    text = text.replace(/\\\(([^)]+)\\\)/g, '$1');
    text = text.replace(/\\\[([^\]]+)\\\]/g, '$1');
    text = text.replace(/\\/g, '');

    // 6. Balises HTML résiduelles
    text = text.replace(/<\/?[a-z][a-z0-9]*(?:\s+[^>]*?)?\/?>/gi, ' ');

    // 7. Typographie française et résidus d'entités non résolues
    text = text.replace(/'/g, '’');
    text = text.replace(/&[a-zA-Z0-9#]+;/g, '');

    // 8. Compaction des espaces
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n+/g, '\n');

    return text.trim();
  };

  /**
   * Rend un résumé IA sûr pour l'e-mail HTML : nettoyage, échappement, puis **gras** -> <strong>.
   * @param {string} str - Résumé avec éventuel Markdown gras.
   * @returns {string} HTML sûr.
   */
  const formatSummaryHtml = (str) => {
    if (!str) return '';
    return escapeHtml(sanitizeText(str)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  };

  /**
   * Retire le Markdown gras pour la version texte brut.
   * @param {string} str - Texte avec éventuel **gras**.
   * @returns {string}
   */
  const stripMarkdown = (str) => String(str || '').replace(/\*\*([^*]+)\*\*/g, '$1');

  /**
   * Normalise un objet d'e-mail pour la déduplication (préfixes Re/Fwd, ponctuation).
   * @param {string} subject - Objet brut.
   * @returns {string}
   */
  const normalizeSubject = (subject) => {
    if (!subject) return '';
    let clean = sanitizeText(subject).toLowerCase();
    clean = clean.replace(/^(?:(?:re|fwd|fw|tr|copie|rappel|urgent)\s*:\s*)+/gi, '');
    clean = clean.replace(/[^a-z0-9à-ÿœæ\s]/gi, ' ');
    return clean.replace(/\s+/g, ' ').trim();
  };

  /**
   * Teste la présence d'au moins un mot-clé en respectant les limites de mots (accents compris).
   * Évite les faux positifs du type « formation » dans « information » ou « api » dans « rapide ».
   *
   * @param {string} text - Texte à analyser.
   * @param {Array<string>} keywords - Mots ou expressions recherchés.
   * @returns {boolean}
   */
  const containsKeyword = (text, keywords) => {
    if (!text || !keywords || keywords.length === 0) return false;
    const pattern = keywords
      .map((k) => String(k).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter(Boolean)
      .join('|');
    if (!pattern) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu').test(text);
  };

  /**
   * Nom d'expéditeur lisible à partir de l'en-tête From.
   * @param {string} fromStr - Ex. "Google Cloud <no-reply@...>".
   * @returns {string}
   */
  const cleanSenderName = (fromStr) => {
    if (!fromStr) return 'Expéditeur';
    const decoded = sanitizeText(fromStr);
    const lower = decoded.toLowerCase();

    const BRANDS = [
      [['github'], 'GitHub'],
      [['linkedin'], 'LinkedIn'],
      [['michael page', 'michaelpage'], 'Michael Page'],
      [['meteojob'], 'Meteojob'],
      [['hellowork'], 'HelloWork'],
      [['francetravail', 'france travail', 'pole-emploi'], 'France Travail'],
      [['easyjet'], 'easyJet'],
      [['getyourguide'], 'GetYourGuide'],
      [['doctolib'], 'Doctolib'],
      [['qare'], 'Qare'],
      [['lumosity'], 'Lumosity'],
      [['twistshake'], 'Twistshake'],
      [['asos'], 'ASOS'],
      [['tiktok'], 'TikTok'],
      [['facebook'], 'Facebook'],
      [['instagram'], 'Instagram'],
      [['qonto'], 'Qonto'],
      [['american express', 'amex'], 'American Express']
    ];
    for (const [keys, label] of BRANDS) {
      if (keys.some((k) => lower.includes(k))) return label;
    }

    // "Prénom Nom <email@...>" -> "Prénom Nom"
    const match = decoded.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
    if (match && match[1].trim() && !match[1].includes('@')) {
      return match[1].trim();
    }

    // Repli domaine : "contact@aprizo.com" -> "Aprizo"
    const domainMatch = decoded.match(/@([a-zA-Z0-9-]+)\.[a-zA-Z]{2,}/);
    if (domainMatch && domainMatch[1]) {
      return domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
    }
    return decoded;
  };

  /**
   * Domaine de l'expéditeur (ex. "linkedin.com").
   * @param {string} fromStr - En-tête From brut.
   * @returns {string}
   */
  const extractSenderDomain = (fromStr) => {
    if (!fromStr) return '';
    const match = String(fromStr).match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : cleanSenderName(fromStr).toLowerCase();
  };

  /**
   * Retire citations, transferts et pieds de page marketing d'un corps d'e-mail.
   * @param {string} rawBody - Corps texte.
   * @param {string} rawHtml - Corps HTML (repli).
   * @returns {string} Extrait propre (tronqué à MAX_BODY_CHARS).
   */
  const cleanEmailBody = (rawBody, rawHtml) => {
    let text = rawBody || rawHtml || '';
    if (!text) return '';

    text = sanitizeText(text);
    text = text.replace(/(On\s.+?wrote:|Le\s.+?a écrit\s?:)[\s\S]*$/i, '');
    text = text.replace(/^\s*>+.*$/gm, '');

    const boilerplate = [
      /Cet e-mail a été envoyé à[\s\S]*$/i,
      /This email was sent to[\s\S]*$/i,
      /Pour vous désinscrire[\s\S]*$/i,
      /To unsubscribe[\s\S]*$/i,
      /Cliquez ici pour vous désabonner[\s\S]*$/i,
      /(?:View in browser|Afficher dans le navigateur)[\s\S]*$/i,
      /--\s*\n[\s\S]*$/i
    ];
    for (const pattern of boilerplate) {
      text = text.replace(pattern, '');
    }

    text = sanitizeText(text);
    const max = Config.DEFAULTS.MAX_BODY_CHARS;
    return text.length > max ? `${text.substring(0, max)}...` : text;
  };

  // ---------------------------------------------------------------------------
  // 4. Extraction d'échéance (mode de repli sans IA)
  // ---------------------------------------------------------------------------

  const FRENCH_MONTHS = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
  ];

  /**
   * Détecte une échéance explicite (date + heure éventuelle) dans un texte français.
   * Exemples reconnus : "12/11", "12/11/2026", "le 3 décembre", "1er mars à 9h30".
   *
   * @param {string} text - Objet et/ou début du corps de l'e-mail.
   * @returns {string|null} Échéance formatée ("12/11 à 09h30") ou null.
   */
  const extractDeadline = (text) => {
    if (!text) return null;
    const src = String(text);
    let day = null;
    let month = null;

    const numeric = src.match(/(?<![\d/])(\d{1,2})[/.](\d{1,2})(?:[/.](?:\d{4}|\d{2}))?(?![\d/])/);
    if (numeric) {
      const d = parseInt(numeric[1], 10);
      const m = parseInt(numeric[2], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        day = d;
        month = m;
      }
    }

    if (day === null) {
      const monthsPattern = 'janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre';
      const literal = src.match(new RegExp(`(?<![\\p{L}\\p{N}])(1er|\\d{1,2})\\s+(${monthsPattern})(?![\\p{L}])`, 'iu'));
      if (literal) {
        const d = literal[1].toLowerCase() === '1er' ? 1 : parseInt(literal[1], 10);
        const monthName = literal[2].toLowerCase().replace('fevrier', 'février').replace('aout', 'août').replace('decembre', 'décembre');
        const m = FRENCH_MONTHS.indexOf(monthName) + 1;
        if (d >= 1 && d <= 31 && m >= 1) {
          day = d;
          month = m;
        }
      }
    }

    if (day === null) return null;

    const pad = (n) => String(n).padStart(2, '0');
    let result = `${pad(day)}/${pad(month)}`;
    const time = src.match(/(?<![\d])([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?(?![\d])/i);
    if (time) {
      result += ` à ${pad(parseInt(time[1], 10))}h${time[2] || '00'}`;
    }
    return result;
  };

  // ---------------------------------------------------------------------------
  // 5. Requêtes HTTP résilientes
  // ---------------------------------------------------------------------------

  /**
   * Exécute des requêtes HTTP en parallèle, par sous-lots, sans jamais compromettre l'exécution :
   * - découpage en sous-lots de FETCH_LOT_SIZE requêtes (UrlFetchApp.fetchAll) ;
   * - si un sous-lot échoue à cause d'une seule URL (ex. "Adresse non disponible"), il est
   *   scindé en deux récursivement (dichotomie) pour isoler l'URL fautive tout en restant parallèle ;
   * - garde-fou temporel strict : au-delà du budget du lot ou du budget global, les requêtes
   *   restantes sont ignorées (réponse null) au lieu de bloquer le script.
   *
   * @param {Array<Object>} requests - Objets requête UrlFetchApp ({ url, ...options }).
   * @param {Object} [options]
   * @param {number} [options.budgetMs] - Budget maximal de cet appel.
   * @param {number} [options.reserveMs] - Temps global à préserver pour la suite de l'exécution.
   * @returns {Array<GoogleAppsScript.URL_Fetch.HTTPResponse|null>} Réponses alignées sur les requêtes.
   */
  const fetchUrlsSafely = (requests, options = {}) => {
    const list = Array.isArray(requests) ? requests : [];
    const results = list.map(() => null);
    if (list.length === 0) return results;

    const lotSize = options.lotSize || Config.DEFAULTS.FETCH_LOT_SIZE;
    const budgetMs = options.budgetMs || Config.DEFAULTS.FETCH_LOT_BUDGET_MS;
    const reserveMs = options.reserveMs !== undefined ? options.reserveMs : Config.DEFAULTS.SEND_RESERVE_MS;
    const deadline = Date.now() + Math.max(0, Math.min(budgetMs, remainingMs() - reserveMs));

    const normalized = list.map((req) => Object.assign({ muteHttpExceptions: true }, req));
    let skipped = 0;

    const runIndices = (indices) => {
      if (indices.length === 0) return;
      if (Date.now() >= deadline) {
        skipped += indices.length;
        return;
      }
      try {
        let responses;
        if (indices.length === 1) {
          const { url, ...opts } = normalized[indices[0]];
          responses = [UrlFetchApp.fetch(url, opts)];
        } else {
          responses = UrlFetchApp.fetchAll(indices.map((i) => normalized[i]));
        }
        indices.forEach((idx, k) => {
          results[idx] = responses[k] || null;
        });
      } catch (err) {
        if (indices.length === 1) {
          const host = (String(normalized[indices[0]].url).match(/^https?:\/\/([^/?#]+)/) || [])[1] || 'inconnu';
          console.warn(`fetchUrlsSafely : URL ignorée (${host}) — ${err.message}`);
          return;
        }
        const mid = Math.ceil(indices.length / 2);
        runIndices(indices.slice(0, mid));
        runIndices(indices.slice(mid));
      }
    };

    for (let start = 0; start < normalized.length; start += lotSize) {
      const indices = [];
      for (let i = start; i < Math.min(start + lotSize, normalized.length); i++) indices.push(i);
      runIndices(indices);
    }

    if (skipped > 0) {
      console.warn(`fetchUrlsSafely : ${skipped} requête(s) ignorée(s) pour respecter le budget temps.`);
    }
    return results;
  };

  /**
   * Retourne le contenu texte d'une réponse HTTP 200, sinon une chaîne vide.
   * @param {GoogleAppsScript.URL_Fetch.HTTPResponse|null} response
   * @returns {string}
   */
  const okText = (response) => {
    try {
      return response && response.getResponseCode() === 200 ? response.getContentText() : '';
    } catch {
      return '';
    }
  };

  // ---------------------------------------------------------------------------
  // 6. URLs, dates et formules de politesse
  // ---------------------------------------------------------------------------

  /**
   * URL directe d'un fil Gmail (bureau et mobile).
   * @param {string} threadId - Identifiant du fil.
   * @returns {string}
   */
  const buildGmailUrl = (threadId) => {
    if (!threadId) return 'https://mail.google.com/mail/u/0/#inbox';
    return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(String(threadId).trim())}`;
  };

  /**
   * URL de la vue « jour » de Google Calendar (évite les erreurs HTTP 500 des identifiants bruts).
   * @param {Date} date - Date de l'événement.
   * @returns {string}
   */
  const buildCalendarUrl = (date) => {
    const tz = Config.DEFAULTS.TIMEZONE;
    const d = date instanceof Date ? date : new Date();
    return `https://calendar.google.com/calendar/u/0/r/day/${Utilities.formatDate(d, tz, 'yyyy/MM/dd')}`;
  };

  /**
   * Date française élégante (ex. "Samedi 14 novembre 2026").
   * @param {Date} date
   * @returns {string}
   */
  const formatDateFrench = (date) => {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    try {
      const formatted = date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: Config.DEFAULTS.TIMEZONE
      });
      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    } catch {
      return Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy');
    }
  };

  /**
   * Heure HH:mm (Europe/Paris).
   * @param {Date} date
   * @returns {string}
   */
  const formatTime = (date) => (date ? Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'HH:mm') : '');

  /** @returns {number} Heure courante (0-23) à Paris. */
  const currentHour = (date = new Date()) =>
    parseInt(Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'HH'), 10);

  /**
   * Salutation selon le moment de la journée.
   * @param {Date} [date]
   * @param {string} [name]
   * @returns {string}
   */
  const getTemporalGreeting = (date = new Date(), name = Config.DEFAULTS.RECIPIENT_NAME) => {
    const hour = currentHour(date);
    if (hour < 12) return `Bonjour ${name}, voici votre synthèse matinale !`;
    if (hour < 18) return `Bonjour ${name}, voici votre point de situation !`;
    return `Bonsoir ${name}, voici votre synthèse de la journée !`;
  };

  /**
   * Formule de fin selon le moment de la journée.
   * @param {Date} [date]
   * @returns {string}
   */
  const getTemporalSignoff = (date = new Date()) =>
    currentHour(date) >= 18 ? 'Passez une excellente soirée !' : 'Passez une excellente journée !';

  /**
   * Durée lisible (75 -> "1 h 15").
   * @param {number} minutes
   * @returns {string}
   */
  const formatDuration = (minutes) => {
    if (!minutes || isNaN(minutes) || minutes <= 0) return '';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} h ${String(mins).padStart(2, '0')}` : `${hours} h`;
  };

  /**
   * Préposition « de » avec élision devant voyelle ou h muet (ex. "d’Annemasse", "de Lyon").
   * @param {string} word
   * @returns {string}
   */
  const withDe = (word) => (/^[aeiouyhàâéèêëîïôöûüœAEIOUYHÀÂÉÈÊËÎÏÔÖÛÜŒ]/.test(String(word || '')) ? `d’${word}` : `de ${word}`);

  /**
   * Masque les secrets dans les journaux.
   * @param {string} str
   * @returns {string}
   */
  const redactSensitive = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/key=[a-zA-Z0-9._-]+/gi, 'key=[MASQUÉ]')
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [MASQUÉ]')
      .replace(/AIza[0-9A-Za-z_-]{35}/g, '[MASQUÉ]')
      .replace(/AQ\.[a-zA-Z0-9._-]+/g, '[MASQUÉ]');
  };

  return {
    elapsedMs,
    remainingMs,
    hasTimeFor,
    decodeHtmlEntities,
    stripMarkup,
    escapeHtml,
    sanitizeText,
    formatSummaryHtml,
    stripMarkdown,
    normalizeSubject,
    containsKeyword,
    cleanSenderName,
    extractSenderDomain,
    cleanEmailBody,
    extractDeadline,
    fetchUrlsSafely,
    okText,
    buildGmailUrl,
    buildCalendarUrl,
    formatDateFrench,
    formatTime,
    getTemporalGreeting,
    getTemporalSignoff,
    formatDuration,
    withDe,
    redactSensitive
  };
})();
