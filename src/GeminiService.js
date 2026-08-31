/**
 * Google CC Briefing Agent
 * GeminiService.js — Analyse IA avec Gemini, prompt en français naturel,
 * schéma de catégories strictes et assainissement intégral des sorties.
 */

const GeminiService = (function () {
  /**
   * Catégories fixes et explicites demandées pour le briefing
   */
  const CATEGORIES = {
    ACTIONS_URGENTES: 'actions_urgentes',
    SECURITE_ALERTES: 'securite_alertes',
    OPPORTUNITES_PRO: 'opportunites_pro',
    ACHATS_PROMOTIONS: 'achats_promotions',
    AUTRES_INFORMATIONS: 'autres_informations'
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
   * Effectue la requête HTTP vers Gemini avec un prompt repensé et un schéma strict.
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
      "Tu es le rédacteur exécutif du Google CC Briefing Agent. Ta mission est de produire un résumé matinal limpide, professionnel et agréable à lire.\n\n" +
      "RÈGLES DE RÉDACTION STRICTES (NIVEAU CADRE SUPÉRIEUR) :\n" +
      "1. Écris TOUJOURS en français direct, simple et naturel.\n" +
      "2. Chaque résumé ('summary') doit faire STRICTEMENT 1 ou 2 phrases courtes répondant précisément à 3 questions :\n" +
      "   - Qui écrit ? (Nom clair de l'expéditeur ou de l'entreprise)\n" +
      "   - De quoi s'agit-il exactement ? (Explication concrète sans jargon)\n" +
      "   - Quelle action concrète est attendue ? (Si aucune action : 'Aucune action requise')\n" +
      "3. INTERDICTIONS FORMELLES :\n" +
      "   - JAMAIS de symboles de mise en forme markdown (*, _, `, ~, #).\n" +
      "   - JAMAIS de symboles mathématiques ou de délimiteurs de formules (interdiction absolue du signe dollar '$', pas de formule LaTeX comme $(m/w/d)$).\n" +
      "   - JAMAIS d'entités HTML (&amp;, &#039;, &quot;, &lt;, &gt;) : utilise directement de vraies apostrophes (').\n" +
      "   - JAMAIS de tournures robotiques comme 'Synthèse de X offres'. Explique directement le contenu.\n\n" +
      "ATTRIBUTION DES CATÉGORIES EXACTES (choisis obligatoirement l'une de ces 5 clés) :\n" +
      "- 'actions_urgentes' : Problème bloquant, échec de build/déploiement CI/CD, facture client à payer d'urgence, action requise aujourd'hui.\n" +
      "- 'securite_alertes' : Alertes de sécurité (Google, GitHub, Microsoft), connexions depuis un nouvel appareil, codes d'authentification.\n" +
      "- 'opportunites_pro' : Offres d'emploi (LinkedIn, recruteurs), prises de contact pro, propositions de missions ou postes.\n" +
      "- 'achats_promotions' : Offres commerciales, bons de réduction, soldes, e-commerce (ex: Aprizo, Asos).\n" +
      "- 'autres_informations' : Tout e-mail informatif ne rentrant pas dans les catégories précédentes.";

    const responseSchema = {
      type: 'ARRAY',
      description: 'Analyses structurées pour chaque e-mail',
      items: {
        type: 'OBJECT',
        properties: {
          emailId: { type: 'STRING' },
          category: {
            type: 'STRING',
            enum: [
              'actions_urgentes',
              'securite_alertes',
              'opportunites_pro',
              'achats_promotions',
              'autres_informations'
            ]
          },
          summary: {
            type: 'STRING',
            description: '1 ou 2 phrases courtes et explicites en français naturel'
          },
          actionRequired: { type: 'BOOLEAN' },
          actionTitle: {
            type: 'STRING',
            description: "Titre court de l'action en quelques mots (ex: 'Relancer le déploiement sur GitHub') ou 'Aucune action'."
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
                '\n\nVoici les e-mails à résumer :\n' +
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

    let parsedArray;
    try {
      let cleanText = candidateText.trim();
      // Remove markdown formatting if present
      cleanText = cleanText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      // Replace unescaped control characters with spaces to prevent JSON.parse from failing
      cleanText = cleanText.replace(/[\n\r\t]/g, " ");
      parsedArray = JSON.parse(cleanText);
    } catch (e) {
      const err = new Error('Invalid JSON response from Gemini: ' + e.message);
      err.statusCode = 502;
      throw err;
    }

    const resultMap = {};

    if (Array.isArray(parsedArray)) {
      for (let i = 0; i < parsedArray.length; i++) {
        const item = parsedArray[i];
        if (item && item.emailId) {
          resultMap[item.emailId] = {
            category: item.category || 'autres_informations',
            summary: Utils.cleanText(item.summary || 'Message reçu sans description.'),
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
   * Mode dégradé robuste si un lot échoue.
   */
  function getFallbackAiData(msg) {
    const sender = msg.senderDisplayName || msg.senderName || 'Expéditeur inconnu';
    const cleanSubj = Utils.cleanText(msg.subject) || 'Nouveau message';

    let cat = 'autres_informations';
    const lower = (msg.from + ' ' + msg.subject).toLowerCase();
    if (lower.indexOf('google.com') !== -1 || lower.indexOf('securite') !== -1) {
      cat = 'securite_alertes';
    } else if (lower.indexOf('linkedin') !== -1 || lower.indexOf('recrutement') !== -1) {
      cat = 'opportunites_pro';
    } else if (lower.indexOf('aprizo') !== -1 || lower.indexOf('promo') !== -1) {
      cat = 'achats_promotions';
    }

    return {
      category: cat,
      summary: sender + ' vous a envoyé un e-mail : ' + cleanSubj + '. Aucune action urgente requise.',
      actionRequired: false,
      actionTitle: 'Aucune action',
      deadline: null,
      estimatedMinutes: 2
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    analyzeEmails: analyzeEmails
  };
})();
