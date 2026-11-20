/**
 * Google CC Briefing Agent
 * UrgentFilesService.js — Suivi vivant des « Dossiers urgents en cours ».
 *
 * Pour chaque organisme (huissier, impôts, Urssaf, banque…) du libellé « À traiter/1. Urgent » :
 * - l'IA lit les derniers mails ET les PDF joints, et dit où en est le dossier, quoi faire,
 *   avant quelle date et combien (GeminiService.analyzeUrgentFiles) ;
 * - une mémoire (propriétés du script) garde l'analyse d'un jour sur l'autre : un dossier n'est
 *   réanalysé que si un nouveau mail est arrivé, et ce qui a changé est signalé « Nouveau » ;
 * - l'alerte (Urgent / À surveiller / En attente / Réglé) se renforce quand l'échéance approche.
 * Jamais bloquant : sans IA, l'analyse de la veille ou une ligne simple est affichée.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const UrgentFilesService = (() => {
  /** Préfixe des entrées de mémoire (une propriété du script par dossier). */
  const CACHE_PREFIX = 'URGENT_FILE::';
  /** Version des consignes d'analyse : la changer force une nouvelle analyse de tous les dossiers. */
  const ANALYSIS_VERSION = 10;
  /** Un dossier reste marqué « Nouveau » pendant ce délai après l'arrivée d'un nouveau mail. */
  const NEW_BADGE_MS = 20 * 3600 * 1000;
  /** Au premier suivi (sans mémoire), un dossier est « Nouveau » si son dernier mail date de moins de 36 h. */
  const FIRST_RUN_NEW_MS = 36 * 3600 * 1000;
  /** Échéance à 7 jours ou moins : le dossier passe en « Urgent ». */
  const URGENT_DAYS = 7;

  /** Présentation de chaque niveau d'alerte (ordre = priorité d'affichage). */
  const LEVELS = Object.freeze({
    urgent: { label: 'Urgent', order: 0, bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' },
    a_surveiller: { label: 'À surveiller', order: 1, bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
    en_attente: { label: 'En attente', order: 2, bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
    regle: { label: 'Réglé', order: 3, bg: '#ECFDF5', color: '#047857', border: '#A7F3D0' }
  });

  /**
   * Lecture de la mémoire d'un dossier.
   * @param {GoogleAppsScript.Properties.Properties} props
   * @param {string} key
   * @returns {Object|null}
   */
  const readCache = (props, key) => {
    try {
      const raw = props.getProperty(CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  /** Mots sensibles qu'une analyse ne doit pas employer s'ils ne figurent pas dans les mails eux-mêmes. */
  const SENSITIVE_WORDS = Object.freeze(
    ['bloqu[a-zà-ÿ]*', 'cl[oô]tur[a-zà-ÿ]*', 'pay[ée]e?s?', 'r[ée]gl[ée]e?s?', 'annul[a-zà-ÿ]*', 'sold[ée]e?s?'].map(
      // Mot entier (les lettres accentuées comptent comme des lettres) : « payé » ne correspond pas à « impayés ».
      (w) => new RegExp(`(?:^|[^a-zà-ÿœ])${w}(?![a-zà-ÿœ])`, 'i')
    )
  );

  /**
   * Garde-fou contre les suppositions de l'IA : retire d'un texte les phrases qui emploient un mot
   * sensible absent des mails du dossier (ex. « votre compte est bloqué » alors que rien ne le dit).
   * Si le dossier contient des PDF, leur texte n'est pas lisible ici : le contrôle est alors ignoré.
   *
   * @param {string} text - Texte produit par l'IA.
   * @param {string} sourceText - Texte des mails du dossier (en minuscules).
   * @returns {string}
   */
  const removeUnsupportedClaims = (text, sourceText) => {
    if (!text) return text;
    // Découpe en phrases sur « . ! ? » suivis d'un espace (« impots.gouv.fr » reste intact).
    const sentences = String(text).split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = sentences.filter((s) => {
      const lower = s.toLowerCase();
      return !SENSITIVE_WORDS.some((re) => re.test(lower) && !re.test(sourceText));
    });
    return kept.join(' ').replace(/\s+/g, ' ').trim();
  };

  /**
   * Garde-fou des coordonnées : un téléphone ou un e-mail proposé par l'IA n'est gardé que s'il est
   * écrit dans les mails du dossier (ou si le dossier contient des PDF, que seule l'IA sait lire).
   * Les contacts sans aucune coordonnée, ou qui répètent la fiche officielle, sont retirés.
   *
   * @param {Array<Object>} contacts
   * @param {{source: string, addresses: Array<string>, hasPdf: boolean, official: Object|null}} ctx
   * @returns {Array<Object>}
   */
  const checkContacts = (contacts, ctx) =>
    (contacts || [])
      .map((raw) => {
        // Valeurs de remplissage (« Non communiquée », « inconnu », « - ») = champ vide.
        const c = {};
        Object.keys(raw).forEach((k) => {
          const v = String(raw[k] || '').trim();
          c[k] = /^(?:non\s+communiqu[ée]e?s?|non\s+pr[ée]cis[ée]e?s?|inconnue?s?|aucune?|n\/?a|-+|\.+)$/i.test(v) ? '' : v;
        });
        // Ce qui répète la fiche officielle est retiré (elle est déjà affichée).
        if (ctx.official && ctx.official.email && c.email === ctx.official.email.toLowerCase()) c.email = '';
        return c;
      })
      .map((c) => {
        const phoneOk = c.telephone && (ctx.hasPdf ? Utils.telHref(c.telephone) !== '' : Utils.phoneInText(c.telephone, ctx.source));
        const emailValid = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}$/i.test(c.email || '');
        const emailOk = emailValid && (ctx.hasPdf || ctx.addresses.includes(c.email) || ctx.source.includes(c.email));
        const samePhoneAsOfficial = ctx.official && Utils.phoneDigits(c.telephone) === Utils.phoneDigits(ctx.official.phone);
        return Object.assign({}, c, {
          telephone: phoneOk && !samePhoneAsOfficial ? c.telephone : '',
          horaires: phoneOk ? c.horaires : '',
          email: emailOk ? c.email : '',
          site: /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/i.test(c.site || '') ? c.site : ''
        });
      })
      // Un site seul ne suffit pas : il faut un moyen de joindre quelqu'un (téléphone, e-mail ou adresse).
      .filter((c) => c.telephone || c.email || c.adresse);

  /**
   * Destinataire du brouillon : uniquement une adresse réellement liée au dossier, sinon vide
   * (vous le choisirez vous-même, par exemple pour une messagerie sécurisée).
   */
  const checkRecipient = (address, ctx) => {
    const a = String(address || '').toLowerCase();
    if (!/^[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}$/.test(a)) return '';
    if (/(?:no-?reply|ne-?pas-?repondre|donotreply|notification)/.test(a)) return '';
    const official = ctx.official && ctx.official.email ? ctx.official.email.toLowerCase() : '';
    return ctx.addresses.includes(a) || a === official || ctx.source.includes(a) || ctx.hasPdf ? a : '';
  };

  /** Empreinte du texte d'un brouillon (espaces ignorés) : sert à savoir si vous l'avez modifié. */
  const bodyHash = (text) =>
    Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text || '').replace(/\s+/g, ''), Utilities.Charset.UTF_8)
    );

  /**
   * Brouillon Gmail toujours présent (ni envoyé, ni supprimé) ?
   * @param {string} id
   * @returns {GoogleAppsScript.Gmail.GmailDraft|null}
   */
  const findDraft = (id) => {
    if (!id) return null;
    try {
      return GmailApp.getDraft(id) || null;
    } catch {
      return null;
    }
  };

  /**
   * Crée (ou met à jour) le brouillon Gmail d'un dossier. Jamais envoyé automatiquement.
   * Un brouillon que vous avez modifié n'est jamais écrasé.
   *
   * @param {Object|null} previous - Brouillon déjà créé pour ce dossier ({id, hash, …}).
   * @param {{destinataire: string, objet: string, corps: string, pointsAjoutes: Array<string>}} wanted
   * @returns {{draft: Object|null, pending: Object|null}} pending = à recréer plus tard (ex. autorisation manquante).
   */
  const saveDraft = (previous, wanted) => {
    const describe = (id) => ({
      id,
      hash: bodyHash(wanted.corps),
      to: wanted.destinataire,
      subject: wanted.objet,
      pointsAjoutes: wanted.pointsAjoutes,
      savedAt: Date.now()
    });
    try {
      const existing = previous && previous.id ? findDraft(previous.id) : null;
      if (existing) {
        let untouched = false;
        try {
          untouched = bodyHash(existing.getMessage().getPlainBody()) === previous.hash;
        } catch {}
        if (!untouched) return { draft: Object.assign({}, previous, { userEdited: true }), pending: null };
        existing.update(wanted.destinataire || '', wanted.objet, wanted.corps);
        return { draft: describe(previous.id), pending: null };
      }
      const created = GmailApp.createDraft(wanted.destinataire || '', wanted.objet, wanted.corps);
      console.log(`Dossiers urgents : brouillon préparé (« ${wanted.objet} »).`);
      return { draft: describe(created.getId()), pending: null };
    } catch (error) {
      console.warn(`Dossiers urgents : brouillon non créé — ${error.message}`);
      return { draft: null, pending: wanted };
    }
  };

  /**
   * Partie « Comment faire » d'un dossier, prête pour l'affichage.
   * @param {Object|null} analysis
   * @param {Object|null} official
   * @param {Object|null} draft
   * @returns {Object|null}
   */
  const buildHelp = (analysis, official, draft) => {
    // Liens prêts à l'emploi (chiffres et adresses déjà contrôlés : affichés tels quels dans le modèle).
    const mailHref = (e) => (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}$/i.test(e || '') ? `mailto:${e}` : '');
    const contacts = ((analysis && analysis.contacts) || []).map((c) =>
      Object.assign({}, c, { tel: Utils.telHref(c.telephone), mail: mailHref(c.email) })
    );
    const help = {
      official: official ? Object.assign({}, official, { tel: Utils.telHref(official.phone), mail: mailHref(official.email) }) : null,
      contacts,
      references: (analysis && analysis.references) || '',
      etapes: (analysis && analysis.etapes) || [],
      aPreparer: (analysis && analysis.aPreparer) || [],
      draft: draft
        ? { to: draft.to || '', subject: draft.subject || '', pointsAjoutes: draft.pointsAjoutes || [], userEdited: Boolean(draft.userEdited) }
        : null
    };
    const empty = !help.official && contacts.length === 0 && !help.references && help.etapes.length === 0 && !help.draft;
    return empty ? null : help;
  };

  /**
   * Libellé de l'échéance par rapport à aujourd'hui.
   * @param {string} iso - AAAA-MM-JJ.
   * @returns {{formatted: string, label: string, days: number}|null}
   */
  const describeDeadline = (iso) => {
    if (!iso) return null;
    const date = new Date(`${iso}T12:00:00`);
    if (isNaN(date.getTime())) return null;
    const days = Utils.dayNumber(date) - Utils.dayNumber(new Date());
    let label;
    if (days < -1) label = `dépassée depuis ${-days} jours`;
    else if (days === -1) label = 'dépassée depuis hier';
    else if (days === 0) label = 'aujourd’hui';
    else if (days === 1) label = 'demain';
    else label = `dans ${days} jours`;
    return { formatted: Utilities.formatDate(date, Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy'), label, days };
  };

  const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
    'octobre', 'novembre', 'décembre'];

  /**
   * Retire de « À faire » la date limite que le briefing affiche déjà juste à côté
   * (« au plus tard le 30/11/2026 », « avant le 30 novembre »…), pour ne pas l'écrire deux fois.
   *
   * @param {string} text - Prochaine action rédigée par l'IA.
   * @param {string} iso - Échéance AAAA-MM-JJ.
   * @returns {string}
   */
  const withoutDeadline = (text, iso) => {
    if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return text || '';
    const [y, m, d] = iso.split('-');
    const day = String(Number(d));
    const date = `(?<![\\d/])(?:${d}|${day})(?:\\s*\\/\\s*${m}(?:\\s*\\/\\s*${y})?|\\s+${MONTHS_FR[Number(m) - 1]}(?:\\s+${y})?)(?!\\d)`;
    const re = new RegExp(`[,;]?\\s*(?:au plus tard|avant|d['’]ici|jusqu['’]au|pour)?\\s*(?:le\\s+)?${date}`, 'gi');
    const out = text.replace(re, '')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[\s.,;:]+$/, '');
    return out.length >= 10 ? out : text;
  };

  /**
   * Enrichit les dossiers urgents (analyse IA + mémoire + alertes) et les trie par priorité.
   *
   * @param {{label: string, total: number, files: Array<Object>, extraCount: number}|null} urgent
   *   Résultat de GmailService.getUrgentFiles().
   * @param {Object} [options]
   * @param {boolean} [options.analyze=false] - Lance l'analyse IA des dossiers qui ont bougé. Le briefing
   *   ne l'active jamais (lecture de la mémoire seulement) : l'analyse, plus longue, tourne dans
   *   preparerDossiersUrgents() pour ne jamais retarder ni bloquer l'envoi du briefing.
   * @returns {Object|null} Même objet, dossiers enrichis et triés, prêt pour l'affichage.
   */
  const enrich = (urgent, options) => {
    const allowAnalysis = Boolean(options && options.analyze);
    if (!urgent || !urgent.files || urgent.files.length === 0) return urgent;
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();

    // 1. Mémoire : quels dossiers ont reçu un nouveau mail depuis la dernière analyse ?
    const states = urgent.files.map((file) => {
      const cache = readCache(props, file.key);
      const changed = !cache || cache.fingerprint !== file.fingerprint || cache.version !== ANALYSIS_VERSION;
      return { file, cache, changed };
    });

    // 2. Analyse IA, uniquement pour les dossiers qui ont bougé (un seul appel, PDF compris).
    const toAnalyze = states.filter((s) => s.changed);
    let analyses = {};
    if (allowAnalysis && toAnalyze.length > 0) {
      try {
        const dossiers = toAnalyze.map((s) => {
          const context = s.file.loadContext();
          return {
            key: s.file.key,
            organisme: s.file.sender,
            etatPrecedent: s.cache && s.cache.analysis ? s.cache.analysis.etat : '',
            messages: context.messages,
            pdfs: context.pdfs,
            addresses: context.addresses || [],
            official: OfficialContacts.forKey(s.file.key)
          };
        });
        analyses = GeminiService.analyzeUrgentFiles(dossiers) || {};
        for (const d of dossiers) {
          const a = analyses[d.key];
          if (!a) continue;
          const source = d.messages
            .map((m) => `${m.objet} ${m.texte} ${(m.telephonesDuMail || []).join(' ')} ${(m.emailsDuMail || []).join(' ')}`)
            .join(' ')
            .toLowerCase();
          // Garde-fou des coordonnées et du destinataire (jamais un numéro ou une adresse inventés).
          const ctx = { source, addresses: d.addresses, hasPdf: d.pdfs.length > 0, official: d.official };
          a.contacts = checkContacts(a.contacts, ctx);
          if (a.brouillon) a.brouillon.destinataire = checkRecipient(a.brouillon.destinataire, ctx);
          // Garde-fou : pas d'affirmation sensible absente des mails (dossiers sans PDF uniquement).
          if (d.pdfs.length > 0) continue;
          a.etat = removeUnsupportedClaims(a.etat, source);
          a.changement = removeUnsupportedClaims(a.changement, source);
          a.prochaineAction = removeUnsupportedClaims(a.prochaineAction, source);
        }
        console.log(`Dossiers urgents : ${Object.keys(analyses).length}/${toAnalyze.length} dossier(s) réanalysé(s).`);
      } catch (error) {
        console.warn(`Dossiers urgents : analyse IA impossible — ${error.message}`);
      }
    }

    // 3. Fusion, mise à jour de la mémoire et calcul des alertes.
    const files = states.map(({ file, cache, changed }) => {
      const fresh = analyses[file.key] || null;
      let analysis = fresh || (cache && cache.analysis) || null;
      // Nouveau mail pas encore analysé (une simple mise à jour des consignes ne compte pas).
      const stale = Boolean(!fresh && analysis && cache && cache.fingerprint !== file.fingerprint);
      // Moment où le dernier mail du dossier a été vu pour la première fois par l'assistant :
      // - même mail que dans la mémoire : date déjà notée ;
      // - mémoire à jour mais mail différent : un nouveau mail vient d'arriver, donc maintenant ;
      // - pas de mémoire (premier suivi) ou mémoire d'une ancienne version : date du mail lui-même.
      const lastTime = file.lastDate ? file.lastDate.getTime() : 0;
      const currentMemory = Boolean(cache) && cache.version === ANALYSIS_VERSION;
      let firstSeenAt;
      if (currentMemory && cache.fingerprint === file.fingerprint && cache.firstSeenAt) firstSeenAt = cache.firstSeenAt;
      else if (currentMemory) firstSeenAt = now;
      else firstSeenAt = lastTime || now;

      // Brouillon Gmail : préparé lors d'une nouvelle analyse, ou réessayé s'il n'avait pas pu être créé.
      let draft = (cache && cache.draft) || null;
      let pendingDraft = (cache && cache.pendingDraft) || null;
      let draftJustSaved = false;
      if (fresh) {
        pendingDraft = null;
        if (fresh.brouillon) {
          const saved = saveDraft(draft, fresh.brouillon);
          draft = saved.draft;
          pendingDraft = saved.pending;
          draftJustSaved = Boolean(saved.draft);
        } else {
          draft = null; // plus de mail à envoyer : l'ancien brouillon éventuel reste dans Gmail, mais n'est plus proposé
        }
      } else if (allowAnalysis && pendingDraft && cache) {
        const saved = saveDraft(draft, pendingDraft);
        draft = saved.draft || draft;
        pendingDraft = saved.pending;
        draftJustSaved = Boolean(saved.draft);
      }

      if (fresh || draftJustSaved) {
        // La mémoire garde l'analyse sans le texte du brouillon (déjà dans Gmail), sauf s'il reste à créer.
        const stored = fresh ? Object.assign({}, fresh, { brouillon: null }) : cache.analysis;
        try {
          props.setProperty(
            CACHE_PREFIX + file.key,
            JSON.stringify({
              version: fresh ? ANALYSIS_VERSION : cache.version,
              fingerprint: fresh ? file.fingerprint : cache.fingerprint,
              firstSeenAt,
              analyzedAt: fresh ? now : cache.analyzedAt,
              analysis: stored,
              draft,
              pendingDraft
            })
          );
        } catch (error) {
          console.warn(`Dossiers urgents : mémoire non enregistrée pour ${file.key} — ${error.message}`);
        }
      }
      // Affiché seulement s'il est toujours dans vos Brouillons (ni envoyé, ni supprimé).
      const visibleDraft = draft && (draftJustSaved || findDraft(draft.id)) ? draft : null;

      // « Nouveau » : le dernier mail a été vu récemment (ou, au premier suivi, reçu depuis moins de 36 h).
      const isNew = now - firstSeenAt < (currentMemory ? NEW_BADGE_MS : FIRST_RUN_NEW_MS);
      const deadline = analysis ? describeDeadline(analysis.echeance) : null;
      let level = analysis ? analysis.niveau : 'a_surveiller';
      if (deadline && level !== 'regle' && deadline.days <= URGENT_DAYS) level = 'urgent';
      if (!analysis && file.unread > 0) level = 'urgent';
      const style = LEVELS[level] || LEVELS.a_surveiller;

      const view = Object.assign({}, file, {
        level,
        levelLabel: style.label,
        levelOrder: style.order,
        levelStyle: style,
        isNew,
        stale,
        etat: analysis ? analysis.etat : '',
        prochaineAction: !analysis ? ''
          : (deadline ? withoutDeadline(analysis.prochaineAction, analysis.echeance) : analysis.prochaineAction),
        montant: analysis ? analysis.montant : '',
        changement: isNew && analysis ? analysis.changement : '',
        deadline,
        lastTime,
        help: level === 'regle' ? null : buildHelp(analysis, OfficialContacts.forKey(file.key), visibleDraft)
      });
      delete view.loadContext;
      delete view.lastDate;
      return view;
    });

    // 4. Priorité : niveau d'alerte, puis échéance la plus proche, puis mail le plus récent.
    const order = (f) => (f.deadline ? f.deadline.days : 9999);
    files.sort((a, b) => a.levelOrder - b.levelOrder || order(a) - order(b) || b.lastTime - a.lastTime);

    const newCount = files.filter((f) => f.isNew).length;
    const urgentCount = files.filter((f) => f.level === 'urgent').length;
    return Object.assign({}, urgent, { files, newCount, urgentCount });
  };

  return {
    enrich
  };
})();
