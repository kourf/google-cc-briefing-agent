/**
 * Google CC Briefing Agent
 * Code.js — Points d'entrée, orchestration des tests et passage en Version Définitive (06:00 pile)
 */

/**
 * ACTIVE OFFICIELLEMENT LA VERSION DÉFINITIVE DU BRIEFING À 06:00 DU MATIN :
 * 1. Configure le modèle Gemini
 * 2. Réinitialise le checkpoint de production à l'instant présent (ignore les anciens e-mails passés)
 * 3. Installe le déclencheur temporel exact auto-reprogrammé pour 06:00:00 (Europe/Paris)
 */
function setupDailyTrigger() {
  console.log('=== ACTIVATION OFFICIELLE DU BRIEFING QUOTIDIEN (06:00 PILE) ===');
  
  // 1. Initialisation de la clé API Gemini et du modèle
  const apiKey = Config.getGeminiApiKey();
  Config.setGeminiModel('gemini-2.0-flash');
  console.log('✓ Clé API et modèle Gemini configurés avec succès.');

  // 2. Initialisation du checkpoint de production
  setupInitialCheckpoint();
  console.log('✓ Checkpoint de production calé à cet instant (les anciens e-mails lus ne seront pas retraités).');

  // 3. Installation du déclencheur temporel exact (06:00:00 Paris)
  const targetDate = TriggerService.setupDailyTrigger();
  const targetFormatted = Utilities.formatDate(targetDate, Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy à HH:mm:ss');
  
  console.log('✓ Déclencheur précis configuré pour le ' + targetFormatted + ' (' + Config.DEFAULTS.TIMEZONE + ').');
  console.log('=== LE BRIEFING QUOTIDIEN EST MAINTENANT ACTIF À 06H00 PILE ! ===');
}

/**
 * Alias pratique pour l'activation.
 */
function activerBriefingQuotidien6h() {
  setupDailyTrigger();
}

/**
 * Alias de rétrocompatibilité.
 */
function setupProjectAndRunTest() {
  setupDailyTrigger();
  console.log('✓ Lancement immédiat d’un briefing de confirmation...');
  runBriefingNow();
}

/**
 * Exécution principale de Production (appelée automatiquement chaque matin à 06:00:00).
 * Auto-reprogramme systématiquement la prochaine exécution pour le lendemain à 06:00:00 pile.
 */
function runDailyBriefing() {
  console.log('=== Démarrage du Google CC Briefing Agent (Exécution 06:00:00) ===');

  let briefingSentSuccessfully = false;

  // 1. Verrouillage concurrentiel strict
  if (!StateService.acquireLock()) {
    console.warn('Exécution annulée : impossible d’acquérir le verrou (processus déjà en cours).');
    return;
  }

  try {
    // 2. Vérification du week-end
    if (!Config.isWeekendEnabled() && TriggerService.isWeekendNow()) {
      console.log('Briefing ignoré aujourd’hui (week-end désactivé dans la configuration).');
      return;
    }

    // 3. Protection anti-double envoi
    if (StateService.hasRunToday()) {
      console.log('Un briefing a déjà été envoyé aujourd’hui. Exécution terminée pour éviter les doublons.');
      return;
    }

    // 4. Récupération ou initialisation du checkpoint
    const checkpointSec = StateService.initCheckpointIfMissing();
    const runStartTimeSec = Math.floor(Date.now() / 1000);

    console.log('Période analysée : depuis le checkpoint ' + new Date(checkpointSec * 1000).toISOString());

    // 5. Récupération des e-mails non lus
    const rawEmails = GmailService.fetchUnreadEmails(checkpointSec);

    // 6. Récupération de l'agenda
    const agenda = CalendarService.getAgenda();

    // 7. Analyse par Gemini (avec cascade résiliente et sorties structurées)
    const enrichedEmails = GeminiService.analyzeEmails(rawEmails);

    // 8. Assemblage et envoi de l'e-mail de briefing officiel
    const result = BriefingService.buildAndSendBriefing({
      emails: enrichedEmails,
      agenda: agenda,
      isTestMode: false,
      recipientEmail: Config.getRecipientEmail()
    });

    // 9. Mise à jour du checkpoint de production UNIQUEMENT après succès de l'envoi
    StateService.recordSuccessfulRun(runStartTimeSec);
    briefingSentSuccessfully = true;
    console.log('=== Briefing quotidien envoyé avec succès ! ===', result.stats);

  } catch (error) {
    console.error('Erreur critique lors de l’exécution du briefing :', error.stack || error.message);
  } finally {
    StateService.releaseLock();

    // 10. PATRON D'AUTO-REPROGRAMMATION EXACTE :
    // Dès la fin de l'exécution, reprogramme automatiquement la prochaine exécution pour demain à 06:00:00 pile.
    try {
      console.log('Planification automatique de la prochaine exécution...');
      TriggerService.setupDailyTrigger();
    } catch (triggerErr) {
      console.error('Erreur lors de l’auto-reprogrammation du déclencheur :', triggerErr.message);
    }
  }
}

/**
 * Alias de compatibilité avec les anciens déclencheurs.
 */
function runBriefing() {
  runDailyBriefing();
}

/**
 * Exécution manuelle immédiate de la version définitive (sans attendre 06:00).
 * Analyse les e-mails récents des dernières 24h et envoie le briefing définitif.
 */
function runBriefingNow() {
  console.log('=== Envoi immédiat du Briefing Quotidien (Version Définitive) ===');

  const lookbackHours = Config.getTestLookbackHours();
  const lookbackSec = Math.floor(Date.now() / 1000) - lookbackHours * 3600;

  try {
    // 1. Récupération des e-mails non lus
    const rawEmails = GmailService.fetchUnreadEmails(lookbackSec);

    // 2. Récupération de l'agenda
    const agenda = CalendarService.getAgenda();

    // 3. Analyse par Gemini
    const enrichedEmails = GeminiService.analyzeEmails(rawEmails);

    // 4. Envoi du briefing officiel
    const result = BriefingService.buildAndSendBriefing({
      emails: enrichedEmails,
      agenda: agenda,
      isTestMode: false,
      recipientEmail: Config.getRecipientEmail()
    });

    console.log('=== Briefing envoyé avec succès à ' + result.recipient + ' ===');
    console.log('Statistiques :', JSON.stringify(result.stats));

  } catch (error) {
    console.error('Erreur lors de l’envoi immédiat :', error.stack || error.message);
    throw error;
  }
}

/**
 * Alias pour exécuter le briefing immédiatement.
 */
function runBriefTest() {
  runBriefingNow();
}

/**
 * Alias de rétrocompatibilité.
 */
function runBriefingTest() {
  runBriefingNow();
}

/**
 * Initialise manuellement le checkpoint à l'instant présent.
 */
function setupInitialCheckpoint() {
  const ts = StateService.resetCheckpointToNow();
  console.log('Checkpoint initial défini à : ' + new Date(ts * 1000).toISOString());
}

/**
 * Supprime tous les déclencheurs existants.
 */
function clearAllTriggers() {
  TriggerService.clearAllTriggers();
}

/**
 * Alias de rétrocompatibilité pour la suppression.
 */
function removeDailyTrigger() {
  TriggerService.clearAllTriggers();
}
