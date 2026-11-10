/**
 * Google CC Briefing Agent
 * Code.js — Points d'entrée officiels de l'application
 *
 * @author Kouroufia
 * @version 2.1.0
 */

/**
 * 1. EXÉCUTION AUTOMATIQUE DE PRODUCTION (06:00:00 PILE)
 * Fonction appelée automatiquement par Google chaque matin à 06:00:00.
 * Analyse les nouveaux e-mails, l'agenda, la météo, génère le résumé IA et l'envoie par e-mail.
 * S'auto-reprogramme automatiquement pour le lendemain matin à 06:00:00 pile.
 */
function runDailyBriefing() {
  console.log('=== Exécution du Briefing Quotidien (Production 06:00) ===');

  let lockAcquired = false;

  try {
    // 1. Verrouillage concurrentiel strict
    lockAcquired = StateService.acquireLock();
    if (!lockAcquired) {
      console.warn('Exécution annulée : impossible d’acquérir le verrou ScriptLock.');
      return;
    }

    // 2. Vérification d'exclusion du week-end
    if (!Config.isWeekendEnabled() && TriggerService.isWeekendNow()) {
      console.log('Briefing ignoré aujourd’hui (week-end désactivé).');
      return;
    }

    // 3. Protection anti-double envoi
    if (StateService.hasRunToday()) {
      console.log('Un briefing a déjà été envoyé aujourd’hui. Exécution terminée.');
      return;
    }

    // 4. Récupération du checkpoint horaire (sécurisé contre les accumulations historiques)
    const checkpointSec = StateService.initCheckpointIfMissing();
    const runStartTimeSec = Math.floor(Date.now() / 1000);

    console.log(`Période analysée depuis : ${new Date(checkpointSec * 1000).toISOString()}`);

    // 5. Extraction des données
    const rawEmails = GmailService.fetchUnreadEmails(checkpointSec);
    const agenda = CalendarService.getAgenda();

    // 6. Analyse par Gemini 2.0 Flash (avec repli automatique propre)
    const enrichedEmails = GeminiService.analyzeEmails(rawEmails);

    // 7. Assemblage et livraison de l'e-mail
    const result = BriefingService.buildAndSendBriefing({
      emails: enrichedEmails,
      agenda,
      recipientEmail: Config.getRecipientEmail()
    });

    // 8. Avancement du checkpoint après succès
    StateService.recordSuccessfulRun(runStartTimeSec);
    console.log('=== Briefing quotidien envoyé avec succès ! ===', result.stats);

  } catch (error) {
    console.error(`Erreur critique lors du briefing : ${error.stack || error.message}`);
  } finally {
    if (lockAcquired) {
      StateService.releaseLock();
    }

    // 9. Auto-reprogrammation exacte pour le lendemain matin à 06:00:00 pile
    // TOUJOURS exécutée, garantissant que la chaîne de déclencheurs ne s'arrête jamais
    try {
      console.log('Auto-reprogrammation pour le prochain matin à 06:00:00...');
      TriggerService.setupDailyTrigger();
    } catch (triggerError) {
      console.error(`Erreur d’auto-reprogrammation : ${triggerError.message}`);
    }
  }
}

/**
 * 2. ENVOI IMMÉDIAT DU BRIEFING (SUR DEMANDE)
 * Analyse les e-mails non lus des dernières 24h et envoie immédiatement votre briefing officiel.
 * Utile pour forcer un envoi en journée sans attendre 06:00.
 */
function runBriefingNow() {
  console.log('=== Envoi immédiat du Briefing Quotidien ===');

  const lookbackHours = Config.getTestLookbackHours();
  const lookbackSec = Math.floor(Date.now() / 1000) - lookbackHours * 3600;

  try {
    const rawEmails = GmailService.fetchUnreadEmails(lookbackSec);
    const agenda = CalendarService.getAgenda();
    const enrichedEmails = GeminiService.analyzeEmails(rawEmails);

    const result = BriefingService.buildAndSendBriefing({
      emails: enrichedEmails,
      agenda,
      recipientEmail: Config.getRecipientEmail()
    });

    console.log(`=== Briefing envoyé avec succès à ${result.recipient} ===`, result.stats);
    return result;
  } catch (error) {
    console.error(`Erreur lors de l’envoi immédiat : ${error.stack || error.message}`);
    throw error;
  }
}

/**
 * 3. FILET DE SÉCURITÉ AUTOMATIQUE (WATCHDOG 07:00)
 * Déclencheur récurrent quotidien (07h00) :
 * Vérifie si le briefing de 06h00 a bien été envoyé ce matin.
 * En cas de coupure réseau Google ou de déclencheur manquant, il envoie le briefing
 * et réinstalle automatiquement la programmation de 06h00 pour le lendemain !
 */
function watchdogSafetyCheck() {
  console.log('=== Vérification Watchdog de sécurité (Filet anti-panne 07h00) ===');

  if (StateService.hasRunToday()) {
    console.log('✓ Le briefing a déjà été envoyé aujourd’hui. Vérification du déclencheur de demain...');
    TriggerService.setupDailyTrigger();
    return;
  }

  console.warn('⚠️ Aucun briefing envoyé ce matin. Rattrapage automatique immédiat...');
  runDailyBriefing();
}

/**
 * 4. RÉPARATION ET RÉACTIVATION COMPLÈTE EN 1 CLIC
 * À exécuter manuellement depuis l'éditeur pour réactiver et vérifier l'ensemble du système :
 * - Recalibre le checkpoint sur les dernières 24h (évite tout bug d'accumulation historique).
 * - Nettoie et réinstalle le déclencheur précis de 06:00:00.
 * - Installe le Watchdog récurrent de sécurité (protection anti-arrêt permanent).
 * - Envoie immédiatement un briefing de test officiel pour confirmer la réception.
 */
function reparerEtActiverBriefing() {
  console.log('=== RÉPARATION ET RÉACTIVATION COMPLÈTE DU BRIEFING QUOTIDIEN ===');

  // 1. Recalibrage propre du checkpoint sur 24h
  const nowSec = Math.floor(Date.now() / 1000);
  const lookbackSec = nowSec - (24 * 3600);
  StateService.resetCheckpointTo(lookbackSec);
  console.log('✓ Checkpoint recalibré avec succès sur les dernières 24h.');

  // 2. Installation de l'architecture double de déclencheurs
  TriggerService.setupAllTriggers();
  console.log('✓ Déclencheur 06:00:00 pile ET Watchdog de sécurité installés avec succès.');

  // 3. Envoi immédiat pour confirmation visuelle
  console.log('Envoi immédiat du briefing pour confirmer la réception dans votre boîte...');
  const result = runBriefingNow();

  console.log('=== SYSTÈME RÉPARÉ ET PARFAITEMENT OPÉRATIONNEL ! ===');
  return result;
}

/**
 * 5. DIAGNOSTIC COMPLET DU SYSTÈME (SANTÉ & CONNECTIVITÉ)
 * Teste exhaustivement chaque composant, vérifie les autorisations et déclencheurs,
 * auto-répare les programmations et envoie un rapport détaillé par e-mail.
 */
function diagnostiquerBriefing() {
  console.log('=== DIAGNOSTIC COMPLET DU SYSTÈME EN COURS ===');
  const report = [];
  const logStep = (emoji, title, details) => {
    const line = `${emoji} ${title}: ${details}`;
    console.log(line);
    report.push(line);
  };

  // 1. Test des Script Properties et de la clé Gemini
  try {
    const key = Config.getGeminiApiKey();
    const maskedKey = key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : 'AUCUNE';
    logStep('🔑', 'Clé API Gemini', `Configurée (${maskedKey}) - Modèle : ${Config.getGeminiModel()}`);
  } catch (e) {
    logStep('❌', 'Clé API Gemini', `Erreur : ${e.message}`);
  }

  // 2. Test de l'API Gemini
  try {
    const apiKey = Config.getGeminiApiKey();
    const model = Config.getGeminiModel();
    const url = `${Config.DEFAULTS.GEMINI_API_BASE_URL}/${model}:generateContent?key=${apiKey}`;
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Réponds par OK.' }] }]
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) {
      logStep('🧠', 'Connexion Gemini API', `Succès HTTP 200 avec modèle ${model}`);
    } else {
      logStep('⚠️', 'Connexion Gemini API', `HTTP ${code} : ${res.getContentText().substring(0, 150)}`);
    }
  } catch (e) {
    logStep('❌', 'Connexion Gemini API', `Exception : ${e.message}`);
  }

  // 3. Test de Gmail
  try {
    const unreadThreads = GmailApp.search('is:unread in:inbox', 0, 10);
    logStep('📬', 'Accès Gmail Boîte de réception', `Succès (${unreadThreads.length} fil(s) non lu(s) détecté(s))`);
  } catch (e) {
    logStep('❌', 'Accès Gmail', `Erreur d'accès : ${e.message}`);
  }

  // 4. Test du Calendrier
  try {
    const cal = CalendarApp.getDefaultCalendar();
    const now = new Date();
    const events = cal ? cal.getEventsForDay(now) : [];
    logStep('📅', 'Google Calendar', `Succès (${events.length} événement(s) trouvé(s) pour aujourd'hui)`);
  } catch (e) {
    logStep('❌', 'Google Calendar', `Erreur d'accès : ${e.message}`);
  }

  // 5. Test Météo
  try {
    const weatherRaw = WeatherService.getRawWeatherContext([]);
    if (weatherRaw) {
      logStep('🌤️', 'Service Météo', `Données météo récupérées avec succès.`);
    } else {
      logStep('⚠️', 'Service Météo', 'Non disponible (repli transparent actif).');
    }
  } catch (e) {
    logStep('⚠️', 'Service Météo', `Erreur non bloquante : ${e.message}`);
  }

  // 6. Test et Réparation des Déclencheurs
  try {
    const triggersBefore = TriggerService.getTriggersSummary();
    logStep('⏰', 'Déclencheurs avant diagnostic', `${triggersBefore.length} déclencheur(s) actif(s)`);
    
    // Auto-réparation immédiate des déclencheurs
    TriggerService.setupAllTriggers();
    const triggersAfter = TriggerService.getTriggersSummary();
    const handlers = triggersAfter.map(t => t.handler).join(', ');
    logStep('✅', 'Déclencheurs après auto-réparation', `${triggersAfter.length} actif(s) : [${handlers}]`);
  } catch (e) {
    logStep('❌', 'Déclencheurs', `Erreur : ${e.message}`);
  }

  // 7. Envoi du Rapport de Diagnostic par Email
  const recipient = Config.getRecipientEmail();
  try {
    const reportHtml = `<div style="font-family: sans-serif; padding: 20px;">
      <h2 style="color: #111827;">Rapport de Diagnostic du Briefing Quotidien</h2>
      <p>Voici le statut en direct de vos services au ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} :</p>
      <ul>${report.map(r => `<li style="margin-bottom: 8px;">${r}</li>`).join('')}</ul>
      <hr style="margin: 20px 0; border: 0; border-top: 1px solid #E5E7EB;">
      <p style="color: #047857; font-weight: bold;">Le système a été auto-réparé : déclencheurs de 06:00:00 et Watchdog 07:00 réinstallés.</p>
    </div>`;

    GmailApp.sendEmail(recipient, '🔍 [DIAGNOSTIC] Statut de votre Briefing Quotidien', report.join('\n'), {
      htmlBody: reportHtml,
      name: 'Diagnostic Briefing Quotidien'
    });
    logStep('✉️', 'Envoi du rapport par e-mail', `Envoyé avec succès à ${recipient}`);
  } catch (e) {
    logStep('❌', 'Envoi du rapport par e-mail', `Échec d'envoi : ${e.message}`);
  }

  // 8. Envoi immédiat du vrai Briefing Quotidien
  try {
    logStep('🚀', 'Briefing Quotidien', 'Lancement de l’envoi immédiat de votre vrai briefing...');
    runBriefingNow();
    logStep('🎉', 'Briefing Quotidien', 'Votre vrai briefing a été assemblé et envoyé avec succès !');
  } catch (e) {
    logStep('❌', 'Briefing Quotidien', `Erreur briefing : ${e.message}`);
  }

  console.log('=== FIN DU DIAGNOSTIC ===');
  return report.join('\n');
}
