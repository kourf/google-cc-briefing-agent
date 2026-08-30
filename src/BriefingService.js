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

    // 1. Détection des Top of mind (Priorités réelles et actions requises)
    const topOfMind = [];
    const fyiPool = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      if (email.priority === 'CRITICAL' || email.priority === 'HIGH' || email.actionRequired) {
        topOfMind.push({
          timeEstimate: email.estimatedActionMinutes > 0 ? email.estimatedActionMinutes + ' min' : '5 min',
          actionTitle: email.actionTitle && email.actionTitle !== 'Aucune action' ? email.actionTitle : email.subject,
          context: email.summary,
          deadline: email.deadline,
          accountLabel: email.targetAccount ? email.targetAccount.label : '',
          accountIcon: email.targetAccount ? email.targetAccount.icon : '',
          webUrl: email.webUrl
        });
      } else {
        fyiPool.push(email);
      }
    }

    // 2. Regroupement intelligent et thématique des e-mails d'information (FYI)
    const fyiCategories = groupFyiEmails(fyiPool);

    const todayDate = new Date();
    const formattedDate = Utils.formatDateFrench(todayDate);

    // 3. Assemblage des données pour le template Google CC
    const templateData = {
      isTestMode: isTestMode,
      dateTitle: formattedDate,
      recipientName: 'Kouroufia',
      recipientEmail: recipientEmail,
      stats: {
        totalEmails: emails.length,
        topOfMindCount: topOfMind.length,
        todayEventsCount: agenda.todayEvents.length
      },
      topOfMind: topOfMind,
      fyiCategories: fyiCategories,
      todayEvents: agenda.todayEvents,
      tomorrowEvents: agenda.tomorrowEvents,
      isCalm: topOfMind.length === 0 && fyiPool.length === 0 && agenda.todayEvents.length === 0
    };

    // 4. Rendu du Template HTML
    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    // 5. Objet de l'e-mail dans l'esprit Google CC
    let emailSubject = '';
    if (isTestMode) {
      emailSubject = '🧪 Briefing test • Google CC (' + formattedDate + ')';
    } else {
      if (topOfMind.length > 0) {
        emailSubject = '🔴 (' + topOfMind.length + ' priorité' + (topOfMind.length > 1 ? 's' : '') + ') Briefing du matin — ' + formattedDate;
      } else {
        emailSubject = 'CC • Votre journée du ' + formattedDate;
      }
    }

    // 6. Envoi effectif de l'e-mail via GmailApp avec encodage UTF-8 explicite
    console.log('Envoi du briefing Google CC à : ' + recipientEmail + ' (Sujet : ' + emailSubject + ')');
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
   * Regroupe intelligemment les e-mails d'information par thématique.
   */
  function groupFyiEmails(emails) {
    if (!emails || emails.length === 0) return [];

    const groups = {};

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      let groupKey = 'Informations diverses';
      const fromLower = (email.from || '').toLowerCase();
      const subjLower = (email.subject || '').toLowerCase();

      if (
        fromLower.indexOf('google.com') !== -1 ||
        subjLower.indexOf('alerte de sécurité') !== -1 ||
        subjLower.indexOf('sécurité') !== -1
      ) {
        groupKey = 'Sécurité & Accès système';
      } else if (
        fromLower.indexOf('linkedin') !== -1 ||
        subjLower.indexOf('recrutement') !== -1 ||
        subjLower.indexOf('emploi') !== -1 ||
        subjLower.indexOf('poste') !== -1
      ) {
        groupKey = 'Opportunités & Emploi (LinkedIn)';
      } else if (
        fromLower.indexOf('aprizo') !== -1 ||
        fromLower.indexOf('asos') !== -1 ||
        subjLower.indexOf('offert') !== -1 ||
        subjLower.indexOf('promo') !== -1 ||
        subjLower.indexOf('solde') !== -1
      ) {
        groupKey = 'Offres & Achats';
      } else if (
        fromLower.indexOf('getyourguide') !== -1 ||
        subjLower.indexOf('voyage') !== -1 ||
        subjLower.indexOf('parcs') !== -1
      ) {
        groupKey = 'Voyages & Découvertes';
      } else if (email.category && email.category !== 'Autre' && email.category !== 'Général') {
        groupKey = email.category;
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(email);
    }

    const categoriesList = [];

    for (const groupName in groups) {
      if (!groups.hasOwnProperty(groupName)) continue;
      const items = groups[groupName];
      const bulletItems = [];

      if (groupName.indexOf('Sécurité') !== -1 && items.length > 1) {
        bulletItems.push({
          htmlText:
            '<strong>' +
            items.length +
            ' alertes de sécurité Google</strong> concernant des connexions récentes et autorisations accordées sur vos comptes.',
          linkUrl: items[0].webUrl,
          linkText: 'Détails'
        });
      } else if (groupName.indexOf('LinkedIn') !== -1 && items.length > 1) {
        const highlights = items
          .map(function (it) {
            return it.subject.replace(/chez.*$/i, '').replace(/ - 100%.*$/i, '').trim();
          })
          .slice(0, 3)
          .join(', ');
        bulletItems.push({
          htmlText:
            '<strong>Synthèse de ' +
            items.length +
            ' offres d’emploi reçues :</strong> ' +
            Utils.escapeHtml(highlights) +
            ', etc.',
          linkUrl: items[0].webUrl,
          linkText: 'Voir sur LinkedIn'
        });
      } else if (items.length > 1 && items.every(function (it) { return it.from === items[0].from; })) {
        const senderName = Utils.cleanSenderName(items[0].from);
        bulletItems.push({
          htmlText:
            '<strong>' +
            Utils.escapeHtml(senderName) +
            ' :</strong> ' +
            items.length +
            ' messages reçus (' +
            Utils.escapeHtml(items[0].summary) +
            ').',
          linkUrl: items[0].webUrl,
          linkText: 'Détails'
        });
      } else {
        for (let j = 0; j < items.length; j++) {
          const it = items[j];
          bulletItems.push({
            htmlText:
              '<strong>' +
              Utils.escapeHtml(it.subject) +
              ' :</strong> ' +
              Utils.escapeHtml(it.summary),
            linkUrl: it.webUrl,
            linkText: 'Détails'
          });
        }
      }

      categoriesList.push({
        categoryName: groupName,
        items: bulletItems
      });
    }

    return categoriesList;
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
    lines.push('CC • YOUR DAY AHEAD');
    lines.push(data.dateTitle);
    lines.push('Bonjour, ' + data.recipientName + '. Voici votre plan d\'action pour aujourd\'hui !');
    lines.push('');

    if (data.topOfMind.length > 0) {
      lines.push('=== TOP OF MIND ===');
      data.topOfMind.forEach(function (e) {
        lines.push('• ' + e.timeEstimate + ' : ' + e.actionTitle + ' (' + e.context + ')');
        if (e.deadline) lines.push('  Échéance : ' + e.deadline);
        lines.push('  Lien : ' + e.webUrl);
      });
      lines.push('');
    }

    if (data.fyiCategories.length > 0) {
      lines.push('=== FYI ===');
      data.fyiCategories.forEach(function (cat) {
        lines.push('• ' + cat.categoryName + ' :');
        cat.items.forEach(function (it) {
          lines.push('  - ' + it.htmlText.replace(/<[^>]+>/g, '') + ' [' + it.linkUrl + ']');
        });
      });
      lines.push('');
    }

    if (data.todayEvents.length > 0) {
      lines.push('=== ON YOUR CALENDAR ===');
      data.todayEvents.forEach(function (ev) {
        lines.push('• ' + ev.timeFormatted + ' : ' + ev.title + (ev.location ? ' (' + ev.location + ')' : ''));
        if (ev.conferenceLink) lines.push('  Visioconférence : ' + ev.conferenceLink);
      });
      lines.push('');
    }

    if (data.isCalm) {
      lines.push('Tout est calme ce matin. Aucun e-mail prioritaire ni rendez-vous à signaler.');
    }

    lines.push('');
    lines.push('Have a wonderful day!');
    lines.push('CC • ' + data.recipientEmail);

    return lines.join('\n');
  }

  return {
    buildAndSendBriefing: buildAndSendBriefing
  };
})();
