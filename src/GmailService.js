/**
 * Google CC Briefing Agent
 * GmailService.js — Unread email extraction, boilerplate cleaning, and pre-LLM deduplication.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const GmailService = (() => {
  /**
   * Retrieves and deduplicates all unread emails from the primary inbox since a given timestamp.
   * Excludes calendar notification emails to prevent redundancy with the daily agenda section.
   *
   * @param {number} afterTimestampSec - UNIX timestamp in seconds defining the start checkpoint.
   * @returns {Array<Object>} List of structured, deduplicated email objects.
   */
  const fetchUnreadEmails = (afterTimestampSec) => {
    const query = `is:unread in:inbox -in:spam -in:trash -from:calendar-notification@google.com -subject:"agenda quotidien" after:${Math.floor(afterTimestampSec)}`;
    console.log(`Executing Gmail search query: ${query}`);

    const threads = GmailApp.search(query, 0, 50) || [];
    console.log(`Found ${threads.length} thread(s). Extracting unread messages in batch...`);

    if (threads.length === 0) {
      return [];
    }

    const rawMessages = [];
    const seenMessageIds = new Set();

    // 2. Batch unread message extraction via getMessagesForThreads (1 single RPC call instead of N)
    const threadsMessages = GmailApp.getMessagesForThreads(threads);

    for (let t = 0; t < threads.length; t++) {
      const threadId = threads[t].getId();
      const messages = threadsMessages[t] || [];

      for (const msg of messages) {
        const msgId = msg.getId();
        if (seenMessageIds.has(msgId)) continue;

        const msgDate = msg.getDate();
        const msgTimestampSec = Math.floor(msgDate.getTime() / 1000);

        if (msg.isUnread() && msgTimestampSec >= afterTimestampSec) {
          const fromRaw = msg.getFrom() || '';
          const subjectRaw = msg.getSubject() || '(Sans objet)';

          // Safety check against residual calendar notifications
          if (
            fromRaw.includes('calendar-notification@google.com') ||
            subjectRaw.toLowerCase().includes('agenda quotidien')
          ) {
            continue;
          }

          seenMessageIds.add(msgId);

          let plainBody = '';
          try {
            plainBody = msg.getPlainBody() || '';
          } catch {}

          let rawHtml = '';
          if (!plainBody || plainBody.trim().length < 25) {
            try {
              rawHtml = msg.getBody() || '';
            } catch {}
          }

          const cleanedBody = Utils.cleanEmailBody(plainBody, rawHtml);
          const cleanSubject = Utils.sanitizeText(subjectRaw);
          const senderName = Utils.cleanSenderName(fromRaw);

          rawMessages.push({
            id: msgId,
            threadId,
            from: fromRaw,
            senderName,
            subject: cleanSubject,
            date: msgDate,
            timestampSec: msgTimestampSec,
            timeFormatted: Utils.formatTime(msgDate),
            dateFormatted: Utils.formatDateFrench(msgDate),
            body: cleanedBody,
            hasAttachments: false,
            attachmentsCount: 0,
            webUrl: Utils.buildGmailUrl(threadId)
          });
        }
      }
    }

    // 3. Chronological sorting (most recent first)
    rawMessages.sort((a, b) => b.timestampSec - a.timestampSec);

    // 4. Strict pre-LLM campaign/promotional deduplication
    const deduplicated = [];
    const seenIndexByKey = new Map();

    for (const item of rawMessages) {
      const senderKey = item.senderName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normSubj = Utils.normalizeSubject(item.subject);
      const domain = Utils.extractSenderDomain(item.from);

      // Grouping key calculation
      let dedupKey;
      if (domain.includes('aprizo') || senderKey.includes('aprizo')) {
        dedupKey = 'promo::aprizo';
      } else if (domain.includes('asos') || senderKey.includes('asos')) {
        dedupKey = 'promo::asos';
      } else if (domain.includes('twistshake') || senderKey.includes('twistshake')) {
        dedupKey = 'promo::twistshake';
      } else {
        const stem = normSubj.split(' ').slice(0, 5).join(' ');
        dedupKey = `${senderKey}::${stem}`;
      }

      if (seenIndexByKey.has(dedupKey)) {
        const existing = deduplicated[seenIndexByKey.get(dedupKey)];
        existing.duplicateCount = (existing.duplicateCount || 1) + 1;
        existing.senderDisplayName = `${existing.senderName} (${existing.duplicateCount} messages)`;
        if (!existing.allThreadIds) {
          existing.allThreadIds = [existing.threadId];
        }
        existing.allThreadIds.push(item.threadId);
      } else {
        item.duplicateCount = 1;
        item.senderDisplayName = item.senderName;
        item.allThreadIds = [item.threadId];
        seenIndexByKey.set(dedupKey, deduplicated.length);
        deduplicated.push(item);
      }
    }

    console.log(
      `${rawMessages.length} unread message(s) ➔ ${deduplicated.length} message(s) after pre-LLM deduplication.`
    );

    return deduplicated;
  };

  return {
    fetchUnreadEmails
  };
})();
