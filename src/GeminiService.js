/**
 * Google CC Briefing Agent
 * GeminiService.js — Analyse IA avec Gemini, sorties structurées JSON en français pur,
 * interdiction formelle des entités/balises HTML et catégorisation thématique soignée.
 */

const GeminiService = (function () {
  /**
   * Analyse une liste de messages e-mails via l'API Gemini par lots.
   *
   * @param {Array<Object>} emailsList - Messages dédupliqués et nettoyés
   * @return {Array<Object>} Messages enrichis avec résumés, priorités et catégories
   */
  function analyzeEmails(emailsList) {
    if (!emailsList || emailsList.length === 0) {
      return [];
    }

    const apiKey = Config.getGeminiApiKey();
    const batchSize = Config.DEFAULTS.BATCH_SIZE;
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

      // Pause préventive entre les lots pour lisser les quotas
      if (i + batchSize < emailsList.length) {
        Utilities.sleep(800);
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

        // 1. Modèle indisponible (404) -> Bascule automatique
        if (statusCode === 404 && model !== Config.DEFAULTS.GEMINI_FALLBACK_MODEL) {
          console.warn(
            'Modèle ' +
              model +
              ' non disponible (404). Bascule automatique sur ' +
              Config.DEFAULTS.GEMINI_FALLBACK_MODEL
          );
          model = Config.DEFAULTS.GEMINI_FALLBACK_MODEL;
          attempt--;
          continue;
        }

        // 2. Erreurs non récupérables (400, 401...)
        if (statusCode > 0 && !transientStatusCodes.includes(statusCode) && statusCode !== 404) {
          console.error(
            'Erreur non récupérable de l’API Gemini (' +
              sanitizedMsg +
              '). Utilisation du mode dégradé pour le lot ' +
              batchIndex +
              '.'
          );
          break;
        }

        // 3. Erreurs temporaires (429, 503...)
        if (attempt < maxAttempts) {
          const delay = Utils.calculateBackoffWithJitter(attempt, baseDelayMs);
          console.warn(
            'API Gemini temporairement saturée ou indisponible (' +
              sanitizedMsg +
              '). Tentative ' +
              attempt +
              '/' +
              maxAttempts +
              ' — Nouvelle tentative dans ' +
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
              ' tentatives. Activation du mode dégradé.'
          );
        }
      }
    }

    // Fallback gracieux en cas d'échec total du lot
    const fallbackResult = {};
    for (let i = 0; i < batch.length; i++) {
      const msg = batch[i];
      fallbackResult[msg.id] = getFallbackAiData(msg);
    }
    return fallbackResult;
  }

  /**
   * Effectue la requête HTTP vers la Gemini Developer API avec schéma structuré JSON forcé.
   */
  function callGeminiApi(batch, apiKey, model) {
    const endpoint =
      Config.DEFAULTS.GEMINI_API_BASE_URL + '/' + encodeURIComponent(model) + ':generateContent?key=' + apiKey;

    const emailsPayload = batch.map(function (msg) {
      return {
        emailId: msg.id,
        expediteur: Utils.cleanSenderName(msg.from),
        destinataireCompte: msg.targetAccount ? msg.targetAccount.label : '',
        objet: Utils.stripHtmlAndMarkdown(msg.subject),
        date: msg.dateFormatted + ' ' + msg.timeFormatted,
        doublonsIdentiques: msg.duplicateCount > 1 ? msg.duplicateCount : 1,
        contenu: msg.body
      };
    });

    const systemPrompt =
      "Tu es l'analyste en chef du Google CC Briefing Agent. Ton rôle est de fournir des synthèses matinales limpides, directes et en français très simple.\n\n" +
      "RÈGLES ABSOLUES SUR LA LANGUE ET LA FORME :\n" +
      "1. Réponds EXCLUSIVEMENT en français simple, fluide et naturel (niveau ELI15, compréhensible par un adolescent de 15 ans).\n" +
      "2. INTERDICTION FORMELLE DES BALISES HTML ET DES ENTITÉS : N'inclus JAMAIS d'entités HTML (comme &#039;, &amp;, &quot;, &lt;, &gt;) ni de balises (comme <strong>, <b>, <em>, <br>). Écris directement avec de vraies apostrophes françaises (').\n" +
      "3. Conserve impérativement les montants financiers, dates, noms importants et l'action principale sans perte d'information.\n\n" +
      "INSTRUCTIONS SUR LES CHAMPS PAR E-MAIL :\n" +
      "- summary : Résumé clair de la situation en 1 à 2 phrases courtes maximum.\n" +
      "- priority : 'CRITICAL' (incident en cours, panne de déploiement CI/CD, urgence bloquante), 'HIGH' (décision importante requise, facture client à régler, demande directe), 'MEDIUM' (e-mail utile sans urgence immédiate), ou 'LOW' (notification automatique, alerte de connexion, offre commerciale).\n" +
      "- actionRequired : true si l'utilisateur doit accomplir une action concrète ou répondre aujourd'hui, false sinon.\n" +
      "- actionTitle : Titre court et percutant de l'action en quelques mots (ex: 'Examiner l'échec de déploiement GitHub', 'Régler la facture Stripe', 'Valider le devis'). Si aucune action : 'Aucune action'.\n" +
      "- action : Description simple de l'action à mener en 1 phrase.\n" +
      "- needsReply : 'oui', 'non', ou 'probablement'.\n" +
      "- deadline : Échéance explicite ou déduite (ex: 'Aujourd'hui', 'Avant 17h', 'Demain') ou null si aucune échéance.\n" +
      "- category : Choisis impérativement l'une de ces catégories françaises exactes :\n" +
      "  '🛡️ Sécurité & Alertes comptes',\n" +
      "  '💼 Opportunités & Emploi',\n" +
      "  '🏷️ Achats & Bons plans',\n" +
      "  '✈️ Voyages & Découvertes',\n" +
      "  '📊 Projets & Code',\n" +
      "  '💶 Finances & Factures',\n" +
      "  'ℹ️ Informations générales'.\n" +
      "- estimatedActionMinutes : Estimation réaliste du temps requis pour agir (5, 10, 15, 30...) ou 0 si aucune action.";

    const responseSchema = {
      type: 'ARRAY',
      description: 'Liste des analyses pour chaque e-mail',
      items: {
        type: 'OBJECT',
        properties: {
          emailId: { type: 'STRING' },
          summary: { type: 'STRING' },
          priority: { type: 'STRING', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          actionRequired: { type: 'BOOLEAN' },
          actionTitle: { type: 'STRING' },
          action: { type: 'STRING' },
          needsReply: { type: 'STRING', enum: ['oui', 'non', 'probablement'] },
          deadline: { type: 'STRING' },
          category: {
            type: 'STRING',
            enum: [
              '🛡️ Sécurité & Alertes comptes',
              '💼 Opportunités & Emploi',
              '🏷️ Achats & Bons plans',
              '✈️ Voyages & Découvertes',
              '📊 Projets & Code',
              '💶 Finances & Factures',
              'ℹ️ Informations générales'
            ]
          },
          estimatedActionMinutes: { type: 'INTEGER' }
        },
        required: ['emailId', 'summary', 'priority', 'actionRequired', 'actionTitle', 'action', 'needsReply', 'category']
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
                '\n\nVoici les e-mails à analyser :\n' +
                JSON.stringify(emailsPayload)
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
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
    } catch (networkErr) {
      const netEx = new Error('Erreur réseau de communication avec l’API : ' + networkErr.message);
      netEx.statusCode = 0;
      throw netEx;
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
      const emptyErr = new Error('Réponse Gemini vide ou format inattendu.');
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
            summary: Utils.stripHtmlAndMarkdown(item.summary || 'Résumé indisponible.'),
            priority: item.priority || 'MEDIUM',
            actionRequired: Boolean(item.actionRequired),
            actionTitle: Utils.stripHtmlAndMarkdown(item.actionTitle || (item.actionRequired ? 'Action requise' : 'Aucune action')),
            action: Utils.stripHtmlAndMarkdown(item.action || 'Aucune action'),
            needsReply: item.needsReply || 'non',
            deadline: item.deadline && item.deadline !== 'Aucune' ? Utils.stripHtmlAndMarkdown(item.deadline) : null,
            category: item.category || 'ℹ️ Informations générales',
            estimatedActionMinutes: item.estimatedActionMinutes || 0
          };
        }
      }
    }

    return resultMap;
  }

  /**
   * Données de secours fiables (Graceful Fallback) en cas d'erreur de lot.
   */
  function getFallbackAiData(msg) {
    const sender = Utils.cleanSenderName(msg.from);
    const subject = Utils.stripHtmlAndMarkdown(msg.subject) || 'Nouveau message reçu';
    const duplicateNotice = msg.duplicateCount > 1 ? ' (' + msg.duplicateCount + ' e-mails reçus)' : '';

    return {
      summary: sender + duplicateNotice + ' : ' + subject,
      priority: 'MEDIUM',
      actionRequired: false,
      actionTitle: 'Aucune action',
      action: 'Vérifier l’e-mail directement si nécessaire.',
      needsReply: 'non',
      deadline: null,
      category: 'ℹ️ Informations générales',
      estimatedActionMinutes: 2
    };
  }

  return {
    analyzeEmails: analyzeEmails
  };
})();
