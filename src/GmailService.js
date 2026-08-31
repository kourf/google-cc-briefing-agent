/**
 * Google CC Briefing Agent
 * GmailService.js — Récupération ciblée, pagination, filtrage anti-spam/corbeille et déduplication stricte
 */

const GmailService = (function () {
  /**
   * Récupère et déduplique tous les messages non lus de la boîte de réception principale.
   * Exclut formellement les spams et la corbeille.
   *
   * @param {number} afterTimestampSec - Timestamp UNIX en secondes (point de départ temporel)
   * @return {Array<Object>} Liste des e-mails dédupliqués avec URLs directes vers les fils Gmail
   */
  function fetchUnreadEmails(afterTimestampSec) {
    // Requête stricte : non lus, uniquement en boîte de réception, sans spam ni corbeille
    const query = 'is:unread in:inbox -in:spam -in:trash after:' + Math.floor(afterTimestampSec);
    console.log('Exécution de la requête Gmail : ' + query);

    const threads = [];
    const PAGE_SIZE = 50;
    let startIndex = 0;

    // 1. Pagination sécurisée pour ne perdre aucun fil de discussion
    while (true) {
      const batch = GmailApp.search(query, startIndex, PAGE_SIZE);
      if (!batch || batch.length === 0) {
        break;
      }
      threads.push.apply(threads, batch);
      if (batch.length < PAGE_SIZE) {
        break;
      }
      startIndex += PAGE_SIZE;

      // Protection quota Apps Script si volume anormal (> 300 threads)
      if (startIndex >= 300) {
        console.warn('Volume élevé détecté (> 300 threads). Traitement des 300 premiers.');
        break;
      }
    }

    console.log(threads.length + ' fil(s) de discussion trouvé(s). Extraction des messages...');

    const rawMessages = [];
    const seenMessageIds = {};

    // 2. Extraction des messages individuels réellement non lus
    for (let t = 0; t < threads.length; t++) {
      const thread = threads[t];
      const threadId = thread.getId();
      const messages = thread.getMessages();

      for (let m = 0; m < messages.length; m++) {
        const msg = messages[m];
        const msgId = msg.getId();

        if (seenMessageIds[msgId]) continue;

        const msgDate = msg.getDate();
        const msgTimestampSec = Math.floor(msgDate.getTime() / 1000);

        if (msg.isUnread() && msgTimestampSec >= afterTimestampSec) {
          seenMessageIds[msgId] = true;

          const plainBody = msg.getPlainBody() || '';
          let rawHtml = '';
          try {
            rawHtml = msg.getBody() || '';
          } catch (e) {
            // Ignorer si body html indisponible
          }

          const cleanedBody = Utils.cleanEmailBody(plainBody, rawHtml);
          const attachments = msg.getAttachments() || [];
          const hasAttachments = attachments.length > 0;

          // Détection du compte de destination initial (pour les e-mails transférés)
          let rawContent = '';
          try {
            rawContent = msg.getRawContent() ? msg.getRawContent().substring(0, 2000) : '';
          } catch (e) {
            // Ignorer si getRawContent échoue
          }

          const toField = msg.getTo() || '';
          const targetAccount = Utils.detectDestinationAccount(rawContent, toField, plainBody);
          const rawSubject = msg.getSubject() || '(Sans objet)';

          // Deep-link direct vers le fil Gmail (/u/0/#all/<threadId>)
          const directGmailUrl = Utils.buildGmailUrl(threadId, msgId);

          rawMessages.push({
            id: msgId,
            threadId: threadId,
            from: msg.getFrom(),
            to: toField,
            subject: Utils.stripHtmlAndMarkdown(rawSubject),
            date: msgDate,
            timestampSec: msgTimestampSec,
            timeFormatted: Utils.formatTime(msgDate),
            dateFormatted: Utils.formatDateFrench(msgDate),
            body: cleanedBody,
            hasAttachments: hasAttachments,
            attachmentsCount: attachments.length,
            targetAccount: targetAccount,
            webUrl: directGmailUrl
          });
        }
      }
    }

    // 3. Tri chronologique décroissant (les plus récents en tête)
    rawMessages.sort(function (a, b) {
      return b.timestampSec - a.timestampSec;
    });

    // 4. Déduplication stricte basée sur SenderDomain + Sujet Racine
    // (ex: fusionne les multiples messages Aprizo, alertes Google récurrentes, etc.)
    const deduplicatedMessages = [];
    const seenKeyMap = {};

    for (let i = 0; i < rawMessages.length; i++) {
      const item = rawMessages[i];
      const dedupKey = Utils.generateDeduplicationKey(item.from, item.subject);

      if (seenKeyMap[dedupKey] !== undefined) {
        // Doublon détecté : incrémente le compteur sur l'e-mail conservé (le plus récent)
        const existing = deduplicatedMessages[seenKeyMap[dedupKey]];
        existing.duplicateCount = (existing.duplicateCount || 1) + 1;
        if (!existing.allMessageIds) {
          existing.allMessageIds = [existing.id];
        }
        existing.allMessageIds.push(item.id);
        // S'assurer de conserver l'URL du thread le plus récent
        if (item.webUrl) {
          existing.webUrl = item.webUrl;
        }
      } else {
        item.duplicateCount = 1;
        item.allMessageIds = [item.id];
        seenKeyMap[dedupKey] = deduplicatedMessages.length;
        deduplicatedMessages.push(item);
      }
    }

    console.log(
      rawMessages.length +
        ' message(s) non lu(s) extrait(s) ➔ ' +
        deduplicatedMessages.length +
        ' après déduplication stricte.'
    );

    return deduplicatedMessages;
  }

  return {
    fetchUnreadEmails: fetchUnreadEmails
  };
})();
