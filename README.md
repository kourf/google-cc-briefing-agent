# Google CC Briefing Agent — Mon Briefing Quotidien (v3.0)

Agent exécutif autonome hébergé sur **Google Apps Script** (runtime V8, fuseau `Europe/Paris`) et propulsé par l'API **Google Gemini**.
Chaque matin à **06:00:00 pile**, il analyse vos e-mails non lus, votre agenda, la météo et l'actualité, puis vous envoie un briefing lisible en 2 minutes.

Vos e-mails restent intacts : aucun message n'est marqué comme lu, archivé ou supprimé.

---

## Contenu du briefing

1. **Actions prioritaires** : e-mails demandant une action humaine, avec temps estimé, échéance et lien direct vers Gmail.
2. **Récapitulatif des e-mails non lus** classés en 11 catégories canoniques (Emploi & Carrière, Démarches & Administration, Banque & Finances, Santé & Soins, Commandes & Livraisons, Sécurité & Accès, Tech & Outils Numériques, Voyages & Loisirs, Achats & Offres, Réseaux Sociaux, Actualités & Newsletters). Les e-mails reçus sur le **Compte Pro** ou l'**Ancien Perso** portent un badge de provenance.
3. **Planning du jour** (Google Calendar) avec liens Google Meet, Zoom et Microsoft Teams, plus une rubrique compacte **À anticiper demain**.
4. **Météo & conseil vestimentaire** pour la ville détectée dans l'agenda (sinon Annemasse) : en-tête `Pour [Ville] :`, puis `Matin (9h)`, `Après-midi (15h)`, `Soir (21h)` sur des lignes séparées, températures au format `10 °C` et pluie au format `29%`.
5. **Les Actus du Jour — Synthèse HugoDécrypte** : dernière vidéo longue de [@hugodecrypteactus](https://www.youtube.com/@hugodecrypteactus/videos) (Shorts exclus), résumée segment par segment, avec repli automatique sur le flux audio Acast. Règles anti-vague : villes exactes, prénom + nom + fonction, sigles expliqués.
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
| `CalendarService.js` | Agenda du jour et du lendemain, liens de visioconférence. |
| `GeminiService.js` | Accès unique à Gemini : cascade de modèles, budget temps, sortie JSON (e-mails, météo, actualités). |
| `WeatherService.js` | Données wttr.in, bulletin IA ou déterministe, mise en forme stricte. |
| `NewsService.js` | HugoDécrypte (YouTube puis Acast) et Google Actualités PESTEL+. |
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
- Si HugoDécrypte est indisponible sur YouTube et sur Acast, l'e-mail propose un lien vers la chaîne au lieu de résumer un contenu inexistant.

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

- Scopes OAuth minimaux : `gmail.readonly`, `gmail.send`, `calendar.readonly`, `script.external_request`, `script.scriptapp`.
- La clé Gemini est lue uniquement depuis les Script Properties et transmise dans l'en-tête `x-goog-api-key` (jamais dans l'URL ni dans les journaux).
- Tout contenu extrait est nettoyé et échappé avant d'être inséré dans l'e-mail HTML.
- Palier gratuit Gemini : les requêtes peuvent être examinées par Google. Les pièces jointes ne sont jamais transmises, et les corps d'e-mails sont tronqués et nettoyés avant envoi.
