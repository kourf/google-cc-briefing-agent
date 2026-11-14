/**
 * Google CC Briefing Agent
 * DevOpsAgentService.js — « Agent de Contrôle & Bon Fonctionnement ».
 *
 * Rôle : avant chaque envoi, vérifier et réparer automatiquement le suivi des e-mails,
 * l'horloge d'envoi de 06h00 et la connexion au service de résumé ; puis rendre compte
 * dans le briefing, en français clair, sans jargon technique et sans aucun emoji.
 * Fonctionne en JavaScript déterministe, même si l'IA ou le réseau sont indisponibles.
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const DevOpsAgentService = (() => {
  const EMPLOYEE_NAME = 'Agent de Contrôle & Bon Fonctionnement';
  const EMPLOYEE_ROLE = 'Supervision et bon fonctionnement de votre assistant';
  const SHIFT_HOURS = 'Vérification quotidienne avant chaque envoi';

  /** Incidents de l'exécution courante. */
  let recordedIncidents = [];
  /** Vérifications réalisées (affichées en langage courant). */
  let checks = [];

  /** Réinitialise le registre au début d'une exécution. */
  const resetSession = () => {
    recordedIncidents = [];
    checks = [];
  };

  /**
   * Enregistre un incident (dédupliqué par composant + message).
   * @param {Object} incident
   * @param {string} incident.component - Élément concerné, en mots simples.
   * @param {string} incident.severity - 'INFO' | 'WARNING' | 'CRITICAL'.
   * @param {boolean} incident.resolved - true si réparé automatiquement.
   * @param {string} incident.message - Ce qui s'est passé, sans jargon.
   * @param {string} incident.solution - Ce qui a été fait ou ce qu'il faut faire.
   */
  const recordIncident = (incident) => {
    const component = incident.component || 'Assistant';
    const message = incident.message || 'Ajustement nécessaire.';
    if (recordedIncidents.some((i) => i.component === component && i.message === message)) return;
    recordedIncidents.push({
      component,
      severity: incident.severity || 'WARNING',
      resolved: incident.resolved !== false,
      message,
      solution: incident.solution || 'Ajustement appliqué avec succès.'
    });
  };

  /**
   * Enregistre une vérification effectuée (ex. « vos e-mails (12 analysés) »).
   * @param {string} label - Libellé en français courant.
   * @param {number} [order=50] - Position dans la phrase de synthèse (croissante).
   */
  const recordCheck = (label, order = 50) => {
    if (label && !checks.some((c) => c.label === label)) checks.push({ label, order });
  };

  /**
   * Ronde de contrôle avant envoi : checkpoint, horloge d'envoi, clé d'accès.
   */
  const inspectAndSelfHeal = () => {
    // 1. Suivi des e-mails (checkpoint)
    try {
      const now = Math.floor(Date.now() / 1000);
      const lastCp = StateService.getLastCheckpointTime();
      const maxLookbackSec = Config.DEFAULTS.MAX_LOOKBACK_HOURS * 3600;
      if (!lastCp) {
        StateService.resetCheckpointTo(now - 24 * 3600);
        recordIncident({
          component: 'Suivi des e-mails',
          severity: 'INFO',
          resolved: true,
          message: 'Premier démarrage de votre assistant.',
          solution: 'Mise en place pour ne traiter que les e-mails des dernières 24 heures.'
        });
      } else if (now - lastCp > maxLookbackSec) {
        StateService.resetCheckpointTo(now - 24 * 3600);
        recordIncident({
          component: 'Suivi des e-mails',
          severity: 'WARNING',
          resolved: true,
          message: `L’assistant n’avait pas fonctionné depuis environ ${Math.round((now - lastCp) / 3600)} heures.`,
          solution: 'Recentrage automatique sur les dernières 24 heures pour un briefing rapide et lisible.'
        });
      }
    } catch (e) {
      console.warn(`Contrôle du suivi des e-mails : ${e.message}`);
      recordIncident({
        component: 'Suivi des e-mails',
        severity: 'WARNING',
        resolved: true,
        message: 'L’historique des e-mails n’a pas pu être relu.',
        solution: 'Le briefing analyse par sécurité les e-mails des dernières 24 heures.'
      });
    }

    // 2. Horloge d'envoi automatique (06h00 + filet de sécurité 07h00)
    try {
      const health = TriggerService.getTriggerHealth();
      if (!health.hasMain || !health.hasWatchdog) {
        TriggerService.setupAllTriggers();
        recordIncident({
          component: 'Horloge d’envoi automatique',
          severity: 'WARNING',
          resolved: true,
          message: 'L’envoi automatique du matin n’était plus programmé.',
          solution: 'Reprogrammation immédiate pour un envoi chaque matin à 06h00 pile, avec une vérification de secours à 07h00.'
        });
      }
      recordCheck('l’horloge d’envoi automatique de 06h00', 90);
    } catch (e) {
      console.warn(`Contrôle des déclencheurs : ${e.message}`);
      recordIncident({
        component: 'Horloge d’envoi automatique',
        severity: 'WARNING',
        resolved: false,
        message: 'L’horloge d’envoi automatique n’a pas pu être vérifiée.',
        solution: 'Une nouvelle vérification aura lieu automatiquement à 07h00.'
      });
    }

    // 3. Clé d'accès au service de résumé
    if (!Config.hasGeminiApiKey()) {
      recordIncident({
        component: 'Service de résumé automatique',
        severity: 'CRITICAL',
        resolved: false,
        message: 'La clé d’accès au service de résumé n’est pas renseignée.',
        solution: 'Votre briefing a été préparé en mode simplifié. Pour retrouver les résumés détaillés, ajoutez la clé GEMINI_API_KEY dans les Propriétés du script.'
      });
    }
  };

  /**
   * Phrase de synthèse listant les vérifications effectuées.
   * @returns {string}
   */
  const describeChecks = () => {
    const labels = [...checks].sort((a, b) => a.order - b.order).map((c) => c.label);
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`;
  };

  /**
   * Rapport destiné au briefing (Zéro Emoji garanti par un nettoyage final).
   * @returns {Object}
   */
  const generateEngineerReport = () => {
    const name = Config.DEFAULTS.RECIPIENT_NAME;
    // Seul un problème critique non résolu demande une action ; le reste est géré automatiquement.
    const hasUnresolved = recordedIncidents.some((i) => !i.resolved && i.severity === 'CRITICAL');
    const hasAdjustments = recordedIncidents.length > 0;
    const checked = describeChecks();
    const checkedSentence = checked ? `Avant l’envoi, j’ai vérifié ${checked}.` : 'Avant l’envoi, j’ai vérifié le bon fonctionnement de votre assistant.';

    let status;
    let statusPill;
    let palette;
    let engineerNote;

    if (hasUnresolved) {
      status = 'ALERT';
      statusPill = 'Votre intervention est utile';
      palette = { badge: '#EF4444', bg: '#FEF2F2', border: '#FECACA' };
      engineerNote = `Bonjour ${name}. ${checkedSentence} Un point demande votre attention, il est expliqué ci-dessous. Votre briefing a tout de même été préparé.`;
    } else if (hasAdjustments) {
      status = 'AUTO_REPAIRED';
      statusPill = 'Ajustements faits automatiquement';
      palette = { badge: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
      engineerNote = `Bonjour ${name}. ${checkedSentence} Quelques petits ajustements ont été faits automatiquement, rien n’est à faire de votre côté.`;
    } else {
      status = 'ALL_CLEAR';
      statusPill = 'Tout fonctionne normalement';
      palette = { badge: '#10B981', bg: '#ECFDF5', border: '#A7F3D0' };
      engineerNote = `Bonjour ${name}. ${checkedSentence} Tout fonctionne normalement ce matin.`;
    }

    const clean = (s) => Utils.sanitizeText(s);
    return {
      employeeName: EMPLOYEE_NAME,
      employeeRole: EMPLOYEE_ROLE,
      shiftHours: SHIFT_HOURS,
      status,
      statusPill: clean(statusPill),
      statusBadgeColor: palette.badge,
      statusBgColor: palette.bg,
      statusBorderColor: palette.border,
      engineerNote: clean(engineerNote),
      incidents: recordedIncidents.map((i) => ({
        component: clean(i.component),
        message: clean(i.message),
        solution: clean(i.solution),
        resolved: i.resolved
      })),
      hasIncidents: recordedIncidents.length > 0
    };
  };

  return {
    resetSession,
    recordIncident,
    recordCheck,
    inspectAndSelfHeal,
    generateEngineerReport
  };
})();
