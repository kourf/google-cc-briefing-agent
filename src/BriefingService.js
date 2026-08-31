/**
 * Google CC Briefing Agent
 * BriefingService.js — Ventilation par 9 catégories, salutation temporelle dynamique,
 * branding épuré "Mon Briefing Quotidien" et expédition sans émojis problématiques.
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
    let urgentCount = 0;

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const itemData = {
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
      };

      if (email.actionRequired) {
        urgentItems.push(itemData);
        urgentCount++;
      } else {
        const catKey = email.category || 'Pour information';
        if (!groupedInfo[catKey]) {
          groupedInfo[catKey] = [];
        }
        groupedInfo[catKey].push(itemData);
      }
    }

    // 4. Préparation des variables du template
    const templateData = {
      isTestMode: isTestMode,
      dateTitle: "Votre journée à venir",
      greeting: "Bonjour Kouroufia. Voici votre programme pour la journée !",
      signoff: temporalSignoff,
      recipientName: recipientName,
      recipientEmail: recipientEmail,
      stats: {
        totalEmails: emails.length,
        urgentCount: urgentCount,
        todayEventsCount: agenda.todayEvents.length
      },
      urgentItems: urgentItems,
      groupedInfo: groupedInfo,
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

    if (data.urgentItems && data.urgentItems.length > 0) {
      lines.push('=== ACTIONS PRIORITAIRES ===');
      data.urgentItems.forEach(function (it) {
        let line = '• ' + it.sender + ' : ' + it.summary;
        if (it.actionTitle) line += ' [Action : ' + it.actionTitle + ']';
        if (it.deadline) line += ' (Échéance : ' + it.deadline + ')';
        line += ' — ' + it.webUrl;
        lines.push(line);
      });
      lines.push('');
    }

    const categories = Object.keys(data.groupedInfo || {});
    categories.forEach(function (cat) {
      lines.push('=== ' + cat.toUpperCase() + ' ===');
      data.groupedInfo[cat].forEach(function (it) {
        let line = '• ' + it.sender + ' : ' + it.summary;
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
