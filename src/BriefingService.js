/**
 * Google CC Briefing Agent
 * BriefingService.js — Agrégation des données, ventilation thématique en français,
 * calcul des KPIs et expédition du briefing quotidien.
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

    // 1. Détection des Priorités urgentes (actions concrètes ou niveaux CRITICAL / HIGH)
    const urgentPriorities = [];
    const fyiPool = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      if (email.priority === 'CRITICAL' || email.priority === 'HIGH' || email.actionRequired) {
        urgentPriorities.push({
          timeEstimate: email.estimatedActionMinutes > 0 ? email.estimatedActionMinutes + ' min' : '5 min',
          actionTitle:
            email.actionTitle && email.actionTitle !== 'Aucune action'
              ? email.actionTitle
              : (email.action && email.action !== 'Aucune action' ? email.action : email.subject),
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

    // 2. Regroupement thématique en français des e-mails informatifs (FYI)
    // Même en cas d'indisponibilité partielle de l'API Gemini (mode dégradé), les e-mails
    // de secours sont classés proprement sous "Informations générales" sans faire échouer le briefing.
    const fyiCategories = groupFyiEmails(fyiPool);

    const todayDate = new Date();
    const formattedDate = Utils.formatDateFrench(todayDate);

    // 3. Préparation des données pour le template HTML
    const templateData = {
      isTestMode: isTestMode,
      dateTitle: formattedDate,
      recipientName: 'Kouroufia',
      recipientEmail: recipientEmail,
      stats: {
        totalEmails: emails.length,
        urgentCount: urgentPriorities.length,
        todayEventsCount: agenda.todayEvents.length
      },
      urgentPriorities: urgentPriorities,
      fyiCategories: fyiCategories,
      todayEvents: agenda.todayEvents,
      tomorrowEvents: agenda.tomorrowEvents,
      isCalm: urgentPriorities.length === 0 && fyiPool.length === 0 && agenda.todayEvents.length === 0
    };

    // 4. Rendu du Template HTML
    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    // 5. Objet de l'e-mail 100% en français
    let emailSubject = '';
    if (isTestMode) {
      emailSubject = '🧪 Briefing test • Google CC (' + formattedDate + ')';
    } else {
      if (urgentPriorities.length > 0) {
        emailSubject =
          '🔴 (' +
          urgentPriorities.length +
          ' priorité' +
          (urgentPriorities.length > 1 ? 's' : '') +
          ') Briefing du matin — ' +
          formattedDate;
      } else {
        emailSubject = 'CC • Votre journée du ' + formattedDate;
      }
    }

    // 6. Envoi effectif de l'e-mail via GmailApp
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
   * Regroupe intelligemment les e-mails d'information par catégories thématiques françaises.
   * Retourne des structures propres SANS balises HTML injectées dans les chaînes.
   */
  function groupFyiEmails(emails) {
    if (!emails || emails.length === 0) return [];

    const groups = {};

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      let groupKey = 'Informations générales';
      const fromLower = (email.from || '').toLowerCase();
      const subjLower = (email.subject || '').toLowerCase();

      // Classification thématique basée sur l'expéditeur ou la catégorie Gemini
      if (
        fromLower.indexOf('google.com') !== -1 ||
        subjLower.indexOf('alerte de sécurité') !== -1 ||
        subjLower.indexOf('sécurité') !== -1
      ) {
        groupKey = 'Sécurité & Alertes';
      } else if (
        fromLower.indexOf('linkedin') !== -1 ||
        subjLower.indexOf('recrutement') !== -1 ||
        subjLower.indexOf('emploi') !== -1 ||
        subjLower.indexOf('poste') !== -1
      ) {
        groupKey = 'Opportunités & Emploi';
      } else if (
        fromLower.indexOf('aprizo') !== -1 ||
        fromLower.indexOf('asos') !== -1 ||
        subjLower.indexOf('offert') !== -1 ||
        subjLower.indexOf('promo') !== -1 ||
        subjLower.indexOf('solde') !== -1
      ) {
        groupKey = 'Achats & Bons plans';
      } else if (
        fromLower.indexOf('getyourguide') !== -1 ||
        subjLower.indexOf('voyage') !== -1 ||
        subjLower.indexOf('parcs') !== -1
      ) {
        groupKey = 'Voyages & Loisirs';
      } else if (email.category && email.category !== 'Informations générales') {
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

      if (groupName === 'Sécurité & Alertes' && items.length > 1) {
        bulletItems.push({
          prefixBold: items.length + ' alertes de sécurité Google',
          description: 'Concernant des connexions récentes et autorisations d’accès accordées sur vos comptes.',
          linkUrl: items[0].webUrl,
          linkText: 'Détails'
        });
      } else if (groupName === 'Opportunités & Emploi' && items.length > 1) {
        const highlights = items
          .map(function (it) {
            return it.subject
              .replace(/chez.*$/i, '')
              .replace(/ - 100%.*$/i, '')
              .replace(/ jusqu'à.*$/i, '')
              .trim();
          })
          .filter(function (val, idx, arr) { return arr.indexOf(val) === idx; }) // Dédoublonnage
          .slice(0, 3)
          .join(', ');

        bulletItems.push({
          prefixBold: 'Synthèse de ' + items.length + ' offres d’emploi reçues',
          description: highlights ? highlights + ', etc.' : 'Nouvelles alertes reçues.',
          linkUrl: items[0].webUrl,
          linkText: 'Voir sur LinkedIn'
        });
      } else if (items.length > 1 && items.every(function (it) { return it.from === items[0].from; })) {
        const senderName = Utils.cleanSenderName(items[0].from);
        bulletItems.push({
          prefixBold: senderName + ' (' + items.length + ' messages)',
          description: items[0].summary,
          linkUrl: items[0].webUrl,
          linkText: 'Détails'
        });
      } else {
        for (let j = 0; j < items.length; j++) {
          const it = items[j];
          bulletItems.push({
            prefixBold: Utils.stripHtmlAndMarkdown(it.subject),
            description: Utils.stripHtmlAndMarkdown(it.summary),
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
   * Version texte brut de secours (plain text 100% en français).
   */
  function renderPlainText(data) {
    const lines = [];
    lines.push('CC • VOTRE JOURNÉE');
    lines.push(data.dateTitle);
    lines.push('Bonjour, ' + data.recipientName + '. Voici votre plan d\'action pour aujourd\'hui !');
    lines.push('');

    if (data.urgentPriorities.length > 0) {
      lines.push('=== PRIORITÉS URGENTES ===');
      data.urgentPriorities.forEach(function (e) {
        lines.push('• ⏱ ' + e.timeEstimate + ' : ' + e.actionTitle + ' — ' + e.context);
        if (e.deadline) lines.push('  Échéance : ' + e.deadline);
        lines.push('  Lien : ' + e.webUrl);
      });
      lines.push('');
    }

    if (data.fyiCategories.length > 0) {
      lines.push('=== POUR INFORMATION ===');
      data.fyiCategories.forEach(function (cat) {
        lines.push('• ' + cat.categoryName + ' :');
        cat.items.forEach(function (it) {
          lines.push('  - ' + it.prefixBold + ' : ' + it.description + ' [' + it.linkUrl + ']');
        });
      });
      lines.push('');
    }

    if (data.todayEvents.length > 0) {
      lines.push('=== VOTRE PLANNING DU JOUR ===');
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
    lines.push('Passez une excellente journée !');
    lines.push('CC • ' + data.recipientEmail);

    return lines.join('\n');
  }

  return {
    buildAndSendBriefing: buildAndSendBriefing
  };
})();
