/**
 * Google CC Briefing Agent
 * GeminiService.js — Accès unique à l'API Google Gemini : cascade de modèles, budget temps,
 * sortie JSON structurée, et trois usages métier (e-mails, météo, actualités).
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const GeminiService = (() => {
  /** Modèle ayant répondu avec succès pendant cette exécution (réessayé en premier). */
  let activeWorkingModel = null;
  /** Modèles ayant atteint leur quota (HTTP 429) pendant cette exécution. */
  const exhaustedModels = new Set();
  /** Modèles introuvables (HTTP 404) pendant cette exécution. */
  const unavailableModels = new Set();

  const cleanModelName = (model) => String(model || '').replace(/^models\//, '').trim();

  /**
   * Transmet un incident à l'Agent de Contrôle (jamais bloquant).
   * @param {Object} incident
   */
  const notifyIncident = (incident) => {
    try {
      DevOpsAgentService.recordIncident(incident);
    } catch {}
  };

  /**
   * Cascade ordonnée, dédupliquée, sans les modèles épuisés ou introuvables.
   * Le dernier modèle ayant fonctionné est placé en tête.
   * @returns {Array<string>}
   */
  const getModelCascade = () => {
    const ordered = [
      activeWorkingModel,
      Config.getGeminiModel(),
      Config.DEFAULTS.GEMINI_FALLBACK_MODEL,
      ...Config.GEMINI_MODEL_CASCADE
    ]
      .map(cleanModelName)
      .filter(Boolean);
    const unique = [...new Set(ordered)].filter((m) => !exhaustedModels.has(m) && !unavailableModels.has(m));
    return unique.length > 0 ? unique : [Config.DEFAULTS.GEMINI_MODEL];
  };

  /**
   * Configuration de génération adaptée au modèle (désactivation du raisonnement hors « lite »).
   * @param {string} model
   * @param {Object} overrides
   * @returns {Object}
   */
  const buildGenerationConfig = (model, overrides) => {
    const config = Object.assign(
      { temperature: Config.DEFAULTS.TEMPERATURE, maxOutputTokens: Config.DEFAULTS.MAX_OUTPUT_TOKENS },
      overrides || {}
    );
    if (!model.includes('lite')) {
      config.thinkingConfig = { thinkingBudget: 0 };
    }
    return config;
  };

  /**
   * Appel HTTP unique à un modèle. La clé transite par l'en-tête x-goog-api-key (jamais dans l'URL).
   *
   * @param {string} model - Modèle ciblé.
   * @param {string} apiKey - Clé API.
   * @param {string} prompt - Texte complet envoyé.
   * @param {Object} generationOverrides - Paramètres de génération spécifiques.
   * @returns {string} Texte du premier candidat.
   * @throws {Error} Erreur portant `statusCode` (0 = réseau).
   */
  const requestModel = (model, apiKey, prompt, generationOverrides) => {
    const url = `${Config.DEFAULTS.GEMINI_API_BASE_URL}/${model}:generateContent`;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: buildGenerationConfig(model, generationOverrides)
    };

    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (netErr) {
      const err = new Error(`Échec réseau vers Gemini : ${netErr.message}`);
      err.statusCode = 0;
      throw err;
    }

    const statusCode = response.getResponseCode();
    const body = response.getContentText();
    if (statusCode !== 200) {
      let message = body.substring(0, 200);
      try {
        message = JSON.parse(body)?.error?.message || message;
      } catch {}
      const err = new Error(`HTTP ${statusCode} : ${Utils.redactSensitive(message)}`);
      err.statusCode = statusCode;
      throw err;
    }

    const text = JSON.parse(body)?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const err = new Error('Réponse Gemini vide.');
      err.statusCode = 502;
      throw err;
    }
    return text;
  };

  /**
   * Génération avec cascade de modèles et respect strict du budget temps global.
   *
   * @param {Object} params
   * @param {string} params.prompt - Prompt complet.
   * @param {Object} [params.generationConfig] - Paramètres de génération.
   * @param {string} params.purpose - Usage (pour les journaux).
   * @param {number} [params.maxModels] - Nombre maximal de modèles essayés.
   * @param {number} [params.minRemainingMs] - Temps global minimal requis avant chaque essai.
   * @returns {string|null} Texte généré ou null (repli à la charge de l'appelant).
   */
  const generate = ({ prompt, generationConfig, purpose, maxModels, minRemainingMs = 20000 }) => {
    if (!Config.hasGeminiApiKey()) return null;
    const apiKey = Config.getGeminiApiKey();
    const cascade = getModelCascade().slice(0, maxModels || Config.DEFAULTS.MAX_MODELS_PER_CALL);

    for (let i = 0; i < cascade.length; i++) {
      if (!Utils.hasTimeFor(minRemainingMs)) {
        console.warn(`Gemini (${purpose}) : budget temps insuffisant, repli automatique.`);
        return null;
      }
      const model = cascade[i];
      try {
        const text = requestModel(model, apiKey, prompt, generationConfig);
        activeWorkingModel = model;
        if (i > 0) {
          notifyIncident({
            component: 'Service de résumé automatique',
            severity: 'INFO',
            resolved: true,
            message: 'Le service de résumé principal était momentanément très sollicité.',
            solution: 'Relais automatique sur un service de secours, sans aucune coupure.'
          });
        }
        return text;
      } catch (error) {
        const code = error.statusCode || 0;
        console.warn(`Gemini (${purpose}) : modèle ${model} indisponible — ${Utils.redactSensitive(error.message)}`);

        if (code === 401 || code === 403) {
          notifyIncident({
            component: 'Service de résumé automatique',
            severity: 'CRITICAL',
            resolved: false,
            message: 'La clé d’accès au service de résumé a été refusée.',
            solution: 'Votre briefing a été préparé en mode simplifié. Remplacez la clé GEMINI_API_KEY dans les Propriétés du script pour retrouver les résumés détaillés.'
          });
          return null;
        }
        if (code === 429) exhaustedModels.add(model);
        if (code === 404) unavailableModels.add(model);
        if (code >= 500 && i < cascade.length - 1) {
          Utilities.sleep(Math.min(1500, Math.max(0, Utils.remainingMs() - minRemainingMs)));
        }
      }
    }
    return null;
  };

  /**
   * Analyse JSON tolérante (blocs ```json, caractères de contrôle).
   * @param {string} text
   * @returns {*} Objet analysé ou null.
   */
  const parseJson = (text) => {
    if (!text) return null;
    const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      try {
        return JSON.parse(cleaned.replace(/[\u0000-\u001F]+/g, ' '));
      } catch {
        return null;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 1. Analyse des e-mails
  // ---------------------------------------------------------------------------

  /**
   * Prompt d'analyse des e-mails, construit à partir de la taxonomie canonique de Config.
   * @returns {string}
   */
  const buildEmailPrompt = () => {
    const C = Config.EMAIL_CATEGORY;
    const today = Utils.formatDateFrench(new Date());
    const taxonomy = Config.EMAIL_CATEGORIES.map((c) => `   - '${c.name}' : ${c.hint}`).join('\n');
    return [
      "Tu es l'analyste exécutif en chef de 'Mon Briefing Quotidien'. Produis une synthèse de très haute précision, fluide et 100 % en français pour chaque e-mail.",
      `Date du jour : ${today} (fuseau Europe/Paris).`,
      '',
      'RÈGLES DE RÉDACTION STRICTES :',
      '',
      '1. DÉSAMBIGUÏSATION DES E-MAILS LINKEDIN (CRITIQUE) :',
      "   - Invitations et demandes de connexion ('invitation', 'connecter', 'rejoindre votre réseau', \"j'attends votre réponse\", 'invites you to connect') :",
      `     catégorie OBLIGATOIRE '${C.SOCIAL}' (JAMAIS '${C.JOBS}'). Résumé obligatoire : 'Invitation de **[Nom de la personne]** à rejoindre votre réseau professionnel.'`,
      `   - Vraies offres d'emploi ('offre d'emploi', 'recrute', 'poste de', 'jobs', 'hiring') : catégorie OBLIGATOIRE '${C.JOBS}', résumé précis avec termes clés en gras.`,
      `   - Articles et actualités partagés sur LinkedIn : catégorie OBLIGATOIRE '${C.NEWS}', synthèse en 1 phrase active.`,
      '',
      '2. ACTIONS PRIORITAIRES (actionRequired = true) :',
      '   - UNIQUEMENT si une décision ou une action humaine est requise (confirmer un rendez-vous, payer une facture, transmettre un justificatif, signer un document).',
      "   - 'actionTitle' au format strict '[Expéditeur / Organisme] — [Sujet précis et enjeu]' (ex. 'CAF — Justificatif de ressources à transmettre', 'Qare — Consultation médicale de suivi').",
      "   - 'deadline' : date et heure précises tirées de l'e-mail (ex. '18/11 à 09h00', 'Aujourd'hui 18h') ou null. N'invente JAMAIS une date absente de l'e-mail.",
      "   - 'summary' : l'instruction concrète en 1 phrase active (quoi faire et pourquoi).",
      '',
      `3. PLATEFORMES D'EMPLOI : tout e-mail de Michael Page, Meteojob, HelloWork, Apec, Indeed ou mentionnant 'Finance & Accounting', 'Fiduciaire', 'Comptable', 'Treuhand' va dans '${C.JOBS}'.`,
      '',
      '4. TRADUCTION OBLIGATOIRE EN FRANÇAIS des intitulés allemands ou anglais :',
      "   - 'Sachbearbeiter/in Treuhand & Administration (m/w/d)' -> 'Collaborateur en fiduciaire et administration (H/F)'",
      "   - 'New Jobs for: Finance & Accounting: Genève' -> 'Nouvelles offres d'emploi en finance et comptabilité à Genève'",
      "   - Remplace systématiquement '(m/w/d)' par '(H/F)'.",
      '',
      '5. INTERDICTIONS : ne commence JAMAIS par "[Expéditeur] vous a envoyé un e-mail", n\'écris JAMAIS "Aucune action requise", aucune entité HTML (&amp;, &#039;), aucun symbole $, aucun emoji.',
      '',
      '6. TAXONOMIE STRICTE (choisis exactement un de ces libellés) :',
      taxonomy
    ].join('\n');
  };

  /**
   * Schéma JSON imposé à Gemini pour l'analyse des e-mails.
   * @returns {Object}
   */
  const buildEmailSchema = () => ({
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        emailId: { type: 'STRING' },
        category: { type: 'STRING', enum: Config.EMAIL_CATEGORIES.map((c) => c.name) },
        summary: { type: 'STRING', description: '1 phrase concise et active en français avec termes clés en gras (**)' },
        actionRequired: { type: 'BOOLEAN' },
        actionTitle: { type: 'STRING', description: "Format strict : '[Expéditeur] — [Sujet et enjeu précis]' ou vide" },
        deadline: { type: 'STRING', description: "Échéance tirée de l'e-mail (ex. '18/11 à 09h00') ou vide" },
        estimatedMinutes: { type: 'INTEGER', description: "Durée estimée de l'action en minutes" }
      },
      required: ['emailId', 'category', 'summary', 'actionRequired']
    }
  });

  /**
   * Normalise une analyse IA brute.
   * @param {Object} item
   * @returns {Object}
   */
  const normalizeEmailAnalysis = (item) => {
    const deadline = Utils.sanitizeText(item.deadline);
    const minutes = parseInt(item.estimatedMinutes, 10);
    return {
      category: Config.normalizeEmailCategory(item.category),
      summary: Utils.sanitizeText(item.summary) || 'Nouvelles informations partagées.',
      actionRequired: Boolean(item.actionRequired),
      actionTitle: Utils.sanitizeText(item.actionTitle) || (item.actionRequired ? 'Action requise' : ''),
      deadline: deadline && !/^(null|aucune?|none|n\/a)$/i.test(deadline) ? deadline : null,
      estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 5
    };
  };

  /**
   * Analyse un lot d'e-mails en un seul appel.
   * @param {Array<Object>} batch
   * @returns {Object<string, Object>|null} Map emailId -> analyse, ou null si échec.
   */
  const analyzeBatch = (batch) => {
    const emailsPayload = batch.map((msg) => {
      const max = Config.DEFAULTS.MAX_SNIPPET_CHARS;
      const body = String(msg.body || '');
      return {
        emailId: msg.id,
        expediteur: Utils.sanitizeText(msg.senderDisplayName || msg.senderName),
        objet: Utils.sanitizeText(msg.subject),
        date: `${msg.dateFormatted} ${msg.timeFormatted}`,
        nombreMessages: msg.duplicateCount || 1,
        contenuAbrege: Utils.sanitizeText(body.length > max ? `${body.substring(0, max)}...` : body)
      };
    });

    const text = generate({
      purpose: 'analyse des e-mails',
      prompt: `${buildEmailPrompt()}\n\nVoici les e-mails à analyser :\n${JSON.stringify(emailsPayload)}`,
      generationConfig: {
        maxOutputTokens: Config.DEFAULTS.MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
        responseSchema: buildEmailSchema()
      },
      minRemainingMs: Config.DEFAULTS.RESERVE_AFTER_EMAILS_MS
    });

    const parsed = parseJson(text);
    if (!Array.isArray(parsed)) return null;
    const map = {};
    for (const item of parsed) {
      if (item && item.emailId) map[item.emailId] = normalizeEmailAnalysis(item);
    }
    return map;
  };

  /**
   * Enrichit chaque e-mail (catégorie, résumé, action, échéance) par lots,
   * avec repli déterministe (EmailClassifier) pour tout e-mail non couvert.
   *
   * @param {Array<Object>} emailsList - E-mails dédupliqués.
   * @returns {Array<Object>} E-mails enrichis.
   */
  const analyzeEmails = (emailsList) => {
    if (!emailsList || emailsList.length === 0) return [];

    const withFallback = (msg) => Object.assign({}, msg, EmailClassifier.buildFallbackAnalysis(msg));

    if (!Config.hasGeminiApiKey()) {
      console.warn('Clé Gemini absente : analyse des e-mails en mode de repli.');
      return emailsList.map(withFallback);
    }

    const batchSize = Config.DEFAULTS.BATCH_SIZE;
    const analysisBudget = Math.min(
      Config.DEFAULTS.EMAIL_ANALYSIS_MAX_MS,
      Utils.remainingMs() - Config.DEFAULTS.RESERVE_AFTER_EMAILS_MS
    );
    const deadline = Date.now() + Math.max(0, analysisBudget);
    const results = [];
    let fallbackCount = 0;

    for (let i = 0; i < emailsList.length; i += batchSize) {
      const batch = emailsList.slice(i, i + batchSize);

      if (Date.now() >= deadline) {
        console.warn(`Budget d'analyse atteint : repli pour ${emailsList.length - i} e-mail(s) restant(s).`);
        notifyIncident({
          component: 'Vitesse de traitement des e-mails',
          severity: 'INFO',
          resolved: true,
          message: 'Un grand nombre d’e-mails est arrivé depuis le dernier briefing.',
          solution: 'Les derniers e-mails ont été résumés de façon simplifiée pour vous livrer le briefing à l’heure.'
        });
        emailsList.slice(i).forEach((msg) => results.push(withFallback(msg)));
        fallbackCount += emailsList.length - i;
        break;
      }

      console.log(`Analyse Gemini du lot ${Math.floor(i / batchSize) + 1}/${Math.ceil(emailsList.length / batchSize)} (${batch.length} e-mails)...`);
      const analysis = analyzeBatch(batch) || {};
      for (const msg of batch) {
        if (analysis[msg.id]) {
          results.push(Object.assign({}, msg, analysis[msg.id]));
        } else {
          results.push(withFallback(msg));
          fallbackCount++;
        }
      }
    }

    if (fallbackCount > 0 && fallbackCount === emailsList.length) {
      notifyIncident({
        component: 'Service de résumé automatique',
        severity: 'WARNING',
        resolved: true,
        message: 'Le service de résumé n’a pas répondu ce matin.',
        solution: 'Vos e-mails ont été classés et résumés en mode simplifié : rien n’a été perdu.'
      });
    }
    return results;
  };

  // ---------------------------------------------------------------------------
  // 2. Météo
  // ---------------------------------------------------------------------------

  /**
   * Rédige le bulletin météo et le conseil vestimentaire (format AGENTS.md).
   * @param {string} rawWeatherContext - Données météo structurées.
   * @param {string} city - Ville retenue.
   * @returns {string|null} Texte du bulletin, ou null (repli déterministe côté WeatherService).
   */
  const generateWeatherAdvice = (rawWeatherContext, city) => {
    if (!rawWeatherContext) return null;
    const prompt = [
      'Tu es un assistant pratique et direct.',
      `Rédige un bulletin météo très court pour ${city}, en allant à la ligne pour chaque moment de la journée : le matin (9h), l'après-midi (15h) et le soir (21h).`,
      `Commence OBLIGATOIREMENT par la ligne : '**Pour ${city} :**'`,
      'Donne la température, le risque de pluie et un conseil vestimentaire simple (t-shirt, pull, veste, manteau, parapluie).',
      "FORMAT DES CHIFFRES OBLIGATOIRE : températures en chiffres avec une espace avant '°C' (ex. '10 °C'), risques de pluie en chiffres avec '%' collé (ex. '29%'). N'écris JAMAIS 'degrés' ni 'pour cent' en toutes lettres. Aucun emoji.",
      'FORMAT EXACT ATTENDU :',
      `**Pour ${city} :**`,
      '• **Matin (9h) :** Il fera 10 °C avec 29% de risque de pluie, prévoyez une petite veste.',
      "• **Après-midi (15h) :** 22 °C et 5% de risque de pluie, un t-shirt suffira.",
      '• **Soir (21h) :** 14 °C et 80% de risque d’averses, prenez un parapluie si vous sortez.',
      '',
      `Données brutes :\n${rawWeatherContext}`
    ].join('\n');

    const text = generate({
      purpose: 'météo',
      prompt,
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
      maxModels: 3,
      minRemainingMs: 60000
    });
    return text ? Utils.sanitizeText(text) : null;
  };

  // ---------------------------------------------------------------------------
  // 3. Actualités (HugoDécrypte + Google Actualités)
  // ---------------------------------------------------------------------------

  /**
   * Prompt du digest d'actualités (règles anti-vague AGENTS.md).
   * @param {boolean} hasHugoSource - Indique si une édition HugoDécrypte réelle est disponible.
   * @returns {string}
   */
  const buildNewsPrompt = (hasHugoSource) => {
    const categoryLines = Config.NEWS_CATEGORIES.map((c, idx) => `     ${idx + 1}) "${c.name}"`).join('\n');
    return [
      'Tu es un journaliste vulgarisateur d’élite pour un briefing exécutif matinal.',
      'Résume l’actualité comme pour un jeune curieux de 15 ans, en livrant 100 % des faits concrets (qui, quoi, ville précise, pourquoi, impact) en phrases courtes, pour pouvoir en discuter sans chercher ailleurs.',
      '',
      'RÈGLES ANTI-VAGUE (STRICTES ET OBLIGATOIRES) :',
      '1. SIGLES, ENTREPRISES ET TERMES EXPLIQUÉS : chaque sigle, entreprise, organisation ou terme technique est immédiatement expliqué entre parenthèses en mots simples.',
      '   Ex. : "la COP31 (la conférence mondiale annuelle de l’ONU sur le climat)", "l’Arcom (le régulateur français de la télévision et de la radio)", "OpenAI (l’entreprise qui a créé ChatGPT)".',
      '2. IDENTITÉS ET FONCTIONS : chaque personne est citée avec prénom, nom ET fonction exacte (ex. "Antonio Guterres (le secrétaire général de l’ONU)").',
      '   Chaque sportif avec son club ET son poste exact (ex. "Senny Mayulu (le jeune milieu de terrain du PSG)").',
      '3. LIEUX PRÉCIS : donne TOUJOURS la ville ou commune exacte quand elle figure dans les sources (ex. "à Trappes, dans les Yvelines" et jamais "en banlieue parisienne").',
      '   Interdiction des formules vagues ("accusations graves", "certains cas", "situation difficile"). Donne les noms, les chiffres, la raison et la conséquence.',
      '4. FORMAT : 2 à 3 phrases denses par sujet — (1) qui, quoi, où ; (2) pourquoi ou polémique ; (3) impact ou suite.',
      '5. FIDÉLITÉ : n’invente AUCUN fait absent des sources. Ne mélange jamais les détails de deux dépêches distinctes.',
      '6. ZÉRO EMOJI.',
      '',
      'LES 9 RUBRIQUES PESTEL+ (libellés EXACTS, dans cet ordre) :',
      categoryLines,
      '',
      'STRUCTURE JSON ATTENDUE :',
      hasHugoSource
        ? [
            '- "segments" : la dernière vidéo HugoDécrypte analysée sujet par sujet, EXACTEMENT comme une dépêche du complément.',
            '  Un objet pour CHAQUE sujet du sommaire (hors intro et outro), sans en oublier aucun :',
            '  "timestamp" (minutage exact du sommaire), "category" (UNE des 9 rubriques, libellé exact),',
            '  "headline" (titre précis et factuel du sujet, jamais le titre accrocheur de la vidéo),',
            '  "summary" (2 à 3 phrases appliquant toutes les règles anti-vague, appuyées sur les faits de presse',
            '  listés sous le segment et sur les articles sources de la vidéo).'
          ].join('\n')
        : '- "segments" : renvoie un tableau VIDE (aucune vidéo HugoDécrypte disponible ce matin, n’invente rien).',
      '- "categories" : un objet par rubrique, dans l’ordre ci-dessus, uniquement à partir des dépêches de la section [COMPLÉMENT D’ACTUALITÉS] et de leur corroboration presse, sans répéter un sujet déjà traité par HugoDécrypte sauf absence d’autre dépêche.',
      '  Champs : "categoryName" (libellé exact), "headline" (titre précis), "summary" (2 à 3 phrases).',
      '  Rubrique Culture & Savoir : une découverte scientifique ou historique, un film ou un livre expliqué concrètement (jamais le terme abstrait "médias").',
      '  Rubrique Faits divers : délit, crime, enquête ou accident marquant avec ville exacte et motif.'
    ].join('\n');
  };

  /** @returns {Object} Schéma JSON du digest d'actualités. */
  const buildNewsSchema = () => ({
    type: 'OBJECT',
    properties: {
      segments: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            timestamp: { type: 'STRING' },
            category: { type: 'STRING', enum: Config.NEWS_CATEGORIES.map((c) => c.name) },
            headline: { type: 'STRING' },
            summary: { type: 'STRING' }
          },
          required: ['timestamp', 'category', 'headline', 'summary']
        }
      },
      categories: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            categoryName: { type: 'STRING' },
            headline: { type: 'STRING' },
            summary: { type: 'STRING' }
          },
          required: ['categoryName', 'headline', 'summary']
        }
      }
    },
    required: ['segments', 'categories']
  });

  /** Rubrique des sujets HugoDécrypte non classés (mode sans IA ou libellé inconnu). */
  const HUGO_UNCLASSIFIED = 'Sujets de l’édition';

  /**
   * Convertit un minutage ("04:43", "1:02:03") en secondes.
   * @param {string} timestamp
   * @returns {number}
   */
  const timestampToSeconds = (timestamp) =>
    String(timestamp || '')
      .split(':')
      .map((n) => parseInt(n, 10) || 0)
      .reduce((total, n) => total * 60 + n, 0);

  /**
   * Lien vers le moment précis du sujet dans la vidéo.
   * @param {string} videoUrl
   * @param {string} timestamp
   * @returns {string}
   */
  const momentUrl = (videoUrl, timestamp) => {
    const sec = timestampToSeconds(timestamp);
    if (!videoUrl || !sec) return videoUrl;
    return `${videoUrl}${videoUrl.includes('?') ? '&' : '?'}t=${sec}s`;
  };

  /**
   * Bloc « édition HugoDécrypte » destiné au template : les sujets de la vidéo sont classés
   * dans les 9 rubriques PESTEL+, au même format que le complément Google Actualités.
   *
   * @param {Object|null} episode - Édition issue de NewsService.
   * @param {Array<Object>} aiSegments - Sujets analysés par l'IA (vide en mode de repli).
   * @returns {Object|null} { available, videoTitle, videoUrl, publishedDate, categories }
   */
  const buildHugoEdition = (episode, aiSegments) => {
    if (!episode) return null;

    // Sujets analysés par l'IA, complétés par tout chapitre oublié (titre + premier titre de presse) :
    // chaque sujet cité dans la vidéo apparaît dans le briefing.
    const analysed = aiSegments || [];
    const covered = new Set(analysed.map((s) => timestampToSeconds(s.timestamp)));
    const missing = (episode.segments || [])
      .filter((seg) => !covered.has(timestampToSeconds(seg.timestamp)))
      .map((seg) => ({
        timestamp: seg.timestamp,
        category: '',
        headline: seg.title,
        summary: seg.pressHeadlines && seg.pressHeadlines[0] ? `Selon la presse : ${seg.pressHeadlines[0]}.` : ''
      }));
    const items = [...analysed, ...missing];

    const buckets = new Map();
    [...Config.NEWS_CATEGORIES.map((c) => c.name), HUGO_UNCLASSIFIED].forEach((name) => buckets.set(name, []));
    for (const it of items) {
      const target = Config.resolveNewsCategoryName(it.category) || HUGO_UNCLASSIFIED;
      buckets.get(target).push({
        timestamp: Utils.sanitizeText(it.timestamp),
        timeUrl: momentUrl(episode.url, it.timestamp),
        headline: Utils.sanitizeText(it.headline),
        summary: Utils.sanitizeText(it.summary)
      });
    }
    const categories = [...buckets.entries()]
      .filter(([, list]) => list.length > 0)
      .map(([name, list]) => ({
        name,
        items: list.sort((a, b) => timestampToSeconds(a.timestamp) - timestampToSeconds(b.timestamp))
      }));

    return {
      available: Boolean(episode.available),
      videoTitle: Utils.sanitizeText(episode.title),
      videoUrl: episode.url,
      publishedDate: Utils.sanitizeText(episode.publishedDate),
      categories
    };
  };

  /**
   * Digest de repli sans IA (aucune information inventée).
   * @param {Object} newsData
   * @returns {Object}
   */
  const buildFallbackDigest = (newsData) => ({
    hugoEdition: buildHugoEdition(newsData.hugoEpisode, []),
    categories: newsData.fallbackCategories || []
  });

  /**
   * Résumé complet des actualités : édition HugoDécrypte segment par segment
   * + Complément Google Actualités en 9 rubriques PESTEL+.
   *
   * @param {Object} newsData - Données de NewsService.fetchDailyNewsData().
   * @returns {Object|null} { hugoEdition, categories }
   */
  const generateNewsDigest = (newsData) => {
    if (!newsData || !newsData.rawContext) return null;
    const hasHugoSource = Boolean(newsData.hugoEpisode && newsData.hugoEpisode.available);

    const text = generate({
      purpose: 'actualités',
      prompt: `${buildNewsPrompt(hasHugoSource)}\n\nSOURCES DU JOUR :\n${newsData.rawContext.substring(0, 48000)}`,
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: buildNewsSchema()
      },
      maxModels: 3,
      minRemainingMs: 60000
    });

    const parsed = parseJson(text);
    if (!parsed || typeof parsed !== 'object') {
      notifyIncident({
        component: 'Actualités du jour',
        severity: 'INFO',
        resolved: true,
        message: 'Le résumé détaillé des actualités n’a pas pu être rédigé à temps.',
        solution: 'Les titres du jour vous sont présentés directement, avec leurs sources.'
      });
      return buildFallbackDigest(newsData);
    }

    const aiSegments = hasHugoSource && Array.isArray(parsed.segments)
      ? parsed.segments
          .map((seg) => ({
            timestamp: Utils.sanitizeText(seg.timestamp),
            category: Utils.sanitizeText(seg.category),
            headline: Utils.sanitizeText(seg.headline),
            summary: Utils.sanitizeText(seg.summary)
          }))
          .filter((seg) => seg.headline && seg.summary)
      : [];

    // Rubriques ordonnées strictement selon Config.NEWS_CATEGORIES
    const buckets = {};
    Config.NEWS_CATEGORIES.forEach((c) => {
      buckets[c.name] = [];
    });
    for (const rawCat of Array.isArray(parsed.categories) ? parsed.categories : []) {
      const target = Config.resolveNewsCategoryName(Utils.sanitizeText(rawCat.categoryName));
      const headline = Utils.sanitizeText(rawCat.headline);
      const summary = Utils.sanitizeText(rawCat.summary);
      if (target && headline && summary) buckets[target].push({ headline, summary });
    }

    const categories = [];
    for (const c of Config.NEWS_CATEGORIES) {
      if (buckets[c.name].length > 0) {
        categories.push({ name: c.name, items: buckets[c.name] });
      } else {
        const fb = (newsData.fallbackCategories || []).find((f) => f.name === c.name);
        if (fb && fb.items && fb.items.length > 0) categories.push({ name: c.name, items: fb.items.slice(0, 1) });
      }
    }

    return {
      hugoEdition: buildHugoEdition(newsData.hugoEpisode, aiSegments),
      categories
    };
  };

  // ---------------------------------------------------------------------------
  // 4. Diagnostic
  // ---------------------------------------------------------------------------

  /**
   * Teste la connexion au modèle principal (utilisé par diagnostiquerBriefing).
   * @returns {{ok: boolean, model: string, detail: string}}
   */
  const pingPrimaryModel = () => {
    const model = cleanModelName(Config.getGeminiModel());
    if (!Config.hasGeminiApiKey()) {
      return { ok: false, model, detail: 'Clé GEMINI_API_KEY absente des Propriétés du script.' };
    }
    try {
      requestModel(model, Config.getGeminiApiKey(), 'Réponds par OK.', { maxOutputTokens: 16 });
      return { ok: true, model, detail: 'Réponse reçue (HTTP 200).' };
    } catch (error) {
      return { ok: false, model, detail: Utils.redactSensitive(error.message).substring(0, 160) };
    }
  };

  return {
    analyzeEmails,
    generateWeatherAdvice,
    generateNewsDigest,
    pingPrimaryModel
  };
})();
