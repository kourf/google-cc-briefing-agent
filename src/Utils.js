/**
 * Google CC Briefing Agent
 * Utils.js — Comprehensive text sanitization, HTML entity decoding, date formatting, and utilities.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const Utils = (() => {
  /**
   * Comprehensive mapping of common HTML named entities.
   * @type {Readonly<Object<string, string>>}
   */
  const ENTITY_MAP = Object.freeze({
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
  });

  /**
   * Decodes all HTML entities (named, decimal, and hexadecimal) iteratively.
   * @param {string} str - String potentially containing HTML entities.
   * @returns {string} Plain text with entities decoded.
   */
  const decodeHtmlEntities = (str) => {
    if (!str) return '';
    let text = String(str);

    // 1. Hexadecimal numeric entities (e.g. &#x27; -> ')
    text = text.replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    });

    // 2. Decimal numeric entities (e.g. &#39; -> ')
    text = text.replace(/&#([0-9]{1,7});/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return '';
      }
    });

    // 3. Named entities (recursive resolution for double-encoded entities like &amp;#039;)
    let previous;
    let iterations = 0;
    do {
      previous = text;
      text = text.replace(/&(?:quot|apos|amp|lt|gt|nbsp|euro|copy|reg|trade|laquo|raquo|ndash|mdash);/gi, (match) => {
        return ENTITY_MAP[match.toLowerCase()] || match;
      });
      iterations++;
    } while (text !== previous && text.includes('&') && iterations < 5);

    return text;
  };

  /**
   * Universal text sanitizer:
   * - Eliminates unicode replacement artifacts (\uFFFD, \uFFFE, \uFFFF) and control characters.
   * - Preserves valid emojis while repairing or removing isolated lone surrogates.
   * - Replaces gender/math notations like (m/w/d) with (H/F).
   * - Strips LaTeX math delimiters and raw HTML tags.
   * - Normalizes French typography (apostrophe ’) and whitespace.
   *
   * @param {string} str - Raw input text.
   * @returns {string} Clean, sanitized text.
   */
  const sanitizeText = (str) => {
    if (!str) return '';
    let text = decodeHtmlEntities(String(str));

    // 1. Strip replacement characters and non-printable control characters
    text = text.replace(/[\uFFFD\uFFFE\uFFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

    // 2. Ensure well-formed Unicode (handles isolated surrogates without breaking emojis)
    if (typeof text.toWellFormed === 'function') {
      text = text.toWellFormed();
    }

    // 3. Standardize German/math gender indicators: (m/w/d) -> (H/F)
    text = text.replace(/\(?\$?\(?\s*m\s*\/\s*w\s*\/\s*d\s*\)?\$?\)?/gi, '(H/F)');
    text = text.replace(/\(?\$?\(?\s*h\s*\/\s*f\s*\)?\$?\)?/gi, '(H/F)');

    // 4. Remove LaTeX math delimiters ($...$, \(...\))
    text = text.replace(/\$([^\$]+)\$/g, '$1');
    text = text.replace(/\\\(([^\)]+)\\\)/g, '$1');
    text = text.replace(/\\\[([^\]]+)\\\]/g, '$1');
    text = text.replace(/[\$\\]/g, '');

    // 5. Strip residual HTML tags
    text = text.replace(/<\/?[a-z0-9]+(?:\s+[^>]*?)?\/?>/gi, ' ');

    // 6. French typography normalization
    text = text.replace(/['’]/g, '’');

    // 7. Strip residual unparsed entity remnants
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&[a-zA-Z0-9#]+;/g, '');

    // 8. Whitespace compaction
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n+/g, '\n');

    return text.trim();
  };

  /**
   * Formats an AI summary safely for HTML email rendering.
   * Sanitizes text, escapes sensitive HTML characters, and converts **word** into <strong>word</strong>.
   *
   * @param {string} str - Summary text with optional Markdown bold syntax.
   * @returns {string} Safe HTML string.
   */
  const formatSummaryHtml = (str) => {
    if (!str) return '';
    let text = sanitizeText(str);

    // Escape HTML sensitive characters
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Convert Markdown **bold** into secure HTML <strong>
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    return text;
  };

  /**
   * Normalizes an email subject line for strict pre-LLM deduplication.
   * Removes prefixes (Re:, Fwd:, etc.) and non-alphanumeric punctuation.
   *
   * @param {string} subject - Raw email subject.
   * @returns {string} Clean normalized subject stem.
   */
  const normalizeSubject = (subject) => {
    if (!subject) return '';
    let clean = sanitizeText(subject).toLowerCase();
    clean = clean.replace(/^(?:re|fwd|fw|tr|copie|rappel|urgent)\s*:\s*/gi, '');
    clean = clean.replace(/[^a-z0-9à-ÿ\s]/gi, ' ');
    return clean.replace(/\s+/g, ' ').trim();
  };

  /**
   * Cleans raw sender string to extract a clean, professional display name.
   * @param {string} fromStr - Raw sender string (e.g. "Google Cloud <no-reply@...>")
   * @returns {string} Human-friendly sender label.
   */
  const cleanSenderName = (fromStr) => {
    if (!fromStr) return 'Expéditeur';
    const decoded = sanitizeText(fromStr);
    const lower = decoded.toLowerCase();

    // Direct brand recognizers
    if (lower.includes('github')) return 'GitHub';
    if (lower.includes('google')) return 'Google';
    if (lower.includes('linkedin')) return 'LinkedIn';
    if (lower.includes('michael page') || lower.includes('michaelpage')) return 'Michael Page';
    if (lower.includes('meteojob')) return 'Meteojob';
    if (lower.includes('hellowork')) return 'HelloWork';
    if (lower.includes('francetravail') || lower.includes('pole-emploi')) return 'France Travail';
    if (lower.includes('easyjet')) return 'easyJet';
    if (lower.includes('getyourguide')) return 'GetYourGuide';
    if (lower.includes('doctolib')) return 'Doctolib';
    if (lower.includes('qare')) return 'Qare';
    if (lower.includes('lumosity')) return 'Lumosity';
    if (lower.includes('twistshake')) return 'Twistshake';
    if (lower.includes('asos')) return 'ASOS';
    if (lower.includes('tiktok')) return 'TikTok';
    if (lower.includes('facebook')) return 'Facebook';
    if (lower.includes('instagram')) return 'Instagram';
    if (lower.includes('qonto')) return 'Qonto';
    if (lower.includes('ugc')) return 'UGC';
    if (lower.includes('american express') || lower.includes('amex')) return 'American Express';

    // Standard name format: "Firstname Lastname <email@...>" -> "Firstname Lastname"
    const match = decoded.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
    if (match && match[1].trim()) {
      const candidate = match[1].trim();
      if (!candidate.includes('@')) {
        return candidate;
      }
    }

    // Domain fallback: "contact@aprizo.com" -> "Aprizo"
    const domainMatch = decoded.match(/@([a-zA-Z0-9-]+)\.[a-zA-Z]{2,}/);
    if (domainMatch && domainMatch[1]) {
      const brand = domainMatch[1];
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }

    return decoded;
  };

  /**
   * Extracts the root domain from an email address for campaign grouping.
   * @param {string} fromStr - Raw sender address.
   * @returns {string} Lowercase domain (e.g. "linkedin.com").
   */
  const extractSenderDomain = (fromStr) => {
    if (!fromStr) return '';
    const match = String(fromStr).match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : cleanSenderName(fromStr).toLowerCase();
  };

  /**
   * Strips email boilerplate, forwarded email blocks, and unsubscribe footers.
   * @param {string} rawBody - Plain-text body.
   * @param {string} rawHtml - HTML body fallback.
   * @returns {string} Cleaned snippet.
   */
  const cleanEmailBody = (rawBody, rawHtml) => {
    let text = rawBody || rawHtml || '';
    if (!text) return '';

    text = sanitizeText(text);

    // Remove quote blocks and forward signatures
    text = text.replace(/(On\s.+?wrote:|Le\s.+?a écrit\s?:)[\s\S]*$/i, '');
    text = text.replace(/^\s*>+.*$/gm, '');

    // Common newsletter / marketing boilerplate patterns
    const boilerplate = [
      /Cet e-mail a été envoyé à[\s\S]*$/i,
      /This email was sent to[\s\S]*$/i,
      /Pour vous désinscrire[\s\S]*$/i,
      /To unsubscribe[\s\S]*$/i,
      /Cliquez ici pour vous désabonner[\s\S]*$/i,
      /View in browser|Afficher dans le navigateur[\s\S]*$/i,
      /--\s*\n[\s\S]*$/i
    ];

    for (const pattern of boilerplate) {
      text = text.replace(pattern, '');
    }

    text = sanitizeText(text);

    if (text.length > Config.DEFAULTS.MAX_BODY_CHARS) {
      text = text.substring(0, Config.DEFAULTS.MAX_BODY_CHARS) + '...';
    }

    return text;
  };

  /**
   * Builds direct universal Gmail web URL for an email thread.
   * Standardized to support both desktop browser tabs and mobile Gmail app intent handlers.
   *
   * @param {string} threadId - Gmail thread identifier.
   * @returns {string} Direct deep-link web URL.
   */
  const buildGmailUrl = (threadId) => {
    if (!threadId) return 'https://mail.google.com/mail/u/0/#inbox';
    const cleanId = encodeURIComponent(String(threadId).trim());
    return `https://mail.google.com/mail/u/0/#search/id%3A${cleanId}`;
  };

  /**
   * Builds web URL for a Google Calendar event.
   * @param {string} eventId - Calendar event identifier.
   * @returns {string} Web edit/view link.
   */
  const buildCalendarUrl = (eventId) => {
    if (!eventId) return 'https://calendar.google.com/calendar';
    return `https://calendar.google.com/calendar/r/eventedit/${encodeURIComponent(eventId)}`;
  };

  /**
   * Formats a Date instance into elegant French (Europe/Paris).
   * E.g. "Mercredi 2 septembre 2026".
   * @param {Date} date - Date to format.
   * @returns {string} Localized date string.
   */
  const formatDateFrench = (date) => {
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
    } catch {
      return Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy');
    }
  };

  /**
   * Formats a Date instance into time (HH:mm) in Europe/Paris.
   * @param {Date} date - Date to format.
   * @returns {string} Formatted time string (e.g. "09:30").
   */
  const formatTime = (date) => {
    if (!date) return '';
    return Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'HH:mm');
  };

  /**
   * Returns a personalized, time-of-day greeting in French.
   * @param {Date} [date] - Reference date.
   * @param {string} [name='Kouroufia'] - Recipient name.
   * @returns {string} Greeting formula.
   */
  const getTemporalGreeting = (date = new Date(), name = 'Kouroufia') => {
    const hour = parseInt(Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'HH'), 10);
    if (hour < 12) {
      return `Bonjour ${name}, voici votre synthèse matinale !`;
    } else if (hour < 18) {
      return `Bonjour ${name}, voici votre point de situation !`;
    }
    return `Bonsoir ${name}, voici votre synthèse de la journée !`;
  };

  /**
   * Returns a personalized sign-off based on time of day.
   * @param {Date} [date] - Reference date.
   * @returns {string} Sign-off formula.
   */
  const getTemporalSignoff = (date = new Date()) => {
    const hour = parseInt(Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'HH'), 10);
    return hour >= 18 ? 'Passez une excellente soirée !' : 'Passez une excellente journée !';
  };

  /**
   * Formats a duration in minutes into a readable French string (e.g. 75 -> "1 h 15").
   * @param {number} minutes - Duration in minutes.
   * @returns {string} Formatted duration.
   */
  const formatDuration = (minutes) => {
    if (!minutes || isNaN(minutes) || minutes <= 0) return '';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} h ${mins < 10 ? '0' : ''}${mins}` : `${hours} h`;
  };

  /**
   * Masks sensitive credentials in logs.
   * @param {string} str - Raw log message.
   * @returns {string} Redacted log message.
   */
  const redactSensitive = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/key=[a-zA-Z0-9._-]+/gi, 'key=[MASQUÉ]')
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [MASQUÉ]')
      .replace(/AIza[0-9A-Za-z-_]{35}/g, '[MASQUÉ]')
      .replace(/AQ\.[a-zA-Z0-9._-]+/g, '[MASQUÉ]');
  };

  /**
   * Calculates exponential backoff delay with random jitter.
   * @param {number} attempt - Current retry attempt index (1-based).
   * @param {number} [baseDelayMs=2500] - Base delay in milliseconds.
   * @returns {number} Delay in milliseconds (capped at 30,000 ms).
   */
  const calculateBackoffWithJitter = (attempt, baseDelayMs = 2500) => {
    const exponent = Math.max(0, attempt - 1);
    const exponentialDelay = baseDelayMs * Math.pow(2, exponent);
    const jitter = Math.floor(Math.random() * 500) + 200;
    return Math.min(exponentialDelay + jitter, 30000);
  };

  return {
    decodeHtmlEntities,
    sanitizeText,
    cleanText: sanitizeText,
    formatSummaryHtml,
    normalizeSubject,
    cleanSenderName,
    extractSenderDomain,
    cleanEmailBody,
    buildGmailUrl,
    buildCalendarUrl,
    formatDateFrench,
    formatTime,
    getTemporalGreeting,
    getTemporalSignoff,
    formatDuration,
    redactSensitive,
    calculateBackoffWithJitter
  };
})();
