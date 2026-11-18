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
  const ANALYSIS_VERSION = 5;
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
    const sentences = String(text).match(/[^.!?]+[.!?]*/g) || [String(text)];
    const kept = sentences.filter((s) => {
      const lower = s.toLowerCase();
      return !SENSITIVE_WORDS.some((re) => re.test(lower) && !re.test(sourceText));
    });
    return kept.join(' ').replace(/\s+/g, ' ').trim();
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
            pdfs: context.pdfs
          };
        });
        analyses = GeminiService.analyzeUrgentFiles(dossiers) || {};
        // Garde-fou : pas d'affirmation sensible absente des mails (dossiers sans PDF uniquement).
        for (const d of dossiers) {
          const a = analyses[d.key];
          if (!a || d.pdfs.length > 0) continue;
          const source = d.messages.map((m) => `${m.objet} ${m.texte}`).join(' ').toLowerCase();
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

      if (fresh) {
        try {
          props.setProperty(
            CACHE_PREFIX + file.key,
            JSON.stringify({ version: ANALYSIS_VERSION, fingerprint: file.fingerprint, firstSeenAt, analyzedAt: now, analysis: fresh })
          );
        } catch (error) {
          console.warn(`Dossiers urgents : mémoire non enregistrée pour ${file.key} — ${error.message}`);
        }
      }

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
        prochaineAction: analysis ? analysis.prochaineAction : '',
        montant: analysis ? analysis.montant : '',
        changement: isNew && analysis ? analysis.changement : '',
        deadline,
        lastTime
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
