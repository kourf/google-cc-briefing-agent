/**
 * Google CC Briefing Agent
 * Code.js — Public execution entry points and operational life-cycle handlers.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

/**
 * Installs the exact-time 06:00:00 AM daily trigger and sets the initial checkpoint.
 * Call this function once to activate automatic daily operation.
 */
function setupDailyTrigger() {
  console.log('=== ACTIVATION DU DÉCLENCHEUR QUOTIDIEN (06:00 PILE) ===');

  // 1. Verify Gemini API Key configuration
  Config.getGeminiApiKey();

  // 2. Initialize checkpoint to current instant
  StateService.resetCheckpointToNow();
  console.log('✓ Checkpoint de production calé à cet instant.');

  // 3. Configure exact 06:00:00 trigger
  const targetDate = TriggerService.setupDailyTrigger();
  const formatted = Utilities.formatDate(targetDate, Config.DEFAULTS.TIMEZONE, 'dd/MM/yyyy à HH:mm:ss');
  console.log(`✓ Prochaine exécution programmée pour le ${formatted} (${Config.DEFAULTS.TIMEZONE}).`);
}

/**
 * Primary production execution handler called automatically at 06:00:00 AM.
 * Implements strict concurrency locking, idempotence check, and self-rescheduling.
 */
function runDailyBriefing() {
  console.log('=== Exécution du Briefing Quotidien (Production 06:00) ===');

  // 1. Strict concurrency locking
  if (!StateService.acquireLock()) {
    console.warn('Exécution annulée : impossible d’acquérir le verrou ScriptLock.');
    return;
  }

  try {
    // 2. Weekend exclusion check
    if (!Config.isWeekendEnabled() && TriggerService.isWeekendNow()) {
      console.log('Briefing ignoré aujourd’hui (week-end désactivé).');
      return;
    }

    // 3. Idempotence protection (anti-duplicate run)
    if (StateService.hasRunToday()) {
      console.log('Un briefing a déjà été envoyé aujourd’hui. Exécution terminée.');
      return;
    }

    // 4. Checkpoint retrieval
    const checkpointSec = StateService.initCheckpointIfMissing();
    const runStartTimeSec = Math.floor(Date.now() / 1000);

    console.log(`Période analysée depuis : ${new Date(checkpointSec * 1000).toISOString()}`);

    // 5. Data extraction
    const rawEmails = GmailService.fetchUnreadEmails(checkpointSec);
    const agenda = CalendarService.getAgenda();

    // 6. AI processing
    const enrichedEmails = GeminiService.analyzeEmails(rawEmails);

    // 7. HTML assembly and delivery
    const result = BriefingService.buildAndSendBriefing({
      emails: enrichedEmails,
      agenda,
      recipientEmail: Config.getRecipientEmail()
    });

    // 8. Advance checkpoint upon successful delivery
    StateService.recordSuccessfulRun(runStartTimeSec);
    console.log('=== Briefing quotidien envoyé avec succès ! ===', result.stats);

  } catch (error) {
    console.error(`Erreur critique lors du briefing : ${error.stack || error.message}`);
  } finally {
    StateService.releaseLock();

    // 9. Exact-Time Self-Rescheduling Pattern:
    // Automatically schedules tomorrow morning's run at 06:00:00 sharp
    try {
      console.log('Auto-reprogrammation pour le prochain matin à 06:00:00...');
      TriggerService.setupDailyTrigger();
    } catch (triggerError) {
      console.error(`Erreur d’auto-reprogrammation : ${triggerError.message}`);
    }
  }
}

/**
 * On-demand manual execution of the definitive briefing.
 * Analyzes unread emails over the lookback window (default: 24h) and sends immediately.
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

/**
 * Backward compatibility alias for setupDailyTrigger.
 */
function activerBriefingQuotidien6h() {
  setupDailyTrigger();
}

/**
 * Backward compatibility alias for setupProjectAndRunTest.
 */
function setupProjectAndRunTest() {
  setupDailyTrigger();
  runBriefingNow();
}

/**
 * Backward compatibility alias for runDailyBriefing.
 */
function runBriefing() {
  runDailyBriefing();
}

/**
 * Backward compatibility alias for manual test execution.
 */
function runBriefTest() {
  runBriefingNow();
}

/**
 * Backward compatibility alias for runBriefingTest.
 */
function runBriefingTest() {
  runBriefingNow();
}

/**
 * Helper to manually reset the checkpoint to the current timestamp.
 */
function setupInitialCheckpoint() {
  const ts = StateService.resetCheckpointToNow();
  console.log(`Checkpoint initial calé à : ${new Date(ts * 1000).toISOString()}`);
}

/**
 * Helper to safely purge all triggers.
 */
function clearAllTriggers() {
  TriggerService.clearAllTriggers();
}
