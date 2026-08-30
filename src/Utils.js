/**
 * Google CC Briefing Agent
 * Utils.js — Fonctions utilitaires, assainissement de texte, sécurité et formatage
 */

const Utils = (function () {
  /**
   * Décode exhaustivement toutes les entités HTML (nommées, décimales et hexadécimales).
   * Transforme définitivement &#039; et &#39; en apostrophe réelle, &amp; en &, etc.
   *
   * @param {string} str - Chaîne potentiellement encodée
   * @return {string} Chaîne en texte brut naturel avec vrais caractères
   */
  function decodeHtmlEntities(str) {
    if (!str) return '';
    let text = String(str);

    // 1. Décodage des entités hexadécimales (ex: &#x27; -> ')
    text = text.replace(/&#x([0-9a-f]{1,6});/gi, function (_, hex) {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (e) {
        return '';
      }
    });

    // 2. Décodage des entités décimales (ex: &#39; -> ' et &#039; -> ')
    text = text.replace(/&#([0-9]{1,7});/g, function (_, dec) {
      try {
        const code = parseInt(dec, 10);
        return String.fromCodePoint(code);
      } catch (e) {
        return '';
      }
    });

    // 3. Décodage des entités nommées courantes
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

    // Remplacement itératif pour traiter les doubles encodages (ex: &amp;#039;)
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
   * Supprime toute balise HTML résiduelle, entités parasites et syntaxe Markdown.
   * Remplace l'apostrophe droite standard par l'apostrophe typographique française (’)
   * pour interdire à 100% l'apparition de l'artefact "&#039;".
   *
   * @param {string} str - Texte pouvant contenir des balises ou du markdown
   * @return {string} Texte fluide, naturel et nettoyé
   */
  function stripHtmlAndMarkdown(str) {
    if (!str) return '';
    let text = decodeHtmlEntities(str);

    // Suppression de toutes les balises HTML (<...>)
    text = text.replace(/<\/?[a-z0-9]+(?:\s+[^>]*?)?\/?>/gi, ' ');

    // Suppression du formatage Markdown gras/italique/code (**texte**, *texte*, `texte`, [texte])
    text = text.replace(/\*\*(.*?)\*\*/g, '$1');
    text = text.replace(/__(.*?)__/g, '$1');
    text = text.replace(/\*(.*?)\*/g, '$1');
    text = text.replace(/_(.*?)_/g, '$1');
    text = text.replace(/`{1,3}(.*?)`{1,3}/g, '$1');
    text = text.replace(/\[(.*?)\](?:\(.*?\))?/g, '$1');

    // Remplacement de l'apostrophe ASCII par l'apostrophe typographique française
    // Cela garantit une typographie élégante et empêche tout moteur HTML de produire &#039;
    text = text.replace(/['’]/g, '’');

    // Normalisation des espaces multiples
    text = text.replace(/[ \t]+/g, ' ').trim();

    return text;
  }

  /**
   * Échappement HTML sécurisé pour injection dans le template.
   * N'échappe que les caractères dangereux (&, <, >, ") sans altérer les apostrophes typographiques.
   *
   * @param {string} str - Texte à sécuriser
   * @return {string} Chaîne sécurisée pour inclusion dans le HTML
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const clean = stripHtmlAndMarkdown(String(str));
    return clean
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Normalise l'objet d'un e-mail pour la détection et la fusion des doublons.
   * Retire les préfixes "Re:", "Fwd:", "Tr:" et la ponctuation superflue.
   */
  function normalizeSubject(subject) {
    if (!subject) return '';
    let clean = decodeHtmlEntities(subject).toLowerCase();
    clean = clean.replace(/^(?:re|fwd|fw|tr)\s*:\s*/gi, '');
    clean = clean.replace(/[^a-z0-9à-ÿ\s]/gi, ' ');
    return clean.replace(/\s+/g, ' ').trim();
  }

  /**
   * Nettoie le nom de l'expéditeur pour obtenir un nom humain élégant.
   * Exemple : "kourf <notifications@github.com>" -> "kourf (GitHub)" ou "kourf"
   */
  function cleanSenderName(fromStr) {
    if (!fromStr) return '';
    const decoded = decodeHtmlEntities(fromStr).trim();

    // Cas spécial GitHub
    if (decoded.toLowerCase().indexOf('notifications@github.com') !== -1) {
      const ghUser = decoded.replace(/<.*>/, '').replace(/"/g, '').trim();
      return ghUser ? ghUser + ' (GitHub)' : 'GitHub';
    }

    // Extraction standard : "Prénom Nom <email@domain.com>" -> "Prénom Nom"
    const match = decoded.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
    if (match && match[1].trim()) {
      return match[1].trim();
    }

    // Si seulement une adresse e-mail : "contact@domaine.com" -> "domaine.com"
    const emailMatch = decoded.match(/<?([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))>?/);
    if (emailMatch && emailMatch[2]) {
      return emailMatch[2];
    }

    return decoded;
  }

  /**
   * Formate une date en français selon le fuseau horaire de configuration.
   * Exemple : "Lundi 31 août 2026"
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
   * Formate une heure en français.
   * Exemple : "09:30"
   */
  function formatTime(date) {
    if (!date) return '';
    return Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'HH:mm');
  }

  /**
   * Nettoie le corps d'un e-mail avant son analyse par Gemini.
   */
  function cleanEmailBody(rawBody, rawHtml) {
    let text = rawBody || '';
    if (!text && rawHtml) {
      text = rawHtml;
    }
    if (!text) return '';

    // Décodage préalable des entités
    text = decodeHtmlEntities(text);

    // 1. Suppression des balises lourdes
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');

    // 2. Remplacement des sauts de ligne HTML
    text = text.replace(/<br\s*[\/]?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');

    // 3. Suppression des citations et historiques
    text = text.replace(/(On\s.+?wrote:|Le\s.+?a écrit\s?:)[\s\S]*$/i, '');
    text = text.replace(/^\s*>+.*$/gm, '');

    // 4. Suppression des pieds de page de désabonnement standards
    const boilerplatePatterns = [
      /Cet e-mail a été envoyé à[\s\S]*$/i,
      /This email was sent to[\s\S]*$/i,
      /Pour vous désinscrire[\s\S]*$/i,
      /To unsubscribe[\s\S]*$/i,
      /Cliquez ici pour vous désabonner[\s\S]*$/i,
      /View in browser|Afficher dans le navigateur[\s\S]*$/i,
      /--\s*\n[\s\S]*$/i
    ];
    for (let i = 0; i < boilerplatePatterns.length; i++) {
      text = text.replace(boilerplatePatterns[i], '');
    }

    // 5. Normalisation des espaces
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');
    text = text.trim();

    // 6. Tronquage sécurisé pour respecter les quotas de tokens
    if (text.length > Config.DEFAULTS.MAX_BODY_CHARS) {
      text = text.substring(0, Config.DEFAULTS.MAX_BODY_CHARS) + '... [texte tronqué]';
    }

    return text;
  }

  /**
   * Détecte le compte de destination initial (pour les e-mails transférés).
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

    // Par défaut : compte principal
    return Config.KNOWN_ACCOUNTS[1];
  }

  /**
   * Construit l'URL web directe d'ouverture d'un message/thread Gmail.
   */
  function buildGmailUrl(threadId, messageId) {
    const id = messageId || threadId;
    if (!id) return 'https://mail.google.com/mail/u/0/#inbox';
    return 'https://mail.google.com/mail/u/0/#inbox/' + encodeURIComponent(id);
  }

  /**
   * Construit l'URL web Google Calendar pour un événement.
   */
  function buildCalendarUrl(eventId) {
    if (!eventId) return 'https://calendar.google.com/calendar';
    return 'https://calendar.google.com/calendar/r/eventedit/' + encodeURIComponent(eventId);
  }

  /**
   * Formate une durée en minutes en chaîne lisible.
   * Ex: 15 -> "15 min", 75 -> "1 h 15"
   */
  function formatDuration(minutes) {
    if (!minutes || isNaN(minutes) || minutes <= 0) return '';
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? hours + ' h ' + (mins < 10 ? '0' : '') + mins : hours + ' h';
  }

  /**
   * Masque les données sensibles (clés d'API, tokens) des logs et messages d'erreur.
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
   * Formule : baseDelayMs * 2^(attempt - 1) + jitter aléatoire (100 à 400 ms).
   */
  function calculateBackoffWithJitter(attempt, baseDelayMs) {
    const base = baseDelayMs || 1500;
    const exponent = Math.max(0, attempt - 1);
    const exponentialDelay = base * Math.pow(2, exponent);
    const jitter = Math.floor(Math.random() * 400) + 100;
    return Math.min(exponentialDelay + jitter, 30000);
  }

  return {
    decodeHtmlEntities: decodeHtmlEntities,
    stripHtmlAndMarkdown: stripHtmlAndMarkdown,
    escapeHtml: escapeHtml,
    normalizeSubject: normalizeSubject,
    cleanSenderName: cleanSenderName,
    formatDateFrench: formatDateFrench,
    formatTime: formatTime,
    cleanEmailBody: cleanEmailBody,
    detectDestinationAccount: detectDestinationAccount,
    buildGmailUrl: buildGmailUrl,
    buildCalendarUrl: buildCalendarUrl,
    formatDuration: formatDuration,
    redactSensitive: redactSensitive,
    calculateBackoffWithJitter: calculateBackoffWithJitter
  };
})();
