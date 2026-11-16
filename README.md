# Google CC Briefing Agent — Mon Briefing Quotidien (v3.0)

Agent exécutif autonome hébergé sur **Google Apps Script** (runtime V8, fuseau `Europe/Paris`) et propulsé par l'API **Google Gemini**.
Chaque matin à **06:00:00 pile**, il analyse vos e-mails non lus, votre agenda, la météo et l'actualité, puis vous envoie un briefing lisible en 2 minutes.

Vos e-mails restent intacts : aucun message n'est marqué comme lu, archivé ou supprimé.

---

## Contenu du briefing

1. **Actions prioritaires** : e-mails demandant une action humaine, avec temps estimé, échéance et lien direct vers Gmail (les boutons « Détails » passent par la page de connexion Google pour s'ouvrir dans un nouvel onglet au lieu de remplacer le briefing). Les alertes Google liées à l'autorisation de votre propre assistant ne sont jamais des actions.
1 bis. **Offres d'emploi du jour** : chaque offre de vos alertes (LinkedIn, Meteojob, Jobup…) avec poste, entreprise et ville, et deux boutons explicites : « Voir l'offre » (annonce sur le site d'emploi) et « Voir l'e-mail » (alerte d'origine dans Gmail). Les postes de comptabilité et de finance en Suisse passent en premier, avec un badge « Correspond à votre recherche ». Les autres e-mails emploi (newsletters, alertes sans offre lisible) figurent dans cette même section, sous « Autres e-mails liés à l'emploi », et ne sont plus répétés dans le récapitulatif.
2. **Récapitulatif des e-mails non lus** classés en 11 catégories canoniques (Emploi & Carrière, Démarches & Administration, Banque & Finances, Santé & Soins, Commandes & Livraisons, Sécurité & Accès, Tech & Outils Numériques, Voyages & Loisirs, Achats & Offres, Réseaux Sociaux, Actualités & Newsletters). Les e-mails reçus sur le **Compte Pro** ou l'**Ancien Perso** portent un badge de provenance. Les notifications sans importance (réseaux sociaux, promotions, newsletters) tiennent en une seule ligne, les copies en double d'un même e-mail ne sont comptées qu'une fois, et des **désabonnements** sont suggérés pour les expéditeurs dont les e-mails restent non lus (au moins 3 en 30 jours ; aucun clic automatique).
3. **Planning du jour** (Google Calendar) avec liens de visioconférence, plus une rubrique compacte **À anticiper demain**. Chaque créneau du jour est détaillé (horaires, durée, description, lieu, visioconférence) ; les rendez-vous en dehors de la journée type (créneaux récurrents ou identiques d'un jour à l'autre) sont mis en couleur avec un badge « Rendez-vous ». Les liens Google Meet ajoutés directement dans l'agenda sont lus via le service avancé Calendar (activé dans `appsscript.json`, sans autorisation supplémentaire). Les liens Zoom et Microsoft Teams écrits dans le lieu ou la description sont également détectés.
4. **Météo & conseil vestimentaire** pour la ville détectée dans l'agenda du jour, sinon la dernière **position envoyée par e-mail** (objet « Position : Genève », envoyé depuis l'un de vos comptes, valable 60 jours, jamais résumé dans le briefing), sinon Annemasse : en-tête `Pour [Ville] :`, puis `Matin (9h)`, `Après-midi (15h)`, `Soir (21h)` sur des lignes séparées, températures au format `10 °C` et pluie au format `29%`.
5. **Les Actus du Jour — Synthèse HugoDécrypte** : dernière vidéo longue de [@hugodecrypteactus](https://www.youtube.com/@hugodecrypteactus/videos) (Shorts exclus), analysée sujet par sujet au même format que le complément Google Actualités (chaque sujet classé dans sa rubrique PESTEL+, titre précis, résumé de 2 à 3 phrases, minutage cliquable vers le moment exact de la vidéo, aucun sujet omis). YouTube est la seule source : la vidéo d'actu publiée la veille au soir est lue via l'API officielle YouTube Data v3 (service avancé `YouTube`), car le flux RSS et les pages web YouTube sont bloqués depuis les serveurs Apps Script. La page « Vidéos » et le flux RSS restent en secours. Règles anti-vague : villes exactes, prénom + nom + fonction, sigles expliqués.
6. **Complément d'actualités issu de Google Actualités** en 9 rubriques PESTEL+ (Politique, Économie, Social, Technologie, Environnement, Légal, Culture & Savoir, Sport, Faits divers), avec corroboration multi-sources.
7. **Agent de Contrôle & Bon Fonctionnement** : vérifie et répare automatiquement le suivi des e-mails, l'horloge d'envoi et la connexion au service de résumé, puis rend compte en français clair, sans jargon ni emoji.

---

## Architecture (`src/`)

| Fichier | Rôle |
| :--- | :--- |
| `Code.js` | Points d'entrée publics et chaîne d'exécution commune. |
| `Config.js` | Source unique de configuration : constantes, budgets temps, cascade Gemini, taxonomies e-mails et PESTEL+, comptes connus, Script Properties. |
| `Utils.js` | Budget temps global, décodeur HTML unifié, nettoyage de texte, `fetchUrlsSafely`, dates et URLs. |
| `EmailClassifier.js` | Règles déterministes de classement (désambiguïsation LinkedIn, emploi, administration…) et analyse de repli sans IA. |
| `GmailService.js` | Lecture des non-lus, déduplication pré-IA, détection du compte de destination. |
| `CalendarService.js` | Agenda du jour et du lendemain, liens de visioconférence (Meet natif via le service avancé Calendar, repli sur le texte). |
| `GeminiService.js` | Accès unique à Gemini : cascade de modèles, budget temps, sortie JSON (e-mails, météo, actualités). |
| `WeatherService.js` | Données wttr.in, bulletin IA ou déterministe, mise en forme stricte. |
| `NewsService.js` | HugoDécrypte (YouTube uniquement) et Google Actualités PESTEL+. |
| `BriefingService.js` | Assemblage, rendu HTML et texte, envoi. |
| `DevOpsAgentService.js` | Agent de Contrôle & Bon Fonctionnement. |
| `StateService.js` | Verrou d'exécution, checkpoint des e-mails, anti-double envoi. |
| `TriggerService.js` | Déclencheur exact de 06:00:00 (calcul explicite du fuseau et du changement d'heure) et watchdog de 07h00. |
| `Template.html` | E-mail HTML responsive. |

### Garantie anti-timeout (limite Apps Script de 6 minutes)
- Budget global de **5 minutes** mesuré depuis le début de l'exécution (`Utils.remainingMs()`).
- Analyse des e-mails plafonnée à 140 s, en conservant toujours 120 s pour la météo, les actualités et l'envoi.
- Chaque appel Gemini essaie au plus 3 à 4 modèles et s'arrête dès que le budget devient insuffisant ; un repli déterministe prend alors le relais.
- `fetchUrlsSafely` exécute les requêtes en sous-lots parallèles de 10, isole une URL défaillante par dichotomie (sans repasser en séquentiel) et applique un budget de 25 s par appel.
- Les étapes facultatives (enrichissement presse, corroboration) sont sautées si le temps manque.

### Résilience
- Sans Gemini (quota, panne ou clé absente), le briefing part quand même : e-mails classés par `EmailClassifier`, météo rédigée de façon déterministe, actualités présentées avec leurs sources. Aucune information n'est inventée.
- Si YouTube ne répond pas, jusqu'à 3 nouvelles tentatives espacées sont faites. S'il reste injoignable, une phrase l'indique (sans lien vers la chaîne et sans résumé inventé).

---

## Points d'entrée (menu de l'éditeur Apps Script)

| Fonction | Usage |
| :--- | :--- |
| `runDailyBriefing` | Exécution automatique de production à 06:00:00, qui se reprogramme chaque jour (même en cas d'erreur). |
| `runBriefingNow` | Envoi immédiat sur les dernières 24 h, sans toucher au checkpoint de production. |
| `watchdogSafetyCheck` | Filet de sécurité quotidien à 07h00 : rattrape un briefing manqué et vérifie le déclencheur du lendemain. |
| `reparerEtActiverBriefing` | Réparation en un clic : recalibre le checkpoint, réinstalle les déclencheurs (06:00 et 07:00) et envoie un briefing de confirmation. |
| `diagnostiquerBriefing` | Teste Gemini, Gmail, l'agenda, la météo, HugoDécrypte et les déclencheurs, envoie un rapport par e-mail puis le briefing. |

---

## Installation

```bash
npm install
npx clasp login
npx clasp push --force
npx clasp open
```

Ensuite, dans **Paramètres du projet > Propriétés du script** :

| Propriété | Valeur | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | *(votre clé Google AI Studio)* | **Obligatoire** pour les résumés IA. Ne l'écrivez jamais dans le code : le dépôt est public. |
| `BRIEFING_RECIPIENT_EMAIL` | `kouroufia15@gmail.com` | Destinataire du briefing. |
| `WEEKEND_ENABLED` | `true` | `false` pour ne recevoir le briefing que du lundi au vendredi. |
| `TEST_LOOKBACK_HOURS` | `24` | Fenêtre analysée par `runBriefingNow`. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Modèle principal (les modèles obsolètes sont migrés automatiquement). |

Enfin, exécutez **`reparerEtActiverBriefing`** une fois : la production est active.

---

## Développement

```bash
# Vérification syntaxique
for f in src/*.js; do node --check "$f"; done

# Déploiement
npx clasp push --force
git add . && git commit -m "feat/fix: description" && git push origin main
```

Les règles métier non négociables sont décrites dans [`AGENTS.md`](AGENTS.md).

---

## Sécurité & confidentialité

- Scopes OAuth minimaux : `gmail.readonly`, `gmail.send`, `calendar.readonly`, `youtube.readonly` (lecture de vidéos publiques uniquement), `script.external_request`, `script.scriptapp`.
- La clé Gemini est lue uniquement depuis les Script Properties et transmise dans l'en-tête `x-goog-api-key` (jamais dans l'URL ni dans les journaux).
- Tout contenu extrait est nettoyé et échappé avant d'être inséré dans l'e-mail HTML.
- Palier gratuit Gemini : les requêtes peuvent être examinées par Google. Les pièces jointes ne sont jamais transmises, et les corps d'e-mails sont tronqués et nettoyés avant envoi.
