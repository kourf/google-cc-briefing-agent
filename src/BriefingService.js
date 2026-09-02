/**
 * Google CC Briefing Agent
 * BriefingService.js — Orchestration of email categorization, agenda assembly, HTML rendering, and delivery.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const BriefingService = (() => {
  /**
   * Safety keyword router guaranteeing proper domain categorization.
   * Disambiguates LinkedIn invitations from job postings and news feeds.
   *
   * @param {string} rawCategory - Category suggested by AI.
   * @param {string} sender - Clean sender name.
   * @param {string} subject - Clean email subject.
   * @returns {string} Definitive category label.
   */
  const routeCategorySafely = (rawCategory, sender, subject) => {
    const text = `${sender || ''} ${subject || ''}`.toLowerCase();

    // 1. LinkedIn Contextual Disambiguation
    if (text.includes('linkedin')) {
      // Invitations & Connection Requests
      if (
        text.includes('attends votre réponse') ||
        text.includes('rejoindre votre réseau') ||
        text.includes('invitation') ||
        text.includes('connecter') ||
        text.includes('invites you to connect')
      ) {
        return 'Réseaux sociaux & Culture';
      }
      // Newsletters & Analysis Articles
      if (
        text.includes('trump') ||
        text.includes('data centre') ||
        text.includes('build-out') ||
        text.includes('newsletter')
      ) {
        return 'Actualités & Veille';
      }
      // Job opportunities
      return 'Emploi & Carrière';
    }

    // 2. Job & Recruitment Platforms
    if (
      text.includes('michaelpage') ||
      text.includes('michael page') ||
      text.includes('meteojob') ||
      text.includes('hellowork') ||
      text.includes('apec') ||
      text.includes('indeed') ||
      text.includes('job') ||
      text.includes('offres finance') ||
      text.includes('finance & accounting') ||
      text.includes('treuhand') ||
      text.includes('candidat') ||
      text.includes('recrutement')
    ) {
      return 'Emploi & Carrière';
    }

    // 3. Public Administration & Training
    if (
      text.includes('caf.fr') ||
      text.includes('impots.gouv') ||
      text.includes('ameli.fr') ||
      text.includes('croupier') ||
      text.includes('formation')
    ) {
      return 'Démarches & Administration';
    }

    // 4. Healthcare
    if (
      text.includes('doctolib') ||
      text.includes('qare') ||
      text.includes('ordonnance') ||
      text.includes('medecin')
    ) {
      return 'Santé & Soins';
    }

    return rawCategory || 'Actualités & Veille';
  };

  /**
   * Constructs, renders, and dispatches the daily briefing email.
   *
   * @param {Object} params - Execution parameters.
   * @param {Array<Object>} params.emails - Enriched email items.
   * @param {Object} params.agenda - Today and tomorrow calendar events.
   * @param {string} [params.recipientEmail] - Target recipient address.
   * @returns {Object} Execution summary and metrics.
   */
  const buildAndSendBriefing = (params) => {
    const emails = params.emails || [];
    const agenda = params.agenda || { todayEvents: [], tomorrowEvents: [] };
    const recipientEmail = params.recipientEmail || Config.getRecipientEmail();
    const recipientName = 'Kouroufia';

    const now = new Date();
    const formattedDate = Utils.formatDateFrench(now);
    const temporalGreeting = Utils.getTemporalGreeting(now, recipientName);
    const temporalSignoff = Utils.getTemporalSignoff(now);

    const urgentItems = [];
    const seenUrgentKeys = new Set();
    const groupedInfo = {};
    const seenGroupedKeys = new Set();

    // Logical category presentation order
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

    for (const email of emails) {
      const senderClean = Utils.sanitizeText(email.senderDisplayName || email.senderName);
      const subjectClean = Utils.sanitizeText(email.subject);

      if (email.actionRequired && email.actionTitle) {
        // Strict deduplication of priority actions by normalized title/subject
        const actionNorm = Utils.normalizeSubject(email.actionTitle) || Utils.normalizeSubject(subjectClean);
        if (seenUrgentKeys.has(actionNorm)) {
          continue;
        }
        seenUrgentKeys.add(actionNorm);

        urgentItems.push({
          id: email.id,
          threadId: email.threadId,
          timeEstimate: `${email.estimatedMinutes || 5} min`,
          actionTitle: Utils.sanitizeText(email.actionTitle),
          summary: Utils.sanitizeText(email.summary),
          deadline: email.deadline ? Utils.sanitizeText(email.deadline) : null,
          webUrl: email.webUrl || Utils.buildGmailUrl(email.threadId)
        });
      } else {
        const rawCat = Utils.sanitizeText(email.category) || 'Actualités & Veille';
        const catKey = routeCategorySafely(rawCat, senderClean, subjectClean);

        if (!groupedInfo[catKey]) {
          groupedInfo[catKey] = [];
        }

        // Strict campaign deduplication per sender and normalized subject
        const itemKey = `${senderClean.toLowerCase()}::${Utils.normalizeSubject(subjectClean)}`;
        if (!seenGroupedKeys.has(itemKey)) {
          seenGroupedKeys.add(itemKey);
          groupedInfo[catKey].push({
            id: email.id,
            sender: senderClean,
            summary: Utils.sanitizeText(email.summary),
            webUrl: email.webUrl || Utils.buildGmailUrl(email.threadId)
          });
        }
      }
    }

    // Sort categories into standardized visual order
    const sortedInfoGroups = [];
    for (const catName of preferredCategoryOrder) {
      if (groupedInfo[catName]?.length > 0) {
        sortedInfoGroups.push({
          name: catName,
          items: groupedInfo[catName]
        });
        delete groupedInfo[catName];
      }
    }

    // Append remaining categories if any
    for (const [otherCat, items] of Object.entries(groupedInfo)) {
      if (items?.length > 0) {
        sortedInfoGroups.push({
          name: otherCat,
          items
        });
      }
    }

    // Explicit numerical casting for statistics badge
    const totalEmails = Number(emails.length) || 0;
    const urgentCount = Number(urgentItems.length) || 0;
    const todayEventsCount = Number(agenda.todayEvents?.length) || 0;

    const templateData = {
      dateTitle: formattedDate,
      greeting: temporalGreeting,
      signoff: temporalSignoff,
      recipientName,
      recipientEmail,
      stats: {
        totalEmails,
        urgentCount,
        todayEventsCount
      },
      urgentItems,
      sortedInfoGroups,
      todayEvents: agenda.todayEvents || [],
      tomorrowEvents: agenda.tomorrowEvents || [],
      hasZeroEmails: totalEmails === 0,
      isCalm: totalEmails === 0 && todayEventsCount === 0
    };

    // Executive email subject
    const emailSubject = urgentCount > 0
      ? `(${urgentCount} action${urgentCount > 1 ? 's' : ''} requise${urgentCount > 1 ? 's' : ''}) Mon Briefing Quotidien • ${formattedDate}`
      : `Mon Briefing Quotidien • ${formattedDate}`;

    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    console.log(
      `Delivering daily briefing to: ${recipientEmail} ("${emailSubject}") — Stats: ${totalEmails} email(s), ${urgentCount} action(s).`
    );

    GmailApp.sendEmail(recipientEmail, emailSubject, plainTextBody, {
      htmlBody,
      name: 'Mon Briefing Quotidien'
    });

    return {
      success: true,
      recipient: recipientEmail,
      subject: emailSubject,
      stats: templateData.stats
    };
  };

  /**
   * Evaluates the HTML template with template parameters.
   * @param {Object} data - Template variables.
   * @returns {string} Rendered HTML.
   */
  const renderTemplate = (data) => {
    const template = HtmlService.createTemplateFromFile('Template');
    template.data = data;
    template.Utils = Utils;
    return template.evaluate().getContent();
  };

  /**
   * Produces fallback plain-text version of the briefing email.
   * @param {Object} data - Template variables.
   * @returns {string} Plain-text representation.
   */
  const renderPlainText = (data) => {
    const lines = [
      'MON BRIEFING QUOTIDIEN',
      data.dateTitle,
      data.greeting,
      ''
    ];

    if (data.hasZeroEmails) {
      lines.push('✨ Aucun nouvel e-mail non lu dans votre boîte de réception.', '');
    }

    if (data.urgentItems.length > 0) {
      lines.push('=== ACTIONS PRIORITAIRES ===');
      for (const item of data.urgentItems) {
        let line = `• ⏱ ${item.timeEstimate} — ${item.actionTitle}`;
        if (item.deadline) line += ` (${item.deadline})`;
        if (item.summary) line += ` : ${item.summary}`;
        line += ` — ${item.webUrl}`;
        lines.push(line);
      }
      lines.push('');
    }

    if (data.sortedInfoGroups.length > 0) {
      lines.push('=== POUR INFORMATION (RÉCAPITULATIF DES E-MAILS REÇUS NON LUS) ===');
      for (const group of data.sortedInfoGroups) {
        lines.push(`• ${group.name} :`);
        for (const it of group.items) {
          lines.push(`  - ${it.sender} : ${it.summary} — ${it.webUrl}`);
        }
      }
      lines.push('');
    }

    if (data.todayEvents.length > 0) {
      lines.push('=== AU PLANNING DU JOUR ===');
      for (const ev of data.todayEvents) {
        lines.push(`• ${ev.timeFormatted} : ${ev.title}${ev.location ? ` (${ev.location})` : ''}`);
        if (ev.conferenceLink) lines.push(`  Visio : ${ev.conferenceLink}`);
      }
      lines.push('');
    }

    if (data.isCalm) {
      lines.push('Tout est calme aujourd’hui. Aucun e-mail prioritaire ni rendez-vous à signaler.', '');
    }

    lines.push(data.signoff, `Mon Briefing Quotidien • ${data.recipientEmail}`);

    return lines.join('\n');
  };

  return {
    buildAndSendBriefing
  };
})();
