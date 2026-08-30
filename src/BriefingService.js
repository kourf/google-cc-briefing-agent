/**
 * Google CC Briefing Agent
 * BriefingService.js — Agrégation des données, hiérarchie, calcul des KPIs et génération du briefing
 */

const BriefingService = (function () {
  /**
   * Construit et envoie le briefing quotidien.
   * @param {Object} params - { emails, agenda, isTestMode, recipientEmail }
   * @return {Object} Résumé de l'opération
   */
  function buildAndSendBriefing(params) {
    const emails = params.emails || [];
    const agenda = params.agenda || { todayEvents: [], tomorrowEvents: [] };
    const isTestMode = Boolean(params.isTestMode);
    const recipientEmail = params.recipientEmail || Config.getRecipientEmail();

    // 1. Ventilation des e-mails par niveau d'importance
    const priorityEmails = [];
    const standardEmails = [];
    const infoEmails = [];

    let totalActionsCount = 0;
    let criticalAndHighCount = 0;

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      if (email.actionRequired) {
        totalActionsCount++;
      }

      if (email.priority === 'CRITICAL' || email.priority === 'HIGH') {
        criticalAndHighCount++;
        priorityEmails.push(email);
      } else if (email.priority === 'MEDIUM') {
        standardEmails.push(email);
      } else {
        infoEmails.push(email);
      }
    }

    const todayDate = new Date();
    const formattedDate = Utils.formatDateFrench(todayDate);

    // 2. Assemblage des données pour le template
    const templateData = {
      isTestMode: isTestMode,
      dateTitle: formattedDate,
      kpis: {
        totalEmails: emails.length,
        priorityCount: criticalAndHighCount,
        actionsCount: totalActionsCount,
        todayEventsCount: agenda.todayEvents.length
      },
      priorityEmails: priorityEmails,
      standardEmails: standardEmails,
      infoEmails: infoEmails,
      todayEvents: agenda.todayEvents,
      tomorrowEvents: agenda.tomorrowEvents,
      isCalm: emails.length === 0 && agenda.todayEvents.length === 0
    };

    // 3. Rendu du Template HTML
    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    // 4. Objet de l'e-mail
    let emailSubject = '';
    if (isTestMode) {
      emailSubject = '🧪 Briefing test — Google CC (' + formattedDate + ')';
    } else {
      if (criticalAndHighCount > 0) {
        emailSubject = '🔴 (' + criticalAndHighCount + ' priorité' + (criticalAndHighCount > 1 ? 's' : '') + ') Briefing du matin — ' + formattedDate;
      } else {
        emailSubject = '☀️ Votre briefing du matin — ' + formattedDate;
      }
    }

    // 5. Envoi effectif de l'e-mail via GmailApp
    console.log('Envoi du briefing à : ' + recipientEmail + ' (Sujet : ' + emailSubject + ')');
    GmailApp.sendEmail(recipientEmail, emailSubject, plainTextBody, {
      htmlBody: htmlBody,
      name: 'Google CC Briefing'
    });

    return {
      success: true,
      recipient: recipientEmail,
      subject: emailSubject,
      stats: templateData.kpis
    };
  }

  /**
   * Évalue le template HTML avec les variables fournies.
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
    lines.push('=== VOTRE BRIEFING DU MATIN ===');
    lines.push(data.dateTitle);
    lines.push('');
    lines.push('Synthèse :');
    lines.push('- ' + data.kpis.priorityCount + ' priorité(s)');
    lines.push('- ' + data.kpis.totalEmails + ' e-mail(s) analysé(s)');
    lines.push('- ' + data.kpis.actionsCount + ' action(s) attendue(s)');
    lines.push('- ' + data.kpis.todayEventsCount + ' rendez-vous aujourd’hui');
    lines.push('');

    if (data.priorityEmails.length > 0) {
      lines.push('--- À TRAITER EN PRIORITÉ ---');
      data.priorityEmails.forEach(function (e) {
        lines.push('[' + e.priority + '] ' + e.subject + ' (' + e.from + ')');
        lines.push('Résumé : ' + e.summary);
        if (e.actionRequired) lines.push('Action : ' + e.action);
        if (e.deadline) lines.push('Échéance : ' + e.deadline);
        lines.push('Lien : ' + e.webUrl);
        lines.push('');
      });
    }

    if (data.todayEvents.length > 0) {
      lines.push('--- PLANNING DU JOUR ---');
      data.todayEvents.forEach(function (ev) {
        lines.push(ev.timeFormatted + ' : ' + ev.title + (ev.location ? ' (' + ev.location + ')' : ''));
        if (ev.conferenceLink) lines.push('Réunion : ' + ev.conferenceLink);
      });
      lines.push('');
    }

    if (data.isCalm) {
      lines.push('Tout est calme ce matin. Aucun e-mail prioritaire ni rendez-vous à signaler.');
    }

    return lines.join('\n');
  }

  return {
    buildAndSendBriefing: buildAndSendBriefing
  };
})();
