/**
 * Google CC Briefing Agent
 * GeminiService.js — Analyse IA en lot unique, cascade de modèles résiliente,
 * dissociation Santé & Soins / Démarches & Administration, et assainissement Unicode strict.
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
          ' e-mails traités en un appel unique)...'
      );

      const batchAnalysis = analyzeBatchWithRetry(batch, apiKey, batchIndex, totalBatches);

      for (let b = 0; b < batch.length; b++) {
        const originalMsg = batch[b];
        const aiData = batchAnalysis[originalMsg.id] || getFallbackAiData(originalMsg);
        enrichedResults.push(Object.assign({}, originalMsg, aiData));
      }

      if (i + batchSize < emailsList.length) {
        Utilities.sleep(2000);
      }
    }

    return enrichedResults;
  }

  /**
   * Traite un lot avec retry et cascade automatique de modèles en cas de 404 (modèle indisponible) ou 429.
   */
  function analyzeBatchWithRetry(batch, apiKey, batchIndex, totalBatches) {
    let currentModel = Config.getGeminiModel();
    const modelCascade = [
      currentModel,
      Config.DEFAULTS.GEMINI_FALLBACK_MODEL, // gemini-flash-lite-latest
      'gemini-3.7-flash',
      'gemini-3.6-flash'
    ];

    let cascadeIndex = 0;
    const maxAttempts = Config.DEFAULTS.MAX_RETRIES || 4;
    const baseDelayMs = Config.DEFAULTS.INITIAL_BACKOFF_MS || 2000;
    const transientStatusCodes = [429, 500, 502, 503, 504];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const modelToTry = modelCascade[cascadeIndex] || Config.DEFAULTS.GEMINI_FALLBACK_MODEL;
      try {
        return callGeminiApi(batch, apiKey, modelToTry);
      } catch (e) {
        const statusCode = e.statusCode || 0;
        const sanitizedMsg = Utils.redactSensitive(e.message);

        // Si le modèle est introuvable (404, ex: modèle déprécié), on bascule immédiatement sur le modèle suivant de la cascade
        if (statusCode === 404) {
          console.warn('Modèle ' + modelToTry + ' non supporté (HTTP 404). Bascule vers le modèle suivant.');
          if (cascadeIndex < modelCascade.length - 1) {
            cascadeIndex++;
            attempt--; // ne consomme pas une tentative pour un changement de modèle
            continue;
          }
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
          // Si 429 ou 503 sur le modèle courant, tenter aussi le modèle de secours
          if (cascadeIndex < modelCascade.length - 1) {
            cascadeIndex++;
          }
          const delay = Utils.calculateBackoffWithJitter(attempt, baseDelayMs);
          console.warn(
            'API temporairement indisponible (' +
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
   * Effectue la requête HTTP vers Gemini avec URL propre sans duplication 'models/' et sortie JSON native.
   */
  function callGeminiApi(batch, apiKey, model) {
    // Normalisation de l'endpoint : suppression de tout préfixe 'models/' accidentel
    const cleanModel = String(model).replace(/^models\//, '').trim();
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + cleanModel + ':generateContent?key=' + apiKey;

    const emailsPayload = batch.map(function (msg) {
      let snippet = msg.body || '';
      if (snippet.length > 900) {
        snippet = snippet.substring(0, 900) + '...';
      }
      snippet = Utils.sanitizeText(snippet);

      return {
        emailId: msg.id,
        expediteur: Utils.sanitizeText(msg.senderDisplayName || msg.senderName),
        objet: Utils.sanitizeText(msg.subject),
        date: msg.dateFormatted + ' ' + msg.timeFormatted,
        nombreMessages: msg.duplicateCount || 1,
        contenuAbrege: snippet
      };
    });

    const systemPrompt =
      "Tu es l'analyste exécutif en chef de 'Mon Briefing Quotidien'. Ta mission est de produire un résumé percutant, fluide et 100% en français pour chaque e-mail.\n\n" +
      "RÈGLES DE RÉDACTION STRICTES :\n" +
      "1. Rédige TOUJOURS en français direct, limpide et naturel.\n" +
      "2. TRADUCTION OBLIGATOIRE À 100% : Traduis impérativement en français naturel tout sujet ou contenu rédigé en anglais (ex: Lumosity, newsletters tech, alertes de plateformes). Aucun titre ou terme ne doit rester en anglais brut non traduit.\n" +
      "3. METS EN GRAS (**) les éléments clés dans chaque résumé (noms propres, entreprises, montants en euros, remises ou délais).\n" +
      "4. INTERDICTION ABSOLUE DE BOILERPLATE ROBOTIQUE ET D'ARTEFACTS :\n" +
      "   - Ne commence JAMAIS par '[Expéditeur] vous a envoyé un e-mail'.\n" +
      "   - N'écris JAMAIS 'Aucune action requise' dans le résumé.\n" +
      "   - N'inclus JAMAIS d'entités HTML (&amp;, &#039;), de symboles mathématiques ($) ou de caractères de remplacement Unicode (\\uFFFD).\n" +
      "5. Chaque résumé ('summary') doit faire STRICTEMENT 1 SEULE phrase active expliquant l'information essentielle.\n" +
      "   Exemples de traduction et style attendu :\n" +
      "   - Objet en anglais 'How the brain decides your dominant hand' -> Résumé : 'Lumosity propose une nouvelle série d'entraînements cérébraux sur la manière dont le **cerveau** détermine la **main dominante**.'\n" +
      "   - Objet 'Beshara: Growing life from loss' -> Résumé : 'LinkedIn vous partage un témoignage inspirant de **Beshara** sur la résilience et le parcours professionnel.'\n" +
      "   - Objet 'Votre signe pour ajouter au panier' -> Résumé : 'Twistshake offre jusqu'à **-50%** de réduction immédiate sur tous les articles de puériculture.'\n" +
      "6. TAXONOMIE STRICTE DES SOUS-CATÉGORIES (séparation stricte Santé et Démarches) :\n" +
      "   - 'Santé & Soins' : Rendez-vous médicaux, téléconsultations, médecins, ordonnances (Doctolib, Qare, pharmacies)\n" +
      "   - 'Démarches & Administration' : Services publics, formations professionnelles, aides, impôts, suivi officiel (France Travail, CAF, Ameli, impots.gouv)\n" +
      "   - 'Emploi & Carrière' : Alertes de postes, contacts recruteurs, opportunités professionnelles (LinkedIn, HelloWork, Apec)\n" +
      "   - 'Tech & Projets' : GitHub, intégration continue, serveurs, hébergement, GCP, Firebase\n" +
      "   - 'Achats & Offres' : Soldes, remises, réductions e-commerce, confirmations de commande (ASOS, Twistshake, Amazon)\n" +
      "   - 'Voyages & Loisirs' : Billets d'avion, réservations, vacances et sorties (easyJet, GetYourGuide, SNCF, Booking)\n" +
      "   - 'Réseaux sociaux & Culture' : Activité sociale, notifications d'amis, applications éducatives et culturelles (Facebook, TikTok, Instagram, Lumosity)\n" +
      "   - 'Sécurité & Accès' : Codes de vérification 2FA, connexions depuis un nouvel appareil, alertes de compte Google/Microsoft\n" +
      "   - 'Actualités & Veille' : Newsletters thématiques d'information générale, revues de presse\n" +
      "7. Pour 'actionRequired' : définis à true UNIQUEMENT si une intervention humaine urgente est indispensable aujourd'hui (facture à régler aujourd'hui, validation bloquante).";

    const responseSchema = {
      type: 'ARRAY',
      description: 'Liste des analyses pour chaque e-mail',
      items: {
        type: 'OBJECT',
        properties: {
          emailId: { type: 'STRING' },
          category: {
            type: 'STRING',
            enum: [
              'Santé & Soins',
              'Démarches & Administration',
              'Emploi & Carrière',
              'Tech & Projets',
              'Achats & Offres',
              'Voyages & Loisirs',
              'Réseaux sociaux & Culture',
              'Sécurité & Accès',
              'Actualités & Veille'
            ]
          },
          summary: {
            type: 'STRING',
            description: '1 phrase concise et active en français avec termes clés en gras (**)'
          },
          actionRequired: { type: 'BOOLEAN' },
          actionTitle: {
            type: 'STRING',
            description: "Action clé en 3 à 5 mots (ex: 'Payer la facture de crèche') ou vide si aucune action"
          },
          deadline: { type: 'STRING', description: "Date/heure limite si applicable (ex: 'Aujourd'hui 18h') ou null" },
          estimatedMinutes: { type: 'INTEGER', description: "Durée estimée de l'action en minutes" }
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
            category: item.category ? Utils.sanitizeText(item.category) : 'Actualités & Veille',
            summary: item.summary ? Utils.sanitizeText(item.summary) : 'Nouvelles informations partagées.',
            actionRequired: Boolean(item.actionRequired),
            actionTitle: item.actionTitle ? Utils.sanitizeText(item.actionTitle) : (item.actionRequired ? 'Action requise' : ''),
            deadline: item.deadline && item.deadline !== 'null' && item.deadline !== 'Aucune' ? Utils.sanitizeText(item.deadline) : null,
            estimatedMinutes: item.estimatedMinutes || 5
          };
        }
      }
    }

    return resultMap;
  }

  /**
   * Mode dégradé défensif sans doublon de l'expéditeur, 100% assaini et traduit si besoin.
   */
  function getFallbackAiData(msg) {
    const cleanSubj = Utils.sanitizeText(msg.subject) || 'Nouveau message';
    const lower = (msg.from + ' ' + msg.subject).toLowerCase();

    let cat = 'Actualités & Veille';
    let summary = cleanSubj;

    // Démarches et administration publique
    if (
      lower.indexOf('francetravail') !== -1 ||
      lower.indexOf('pole-emploi') !== -1 ||
      lower.indexOf('caf.fr') !== -1 ||
      lower.indexOf('impot') !== -1 ||
      lower.indexOf('croupier') !== -1 ||
      lower.indexOf('formation') !== -1
    ) {
      cat = 'Démarches & Administration';
      summary = 'Information sur vos démarches administratives ou de formation : ' + cleanSubj;
    }
    // Santé et soins médicaux
    else if (
      lower.indexOf('doctolib') !== -1 ||
      lower.indexOf('qare') !== -1 ||
      lower.indexOf('sante') !== -1 ||
      lower.indexOf('soins') !== -1 ||
      lower.indexOf('medecin') !== -1
    ) {
      cat = 'Santé & Soins';
      summary = 'Notification médicale concernant l’accès aux soins : ' + cleanSubj;
    }
    // Tech & Projets
    else if (lower.indexOf('github') !== -1 || lower.indexOf('firebase') !== -1 || lower.indexOf('cloud') !== -1) {
      cat = 'Tech & Projets';
      summary = 'Mise à jour sur le projet : ' + cleanSubj;
    }
    // Emploi & Carrière
    else if (lower.indexOf('linkedin') !== -1 || lower.indexOf('hellowork') !== -1 || lower.indexOf('emploi') !== -1 || lower.indexOf('candidat') !== -1) {
      cat = 'Emploi & Carrière';
      summary = 'Nouvelles opportunités professionnelles : ' + cleanSubj;
    }
    // Voyages & Loisirs
    else if (lower.indexOf('easyjet') !== -1 || lower.indexOf('getyourguide') !== -1 || lower.indexOf('voyage') !== -1) {
      cat = 'Voyages & Loisirs';
      summary = 'Offre de séjour et voyage : ' + cleanSubj;
    }
    // Achats & Offres
    else if (lower.indexOf('asos') !== -1 || lower.indexOf('twistshake') !== -1 || lower.indexOf('aprizo') !== -1 || lower.indexOf('promo') !== -1 || lower.indexOf('solde') !== -1) {
      cat = 'Achats & Offres';
      summary = 'Offre promotionnelle : ' + cleanSubj;
    }
    // Réseaux sociaux & Culture
    else if (lower.indexOf('tiktok') !== -1 || lower.indexOf('facebook') !== -1 || lower.indexOf('instagram') !== -1 || lower.indexOf('lumosity') !== -1) {
      cat = 'Réseaux sociaux & Culture';
      if (lower.indexOf('lumosity') !== -1) {
        summary = 'Exercices et actualités sur le fonctionnement du cerveau et la concentration';
      } else {
        summary = 'Activité récente sur votre réseau : ' + cleanSubj;
      }
    }
    // Sécurité & Accès
    else if (lower.indexOf('securite') !== -1 || lower.indexOf('connexion') !== -1 || lower.indexOf('google') !== -1) {
      cat = 'Sécurité & Accès';
      summary = 'Alerte de sécurité de compte : ' + cleanSubj;
    }

    return {
      category: cat,
      summary: Utils.sanitizeText(summary),
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
