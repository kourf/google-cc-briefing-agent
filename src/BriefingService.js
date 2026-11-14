/**
 * Google CC Briefing Agent
 * BriefingService.js — Assemblage du briefing : actions prioritaires, récapitulatif catégorisé,
 * agenda (aujourd'hui + demain), météo, actualités, rapport de l'Agent de Contrôle, rendu et envoi.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const BriefingService = (() => {
  /**
   * Badge de provenance affiché uniquement pour les comptes secondaires (Pro, Ancien Perso).
   * @param {Object} email
   * @returns {Object|null}
   */
  const accountBadge = (email) => {
    const acc = email.account;
    if (!acc || acc.type === 'main') return null;
    return { label: acc.label, bg: acc.badgeBg, color: acc.badgeColor, border: acc.badgeBorder };
  };

  /**
   * Répartit les e-mails enrichis entre actions prioritaires et groupes d'information,
   * avec déduplication et ordre canonique des catégories (Config.EMAIL_CATEGORIES).
   *
   * @param {Array<Object>} emails
   * @returns {{urgentItems: Array<Object>, sortedInfoGroups: Array<Object>}}
   */
  const organizeEmails = (emails) => {
    const urgentItems = [];
    const seenUrgent = new Set();
    const grouped = {};
    const seenGrouped = new Set();

    for (const email of emails) {
      const sender = Utils.sanitizeText(email.senderDisplayName || email.senderName);
      const subject = Utils.sanitizeText(email.subject);
      const webUrl = email.webUrl || Utils.buildGmailUrl(email.threadId);

      if (email.actionRequired && email.actionTitle) {
        const key = Utils.normalizeSubject(email.actionTitle) || Utils.normalizeSubject(subject);
        if (seenUrgent.has(key)) continue;
        seenUrgent.add(key);
        urgentItems.push({
          timeEstimate: `${email.estimatedMinutes || 5} min`,
          actionTitle: Utils.sanitizeText(email.actionTitle),
          summary: Utils.sanitizeText(email.summary),
          deadline: email.deadline ? Utils.sanitizeText(email.deadline) : null,
          account: accountBadge(email),
          webUrl
        });
        continue;
      }

      const category = EmailClassifier.resolveCategory(email);
      const key = `${sender.toLowerCase()}::${Utils.normalizeSubject(subject)}`;
      if (seenGrouped.has(key)) continue;
      seenGrouped.add(key);
      (grouped[category] = grouped[category] || []).push({
        sender,
        summary: Utils.sanitizeText(email.summary),
        account: accountBadge(email),
        webUrl
      });
    }

    const sortedInfoGroups = Config.EMAIL_CATEGORIES
      .filter((c) => grouped[c.name] && grouped[c.name].length > 0)
      .map((c) => ({ name: c.name, items: grouped[c.name] }));

    return { urgentItems, sortedInfoGroups };
  };

  /**
   * Section météo (jamais bloquante).
   * @param {Array<Object>} todayEvents
   * @returns {Object|null}
   */
  const buildWeather = (todayEvents) => {
    if (!Config.DEFAULTS.WEATHER_ENABLED) return null;
    try {
      const weather = WeatherService.buildWeatherSection(todayEvents);
      if (weather) {
        DevOpsAgentService.recordCheck(`la météo ${Utils.withDe(weather.city)}`, 30);
        return weather;
      }
      DevOpsAgentService.recordIncident({
        component: 'Météo',
        severity: 'INFO',
        resolved: true,
        message: 'Le service météo n’a pas répondu ce matin.',
        solution: 'La section météo est simplement omise aujourd’hui, le reste du briefing est complet.'
      });
    } catch (e) {
      console.warn(`Météo : ${e.message}`);
    }
    return null;
  };

  /**
   * Section actualités (jamais bloquante).
   * @returns {Object|null}
   */
  const buildNews = () => {
    if (!Config.DEFAULTS.NEWS_ENABLED) return null;
    try {
      console.log('Collecte des actualités (HugoDécrypte + Google Actualités)...');
      const newsData = NewsService.fetchDailyNewsData();
      const digest = GeminiService.generateNewsDigest(newsData);
      if (digest) {
        DevOpsAgentService.recordCheck('les actualités du jour', 40);
        if (digest.hugoEdition && !digest.hugoEdition.available) {
          DevOpsAgentService.recordIncident({
            component: 'Actualités du jour',
            severity: 'INFO',
            resolved: true,
            message: 'La vidéo HugoDécrypte n’a pas pu être récupérée : YouTube n’a pas répondu malgré plusieurs tentatives.',
            solution: 'Le complément Google Actualités reste complet ; la vidéo sera de nouveau analysée au prochain briefing.'
          });
        }
      }
      return digest;
    } catch (e) {
      console.warn(`Actualités : ${e.message}`);
      DevOpsAgentService.recordIncident({
        component: 'Actualités du jour',
        severity: 'INFO',
        resolved: true,
        message: 'Les sources d’actualités n’ont pas répondu ce matin.',
        solution: 'La section actualités est omise aujourd’hui, le reste du briefing est complet.'
      });
      return null;
    }
  };

  /**
   * Construit, rend et envoie le briefing.
   *
   * @param {Object} params
   * @param {Array<Object>} params.emails - E-mails enrichis.
   * @param {Object} params.agenda - { todayEvents, tomorrowEvents }.
   * @param {string} [params.recipientEmail] - Destinataire.
   * @returns {{success: boolean, recipient: string, subject: string, stats: Object}}
   */
  const buildAndSendBriefing = (params) => {
    const emails = params.emails || [];
    const agenda = params.agenda || { todayEvents: [], tomorrowEvents: [] };
    const todayEvents = agenda.todayEvents || [];
    const recipientEmail = params.recipientEmail || Config.getRecipientEmail();
    const recipientName = Config.DEFAULTS.RECIPIENT_NAME;
    const now = new Date();
    const dateTitle = Utils.formatDateFrench(now);

    const { urgentItems, sortedInfoGroups } = organizeEmails(emails);
    const stats = {
      totalEmails: emails.length,
      urgentCount: urgentItems.length,
      todayEventsCount: todayEvents.length
    };

    DevOpsAgentService.recordCheck(`vos e-mails (${stats.totalEmails} analysé${stats.totalEmails > 1 ? 's' : ''})`, 10);
    DevOpsAgentService.recordCheck(
      `votre agenda (${stats.todayEventsCount} rendez-vous aujourd’hui)`,
      20
    );

    const weather = buildWeather(todayEvents);
    const newsDigest = buildNews();

    let devOpsReport = null;
    try {
      devOpsReport = DevOpsAgentService.generateEngineerReport();
    } catch (e) {
      console.warn(`Rapport de l’Agent de Contrôle : ${e.message}`);
    }

    const templateData = {
      dateTitle,
      greeting: Utils.getTemporalGreeting(now, recipientName),
      signoff: Utils.getTemporalSignoff(now),
      recipientEmail,
      stats,
      urgentItems,
      sortedInfoGroups,
      todayEvents,
      tomorrowEvents: (agenda.tomorrowEvents || []).slice(0, Config.DEFAULTS.MAX_TOMORROW_EVENTS),
      tomorrowExtraCount: Math.max(0, (agenda.tomorrowEvents || []).length - Config.DEFAULTS.MAX_TOMORROW_EVENTS),
      hasZeroEmails: stats.totalEmails === 0,
      isCalm: stats.totalEmails === 0 && stats.todayEventsCount === 0,
      weatherAdviceHtml: weather ? weather.html : null,
      weatherAdviceText: weather ? weather.text : null,
      newsDigest,
      devOpsReport
    };

    const plural = stats.urgentCount > 1 ? 's' : '';
    const emailSubject = stats.urgentCount > 0
      ? `(${stats.urgentCount} action${plural} requise${plural}) Mon Briefing Quotidien • ${dateTitle}`
      : `Mon Briefing Quotidien • ${dateTitle}`;

    const htmlBody = renderTemplate(templateData);
    const plainTextBody = renderPlainText(templateData);

    console.log(`Envoi du briefing à ${recipientEmail} — ${stats.totalEmails} e-mail(s), ${stats.urgentCount} action(s), ${Math.round(Utils.elapsedMs() / 1000)} s écoulées.`);
    GmailApp.sendEmail(recipientEmail, emailSubject, plainTextBody, {
      htmlBody,
      name: 'Mon Briefing Quotidien'
    });

    return { success: true, recipient: recipientEmail, subject: emailSubject, stats };
  };

  /**
   * Rendu HTML via Template.html.
   * @param {Object} data
   * @returns {string}
   */
  const renderTemplate = (data) => {
    const template = HtmlService.createTemplateFromFile('Template');
    template.data = data;
    template.Utils = Utils;
    return template.evaluate().getContent();
  };

  /**
   * Version texte brut de l'e-mail (clients sans HTML).
   * @param {Object} data
   * @returns {string}
   */
  const renderPlainText = (data) => {
    const md = Utils.stripMarkdown;
    const badge = (item) => (item.account ? ` [${item.account.label}]` : '');
    const lines = ['MON BRIEFING QUOTIDIEN', data.dateTitle, data.greeting, ''];

    if (data.hasZeroEmails) {
      lines.push('Aucun nouvel e-mail non lu dans votre boîte de réception.', '');
    }

    if (data.urgentItems.length > 0) {
      lines.push('=== ACTIONS PRIORITAIRES ===');
      for (const item of data.urgentItems) {
        let line = `• [${item.timeEstimate}] ${item.actionTitle}${badge(item)}`;
        if (item.deadline) line += ` (${item.deadline})`;
        if (item.summary) line += ` : ${md(item.summary)}`;
        lines.push(`${line} — ${item.webUrl}`);
      }
      lines.push('');
    }

    if (data.sortedInfoGroups.length > 0) {
      lines.push('=== POUR INFORMATION (RÉCAPITULATIF DES E-MAILS REÇUS NON LUS) ===');
      for (const group of data.sortedInfoGroups) {
        lines.push(`• ${group.name} :`);
        for (const it of group.items) {
          lines.push(`  - ${it.sender}${badge(it)} : ${md(it.summary)} — ${it.webUrl}`);
        }
      }
      lines.push('');
    }

    lines.push('=== AU PLANNING DU JOUR ===');
    if (data.todayEvents.length === 0) {
      lines.push('Aucun rendez-vous programmé aujourd’hui.');
    }
    for (const ev of data.todayEvents) {
      lines.push(`• ${ev.timeFormatted} : ${ev.title}${ev.location ? ` (${ev.location})` : ''}`);
      if (ev.conferenceLink) lines.push(`  Visioconférence : ${ev.conferenceLink}`);
    }
    if (data.tomorrowEvents.length > 0) {
      lines.push('À anticiper demain :');
      for (const ev of data.tomorrowEvents) {
        lines.push(`  - ${ev.timeFormatted} : ${ev.title}`);
      }
      if (data.tomorrowExtraCount > 0) lines.push(`  - et ${data.tomorrowExtraCount} autre(s) rendez-vous`);
    }
    lines.push('');

    if (data.weatherAdviceText) {
      lines.push('=== MÉTÉO & CONSEIL VESTIMENTAIRE ===', data.weatherAdviceText, '');
    }

    if (data.newsDigest) {
      const he = data.newsDigest.hugoEdition;
      if (he) {
        lines.push('=== LES ACTUS DU JOUR — SYNTHÈSE HUGODÉCRYPTE ===');
        if (he.available) {
          lines.push(`Analyse de la dernière vidéo (${he.publishedDate}) : « ${he.videoTitle} » — ${he.videoUrl}`);
          for (const cat of he.categories || []) {
            lines.push(`• ${cat.name} :`);
            for (const item of cat.items) {
              lines.push(`  - [${item.timestamp}] ${md(item.headline)}${item.summary ? ` : ${md(item.summary)}` : ''}`);
            }
          }
        } else {
          lines.push('La dernière vidéo HugoDécrypte n’a pas pu être analysée ce matin : YouTube n’a pas répondu malgré plusieurs tentatives.');
        }
        lines.push('');
      }
      if (data.newsDigest.categories && data.newsDigest.categories.length > 0) {
        lines.push('=== COMPLÉMENT D’ACTUALITÉS ISSU DE GOOGLE ACTUALITÉS ===');
        for (const cat of data.newsDigest.categories) {
          lines.push(`• ${cat.name} :`);
          for (const item of cat.items || []) {
            lines.push(`  - ${md(item.headline)} : ${md(item.summary)}`);
          }
        }
        lines.push('');
      }
    }

    if (data.isCalm) {
      lines.push('Tout est calme aujourd’hui. Aucun e-mail prioritaire ni rendez-vous à signaler.', '');
    }

    if (data.devOpsReport) {
      const rep = data.devOpsReport;
      lines.push(`=== ${rep.employeeName.toUpperCase()} ===`);
      lines.push(`${rep.statusPill} — ${rep.shiftHours}`);
      lines.push(rep.engineerNote);
      for (const inc of rep.hasIncidents ? rep.incidents : []) {
        lines.push(`• [${inc.component}] ${inc.message} -> ${inc.solution}`);
      }
      lines.push('');
    }

    lines.push(data.signoff, `Mon Briefing Quotidien • ${data.recipientEmail}`);
    return lines.join('\n');
  };

  return {
    buildAndSendBriefing
  };
})();
