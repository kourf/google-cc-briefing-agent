/**
 * Google CC Briefing Agent
 * GmailService.js — Extraction des e-mails non lus, déduplication pré-IA, nettoyage des corps
 * et détection du compte de destination (Principal, Compte Pro, Ancien Perso).
 * Lecture seule : aucun e-mail n'est marqué comme lu, archivé ou supprimé.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const GmailService = (() => {
  /** Expéditeurs promotionnels regroupés en une seule entrée par campagne. */
  const PROMO_GROUPS = Object.freeze(['aprizo', 'asos', 'twistshake']);

  /**
   * Compte de destination d'un message d'après ses destinataires (To / Cc).
   * Les comptes secondaires sont prioritaires (un transfert garde l'adresse d'origine).
   *
   * @param {GoogleAppsScript.Gmail.GmailMessage} msg
   * @returns {Object} Entrée de Config.KNOWN_ACCOUNTS (compte principal par défaut).
   */
  const detectAccount = (msg) => {
    const accounts = Config.KNOWN_ACCOUNTS;
    const mainAccount = accounts.find((a) => a.type === 'main') || accounts[0];
    let recipients = '';
    try {
      recipients = `${msg.getTo() || ''} ${msg.getCc() || ''}`.toLowerCase();
    } catch {
      return mainAccount;
    }
    return (
      accounts.find((a) => a.type !== 'main' && recipients.includes(a.email.toLowerCase())) ||
      mainAccount
    );
  };

  /**
   * Clé de regroupement d'une campagne (même expéditeur + début d'objet identique).
   * @param {Object} item
   * @returns {string}
   */
  const buildDedupKey = (item) => {
    const senderKey = item.senderName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const domain = Utils.extractSenderDomain(item.from);
    const promo = PROMO_GROUPS.find((p) => domain.includes(p) || senderKey.includes(p));
    if (promo) return `promo::${promo}`;
    return `${senderKey}::${Utils.normalizeSubject(item.subject).split(' ').slice(0, 5).join(' ')}`;
  };

  /**
   * Récupère, déduplique et nettoie les e-mails non lus de la boîte de réception depuis un instant donné.
   * Les notifications d'agenda sont exclues (déjà couvertes par la section planning).
   *
   * @param {number} afterTimestampSec - Début de la période (secondes UNIX).
   * @returns {Array<Object>} E-mails structurés et dédupliqués (le plus récent d'abord).
   */
  const fetchUnreadEmails = (afterTimestampSec) => {
    const query = `is:unread in:inbox -in:spam -in:trash -from:calendar-notification@google.com -subject:"agenda quotidien" after:${Math.floor(afterTimestampSec)}`;
    console.log(`Recherche Gmail : ${query}`);

    const threads = GmailApp.search(query, 0, Config.DEFAULTS.MAX_THREADS) || [];
    console.log(`${threads.length} fil(s) trouvé(s).`);
    if (threads.length === 0) return [];

    // 1. Extraction groupée (un seul appel pour tous les fils)
    const threadsMessages = GmailApp.getMessagesForThreads(threads);
    const rawMessages = [];
    const seenMessageIds = new Set();

    threads.forEach((thread, t) => {
      const threadId = thread.getId();
      for (const msg of threadsMessages[t] || []) {
        if (!msg.isUnread()) continue;
        const msgDate = msg.getDate();
        const timestampSec = Math.floor(msgDate.getTime() / 1000);
        const msgId = msg.getId();
        if (timestampSec < afterTimestampSec || seenMessageIds.has(msgId)) continue;

        const fromRaw = msg.getFrom() || '';
        const subjectRaw = msg.getSubject() || '(Sans objet)';
        if (fromRaw.includes('calendar-notification@google.com') || /agenda quotidien/i.test(subjectRaw)) continue;

        seenMessageIds.add(msgId);
        rawMessages.push({
          id: msgId,
          threadId,
          from: fromRaw,
          senderName: Utils.cleanSenderName(fromRaw),
          subject: Utils.sanitizeText(subjectRaw),
          timestampSec,
          timeFormatted: Utils.formatTime(msgDate),
          dateFormatted: Utils.formatDateFrench(msgDate),
          webUrl: Utils.buildGmailUrl(threadId),
          msgObj: msg
        });
      }
    });

    // 2. Du plus récent au plus ancien : la version la plus récente d'une campagne est conservée
    rawMessages.sort((a, b) => b.timestampSec - a.timestampSec);

    // 3. Déduplication pré-IA (avant les appels coûteux de lecture du corps)
    const deduplicated = [];
    const indexByKey = new Map();
    for (const item of rawMessages) {
      const key = buildDedupKey(item);
      if (indexByKey.has(key)) {
        const existing = deduplicated[indexByKey.get(key)];
        existing.duplicateCount += 1;
        existing.senderDisplayName = `${existing.senderName} (${existing.duplicateCount} messages)`;
      } else {
        item.duplicateCount = 1;
        item.senderDisplayName = item.senderName;
        indexByKey.set(key, deduplicated.length);
        deduplicated.push(item);
      }
    }

    // 4. Corps et compte de destination uniquement pour les messages conservés
    for (const item of deduplicated) {
      const msg = item.msgObj;
      let plainBody = '';
      try {
        plainBody = msg.getPlainBody() || '';
      } catch {}
      let rawHtml = '';
      if (plainBody.trim().length < 25) {
        try {
          rawHtml = msg.getBody() || '';
        } catch {}
      }
      item.body = Utils.cleanEmailBody(plainBody, rawHtml);
      item.account = detectAccount(msg);
      delete item.msgObj;
    }

    console.log(`${rawMessages.length} message(s) non lu(s) -> ${deduplicated.length} après déduplication.`);
    return deduplicated;
  };

  return {
    fetchUnreadEmails
  };
})();
