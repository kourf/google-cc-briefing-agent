/**
 * Google CC Briefing Agent
 * GeminiService.js — Analyse IA avec Gemini 2.0 Flash en lot unique,
 * élimination des erreurs HTTP 429, structuration en 3 niveaux et mise en valeur des points clés.
 */

const GeminiService = (function () {
  /**
   * Analyse l'ensemble des e-mails dédupliqués en UN SEUL appel optimisé pour éliminer les erreurs de quota 429.
   *
   * @param {Array<Object>} emailsList - Liste des e-mails dédupliqués
   * @return {Array<Object>} E-mails enrichis de leur analyse IA
   */
  function analyzeEmails(emailsList) {
    if (!emailsList || emailsList.length === 0) {
      return [];
    }

    const apiKey = Config.getGeminiApiKey();
    const batchSize = Config.DEFAULTS.BATCH_SIZE || 25;
    const enrichedResults = [];

    // Si le nombre d'e-mails est inférieur ou égal au batchSize (cas standard de 10-20 e-mails), 1 seul appel est fait
    for (let i = 0; i < emailsList.length; i += batchSize) {
      const batch = emailsList.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(emailsList.length / batchSize);

      console.log(
        'Analyse du lot Gemini ' +
          batchIndex +
          '/' +
          totalBatches +
          ' (' +
          batch.length +
          ' e-mails traités simultanément)...'
      );

      const batchAnalysis = analyzeBatchWithRetry(batch, apiKey, batchIndex, totalBatches);

      for (let b = 0; b < batch.length; b++) {
        const originalMsg = batch[b];
        const aiData = batchAnalysis[originalMsg.id] || getFallbackAiData(originalMsg);
        enrichedResults.push(Object.assign({}, originalMsg, aiData));
      }

      // Si plusieurs lots nécessaires (rare), pause préventive de 2s
      if (i + batchSize < emailsList.length) {
        Utilities.sleep(2000);
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
    const baseDelayMs = Config.DEFAULTS.INITIAL_BACKOFF_MS || 2000;
    const transientStatusCodes = [429, 500, 502, 503, 504];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return callGeminiApi(batch, apiKey, model);
      } catch (e) {
        const statusCode = e.statusCode || 0;
        const sanitizedMsg = Utils.redactSensitive(e.message);

        // Bascule automatique si le modèle est introuvable (404)
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
   * Effectue la requête HTTP vers Gemini avec sortie JSON native et règles strictes.
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
      "Tu es l'assistant exécutif d'élite de 'Mon Briefing Quotidien'. Ta mission est de synthétiser les e-mails de la journée avec un niveau d'exigence maximal, lisible en un coup d'œil.\n\n" +
      "RÈGLES DE RÉDACTION STRICTES :\n" +
      "1. Rédige TOUJOURS en français direct, limpide et naturel.\n" +
      "2. TRADUCTION OBLIGATOIRE : Traduis impérativement les sujets et contenus en anglais (ex: Lumosity, GitHub, newsletters) en français élégant.\n" +
      "3. METS EN GRAS (**) les éléments clés dans chaque résumé (noms propres, entreprises, montants en euros, remises ou délais).\n" +
      "4. INTERDICTION FORMELLE DE BOILERPLATE ROBOTIQUE :\n" +
      "   - Ne commence JAMAIS par '[Expéditeur] vous a envoyé un e-mail'.\n" +
      "   - N'écris JAMAIS 'Aucune action requise' dans le résumé.\n" +
      "   - N'utilise JAMAIS de symboles mathématiques ($) ou d'entités HTML brutes (&amp;, &#039;).\n" +
      "5. Chaque résumé ('summary') doit faire STRICTEMENT 1 SEULE phrase active expliquant l'information essentielle.\n" +
      "   Exemples de qualité attendue :\n" +
      "   - 'Twistshake propose jusqu'à **-50%** de réduction immédiate sur l'ensemble de la boutique avec un code promo.'\n" +
      "   - 'easyJet annonce des billets d'avion vers le **Maroc** à partir de **29 €** pour les prochaines vacances.'\n" +
      "   - 'GitHub confirme que la pull request **Refactor daily briefing format** a été fusionnée sur la branche principale.'\n" +
      "   - 'Lumosity vous invite à découvrir une nouvelle série d'entraînements personnalisés pour la **mémoire** et la **concentration**.'\n" +
      "6. Pour le champ 'category', choisis la sous-catégorie la plus pertinente parmi :\n" +
      "   - 'Emploi & Carrière' (LinkedIn, HelloWork, France Travail, recruteurs)\n" +
      "   - 'Tech & Projets' (GitHub, GCP, Firebase, Vercel, serveurs, code)\n" +
      "   - 'Achats & Offres' (Promotions e-commerce, ASOS, Twistshake, commandes)\n" +
      "   - 'Santé & Démarches' (Doctolib, Qare, CPAM, démarches administratives)\n" +
      "   - 'Réseaux sociaux & Culture' (Facebook, TikTok, Instagram, Lumosity, médias)\n" +
      "   - 'Voyages & Loisirs' (easyJet, GetYourGuide, SNCF, hôtels)\n" +
      "   - 'Sécurité & Accès' (Alertes de compte Google, 2FA, codes OTP)\n" +
      "   - 'Actualités & Veille' (Newsletters d'information générale, revues de presse)\n" +
      "7. Pour 'actionRequired' : définis à true UNIQUEMENT si une intervention humaine urgente est indispensable aujourd'hui (ex: facture impayée, panne bloquante, réponse impérative avant une date butoir).";

    const responseSchema = {
      type: 'ARRAY',
      description: 'Liste des analyses pour chaque e-mail',
      items: {
        type: 'OBJECT',
        properties: {
          emailId: { type: 'STRING' },
          category: {
            type: 'STRING',
            description: "Nom de la sous-catégorie (ex: 'Emploi & Carrière', 'Tech & Projets', 'Achats & Offres')"
          },
          summary: {
            type: 'STRING',
            description: '1 phrase concise et active en français avec termes clés en gras (**)'
          },
          actionRequired: { type: 'BOOLEAN' },
          actionTitle: {
            type: 'STRING',
            description: "Action clé en 3 à 5 mots (ex: 'Payer la facture de 450 €') ou vide si aucune action"
          },
          deadline: { type: 'STRING', description: "Date/heure limite si applicable (ex: 'Aujourd'hui 18h') ou null" },
          estimatedMinutes: { type: 'INTEGER', description: "Durée estimée de l'action en minutes (ex: 5, 10)" }
        },
        required: ['emailId', 'category', 'summary', 'actionRequired']
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
    let responseText = response.getContentText();

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

    // Nettoyage robuste pour éviter les erreurs d'analyse JSON
    let cleanedJsonText = candidateText.trim();
    cleanedJsonText = cleanedJsonText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsedArray;
    try {
      parsedArray = JSON.parse(cleanedJsonText);
    } catch (parseErr) {
      const sanitizedJson = cleanedJsonText.replace(/[\u0000-\u001F]+/g, ' ');
      parsedArray = JSON.parse(sanitizedJson);
    }

    const resultMap = {};

    if (Array.isArray(parsedArray)) {
      for (let i = 0; i < parsedArray.length; i++) {
        const item = parsedArray[i];
        if (item && item.emailId) {
          resultMap[item.emailId] = {
            category: item.category ? Utils.cleanText(item.category) : 'Actualités & Veille',
            summary: item.summary ? String(item.summary).trim() : 'Nouvelles informations partagées.',
            actionRequired: Boolean(item.actionRequired),
            actionTitle: item.actionTitle ? Utils.cleanText(item.actionTitle) : (item.actionRequired ? 'Action requise' : ''),
            deadline: item.deadline && item.deadline !== 'null' && item.deadline !== 'Aucune' ? Utils.cleanText(item.deadline) : null,
            estimatedMinutes: item.estimatedMinutes || 5
          };
        }
      }
    }

    return resultMap;
  }

  /**
   * Mode dégradé élégant sans répétition de l'expéditeur si Gemini échoue.
   */
  function getFallbackAiData(msg) {
    const cleanSubj = Utils.cleanText(msg.subject) || 'Nouveau message';
    const lower = (msg.from + ' ' + msg.subject).toLowerCase();

    let cat = 'Actualités & Veille';
    let summary = cleanSubj;

    if (lower.indexOf('github') !== -1 || lower.indexOf('firebase') !== -1 || lower.indexOf('cloud') !== -1) {
      cat = 'Tech & Projets';
      summary = 'Mise à jour sur le projet : ' + cleanSubj;
    } else if (lower.indexOf('linkedin') !== -1 || lower.indexOf('hellowork') !== -1 || lower.indexOf('emploi') !== -1 || lower.indexOf('candidat') !== -1) {
      cat = 'Emploi & Carrière';
      summary = 'Nouvelles opportunités professionnelles : ' + cleanSubj;
    } else if (lower.indexOf('easyjet') !== -1 || lower.indexOf('getyourguide') !== -1 || lower.indexOf('voyage') !== -1) {
      cat = 'Voyages & Loisirs';
      summary = 'Offre de séjour et voyage : ' + cleanSubj;
    } else if (lower.indexOf('asos') !== -1 || lower.indexOf('twistshake') !== -1 || lower.indexOf('aprizo') !== -1 || lower.indexOf('promo') !== -1 || lower.indexOf('solde') !== -1) {
      cat = 'Achats & Offres';
      summary = 'Offre promotionnelle : ' + cleanSubj;
    } else if (lower.indexOf('doctolib') !== -1 || lower.indexOf('qare') !== -1 || lower.indexOf('sante') !== -1) {
      cat = 'Santé & Démarches';
      summary = 'Notification médicale ou administrative : ' + cleanSubj;
    } else if (lower.indexOf('tiktok') !== -1 || lower.indexOf('facebook') !== -1 || lower.indexOf('instagram') !== -1) {
      cat = 'Réseaux sociaux & Culture';
      summary = 'Activité récente sur votre réseau : ' + cleanSubj;
    } else if (lower.indexOf('securite') !== -1 || lower.indexOf('connexion') !== -1 || lower.indexOf('google') !== -1) {
      cat = 'Sécurité & Accès';
      summary = 'Alerte de sécurité de compte : ' + cleanSubj;
    }

    return {
      category: cat,
      summary: summary,
      actionRequired: false,
      actionTitle: '',
      deadline: null,
      estimatedMinutes: 0
    };
  }

  return {
    analyzeEmails: analyzeEmails
  };
})();
