/**
 * Google CC Briefing Agent
 * BriefingService.js — Orchestration du briefing selon la structure exacte de référence :
 * 🧠 Actions prioritaires | 🔔 Pour information (récapitulatif des e-mails reçus non lus) | 📅 Au planning du jour
 */

const BriefingService = (function () {
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

    const urgentItems = [];
    const groupedInfo = {};

    // Ordre thématique logique avec séparation Santé & Soins / Démarches & Administration
    const preferredCategoryOrder = [
      'Emploi & Carrière',
      'Tech & Projets',
      'Achats & Offres',
      'Voyages & Loisirs',
      'Santé & Soins',
      'Démarches & Administration',
      'Réseaux sociaux & Culture',
      'Sécurité & Accès',
      'Actualités & Veille'
    ];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];

      if (email.actionRequired && email.actionTitle) {
        urgentItems.push({
          id: email.id,
          timeEstimate: (email.estimatedMinutes || 5) + ' min',
          actionTitle: Utils.sanitizeText(email.actionTitle),
          deadline: email.deadline ? Utils.sanitizeText(email.deadline) : null,
          webUrl: email.webUrl
        });
      } else {
        const catKey = Utils.sanitizeText(email.category) || 'Actualités & Veille';
        if (!groupedInfo[catKey]) {
          groupedInfo[catKey] = [];
        }
        groupedInfo[catKey].push({
          id: email.id,
          sender: Utils.sanitizeText(email.senderDisplayName || email.senderName),
          summary: Utils.sanitizeText(email.summary),
          webUrl: email.webUrl
        });
      }
    }

    // Construction d'une liste ordonnée de groupes d'information
    const sortedInfoGroups = [];
    preferredCategoryOrder.forEach(function (catName) {
      if (groupedInfo[catName] && groupedInfo[catName].length > 0) {
        sortedInfoGroups.push({
          name: catName,
          items: groupedInfo[catName]
        });
        delete groupedInfo[catName];
      }
    });

    // Ajout des catégories restantes éventuelles
    Object.keys(groupedInfo).forEach(function (otherCat) {
      if (groupedInfo[otherCat].length > 0) {
        sortedInfoGroups.push({
          name: otherCat,
          items: groupedInfo[otherCat]
        });
      }
    });

    const urgentCount = urgentItems.length;

    // Préparation des variables du template
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
      urgentItems: urgentItems,
      sortedInfoGroups: sortedInfoGroups,
      todayEvents: agenda.todayEvents,
      tomorrowEvents: agenda.tomorrowEvents,
      isCalm: emails.length === 0 && agenda.todayEvents.length === 0
    };

    // Sujet d'e-mail propre et clair
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

    // Rendu HTML et Texte brut
    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

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

    if (data.urgentItems.length > 0) {
      lines.push('=== ACTIONS PRIORITAIRES ===');
      data.urgentItems.forEach(function (e) {
        let line = '• ⏱ ' + e.timeEstimate + ' — ' + e.actionTitle;
        if (e.deadline) line += ' (' + e.deadline + ')';
        line += ' : ' + e.webUrl;
        lines.push(line);
      });
      lines.push('');
    }

    if (data.sortedInfoGroups.length > 0) {
      lines.push('=== POUR INFORMATION (RÉCAPITULATIF DES E-MAILS REÇUS NON LUS) ===');
      data.sortedInfoGroups.forEach(function (group) {
        lines.push('• ' + group.name + ' :');
        group.items.forEach(function (it) {
          lines.push('  - ' + it.sender + ' : ' + it.summary + ' — ' + it.webUrl);
        });
      });
      lines.push('');
    }

    if (data.todayEvents.length > 0) {
      lines.push('=== AU PLANNING DU JOUR ===');
      data.todayEvents.forEach(function (ev) {
        lines.push('• ' + ev.timeFormatted + ' : ' + ev.title + (ev.location ? ' (' + ev.location + ')' : ''));
        if (ev.conferenceLink) lines.push('  Visio : ' + ev.conferenceLink);
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
