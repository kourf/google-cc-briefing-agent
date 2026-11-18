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

  /** Chemins d'URL typiques d'une offre d'emploi (LinkedIn, Indeed, Jobup, Meteojob, HelloWork, Apec, Michael Page…). */
  const JOB_LINK_PATTERN = /\/jobs?\/view\/|\/viewjob|\/emplois?\/|\/offres?[-_/]|\/offre-d-emploi|\/job-detail|\/stellen|\/stelle\/|\/vacanc|\/annonce|jobup\.ch\/[a-z]{2}\/|\/detail\//i;
  const MAX_JOB_LINKS_PER_EMAIL = 15;

  /**
   * Liens d'offres d'emploi d'un e-mail HTML : texte du lien (intitulé) + adresse.
   * Les liens LinkedIn sont nettoyés de leurs paramètres de suivi.
   *
   * @param {string} html
   * @returns {Array<{text: string, url: string}>}
   */
  const extractJobLinks = (html) => {
    const links = [];
    const seen = new Set();
    for (const m of String(html || '').matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let url = Utils.decodeHtmlEntities(m[1]).trim();
      const text = Utils.stripMarkup(m[2]);
      if (!/^https?:\/\//i.test(url) || !JOB_LINK_PATTERN.test(url)) continue;
      if (text.length < 6 || text.length > 140 || /désabonn|unsubscribe|voir toutes|see all|paramètres|settings|afficher plus/i.test(text)) continue;
      const linkedIn = url.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
      if (linkedIn) url = `https://www.linkedin.com/jobs/view/${linkedIn[1]}`;
      const key = url.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ text, url });
      if (links.length >= MAX_JOB_LINKS_PER_EMAIL) break;
    }
    return links;
  };

  /**
   * Adresse e-mail de l'expéditeur (ex. "news@twistshake.com").
   * @param {string} fromRaw
   * @returns {string}
   */
  const senderAddress = (fromRaw) => {
    const m = String(fromRaw || '').match(/<([^>]+@[^>]+)>/) || String(fromRaw || '').match(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
    return m ? m[1].toLowerCase() : '';
  };


  /**
   * Objet d'un e-mail de position envoyé par l'utilisateur, ex. « Position : Genève ».
   * Ces e-mails servent uniquement à régler la ville de la météo : ils ne sont pas résumés.
   */
  const POSITION_SUBJECT = /^\s*(?:ma\s+)?position\s*(?:[:：-]\s*|\s+)([^:\s].{1,39}?)\s*[.!]*\s*$/i;

  /** Durée de validité d'une position déclarée (jours). */
  const POSITION_MAX_AGE_DAYS = 60;

  /**
   * Dernière position déclarée par l'utilisateur : e-mail dont l'objet est « Position : Ville »,
   * envoyé depuis l'un de ses comptes (Config.KNOWN_ACCOUNTS). Lecture seule, non bloquant.
   *
   * @returns {{city: string, date: Date}|null}
   */
  const findDeclaredPosition = () => {
    try {
      const own = Config.KNOWN_ACCOUNTS.map((a) => a.email.toLowerCase());
      const threads = GmailApp.search(`subject:position newer_than:${POSITION_MAX_AGE_DAYS}d -in:trash -in:spam`, 0, 15) || [];
      if (threads.length === 0) return null;
      let best = null;
      for (const messages of GmailApp.getMessagesForThreads(threads)) {
        for (const msg of messages || []) {
          const match = String(msg.getSubject() || '').match(POSITION_SUBJECT);
          if (!match || !own.includes(senderAddress(msg.getFrom()))) continue;
          const date = msg.getDate();
          if (!best || date.getTime() > best.date.getTime()) {
            // Code postal retiré (« Evreux 27000 » ou « 27000 Evreux » -> « Evreux »).
            const city = Utils.sanitizeText(match[1]).replace(/\b\d{4,5}\b/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '');
            if (/\p{L}{2,}/u.test(city)) best = { city, date };
          }
        }
      }
      if (best) console.log(`Position déclarée : ${best.city} (${best.date.toISOString()}).`);
      return best && best.city.length >= 2 ? best : null;
    } catch (error) {
      console.warn(`Position déclarée illisible : ${error.message}`);
      return null;
    }
  };

  /**
   * Organisme d'une adresse : domaine sans sous-domaine technique
   * (« cio35236.qonto.com » -> « qonto.com », « dgfip.finances.gouv.fr » -> « finances.gouv.fr »).
   * @param {string} address
   * @returns {string}
   */
  const organisationOf = (address) => {
    const domain = String(address || '').split('@')[1] || String(address || '');
    const parts = domain.toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const keep = /^(?:gouv|co|com|org|net|ac|asso)$/.test(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-keep).join('.');
  };

  /** Nombre de mails récents d'un dossier transmis à l'analyse IA. */
  const URGENT_CONTEXT_MESSAGES = 6;
  /** Longueur maximale du texte de chaque mail transmis à l'analyse IA. */
  const URGENT_CONTEXT_BODY_CHARS = 1500;
  /** PDF joints transmis à l'analyse IA (les plus récents), et taille maximale de chacun. */
  const URGENT_MAX_PDFS = 2;
  const URGENT_MAX_PDF_BYTES = 3 * 1024 * 1024;

  /**
   * Contenu d'un dossier pour l'analyse IA : derniers mails (texte abrégé) et PDF joints les plus récents
   * (les lettres d'huissier ou des impôts ne sont souvent que dans le PDF).
   *
   * @param {Array<GoogleAppsScript.Gmail.GmailMessage>} chronological - Mails du dossier, du plus ancien au plus récent.
   * @param {Array<string>} own - Adresses de l'utilisateur.
   * @returns {{messages: Array<Object>, pdfs: Array<{name: string, date: string, data: string}>}}
   */
  const buildUrgentContext = (chronological, own) => {
    const tz = Config.DEFAULTS.TIMEZONE;
    const recent = chronological.slice(-URGENT_CONTEXT_MESSAGES);
    const messages = recent.map((m) => {
      let body = '';
      try {
        body = m.getPlainBody() || '';
      } catch {}
      body = Utils.sanitizeText(body.replace(/\s+/g, ' '));
      let attachments = [];
      try {
        attachments = m.getAttachments({ includeInlineImages: false }).map((a) => a.getName());
      } catch {}
      return {
        date: Utilities.formatDate(m.getDate(), tz, 'dd/MM/yyyy'),
        de: own.includes(senderAddress(m.getFrom())) ? 'Vous (Kouroufia)' : Utils.cleanSenderName(m.getFrom()),
        objet: Utils.sanitizeText(m.getSubject() || ''),
        texte: body.length > URGENT_CONTEXT_BODY_CHARS ? `${body.slice(0, URGENT_CONTEXT_BODY_CHARS)}…` : body,
        piecesJointes: attachments
      };
    });

    const pdfs = [];
    for (const m of chronological.slice().reverse()) {
      if (pdfs.length >= URGENT_MAX_PDFS) break;
      let attachments = [];
      try {
        attachments = m.getAttachments({ includeInlineImages: false });
      } catch {}
      for (const a of attachments) {
        if (pdfs.length >= URGENT_MAX_PDFS) break;
        if (!/pdf/i.test(a.getContentType()) || a.getSize() > URGENT_MAX_PDF_BYTES) continue;
        pdfs.push({
          name: a.getName(),
          date: Utilities.formatDate(m.getDate(), tz, 'dd/MM/yyyy'),
          data: Utilities.base64Encode(a.getBytes())
        });
      }
    }
    return { messages, pdfs };
  };

  /**
   * Dossiers urgents en cours : fils rangés sous le libellé Config.DEFAULTS.URGENT_LABEL,
   * regroupés par organisme (huissier, Qonto, Urssaf, impôts…), du plus récent au plus ancien.
   * Lecture seule, non bloquant.
   *
   * @returns {{label: string, total: number, files: Array<Object>, extraCount: number}|null}
   */
  const getUrgentFiles = () => {
    const labelName = Config.DEFAULTS.URGENT_LABEL;
    try {
      const label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        console.log(`Dossiers urgents : libellé « ${labelName} » introuvable.`);
        return null;
      }
      const threads = label.getThreads(0, 40) || [];
      if (threads.length === 0) return { label: labelName, total: 0, files: [], extraCount: 0 };

      const own = Config.KNOWN_ACCOUNTS.map((a) => a.email.toLowerCase());
      const allMessages = GmailApp.getMessagesForThreads(threads);
      const byOrganisation = new Map();
      threads.forEach((thread, i) => {
        const messages = allMessages[i] || [];
        if (messages.length === 0) return;
        // Expéditeur = dernier message reçu d'un tiers (pas une de vos réponses).
        const external = messages.slice().reverse().find((m) => !own.includes(senderAddress(m.getFrom()))) || messages[messages.length - 1];
        const address = senderAddress(external.getFrom());
        const key = organisationOf(address) || Utils.cleanSenderName(external.getFrom()).toLowerCase();
        const lastDate = thread.getLastMessageDate();
        const entry = byOrganisation.get(key) || { key, sender: '', count: 0, unread: 0, lastDate: null, subject: '', threadId: '', messages: [] };
        entry.count += 1;
        messages.forEach((m) => entry.messages.push(m));
        if (thread.isUnread()) entry.unread += 1;
        if (!entry.lastDate || lastDate.getTime() > entry.lastDate.getTime()) {
          entry.lastDate = lastDate;
          entry.sender = Utils.cleanSenderName(external.getFrom()) || key;
          entry.subject = Utils.sanitizeText(thread.getFirstMessageSubject() || '(Sans objet)');
          entry.threadId = thread.getId();
        }
        byOrganisation.set(key, entry);
      });

      // Ancienneté en jours calendaires (fuseau du script) : « aujourd'hui », « hier », « il y a N jours ».
      const tz = Config.DEFAULTS.TIMEZONE;
      const today = Utils.dayNumber(new Date());
      const ageLabel = (d) => {
        const days = Math.max(0, today - Utils.dayNumber(d));
        return days === 0 ? 'aujourd’hui' : days === 1 ? 'hier' : `il y a ${days} jours`;
      };
      const max = Config.DEFAULTS.MAX_URGENT_FILES;
      const sorted = [...byOrganisation.values()].sort((a, b) => b.lastDate.getTime() - a.lastDate.getTime());
      const files = sorted.slice(0, max).map((e) => {
        const chronological = e.messages.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());
        const newest = chronological[chronological.length - 1];
        return {
          key: e.key,
          sender: e.sender,
          count: e.count,
          unread: e.unread,
          subject: e.subject,
          lastDate: e.lastDate,
          lastDateFormatted: Utilities.formatDate(e.lastDate, tz, 'dd/MM/yyyy'),
          ageLabel: ageLabel(e.lastDate),
          webUrl: Utils.buildEmailDetailsUrl(e.threadId),
          // Empreinte : change dès qu'un nouveau mail arrive dans le dossier (sert à la mémoire d'un jour sur l'autre).
          fingerprint: newest ? `${newest.getId()}|${chronological.length}` : '',
          // Lu seulement si le dossier doit être (ré)analysé : évite de relire mails et PDF chaque matin.
          loadContext: () => buildUrgentContext(chronological, own)
        };
      });
      console.log(`Dossiers urgents : ${threads.length} fil(s), ${sorted.length} organisme(s).`);
      return { label: labelName, total: threads.length, files, extraCount: Math.max(0, sorted.length - max) };
    } catch (error) {
      console.warn(`Dossiers urgents illisibles : ${error.message}`);
      return null;
    }
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
        if (POSITION_SUBJECT.test(subjectRaw)) continue; // réglage de la ville météo, pas un e-mail à résumer

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
          webUrl: Utils.buildEmailDetailsUrl(threadId),
          msgObj: msg
        });
      }
    });

    // 2. Du plus récent au plus ancien : la version la plus récente d'une campagne est conservée
    rawMessages.sort((a, b) => b.timestampSec - a.timestampSec);

    // 3. Déduplication pré-IA (avant les appels coûteux de lecture du corps).
    //    Le compteur « (N messages) » ne compte que des messages réellement différents :
    //    deux copies du même e-mail (transfert Outlook configuré en double) ne comptent qu'une fois.
    const deduplicated = [];
    const indexByKey = new Map();
    for (const item of rawMessages) {
      const key = buildDedupKey(item);
      const subjectKey = Utils.normalizeSubject(item.subject);
      if (indexByKey.has(key)) {
        const existing = deduplicated[indexByKey.get(key)];
        existing.distinctSubjects.add(subjectKey);
        existing.duplicateCount = existing.distinctSubjects.size;
        existing.senderDisplayName = existing.duplicateCount > 1
          ? `${existing.senderName} (${existing.duplicateCount} messages)`
          : existing.senderName;
      } else {
        item.distinctSubjects = new Set([subjectKey]);
        item.duplicateCount = 1;
        item.senderDisplayName = item.senderName;
        indexByKey.set(key, deduplicated.length);
        deduplicated.push(item);
      }
    }

    // 4. Corps, compte de destination, lien de désinscription et liens d'offres (messages conservés uniquement)
    for (const item of deduplicated) {
      const msg = item.msgObj;
      const jobPlatform = EmailClassifier.isJobPlatform(item);
      let plainBody = '';
      try {
        plainBody = msg.getPlainBody() || '';
      } catch {}
      let rawHtml = '';
      if (plainBody.trim().length < 25 || jobPlatform) {
        try {
          rawHtml = msg.getBody() || '';
        } catch {}
      }
      item.body = Utils.cleanEmailBody(plainBody.trim().length >= 25 ? plainBody : '', rawHtml);
      item.account = detectAccount(msg);
      item.senderEmail = senderAddress(item.from);
      item.jobLinks = jobPlatform ? extractJobLinks(rawHtml) : [];
      delete item.distinctSubjects;
      delete item.msgObj;
    }

    console.log(`${rawMessages.length} message(s) non lu(s) -> ${deduplicated.length} après déduplication.`);
    return deduplicated;
  };

  return {
    fetchUnreadEmails,
    findDeclaredPosition,
    getUrgentFiles
  };
})();
