/**
 * Google CC Briefing Agent
 * WebApp.js — Page « Détails » d'un e-mail, ouverte depuis les boutons du briefing.
 *
 * Pourquoi : sur téléphone (appli Gmail Android ou iPhone), un lien vers un mail précis
 * de Gmail ramène toujours à l'accueil. Cette page affiche donc elle-même le mail complet,
 * sur téléphone comme sur ordinateur, avec un bouton « Ouvrir dans Gmail ».
 *
 * Sécurité : application web privée (appsscript.json : executeAs USER_DEPLOYING,
 * access MYSELF) — seul le propriétaire du script, connecté à son compte Google, peut l'ouvrir.
 * Lecture seule : le mail n'est ni marqué comme lu, ni archivé, ni supprimé.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

/**
 * Point d'entrée de l'application web : /exec?id=<identifiant du fil Gmail>.
 * @param {Object} e - Événement GET.
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  const id = String((e && e.parameter && e.parameter.id) || '').trim();
  return EmailDetailsPage.render(id);
}

const EmailDetailsPage = (() => {
  /** Nombre maximal de messages affichés pour un même fil (les plus récents). */
  const MAX_MESSAGES = 5;
  /** Longueur maximale du texte affiché par message. */
  const MAX_BODY_CHARS = 15000;
  /** Identifiant de fil Gmail valide (hexadécimal). */
  const THREAD_ID_PATTERN = /^[0-9a-f]{10,24}$/i;

  const esc = (s) => Utils.escapeHtml(s);

  /**
   * Texte brut sûr avec liens cliquables (libellé court : nom du site).
   * @param {string} text
   * @returns {string} HTML.
   */
  const linkify = (text) =>
    esc(text)
      .replace(/https?:\/\/[^\s<>"']+/g, (raw) => {
        const url = raw.replace(/(?:&quot;|[).,;:!?])+$/, '');
        const trailing = raw.slice(url.length);
        const hostMatch = url.match(/^https?:\/\/([^/?#]+)/i);
        const host = hostMatch ? hostMatch[1].replace(/^www\./i, '') : 'lien';
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">[${host}]</a>${trailing}`;
      })
      .replace(/\r?\n/g, '<br>');

  /**
   * Corps lisible d'un message (texte brut, lignes vides en trop retirées).
   * @param {GoogleAppsScript.Gmail.GmailMessage} msg
   * @returns {string}
   */
  const readableBody = (msg) => {
    let body = '';
    try {
      body = msg.getPlainBody() || '';
    } catch {}
    if (!body.trim()) {
      try {
        body = Utils.stripMarkup(msg.getBody() || '');
      } catch {}
    }
    body = body.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n\n[… texte coupé, ouvrez le mail dans Gmail pour la suite]` : body;
  };

  /**
   * Noms des pièces jointes (sans téléchargement).
   * @param {GoogleAppsScript.Gmail.GmailMessage} msg
   * @returns {Array<string>}
   */
  const attachmentNames = (msg) => {
    try {
      return msg.getAttachments({ includeInlineImages: false }).map((a) => a.getName());
    } catch {
      return [];
    }
  };

  /**
   * Enveloppe HTML commune (lisible sur téléphone).
   * @param {string} title
   * @param {string} content
   * @returns {GoogleAppsScript.HTML.HtmlOutput}
   */
  const page = (title, content) => {
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><base target="_blank">
<style>
  body { margin: 0; padding: 16px; background: #FFFFFF; color: #1F2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.55; }
  .wrap { max-width: 680px; margin: 0 auto; }
  .brand { font-size: 12px; color: #6B7280; font-weight: 600; margin-bottom: 6px; }
  h1 { font-size: 19px; line-height: 1.35; margin: 0 0 12px 0; color: #111827; }
  .btn { display: inline-block; padding: 8px 12px; background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600; }
  .note { font-size: 11.5px; color: #9CA3AF; margin: 6px 0 16px 0; }
  .msg { border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
  .meta { font-size: 12.5px; color: #4B5563; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #F3F4F6; }
  .meta strong { color: #111827; font-size: 13.5px; }
  .body { font-size: 14px; word-wrap: break-word; overflow-wrap: anywhere; }
  .body a { color: #1D4ED8; }
  .att { font-size: 12.5px; color: #374151; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #E5E7EB; }
  .err { padding: 14px 16px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; color: #991B1B; }
</style></head><body><div class="wrap"><div class="brand">Mon Briefing Quotidien &bull; Détails du mail</div>${content}</div></body></html>`;
    return HtmlService.createHtmlOutput(html)
      .setTitle(title)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  };

  /**
   * Page d'erreur simple.
   * @param {string} message
   * @returns {GoogleAppsScript.HTML.HtmlOutput}
   */
  const errorPage = (message) => page('Mail introuvable', `<div class="err">${esc(message)}</div>`);

  /**
   * Page « Détails » d'un fil Gmail.
   * @param {string} threadId
   * @returns {GoogleAppsScript.HTML.HtmlOutput}
   */
  const render = (threadId) => {
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return errorPage('Lien incomplet : aucun mail n’est indiqué.');
    }
    let thread = null;
    try {
      thread = GmailApp.getThreadById(threadId);
    } catch (error) {
      console.warn(`Page Détails : fil ${threadId} illisible — ${error.message}`);
    }
    if (!thread) {
      return errorPage('Ce mail est introuvable : il a peut-être été supprimé.');
    }

    const messages = thread.getMessages();
    const shown = messages.slice(-MAX_MESSAGES);
    const subject = Utils.sanitizeText(thread.getFirstMessageSubject() || '(Sans objet)');
    const parts = [
      `<h1>${esc(subject)}</h1>`,
      `<a class="btn" href="${esc(Utils.buildGmailUrl(threadId))}">Ouvrir dans Gmail</a>`,
      '<div class="note">Le bouton ouvre le mail dans Gmail sur ordinateur. Sur téléphone, tout le contenu est affiché ci-dessous.</div>'
    ];
    if (messages.length > shown.length) {
      parts.push(`<div class="note">${messages.length - shown.length} message(s) plus ancien(s) de cette conversation non affiché(s).</div>`);
    }

    for (const msg of shown) {
      const date = msg.getDate();
      const to = msg.getTo() || '';
      const attachments = attachmentNames(msg);
      parts.push(
        '<div class="msg">',
        `<div class="meta"><strong>${esc(Utils.cleanSenderName(msg.getFrom() || ''))}</strong> &lt;${esc((String(msg.getFrom() || '').match(/<([^>]+)>/) || ['', msg.getFrom() || ''])[1])}&gt;<br>`,
        to ? `À : ${esc(to)}<br>` : '',
        `${esc(Utils.formatDateFrench(date))} à ${esc(Utils.formatTime(date))}</div>`,
        `<div class="body">${linkify(readableBody(msg)) || '<em>(Message sans texte)</em>'}</div>`,
        attachments.length ? `<div class="att"><strong>Pièces jointes :</strong> ${attachments.map(esc).join(', ')} <span style="color:#9CA3AF;">(à ouvrir dans Gmail)</span></div>` : '',
        '</div>'
      );
    }
    return page(subject, parts.join(''));
  };

  return { render };
})();
