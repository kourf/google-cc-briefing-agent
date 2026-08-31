/**
 * Google CC Briefing Agent
 * GmailService.js — Récupération ciblée, exclusion de l'agenda et déduplication pré-LLM
 */

const GmailService = (function () {
  /**
   * Récupère et déduplique tous les messages non lus de la boîte de réception principale.
   * Exclut explicitement les notifications d'agenda Google Calendar pour éviter les doublons avec la section agenda.
   *
   * @param {number} afterTimestampSec - Timestamp UNIX en secondes
   * @return {Array<Object>} Liste des e-mails dédupliqués avec URLs directes vers les fils Gmail
   */
  function fetchUnreadEmails(afterTimestampSec) {
    // Requête durcie : non lus, boîte principale, hors spam/corbeille et sans notifications d'agenda
    const query =
      'is:unread in:inbox -in:spam -in:trash -from:calendar-notification@google.com -subject:"agenda quotidien" after:' +
      Math.floor(afterTimestampSec);
    console.log('Exécution de la requête Gmail : ' + query);

    const threads = [];
    const PAGE_SIZE = 50;
    let startIndex = 0;

    // 1. Pagination sécurisée
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

      if (startIndex >= 300) {
        console.warn('Volume élevé détecté (> 300 threads). Traitement des 300 premiers.');
        break;
      }
    }

    console.log(threads.length + ' fil(s) de discussion trouvé(s). Extraction des messages...');

    const rawMessages = [];
    const seenMessageIds = {};

    // 2. Extraction des messages individuels non lus
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
          const fromRaw = msg.getFrom() || '';
          const subjectRaw = msg.getSubject() || '(Sans objet)';

          // Filtre de sécurité additionnel contre les notifications Calendar
          if (
            fromRaw.indexOf('calendar-notification@google.com') !== -1 ||
            subjectRaw.toLowerCase().indexOf('agenda quotidien') !== -1
          ) {
            continue;
          }

          seenMessageIds[msgId] = true;

          const plainBody = msg.getPlainBody() || '';
          let rawHtml = '';
          try {
            rawHtml = msg.getBody() || '';
          } catch (e) {}

          const cleanedBody = Utils.cleanEmailBody(plainBody, rawHtml);
          const attachments = msg.getAttachments() || [];

          let rawContent = '';
          try {
            rawContent = msg.getRawContent() ? msg.getRawContent().substring(0, 2000) : '';
          } catch (e) {}

          const toField = msg.getTo() || '';
          const targetAccount = Utils.detectDestinationAccount(rawContent, toField, plainBody);
          const cleanSubject = Utils.cleanText(subjectRaw);
          const senderName = Utils.cleanSenderName(fromRaw);

          rawMessages.push({
            id: msgId,
            threadId: threadId,
            from: fromRaw,
            senderName: senderName,
            to: toField,
            subject: cleanSubject,
            date: msgDate,
            timestampSec: msgTimestampSec,
            timeFormatted: Utils.formatTime(msgDate),
            dateFormatted: Utils.formatDateFrench(msgDate),
            body: cleanedBody,
            hasAttachments: attachments.length > 0,
            attachmentsCount: attachments.length,
            targetAccount: targetAccount,
            // Deep-link exact vers le fil universel
            webUrl: Utils.buildGmailUrl(threadId)
          });
        }
      }
    }

    // 3. Tri chronologique décroissant (les plus récents en premier)
    rawMessages.sort(function (a, b) {
      return b.timestampSec - a.timestampSec;
    });

    // 4. Déduplication stricte pré-LLM
    const deduplicated = [];
    const seenIndexByKey = {};

    for (let i = 0; i < rawMessages.length; i++) {
      const item = rawMessages[i];
      const senderKey = item.senderName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normSubj = Utils.normalizeSubject(item.subject);
      const domain = Utils.extractSenderDomain(item.from);

      // Calcul de la clé de regroupement
      let dedupKey = '';
      if (domain.indexOf('aprizo') !== -1 || senderKey.indexOf('aprizo') !== -1) {
        dedupKey = 'promo::aprizo';
      } else if (domain.indexOf('asos') !== -1 || senderKey.indexOf('asos') !== -1) {
        dedupKey = 'promo::asos';
      } else if (domain.indexOf('twistshake') !== -1 || senderKey.indexOf('twistshake') !== -1) {
        dedupKey = 'promo::twistshake';
      } else {
        const stem = normSubj.split(' ').slice(0, 5).join(' ');
        dedupKey = senderKey + '::' + stem;
      }

      if (seenIndexByKey[dedupKey] !== undefined) {
        // Doublon détecté : on incrémente le compteur sur l'e-mail le plus récent
        const existing = deduplicated[seenIndexByKey[dedupKey]];
        existing.duplicateCount = (existing.duplicateCount || 1) + 1;
        existing.senderDisplayName = existing.senderName + ' (' + existing.duplicateCount + ' messages)';
        if (!existing.allThreadIds) {
          existing.allThreadIds = [existing.threadId];
        }
        existing.allThreadIds.push(item.threadId);
      } else {
        item.duplicateCount = 1;
        item.senderDisplayName = item.senderName;
        item.allThreadIds = [item.threadId];
        seenIndexByKey[dedupKey] = deduplicated.length;
        deduplicated.push(item);
      }
    }

    console.log(
      rawMessages.length +
        ' message(s) non lu(s) ➔ ' +
        deduplicated.length +
        ' message(s) après déduplication stricte pré-LLM.'
    );

    return deduplicated;
  }

  return {
    fetchUnreadEmails: fetchUnreadEmails
  };
})();
