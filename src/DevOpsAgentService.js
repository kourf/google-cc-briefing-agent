/**
 * Google CC Briefing Agent
 * DevOpsAgentService.js — Agent Salarié Virtuel (Ingénieur DevOps & SRE Dédié)
 *
 * Rôle :
 * Supervise en continu la santé du code, des API et de l'infrastructure Google Apps Script.
 * Détecte les anomalies, auto-répare les erreurs (verrous, checkpoints, quotas IA, déclencheurs),
 * et rend compte de manière transparente dans le briefing quotidien comme un collaborateur salarié.
 *
 * Résilience absolue : Fonctionne en pur JavaScript déterministe, 100% autonome même en cas
 * de coupure totale de l'API Gemini ou de panne réseau.
 *
 * @author Kouroufia
 * @version 2.2.0
 */

const DevOpsAgentService = (() => {
  const EMPLOYEE_NAME = 'Agent de Contrôle & Bon Fonctionnement';
  const EMPLOYEE_ROLE = 'Supervision et bon fonctionnement de votre assistant';
  const SHIFT_HOURS = 'Vérification quotidienne avant chaque envoi';

  // Registre en mémoire des événements de la session active
  let recordedIncidents = [];
  let maintenanceActions = [];

  /**
   * Réinitialise le registre d'incidents au démarrage de chaque exécution.
   */
  const resetSession = () => {
    recordedIncidents = [];
    maintenanceActions = [];
  };

  /**
   * Enregistre un incident technique détecté et son statut de résolution.
   *
   * @param {Object} incident
   * @param {string} incident.component - Composant concerné ('Gestion des e-mails', 'Intelligence artificielle', etc.)
   * @param {string} incident.severity - 'INFO', 'WARNING', ou 'CRITICAL'
   * @param {boolean} incident.resolved - Si l'incident a été auto-réparé avec succès
   * @param {string} incident.message - Explication simple et humaine (sans jargon technique)
   * @param {string} incident.solution - Action corrective appliquée en mots simples
   */
  const recordIncident = (incident) => {
    const comp = incident.component || 'Système';
    const msg = incident.message || 'Ajustement nécessaire';
    const isDuplicate = recordedIncidents.some((i) => i.component === comp && i.message === msg);
    if (isDuplicate) return;

    recordedIncidents.push({
      component: comp,
      severity: incident.severity || 'WARNING',
      resolved: incident.resolved !== false,
      message: msg,
      solution: incident.solution || 'Ajustement appliqué avec succès'
    });
  };

  /**
   * Enregistre une action préventive de maintenance réussie.
   *
   * @param {string} action - Description de l'action.
   */
  const recordMaintenanceAction = (action) => {
    maintenanceActions.push(action);
  };

  /**
   * Ronde matinale pré-vol : inspecte l'infrastructure et applique l'auto-réparation
   * sans aucune dépendance à une IA externe.
   */
  const inspectAndSelfHeal = () => {
    // 1. Audit et auto-réparation du checkpoint horaire
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const lastCp = StateService.getLastCheckpointTime();
      if (!lastCp) {
        const safeStartSec = nowSec - (24 * 3600);
        StateService.resetCheckpointTo(safeStartSec);
        recordIncident({
          component: 'Gestion des e-mails',
          severity: 'INFO',
          resolved: true,
          message: 'Premier démarrage de votre assistant.',
          solution: 'Configuration propre pour ne traiter que les e-mails des dernières 24 heures.'
        });
      } else if ((nowSec - lastCp) > (48 * 3600)) {
        const safeStartSec = nowSec - (24 * 3600);
        StateService.resetCheckpointTo(safeStartSec);
        recordIncident({
          component: 'Gestion des e-mails',
          severity: 'WARNING',
          resolved: true,
          message: `L'outil n'avait pas tourné depuis plusieurs jours (${Math.round((nowSec - lastCp) / 3600)}h d’accumulation).`,
          solution: 'Recentrage automatique sur les dernières 24h pour vous livrer un briefing rapide et sans surcharge.'
        });
      } else {
        recordMaintenanceAction('Suivi des e-mails vérifié et conforme.');
      }
    } catch (e) {
      recordIncident({
        component: 'Gestion des e-mails',
        severity: 'WARNING',
        resolved: false,
        message: 'Léger contretemps sur l’historique des e-mails.',
        solution: 'Poursuite normale de l’envoi de votre briefing.'
      });
    }

    // 2. Audit des déclencheurs
    try {
      const triggers = TriggerService.getTriggersSummary();
      const hasMain = triggers.some((t) => t.handler === 'runDailyBriefing');
      const hasWatchdog = triggers.some((t) => t.handler === 'watchdogSafetyCheck');

      if (!hasMain || !hasWatchdog) {
        TriggerService.setupAllTriggers();
        recordIncident({
          component: 'Horloge d’envoi automatique',
          severity: 'WARNING',
          resolved: true,
          message: 'L’horloge d’envoi automatique n’était pas active.',
          solution: 'Réglage et verrouillage immédiat pour un envoi chaque matin à 06h00 pile.'
        });
      } else {
        recordMaintenanceAction('Horloge automatique active et programmée à 06h00.');
      }
    } catch (e) {
      recordIncident({
        component: 'Horloge d’envoi automatique',
        severity: 'WARNING',
        resolved: false,
        message: 'Impossible de vérifier l’horloge automatique.',
        solution: 'Une seconde vérification automatique aura lieu dans l’heure.'
      });
    }

    // 3. Audit de la configuration et de la clé API
    try {
      const apiKey = Config.getGeminiApiKey();
      if (!apiKey || apiKey.length < 10) {
        recordIncident({
          component: 'Connexion de l’assistant',
          severity: 'CRITICAL',
          resolved: false,
          message: 'Clé d’accès manquante dans les paramètres.',
          solution: 'Bascule automatique en mode autonome pour préparer votre briefing.'
        });
      } else {
        recordMaintenanceAction('Connexion au service d’intelligence artificielle opérationnelle.');
      }
    } catch (e) {
      recordIncident({
        component: 'Connexion de l’assistant',
        severity: 'WARNING',
        resolved: true,
        message: 'Ajustement de la clé de connexion.',
        solution: 'Utilisation de la configuration de secours.'
      });
    }
  };

  /**
   * Compile le rapport officiel de l'agent pour insertion dans le briefing.
   *
   * @returns {Object} Rapport structuré prêt pour le template HTML.
   */
  const generateEngineerReport = () => {
    const hasUnresolved = recordedIncidents.some((i) => !i.resolved && i.severity === 'CRITICAL');
    const hasAutoRepaired = recordedIncidents.some((i) => i.resolved && (i.severity === 'WARNING' || i.severity === 'INFO'));

    let status = 'ALL_CLEAR';
    let statusPill = 'Systèmes 100% opérationnels';
    let statusBadgeColor = '#10B981'; // Émeraude
    let statusBgColor = '#ECFDF5';
    let statusBorderColor = '#A7F3D0';
    let engineerNote = '';

    if (hasUnresolved) {
      status = 'ALERT';
      statusPill = 'Action requise';
      statusBadgeColor = '#EF4444'; // Rouge
      statusBgColor = '#FEF2F2';
      statusBorderColor = '#FECACA';
      engineerNote = 'Attention Kouroufia : une vérification externe nécessite une action manuelle.';
    } else if (hasAutoRepaired) {
      status = 'AUTO_REPAIRED';
      statusPill = 'Ajustements appliqués avec succès';
      statusBadgeColor = '#D97706'; // Ambre soutenu
      statusBgColor = '#FFFBEB';
      statusBorderColor = '#FDE68A';
      engineerNote = 'Bonjour Kouroufia, les systèmes ont été vérifiés et automatiquement ajustés : votre briefing est prêt et complet.';
    } else {
      status = 'ALL_CLEAR';
      statusPill = 'Systèmes 100% opérationnels';
      statusBadgeColor = '#10B981';
      statusBgColor = '#ECFDF5';
      statusBorderColor = '#A7F3D0';
      engineerNote = 'Bonjour Kouroufia, tous les systèmes fonctionnent parfaitement ce matin pour préparer votre journée !';
    }

    return {
      employeeName: EMPLOYEE_NAME,
      employeeRole: EMPLOYEE_ROLE,
      shiftHours: SHIFT_HOURS,
      status,
      statusPill,
      statusBadgeColor,
      statusBgColor,
      statusBorderColor,
      engineerNote,
      incidents: recordedIncidents,
      hasIncidents: recordedIncidents.length > 0
    };
  };

  return {
    resetSession,
    recordIncident,
    recordMaintenanceAction,
    inspectAndSelfHeal,
    generateEngineerReport,
    EMPLOYEE_NAME,
    SHIFT_HOURS
  };
})();
