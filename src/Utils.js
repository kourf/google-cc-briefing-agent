/**
 * Google CC Briefing Agent
 * Utils.js — Fonctions utilitaires, nettoyage de contenu, sécurité et formatage
 */

const Utils = (function () {
  /**
   * Décode les entités HTML préexistantes pour éviter les doubles échappements (ex: l&#039; -> l').
   */
  function decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /**
   * Échappement HTML strict après décodage pour prévenir toute injection dans le template.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const decoded = decodeHtmlEntities(String(str));
    return decoded
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Nettoie le nom de l'expéditeur pour enlever les adresses d'en-tête lourdes.
   */
  function cleanSenderName(fromStr) {
    if (!fromStr) return '';
    const decoded = decodeHtmlEntities(fromStr);
    const match = decoded.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
    return decoded.replace(/<.*>/, '').trim() || decoded;
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
   * Nettoie le corps d'un e-mail pour transmission économique et sécurisée à Gemini.
   */
  function cleanEmailBody(rawBody, rawHtml) {
    let text = rawBody || '';

    if (!text && rawHtml) {
      text = rawHtml;
    }

    if (!text) return '';

    // 1. Suppression des balises script et style et commentaires
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');

    // 2. Remplacement des sauts de ligne HTML et balises courantes
    text = text.replace(/<br\s*[\/]?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' '); // Strip tout le reste des tags HTML

    // 3. Décodage basique des entités HTML courantes
    text = text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");

    // 4. Suppression des blocs de citation répétés (citations d'historique)
    // Ex: "Le 28 août 2026 à 14:00, ... a écrit :"
    text = text.replace(/(On\s.+?wrote:|Le\s.+?a écrit\s?:)[\s\S]*$/i, '');
    // Lignes commençant par > (citations markdown / plain text)
    text = text.replace(/^\s*>+.*$/gm, '');

    // 5. Suppression des signatures et pieds de page répétitifs types
    const boilerplatePatterns = [
      /Cet e-mail a été envoyé à[\s\S]*$/i,
      /This email was sent to[\s\S]*$/i,
      /Pour vous désinscrire[\s\S]*$/i,
      /To unsubscribe[\s\S]*$/i,
      /Cliquez ici pour vous désabonner[\s\S]*$/i,
      /View in browser|Afficher dans le navigateur[\s\S]*$/i,
      /--\s*\n[\s\S]*$/i // Signature standard délimitée par --
    ];
    for (let i = 0; i < boilerplatePatterns.length; i++) {
      text = text.replace(boilerplatePatterns[i], '');
    }

    // 6. Normalisation des espaces et sauts de ligne
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');
    text = text.trim();

    // 7. Tronquage sécurisé pour ne pas dépasser les quotas de tokens
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

    // Par défaut, si aucune mention spécifique n'est trouvée, c'est le compte principal
    return Config.KNOWN_ACCOUNTS[1]; // Compte Principal
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
    // Format de base Calendar Web
    return 'https://calendar.google.com/calendar/r/eventedit/' + encodeURIComponent(eventId);
  }

  /**
   * Formate une durée en minutes en chaîne lisible.
   * Ex: 15 -> "15 min", 75 -> "1h15"
   */
  function formatDuration(minutes) {
    if (!minutes || isNaN(minutes) || minutes <= 0) return '';
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? hours + 'h' + (mins < 10 ? '0' : '') + mins : hours + 'h';
  }

  return {
    escapeHtml: escapeHtml,
    formatDateFrench: formatDateFrench,
    formatTime: formatTime,
    cleanEmailBody: cleanEmailBody,
    detectDestinationAccount: detectDestinationAccount,
    buildGmailUrl: buildGmailUrl,
    buildCalendarUrl: buildCalendarUrl,
    formatDuration: formatDuration,
    cleanSenderName: cleanSenderName,
    decodeHtmlEntities: decodeHtmlEntities
  };
})();
