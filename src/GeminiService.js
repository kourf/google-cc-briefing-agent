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
   * @param {string|Array<Object>} prompt - Texte complet envoyé, ou liste de « parts » (texte + PDF joints).
   * @param {Object} generationOverrides - Paramètres de génération spécifiques.
   * @returns {string} Texte du premier candidat.
   * @throws {Error} Erreur portant `statusCode` (0 = réseau).
   */
  const requestModel = (model, apiKey, prompt, generationOverrides) => {
    const url = `${Config.DEFAULTS.GEMINI_API_BASE_URL}/${model}:generateContent`;
    const payload = {
      contents: [{ role: 'user', parts: Array.isArray(prompt) ? prompt : [{ text: prompt }] }],
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
      "   - 'contactPhone' : si l'action consiste à appeler quelqu'un, le numéro à composer recopié EXACTEMENT depuis l'e-mail (voir 'telephonesDuMail'), sinon vide. 'contactHours' : les horaires d'appel s'ils sont écrits dans l'e-mail, sinon vide. N'invente JAMAIS un numéro ou un horaire.",
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
      taxonomy,
      '',
      `7. OFFRES D'EMPLOI (uniquement pour la catégorie '${C.JOBS}') : remplis "jobOffers" avec CHAQUE offre présente dans l'e-mail :`,
      '   "title" (intitulé du poste traduit en français, (m/w/d) -> (H/F)), "company" (entreprise qui recrute, vide si inconnue),',
      '   "location" (ville exacte, vide si inconnue) et "linkIndex" (numéro "n" de l\'offre dans "offresDetectees" si elle y figure, sinon 0).',
      '   N\'invente jamais une offre, une entreprise ou une ville absentes de l\'e-mail.'
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
        estimatedMinutes: { type: 'INTEGER', description: "Durée estimée de l'action en minutes" },
        contactPhone: { type: 'STRING', description: "Numéro à appeler, recopié de l'e-mail, ou vide" },
        contactHours: { type: 'STRING', description: "Horaires d'appel écrits dans l'e-mail, ou vide" },
        jobOffers: {
          type: 'ARRAY',
          description: "Offres d'emploi contenues dans l'e-mail (catégorie Emploi & Carrière uniquement)",
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              company: { type: 'STRING' },
              location: { type: 'STRING' },
              linkIndex: { type: 'INTEGER' }
            },
            required: ['title']
          }
        }
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
      estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 5,
      contactPhone: Utils.sanitizeText(item.contactPhone || ''),
      contactHours: Utils.sanitizeText(item.contactHours || ''),
      rawJobOffers: Array.isArray(item.jobOffers) ? item.jobOffers : []
    };
  };

  /**
   * Associe les offres extraites par l'IA aux liens directs détectés dans l'e-mail.
   * @param {Object} msg - E-mail (avec jobLinks).
   * @param {Array<Object>} rawOffers - Offres renvoyées par l'IA.
   * @returns {Array<{title: string, company: string, location: string, url: string}>}
   */
  const attachJobOffers = (msg, rawOffers) =>
    (rawOffers || [])
      .map((o) => {
        const link = (msg.jobLinks || [])[(parseInt(o.linkIndex, 10) || 0) - 1];
        return {
          title: Utils.sanitizeText(o.title),
          company: Utils.sanitizeText(o.company),
          location: Utils.sanitizeText(o.location),
          url: link ? link.url : msg.webUrl
        };
      })
      .filter((o) => o.title);

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
        contenuAbrege: Utils.sanitizeText(body.length > max ? `${body.substring(0, max)}...` : body),
        telephonesDuMail: Utils.findPhones(body).slice(0, 4),
        offresDetectees: (msg.jobLinks || []).map((l, idx) => ({ n: idx + 1, intitule: l.text }))
      };
    });

    const text = generate({
      purpose: 'analyse des e-mails',
      prompt: `${buildEmailPrompt()}\n\nVoici les e-mails à analyser :\n${JSON.stringify(emailsPayload)}`,
      generationConfig: {
        maxOutputTokens: 8192,
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
          const { rawJobOffers, ...fields } = analysis[msg.id];
          results.push(Object.assign({}, msg, fields, { jobOffers: attachJobOffers(msg, rawJobOffers) }));
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
      '   Interdiction des formules vagues ("accusations graves", "certains cas", "situation difficile", "des experts", "la communauté internationale", "les autorités", "plusieurs pays") :',
      '   nomme TOUJOURS qui (personne, institution ou pays précis), donne les chiffres, la raison et la conséquence.',
      '4. FORMAT : 2 à 3 phrases denses par sujet — (1) qui, quoi, où ; (2) pourquoi ou polémique ; (3) impact ou suite.',
      '5. UN SUJET = UNE DÉPÊCHE : ne fusionne JAMAIS deux événements sans lien dans un même titre ou résumé (ex. interdit : "Tensions diplomatiques et attaques de drones" mêlant la francophonie et l’Iran).',
      '   Si une rubrique contient deux sujets importants, crée deux objets distincts (2 objets maximum par rubrique).',
      '6. CLASSEMENT JUSTE : innovation d’entreprise, espace commercial (SpaceX…), IA, cybersécurité et produits numériques -> "T — Technologie, IA & Innovation" ;',
      '   "Culture & Savoir" = cinéma, livres, musique, histoire, archéologie, découverte scientifique fondamentale (médecine, astronomie, biologie) ;',
      '   cyberattaque contre une entreprise -> "T" ; climat et biodiversité -> "E — Environnement" ; procès et lois -> "L".',
      '7. FIDÉLITÉ : n’invente AUCUN fait absent des sources.',
      '8. ZÉRO EMOJI.',
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
      '- "categories" : 1 à 2 objets par rubrique (un objet par dépêche), dans l’ordre ci-dessus, uniquement à partir des dépêches de la section [COMPLÉMENT D’ACTUALITÉS] et de leur corroboration presse, sans répéter un sujet déjà traité par HugoDécrypte sauf absence d’autre dépêche.',
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
      if (target && headline && summary && buckets[target].length < 2) buckets[target].push({ headline, summary });
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

  // ---------------------------------------------------------------------------
  // 4. Suivi des dossiers urgents (huissier, impôts, Urssaf, banque…)
  // ---------------------------------------------------------------------------

  /** Niveaux d'alerte possibles d'un dossier. */
  const URGENT_LEVELS = Object.freeze(['urgent', 'a_surveiller', 'en_attente', 'regle']);

  /**
   * Consignes de l'analyse des dossiers urgents.
   * @param {string} todayIso - Date du jour (AAAA-MM-JJ).
   * @returns {string}
   */
  const buildUrgentFilesPrompt = (todayIso) => [
    `Tu es l'assistant administratif personnel de Kouroufia. Nous sommes le ${todayIso}.`,
    'Pour CHAQUE dossier fourni (identifié par "key"), lis tous ses mails ET les PDF joints qui portent sa clé, puis dis où en est le dossier.',
    'Règles :',
    '- Français très simple, phrases courtes, aucun jargon (si un mot juridique est indispensable, explique-le entre parenthèses).',
    '- Uniquement des faits écrits noir sur blanc dans les mails ou les PDF. N’ajoute aucune conséquence ni supposition (les mots « bloqué », « clôturé », « payé », « annulé » sont interdits s’ils ne figurent pas tels quels dans un mail ou un PDF ; une menace comme « pourra clôturer » reste une menace). Montants exacts avec « € », dates exactes.',
    '- Un dossier ne concerne que son organisme : ne mélange pas deux dettes différentes (ex. une saisie des impôts reçue via la banque reste une dette envers les impôts, pas envers la banque ; dis-le clairement).',
    '- "etat" : 1 à 2 phrases sur la situation actuelle du dossier (la plus récente, pas l’historique complet).',
    '- "prochaineAction" : ce que Kouroufia doit faire maintenant, concrètement (qui contacter, quoi payer, quoi envoyer). Si rien : « Rien à faire pour l’instant ».',
    '- "echeance" : date limite de cette prochaine action au format AAAA-MM-JJ, sinon chaîne vide. Obligatoire dès qu’une date ou un jour du mois est écrit : pour un paiement mensuel « au plus tard le 30 du mois », donne la prochaine date à venir (ex. nous sommes le 18/11 -> 2026-11-30). Reprends aussi cette date dans "prochaineAction".',
    '- "montant" : somme encore due (ex. « 1 161,20 € »), sinon chaîne vide.',
    '- "niveau" : "urgent" (paiement ou réponse exigé, poursuites, saisie, échéance proche), "a_surveiller" (risque ou relance sans date proche), "en_attente" (vous attendez une réponse, rien à faire), "regle" (dette payée ou annulée, dossier clos).',
    '- "changement" : ce que le mail ou le courrier le plus récent apporte de nouveau par rapport à "etatPrecedent" (1 phrase). Si "etatPrecedent" est vide : chaîne vide.',
    '',
    'ACCOMPAGNEMENT (aider Kouroufia à conclure le dossier facilement) :',
    '- "contacts" : 0 à 2 personnes ou services à joindre pour CE dossier (ex. le gestionnaire nommé dans le courrier). Coordonnées recopiées EXACTEMENT telles qu’écrites dans les mails ("texte", "telephonesDuMail", "emailsDuMail") ou les PDF : "nom", "role" (ex. « gestionnaire du dossier »), "telephone", "horaires", "email", "adresse" (adresse postale complète), "site". Champ vide si l’information n’est pas écrite : n’invente ni ne devine JAMAIS un numéro, une adresse ou un horaire. N’y mets pas les adresses « noreply » ni le "contactOfficiel" (déjà connu).',
    '- "references" : numéros à rappeler en contactant l’organisme (n° de dossier, référence du courrier, n° de compte, SIREN), tels qu’écrits ; vide sinon.',
    '- "etapes" : 2 à 4 étapes concrètes dans l’ordre, une seule action par étape (ex. « Appelez Mme Martin au 01 23 45 67 89 pour demander le RIB du cabinet »). Liste vide si le dossier est réglé ou s’il faut seulement attendre.',
    '- "aPreparer" : 0 à 4 choses à avoir sous la main (référence, RIB, justificatif, courrier reçu…).',
    '- Dans "prochaineAction" et "etapes", écris les dates au format JJ/MM/AAAA (jamais AAAA-MM-JJ).',
    '- "brouillon" : sois proactif. Rédige un message (necessaire = true) dès qu’un écrit aide à avancer ou à conclure : demander un RIB ou IBAN pour payer, confirmer un échéancier accepté, demander un délai ou un paiement en plusieurs fois, demander une confirmation écrite ou un justificatif, relancer une demande sans réponse. Si l’organisme passe par une messagerie en ligne, rédige-le quand même (destinataire vide) : Kouroufia le copiera. necessaire = false seulement si le dossier est réglé ou s’il faut simplement attendre une réponse récente.',
    '  * "destinataire" : une adresse de "adressesConnues", "contactOfficiel.email" ou écrite dans un mail ou un PDF du dossier, la plus adaptée à une réponse humaine ; vide s’il faut passer par une messagerie en ligne.',
    '  * "objet" : précis, avec la référence du dossier si elle existe.',
    '  * "corps" : vouvoiement, poli et clair, 100 à 220 mots, sauts de ligne entre les paragraphes. Commence par « Madame, Monsieur, » (ou le nom de l’interlocuteur s’il est connu). Rappelle les références, pose les questions utiles, demande une confirmation écrite. Termine par « Cordialement, » puis le nom de Kouroufia tel qu’il est écrit dans les courriers (sinon « Kouroufia »). Aucun texte entre crochets à compléter.',
    '  * Prudence : n’invente aucun fait ; ne reconnais pas une dette que Kouroufia conteste dans ses mails ; ne propose aucun montant ni aucune date de paiement que Kouroufia ou l’organisme n’ont pas déjà écrits. Ne prends AUCUN engagement de payer ou d’agir à la place de Kouroufia (pas de « je vais régler », « je vais déclarer ») : tu peux demander le montant exact, un RIB, un délai ou un paiement en plusieurs fois, ou confirmer ce que l’organisme a déjà accepté par écrit.',
    '  * Pas de brouillon (necessaire = false) si la démarche se fait entièrement sur un site (déclaration, création d’espace) et qu’aucune question utile n’est à poser : les étapes suffisent.',
    '  * Le genre de Kouroufia est inconnu : évite tout adjectif ou participe accordé qui se rapporte à Kouroufia (ex. « conscient(e) », « désolé(e) ») en tournant la phrase autrement.',
    '  * Mise en forme : sépare les paragraphes par une ligne vide (\\n\\n) : la formule d’appel seule sur sa ligne, puis 2 ou 3 paragraphes, puis « Cordialement, » et le nom sur la ligne suivante.',
    '  * Si le dernier mail vient de « Vous (Kouroufia) », un brouillon n’est utile que pour une relance polie, et seulement si la réponse tarde (plus de 7 jours).',
    '  * "pointsAjoutes" : 1 à 4 éléments utiles que tu as ajoutés et auxquels Kouroufia n’aurait peut-être pas pensé (ex. « rappel du numéro de dossier », « demande de confirmation écrite », « demande du RIB pour le virement »).'
  ].join('\n');

  /**
   * Schéma JSON de la réponse (un objet par dossier).
   * @returns {Object}
   */
  const buildUrgentFilesSchema = () => ({
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        key: { type: 'STRING' },
        etat: { type: 'STRING' },
        prochaineAction: { type: 'STRING' },
        echeance: { type: 'STRING' },
        montant: { type: 'STRING' },
        niveau: { type: 'STRING', enum: [...URGENT_LEVELS] },
        changement: { type: 'STRING' },
        contacts: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              nom: { type: 'STRING' },
              role: { type: 'STRING' },
              telephone: { type: 'STRING' },
              horaires: { type: 'STRING' },
              email: { type: 'STRING' },
              adresse: { type: 'STRING' },
              site: { type: 'STRING' }
            },
            required: ['nom', 'role', 'telephone', 'horaires', 'email', 'adresse', 'site']
          }
        },
        references: { type: 'STRING' },
        etapes: { type: 'ARRAY', items: { type: 'STRING' } },
        aPreparer: { type: 'ARRAY', items: { type: 'STRING' } },
        brouillon: {
          type: 'OBJECT',
          properties: {
            necessaire: { type: 'BOOLEAN' },
            destinataire: { type: 'STRING' },
            objet: { type: 'STRING' },
            corps: { type: 'STRING' },
            pointsAjoutes: { type: 'ARRAY', items: { type: 'STRING' } }
          },
          // Tous obligatoires : sinon le modèle répond « necessaire » sans écrire le texte.
          required: ['necessaire', 'destinataire', 'objet', 'corps', 'pointsAjoutes'],
          propertyOrdering: ['necessaire', 'destinataire', 'objet', 'corps', 'pointsAjoutes']
        }
      },
      required: ['key', 'etat', 'prochaineAction', 'echeance', 'montant', 'niveau', 'changement', 'contacts', 'references', 'etapes', 'aPreparer', 'brouillon']
    }
  });

  /** Texte sur plusieurs lignes nettoyé ligne par ligne (les sauts de ligne du brouillon sont conservés). */
  const sanitizeMultiline = (text) =>
    String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => Utils.sanitizeText(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  /**
   * Mise en page d'un mail resté sur une seule ligne : formule d'appel seule, ligne vide avant
   * la formule de politesse, nom sur sa propre ligne.
   */
  const layoutLetter = (text) => {
    let t = String(text || '');
    if (/\n/.test(t)) return t;
    t = t.replace(/^((?:Madame,\s*Monsieur|Madame|Monsieur|Bonjour)(?:\s+[^\s,]+){0,3},)\s*/i, '$1\n\n');
    t = t.replace(/\s*((?:Je vous remercie|Dans l’attente|Dans l'attente)[^.]*\.)\s*/i, '\n\n$1\n\n');
    t = t.replace(/\s*(Cordialement,|Bien cordialement,|Veuillez agréer[^.]*\.)\s*/i, '\n\n$1\n');
    return t.replace(/\n{3,}/g, '\n\n').trim();
  };

  /** Liste de textes courts nettoyés. */
  const cleanList = (list, max) =>
    (Array.isArray(list) ? list : [])
      .map((s) => Utils.sanitizeText(s || ''))
      .filter(Boolean)
      .slice(0, max);

  /**
   * Analyse IA des dossiers urgents (mails + PDF joints, en un seul appel).
   *
   * @param {Array<{key: string, organisme: string, etatPrecedent: string, messages: Array<Object>, pdfs: Array<Object>}>} dossiers
   * @returns {Object<string, Object>|null} key -> analyse, ou null si l'IA est indisponible.
   */
  const analyzeUrgentFiles = (dossiers) => {
    if (!dossiers || dossiers.length === 0) return {};
    const todayIso = Utilities.formatDate(new Date(), Config.DEFAULTS.TIMEZONE, 'yyyy-MM-dd');
    const summary = dossiers.map((d) => ({
      key: d.key,
      organisme: d.organisme,
      etatPrecedent: d.etatPrecedent || '',
      adressesConnues: d.addresses || [],
      contactOfficiel: d.official
        ? { nom: d.official.name, telephone: d.official.phone, horaires: d.official.hours, email: d.official.email || '', enLigne: d.official.online || '' }
        : null,
      mails: d.messages,
      pdfJoints: d.pdfs.map((p) => `${p.name} (reçu le ${p.date})`)
    }));
    const parts = [{ text: `${buildUrgentFilesPrompt(todayIso)}\n\nDossiers :\n${JSON.stringify(summary)}` }];
    for (const d of dossiers) {
      for (const pdf of d.pdfs) {
        parts.push({ text: `PDF joint du dossier "${d.key}" : ${pdf.name} (reçu le ${pdf.date})` });
        parts.push({ inlineData: { mimeType: 'application/pdf', data: pdf.data } });
      }
    }

    const text = generate({
      purpose: 'suivi des dossiers urgents',
      prompt: parts,
      generationConfig: {
        maxOutputTokens: 12288,
        responseMimeType: 'application/json',
        responseSchema: buildUrgentFilesSchema()
      },
      minRemainingMs: Config.DEFAULTS.RESERVE_AFTER_EMAILS_MS
    });
    const parsed = parseJson(text);
    if (!Array.isArray(parsed)) return null;
    const map = {};
    for (const item of parsed) {
      if (!item || !item.key) continue;
      const rawDraft = item.brouillon || {};
      console.log(`Dossier ${item.key} : brouillon ${rawDraft.necessaire ? `proposé (${String(rawDraft.corps || '').length} caractères)` : 'non proposé'}.`);
      map[item.key] = {
        etat: Utils.sanitizeText(item.etat || ''),
        prochaineAction: Utils.sanitizeText(item.prochaineAction || ''),
        echeance: /^\d{4}-\d{2}-\d{2}$/.test(String(item.echeance || '').trim()) ? String(item.echeance).trim() : '',
        montant: Utils.sanitizeText(item.montant || ''),
        niveau: URGENT_LEVELS.includes(item.niveau) ? item.niveau : 'a_surveiller',
        changement: Utils.sanitizeText(item.changement || ''),
        contacts: (Array.isArray(item.contacts) ? item.contacts : []).slice(0, 2).map((c) => ({
          nom: Utils.sanitizeText((c && c.nom) || ''),
          role: Utils.sanitizeText((c && c.role) || ''),
          telephone: Utils.sanitizeText((c && c.telephone) || ''),
          horaires: Utils.sanitizeText((c && c.horaires) || ''),
          email: String((c && c.email) || '').trim().toLowerCase(),
          adresse: Utils.sanitizeText((c && c.adresse) || ''),
          site: Utils.sanitizeText((c && c.site) || '')
        })),
        references: Utils.sanitizeText(item.references || ''),
        etapes: cleanList(item.etapes, 4),
        aPreparer: cleanList(item.aPreparer, 4),
        brouillon: (() => {
          const b = item.brouillon || {};
          const corps = layoutLetter(sanitizeMultiline(b.corps));
          if (!b.necessaire || corps.length < 40) return null;
          return {
            destinataire: String(b.destinataire || '').trim().toLowerCase(),
            objet: Utils.sanitizeText(b.objet || '') || 'Suivi de mon dossier',
            corps,
            pointsAjoutes: cleanList(b.pointsAjoutes, 4)
          };
        })()
      };
    }
    return map;
  };

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
    analyzeUrgentFiles,
    pingPrimaryModel
  };
})();
