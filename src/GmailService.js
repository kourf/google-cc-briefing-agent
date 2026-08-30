/**
 * Google CC Briefing Agent
 * GmailService.js — Récupération, pagination, filtrage et nettoyage des e-mails non lus
 */

const GmailService = (function () {
  /**
   * Récupère tous les messages non lus correspondant au périmètre défini par le timestamp de début.
   * @param {number} afterTimestampSec - Timestamp UNIX en secondes (point de départ de la recherche)
   * @return {Array<Object>} Liste des messages nettoyés avec métadonnées
   */
  function fetchUnreadEmails(afterTimestampSec) {
    const query = 'is:unread in:inbox after:' + Math.floor(afterTimestampSec);
    console.log('Exécution de la requête Gmail : ' + query);

    const threads = [];
    const PAGE_SIZE = 50;
    let startIndex = 0;

    // Pagination pour ne JAMAIS perdre silencieusement d'e-mails
    while (true) {
      const batch = GmailApp.search(query, startIndex, PAGE_SIZE);
      if (!batch || batch.length === 0) {
        break;
      }
      threads.push.apply(threads, batch);
      if (batch.length < PAGE_SIZE) {
        break; // Dernier lot atteint
      }
      startIndex += PAGE_SIZE;

      // Protection quota Apps Script si volume anormalement colossal
      if (startIndex >= 300) {
        console.warn('Volume élevé détecté (> 300 threads). Traitement des 300 premiers threads.');
        break;
      }
    }

    console.log(threads.length + ' fil(s) de discussion trouvé(s). Extraction des messages...');

    const processedMessages = [];
    const seenMessageIds = {};

    for (let t = 0; t < threads.length; t++) {
      const thread = threads[t];
      const threadId = thread.getId();
      const messages = thread.getMessages();

      for (let m = 0; m < messages.length; m++) {
        const msg = messages[m];
        const msgId = msg.getId();

        // Éviter les doublons
        if (seenMessageIds[msgId]) continue;

        // Seuls les messages réellement non lus et reçus après le timestamp
        const msgDate = msg.getDate();
        const msgTimestampSec = Math.floor(msgDate.getTime() / 1000);

        if (msg.isUnread() && msgTimestampSec >= afterTimestampSec) {
          seenMessageIds[msgId] = true;

          const plainBody = msg.getPlainBody() || '';
          let rawHtml = '';
          try {
            rawHtml = msg.getBody() || '';
          } catch (e) {
            // Ignorer si indisponible
          }

          const cleanedBody = Utils.cleanEmailBody(plainBody, rawHtml);
          const attachments = msg.getAttachments() || [];
          const hasAttachments = attachments.length > 0;

          // Récupération des informations d'en-tête pour routage multi-compte
          let rawContent = '';
          try {
            rawContent = msg.getRawContent() ? msg.getRawContent().substring(0, 2000) : '';
          } catch (e) {
            // Ignorer si getRawContent échoue
          }

          const toField = msg.getTo() || '';
          const targetAccount = Utils.detectDestinationAccount(rawContent, toField, plainBody);

          processedMessages.push({
            id: msgId,
            threadId: threadId,
            from: msg.getFrom(),
            to: toField,
            subject: msg.getSubject() || '(Sans objet)',
            date: msgDate,
            timestampSec: msgTimestampSec,
            timeFormatted: Utils.formatTime(msgDate),
            dateFormatted: Utils.formatDateFrench(msgDate),
            body: cleanedBody,
            hasAttachments: hasAttachments,
            attachmentsCount: attachments.length,
            targetAccount: targetAccount,
            webUrl: Utils.buildGmailUrl(threadId, msgId)
          });
        }
      }
    }

    // Tri par date décroissante (le plus récent en premier)
    processedMessages.sort(function (a, b) {
      return b.timestampSec - a.timestampSec;
    });

    console.log(processedMessages.length + ' message(s) non lu(s) éligible(s) extrait(s).');
    return processedMessages;
  }

  return {
    fetchUnreadEmails: fetchUnreadEmails
  };
})();
