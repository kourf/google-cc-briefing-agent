/**
 * Google CC Briefing Agent
 * BriefingService.js — Ventilation par 9 catégories, salutation temporelle dynamique,
 * branding épuré "Mon Briefing Quotidien" et expédition sans émojis problématiques.
 */

const BriefingService = (function () {
  /**
   * Métadonnées d'affichage pour les 9 catégories
   */
  const CATEGORY_META = [
    {
      key: 'actions_immediates',
      title: '⚡ Actions immédiates requises',
      subtitle: 'Nécessitent une intervention ou réponse aujourd’hui',
      accentColor: '#DC2626'
    },
    {
      key: 'securite_acces',
      title: '🛡️ Sécurité & Accès',
      subtitle: 'Connexions, codes 2FA et vérifications de compte',
      accentColor: '#1E40AF'
    },
    {
      key: 'emploi_carriere',
      title: '💼 Emploi & Carrière',
      subtitle: 'Alertes de postes, recruteurs et opportunités pro',
      accentColor: '#047857'
    },
    {
      key: 'tech_dev',
      title: '💻 Tech & Développement',
      subtitle: 'GitHub, intégration continue, cloud et hébergement',
      accentColor: '#4F46E5'
    },
    {
      key: 'voyages_loisirs',
      title: '✈️ Voyages & Loisirs',
      subtitle: 'Billets d’avion, réservations et sorties',
      accentColor: '#0891B2'
    },
    {
      key: 'achats_promos',
      title: '🏷️ Achats & Bons plans',
      subtitle: 'Offres promotionnelles, soldes et commandes',
      accentColor: '#B45309'
    },
    {
      key: 'sante_demarches',
      title: '🩺 Santé & Démarches',
      subtitle: 'Rendez-vous médicaux et démarches administratives',
      accentColor: '#059669'
    },
    {
      key: 'reseaux_sociaux',
      title: '📱 Réseaux sociaux',
      subtitle: 'Mises à jour et interactions de votre réseau',
      accentColor: '#7C3AED'
    },
    {
      key: 'veille_culture',
      title: '📚 Veille & Culture',
      subtitle: 'Articles, apprentissage et actualités',
      accentColor: '#4B5563'
    }
  ];

  /**
   * Construit et expédie le briefing quotidien.
   *
   * @param {Object} params - { emails, agenda, isTestMode, recipientEmail }
   * @return {Object} Résumé de l'opération
   */
  function buildAndSendBriefing(params) {
    const emails = params.emails || [];
    const agenda = params.agenda || { todayEvents: [], tomorrowEvents: [] };
    const isTestMode = Boolean(params.isTestMode);
    const recipientEmail = params.recipientEmail || Config.getRecipientEmail();
    const recipientName = 'Kouroufia';

    const now = new Date();
    const formattedDate = Utils.formatDateFrench(now);
    const temporalGreeting = Utils.getTemporalGreeting(now, recipientName);
    const temporalSignoff = Utils.getTemporalSignoff(now);

    // 1. Initialisation des listes pour les 9 catégories
    const categorizedMap = {};
    for (let c = 0; c < CATEGORY_META.length; c++) {
      categorizedMap[CATEGORY_META[c].key] = [];
    }

    // 2. Ventilation des e-mails
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      let catKey = email.category || 'veille_culture';

      // Forcer dans actions_immediates si action requise
      if (email.actionRequired && catKey !== 'actions_immediates') {
        catKey = 'actions_immediates';
      }

      if (!categorizedMap[catKey]) {
        catKey = 'veille_culture';
      }

      categorizedMap[catKey].push({
        id: email.id,
        threadId: email.threadId,
        sender: email.senderDisplayName || email.senderName,
        subject: email.subject,
        summary: email.summary,
        actionRequired: Boolean(email.actionRequired),
        actionTitle: email.actionTitle || 'Action',
        deadline: email.deadline,
        timeEstimate: email.estimatedMinutes > 0 ? email.estimatedMinutes + ' min' : '5 min',
        duplicateCount: email.duplicateCount || 1,
        targetAccount: email.targetAccount,
        webUrl: Utils.buildGmailUrl(email.threadId)
      });
    }

    // 3. Construction de la liste ordonnée des catégories contenant des éléments
    const displayCategories = [];
    for (let m = 0; m < CATEGORY_META.length; m++) {
      const meta = CATEGORY_META[m];
      const items = categorizedMap[meta.key] || [];
      if (items.length > 0) {
        displayCategories.push({
          key: meta.key,
          title: meta.title,
          subtitle: meta.subtitle,
          accentColor: meta.accentColor,
          items: items
        });
      }
    }

    const urgentCount = categorizedMap['actions_immediates'].length;

    // 4. Préparation des variables du template
    const templateData = {
      isTestMode: isTestMode,
      dateTitle: formattedDate,
      greeting: temporalGreeting,
      signoff: temporalSignoff,
      recipientName: recipientName,
      recipientEmail: recipientEmail,
      stats: {
        totalEmails: emails.length,
        urgentCount: urgentCount,
        todayEventsCount: agenda.todayEvents.length
      },
      displayCategories: displayCategories,
      todayEvents: agenda.todayEvents,
      tomorrowEvents: agenda.tomorrowEvents,
      isCalm: emails.length === 0 && agenda.todayEvents.length === 0
    };

    // 5. Sujet propre sans émojis problématiques (zéro caractère de remplacement )
    let emailSubject = '';
    if (isTestMode) {
      emailSubject = '[TEST] Mon Briefing Quotidien • ' + formattedDate;
    } else if (urgentCount > 0) {
      emailSubject =
        '(' +
        urgentCount +
        ' action' +
        (urgentCount > 1 ? 's' : '') +
        ' requise' +
        (urgentCount > 1 ? 's' : '') +
        ') Mon Briefing Quotidien • ' +
        formattedDate;
    } else {
      emailSubject = 'Mon Briefing Quotidien • ' + formattedDate;
    }

    // 6. Rendu HTML et Texte brut
    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    // 7. Expédition via GmailApp avec le nom clair "Mon Briefing Quotidien"
    console.log(
      'Envoi du briefing à : ' +
        recipientEmail +
        ' (Sujet : "' +
        emailSubject +
        '")'
    );
    GmailApp.sendEmail(recipientEmail, emailSubject, plainTextBody, {
      htmlBody: htmlBody,
      name: 'Mon Briefing Quotidien'
    });

    return {
      success: true,
      recipient: recipientEmail,
      subject: emailSubject,
      stats: templateData.stats
    };
  }

  /**
   * Évalue le template HTML avec les données fournies.
   */
  function renderTemplate(data) {
    const template = HtmlService.createTemplateFromFile('Template');
    template.data = data;
    template.Utils = Utils;
    return template.evaluate().getContent();
  }

  /**
   * Version texte brut de secours (plain text).
   */
  function renderPlainText(data) {
    const lines = [];
    lines.push('MON BRIEFING QUOTIDIEN');
    lines.push(data.dateTitle);
    lines.push(data.greeting);
    lines.push('');

    data.displayCategories.forEach(function (cat) {
      lines.push('=== ' + cat.title.toUpperCase() + ' ===');
      cat.items.forEach(function (it) {
        let line = '• ' + it.sender + ' : ' + it.summary;
        if (it.actionRequired && it.actionTitle) {
          line += ' [Action : ' + it.actionTitle + ']';
        }
        if (it.deadline) {
          line += ' (Échéance : ' + it.deadline + ')';
        }
        line += ' — ' + it.webUrl;
        lines.push(line);
      });
      lines.push('');
    });

    if (data.todayEvents.length > 0) {
      lines.push('=== PLANNING DU JOUR ===');
      data.todayEvents.forEach(function (ev) {
        lines.push('• ' + ev.timeFormatted + ' : ' + ev.title + (ev.location ? ' (' + ev.location + ')' : ''));
        if (ev.conferenceLink) lines.push('  Lien visio : ' + ev.conferenceLink);
      });
      lines.push('');
    }

    if (data.isCalm) {
      lines.push('Tout est calme aujourd’hui. Aucun e-mail prioritaire ni rendez-vous à signaler.');
      lines.push('');
    }

    lines.push(data.signoff);
    lines.push('Mon Briefing Quotidien • ' + data.recipientEmail);

    return lines.join('\n');
  }

  return {
    buildAndSendBriefing: buildAndSendBriefing
  };
})();
