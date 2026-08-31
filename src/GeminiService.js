/**
 * Google CC Briefing Agent
 * GeminiService.js — Analyse IA avec Gemini 2.0 Flash, taxonomie stricte à 9 catégories,
 * résumés actifs en français pur (zéro formulation robotique) et traduction des titres anglophones.
 */

const GeminiService = (function () {
  /**
   * Les 9 catégories mutuellement exclusives demandées
   */
  const CATEGORIES = {
    ACTIONS_IMMEDIATES: 'actions_immediates',
    SECURITE_ACCES: 'securite_acces',
    EMPLOI_CARRIERE: 'emploi_carriere',
    TECH_DEV: 'tech_dev',
    VOYAGES_LOISIRS: 'voyages_loisirs',
    ACHATS_PROMOS: 'achats_promos',
    SANTE_DEMARCHES: 'sante_demarches',
    RESEAUX_SOCIAUX: 'reseaux_sociaux',
    VEILLE_CULTURE: 'veille_culture'
  };

  /**
   * Analyse la liste des e-mails dédupliqués via l'API Gemini par lots optimisés.
   *
   * @param {Array<Object>} emailsList - E-mails dédupliqués
   * @return {Array<Object>} E-mails enrichis de leur analyse IA
   */
  function analyzeEmails(emailsList) {
    if (!emailsList || emailsList.length === 0) {
      return [];
    }

    const apiKey = Config.getGeminiApiKey();
    const batchSize = Config.DEFAULTS.BATCH_SIZE || 6;
    const totalBatches = Math.ceil(emailsList.length / batchSize);
    const enrichedResults = [];

    for (let i = 0; i < emailsList.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize) + 1;
      const batch = emailsList.slice(i, i + batchSize);

      console.log(
        'Analyse du lot Gemini ' +
          batchIndex +
          '/' +
          totalBatches +
          ' (' +
          batch.length +
          ' e-mails)...'
      );

      const batchAnalysis = analyzeBatchWithRetry(batch, apiKey, batchIndex, totalBatches);

      for (let b = 0; b < batch.length; b++) {
        const originalMsg = batch[b];
        const aiData = batchAnalysis[originalMsg.id] || getFallbackAiData(originalMsg);
        enrichedResults.push(Object.assign({}, originalMsg, aiData));
      }

      // Pause préventive légère pour lisser la consommation de quota
      if (i + batchSize < emailsList.length) {
        Utilities.sleep(500);
      }
    }

    return enrichedResults;
  }

  /**
   * Traite un lot avec retry et backoff exponentiel avec gigue.
   */
  function analyzeBatchWithRetry(batch, apiKey, batchIndex, totalBatches) {
    let model = Config.getGeminiModel();
    const maxAttempts = Config.DEFAULTS.MAX_RETRIES || 4;
    const baseDelayMs = Config.DEFAULTS.INITIAL_BACKOFF_MS || 1500;
    const transientStatusCodes = [429, 500, 502, 503, 504];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return callGeminiApi(batch, apiKey, model);
      } catch (e) {
        const statusCode = e.statusCode || 0;
        const sanitizedMsg = Utils.redactSensitive(e.message);

        // Bascule automatique si le modèle est indisponible
        if (statusCode === 404 && model !== Config.DEFAULTS.GEMINI_FALLBACK_MODEL) {
          console.warn(
            'Modèle ' +
              model +
              ' non disponible (404). Bascule sur ' +
              Config.DEFAULTS.GEMINI_FALLBACK_MODEL
          );
          model = Config.DEFAULTS.GEMINI_FALLBACK_MODEL;
          attempt--;
          continue;
        }

        // Erreurs non récupérables
        if (statusCode > 0 && !transientStatusCodes.includes(statusCode) && statusCode !== 404) {
          console.error(
            'Erreur API non récupérable (' +
              sanitizedMsg +
              '). Mode dégradé activé pour le lot ' +
              batchIndex +
              '.'
          );
          break;
        }

        // Erreurs temporaires (429, 503...)
        if (attempt < maxAttempts) {
          const delay = Utils.calculateBackoffWithJitter(attempt, baseDelayMs);
          console.warn(
            'API temporairement occupée (' +
              sanitizedMsg +
              '). Tentative ' +
              attempt +
              '/' +
              maxAttempts +
              ' — Attente de ' +
              delay +
              ' ms...'
          );
          Utilities.sleep(delay);
        } else {
          console.error(
            'Échec définitif du lot ' +
              batchIndex +
              '/' +
              totalBatches +
              ' après ' +
              maxAttempts +
              ' tentatives. Mode dégradé activé.'
          );
        }
      }
    }

    const fallbackResult = {};
    for (let i = 0; i < batch.length; i++) {
      const msg = batch[i];
      fallbackResult[msg.id] = getFallbackAiData(msg);
    }
    return fallbackResult;
  }

  /**
   * Effectue la requête HTTP vers Gemini avec la taxonomie à 9 catégories et les règles strictes anti-robotique.
   */
  function callGeminiApi(batch, apiKey, model) {
    const endpoint =
      Config.DEFAULTS.GEMINI_API_BASE_URL + '/' + encodeURIComponent(model) + ':generateContent?key=' + apiKey;

    const emailsPayload = batch.map(function (msg) {
      let snippet = msg.body || '';
      if (snippet.length > 900) {
        snippet = snippet.substring(0, 900) + '...';
      }
      snippet = snippet.replace(/\s+/g, ' ').trim();

      return {
        emailId: msg.id,
        expediteur: msg.senderDisplayName || msg.senderName,
        objet: msg.subject,
        date: msg.dateFormatted + ' ' + msg.timeFormatted,
        nombreMessages: msg.duplicateCount || 1,
        contenuAbrege: snippet
      };
    });

    const systemPrompt =
      "Tu es un Assistant Exécutif IA d'élite spécialisé dans la curation, la synthèse d'e-mails et la gestion d'agenda personnel. Ta tâche est de transformer une liste brute d'e-mails en un briefing quotidien haut de gamme, épuré, directement actionnable et lisible en un coup d'œil.\n\n" +
      "RÈGLES DE RÉDACTION STRICTES :\n" +
      "1. Rédige TOUJOURS en français direct, élégant et naturel.\n" +
      "2. Mets OBLIGATOIREMENT en gras (**) les éléments clés (noms, montants, délais) pour une lecture rapide.\n" +
      "3. INTERDICTION FORMELLE DE BOILERPLATE ROBOTIQUE :\n" +
      "   - Ne commence JAMAIS par '[Expéditeur] vous a envoyé un e-mail'.\n" +
      "   - N'écris JAMAIS 'Aucune action requise' dans le résumé.\n" +
      "   - N'utilise JAMAIS d'entités HTML (ex: &amp;).\n" +
      "4. Chaque résumé ('summary') doit faire STRICTEMENT 1 SEULE phrase concise et active expliquant clairement de quoi il s'agit.\n" +
      "5. Pour le champ 'category', crée une sous-catégorie intelligente et adaptative selon le contexte (ex. 'Emploi & Carrière', 'Tech & Projets', 'Shopping & Bons plans', 'Santé', 'Réseaux sociaux & Culture'). Ne te limite pas à une liste stricte.";

    const responseSchema = {
      type: 'ARRAY',
      description: 'Analyses structurées pour chaque e-mail',
      items: {
        type: 'OBJECT',
        properties: {
          emailId: { type: 'STRING' },
          category: { type: 'STRING', description: "Sous-catégorie intelligente adaptative (ex: 'Tech & Projets', 'Santé')" },
          summary: {
            type: 'STRING',
            description: '1 phrase concise, active et naturelle en français (sans formule robotique)'
          },
          actionRequired: { type: 'BOOLEAN' },
          actionTitle: {
            type: 'STRING',
            description: "Titre court de l'action en 3 à 5 mots (ex: 'Relancer le déploiement') ou 'Aucune action'."
          },
          deadline: { type: 'STRING' },
          estimatedMinutes: { type: 'INTEGER' }
        },
        required: ['emailId', 'category', 'summary', 'actionRequired', 'actionTitle']
      }
    };

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                systemPrompt +
                '\n\nVoici les e-mails à analyser et synthétiser :\n' +
                JSON.stringify(emailsPayload)
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: responseSchema
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    let response;
    try {
      response = UrlFetchApp.fetch(endpoint, options);
    } catch (netErr) {
      const err = new Error('Erreur réseau de communication avec l’API : ' + netErr.message);
      err.statusCode = 0;
      throw err;
    }

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      let parsedMessage = responseText.substring(0, 200);
      try {
        const errJson = JSON.parse(responseText);
        if (errJson && errJson.error && errJson.error.message) {
          parsedMessage = errJson.error.message;
        }
      } catch (_) {}

      const err = new Error('HTTP ' + statusCode + ' : ' + parsedMessage);
      err.statusCode = statusCode;
      throw err;
    }

    const data = JSON.parse(responseText);
    const candidateText =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!candidateText) {
      const emptyErr = new Error('Réponse Gemini vide.');
      emptyErr.statusCode = 502;
      throw emptyErr;
    }

    const parsedArray = JSON.parse(candidateText);
    const resultMap = {};

    if (Array.isArray(parsedArray)) {
      for (let i = 0; i < parsedArray.length; i++) {
        const item = parsedArray[i];
        if (item && item.emailId) {
          resultMap[item.emailId] = {
            category: item.category || 'Veille & Culture',
            summary: Utils.cleanText(item.summary || 'Nouvelles informations partagées.'),
            actionRequired: Boolean(item.actionRequired),
            actionTitle: Utils.cleanText(item.actionTitle || (item.actionRequired ? 'Action requise' : 'Aucune action')),
            deadline: item.deadline && item.deadline !== 'Aucune' ? Utils.cleanText(item.deadline) : null,
            estimatedMinutes: item.estimatedMinutes || 0
          };
        }
      }
    }

    return resultMap;
  }

  /**
   * Mode dégradé robuste et non-robotique si un lot échoue.
   */
  function getFallbackAiData(msg) {
    const sender = msg.senderDisplayName || msg.senderName || 'Expéditeur inconnu';
    const cleanSubj = Utils.cleanText(msg.subject) || 'Nouveau message';
    const lower = (msg.from + ' ' + msg.subject).toLowerCase();

    let cat = 'Veille & Culture';
    let fallbackSummary = sender + ' partage des informations : ' + cleanSubj + '.';

    if (lower.indexOf('github') !== -1 || lower.indexOf('firebase') !== -1 || lower.indexOf('cloud') !== -1) {
      cat = 'Tech & Projets';
      fallbackSummary = 'Mise à jour technique de ' + sender + ' concernant ' + cleanSubj + '.';
    } else if (lower.indexOf('google.com') !== -1 || lower.indexOf('securite') !== -1 || lower.indexOf('connexion') !== -1) {
      cat = 'Sécurité & Accès';
      fallbackSummary = 'Notification de sécurité de ' + sender + ' au sujet de ' + cleanSubj + '.';
    } else if (lower.indexOf('linkedin') !== -1 || lower.indexOf('recrutement') !== -1 || lower.indexOf('emploi') !== -1) {
      cat = 'Emploi & Carrière';
      fallbackSummary = 'Nouvelles opportunités professionnelles partagées par ' + sender + ' : ' + cleanSubj + '.';
    } else if (lower.indexOf('easyjet') !== -1 || lower.indexOf('getyourguide') !== -1 || lower.indexOf('voyage') !== -1) {
      cat = 'Voyages & Loisirs';
      fallbackSummary = sender + ' propose des offres de voyages et loisirs : ' + cleanSubj + '.';
    } else if (lower.indexOf('asos') !== -1 || lower.indexOf('twistshake') !== -1 || lower.indexOf('aprizo') !== -1 || lower.indexOf('promo') !== -1) {
      cat = 'Shopping & Bons plans';
      fallbackSummary = sender + ' annonce des réductions et offres promotionnelles : ' + cleanSubj + '.';
    } else if (lower.indexOf('doctolib') !== -1 || lower.indexOf('qare') !== -1 || lower.indexOf('sante') !== -1) {
      cat = 'Santé & Démarches';
      fallbackSummary = 'Notification médicale ou administrative de ' + sender + ' concernant ' + cleanSubj + '.';
    } else if (lower.indexOf('tiktok') !== -1 || lower.indexOf('facebook') !== -1 || lower.indexOf('instagram') !== -1) {
      cat = 'Réseaux sociaux & Culture';
      fallbackSummary = 'Activité et notifications sur vos réseaux sociaux via ' + sender + '.';
    }

    return {
      category: cat,
      summary: fallbackSummary,
      actionRequired: false,
      actionTitle: 'Aucune action',
      deadline: null,
      estimatedMinutes: 0
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    analyzeEmails: analyzeEmails
  };
})();
