/**
 * Google CC Briefing Agent
 * Utils.js — Utilitaires, assainissement strict Unicode/HTML/LaTeX, gestion temporelle et sécurité
 */

const Utils = (function () {
  /**
   * Décode exhaustivement toutes les entités HTML (nommées, décimales et hexadécimales).
   * Transforme &amp; en &, &#039; et &#39; en apostrophe, &quot; en ", etc.
   */
  function decodeHtmlEntities(str) {
    if (!str) return '';
    let text = String(str);

    // 1. Décodage hexadécimal (ex: &#x27; -> ')
    text = text.replace(/&#x([0-9a-f]{1,6});/gi, function (_, hex) {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (e) {
        return '';
      }
    });

    // 2. Décodage décimal (ex: &#39; -> ' et &#039; -> ')
    text = text.replace(/&#([0-9]{1,7});/g, function (_, dec) {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch (e) {
        return '';
      }
    });

    // 3. Entités nommées courantes
    const entityMap = {
      '&quot;': '"',
      '&apos;': "'",
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&nbsp;': ' ',
      '&euro;': '€',
      '&copy;': '©',
      '&reg;': '®',
      '&trade;': '™',
      '&laquo;': '«',
      '&raquo;': '»',
      '&ndash;': '–',
      '&mdash;': '—'
    };

    let previous;
    let iterations = 0;
    do {
      previous = text;
      text = text.replace(/&(?:quot|apos|amp|lt|gt|nbsp|euro|copy|reg|trade|laquo|raquo|ndash|mdash);/gi, function (match) {
        return entityMap[match.toLowerCase()] || match;
      });
      iterations++;
    } while (text !== previous && text.indexOf('&') !== -1 && iterations < 5);

    return text;
  }

  /**
   * Assainisseur universel de texte :
   * - Élimine définitivement les caractères de remplacement Unicode (\uFFFD, ) et caractères de contrôle
   * - Neutralise les délimiteurs mathématiques LaTeX ($...$) et remplace (m/w/d) par (H/F)
   * - Décode toutes les entités HTML (&amp;, &#039;, etc.)
   * - Supprime les balises HTML et normalise la typographie française (apostrophe ’)
   *
   * @param {string} str - Texte brut à assainir
   * @return {string} Texte propre, fluide et lisible
   */
  function sanitizeText(str) {
    if (!str) return '';
    let text = decodeHtmlEntities(String(str));

    // 1. Suppression des caractères de remplacement Unicode (\uFFFD, \uFFFE, \uFFFF, surrogates)
    text = text.replace(/[\uFFFD\uFFFE\uFFFF\uDB80-\uDBFF\uDC00-\uDFFF]/g, '');
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');

    // 2. Remplacement systématique des notations allemandes de genre et maths LaTeX : (m/w/d) -> (H/F)
    text = text.replace(/\(?\$?\(?\s*m\s*\/\s*w\s*\/\s*d\s*\)?\$?\)?/gi, '(H/F)');
    text = text.replace(/\(?\$?\(?\s*h\s*\/\s*f\s*\)?\$?\)?/gi, '(H/F)');

    // 3. Suppression des délimiteurs mathématiques LaTeX ($...$, \(...\))
    text = text.replace(/\$([^\$]+)\$/g, '$1');
    text = text.replace(/\\\(([^\)]+)\\\)/g, '$1');
    text = text.replace(/\\\[([^\]]+)\\\]/g, '$1');
    text = text.replace(/[\$\\]/g, '');

    // 4. Suppression des balises HTML (<...>)
    text = text.replace(/<\/?[a-z0-9]+(?:\s+[^>]*?)?\/?>/gi, ' ');

    // 5. Typographie française (apostrophe réelle)
    text = text.replace(/['’]/g, '’');

    // 6. Nettoyage des entités HTML résiduelles
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&[a-zA-Z0-9#]+;/g, '');

    // 7. Normalisation des espaces
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n+/g, '\n');

    return text.trim();
  }

  /**
   * Alias de rétrocompatibilité pour sanitizeText.
   */
  function cleanText(str) {
    return sanitizeText(str);
  }

  /**
   * Formate de façon sécurisée un résumé pour l'e-mail HTML.
   * Assainit le texte, échappe les balises indésirables, puis transforme **mot** en <strong>mot</strong>.
   *
   * @param {string} str - Résumé textuel
   * @return {string} HTML sécurisé avec mise en gras
   */
  function formatSummaryHtml(str) {
    if (!str) return '';
    let text = sanitizeText(str);

    // Échappement des caractères HTML sensibles
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Conversion sécurisée de **texte clé** en <strong>texte clé</strong>
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    return text;
  }

  /**
   * Alias de rétrocompatibilité pour cleanText.
   */
  function stripHtmlAndMarkdown(str) {
    return sanitizeText(str);
  }

  /**
   * Échappe les caractères HTML dangereux tout en préservant le texte assaini.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const clean = sanitizeText(String(str));
    return clean
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Extrait le domaine d'un expéditeur (ex: "aprizo.com", "linkedin.com").
   */
  function extractSenderDomain(fromStr) {
    if (!fromStr) return '';
    const match = String(fromStr).match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : cleanSenderName(fromStr).toLowerCase();
  }

  /**
   * Nettoie et normalise l'objet d'un e-mail pour la déduplication :
   * - Supprime les préfixes (Re:, Fwd:, Tr:, Urgent:, etc.)
   * - Supprime les caractères non alphanumériques et ponctuation
   * - Réduit les espaces
   */
  function normalizeSubject(subject) {
    if (!subject) return '';
    let clean = sanitizeText(subject).toLowerCase();
    clean = clean.replace(/^(?:re|fwd|fw|tr|copie|rappel|urgent)\s*:\s*/gi, '');
    clean = clean.replace(/[^a-z0-9à-ÿ\s]/gi, ' ');
    return clean.replace(/\s+/g, ' ').trim();
  }

  /**
   * Nettoie le nom de l'expéditeur pour obtenir un affichage élégant et humain.
   */
  function cleanSenderName(fromStr) {
    if (!fromStr) return 'Expéditeur';
    const decoded = sanitizeText(fromStr);

    const lower = decoded.toLowerCase();
    if (lower.indexOf('github.com') !== -1) return 'GitHub';
    if (lower.indexOf('google.com') !== -1) return 'Google';
    if (lower.indexOf('linkedin.com') !== -1 || lower.indexOf('linkedin') !== -1) return 'LinkedIn';
    if (lower.indexOf('michaelpage') !== -1 || lower.indexOf('michael page') !== -1) return 'Michael Page';
    if (lower.indexOf('meteojob') !== -1) return 'Meteojob';
    if (lower.indexOf('hellowork') !== -1) return 'HelloWork';
    if (lower.indexOf('francetravail') !== -1 || lower.indexOf('pole-emploi') !== -1) return 'France Travail';
    if (lower.indexOf('easyjet') !== -1) return 'easyJet';
    if (lower.indexOf('getyourguide') !== -1) return 'GetYourGuide';
    if (lower.indexOf('doctolib') !== -1) return 'Doctolib';
    if (lower.indexOf('qare') !== -1) return 'Qare';
    if (lower.indexOf('lumosity') !== -1) return 'Lumosity';
    if (lower.indexOf('twistshake') !== -1) return 'Twistshake';
    if (lower.indexOf('asos') !== -1) return 'ASOS';
    if (lower.indexOf('tiktok') !== -1) return 'TikTok';
    if (lower.indexOf('facebook') !== -1) return 'Facebook';
    if (lower.indexOf('instagram') !== -1) return 'Instagram';
    if (lower.indexOf('qonto') !== -1) return 'Qonto';
    if (lower.indexOf('ugc') !== -1) return 'UGC';
    if (lower.indexOf('american express') !== -1 || lower.indexOf('amex') !== -1) return 'American Express';

    // Extraction standard du nom complet : "Prénom Nom <email@...>" -> "Prénom Nom"
    const match = decoded.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
    if (match && match[1].trim()) {
      const name = match[1].trim();
      if (name.indexOf('@') === -1) {
        return name;
      }
    }

    // Extraction par nom de domaine : "contact@aprizo.com" -> "Aprizo"
    const emailMatch = decoded.match(/@([a-zA-Z0-9-]+)\.[a-zA-Z]{2,}/);
    if (emailMatch && emailMatch[1]) {
      const brand = emailMatch[1];
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }

    return decoded;
  }

  /**
   * Construit le lien direct d'ouverture d'un fil Gmail universel (#all/<threadId>).
   */
  function buildGmailUrl(threadId) {
    if (!threadId) return 'https://mail.google.com/mail/u/0/#inbox';
    return 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(threadId);
  }

  /**
   * Construit l'URL web Google Calendar pour un événement.
   */
  function buildCalendarUrl(eventId) {
    if (!eventId) return 'https://calendar.google.com/calendar';
    return 'https://calendar.google.com/calendar/r/eventedit/' + encodeURIComponent(eventId);
  }

  /**
   * Formate une date en français selon le fuseau horaire Europe/Paris.
   * Ex: "Mardi 1 septembre 2026"
   */
  function formatDateFrench(date) {
    if (!date) return '';
    try {
      const formatted = date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: Config.DEFAULTS.TIMEZONE
      });
      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    } catch (e) {
      return Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy');
    }
  }

  /**
   * Formate une heure en français. Ex: "09:30"
   */
  function formatTime(date) {
    if (!date) return '';
    return Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'HH:mm');
  }

  /**
   * Calcule la salutation temporelle adaptée à l'heure d'envoi.
   * < 12:00 -> "Bonjour Kouroufia, voici votre synthèse matinale !"
   * 12:00 à 18:00 -> "Bonjour Kouroufia, voici votre point de situation !"
   * >= 18:00 -> "Bonsoir Kouroufia, voici votre synthèse de la journée !"
   */
  function getTemporalGreeting(date, recipientName) {
    const d = date || new Date();
    const name = recipientName || 'Kouroufia';
    const hourStr = Utilities.formatDate(d, Config.DEFAULTS.TIMEZONE, 'HH');
    const hour = parseInt(hourStr, 10);

    if (hour < 12) {
      return 'Bonjour ' + name + ', voici votre synthèse matinale !';
    } else if (hour < 18) {
      return 'Bonjour ' + name + ', voici votre point de situation !';
    } else {
      return 'Bonsoir ' + name + ', voici votre synthèse de la journée !';
    }
  }

  /**
   * Formule de politesse de fin adaptée à l'heure d'envoi.
   */
  function getTemporalSignoff(date) {
    const d = date || new Date();
    const hourStr = Utilities.formatDate(d, Config.DEFAULTS.TIMEZONE, 'HH');
    const hour = parseInt(hourStr, 10);
    return hour >= 18 ? 'Passez une excellente soirée !' : 'Passez une excellente journée !';
  }

  /**
   * Formate une durée en minutes en chaîne lisible. Ex: 75 -> "1 h 15"
   */
  function formatDuration(minutes) {
    if (!minutes || isNaN(minutes) || minutes <= 0) return '';
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? hours + ' h ' + (mins < 10 ? '0' : '') + mins : hours + ' h';
  }

  /**
   * Nettoie le corps d'un e-mail avant transmission à l'API Gemini.
   */
  function cleanEmailBody(rawBody, rawHtml) {
    let text = rawBody || '';
    if (!text && rawHtml) {
      text = rawHtml;
    }
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
      /View in browser|Afficher dans le navigateur[\s\S]*$/i,
      /--\s*\n[\s\S]*$/i
    ];
    for (let i = 0; i < boilerplate.length; i++) {
      text = text.replace(boilerplate[i], '');
    }

    text = sanitizeText(text);

    if (text.length > Config.DEFAULTS.MAX_BODY_CHARS) {
      text = text.substring(0, Config.DEFAULTS.MAX_BODY_CHARS) + '...';
    }

    return text;
  }

  /**
   * Détecte le compte de destination initial.
   */
  function detectDestinationAccount(rawHeaders, toField, bodyText) {
    const searchString = [
      rawHeaders || '',
      toField || '',
      bodyText ? bodyText.substring(0, 500) : ''
    ].join(' ').toLowerCase();

    for (let i = 0; i < Config.KNOWN_ACCOUNTS.length; i++) {
      const acc = Config.KNOWN_ACCOUNTS[i];
      if (searchString.indexOf(acc.email.toLowerCase()) !== -1) {
        return acc;
      }
    }

    return Config.KNOWN_ACCOUNTS[1];
  }

  /**
   * Masque les données sensibles dans les logs.
   */
  function redactSensitive(str) {
    if (!str) return '';
    return String(str)
      .replace(/key=[a-zA-Z0-9._-]+/gi, 'key=[MASQUÉ]')
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [MASQUÉ]')
      .replace(/AIza[0-9A-Za-z-_]{35}/g, '[MASQUÉ]')
      .replace(/AQ\.[a-zA-Z0-9._-]+/g, '[MASQUÉ]');
  }

  /**
   * Calcule le délai d'attente exponentiel avec gigue aléatoire (jitter).
   */
  function calculateBackoffWithJitter(attempt, baseDelayMs) {
    const base = baseDelayMs || 2000;
    const exponent = Math.max(0, attempt - 1);
    const exponentialDelay = base * Math.pow(2, exponent);
    const jitter = Math.floor(Math.random() * 500) + 200;
    return Math.min(exponentialDelay + jitter, 30000);
  }

  return {
    decodeHtmlEntities: decodeHtmlEntities,
    sanitizeText: sanitizeText,
    cleanText: cleanText,
    formatSummaryHtml: formatSummaryHtml,
    stripHtmlAndMarkdown: stripHtmlAndMarkdown,
    escapeHtml: escapeHtml,
    extractSenderDomain: extractSenderDomain,
    normalizeSubject: normalizeSubject,
    cleanSenderName: cleanSenderName,
    buildGmailUrl: buildGmailUrl,
    buildCalendarUrl: buildCalendarUrl,
    formatDateFrench: formatDateFrench,
    formatTime: formatTime,
    getTemporalGreeting: getTemporalGreeting,
    getTemporalSignoff: getTemporalSignoff,
    formatDuration: formatDuration,
    cleanEmailBody: cleanEmailBody,
    detectDestinationAccount: detectDestinationAccount,
    redactSensitive: redactSensitive,
    calculateBackoffWithJitter: calculateBackoffWithJitter
  };
})();
