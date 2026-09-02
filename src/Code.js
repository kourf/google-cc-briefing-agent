/**
 * Google CC Briefing Agent
 * Code.js — Points d'entrée officiels de l'application
 *
 * @author Kouroufia
 * @version 2.0.0
 */

/**
 * 1. EXÉCUTION AUTOMATIQUE DE PRODUCTION (06:00:00 PILE)
 * Fonction appelée automatiquement par Google chaque matin à 06:00:00.
 * Analyse les nouveaux e-mails, l'agenda, génère le résumé IA et l'envoie par e-mail.
 * S'auto-reprogramme automatiquement pour le lendemain matin à la fin de son exécution.
 */
function runDailyBriefing() {
  console.log('=== Exécution du Briefing Quotidien (Production 06:00) ===');

  // 1. Verrouillage concurrentiel strict
  if (!StateService.acquireLock()) {
    console.warn('Exécution annulée : impossible d’acquérir le verrou ScriptLock.');
    return;
  }

  try {
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

    // 4. Récupération du checkpoint horaire
    const checkpointSec = StateService.initCheckpointIfMissing();
    const runStartTimeSec = Math.floor(Date.now() / 1000);

    console.log(`Période analysée depuis : ${new Date(checkpointSec * 1000).toISOString()}`);

    // 5. Extraction des données
    const rawEmails = GmailService.fetchUnreadEmails(checkpointSec);
    const agenda = CalendarService.getAgenda();

    // 6. Analyse par Gemini 2.0 Flash
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
    StateService.releaseLock();

    // 9. Auto-reprogrammation exacte pour le lendemain matin à 06:00:00 pile
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
  } catch (error) {
    console.error(`Erreur lors de l’envoi immédiat : ${error.stack || error.message}`);
    throw error;
  }
}
