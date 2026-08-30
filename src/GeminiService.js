/**
 * Google CC Briefing Agent
 * GeminiService.js — Analyse par Gemini API (Google AI Studio Free Tier), sorties structurées & résilience
 */

const GeminiService = (function () {
  /**
   * Analyse une liste de messages e-mails via l'API Gemini par lots.
   * @param {Array<Object>} emailsList - Messages nettoyés
   * @return {Array<Object>} Messages enrichis avec résumé ELI15, priorités, actions
   */
  function analyzeEmails(emailsList) {
    if (!emailsList || emailsList.length === 0) {
      return [];
    }

    const apiKey = Config.getGeminiApiKey();
    const batchSize = Config.DEFAULTS.BATCH_SIZE;
    const enrichedResults = [];

    for (let i = 0; i < emailsList.length; i += batchSize) {
      const batch = emailsList.slice(i, i + batchSize);
      console.log(
        'Analyse du lot Gemini ' +
          (Math.floor(i / batchSize) + 1) +
          '/' +
          Math.ceil(emailsList.length / batchSize) +
          ' (' +
          batch.length +
          ' e-mails)...'
      );

      const batchAnalysis = analyzeBatchWithRetry(batch, apiKey);

      // Fusion des résultats structurés avec les métadonnées locales
      for (let b = 0; b < batch.length; b++) {
        const originalMsg = batch[b];
        const aiData = batchAnalysis[originalMsg.id] || getFallbackAiData(originalMsg);

        enrichedResults.push(Object.assign({}, originalMsg, aiData));
      }

      // Petite pause préventive entre les lots pour respecter le rate limit Free Tier (15 RPM)
      if (i + batchSize < emailsList.length) {
        Utilities.sleep(1200);
      }
    }

    return enrichedResults;
  }

  /**
   * Traite un lot avec retry et backoff exponentiel.
   */
  function analyzeBatchWithRetry(batch, apiKey) {
    let model = Config.getGeminiModel();
    let retries = 0;
    let delay = Config.DEFAULTS.INITIAL_BACKOFF_MS;

    while (retries < Config.DEFAULTS.MAX_RETRIES) {
      try {
        return callGeminiApi(batch, apiKey, model);
      } catch (e) {
        console.warn('Erreur Gemini (tentative ' + (retries + 1) + ') : ' + e.message);

        // Si le modèle n'est pas trouvé (404), basculer sur le modèle de fallback
        if (e.message.indexOf('404') !== -1 && model !== Config.DEFAULTS.GEMINI_FALLBACK_MODEL) {
          console.info('Bascule automatique sur le modèle de secours : ' + Config.DEFAULTS.GEMINI_FALLBACK_MODEL);
          model = Config.DEFAULTS.GEMINI_FALLBACK_MODEL;
          continue;
        }

        retries++;
        if (retries >= Config.DEFAULTS.MAX_RETRIES) {
          console.error('Échec définitif du lot Gemini après ' + retries + ' tentatives.');
          break;
        }

        // Backoff exponentiel
        Utilities.sleep(delay);
        delay *= 2;
      }
    }

    // En cas d'échec complet du lot, retourner un dictionnaire vide (les messages utiliseront le fallback sécurisé)
    return {};
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
        expediteur: msg.from,
        destinataireCompte: msg.targetAccount ? msg.targetAccount.label : '',
        objet: msg.subject,
        date: msg.dateFormatted + ' ' + msg.timeFormatted,
        contenu: msg.body
      };
    });

    const systemPrompt =
      "Tu es l'analyste principal du Google CC Briefing Agent. " +
      'Pour chaque e-mail fourni, analyse son contenu et fournis une analyse rigoureuse en FRANÇAIS simple : ' +
      '1. summary : Résumé en français très simple, niveau ELI15 (compréhensible par un adolescent de 15 ans), en 1 à 2 phrases MAXIMUM. ' +
      'Sois naturel, direct et explicite. Conserve impérativement les noms importants, montants, dates et la demande principale. Évite tout jargon technique. ' +
      '2. priority : "CRITICAL" (urgent, incident de production, échec de build/déploiement, deadline aujourd\'hui), ' +
      '"HIGH" (demande importante d\'un client/collaborateur, facture à régler, décision requise), ' +
      '"MEDIUM" (utile mais sans urgence immédiate), ou "LOW" (newsletter, notification automatique de sécurité ou d\'emploi, promo). ' +
      '3. actionRequired : true si une action concrète ou une réponse est requise de la part de l\'utilisateur, false sinon. ' +
      '4. actionTitle : Titre court et percutant de l\'action (ex: "Corriger l\'échec de déploiement GitHub", "Valider le devis client", "Confirmer le rendez-vous"), ou "Aucune action". ' +
      '5. action : Description concise de ce qu\'il faut faire, ou "Aucune action". ' +
      '6. needsReply : "oui", "non", ou "probablement". ' +
      '7. deadline : Échéance explicite ou déduite (ex: "Aujourd\'hui", "Avant 17h", "Demain"), ou "Aucune". ' +
      '8. category : Choisis impérativement parmi : "Sécurité & Accès", "Opportunités & Emploi", "Projets & Code", "Finance & Factures", "Offres & Achats", "Voyages & Loisirs", "Notifications générales". ' +
      '9. estimatedActionMinutes : Estimation réaliste en minutes pour traiter l\'action (5, 10, 15, 30...).';

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
          category: { type: 'STRING' },
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
                '\n\nVoici les e-mails à analyser sous forme JSON :\n' +
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

    const response = UrlFetchApp.fetch(endpoint, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      throw new Error('HTTP ' + statusCode + ' : ' + responseText.substring(0, 300));
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
      throw new Error('Réponse Gemini vide ou format inattendu.');
    }

    const parsedArray = JSON.parse(candidateText);
    const resultMap = {};

    if (Array.isArray(parsedArray)) {
      for (let i = 0; i < parsedArray.length; i++) {
        const item = parsedArray[i];
        if (item && item.emailId) {
          resultMap[item.emailId] = {
            summary: item.summary || 'Résumé indisponible.',
            priority: item.priority || 'MEDIUM',
            actionRequired: Boolean(item.actionRequired),
            actionTitle: item.actionTitle || (item.actionRequired ? 'Action requise' : 'Aucune action'),
            action: item.action || 'Aucune action',
            needsReply: item.needsReply || 'non',
            deadline: item.deadline && item.deadline !== 'Aucune' ? item.deadline : null,
            category: item.category || 'Général',
            estimatedActionMinutes: item.estimatedActionMinutes || 0
          };
        }
      }
    }

    return resultMap;
  }

  /**
   * Données de secours fiables si Gemini ne parvient pas à analyser un message particulier.
   */
  function getFallbackAiData(msg) {
    return {
      summary: msg.subject ? 'Objet : ' + msg.subject : 'Nouveau message reçu.',
      priority: 'MEDIUM',
      actionRequired: false,
      actionTitle: 'Aucune action',
      action: 'Vérifier l’e-mail directement si nécessaire.',
      needsReply: 'non',
      deadline: null,
      category: 'Notifications générales',
      estimatedActionMinutes: 2
    };
  }

  return {
    analyzeEmails: analyzeEmails
  };
})();
