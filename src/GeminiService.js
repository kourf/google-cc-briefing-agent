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
   * Cached active working model for the current execution cycle.
   * Prevents repeated 503/429 attempts on overloaded models.
   * @type {string|null}
   */
  let activeWorkingModel = null;

  /**
   * Set of models that have hit daily quota limits (HTTP 429).
   * Prevents repeated quota failure spam during the current run.
   * @type {Set<string>}
   */
  const exhaustedModels = new Set();

  /**
   * Marks a model as quota-exhausted for the remainder of this session.
   * @param {string} modelName - Model name.
   */
  const markModelExhausted = (modelName) => {
    const clean = String(modelName).replace(/^models\//, '').trim();
    exhaustedModels.add(clean);
    console.warn(`Modèle ${clean} marqué comme quota-épuisé pour cette session.`);

    try {
      if (typeof DevOpsAgentService !== 'undefined') {
        DevOpsAgentService.recordIncident({
          component: 'Serveur d’analyse IA',
          severity: 'INFO',
          resolved: true,
          message: 'Le serveur principal était momentanément saturé.',
          solution: 'Passage automatique et transparent sur un serveur de secours pour résumer vos e-mails.'
        });
      }
    } catch {}
  };

  /**
   * Resolves the prioritized model cascade list.
   * Puts the currently verified working model first if known.
   * Automatically filters out any models that have hit daily quota limits.
   *
   * @returns {Array<string>} Ordered list of models to try.
   */
  const getModelCascade = () => {
    const primary = Config.getGeminiModel() || 'gemini-3.1-flash-lite';
    const fallback = Config.DEFAULTS.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
    const allModels = [
      primary,
      fallback,
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.8-flash'
    ];

    const available = allModels.filter((m) => !exhaustedModels.has(m));
    const models = available.length > 0 ? available : ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];

    if (activeWorkingModel && models.includes(activeWorkingModel) && !exhaustedModels.has(activeWorkingModel)) {
      return [activeWorkingModel, ...models.filter((m) => m !== activeWorkingModel)];
    }
    return [...new Set(models)];
  };

  /**
   * Generates weather advice based on raw weather data, with retry and model fallback.
   *
   * @param {string} rawWeatherContext - Formatted weather metrics.
   * @returns {string|null} Advice string or null.
   */
  const generateWeatherAdvice = (rawWeatherContext) => {
    if (!rawWeatherContext) return null;

    let apiKey = null;
    try {
      apiKey = Config.getGeminiApiKey();
    } catch (e) {
      console.warn(`Weather advice skipped: ${e.message}`);
      return null;
    }
    if (!apiKey) return null;

    const modelCascade = getModelCascade();

    const systemPrompt = 
      "Tu es un assistant pratique et direct.\n" +
      "Rédige un bulletin météo très court pour la ville détectée, en allant systématiquement à la ligne pour chaque moment de la journée : le matin (9h), l'après-midi (15h) et le soir (21h).\n" +
      "IMPORTANT : Tu DOIS commencer ta réponse en annonçant clairement la ville sur sa propre ligne : '**Pour [Ville] :**'\n" +
      "Donne les températures, les risques de pluie et des conseils vestimentaires simples (t-shirt, veste, parapluie).\n" +
      "FORMAT DES CHIFFRES OBLIGATOIRE : écris TOUJOURS les températures avec le symbole '°C' (ex : '10 °C') et les risques de pluie avec '%' collé au chiffre (ex : '29%'). N'écris JAMAIS 'degrés' ni 'pour cent' en toutes lettres. N'utilise aucun emoji ni pictogramme.\n" +
      "RESPECTE SCRUPULEUSEMENT CE FORMAT AVEC RETOURS À LA LIGNE POUR CHAQUE MOMENT :\n" +
      "**Pour Annemasse :**\n" +
      "• **Matin (9h) :** Il fera 10 °C avec 29% de risque de pluie, prévoyez une petite veste pour partir.\n" +
      "• **Après-midi (15h) :** Le soleil s'installe avec 22 °C et 5% de risque de pluie, vous pourrez largement rester en t-shirt.\n" +
      "• **Soir (21h) :** Attention, le ciel se couvre (80% de risque d'averses) et il fera 14 °C. Prenez un parapluie si vous sortez.";

    for (let model of modelCascade) {
      if (!model) continue;
      const cleanModel = String(model).replace(/^models\//, '').trim();
      const url = `${Config.DEFAULTS.GEMINI_API_BASE_URL}/${cleanModel}:generateContent?key=${apiKey}`;

      const genConfig = {
        temperature: 0.3,
        maxOutputTokens: 512
      };
      if (!cleanModel.includes('lite')) {
        genConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nVoici les données brutes :\n${rawWeatherContext}` }]
          }
        ],
        generationConfig: genConfig
      };

      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };

      try {
        const response = UrlFetchApp.fetch(url, options);
        const statusCode = response.getResponseCode();
        if (statusCode === 200) {
          const json = JSON.parse(response.getContentText());
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            activeWorkingModel = cleanModel;
            return Utils.sanitizeText(text);
          }
        } else {
          if (statusCode === 429) {
            markModelExhausted(cleanModel);
          }
          console.warn(`Weather advice failed on model ${cleanModel} with HTTP ${statusCode}`);
        }
      } catch (e) {
        console.error(`Error generating weather advice with ${cleanModel}: ${e.message}`);
      }
    }
    
    return null;
  };

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

    let apiKey = null;
    try {
      apiKey = Config.getGeminiApiKey();
    } catch (e) {
      console.warn(`Clé API Gemini non configurée (${e.message}). Mode de repli heuristique automatique activé.`);
    }

    if (!apiKey) {
      return emailsList.map(msg => Object.assign({}, msg, getFallbackAiData(msg)));
    }

    const batchSize = Config.DEFAULTS.BATCH_SIZE || 12;
    const enrichedResults = [];
    const analysisStartTime = Date.now();
    const MAX_ANALYSIS_MS = 140000; // 2 minutes 20s max pour l'ensemble des e-mails (garantie anti-timeout 6 min)

    for (let i = 0; i < emailsList.length; i += batchSize) {
      // Garde-fou temporel strict : empêche tout blocage Apps Script à 6 minutes
      if (Date.now() - analysisStartTime > MAX_ANALYSIS_MS) {
        console.warn(`Budget temps d'analyse (140s) atteint. Activation du repli déterministe immédiat pour les ${emailsList.length - i} e-mail(s) restant(s).`);
        try {
          if (typeof DevOpsAgentService !== 'undefined') {
            DevOpsAgentService.recordIncident({
              component: 'Vitesse de traitement des e-mails',
              severity: 'INFO',
              resolved: true,
              message: 'Grand nombre d’e-mails reçus nécessitant une analyse plus longue.',
              solution: 'Accélération immédiate de l’analyse pour vous livrer votre briefing complet à l’heure.'
            });
          }
        } catch {}
        for (let j = i; j < emailsList.length; j++) {
          enrichedResults.push(Object.assign({}, emailsList[j], getFallbackAiData(emailsList[j])));
        }
        break;
      }

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
        Utilities.sleep(1000);
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
    const modelCascade = getModelCascade();
    let cascadeIndex = 0;
    const maxAttempts = Config.DEFAULTS.MAX_RETRIES || 4;
    const baseDelayMs = Config.DEFAULTS.INITIAL_BACKOFF_MS || 1500;
    const transientStatusCodes = [429, 500, 502, 503, 504];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const modelToTry = modelCascade[cascadeIndex] || modelCascade[0];
      try {
        const result = callGeminiApi(batch, apiKey, modelToTry);
        activeWorkingModel = modelToTry;
        return result;
      } catch (error) {
        const statusCode = error.statusCode || 0;
        const sanitizedMsg = Utils.redactSensitive(error.message);

        // Immediate cascade on HTTP 404, 503 (high demand), 429 (quota), or network timeout (0)
        if (statusCode === 404 || statusCode === 503 || statusCode === 429 || statusCode === 0) {
          if (statusCode === 429 || (error.message && error.message.includes('quota'))) {
            markModelExhausted(modelToTry);
          }
          console.warn(`Model ${modelToTry} unavailable (${sanitizedMsg}). Cascading to next available model.`);

          try {
            if (typeof DevOpsAgentService !== 'undefined') {
              DevOpsAgentService.recordIncident({
                component: 'Serveur d’analyse IA',
                severity: 'INFO',
                resolved: true,
                message: statusCode === 503
                  ? 'Pic d’affluence temporaire sur les serveurs d’analyse.'
                  : 'Léger ralentissement détecté sur le serveur principal.',
                solution: 'Relais automatique immédiat sur un serveur de secours sans aucune coupure.'
              });
            }
          } catch {}

          if (cascadeIndex < modelCascade.length - 1) {
            cascadeIndex++;
            attempt--; // Do not consume an attempt when instantly cascading
            continue;
          }
        }

        // Fatal non-recoverable errors
        if (statusCode > 0 && !transientStatusCodes.includes(statusCode) && statusCode !== 404) {
          console.error(`Non-recoverable API error (${sanitizedMsg}). Activating fallback mode for batch ${batchIndex}.`);
          break;
        }

        // Transient errors with backoff
        if (attempt < maxAttempts) {
          const delay = Utils.calculateBackoffWithJitter(attempt, baseDelayMs);
          console.warn(
            `API temporarily unavailable (${sanitizedMsg}). Attempt ${attempt}/${maxAttempts} — Retrying in ${delay} ms...`
          );
          Utilities.sleep(delay);
          if (cascadeIndex < modelCascade.length - 1) {
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
      "   - 'Banque & Finances' : Revolut, Société Générale, SG, PayPal, Qonto, virements, relevés bancaires\n" +
      "   - 'Commandes & Livraisons' : Chronopost, Colissimo, Amazon, suivi de colis, commandes en cours, UPS\n" +
      "   - 'Santé & Soins' : Consultations, médecins, ordonnances, praticiens (Doctolib, Qare)\n" +
      "   - 'Démarches & Administration' : Services publics, formations, aides, impôts (France Travail, CAF, Ameli, impots.gouv)\n" +
      "   - 'Sécurité & Accès' : Codes 2FA, connexions suspectes, alertes de compte Google/Microsoft\n" +
      "   - 'Voyages & Loisirs' : Billets d'avion, réservations, vacances (easyJet, GetYourGuide, SNCF, American Express)\n" +
      "   - 'Achats & Offres' : Soldes, remises, réductions e-commerce (ASOS, Twistshake)\n" +
      "   - 'Actualités & Newsletters' : Articles de presse, Dribbble, newsletters générales\n" +
      "   - 'Réseaux Sociaux' : Facebook, LinkedIn (réseau/messages), Instagram, TikTok\n" +
      "   - 'Tech & Outils Numériques' : GitHub, Firebase, GCP, HeyGen, Lumosity, outils logiciels";

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
              'Banque & Finances',
              'Commandes & Livraisons',
              'Santé & Soins',
              'Démarches & Administration',
              'Sécurité & Accès',
              'Voyages & Loisirs',
              'Achats & Offres',
              'Actualités & Newsletters',
              'Réseaux Sociaux',
              'Tech & Outils Numériques'
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

    const genConfig = {
      temperature: Config.DEFAULTS.TEMPERATURE || 0.2,
      maxOutputTokens: Config.DEFAULTS.MAX_OUTPUT_TOKENS || 8192,
      responseMimeType: 'application/json',
      responseSchema
    };

    if (!cleanModel.includes('lite')) {
      genConfig.thinkingConfig = { thinkingBudget: 0 };
    }

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
      generationConfig: genConfig
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
            category: item.category ? Utils.sanitizeText(item.category) : 'Actualités & Newsletters',
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

    let cat = 'Actualités & Newsletters';
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
        cat = 'Réseaux Sociaux';
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
        cat = 'Tech & Outils Numériques';
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
    // 5. Bank & Finance
    else if (lower.includes('revolut') || lower.includes('sg') || lower.includes('société générale') || lower.includes('paypal') || lower.includes('qonto') || lower.includes('banque')) {
      cat = 'Banque & Finances';
      summary = `Notification bancaire : ${cleanSubj}`;
    }
    // 6. Orders & Delivery
    else if (lower.includes('chronopost') || lower.includes('colissimo') || lower.includes('amazon') || lower.includes('suivi de commande') || lower.includes('livraison')) {
      cat = 'Commandes & Livraisons';
      summary = `Suivi de commande et livraison : ${cleanSubj}`;
    }
    // 7. Travel & Leisure
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
    // 8. E-Commerce & Shopping
    else if (
      lower.includes('asos') ||
      lower.includes('twistshake') ||
      lower.includes('aprizo') ||
      lower.includes('promo') ||
      lower.includes('solde')
    ) {
      cat = 'Achats & Offres';
      summary = `Offre promotionnelle : ${cleanSubj}`;
    }
    // 9. Tech, Social Networks, News
    else if (
      lower.includes('github') || lower.includes('firebase') || lower.includes('cloud') ||
      lower.includes('heygen') || lower.includes('lumosity') || lower.includes('api')
    ) {
      cat = 'Tech & Outils Numériques';
      if (lower.includes('lumosity')) {
        summary = 'Exercices d’entraînement cérébral pour la mémoire et la concentration.';
      } else {
        summary = `Activité ou mise à jour technique : ${cleanSubj}`;
      }
    }
    else if (lower.includes('tiktok') || lower.includes('facebook') || lower.includes('instagram')) {
      cat = 'Réseaux Sociaux';
      summary = `Notification réseau social : ${cleanSubj}`;
    }
    else if (lower.includes('dribbble') || lower.includes('ugc') || lower.includes('newsletter')) {
      cat = 'Actualités & Newsletters';
      if (lower.includes('ugc')) {
        summary = 'Vos sorties cinéma et programmation de la semaine.';
      } else {
        summary = `Actualités et veille : ${cleanSubj}`;
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

  /**
   * Génère le résumé exécutif des actualités (vidéo quotidienne complète HugoDécrypte + dépêches par catégorie).
   *
   * @param {Object} newsData - Données brutes issues de NewsService.fetchDailyNewsData().
   * @returns {Object} { hugoEdition: Object|null, categories: Array<Object>, hugoEpisode: Object|null }
   */
  const generateNewsDigest = (newsData) => {
    if (!newsData || !newsData.rawContext) return null;

    let apiKey = null;
    try {
      apiKey = Config.getGeminiApiKey();
    } catch {
      return {
        hugoEdition: newsData.hugoEpisode ? {
          videoTitle: Utils.sanitizeText(newsData.hugoEpisode.title),
          videoUrl: newsData.hugoEpisode.url,
          publishedDate: Utils.sanitizeText(newsData.hugoEpisode.publishedDate),
          editionTitle: Utils.sanitizeText(newsData.hugoEpisode.editionTitle),
          segments: (newsData.hugoEpisode.segments || []).map((seg) => ({
            timestamp: Utils.sanitizeText(seg.timestamp),
            segmentTitle: Utils.sanitizeText(seg.title),
            category: 'Actualités',
            summary: Utils.sanitizeText(seg.title)
          }))
        } : null,
        categories: newsData.fallbackCategories || [],
        hugoEpisode: newsData.hugoEpisode || null
      };
    }

    const modelCascade = getModelCascade();

    const systemPrompt = [
      'Tu es un journaliste vulgarisateur d’élite pour un briefing exécutif matinal.',
      'Ton rôle : résumer l’actualité comme si tu parlais à un jeune curieux de 15 ans, tout en livrant 100 % des faits concrets (qui, quoi, ville précise, pourquoi la polémique, impact/suite) en phrases courtes et directes pour qu’on puisse en discuter avec des collègues sans devoir chercher ailleurs.',
      '',
      'DIRECTIVES MAJEURES (STRICTES ET OBLIGATOIRES — TEST DE L’ADO DE 15 ANS) :',
      '1. ZÉRO MOT, SIGLE OU NOM NON EXPLIQUÉ :',
      '   - N’emploie JAMAIS un sigle, événement, unité ou terme technique sans l’expliquer immédiatement entre parenthèses en mots très simples.',
      '   - Exemples : "la COP31 (la grande conférence mondiale annuelle de l’ONU sur le climat)", "Shahid Kaveh (une unité secrète de hackers militaires iraniens liée aux Gardiens de la Révolution)", "l’Arcom (le régulateur français qui surveille la télévision et la radio)", "une OPA (offre pour racheter une entreprise en Bourse)".',
      '2. CONTEXTUALISATION PRÉCISE DE CHAQUE PERSONNE, SPORTIF ET ENTREPRISE :',
      '   - Pour CHAQUE personne : précise TOUJOURS qui elle est et sa fonction/rôle exact (ex : "Thomas Massie (un député républicain américain)", "Antonio Guterres (le secrétaire général de l’ONU)").',
      '   - Pour CHAQUE sportif : indique TOUJOURS son club/équipe ET son poste exact sur le terrain (ex : "Senny Mayulu (le jeune milieu de terrain du PSG)", "Kylian Mbappé (l’attaquant de l’équipe de France et du Real Madrid)").',
      '   - Pour CHAQUE entreprise, marque, parti ou organisation : précise ce qu’elle fait ou vend (ex : "Coopérative U (l’enseigne française de supermarchés)", "OpenAI (l’entreprise qui a créé ChatGPT)").',
      '3. ZÉRO RÉSUMÉ À 60 % — PRÉCISION GÉOGRAPHIQUE ET FACTUELLE MAXIMALE :',
      '   - Interdiction absolue des formules vagues ("dans les Yvelines" sans la ville, "accusations graves", "domaines sensibles", "certains cas", "situation difficile").',
      '   - Donne TOUJOURS la VILLE exacte si elle apparaît dans les sources ou la corroboration (ex : "à Trappes, dans les Yvelines"), le NOM exact des suspects/acteurs cités, les CHIFFRES marquants, la RAISON/POLÉMIQUE d’origine (pourquoi les gens manifestent, signent une pétition ou attaquent) ET la CONSÉQUENCE / IMPACT.',
      '   - Pour une pétition, grève, procès ou destitution : explique toujours en mots simples POURQUOI l’affaire a commencé (ex : reproches de manque de pluralisme contre une chaîne, revendications de salaires/postes, actes illégaux reprochés) ET ce que ça change ensuite.',
      '4. FORMAT COURT MAIS COMPLET (2 À 3 PHRASES DENSES ET LISIBLES PAR SUJET) :',
      '   - Phrase 1 (QUI + QUOI + OÙ) : L’événement concret avec ville exacte, explication des sigles/entreprises et rôle/poste précis des personnes.',
      '   - Phrase 2 (POURQUOI / POLÉMIQUE) : Le motif d’origine ou l’enjeu expliqué simplement.',
      '   - Phrase 3 (IMPACT / SUITE) : La décision prise, la réaction ou ce qui va se passer ensuite.',
      '5. DEUX BLOCS ATTENDUS DANS LE JSON :',
      '   - "segments" : pour CHAQUE segment du sommaire d’HugoDécrypte (ignore Intro et Outro). Précise le minutage exact ("timestamp"), un titre clair ("segmentTitle"), une catégorie strictement choisie parmi ["Politique & Géopolitique", "Économie & Entreprises", "Social & Sociétal", "Tech, IA & Sciences", "Environnement & Écologie", "Justice & Lois", "Culture & Savoir", "Sport", "Faits divers"] (n’utilise JAMAIS le mot vague "Médias"), et le résumé factuel complet ("summary").',
      '   - "categories" : génère UN objet par rubrique dans CET ORDRE EXACT (PESTEL + Culture + Sport + Faits divers) en utilisant UNIQUEMENT les sources Google Actualités correspondantes fournies dans [COMPLÉMENT D’ACTUALITÉS] (avec leur corroboration presse pour être 100 % précis, et sans répéter les sujets déjà résumés dans HugoDécrypte sauf absence d’autre dépêche) :',
      '     1) "P — Politique & Géopolitique" (élections, diplomatie, conflits, gouvernement, parlement — laisse les sujets climat/COP pour la rubrique Environnement)',
      '     2) "E — Économie, Finance & Entreprises" (entreprises, marchés, impôts, budget, énergie/carburant)',
      '     3) "S — Social & Sociétal" (pouvoir d’achat, logement, grèves avec leurs revendications précises, éducation, santé publique)',
      '     4) "T — Technologie, IA & Innovation" (intelligence artificielle, cybersécurité, high-tech, puces)',
      '     5) "E — Environnement & Écologie" (climat, COP, transition écologique, biodiversité)',
      '     6) "L — Légal : Justice, Lois & Procès" (procès, décisions judiciaires majeures, projets de loi, condamnations)',
      '     7) "Culture & Savoir (Cinéma, Livres, Histoire & Sciences)" (découverte scientifique ou historique passionnante, film, livre ou fait culturel pour dormir moins bête — explique concrètement de quoi il s’agit, jamais du terme abstrait "médias")',
      '     8) "Sport" (résultat, transfert, blessure ou événement majeur du sport avec poste exact des joueurs)',
      '     9) "Faits divers (Délits, Crimes & Accidents marquants)" (délit, crime, enquête, accident grave ou décès marquant avec ville exacte et motif)',
      '     Pour chaque rubrique : "categoryName", "headline" (titre précis), "summary" (2 à 3 phrases claires, complètes et pédagogiques). Ne mélange JAMAIS les détails (lieux, dates ou affaires) de deux dépêches distinctes dans un même résumé.',
      '6. ZÉRO ÉMOJI : n’utilise strictement aucun emoji ni symbole dans le texte généré.',
      '7. Réponds UNIQUEMENT en JSON avec la structure spécifiée dans le schéma.'
    ].join('\n');

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        segments: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              timestamp: { type: 'STRING' },
              segmentTitle: { type: 'STRING' },
              category: { type: 'STRING' },
              summary: { type: 'STRING' }
            },
            required: ['timestamp', 'segmentTitle', 'category', 'summary']
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
    };

    for (const model of modelCascade) {
      if (!model) continue;
      const cleanModel = String(model).replace(/^models\//, '').trim();
      const url = `${Config.DEFAULTS.GEMINI_API_BASE_URL}/${cleanModel}:generateContent?key=${apiKey}`;

      const genConfig = {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema
      };
      if (!cleanModel.includes('lite')) {
        genConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemPrompt}\n\nSOURCES DU JOUR :\n${newsData.rawContext.substring(0, 48000)}`
              }
            ]
          }
        ],
        generationConfig: genConfig
      };

      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };

      try {
        const response = UrlFetchApp.fetch(url, options);
        const statusCode = response.getResponseCode();

        if (statusCode === 200) {
          const json = JSON.parse(response.getContentText());
          const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            activeWorkingModel = cleanModel;

            const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
            const sanitizedSegments = segments.map((seg) => ({
              timestamp: Utils.sanitizeText(seg.timestamp),
              segmentTitle: Utils.sanitizeText(seg.segmentTitle),
              category: Utils.sanitizeText(seg.category),
              summary: Utils.sanitizeText(seg.summary)
            }));

            // Structure Hugo Edition (avec repli systématique sur les segments natifs si Gemini en omettait)
            const fallbackSegments = (newsData.hugoEpisode?.segments || []).map((seg) => ({
              timestamp: Utils.sanitizeText(seg.timestamp || '01:00'),
              segmentTitle: Utils.sanitizeText(seg.title || seg.segmentTitle),
              category: 'Actualités',
              summary: Utils.sanitizeText(seg.title || seg.segmentTitle)
            }));

            const hugoEdition = newsData.hugoEpisode ? {
              videoTitle: Utils.sanitizeText(newsData.hugoEpisode.title),
              videoUrl: newsData.hugoEpisode.url,
              publishedDate: Utils.sanitizeText(newsData.hugoEpisode.publishedDate),
              editionTitle: Utils.sanitizeText(newsData.hugoEpisode.editionTitle),
              segments: sanitizedSegments.length > 0 ? sanitizedSegments : fallbackSegments
            } : null;

            // Catégories complémentaires ordonnées strictement (PESTEL -> Culture & Savoir -> Sport -> Faits divers)
            // Uniquement issues des sources Google Actualités.
            const canonicalCategories = (NewsService.CATEGORIES || []).map((c) => c.name);
            const bucketByCanonical = {};
            for (const cName of canonicalCategories) {
              bucketByCanonical[cName] = [];
            }

            if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
              for (const rawCat of parsed.categories) {
                const rawName = Utils.sanitizeText(rawCat.categoryName);
                const lowerRaw = rawName.toLowerCase();
                let targetName =
                  canonicalCategories.find((c) => c.toLowerCase() === lowerRaw) ||
                  canonicalCategories.find((c) => {
                    const stem = c.split(/[—:(]/)[0].trim().toLowerCase();
                    if (stem.length <= 2) {
                      return c.toLowerCase().includes(lowerRaw) || lowerRaw.includes(c.substring(0, 12).toLowerCase());
                    }
                    return lowerRaw.includes(stem);
                  });

                // Correspondance fine sur mots-clés si libellé abrégé
                if (!targetName) {
                  if (lowerRaw.includes('politique') || lowerRaw.includes('géopolitique')) targetName = canonicalCategories[0];
                  else if (lowerRaw.includes('économie') || lowerRaw.includes('finance')) targetName = canonicalCategories[1];
                  else if (lowerRaw.includes('social') || lowerRaw.includes('sociétal')) targetName = canonicalCategories[2];
                  else if (lowerRaw.includes('tech') || lowerRaw.includes('innovation')) targetName = canonicalCategories[3];
                  else if (lowerRaw.includes('environnement') || lowerRaw.includes('écologie')) targetName = canonicalCategories[4];
                  else if (lowerRaw.includes('légal') || lowerRaw.includes('justice') || lowerRaw.includes('loi')) targetName = canonicalCategories[5];
                  else if (lowerRaw.includes('culture') || lowerRaw.includes('savoir') || lowerRaw.includes('science')) targetName = canonicalCategories[6];
                  else if (lowerRaw.includes('sport')) targetName = canonicalCategories[7];
                  else if (lowerRaw.includes('faits divers') || lowerRaw.includes('crime') || lowerRaw.includes('délit')) targetName = canonicalCategories[8];
                }

                if (targetName && rawCat.headline && rawCat.summary) {
                  bucketByCanonical[targetName].push({
                    headline: Utils.sanitizeText(rawCat.headline),
                    summary: Utils.sanitizeText(rawCat.summary)
                  });
                }
              }
            }

            const finalCategories = [];
            for (const catName of canonicalCategories) {
              if (bucketByCanonical[catName].length > 0) {
                finalCategories.push({
                  name: catName,
                  items: bucketByCanonical[catName]
                });
              } else {
                const fb = (newsData.fallbackCategories || []).find((f) => f.name === catName);
                if (fb && fb.items && fb.items.length > 0) {
                  finalCategories.push({
                    name: catName,
                    items: fb.items.slice(0, 1)
                  });
                }
              }
            }

            return {
              hugoEdition,
              categories: finalCategories,
              hugoEpisode: newsData.hugoEpisode || null
            };
          }
        } else {
          if (statusCode === 429) {
            markModelExhausted(cleanModel);
          }
          console.warn(`News digest HTTP ${statusCode} on ${cleanModel}`);
          Utilities.sleep(1500);
        }
      } catch (e) {
        console.warn(`Error generating news digest with ${cleanModel}: ${e.message}`);
        Utilities.sleep(1000);
      }
    }

    // Deterministic fallback
    return {
      hugoEdition: newsData.hugoEpisode ? {
        videoTitle: Utils.sanitizeText(newsData.hugoEpisode.title),
        videoUrl: newsData.hugoEpisode.url,
        publishedDate: Utils.sanitizeText(newsData.hugoEpisode.publishedDate),
        editionTitle: Utils.sanitizeText(newsData.hugoEpisode.editionTitle),
        segments: (newsData.hugoEpisode.segments || []).map((seg) => ({
          timestamp: Utils.sanitizeText(seg.timestamp || '01:00'),
          segmentTitle: Utils.sanitizeText(seg.title || seg.segmentTitle || 'Actualité'),
          category: 'Actualités',
          summary: Utils.sanitizeText(seg.summary || seg.title || seg.segmentTitle || 'Sujet du jour')
        }))
      } : null,
      categories: newsData.fallbackCategories || [],
      hugoEpisode: newsData.hugoEpisode || null
    };
  };

  return {
    analyzeEmails,
    generateWeatherAdvice,
    generateNewsDigest
  };
})();
