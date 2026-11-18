/**
 * Google CC Briefing Agent
 * OfficialContacts.js — Coordonnées officielles des organismes suivis dans « Dossiers urgents ».
 *
 * Chaque fiche a été relevée sur le site officiel de l'organisme (source et date indiquées).
 * Elles complètent les coordonnées écrites dans les mails et courriers eux-mêmes (relevées par l'IA),
 * qui restent prioritaires car propres au dossier. À relire une fois par an.
 *
 * @author Kouroufia
 * @version 1.0.0
 */

const OfficialContacts = (() => {
  /**
   * Annuaire indexé par organisme (domaine renvoyé par GmailService.organisationOf).
   * phone/hours/email/online/prepare : textes affichés tels quels dans le briefing.
   */
  const DIRECTORY = Object.freeze({
    'qonto.com': {
      name: 'Service client Qonto',
      phone: '01 76 41 03 08',
      hours: 'tous les jours, de 8h à 20h',
      email: 'support@qonto.com',
      online: 'chat : petite bulle en bas à droite du site qonto.com, ou Menu > Contactez-nous dans l’application',
      prepare: 'les informations de votre compte (et le dernier mail de relance)',
      source: 'site officiel support-fr.qonto.com, page « Comment contacter le support Qonto ? », relevée le 18/11/2026'
    },
    'urssaf.fr': {
      name: 'Urssaf — auto-entrepreneurs',
      phone: '3698',
      phoneNote: 'service gratuit + prix de l’appel ; depuis l’étranger : +33 9 69 36 00 98',
      hours: 'du lundi au vendredi, de 9h à 17h',
      email: '',
      online: 'messagerie de votre espace personnel sur autoentrepreneur.urssaf.fr',
      prepare: 'votre numéro de compte Urssaf ou votre numéro de Sécurité sociale',
      source: 'site officiel autoentrepreneur.urssaf.fr, page « Nous contacter par téléphone », relevée le 18/11/2026'
    },
    'finances.gouv.fr': {
      name: 'Impôts — numéro national des professionnels',
      phone: '0 806 807 807',
      phoneNote: 'appel gratuit',
      hours: 'du lundi au vendredi, de 8h30 à 18h',
      email: '',
      online: 'messagerie sécurisée de votre espace professionnel sur impots.gouv.fr (cfspro.impots.gouv.fr)',
      prepare: 'votre numéro SIREN et la référence du courrier ou de l’avis',
      source: 'impots.gouv.fr (numéro national dédié aux entreprises) ; site en maintenance le 18/11/2026, à reconfirmer sur impots.gouv.fr/contacts'
    }
  });

  /** Organismes dont le domaine d'envoi diffère du domaine de la fiche. */
  const ALIASES = Object.freeze({
    'impots.gouv.fr': 'finances.gouv.fr',
    'dgfip.finances.gouv.fr': 'finances.gouv.fr'
  });

  /**
   * Fiche officielle d'un organisme.
   * @param {string} key - Organisme (ex. « qonto.com »).
   * @returns {Object|null}
   */
  const forKey = (key) => {
    const k = String(key || '').toLowerCase();
    return DIRECTORY[ALIASES[k] || k] || null;
  };

  return {
    forKey
  };
})();
