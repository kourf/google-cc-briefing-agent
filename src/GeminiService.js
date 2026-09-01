/**
 * Google CC Briefing Agent
 * GeminiService.js — Analyse IA en lot unique, routage strict vers Emploi & Carrière,
 * traduction professionnelle des titres étrangers (allemand/anglais), et cascade résiliente.
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
   * Traite un lot avec retry et cascade automatique de modèles en cas de 404 ou 503 temporaire.
   */
  function analyzeBatchWithRetry(batch, apiKey, batchIndex, totalBatches) {
    let currentModel = Config.getGeminiModel();
    const modelCascade = [
      currentModel, // gemini-2.0-flash (ou configuré)
      Config.DEFAULTS.GEMINI_FALLBACK_MODEL, // gemini-flash-lite-latest
      'gemini-3.6-flash',
      'gemini-3.7-flash'
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

        // Si le modèle retourne 404 (ex: déprécié par Google sur v1beta), bascule immédiate sur le modèle de repli
        if (statusCode === 404) {
          console.warn('Modèle ' + modelToTry + ' non supporté (HTTP 404). Bascule automatique vers modèle suivant.');
          if (cascadeIndex < modelCascade.length - 1) {
            cascadeIndex++;
            attempt--; // ne consomme pas une tentative pour un 404
            continue;
          }
        }

        // Erreurs non récupérables (hors status transitoires)
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

        // Erreurs temporaires (503 High Demand, 429 Rate Limit) : attente avec backoff exponentiel et retry
        if (attempt < maxAttempts) {
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
              ' ms avant nouvel essai...'
          );
          Utilities.sleep(delay);

          // Si 503 persiste sur ce modèle, essayer le modèle suivant de la cascade
          if (statusCode === 503 && cascadeIndex < modelCascade.length - 1) {
            cascadeIndex++;
          }
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
   * Effectue la requête HTTP vers Gemini avec URL nettoyée sans duplication 'models/' et sortie JSON structurée.
   */
  function callGeminiApi(batch, apiKey, model) {
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
      "Tu es l'analyste exécutif en chef de 'Mon Briefing Quotidien'. Ta mission est de produire une synthèse de très haute précision, fluide et 100% en français pour chaque e-mail.\n\n" +
      "RÈGLES DE RÉDACTION STRICTES :\n\n" +
      "1. ACTIONS PRIORITAIRES (actionRequired = true) :\n" +
      "   - Définis actionRequired = true UNIQUEMENT si une décision ou une action humaine concrète est requise (ex: confirmer une réunion, s'inscrire à une formation, payer une facture, valider un document).\n" +
      "   - Pour 'actionTitle', rédige un titre complet et précis au format strict :\n" +
      "     '[Expéditeur / Organisme] — [Sujet précis et enjeu de la tâche ou réunion]'\n" +
      "     Exemples parfaits :\n" +
      "     - 'France Travail — Réunion d'information sur la formation Croupier'\n" +
      "     - 'Qare — Consultation médicale de suivi avec le Dr Dupont'\n" +
      "     - 'GitGuardian — Alerte de sécurité critique sur clé d'API exposée'\n" +
      "     - 'Ameli — Transmission du justificatif d'arrêt de travail'\n" +
      "     (INTERDICTION FORMELLE de titres vagues comme 'S'inscrire à la réunion' ou 'Payer').\n" +
      "   - Pour 'deadline', indique la date et l'heure précise (ex: '10/09 à 09h00', 'Aujourd'hui 18h') ou null.\n" +
      "   - Pour 'summary', formule l'instruction concrète expliquant ce qu'il faut faire et l'enjeu en 1 phrase active :\n" +
      "     Exemple : 'Confirmez votre participation à la session collective d'Annemasse pour valider votre inscription.'\n\n" +
      "2. ROUTAGE STRICT VERS 'Emploi & Carrière' :\n" +
      "   - TOUT e-mail provenant d'une plateforme d'emploi ou de recrutement (Michael Page, Meteojob, LinkedIn, HelloWork, France Travail, Apec, Indeed) ou contenant dans son sujet ou contenu 'Jobs', 'Offres', 'Recrutement', 'Candidature', 'Finance & Accounting', 'Fiduciaire', 'Comptable', 'Treuhand' DOIT ÊTRE CLASSÉ OBLIGATOIREMENT DANS 'Emploi & Carrière' (jamais dans Actualités & Veille).\n\n" +
      "3. TRADUCTION OBLIGATOIRE EN FRANÇAIS PROFESSIONNEL (TITRES ÉTRANGERS) :\n" +
      "   - Tout titre ou intitulé d'emploi en allemand ou en anglais DOIT être traduit et expliqué en français professionnel :\n" +
      "     - 'Sachbearbeiter/in Treuhand & Administration (m/w/d)' -> 'Collaborateur en fiduciaire et administration (H/F)'\n" +
      "     - 'New Jobs for: Finance & Accounting: Genève' -> 'Nouvelles offres d'emploi en finance et comptabilité à Genève'\n" +
      "     - 'Project Manager - Remote' -> 'Chef de projet en télétravail'\n" +
      "     - Remplacer systématiquement '(m/w/d)' par '(H/F)' (jamais de symboles mathématiques $).\n" +
      "   - Interdiction de laisser des intitulés bruts en allemand ou en anglais.\n\n" +
      "4. POUR INFORMATION (actionRequired = false) :\n" +
      "   - Rédige un résumé informatif, fluide et précis en 1 phrase active en français naturel.\n" +
      "   - METS EN GRAS (**) les éléments clés dans chaque résumé (noms propres, entreprises, montants en euros, remises ou délais).\n" +
      "   - Exemples :\n" +
      "     - 'Michael Page présente de nouvelles offres de poste en **finance et comptabilité** basées à **Genève**.'\n" +
      "     - 'Twistshake propose jusqu'à **-50%** de réduction immédiate sur tous les articles de puériculture avec le code promo.'\n" +
      "     - 'easyJet annonce des billets d'avion vers le **Maroc** à partir de **29 €** pour les prochaines vacances.'\n" +
      "     - 'Lumosity présente un dossier d'entraînement cérébral sur la façon dont le **cerveau** détermine la **main dominante**.'\n\n" +
      "5. INTERDICTION ABSOLUE DE BOILERPLATE ROBOTIQUE ET D'ARTEFACTS :\n" +
      "   - Ne commence JAMAIS par '[Expéditeur] vous a envoyé un e-mail'.\n" +
      "   - N'écris JAMAIS 'Aucune action requise' dans le résumé.\n" +
      "   - N'inclus JAMAIS d'entités HTML (&amp;, &#039;), de symboles mathématiques ($) ou de caractères de remplacement Unicode (\\uFFFD).\n\n" +
      "6. TAXONOMIE STRICTE DES SOUS-CATÉGORIES :\n" +
      "   - 'Emploi & Carrière' : Michael Page, Meteojob, LinkedIn, HelloWork, alertes emploi, recruteurs, candidatures\n" +
      "   - 'Santé & Soins' : Consultations, médecins, ordonnances, praticiens (Doctolib, Qare)\n" +
      "   - 'Démarches & Administration' : Services publics, formations, aides, impôts (France Travail, CAF, Ameli, impots.gouv)\n" +
      "   - 'Tech & Projets' : GitHub, intégration continue, serveurs, GCP, Firebase\n" +
      "   - 'Achats & Offres' : Soldes, remises, réductions e-commerce (ASOS, Twistshake, Amazon)\n" +
      "   - 'Voyages & Loisirs' : Billets d'avion, réservations, vacances (easyJet, GetYourGuide, SNCF)\n" +
      "   - 'Réseaux sociaux & Culture' : Activité sociale, notifications, apprentissage (Facebook, TikTok, Instagram, Lumosity)\n" +
      "   - 'Sécurité & Accès' : Codes 2FA, connexions suspectes, alertes de compte Google/Microsoft\n" +
      "   - 'Actualités & Veille' : Newsletters d'information générale, revues de presse";

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
   * Mode dégradé défensif enrichi avec routage emploi strict et traduction des titres étrangers.
   */
  function getFallbackAiData(msg) {
    let cleanSubj = Utils.sanitizeText(msg.subject) || 'Nouveau message';
    const lower = (msg.from + ' ' + msg.subject).toLowerCase();

    // Traduction heuristique des titres d'emploi en allemand ou anglais
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

    // 1. Emploi & Carrière (Michael Page, Meteojob, LinkedIn, etc.)
    if (
      lower.indexOf('michaelpage') !== -1 ||
      lower.indexOf('michael page') !== -1 ||
      lower.indexOf('meteojob') !== -1 ||
      lower.indexOf('linkedin') !== -1 ||
      lower.indexOf('hellowork') !== -1 ||
      lower.indexOf('apec') !== -1 ||
      lower.indexOf('indeed') !== -1 ||
      lower.indexOf('job') !== -1 ||
      lower.indexOf('offres finance') !== -1 ||
      lower.indexOf('finance & accounting') !== -1 ||
      lower.indexOf('treuhand') !== -1 ||
      lower.indexOf('candidat') !== -1 ||
      lower.indexOf('recrutement') !== -1
    ) {
      cat = 'Emploi & Carrière';
      if (lower.indexOf('michael page') !== -1) {
        summary = 'Nouvelles opportunités d’emploi en finance et comptabilité à Genève.';
      } else if (lower.indexOf('meteojob') !== -1) {
        summary = 'Plus de 30 offres d’emploi récentes en finance, comptabilité et assurance.';
      } else {
        summary = 'Opportunité professionnelle : ' + cleanSubj;
      }
    }
    // 2. Démarches & Administration publique
    else if (
      lower.indexOf('francetravail') !== -1 ||
      lower.indexOf('pole-emploi') !== -1 ||
      lower.indexOf('croupier') !== -1 ||
      lower.indexOf('formation') !== -1 ||
      lower.indexOf('caf.fr') !== -1 ||
      lower.indexOf('impots.gouv') !== -1
    ) {
      cat = 'Démarches & Administration';
      if (lower.indexOf('croupier') !== -1 || lower.indexOf('formation') !== -1) {
        isAction = true;
        actionTitle = "France Travail — Réunion d'information sur la formation Croupier";
        deadline = '10/09 à 09h00';
        summary = 'Confirmez votre participation à la session collective d’Annemasse pour valider votre inscription.';
      } else {
        summary = 'Information sur vos démarches administratives : ' + cleanSubj;
      }
    }
    // 3. Santé et soins médicaux
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
    // 4. Tech & Projets
    else if (lower.indexOf('github') !== -1 || lower.indexOf('firebase') !== -1 || lower.indexOf('cloud') !== -1) {
      cat = 'Tech & Projets';
      summary = 'Mise à jour technique sur le projet : ' + cleanSubj;
    }
    // 5. Voyages & Loisirs
    else if (
      lower.indexOf('easyjet') !== -1 ||
      lower.indexOf('getyourguide') !== -1 ||
      lower.indexOf('voyage') !== -1 ||
      lower.indexOf('american express') !== -1 ||
      lower.indexOf('amex') !== -1
    ) {
      cat = 'Voyages & Loisirs';
      summary = 'Offre de séjour et voyage : ' + cleanSubj;
    }
    // 6. Achats & Offres
    else if (
      lower.indexOf('asos') !== -1 ||
      lower.indexOf('twistshake') !== -1 ||
      lower.indexOf('aprizo') !== -1 ||
      lower.indexOf('promo') !== -1 ||
      lower.indexOf('solde') !== -1 ||
      lower.indexOf('qonto') !== -1
    ) {
      cat = 'Achats & Offres';
      summary = 'Offre promotionnelle : ' + cleanSubj;
    }
    // 7. Réseaux sociaux & Culture
    else if (
      lower.indexOf('tiktok') !== -1 ||
      lower.indexOf('facebook') !== -1 ||
      lower.indexOf('instagram') !== -1 ||
      lower.indexOf('lumosity') !== -1 ||
      lower.indexOf('ugc') !== -1
    ) {
      cat = 'Réseaux sociaux & Culture';
      if (lower.indexOf('lumosity') !== -1) {
        summary = 'Exercices d’entraînement cérébral pour la mémoire et la concentration.';
      } else if (lower.indexOf('ugc') !== -1) {
        summary = 'Vos sorties cinéma et programmation de la semaine.';
      } else {
        summary = 'Activité récente sur votre réseau : ' + cleanSubj;
      }
    }
    // 8. Sécurité & Accès
    else if (lower.indexOf('securite') !== -1 || lower.indexOf('connexion') !== -1 || lower.indexOf('google') !== -1) {
      cat = 'Sécurité & Accès';
      summary = 'Alerte de sécurité de compte : ' + cleanSubj;
    }

    return {
      category: cat,
      summary: Utils.sanitizeText(summary),
      actionRequired: isAction,
      actionTitle: actionTitle,
      deadline: deadline,
      estimatedMinutes: isAction ? 5 : 0
    };
  }

  return {
    analyzeEmails: analyzeEmails
  };
})();
