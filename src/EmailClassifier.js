/**
 * Google CC Briefing Agent
 * EmailClassifier.js — Classification déterministe des e-mails (source unique des règles métier) :
 * - routeur de sécurité appliqué après l'IA (désambiguïsation LinkedIn, emploi, administration, santé) ;
 * - analyse de repli complète quand l'API Gemini est indisponible (catégorie, résumé, action, échéance).
 *
 * Toutes les recherches de mots-clés respectent les limites de mots (Utils.containsKeyword) :
 * « formation » ne correspond plus à « information », « api » ne correspond plus à « rapide ».
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const EmailClassifier = (() => {
  /** Expressions d'invitation réseau LinkedIn. */
  const LINKEDIN_INVITE = [
    'attends votre réponse', 'rejoindre votre réseau', 'invitation', 'vous invite', 'connecter',
    'invites you to connect', 'want to connect', 'souhaite rejoindre'
  ];
  /** Indices d'un article ou d'une newsletter partagés sur LinkedIn. */
  const LINKEDIN_NEWS = ['newsletter', 'article', 'a publié', 'édition', 'actualités', 'news', 'trump', 'data centre', 'build-out'];
  /** Indices d'une vraie offre d'emploi sur LinkedIn. */
  const LINKEDIN_JOBS = ["offre d'emploi", 'offre d’emploi', 'offres', 'emploi', 'job', 'jobs', 'poste', 'recrute', 'hiring', 'candidature', 'comptable', 'finance'];

  /**
   * Règles ordonnées. `override: true` = la règle prime sur la catégorie proposée par l'IA
   * (comportement historique du routeur de sécurité) ; sinon elle ne sert qu'au mode de repli.
   * @returns {Array<{category: string, keywords: Array<string>, override: boolean}>}
   */
  const getRules = () => {
    const C = Config.EMAIL_CATEGORY;
    return [
      {
        category: C.JOBS,
        override: true,
        keywords: [
          'michael page', 'michaelpage', 'meteojob', 'hellowork', 'apec', 'indeed', 'welcome to the jungle',
          'jobup', 'offres finance', 'finance & accounting', 'treuhand', 'fiduciaire', 'recrutement',
          'candidature', "offre d'emploi", 'offre d’emploi', "offres d'emploi", 'offres d’emploi', 'job', 'jobs'
        ]
      },
      {
        category: C.ADMIN,
        override: true,
        keywords: [
          'france travail', 'francetravail', 'pole-emploi', 'pôle emploi', 'caf.fr', 'caf', 'impots.gouv',
          'ameli', 'ameli.fr', 'croupier'
        ]
      },
      {
        category: C.ADMIN,
        override: false,
        keywords: ['urssaf', 'service-public', 'préfecture', 'impôts', 'mairie', 'assurance maladie']
      },
      {
        category: C.HEALTH,
        override: true,
        keywords: ['doctolib', 'qare', 'ordonnance', 'médecin', 'medecin', 'pharmacie', 'téléconsultation']
      },
      {
        category: C.BANK,
        override: false,
        keywords: [
          'revolut', 'société générale', 'societe generale', 'sg', 'paypal', 'qonto', 'boursorama', 'banque',
          'virement', 'relevé de compte', 'prélèvement', 'crédit agricole', 'bnp'
        ]
      },
      {
        category: C.ORDERS,
        override: false,
        keywords: [
          'chronopost', 'colissimo', 'amazon', 'ups', 'dhl', 'mondial relay', 'suivi de commande',
          'votre commande', 'livraison', 'colis', 'expédié', 'expédition'
        ]
      },
      {
        category: C.SECURITY,
        override: false,
        keywords: [
          'code de vérification', 'verification code', 'alerte de sécurité', 'security alert', 'nouvelle connexion',
          'connexion', 'mot de passe', 'password', '2fa', 'sign-in', 'accounts.google.com', 'sécurité'
        ]
      },
      {
        category: C.TRAVEL,
        override: false,
        keywords: [
          'easyjet', 'getyourguide', 'sncf', 'ouigo', 'airbnb', 'booking.com', 'ryanair', 'voyage',
          'réservation', 'american express', 'amex'
        ]
      },
      {
        category: C.SHOPPING,
        override: false,
        keywords: ['asos', 'twistshake', 'aprizo', 'promo', 'promotion', 'soldes', 'solde', 'black friday', 'réduction', 'code promo']
      },
      {
        category: C.TECH,
        override: false,
        keywords: ['github', 'firebase', 'google cloud', 'gcp', 'heygen', 'lumosity', 'vercel', 'netlify', 'api', 'openai']
      },
      {
        category: C.SOCIAL,
        override: false,
        keywords: ['facebook', 'instagram', 'tiktok', 'snapchat', 'twitter', 'discord', 'whatsapp']
      },
      {
        category: C.NEWS,
        override: false,
        keywords: ['newsletter', 'dribbble', 'ugc', 'substack', 'medium', 'la lettre']
      }
    ];
  };

  /** Catégories pour lesquelles une « action » détectée par mot-clé est jugée non pertinente. */
  const NON_ACTIONABLE = () => {
    const C = Config.EMAIL_CATEGORY;
    return [C.SHOPPING, C.NEWS, C.SOCIAL, C.TECH, C.SECURITY, C.TRAVEL];
  };

  /** Formules signalant une démarche à accomplir (mode de repli uniquement). */
  const ACTION_KEYWORDS = [
    'convocation', 'rendez-vous', 'à confirmer', 'confirmez', 'confirmer votre', 'action requise', 'action required',
    'à valider', 'validez', 'à signer', 'signature requise', 'facture', 'paiement', 'échéance', 'dernier rappel',
    'date limite', 'avant le', 'inscription', 'pièce justificative', 'justificatif', 'à compléter', 'complétez',
    'réunion d’information', "réunion d'information"
  ];

  /**
   * Texte de recherche normalisé d'un e-mail (en-tête From brut + nom + objet).
   * @param {Object} email
   * @returns {string}
   */
  const buildSearchText = (email) =>
    `${email.from || ''} ${email.senderName || ''} ${email.subject || ''}`.toLowerCase();

  /**
   * Désambiguïsation des e-mails LinkedIn.
   * @param {string} text - Texte de recherche.
   * @returns {{category: string, kind: string}|null}
   */
  const classifyLinkedIn = (text) => {
    if (!text.includes('linkedin')) return null;
    const C = Config.EMAIL_CATEGORY;
    if (Utils.containsKeyword(text, LINKEDIN_INVITE)) return { category: C.SOCIAL, kind: 'linkedin_invite' };
    if (Utils.containsKeyword(text, LINKEDIN_JOBS)) return { category: C.JOBS, kind: 'linkedin_job' };
    if (Utils.containsKeyword(text, LINKEDIN_NEWS)) return { category: C.NEWS, kind: 'linkedin_news' };
    return { category: C.SOCIAL, kind: 'linkedin_other' };
  };

  /**
   * Catégorie déterministe d'un e-mail.
   * @param {Object} email
   * @param {boolean} overridesOnly - true : uniquement les règles prioritaires sur l'IA.
   * @returns {{category: string, kind: string}|null}
   */
  const classify = (email, overridesOnly) => {
    const text = buildSearchText(email);
    const linkedIn = classifyLinkedIn(text);
    if (linkedIn) {
      // Un e-mail LinkedIn « autre » ne contredit pas l'IA.
      return overridesOnly && linkedIn.kind === 'linkedin_other' ? null : linkedIn;
    }
    for (const rule of getRules()) {
      if (overridesOnly && !rule.override) continue;
      if (Utils.containsKeyword(text, rule.keywords)) return { category: rule.category, kind: 'rule' };
    }
    return null;
  };

  /**
   * Catégorie finale d'un e-mail enrichi : règle prioritaire si elle s'applique,
   * sinon catégorie IA normalisée sur la taxonomie canonique.
   *
   * @param {Object} email - E-mail enrichi (champ `category` issu de l'IA ou du repli).
   * @returns {string} Libellé canonique.
   */
  const resolveCategory = (email) => {
    const forced = classify(email, true);
    return forced ? forced.category : Config.normalizeEmailCategory(email.category);
  };

  /**
   * Traduit les intitulés d'offres allemands/anglais les plus fréquents.
   * @param {string} subject
   * @returns {string}
   */
  const translateSubject = (subject) =>
    String(subject || '')
      .replace(/Sachbearbeiter\s*\/\s*in\s+Treuhand\s*&\s*Administration/gi, 'Collaborateur en fiduciaire et administration')
      .replace(/Sachbearbeiter\s*\/\s*in/gi, 'Collaborateur / Assistant')
      .replace(/Treuhand/gi, 'Fiduciaire')
      .replace(/New Jobs for:\s*/gi, 'Nouvelles offres pour : ')
      .replace(/Finance & Accounting/gi, 'Finance & Comptabilité')
      .replace(/Project Manager\s*-\s*Remote/gi, 'Chef de projet en télétravail');

  /**
   * Extrait le nom de la personne d'une invitation LinkedIn.
   * Ex. "Aïmen Mimoun : Kouroufia, j’attends votre réponse" -> "Aïmen Mimoun".
   * @param {string} subject
   * @returns {string}
   */
  const extractInviterName = (subject) => {
    const s = String(subject || '');
    const colon = s.split(':');
    if (colon.length > 1 && /attends|invitation|réseau/i.test(colon.slice(1).join(':'))) {
      return colon[0].trim();
    }
    const m = s.match(/^(.+?)\s+(?:vous invite|souhaite|wants to connect|invites you)/i) || s.match(/invitation de\s+(.+?)(?:\s+à|\s*$)/i);
    return m ? m[1].trim() : '';
  };

  /**
   * Analyse complète de repli (sans IA), au même format que la sortie Gemini.
   * Aucune valeur figée : titre d'action, échéance et résumé proviennent de l'e-mail réel.
   *
   * @param {Object} msg - E-mail brut (GmailService).
   * @returns {{category: string, summary: string, actionRequired: boolean, actionTitle: string, deadline: (string|null), estimatedMinutes: number}}
   */
  const buildFallbackAnalysis = (msg) => {
    const subject = translateSubject(Utils.sanitizeText(msg.subject) || 'Nouveau message');
    const sender = Utils.sanitizeText(msg.senderName) || 'Expéditeur';
    const detected = classify(msg, false);
    const category = detected ? detected.category : Config.EMAIL_CATEGORY.NEWS;

    let summary = subject;
    if (detected && detected.kind === 'linkedin_invite') {
      const name = extractInviterName(subject);
      summary = name
        ? `Invitation de **${name}** à rejoindre votre réseau professionnel.`
        : 'Invitation à rejoindre votre réseau professionnel sur LinkedIn.';
    } else if (detected && detected.kind === 'linkedin_job') {
      summary = `Opportunité professionnelle sur LinkedIn : ${subject}`;
    }

    const bodyStart = String(msg.body || '').substring(0, 600);
    const actionable =
      !NON_ACTIONABLE().includes(category) &&
      !(detected && detected.kind && detected.kind.startsWith('linkedin')) &&
      Utils.containsKeyword(`${subject} ${bodyStart}`, ACTION_KEYWORDS);

    if (!actionable) {
      return {
        category,
        summary: Utils.sanitizeText(summary),
        actionRequired: false,
        actionTitle: '',
        deadline: null,
        estimatedMinutes: 0
      };
    }

    const deadline = Utils.extractDeadline(subject) || Utils.extractDeadline(bodyStart);
    return {
      category,
      summary: Utils.sanitizeText(
        `Ouvrez ce message de **${sender}** et effectuez la démarche demandée${deadline ? ` avant le ${deadline}` : ''}.`
      ),
      actionRequired: true,
      actionTitle: Utils.sanitizeText(`${sender} — ${subject}`),
      deadline,
      estimatedMinutes: 5
    };
  };

  return {
    resolveCategory,
    buildFallbackAnalysis
  };
})();
