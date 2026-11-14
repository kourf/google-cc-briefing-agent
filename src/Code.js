/**
 * Google CC Briefing Agent
 * Code.js — Points d'entrée officiels (visibles dans l'éditeur Apps Script) :
 *   1. runDailyBriefing        : exécution automatique de production à 06:00:00 pile.
 *   2. runBriefingNow          : envoi immédiat sur demande (dernières 24 h).
 *   3. watchdogSafetyCheck     : filet de sécurité quotidien de 07h00.
 *   4. reparerEtActiverBriefing: réparation et réactivation complète en un clic.
 *   5. diagnostiquerBriefing   : diagnostic de santé avec rapport par e-mail.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

/**
 * Ronde de contrôle de l'Agent de Contrôle & Bon Fonctionnement (jamais bloquante).
 */
function runPreflightChecks_() {
  try {
    DevOpsAgentService.resetSession();
    DevOpsAgentService.inspectAndSelfHeal();
  } catch (error) {
    console.warn(`Contrôle préalable : ${error.message}`);
  }
}

/**
 * Chaîne complète : e-mails -> agenda -> analyse IA -> assemblage et envoi.
 * @param {number} sinceSec - Début de la période analysée (secondes UNIX).
 * @returns {Object} Résultat de BriefingService.buildAndSendBriefing.
 */
function executeBriefingPipeline_(sinceSec) {
  console.log(`Période analysée depuis : ${new Date(sinceSec * 1000).toISOString()}`);

  const rawEmails = GmailService.fetchUnreadEmails(sinceSec);

  let agenda = { todayEvents: [], tomorrowEvents: [] };
  try {
    agenda = CalendarService.getAgenda();
  } catch (error) {
    console.warn(`Agenda : ${error.message}`);
    DevOpsAgentService.recordIncident({
      component: 'Agenda',
      severity: 'WARNING',
      resolved: true,
      message: 'Votre agenda n’a pas pu être lu ce matin.',
      solution: 'Le briefing est envoyé sans la section planning ; elle reviendra automatiquement demain.'
    });
  }

  const enrichedEmails = GeminiService.analyzeEmails(rawEmails);
  return BriefingService.buildAndSendBriefing({
    emails: enrichedEmails,
    agenda,
    recipientEmail: Config.getRecipientEmail()
  });
}

/**
 * 1. EXÉCUTION AUTOMATIQUE DE PRODUCTION (06:00:00 PILE)
 * Analyse les nouveaux e-mails, l'agenda, la météo et les actualités, envoie le briefing,
 * puis se reprogramme pour le lendemain à 06:00:00 (même en cas d'erreur).
 */
function runDailyBriefing() {
  console.log('=== Briefing quotidien (production 06:00) ===');
  runPreflightChecks_();

  let lockAcquired = false;
  try {
    lockAcquired = StateService.acquireLock();
    if (!lockAcquired) {
      console.warn('Exécution annulée : une autre exécution est déjà en cours.');
      return;
    }
    if (!Config.isWeekendEnabled() && TriggerService.isWeekendNow()) {
      console.log('Briefing non envoyé aujourd’hui (week-end désactivé).');
      return;
    }
    if (StateService.hasRunToday()) {
      console.log('Le briefing a déjà été envoyé aujourd’hui.');
      return;
    }

    const runStartSec = Math.floor(Date.now() / 1000);
    const result = executeBriefingPipeline_(StateService.initCheckpointIfMissing());
    StateService.recordSuccessfulRun(runStartSec);
    console.log('=== Briefing quotidien envoyé avec succès ===', result.stats);
  } catch (error) {
    console.error(`Erreur critique du briefing : ${Utils.redactSensitive(error.stack || error.message)}`);
  } finally {
    if (lockAcquired) StateService.releaseLock();
    // Reprogrammation systématique : la chaîne quotidienne ne s'interrompt jamais.
    try {
      TriggerService.setupDailyTrigger();
    } catch (triggerError) {
      console.error(`Reprogrammation impossible : ${triggerError.message}`);
    }
  }
}

/**
 * 2. ENVOI IMMÉDIAT DU BRIEFING (SUR DEMANDE)
 * Analyse les e-mails non lus des dernières TEST_LOOKBACK_HOURS heures (24 h par défaut)
 * sans modifier le checkpoint de production.
 * @returns {Object} Résultat de l'envoi.
 */
function runBriefingNow() {
  console.log('=== Envoi immédiat du briefing ===');
  runPreflightChecks_();
  const sinceSec = Math.floor(Date.now() / 1000) - Config.getTestLookbackHours() * 3600;
  try {
    const result = executeBriefingPipeline_(sinceSec);
    console.log(`=== Briefing envoyé à ${result.recipient} ===`, result.stats);
    return result;
  } catch (error) {
    console.error(`Erreur lors de l’envoi immédiat : ${Utils.redactSensitive(error.stack || error.message)}`);
    throw error;
  }
}

/**
 * 3. FILET DE SÉCURITÉ AUTOMATIQUE (WATCHDOG 07:00)
 * Si le briefing de 06:00 n'est pas parti (panne Google, déclencheur perdu), il est envoyé
 * immédiatement ; dans tous les cas, le déclencheur du lendemain est vérifié.
 */
function watchdogSafetyCheck() {
  console.log('=== Watchdog de sécurité (07h00) ===');
  if (StateService.hasRunToday()) {
    console.log('Briefing déjà envoyé aujourd’hui. Vérification du déclencheur de demain.');
    TriggerService.setupDailyTrigger();
    return;
  }
  console.warn('Aucun briefing envoyé ce matin : rattrapage immédiat.');
  runDailyBriefing();
}

/**
 * 4. RÉPARATION ET RÉACTIVATION COMPLÈTE EN 1 CLIC
 * - Recalibre le checkpoint sur les dernières 24 h.
 * - Réinstalle le déclencheur exact de 06:00:00 et le watchdog de 07h00.
 * - Envoie immédiatement un briefing pour confirmer la réception.
 * @returns {Object} Résultat de l'envoi.
 */
function reparerEtActiverBriefing() {
  console.log('=== Réparation et réactivation complète ===');
  StateService.resetCheckpointTo(Math.floor(Date.now() / 1000) - 24 * 3600);
  TriggerService.setupAllTriggers();
  console.log('Checkpoint recalibré et déclencheurs réinstallés. Envoi de confirmation...');
  const result = runBriefingNow();
  console.log('=== Système réparé et opérationnel ===');
  return result;
}

/**
 * 5. DIAGNOSTIC COMPLET DU SYSTÈME
 * Teste chaque composant, réinstalle les déclencheurs, envoie un rapport par e-mail,
 * puis envoie le vrai briefing.
 * @returns {string} Rapport texte.
 */
function diagnostiquerBriefing() {
  console.log('=== Diagnostic complet ===');
  const report = [];
  const logStep = (status, title, details) => {
    const line = `[${status}] ${title} : ${details}`;
    console.log(line);
    report.push({ status, line });
  };
  const check = (title, fn) => {
    try {
      fn();
    } catch (e) {
      logStep('ERREUR', title, Utils.redactSensitive(e.message));
    }
  };

  check('Service de résumé (Gemini)', () => {
    const ping = GeminiService.pingPrimaryModel();
    logStep(ping.ok ? 'OK' : 'ERREUR', 'Service de résumé (Gemini)', `${ping.detail} Modèle : ${ping.model}.`);
  });

  check('Gmail', () => {
    const unread = GmailApp.search('is:unread in:inbox', 0, 10);
    logStep('OK', 'Gmail', `${unread.length} fil(s) non lu(s) détecté(s) (échantillon de 10).`);
  });

  check('Google Agenda', () => {
    const agenda = CalendarService.getAgenda();
    logStep('OK', 'Google Agenda', `${agenda.todayEvents.length} événement(s) aujourd’hui, ${agenda.tomorrowEvents.length} demain.`);
  });

  check('Météo', () => {
    const weather = WeatherService.getWeatherReport([]);
    logStep(weather ? 'OK' : 'ATTENTION', 'Météo', weather ? `Données reçues pour ${weather.city}.` : 'Service indisponible (section omise).');
  });

  check('HugoDécrypte (YouTube)', () => {
    const yt = NewsService.checkHugoFeeds();
    const sources = `page Vidéos ${yt.page ? 'OK' : 'indisponible'}, flux RSS ${yt.rss ? 'OK' : 'indisponible'}`;
    logStep(
      yt.latestTitle ? 'OK' : 'ATTENTION',
      'HugoDécrypte (YouTube)',
      yt.latestTitle
        ? `Dernière vidéo longue : « ${yt.latestTitle} » (${yt.latestUrl}) — ${sources}.`
        : `Chaîne YouTube injoignable — ${sources}.`
    );
  });

  check('Déclencheurs', () => {
    const before = TriggerService.getTriggersSummary().length;
    TriggerService.setupAllTriggers();
    const after = TriggerService.getTriggersSummary().map((t) => t.handler);
    const next = Utilities.formatDate(TriggerService.calculateNextTargetDate(), Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy à HH:mm:ss');
    logStep('OK', 'Déclencheurs', `${before} avant, ${after.length} après réinstallation [${after.join(', ')}]. Prochain envoi : ${next}.`);
  });

  const recipient = Config.getRecipientEmail();
  check('Envoi du rapport', () => {
    const colors = { OK: '#047857', ATTENTION: '#B45309', ERREUR: '#B91C1C' };
    const items = report
      .map((r) => `<li style="margin-bottom:8px;color:${colors[r.status] || '#111827'};">${Utils.escapeHtml(r.line)}</li>`)
      .join('');
    const html = `<div style="font-family:sans-serif;padding:20px;">
      <h2 style="color:#111827;">Rapport de diagnostic du Briefing Quotidien</h2>
      <p>État de vos services au ${Utilities.formatDate(new Date(), Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy à HH:mm')} :</p>
      <ul>${items}</ul>
      <hr style="margin:20px 0;border:0;border-top:1px solid #E5E7EB;">
      <p style="color:#047857;font-weight:bold;">Déclencheurs de 06:00:00 et watchdog de 07h00 réinstallés.</p>
    </div>`;
    GmailApp.sendEmail(recipient, '[Diagnostic] Statut de votre Briefing Quotidien', report.map((r) => r.line).join('\n'), {
      htmlBody: html,
      name: 'Diagnostic Briefing Quotidien'
    });
    logStep('OK', 'Envoi du rapport', `Envoyé à ${recipient}.`);
  });

  check('Briefing quotidien', () => {
    runBriefingNow();
    logStep('OK', 'Briefing quotidien', 'Briefing assemblé et envoyé.');
  });

  console.log('=== Fin du diagnostic ===');
  return report.map((r) => r.line).join('\n');
}
