/**
 * Google CC Briefing Agent
 * BriefingService.js — Orchestration du briefing selon la structure exacte de référence :
 * 🧠 Actions prioritaires (dédupliquées strictement) | 🔔 Pour information | 📅 Au planning du jour
 */

const BriefingService = (function () {
  /**
   * Corrige le routage par mots-clés de sécurité pour garantir qu'aucune offre d'emploi n'échappe à Emploi & Carrière.
   */
  function routeCategorySafely(rawCategory, sender, subject) {
    const text = ((sender || '') + ' ' + (subject || '')).toLowerCase();

    // 1. Emploi & Carrière (Michael Page, Meteojob, LinkedIn, HelloWork, France Travail, etc.)
    if (
      text.indexOf('michaelpage') !== -1 ||
      text.indexOf('michael page') !== -1 ||
      text.indexOf('meteojob') !== -1 ||
      text.indexOf('linkedin') !== -1 ||
      text.indexOf('hellowork') !== -1 ||
      text.indexOf('apec') !== -1 ||
      text.indexOf('indeed') !== -1 ||
      text.indexOf('job') !== -1 ||
      text.indexOf('offres finance') !== -1 ||
      text.indexOf('finance & accounting') !== -1 ||
      text.indexOf('treuhand') !== -1 ||
      text.indexOf('candidat') !== -1 ||
      text.indexOf('recrutement') !== -1
    ) {
      return 'Emploi & Carrière';
    }

    // 2. Démarches & Administration publique
    if (
      text.indexOf('caf.fr') !== -1 ||
      text.indexOf('impots.gouv') !== -1 ||
      text.indexOf('ameli.fr') !== -1 ||
      text.indexOf('croupier') !== -1 ||
      text.indexOf('formation') !== -1
    ) {
      return 'Démarches & Administration';
    }

    // 3. Santé & Soins
    if (
      text.indexOf('doctolib') !== -1 ||
      text.indexOf('qare') !== -1 ||
      text.indexOf('ordonnance') !== -1 ||
      text.indexOf('medecin') !== -1
    ) {
      return 'Santé & Soins';
    }

    return rawCategory || 'Actualités & Veille';
  }

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
    const seenUrgentKeys = {};
    const groupedInfo = {};
    const seenGroupedKeys = {};

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
      const senderClean = Utils.sanitizeText(email.senderDisplayName || email.senderName);
      const subjectClean = Utils.sanitizeText(email.subject);

      if (email.actionRequired && email.actionTitle) {
        // DÉDUPLICATION STRICTE des actions prioritaires par titre ou sujet normalisé
        const actionNorm = Utils.normalizeSubject(email.actionTitle) || Utils.normalizeSubject(subjectClean);
        if (seenUrgentKeys[actionNorm]) {
          continue; // Déjà présent dans les actions prioritaires, élimine les doublons France Travail
        }
        seenUrgentKeys[actionNorm] = true;

        urgentItems.push({
          id: email.id,
          threadId: email.threadId,
          timeEstimate: (email.estimatedMinutes || 5) + ' min',
          actionTitle: Utils.sanitizeText(email.actionTitle),
          summary: Utils.sanitizeText(email.summary),
          deadline: email.deadline ? Utils.sanitizeText(email.deadline) : null,
          webUrl: email.webUrl
        });
      } else {
        // Routage sécurisé par mots-clés garantissant qu'aucune offre d'emploi n'atterrisse dans Actualités & Veille
        const rawCat = Utils.sanitizeText(email.category) || 'Actualités & Veille';
        const catKey = routeCategorySafely(rawCat, senderClean, subjectClean);

        if (!groupedInfo[catKey]) {
          groupedInfo[catKey] = [];
        }

        // Déduplication stricte par expéditeur et sujet normalisé
        const itemKey = senderClean.toLowerCase() + '::' + Utils.normalizeSubject(subjectClean);
        if (!seenGroupedKeys[itemKey]) {
          seenGroupedKeys[itemKey] = true;
          groupedInfo[catKey].push({
            id: email.id,
            sender: senderClean,
            summary: Utils.sanitizeText(email.summary),
            webUrl: email.webUrl
          });
        }
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

    // Cast numérique strict pour éliminer tout bug de concaténation de chaînes
    const totalEmails = Number(emails.length) || 0;
    const urgentCount = Number(urgentItems.length) || 0;
    const todayEventsCount = Number(agenda.todayEvents ? agenda.todayEvents.length : 0) || 0;

    // Préparation des variables du template
    const templateData = {
      isTestMode: isTestMode,
      dateTitle: formattedDate,
      greeting: temporalGreeting,
      signoff: temporalSignoff,
      recipientName: recipientName,
      recipientEmail: recipientEmail,
      stats: {
        totalEmails: totalEmails,
        urgentCount: urgentCount,
        todayEventsCount: todayEventsCount
      },
      urgentItems: urgentItems,
      sortedInfoGroups: sortedInfoGroups,
      todayEvents: agenda.todayEvents || [],
      tomorrowEvents: agenda.tomorrowEvents || [],
      isCalm: totalEmails === 0 && todayEventsCount === 0
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
        '") — Stats : ' +
        totalEmails +
        ' e-mails, ' +
        urgentCount +
        ' action(s)'
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
        if (e.summary) line += ' : ' + e.summary;
        line += ' — ' + e.webUrl;
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
