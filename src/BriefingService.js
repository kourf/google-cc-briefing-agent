/**
 * Google CC Briefing Agent
 * BriefingService.js — Agrégation des données, ventilation thématique,
 * déduplication des promotions, liens directs et expédition du briefing quotidien.
 */

const BriefingService = (function () {
  /**
   * Construit et expédie le briefing quotidien.
   * @param {Object} params - { emails, agenda, isTestMode, recipientEmail }
   * @return {Object} Résumé de l'opération
   */
  function buildAndSendBriefing(params) {
    const emails = params.emails || [];
    const agenda = params.agenda || { todayEvents: [], tomorrowEvents: [] };
    const isTestMode = Boolean(params.isTestMode);
    const recipientEmail = params.recipientEmail || Config.getRecipientEmail();

    // 1. Détection des Actions requises aujourd'hui (CRITICAL / HIGH ou actionRequired)
    const urgentActions = [];
    const fyiPool = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      if (email.priority === 'CRITICAL' || email.priority === 'HIGH' || email.actionRequired) {
        urgentActions.push({
          timeEstimate: email.estimatedActionMinutes > 0 ? email.estimatedActionMinutes + ' min' : '5 min',
          actionTitle:
            email.actionTitle && email.actionTitle !== 'Aucune action'
              ? email.actionTitle
              : (email.action && email.action !== 'Aucune action' ? email.action : email.subject),
          context: email.summary,
          deadline: email.deadline,
          duplicateCount: email.duplicateCount || 1,
          accountLabel: email.targetAccount ? email.targetAccount.label : '',
          accountIcon: email.targetAccount ? email.targetAccount.icon : '',
          threadId: email.threadId,
          webUrl: email.webUrl || Utils.buildGmailUrl(email.threadId, email.id)
        });
      } else {
        fyiPool.push(email);
      }
    }

    // 2. Regroupement thématique soigné des e-mails informatifs (FYI)
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
        urgentCount: urgentActions.length,
        todayEventsCount: agenda.todayEvents.length
      },
      urgentActions: urgentActions,
      fyiCategories: fyiCategories,
      todayEvents: agenda.todayEvents,
      tomorrowEvents: agenda.tomorrowEvents,
      isCalm: urgentActions.length === 0 && fyiPool.length === 0 && agenda.todayEvents.length === 0
    };

    // 4. Rendu du Template HTML
    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    // 5. Objet de l'e-mail propre (zéro emoji dans le sujet pour bannir définitivement l'artefact )
    let emailSubject = '';
    if (isTestMode) {
      emailSubject = '[TEST] Briefing quotidien - Google CC (' + formattedDate + ')';
    } else {
      if (urgentActions.length > 0) {
        emailSubject =
          '(Action requise : ' +
          urgentActions.length +
          ') Briefing quotidien - Google CC (' +
          formattedDate +
          ')';
      } else {
        emailSubject = 'Briefing quotidien - Google CC (' + formattedDate + ')';
      }
    }

    // 6. Envoi effectif de l'e-mail via GmailApp avec encodage UTF-8
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
   * Regroupe intelligemment les e-mails d'information par catégories thématiques enrichies.
   * Consolide strictement les messages multiples d'un même expéditeur.
   */
  function groupFyiEmails(emails) {
    if (!emails || emails.length === 0) return [];

    const groups = {};

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      let groupKey = email.category || 'ℹ️ Informations générales';

      const fromLower = (email.from || '').toLowerCase();
      const subjLower = (email.subject || '').toLowerCase();

      // Ajustement thématique de sécurité ou plateforme
      if (
        fromLower.indexOf('google.com') !== -1 ||
        subjLower.indexOf('alerte de sécurité') !== -1 ||
        subjLower.indexOf('sécurité') !== -1
      ) {
        groupKey = '🛡️ Sécurité & Alertes comptes';
      } else if (
        fromLower.indexOf('linkedin') !== -1 ||
        subjLower.indexOf('recrutement') !== -1 ||
        subjLower.indexOf('emploi') !== -1 ||
        subjLower.indexOf('poste') !== -1
      ) {
        groupKey = '💼 Opportunités & Emploi';
      } else if (
        fromLower.indexOf('aprizo') !== -1 ||
        fromLower.indexOf('asos') !== -1 ||
        subjLower.indexOf('offert') !== -1 ||
        subjLower.indexOf('promo') !== -1 ||
        subjLower.indexOf('solde') !== -1
      ) {
        groupKey = '🏷️ Achats & Bons plans';
      } else if (
        fromLower.indexOf('getyourguide') !== -1 ||
        subjLower.indexOf('voyage') !== -1 ||
        subjLower.indexOf('parcs') !== -1
      ) {
        groupKey = '✈️ Voyages & Découvertes';
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

      // 1. Synthèse unique consolidée pour les alertes de sécurité Google
      if (groupName.indexOf('Sécurité') !== -1 && items.length > 1) {
        bulletItems.push({
          prefixBold: items.length + ' alertes de sécurité Google',
          description: 'Notifications concernant des connexions récentes et autorisations d’accès accordées sur vos comptes.',
          linkUrl: items[0].webUrl,
          linkText: 'Détails'
        });
      }
      // 2. Synthèse unique consolidée pour les offres LinkedIn
      else if (groupName.indexOf('Opportunités') !== -1 && items.length > 1) {
        const highlights = items
          .map(function (it) {
            return it.subject
              .replace(/chez.*$/i, '')
              .replace(/ - 100%.*$/i, '')
              .replace(/ jusqu'à.*$/i, '')
              .trim();
          })
          .filter(function (val, idx, arr) { return arr.indexOf(val) === idx; })
          .slice(0, 3)
          .join(', ');

        bulletItems.push({
          prefixBold: 'Synthèse de ' + items.length + ' offres d’emploi reçues',
          description: highlights ? highlights + ', etc.' : 'Nouvelles alertes de postes reçues.',
          linkUrl: items[0].webUrl,
          linkText: 'Voir sur LinkedIn'
        });
      }
      // 3. E-mails multiples d'un même expéditeur commercial (ex: Aprizo)
      else if (items.length > 1 && items.every(function (it) { return it.from === items[0].from; })) {
        const senderName = Utils.cleanSenderName(items[0].from);
        const totalCount = items.reduce(function (sum, it) { return sum + (it.duplicateCount || 1); }, 0);
        bulletItems.push({
          prefixBold: senderName + ' (' + totalCount + ' messages reçus)',
          description: items[0].summary,
          linkUrl: items[0].webUrl,
          linkText: 'Détails'
        });
      }
      // 4. Affichage individuel standard pour les autres messages
      else {
        for (let j = 0; j < items.length; j++) {
          const it = items[j];
          const senderName = Utils.cleanSenderName(it.from);
          let boldTitle = it.subject;

          if (it.duplicateCount > 1) {
            boldTitle = senderName + ' (' + it.duplicateCount + ' messages reçus)';
          }

          bulletItems.push({
            prefixBold: Utils.stripHtmlAndMarkdown(boldTitle),
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
   * Version texte brut de secours (plain text).
   */
  function renderPlainText(data) {
    const lines = [];
    lines.push('CC - VOTRE JOURNÉE');
    lines.push(data.dateTitle);
    lines.push('Bonjour, ' + data.recipientName + '. Voici votre plan d\'action pour aujourd\'hui !');
    lines.push('');

    if (data.urgentActions.length > 0) {
      lines.push('=== ACTIONS REQUISES AUJOURD\'HUI ===');
      data.urgentActions.forEach(function (e) {
        lines.push('• ' + e.timeEstimate + ' : ' + e.actionTitle + ' — ' + e.context);
        if (e.deadline) lines.push('  Échéance : ' + e.deadline);
        lines.push('  Lien : ' + e.webUrl);
      });
      lines.push('');
    }

    if (data.fyiCategories.length > 0) {
      lines.push('=== NOUVEAUX MESSAGES PAR CATÉGORIE ===');
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
    lines.push('CC - ' + data.recipientEmail);

    return lines.join('\n');
  }

  return {
    buildAndSendBriefing: buildAndSendBriefing
  };
})();
