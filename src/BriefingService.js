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
   * Score de pertinence d'une offre par rapport au profil recherché (métier + Suisse).
   * @param {Object} offer
   * @returns {{score: number, matchesProfile: boolean}}
   */
  const scoreJobOffer = (offer) => {
    const profile = Config.JOB_PROFILE;
    const text = `${offer.title} ${offer.company} ${offer.location}`;
    const jobMatch = Utils.containsKeyword(text, profile.keywords);
    const swissMatch = Utils.containsKeyword(text, profile.swissLocations) || /\.ch(?:\/|$)/i.test(String(offer.url).split('?')[0]);
    return { score: (jobMatch ? 2 : 0) + (swissMatch ? 2 : 0), matchesProfile: jobMatch && swissMatch };
  };

  /**
   * Offres d'emploi d'un e-mail : extraites par l'IA (avec liens directs),
   * sinon liens d'offres détectés dans l'e-mail.
   * @param {Object} email
   * @returns {Array<Object>}
   */
  const offersFromEmail = (email) => {
    if (email.jobOffers && email.jobOffers.length > 0) return email.jobOffers;
    return (email.jobLinks || []).map((l) => ({ title: Utils.sanitizeText(l.text), company: '', location: '', url: l.url }));
  };

  /**
   * Offres du jour dédupliquées, triées par pertinence (comptabilité / finance en Suisse d'abord).
   * @param {Array<Object>} rawOffers
   * @returns {{items: Array<Object>, extraCount: number}}
   */
  const rankJobOffers = (rawOffers) => {
    const seen = new Set();
    const unique = rawOffers.filter((o) => {
      const key = `${o.title}|${o.company}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const ranked = unique
      .map((o, idx) => Object.assign({}, o, scoreJobOffer(o), { order: idx }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    const max = Config.JOB_PROFILE.maxOffers;
    return { items: ranked.slice(0, max), extraCount: Math.max(0, ranked.length - max) };
  };

  /**
   * Répartit les e-mails enrichis : actions prioritaires, offres d'emploi du jour,
   * groupes d'information (ordre canonique) et notifications sans importance regroupées.
   *
   * @param {Array<Object>} emails
   * @returns {{urgentItems: Array<Object>, jobOffers: Object, sortedInfoGroups: Array<Object>, lowPriority: Object}}
   */
  const organizeEmails = (emails) => {
    const urgentItems = [];
    const seenUrgent = new Set();
    const grouped = {};
    const seenGrouped = new Set();
    const rawOffers = [];
    const jobEmails = [];
    const lowPriorityBySender = new Map();

    for (const email of emails) {
      const sender = Utils.sanitizeText(email.senderDisplayName || email.senderName);
      const subject = Utils.sanitizeText(email.subject);
      const webUrl = email.webUrl || Utils.buildGmailUrl(email.threadId);

      // 1. Alertes Google liées à votre propre assistant : simple information, jamais une action.
      if (EmailClassifier.isOwnAssistantAlert(email)) {
        const ownKey = `own-assistant::${sender.toLowerCase()}`;
        if (seenGrouped.has(ownKey)) continue;
        seenGrouped.add(ownKey);
        (grouped[Config.EMAIL_CATEGORY.SECURITY] = grouped[Config.EMAIL_CATEGORY.SECURITY] || []).push({
          sender,
          summary: 'Alerte liée à **votre propre assistant** (autorisation accordée à Google CC Briefing Agent) : rien à faire si c’est bien vous qui l’avez autorisé.',
          account: accountBadge(email),
          webUrl
        });
        continue;
      }

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

      // 2. Emploi : une seule section en tête. Les offres y sont listées une par une ; les autres
      //    e-mails emploi (newsletters, alertes sans offre lisible) y figurent aussi, jamais en double plus bas.
      if (category === Config.EMAIL_CATEGORY.JOBS || EmailClassifier.isJobPlatform(email)) {
        const offers = offersFromEmail(email);
        if (offers.length > 0) {
          offers.forEach((o) => {
            const url = String(o.url || '');
            const isDirect = /^https?:\/\//i.test(url) && url !== email.webUrl && !/(?:mail|accounts)\.google\.com/i.test(url);
            rawOffers.push(Object.assign({}, o, {
              source: email.senderName,
              account: accountBadge(email),
              directUrl: isDirect ? url : '',
              emailUrl: webUrl
            }));
          });
          continue;
        }
        if (category === Config.EMAIL_CATEGORY.JOBS) {
          const jobKey = `${sender.toLowerCase()}::${Utils.normalizeSubject(subject)}`;
          if (seenGrouped.has(jobKey)) continue;
          seenGrouped.add(jobKey);
          jobEmails.push({ sender, summary: Utils.sanitizeText(email.summary), account: accountBadge(email), webUrl });
          continue;
        }
      }

      // 3. Notifications sans importance : une seule ligne compacte par expéditeur.
      if (Config.LOW_PRIORITY_EMAIL_CATEGORIES.includes(category)) {
        const name = Utils.sanitizeText(email.senderName);
        const entry = lowPriorityBySender.get(name) || { name, count: 0, webUrl };
        entry.count += email.duplicateCount || 1;
        lowPriorityBySender.set(name, entry);
        continue;
      }

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

    const lowSenders = [...lowPriorityBySender.values()].sort((a, b) => b.count - a.count);
    return {
      urgentItems,
      jobOffers: Object.assign(rankJobOffers(rawOffers), { otherEmails: jobEmails }),
      sortedInfoGroups,
      lowPriority: { total: lowSenders.reduce((n, s) => n + s.count, 0), senders: lowSenders }
    };
  };

  /**
   * Désabonnements suggérés : expéditeurs de notifications sans importance qui proposent un lien
   * de désinscription et accumulent des e-mails non lus sur 30 jours. Aucun clic automatique.
   *
   * @param {Array<Object>} emails
   * @returns {Array<{name: string, unread: number, url: string}>}
   */
  const buildUnsubscribeSuggestions = (emails) => {
    const candidates = new Map();
    for (const email of emails) {
      if (!email.unsubscribeUrl || !email.senderEmail || candidates.has(email.senderEmail)) continue;
      if (EmailClassifier.isJobPlatform(email)) continue;
      if (!Config.LOW_PRIORITY_EMAIL_CATEGORIES.includes(EmailClassifier.resolveCategory(email))) continue;
      candidates.set(email.senderEmail, { name: Utils.sanitizeText(email.senderName), url: email.unsubscribeUrl });
    }

    const suggestions = [];
    for (const [address, info] of [...candidates.entries()].slice(0, 8)) {
      if (!Utils.hasTimeFor(Config.DEFAULTS.SEND_RESERVE_MS + 15000)) break;
      const unread = GmailService.countUnreadFromLast30Days(address);
      if (unread >= Config.UNSUBSCRIBE_MIN_UNREAD_30D) suggestions.push(Object.assign({ unread }, info));
    }
    return suggestions.sort((a, b) => b.unread - a.unread).slice(0, Config.UNSUBSCRIBE_MAX_SUGGESTIONS);
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

  /** En dessous de ce nombre de créneaux habituels, l'agenda est affiché en entier. */
  const MIN_ROUTINE_TO_COMPACT = 3;

  /**
   * Agenda du jour détaillé créneau par créneau (journée type comprise). Les rendez-vous
   * inhabituels sont mis en avant ; pour demain, seuls les rendez-vous inhabituels sont listés.
   *
   * @param {Object} agenda - { todayEvents, tomorrowEvents } (événements marqués isRoutine).
   * @returns {Object}
   */
  const summarizeAgenda = (agenda) => {
    const split = (events) => {
      const routine = events.filter((e) => e.isRoutine);
      if (routine.length < MIN_ROUTINE_TO_COMPACT) return { special: events, routine: [] };
      return { special: events.filter((e) => !e.isRoutine), routine };
    };
    const today = split(agenda.todayEvents || []);
    const tomorrow = split(agenda.tomorrowEvents || []);
    const timed = today.routine.filter((e) => !e.isAllDay);
    const max = Config.DEFAULTS.MAX_TOMORROW_EVENTS;
    const routineMode = today.routine.length > 0;
    return {
      // Tous les créneaux du jour, dans l'ordre ; « highlight » = rendez-vous en dehors de la journée type.
      todayAll: (agenda.todayEvents || []).map((e) =>
        Object.assign({}, e, { highlight: routineMode && !e.isRoutine, strong: !routineMode || !e.isRoutine })
      ),
      todaySpecialCount: today.special.length,
      routine: routineMode
        ? {
            count: today.routine.length,
            start: timed.length ? timed[0].startFormatted : '',
            end: timed.length ? timed[timed.length - 1].endFormatted : ''
          }
        : null,
      tomorrowSpecial: tomorrow.special.slice(0, max),
      tomorrowExtraCount: Math.max(0, tomorrow.special.length - max),
      tomorrowRoutineCount: tomorrow.routine.length
    };
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

    const { urgentItems, jobOffers, sortedInfoGroups, lowPriority } = organizeEmails(emails);
    const agendaView = summarizeAgenda(agenda);
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

    let unsubscribeSuggestions = [];
    try {
      unsubscribeSuggestions = buildUnsubscribeSuggestions(emails);
    } catch (e) {
      console.warn(`Suggestions de désabonnement : ${e.message}`);
    }

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
      jobOffers,
      sortedInfoGroups,
      lowPriority,
      unsubscribeSuggestions,
      todayEvents: agendaView.todayAll,
      todaySpecialCount: agendaView.todaySpecialCount,
      calendarUrl: Utils.buildCalendarUrl(now),
      routine: agendaView.routine,
      tomorrowEvents: agendaView.tomorrowSpecial,
      tomorrowExtraCount: agendaView.tomorrowExtraCount,
      tomorrowRoutineCount: agendaView.tomorrowRoutineCount,
      hasZeroEmails: stats.totalEmails === 0,
      isCalm: stats.totalEmails === 0 && stats.todayEventsCount === 0,
      weatherAdviceHtml: weather ? weather.html : null,
      weatherAdviceText: weather ? weather.text : null,
      weatherLocationNote: weather ? weather.locationNote : null,
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

    if (data.jobOffers.items.length > 0 || data.jobOffers.otherEmails.length > 0) {
      lines.push('=== OFFRES D’EMPLOI DU JOUR ===');
      for (const o of data.jobOffers.items) {
        const where = o.location ? ` (${o.location})` : '';
        const match = o.matchesProfile ? ' [correspond à votre recherche]' : '';
        lines.push(`• ${o.title}${o.company ? ` — ${o.company}` : ''}${where}${match} — via ${o.source}`);
        if (o.directUrl) lines.push(`  Voir l’offre : ${o.directUrl}`);
        lines.push(`  Voir l’e-mail : ${o.emailUrl}`);
      }
      if (data.jobOffers.extraCount > 0) lines.push(`• et ${data.jobOffers.extraCount} autre(s) offre(s) dans vos alertes emploi`);
      if (data.jobOffers.otherEmails.length > 0) {
        lines.push('Autres e-mails liés à l’emploi :');
        for (const it of data.jobOffers.otherEmails) {
          lines.push(`  - ${it.sender}${badge(it)} : ${md(it.summary)} — ${it.webUrl}`);
        }
      }
      lines.push('');
    }

    if (data.sortedInfoGroups.length > 0 || data.lowPriority.total > 0 || data.unsubscribeSuggestions.length > 0) {
      lines.push('=== POUR INFORMATION (RÉCAPITULATIF DES E-MAILS REÇUS NON LUS) ===');
      for (const group of data.sortedInfoGroups) {
        lines.push(`• ${group.name} :`);
        for (const it of group.items) {
          lines.push(`  - ${it.sender}${badge(it)} : ${md(it.summary)} — ${it.webUrl}`);
        }
      }
      if (data.lowPriority.total > 0) {
        const senders = data.lowPriority.senders.map((s) => (s.count > 1 ? `${s.name} (${s.count})` : s.name)).join(', ');
        lines.push(`• ${data.lowPriority.total} notification(s) sans importance : ${senders}.`);
      }
      if (data.unsubscribeSuggestions.length > 0) {
        lines.push('• Désabonnements suggérés (e-mails jamais lus ces 30 derniers jours) :');
        for (const s of data.unsubscribeSuggestions) lines.push(`  - ${s.name} — ${s.unread} non lus — ${s.url}`);
      }
      lines.push('');
    }

    lines.push('=== AU PLANNING DU JOUR ===');
    if (data.routine) {
      const span = data.routine.start ? ` de ${data.routine.start} à ${data.routine.end}` : '';
      const special = data.todaySpecialCount > 0
        ? `${data.todaySpecialCount} rendez-vous en dehors de votre journée type (marqués « RDV »).`
        : 'Aucun rendez-vous en dehors de votre journée type.';
      lines.push(`Journée type : ${data.routine.count} créneaux${span}. ${special}`);
    }
    if (data.todayEvents.length === 0) lines.push('Aucun rendez-vous programmé aujourd’hui.');
    for (const ev of data.todayEvents) {
      const duration = ev.durationFormatted ? ` (${ev.durationFormatted})` : '';
      lines.push(`• ${ev.timeFormatted} : ${ev.highlight ? '[RDV] ' : ''}${ev.title}${duration}`);
      if (ev.description) lines.push(`  ${ev.description}`);
      if (ev.location) lines.push(`  Lieu : ${ev.location}`);
      if (ev.conferenceLink) lines.push(`  Visioconférence : ${ev.conferenceLink}`);
    }
    if (data.todayEvents.length > 0) lines.push(`Agenda du jour : ${data.calendarUrl}`);
    if (data.tomorrowEvents.length > 0) {
      lines.push('À anticiper demain :');
      for (const ev of data.tomorrowEvents) {
        lines.push(`  - ${ev.timeFormatted} : ${ev.title}`);
      }
      if (data.tomorrowExtraCount > 0) lines.push(`  - et ${data.tomorrowExtraCount} autre(s) rendez-vous`);
    } else if (data.tomorrowRoutineCount > 0) {
      lines.push('À anticiper demain : rien de particulier, journée type habituelle.');
    }
    lines.push('');

    if (data.weatherAdviceText) {
      lines.push('=== MÉTÉO & CONSEIL VESTIMENTAIRE ===', data.weatherAdviceText);
      if (data.weatherLocationNote) lines.push(data.weatherLocationNote);
      lines.push('');
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
