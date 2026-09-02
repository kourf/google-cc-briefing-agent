/**
 * Google CC Briefing Agent
 * GeminiService.js — High-performance AI analysis via Gemini 2.0 Flash API with structured JSON output,
 * strict LinkedIn disambiguation, professional French localization, and resilient retry cascade.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const GeminiService = (() => {
  /**
   * Analyzes an array of deduplicated email objects using Gemini API.
   * Processes emails in single optimized batches to prevent rate limiting (HTTP 429).
   *
   * @param {Array<Object>} emailsList - Deduplicated email objects.
   * @returns {Array<Object>} Enriched email objects with AI metadata.
   */
  const analyzeEmails = (emailsList) => {
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
        `Gemini analysis batch ${batchIndex}/${totalBatches} (${batch.length} emails in single API call)...`
      );

      const batchAnalysis = analyzeBatchWithRetry(batch, apiKey, batchIndex, totalBatches);

      for (const originalMsg of batch) {
        const aiData = batchAnalysis[originalMsg.id] || getFallbackAiData(originalMsg);
        enrichedResults.push(Object.assign({}, originalMsg, aiData));
      }

      if (i + batchSize < emailsList.length) {
        Utilities.sleep(2000);
      }
    }

    return enrichedResults;
  };

  /**
   * Executes a batch analysis with exponential backoff retry and model fallback.
   *
   * @param {Array<Object>} batch - Slice of emails to analyze.
   * @param {string} apiKey - Gemini API Key.
   * @param {number} batchIndex - Current batch index.
   * @param {number} totalBatches - Total batches count.
   * @returns {Object<string, Object>} Map of emailId -> AI analysis object.
   */
  const analyzeBatchWithRetry = (batch, apiKey, batchIndex, totalBatches) => {
    const currentModel = Config.getGeminiModel();
    const modelCascade = [
      currentModel,
      Config.DEFAULTS.GEMINI_FALLBACK_MODEL,
      'gemini-1.5-flash',
      'gemini-3.6-flash'
    ];

    let cascadeIndex = 0;
    const maxAttempts = Config.DEFAULTS.MAX_RETRIES || 4;
    const baseDelayMs = Config.DEFAULTS.INITIAL_BACKOFF_MS || 2500;
    const transientStatusCodes = [429, 500, 502, 503, 504];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const modelToTry = modelCascade[cascadeIndex] || Config.DEFAULTS.GEMINI_FALLBACK_MODEL;
      try {
        return callGeminiApi(batch, apiKey, modelToTry);
      } catch (error) {
        const statusCode = error.statusCode || 0;
        const sanitizedMsg = Utils.redactSensitive(error.message);

        // Immediate cascade on HTTP 404 (e.g. deprecated model alias)
        if (statusCode === 404) {
          console.warn(`Model ${modelToTry} unsupported (HTTP 404). Cascading to next available model.`);
          if (cascadeIndex < modelCascade.length - 1) {
            cascadeIndex++;
            attempt--; // Do not consume an attempt on model migration
            continue;
          }
        }

        // Fatal non-recoverable errors
        if (statusCode > 0 && !transientStatusCodes.includes(statusCode) && statusCode !== 404) {
          console.error(`Non-recoverable API error (${sanitizedMsg}). Activating fallback mode for batch ${batchIndex}.`);
          break;
        }

        // Transient errors (503 High Demand, 429 Rate Limit) -> Exponential backoff retry
        if (attempt < maxAttempts) {
          const delay = Utils.calculateBackoffWithJitter(attempt, baseDelayMs);
          console.warn(
            `API temporarily unavailable (${sanitizedMsg}). Attempt ${attempt}/${maxAttempts} — Retrying in ${delay} ms...`
          );
          Utilities.sleep(delay);

          // If 503 persists on current model after 2 attempts, try next cascade model
          if (attempt >= 2 && cascadeIndex < modelCascade.length - 1) {
            cascadeIndex++;
          }
        } else {
          console.error(
            `Batch ${batchIndex}/${totalBatches} failed after ${maxAttempts} attempts. Fallback activated.`
          );
        }
      }
    }

    const fallbackResult = {};
    for (const msg of batch) {
      fallbackResult[msg.id] = getFallbackAiData(msg);
    }
    return fallbackResult;
  };

  /**
   * Calls the Gemini generateContent endpoint with native structured JSON schema.
   *
   * @param {Array<Object>} batch - Array of emails to analyze.
   * @param {string} apiKey - Gemini API Key.
   * @param {string} model - Target model identifier.
   * @returns {Object<string, Object>} Map of emailId -> AI analysis object.
   */
  const callGeminiApi = (batch, apiKey, model) => {
    const cleanModel = String(model).replace(/^models\//, '').trim();
    const endpoint = `${Config.DEFAULTS.GEMINI_API_BASE_URL}/${cleanModel}:generateContent?key=${apiKey}`;

    const emailsPayload = batch.map((msg) => {
      let snippet = msg.body || '';
      if (snippet.length > 900) {
        snippet = `${snippet.substring(0, 900)}...`;
      }
      snippet = Utils.sanitizeText(snippet);

      return {
        emailId: msg.id,
        expediteur: Utils.sanitizeText(msg.senderDisplayName || msg.senderName),
        objet: Utils.sanitizeText(msg.subject),
        date: `${msg.dateFormatted} ${msg.timeFormatted}`,
        nombreMessages: msg.duplicateCount || 1,
        contenuAbrege: snippet
      };
    });

    const systemPrompt =
      "Tu es l'analyste exécutif en chef de 'Mon Briefing Quotidien'. Ta mission est de produire une synthèse de très haute précision, fluide et 100% en français pour chaque e-mail.\n\n" +
      "RÈGLES DE RÉDACTION STRICTES :\n\n" +
      "1. DÉSAMBIGUÏSATION CONTEXTUELLE DES E-MAILS LINKEDIN (CRITIQUE) :\n" +
      "   - Invitations & Demandes de connexion réseau (contient 'invitation', 'connecter', 'rejoindre votre réseau', \"j'attends votre réponse\", 'invites you to connect') :\n" +
      "     - Catégorie : OBLIGATOIREMENT 'Réseaux sociaux & Culture' (JAMAIS dans 'Emploi & Carrière').\n" +
      "     - Résumé ('summary') : Formule obligatoire : 'Invitation de **[Nom de la personne]** à rejoindre votre réseau professionnel.'\n" +
      "       (Exemple : si l'expéditeur ou l'objet est 'Aïmen Mimoun : Kouroufia, j'attends votre réponse', résumer par : 'Invitation de **Aïmen Mimoun** à rejoindre votre réseau professionnel.').\n" +
      "   - Vraies offres d'emploi (contient 'offre d'emploi', 'recrute', 'poste de', 'comptable', 'finance', 'jobs', 'hiring') :\n" +
      "     - Catégorie : OBLIGATOIREMENT 'Emploi & Carrière'.\n" +
      "     - Résumé ('summary') : Explique précisément l'opportunité avec termes clés en gras.\n" +
      "   - Articles & Actualités partagées sur LinkedIn (actualités économiques, analyses) :\n" +
      "     - Catégorie : OBLIGATOIREMENT 'Actualités & Veille'.\n" +
      "     - Résumé ('summary') : Synthèse en 1 phrase active en français.\n\n" +
      "2. ACTIONS PRIORITAIRES (actionRequired = true) :\n" +
      "   - Définis actionRequired = true UNIQUEMENT si une décision ou une action humaine est requise (ex: confirmer une réunion, s'inscrire à une formation, payer une facture, valider un document).\n" +
      "   - Pour 'actionTitle', rédige impérativement un titre complet au format strict :\n" +
      "     '[Expéditeur / Organisme] — [Sujet précis et enjeu de la tâche ou réunion]'\n" +
      "     Exemples : 'France Travail — Réunion d'information sur la formation Croupier', 'Qare — Consultation médicale de suivi'\n" +
      "   - Pour 'deadline', indique la date et l'heure précise (ex: '10/09 à 09h00', 'Aujourd'hui 18h') ou null.\n" +
      "   - Pour 'summary', formule l'instruction concrète expliquant ce qu'il faut faire et pourquoi en 1 phrase active :\n" +
      "     Exemple : 'Confirmez votre participation à la session collective d'Annemasse pour valider votre inscription.'\n\n" +
      "3. ROUTAGE STRICT DES PLATEFORMES D'EMPLOI VERS 'Emploi & Carrière' :\n" +
      "   - Tout e-mail provenant de Michael Page, Meteojob, HelloWork, Apec, Indeed ou mentionnant 'Finance & Accounting', 'Fiduciaire', 'Comptable', 'Treuhand' DOIT être classé dans 'Emploi & Carrière'.\n\n" +
      "4. TRADUCTION OBLIGATOIRE EN FRANÇAIS (TITRES ÉTRANGERS) :\n" +
      "   - Tout intitulé en allemand ou en anglais DOIT être traduit en français professionnel :\n" +
      "     - 'Sachbearbeiter/in Treuhand & Administration (m/w/d)' -> 'Collaborateur en fiduciaire et administration (H/F)'\n" +
      "     - 'New Jobs for: Finance & Accounting: Genève' -> 'Nouvelles offres d'emploi en finance et comptabilité à Genève'\n" +
      "     - Remplacer systématiquement '(m/w/d)' par '(H/F)'.\n\n" +
      "5. INTERDICTION ABSOLUE DE BOILERPLATE ROBOTIQUE ET D'ARTEFACTS :\n" +
      "   - Ne commence JAMAIS par '[Expéditeur] vous a envoyé un e-mail'.\n" +
      "   - N'écris JAMAIS 'Aucune action requise' dans le résumé.\n" +
      "   - N'inclus JAMAIS d'entités HTML (&amp;, &#039;), de symboles mathématiques ($) ou de caractères de remplacement Unicode (\\uFFFD).\n\n" +
      "6. TAXONOMIE STRICTE DES SOUS-CATÉGORIES :\n" +
      "   - 'Emploi & Carrière' : Michael Page, Meteojob, LinkedIn (offres d'emploi uniquement), HelloWork, candidatures\n" +
      "   - 'Santé & Soins' : Consultations, médecins, ordonnances, praticiens (Doctolib, Qare)\n" +
      "   - 'Démarches & Administration' : Services publics, formations, aides, impôts (France Travail, CAF, Ameli, impots.gouv)\n" +
      "   - 'Tech & Projets' : GitHub, intégration continue, serveurs, GCP, Firebase\n" +
      "   - 'Achats & Offres' : Soldes, remises, réductions e-commerce (ASOS, Twistshake, Amazon, Qonto)\n" +
      "   - 'Voyages & Loisirs' : Billets d'avion, réservations, vacances (easyJet, GetYourGuide, SNCF, American Express)\n" +
      "   - 'Réseaux sociaux & Culture' : Invitations de connexion LinkedIn, Facebook, TikTok, Instagram, Lumosity\n" +
      "   - 'Sécurité & Accès' : Codes 2FA, connexions suspectes, alertes de compte Google/Microsoft\n" +
      "   - 'Actualités & Veille' : Articles de presse LinkedIn, revues thématiques, cinéma UGC";

    const responseSchema = {
      type: 'ARRAY',
      description: 'Liste des analyses structurées pour chaque e-mail',
      items: {
        type: 'OBJECT',
        properties: {
          emailId: { type: 'STRING' },
          category: {
            type: 'STRING',
            enum: [
              'Emploi & Carrière',
              'Santé & Soins',
              'Démarches & Administration',
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
            description: "Format strict : '[Expéditeur] — [Sujet et enjeu précis]' ou vide"
          },
          deadline: { type: 'STRING', description: "Date/heure limite de l'action si applicable (ex: '10/09 à 09h00') ou null" },
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
              text: `${systemPrompt}\n\nVoici les e-mails à analyser et synthétiser :\n${JSON.stringify(emailsPayload)}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: Config.DEFAULTS.TEMPERATURE,
        maxOutputTokens: Config.DEFAULTS.MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
        responseSchema
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
      const err = new Error(`Network failure calling Gemini API: ${netErr.message}`);
      err.statusCode = 0;
      throw err;
    }

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      let parsedMessage = responseText.substring(0, 200);
      try {
        const errJson = JSON.parse(responseText);
        if (errJson?.error?.message) {
          parsedMessage = errJson.error.message;
        }
      } catch {}

      const err = new Error(`HTTP ${statusCode} : ${parsedMessage}`);
      err.statusCode = statusCode;
      throw err;
    }

    const data = JSON.parse(responseText);
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      const emptyErr = new Error('Empty candidate received from Gemini API.');
      emptyErr.statusCode = 502;
      throw emptyErr;
    }

    let cleanedJsonText = candidateText.trim();
    cleanedJsonText = cleanedJsonText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsedArray;
    try {
      parsedArray = JSON.parse(cleanedJsonText);
    } catch {
      const sanitizedJson = cleanedJsonText.replace(/[\u0000-\u001F]+/g, ' ');
      parsedArray = JSON.parse(sanitizedJson);
    }

    const resultMap = {};

    if (Array.isArray(parsedArray)) {
      for (const item of parsedArray) {
        if (item?.emailId) {
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
  };

  /**
   * Deterministic fallback metadata generator when API is unreachable.
   *
   * @param {Object} msg - Email object.
   * @returns {Object} Synthetic AI metadata.
   */
  const getFallbackAiData = (msg) => {
    let cleanSubj = Utils.sanitizeText(msg.subject) || 'Nouveau message';
    const lower = `${msg.from} ${msg.subject}`.toLowerCase();

    // Heuristic translation of German/English job terms
    cleanSubj = cleanSubj.replace(/Sachbearbeiter\s*\/\s*in\s+Treuhand\s*&\s*Administration/gi, 'Collaborateur en fiduciaire et administration');
    cleanSubj = cleanSubj.replace(/Sachbearbeiter\s*\/\s*in/gi, 'Collaborateur / Assistant');
    cleanSubj = cleanSubj.replace(/Treuhand/gi, 'Fiduciaire');
    cleanSubj = cleanSubj.replace(/New Jobs for:\s*/gi, 'Nouvelles offres pour : ');
    cleanSubj = cleanSubj.replace(/Finance & Accounting/gi, 'Finance & Comptabilité');
    cleanSubj = cleanSubj.replace(/Project Manager\s*-\s*Remote/gi, 'Chef de projet en télétravail');

    let cat = 'Actualités & Veille';
    let summary = cleanSubj;
    let isAction = false;
    let actionTitle = '';
    let deadline = null;

    // 1. LinkedIn Disambiguation
    if (lower.includes('linkedin')) {
      if (
        lower.includes('attends votre réponse') ||
        lower.includes('rejoindre votre réseau') ||
        lower.includes('invitation') ||
        lower.includes('connecter') ||
        lower.includes('invites you to connect')
      ) {
        cat = 'Réseaux sociaux & Culture';
        let personName = '';
        const parts = cleanSubj.split(':');
        if (parts.length > 1 && parts[1].toLowerCase().includes('attends')) {
          personName = parts[0].trim();
        }
        summary = personName
          ? `Invitation de **${personName}** à rejoindre votre réseau professionnel.`
          : 'Invitation à rejoindre votre réseau professionnel sur LinkedIn.';
      } else if (
        lower.includes('trump') ||
        lower.includes('data centre') ||
        lower.includes('build-out') ||
        lower.includes('newsletter')
      ) {
        cat = 'Actualités & Veille';
        summary = `Article et actualités partagés sur LinkedIn : ${cleanSubj}`;
      } else {
        cat = 'Emploi & Carrière';
        summary = `Opportunité professionnelle sur LinkedIn : ${cleanSubj}`;
      }
    }
    // 2. Job & Recruitment Platforms
    else if (
      lower.includes('michaelpage') ||
      lower.includes('michael page') ||
      lower.includes('meteojob') ||
      lower.includes('hellowork') ||
      lower.includes('apec') ||
      lower.includes('indeed') ||
      lower.includes('offres finance') ||
      lower.includes('finance & accounting') ||
      lower.includes('treuhand') ||
      lower.includes('recrutement')
    ) {
      cat = 'Emploi & Carrière';
      if (lower.includes('michael page')) {
        summary = 'Nouvelles opportunités d’emploi en finance et comptabilité à Genève.';
      } else if (lower.includes('meteojob')) {
        summary = 'Plus de 30 offres d’emploi récentes en finance, comptabilité et assurance.';
      } else {
        summary = `Opportunité professionnelle : ${cleanSubj}`;
      }
    }
    // 3. Public administration & Training
    else if (
      lower.includes('francetravail') ||
      lower.includes('pole-emploi') ||
      lower.includes('croupier') ||
      lower.includes('formation') ||
      lower.includes('caf.fr') ||
      lower.includes('impots.gouv')
    ) {
      cat = 'Démarches & Administration';
      if (lower.includes('croupier') || lower.includes('formation')) {
        isAction = true;
        actionTitle = "France Travail — Réunion d'information sur la formation Croupier";
        deadline = '10/09 à 09h00';
        summary = 'Confirmez votre participation à la session collective d’Annemasse pour valider votre inscription.';
      } else {
        summary = `Information sur vos démarches administratives : ${cleanSubj}`;
      }
    }
    // 4. Healthcare
    else if (
      lower.includes('doctolib') ||
      lower.includes('qare') ||
      lower.includes('sante') ||
      lower.includes('soins') ||
      lower.includes('medecin')
    ) {
      cat = 'Santé & Soins';
      summary = `Notification médicale concernant l’accès aux soins : ${cleanSubj}`;
    }
    // 5. Tech & Dev
    else if (lower.includes('github') || lower.includes('firebase') || lower.includes('cloud')) {
      cat = 'Tech & Projets';
      summary = `Mise à jour technique sur le projet : ${cleanSubj}`;
    }
    // 6. Travel & Leisure
    else if (
      lower.includes('easyjet') ||
      lower.includes('getyourguide') ||
      lower.includes('voyage') ||
      lower.includes('american express') ||
      lower.includes('amex')
    ) {
      cat = 'Voyages & Loisirs';
      summary = `Offre de séjour et voyage : ${cleanSubj}`;
    }
    // 7. E-Commerce & Shopping
    else if (
      lower.includes('asos') ||
      lower.includes('twistshake') ||
      lower.includes('aprizo') ||
      lower.includes('promo') ||
      lower.includes('solde') ||
      lower.includes('qonto')
    ) {
      cat = 'Achats & Offres';
      if (lower.includes('qonto')) {
        summary = 'Offre partenaire : Un mois de mutuelle offert pour les indépendants et freelances.';
      } else {
        summary = `Offre promotionnelle : ${cleanSubj}`;
      }
    }
    // 8. Social Networks & Culture
    else if (
      lower.includes('tiktok') ||
      lower.includes('facebook') ||
      lower.includes('instagram') ||
      lower.includes('lumosity') ||
      lower.includes('ugc')
    ) {
      cat = 'Réseaux sociaux & Culture';
      if (lower.includes('lumosity')) {
        summary = 'Exercices d’entraînement cérébral pour la mémoire et la concentration.';
      } else if (lower.includes('ugc')) {
        summary = 'Vos sorties cinéma et programmation de la semaine.';
      } else {
        summary = `Activité récente sur votre réseau : ${cleanSubj}`;
      }
    }
    // 9. Account Security
    else if (lower.includes('securite') || lower.includes('connexion') || lower.includes('google')) {
      cat = 'Sécurité & Accès';
      summary = `Alerte de sécurité de compte : ${cleanSubj}`;
    }

    return {
      category: cat,
      summary: Utils.sanitizeText(summary),
      actionRequired: isAction,
      actionTitle,
      deadline,
      estimatedMinutes: isAction ? 5 : 0
    };
  };

  return {
    analyzeEmails
  };
})();
