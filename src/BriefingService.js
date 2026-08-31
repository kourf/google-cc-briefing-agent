/**
 * Google CC Briefing Agent
 * BriefingService.js — Ventilation stricte par catégories, sujet sans émojis problématiques,
 * liens profonds vers les fils Gmail et rendu du briefing quotidien.
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

    // 1. Répartition stricte des e-mails dans les 5 catégories définies
    const categorized = {
      actions_urgentes: [],
      securite_alertes: [],
      opportunites_pro: [],
      achats_promotions: [],
      autres_informations: []
    };

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      let cat = email.category || 'autres_informations';

      // Forcer dans actions_urgentes si une action critique est requise
      if (email.actionRequired && cat !== 'actions_urgentes') {
        // Si c'est une alerte de sécurité nécessitant une action urgente, on la classe en action urgente
        if (cat === 'securite_alertes') {
          cat = 'actions_urgentes';
        }
      }

      if (!categorized[cat]) {
        cat = 'autres_informations';
      }

      const itemPayload = {
        id: email.id,
        threadId: email.threadId,
        sender: email.senderDisplayName || email.senderName,
        subject: email.subject,
        summary: email.summary,
        actionRequired: Boolean(email.actionRequired),
        actionTitle: email.actionTitle || 'Aucune action',
        deadline: email.deadline,
        timeEstimate: email.estimatedMinutes > 0 ? email.estimatedMinutes + ' min' : '5 min',
        duplicateCount: email.duplicateCount || 1,
        targetAccount: email.targetAccount,
        webUrl: Utils.buildGmailUrl(email.threadId)
      };

      categorized[cat].push(itemPayload);
    }

    const todayDate = new Date();
    const formattedDate = Utils.formatDateFrench(todayDate);

    // 2. Préparation des variables du template
    const templateData = {
      isTestMode: isTestMode,
      dateTitle: formattedDate,
      recipientName: 'Kouroufia',
      recipientEmail: recipientEmail,
      stats: {
        totalEmails: emails.length,
        urgentCount: categorized.actions_urgentes.length,
        todayEventsCount: agenda.todayEvents.length
      },
      categories: categorized,
      todayEvents: agenda.todayEvents,
      tomorrowEvents: agenda.tomorrowEvents,
      isCalm: emails.length === 0 && agenda.todayEvents.length === 0
    };

    // 3. Sujet de l'e-mail propre (zéro émoji 4-octets pour bannir définitivement l'artefact )
    let emailSubject = '';
    if (isTestMode) {
      emailSubject = '[TEST] Briefing quotidien • Google CC (' + formattedDate + ')';
    } else if (categorized.actions_urgentes.length > 0) {
      const urgentCount = categorized.actions_urgentes.length;
      emailSubject =
        '(' +
        urgentCount +
        ' action' +
        (urgentCount > 1 ? 's' : '') +
        ' requise' +
        (urgentCount > 1 ? 's' : '') +
        ') Briefing quotidien • Google CC (' +
        formattedDate +
        ')';
    } else {
      emailSubject = 'Briefing quotidien • Google CC (' + formattedDate + ')';
    }

    // 4. Évaluation du template HTML et version texte brut
    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    // 5. Expédition sécurisée via GmailApp
    console.log(
      'Envoi du briefing Google CC à : ' +
        recipientEmail +
        ' (Sujet : "' +
        emailSubject +
        '")'
    );
    GmailApp.sendEmail(recipientEmail, emailSubject, plainTextBody, {
      htmlBody: htmlBody,
      name: 'Google CC'
    });

    return {
      success: true,
      recipient: recipientEmail,
      subject: emailSubject,
      stats: templateData.stats
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
    lines.push('GOOGLE CC • VOTRE JOURNÉE');
    lines.push(data.dateTitle);
    lines.push('Bonjour ' + data.recipientName + ', voici votre plan d\'action du jour !');
    lines.push('');

    if (data.categories.actions_urgentes.length > 0) {
      lines.push('=== ACTIONS IMMÉDIATES REQUISES ===');
      data.categories.actions_urgentes.forEach(function (e) {
        lines.push('• ' + e.sender + ' : ' + e.actionTitle + ' — ' + e.summary);
        if (e.deadline) lines.push('  Échéance : ' + e.deadline);
        lines.push('  Lien : ' + e.webUrl);
      });
      lines.push('');
    }

    if (data.categories.securite_alertes.length > 0) {
      lines.push('=== SÉCURITÉ DES COMPTES & ALERTES ===');
      data.categories.securite_alertes.forEach(function (e) {
        lines.push('• ' + e.sender + ' : ' + e.summary + ' [' + e.webUrl + ']');
      });
      lines.push('');
    }

    if (data.categories.opportunites_pro.length > 0) {
      lines.push('=== OPPORTUNITÉS PRO & CARRIÈRE ===');
      data.categories.opportunites_pro.forEach(function (e) {
        lines.push('• ' + e.sender + ' : ' + e.summary + ' [' + e.webUrl + ']');
      });
      lines.push('');
    }

    if (data.categories.achats_promotions.length > 0) {
      lines.push('=== ACHATS & BONS PLANS ===');
      data.categories.achats_promotions.forEach(function (e) {
        lines.push('• ' + e.sender + ' : ' + e.summary + ' [' + e.webUrl + ']');
      });
      lines.push('');
    }

    if (data.categories.autres_informations.length > 0) {
      lines.push('=== AUTRES INFORMATIONS ===');
      data.categories.autres_informations.forEach(function (e) {
        lines.push('• ' + e.sender + ' : ' + e.summary + ' [' + e.webUrl + ']');
      });
      lines.push('');
    }

    if (data.todayEvents.length > 0) {
      lines.push('=== VOTRE PLANNING DU JOUR ===');
      data.todayEvents.forEach(function (ev) {
        lines.push('• ' + ev.timeFormatted + ' : ' + ev.title);
        if (ev.conferenceLink) lines.push('  Lien visio : ' + ev.conferenceLink);
      });
      lines.push('');
    }

    if (data.isCalm) {
      lines.push('Tout est calme ce matin. Aucun e-mail prioritaire ni rendez-vous à signaler.');
    }

    lines.push('');
    lines.push('Passez une excellente journée !');
    lines.push('Google CC • ' + data.recipientEmail);

    return lines.join('\n');
  }

  return {
    buildAndSendBriefing: buildAndSendBriefing
  };
})();
