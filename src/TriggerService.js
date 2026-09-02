/**
 * Google CC Briefing Agent
 * TriggerService.js — Exact-time daily 6:00 AM scheduler with orphan trigger cleanup and self-rescheduling.
 *
 * @author Kouroufia
 * @version 2.0.0
 */

const TriggerService = (() => {
  const TRIGGER_FUNCTION_NAME = 'runDailyBriefing';
  const LEGACY_FUNCTION_NAMES = ['runBriefing', 'runBriefingPrecise'];

  /**
   * Safely purges all existing project triggers targeting the daily briefing.
   */
  const clearAllTriggers = () => {
    const allTriggers = ScriptApp.getProjectTriggers();
    let count = 0;
    const targetNames = [TRIGGER_FUNCTION_NAME, ...LEGACY_FUNCTION_NAMES];

    for (const trigger of allTriggers) {
      const handler = trigger.getHandlerFunction();
      if (targetNames.includes(handler)) {
        try {
          ScriptApp.deleteTrigger(trigger);
          count++;
        } catch (error) {
          console.warn(`Unable to remove trigger ${handler}: ${error.message}`);
        }
      }
    }

    if (count > 0) {
      console.log(`Purged ${count} existing trigger(s) to avoid duplicates.`);
    }
  };

  /**
   * Calculates the exact Date instance for the next occurrence of 06:00:00 in Europe/Paris.
   * If current time is before 06:00 today, targets today. Otherwise, targets tomorrow.
   *
   * @returns {Date} Target execution Date instance.
   */
  const calculateNextTargetDate = () => {
    const tz = Config.DEFAULTS.TIMEZONE || 'Europe/Paris';
    const targetHour = Config.DEFAULTS.TRIGGER_HOUR ?? 6;
    const targetMinute = Config.DEFAULTS.TRIGGER_MINUTE ?? 0;

    const now = new Date();
    const todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const currentHour = parseInt(Utilities.formatDate(now, tz, 'HH'), 10);
    const currentMinute = parseInt(Utilities.formatDate(now, tz, 'mm'), 10);

    const [yearStr, monthStr, dayStr] = todayStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1;
    let day = parseInt(dayStr, 10);

    // If 06:00 has already elapsed today, advance to tomorrow
    if (currentHour > targetHour || (currentHour === targetHour && currentMinute >= targetMinute)) {
      day += 1;
    }

    // JavaScript Date constructor natively resolves day/month/year overflows
    return new Date(year, month, day, targetHour, targetMinute, 0, 0);
  };

  /**
   * Installs the exact time-based trigger targeting 06:00:00 sharp.
   * Uses .timeBased().at(targetDate) instead of the loose 1-hour window atHour(6).
   *
   * @returns {Date} Exact scheduled execution time.
   */
  const setupDailyTrigger = () => {
    // 1. Purge legacy and duplicate triggers
    clearAllTriggers();

    // 2. Calculate next 06:00:00 timestamp
    const targetDate = calculateNextTargetDate();
    const tz = Config.DEFAULTS.TIMEZONE || 'Europe/Paris';

    // 3. Create single exact-time trigger
    ScriptApp.newTrigger(TRIGGER_FUNCTION_NAME)
      .timeBased()
      .at(targetDate)
      .inTimezone(tz)
      .create();

    const formattedTarget = Utilities.formatDate(targetDate, tz, 'dd/MM/yyyy à HH:mm:ss');
    console.log(`✓ Daily briefing scheduled precisely for: ${formattedTarget} (${tz}).`);

    return targetDate;
  };

  /**
   * Checks whether the current moment is a weekend day (Saturday or Sunday) in Paris.
   * @returns {boolean} True if Saturday or Sunday.
   */
  const isWeekendNow = () => {
    const now = new Date();
    const dayStr = Utilities.formatDate(now, Config.DEFAULTS.TIMEZONE, 'u'); // 1 = Monday, 7 = Sunday
    const dayNum = parseInt(dayStr, 10);
    return dayNum === 6 || dayNum === 7;
  };

  return {
    setupDailyTrigger,
    clearAllTriggers,
    calculateNextTargetDate,
    isWeekendNow
  };
})();
