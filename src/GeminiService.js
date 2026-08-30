/**
 * Google CC Briefing Agent
 * GeminiService.js — Intégration de l'API Gemini Developer (Google AI Studio Free Tier),
 * sorties structurées JSON en français pur, résilience et gestion des quotas.
 */

const GeminiService = (function () {
  /**
   * Analyse une liste de messages e-mails via l'API Gemini par lots de taille raisonnable.
   * @param {Array<Object>} emailsList - Messages nettoyés
   * @return {Array<Object>} Messages enrichis avec résumé ELI15, priorités, actions et catégories françaises
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

      // Pause préventive entre les lots pour respecter le rate limit Free Tier
      if (i + batchSize < emailsList.length) {
        Utilities.sleep(1200);
      }
    }

    return enrichedResults;
  }

  /**
   * Traite un lot avec retry et backoff exponentiel en cas de saturation temporaire (429 ou 503).
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
        expediteur: Utils.cleanSenderName(msg.from),
        destinataireCompte: msg.targetAccount ? msg.targetAccount.label : '',
        objet: Utils.decodeHtmlEntities(msg.subject),
        date: msg.dateFormatted + ' ' + msg.timeFormatted,
        contenu: msg.body
      };
    });

    const systemPrompt =
      "Tu es l'analyste en chef du Google CC Briefing Agent. Ton rôle est de fournir des synthèses matinales limpides, directes et en français très simple.\n\n" +
      "RÈGLES ABSOLUES SUR LE TEXTE :\n" +
      "1. Réponds STRICTEMENT en français simple et naturel (niveau ELI15, compréhensible par un adolescent de 15 ans).\n" +
      "2. N'inclus JAMAIS de balises HTML (comme <strong>, <b>, <em>, <br>) ni de syntaxe Markdown (comme **texte**) à l'intérieur des valeurs texte de ta réponse.\n" +
      "3. Conserve impérativement les montants d'argent, dates, noms importants et l'action principale. Ne perds aucune information critique.\n\n" +
      "INSTRUCTIONS SUR LES CHAMPS PAR E-MAIL :\n" +
      "- summary : Résumé clair de la situation en 1 à 2 phrases courtes maximum.\n" +
      "- priority : 'CRITICAL' (incident en cours, panne de déploiement, urgence bloquante), 'HIGH' (décision importante requise, facture client, demande directe), 'MEDIUM' (e-mail utile sans urgence), ou 'LOW' (simple notification, alerte de connexion, offre commerciale).\n" +
      "- actionRequired : true si l'utilisateur doit faire une action ou donner une réponse, false sinon.\n" +
      "- actionTitle : Titre court et percutant de l'action en quelques mots (ex: 'Examiner l'échec de déploiement GitHub', 'Régler la facture Stripe', 'Valider le devis'). Si aucune action : 'Aucune action'.\n" +
      "- action : Description simple de ce qu'il faut faire en 1 phrase.\n" +
      "- needsReply : 'oui', 'non', ou 'probablement'.\n" +
      "- deadline : Échéance explicite ou déduite (ex: 'Aujourd'hui', 'Avant 17h', 'Demain') ou null si aucune échéance.\n" +
      "- category : Choisis impérativement l'une de ces catégories françaises exactes :\n" +
      "  'Sécurité & Alertes',\n" +
      "  'Opportunités & Emploi',\n" +
      "  'Achats & Bons plans',\n" +
      "  'Voyages & Loisirs',\n" +
      "  'Finance & Factures',\n" +
      "  'Projets & Code',\n" +
      "  'Informations générales'.\n" +
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
              'Sécurité & Alertes',
              'Opportunités & Emploi',
              'Achats & Bons plans',
              'Voyages & Loisirs',
              'Finance & Factures',
              'Projets & Code',
              'Informations générales'
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
            summary: Utils.stripHtmlAndMarkdown(item.summary || 'Résumé indisponible.'),
            priority: item.priority || 'MEDIUM',
            actionRequired: Boolean(item.actionRequired),
            actionTitle: Utils.stripHtmlAndMarkdown(item.actionTitle || (item.actionRequired ? 'Action requise' : 'Aucune action')),
            action: Utils.stripHtmlAndMarkdown(item.action || 'Aucune action'),
            needsReply: item.needsReply || 'non',
            deadline: item.deadline && item.deadline !== 'Aucune' ? Utils.stripHtmlAndMarkdown(item.deadline) : null,
            category: item.category || 'Informations générales',
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
      summary: msg.subject ? 'Objet : ' + Utils.stripHtmlAndMarkdown(msg.subject) : 'Nouveau message reçu.',
      priority: 'MEDIUM',
      actionRequired: false,
      actionTitle: 'Aucune action',
      action: 'Vérifier l’e-mail directement si nécessaire.',
      needsReply: 'non',
      deadline: null,
      category: 'Informations générales',
      estimatedActionMinutes: 2
    };
  }

  return {
    analyzeEmails: analyzeEmails
  };
})();
