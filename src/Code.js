/**
 * Google CC Briefing Agent
 * Code.js — Points d'entrée, orchestration des tests et fonctions déclenchées
 */

/**
 * Initialisation complète en 1 clic : configure le modèle, installe le déclencheur à 06:00 et lance le test !
 */
function setupProjectAndRunTest() {
  console.log('=== INITIALISATION COMPLÈTE DU PROJET ===');
  
  // 1. Initialisation de la clé API Gemini et du modèle
  const apiKey = Config.getGeminiApiKey();
  Config.setGeminiModel('gemini-flash-lite-latest');
  console.log('✓ Modèle Gemini ultra-rapide (Flash-Lite) configuré.');

  // 2. Initialisation du checkpoint de production
  setupInitialCheckpoint();
  console.log('✓ Checkpoint initial enregistré (vos anciens e-mails ne seront pas retraités).');

  // 3. Installation du déclencheur quotidien automatique (06:00 Paris)
  installDailyTrigger();
  console.log('✓ Déclencheur quotidien configuré pour 06:00.');

  // 4. Lancement immédiat du test
  console.log('✓ Lancement du briefing test...');
  runBriefingTest();
}

/**
 * Exécution principale de Production (appelée automatiquement par le déclencheur quotidien).
 */
function runBriefing() {
  console.log('=== Démarrage du Google CC Briefing Agent (Production) ===');

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

    // 7. Analyse par Gemini (Free Tier avec sorties structurées)
    const enrichedEmails = GeminiService.analyzeEmails(rawEmails);

    // 8. Assemblage et envoi de l'e-mail de briefing
    const result = BriefingService.buildAndSendBriefing({
      emails: enrichedEmails,
      agenda: agenda,
      isTestMode: false,
      recipientEmail: Config.getRecipientEmail()
    });

    // 9. Mise à jour du checkpoint de production UNIQUEMENT après succès de l'envoi
    StateService.recordSuccessfulRun(runStartTimeSec);
    console.log('=== Briefing de production terminé et envoyé avec succès ===', result.stats);

  } catch (error) {
    console.error('Erreur critique lors de l’exécution du briefing :', error.stack || error.message);
    // Le checkpoint n'est PAS avancé, permettant une reprise propre lors du prochain déclencheur
  } finally {
    StateService.releaseLock();
  }
}

/**
 * Exécution de Test manuelle et immédiate.
 * N'affecte JAMAIS le checkpoint de production. Ne marque aucun e-mail comme lu.
 */
function runBriefingTest() {
  console.log('=== Démarrage du Test Manuel — Google CC Briefing Agent ===');

  const lookbackHours = Config.getTestLookbackHours();
  const lookbackSec = Math.floor(Date.now() / 1000) - lookbackHours * 3600;

  console.log(
    'Mode Test : analyse des e-mails non lus des dernières ' +
      lookbackHours +
      ' heures (depuis ' +
      new Date(lookbackSec * 1000).toISOString() +
      ')...'
  );

  try {
    // 1. Récupération des e-mails récents non lus
    const rawEmails = GmailService.fetchUnreadEmails(lookbackSec);

    // 2. Récupération de l'agenda
    const agenda = CalendarService.getAgenda();

    // 3. Analyse par Gemini
    const enrichedEmails = GeminiService.analyzeEmails(rawEmails);

    // 4. Envoi du briefing test
    const result = BriefingService.buildAndSendBriefing({
      emails: enrichedEmails,
      agenda: agenda,
      isTestMode: true,
      recipientEmail: Config.getRecipientEmail()
    });

    console.log('=== Test terminé avec succès ! E-mail test envoyé à ' + result.recipient + ' ===');
    console.log('Statistiques :', JSON.stringify(result.stats));

  } catch (error) {
    console.error('Erreur lors du test manuel :', error.stack || error.message);
    throw error;
  }
}

/**
 * Alias pratique pour exécuter le test rapide sous le nom 'runBriefTest'.
 */
function runBriefTest() {
  runBriefingTest();
}

/**
 * Initialise manuellement le checkpoint à l'instant présent.
 * À exécuter une fois lors de la mise en production officielle.
 */
function setupInitialCheckpoint() {
  const ts = StateService.resetCheckpointToNow();
  console.log('Checkpoint initial défini à : ' + new Date(ts * 1000).toISOString());
  console.log('Les futurs briefings de production ne traiteront que les messages reçus après cet instant.');
}

/**
 * Installe le déclencheur quotidien à 06:00 heure de Paris.
 */
function installDailyTrigger() {
  TriggerService.installDailyTrigger();
}

/**
 * Supprime le déclencheur quotidien.
 */
function removeDailyTrigger() {
  TriggerService.removeDailyTriggers();
}
