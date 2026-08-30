# Google CC Briefing Agent ☀️

Assistant de briefing quotidien automatique propulsé par **Google Apps Script** et **Gemini Developer API (Google AI Studio Free Tier)**.

Chaque matin autour de **06:00 (heure de Paris)**, l'agent analyse vos nouveaux e-mails Gmail non lus et votre Google Calendar, synthétise les urgences en français très simple (niveau **ELI15**), distingue la provenance de vos e-mails (compte principal, compte pro, ancien perso), et vous livre un briefing e-mail élégant, épuré et actionnable inspiré du design **Apple × Linear × Notion**.

---

## 🎯 Philosophie & Objectif

Vous n'avez pas le temps de lire tous vos e-mails le matin.
L'objectif de cet agent est de vous permettre de **comprendre l'essentiel de votre boîte de réception et de votre agenda en 2 minutes** :
- Identifier immédiatement ce qui est **critique** ou **urgent**.
- Savoir précisément quelle **action** est attendue de votre part et avant quelle **échéance**.
- Distinguer d'où provient l'e-mail (transfert depuis votre compte pro ou personnel).
- Visualiser votre **planning du jour** et les réunions à préparer pour le lendemain.
- Garantir que **vos e-mails restent 100% intacts** (aucun e-mail n'est marqué comme lu, archivé ou supprimé).

---

## ✨ Fonctionnalités Clés

1. **Résumés ELI15 en 1 à 2 phrases** : Explications claires, en français simple, sans jargon, tout en préservant scrupuleusement les montants, dates et expéditeurs clés.
2. **Hiérarchisation intelligente à 4 niveaux** :
   - 🔴 **Critique** & 🟠 **Élevée** : Cartes modulaires détaillées avec badge d'urgence, temps de traitement estimé, action requise, échéance et bouton direct Gmail.
   - 🔵 **Moyenne** : Résumés compacts pour les messages utiles.
   - ⚪ **Faible (Pour information)** : Liste condensée des notifications, reçus et newsletters.
3. **Détection Multi-Comptes Intelligente** :
   - 🏢 **Compte Pro** (`dramekouroufia.pro@gmail.com`)
   - 👤 **Compte Principal** (`kouroufia15@gmail.com`)
   - ✉️ **Ancien Compte Perso** (`dkouroufia27@outlook.fr`)
4. **Google Calendar Intégré** :
   - Planning complet d'**Aujourd'hui** avec liens directs Google Meet / Visioconférence et Calendar.
   - Section **À anticiper demain** pour préparer la journée suivante sans surcharge.
5. **Idempotence & Checkpoints robustes** :
   - Aucun risque de double envoi grâce au verrou exclusif `LockService`.
   - Le premier lancement n'ingère pas tout votre historique d'e-mails non lus.
   - Le checkpoint de production n'avance qu'après confirmation de l'envoi réussi.
6. **Mode Test Immédiat** :
   - Possibilité d'exécuter un test à tout moment (`runBriefingTest()`) sur les dernières 24h sans toucher au checkpoint de production.
7. **100% Gratuit & Réutilisable** :
   - Fonctionne sur le palier gratuit (*Free Tier*) de Google Apps Script et Google AI Studio.
   - Code modulaire prêt à être déployé par une tierce personne sans modification du code source.

---

## 🔒 Confidentialité & Free Tier Gemini

> [!IMPORTANT]
> **Transparence sur les données (Google AI Studio Free Tier)** :
> Le palier gratuit de l'API Gemini Developer prévoit que les requêtes et réponses peuvent faire l'objet d'un examen par des réviseurs humains pour améliorer les produits Google.
> Afin de protéger au maximum vos données personnelles :
> - Notre code applique un **nettoyage local strict avant transmission** (suppression des balises de tracking, des codes de sécurité superflus, des styles et des signatures).
> - **Les pièces jointes ne sont jamais envoyées à Gemini**.
> - Vos identifiants et clés API ne transitent jamais dans le corps du message et sont protégés dans les `ScriptProperties`.

---

## 📂 Architecture & Fichiers

```text
├── .clasp.json          # Configuration de liaison Clasp avec le projet Apps Script
├── .gitignore            # Exclusion stricte des identifiants et node_modules
├── appsscript.json      # Manifeste Apps Script avec permissions OAuth minimales
├── package.json         # Dépendances locales (@google/clasp)
├── Code.js              # Points d'entrée (runBriefing, runBriefingTest, installDailyTrigger)
├── Config.js            # Propriétés centralisées, comptes connus, fuseau Europe/Paris
├── Utils.js             # Échappement HTML strict, nettoyeur de texte, détection multi-comptes
├── StateService.js      # Gestion des checkpoints et verrous concurrentiels
├── GmailService.js      # Récupération non lus, pagination sans limite silencieuse
├── CalendarService.js   # Agenda du jour et détection des visioconférences (Meet/Zoom)
├── GeminiService.js     # Appels API avec schéma JSON forcé et backoff exponentiel
├── BriefingService.js   # Assemblage du briefing, KPIs, et expédition Gmail
├── TriggerService.js    # Déclencheur automatique à 06:00 et gestion week-end
├── Template.html        # Template d'e-mail responsive moderne (Apple x Linear x Notion)
└── README.md            # Ce guide
```

---

## 🚀 Installation & Déploiement Initial

### 1. Prérequis sur votre machine
- **Node.js** (v18+) et **npm**
- **Git**
- Un compte Google avec accès à [Google AI Studio](https://aistudio.google.com/)

### 2. Création de votre Clé API Gemini (Dédiée)
1. Rendez-vous sur [Google AI Studio — Clés API](https://aistudio.google.com/app/apikey).
2. Cliquez sur **Create API key**.
3. Choisissez de créer la clé dans un nouveau projet dédié nommé par exemple `Google CC Briefing Agent`.
4. Copiez votre clé en lieu sûr (ne la partagez jamais publiquement).

### 3. Connexion Clasp & Création du projet Apps Script
Dans le terminal de ce dossier :

```bash
# 1. Installer les dépendances du projet
npm install

# 2. Vous connecter à votre compte Google via Clasp
npx clasp login
```
*Une page Google s'ouvrira dans votre navigateur. Connectez-vous avec `kouroufia15@gmail.com` et autorisez Clasp.*

```bash
# 3. Créer le projet Google Apps Script autonome
npx clasp create --type standalone --title "Google CC Briefing Agent"

# 4. Déployer tous les fichiers sur Apps Script
npx clasp push
```

---

## ⚙️ Configuration des Propriétés de Script

1. Ouvrez votre script dans l'éditeur Google :
   ```bash
   npx clasp open
   ```
2. Dans le menu de gauche, cliquez sur l'icône d'engrenage **Paramètres du projet** (Project Settings).
3. Descendez jusqu'à la section **Propriétés de script** (Script Properties) et cliquez sur **Ajouter une propriété de script** :

| Nom de la propriété | Valeur recommandée | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | *(Votre clé API Google AI Studio)* | **Obligatoire**. Clé dédiée pour les résumés. |
| `BRIEFING_RECIPIENT_EMAIL` | `kouroufia15@gmail.com` | Adresse recevant le briefing quotidien. |
| `WEEKEND_ENABLED` | `true` | `true` pour recevoir le briefing 7j/7, `false` pour lun-ven. |
| `TEST_LOOKBACK_HOURS` | `24` | Nombre d'heures analysées lors des tests manuels. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modèle rapide par défaut (fallback sur `gemini-1.5-flash`). |

4. Cliquez sur **Enregistrer les propriétés de script**.

---

## 🧪 Procédure de Test Immédiat

Vous n'avez pas besoin d'attendre 06:00 pour valider le système !

1. Dans l'éditeur Apps Script, ouvrez le fichier `Code.js`.
2. Dans la barre d'outils supérieure, sélectionnez la fonction **`runBriefingTest`**.
3. Cliquez sur **Exécuter** (Run).
4. Lors de la première exécution, Google vous demandera d'autoriser les accès nécessaires :
   - Lecture de Gmail (`gmail.readonly`)
   - Envoi du briefing (`gmail.send`)
   - Lecture de l'agenda (`calendar.readonly`)
   - Appels réseau externes (`script.external_request`)
5. Consultez l'onglet **Journal d'exécution** en bas :
   - L'agent extrait vos messages non lus récents sans modifier leur statut.
   - L'e-mail de test est envoyé avec l'objet : `🧪 Briefing test — Google CC`.
6. Ouvrez votre boîte Gmail et admirez le résultat !

---

## ⏰ Activation de la Production (Automatique à 06:00)

Une fois le test validé, activez la production en 2 clics :

1. Dans l'éditeur Apps Script, sélectionnez la fonction **`setupInitialCheckpoint`** et cliquez sur **Exécuter**.
   *Cela enregistre l'instant T comme point de départ. Vos centaines d'anciens e-mails non lus ne seront pas retraités.*
2. Sélectionnez la fonction **`installDailyTrigger`** et cliquez sur **Exécuter**.
   *Le déclencheur automatique est configuré pour s'exécuter chaque matin autour de 06:00 (Europe/Paris).*

C'est tout ! Votre agent est désormais 100% autonome.

---

## 👥 Déployer une seconde instance (Pour un ami ou collègue)

Le code est conçu pour être **strictement réutilisable sans aucune modification de code**.
Pour qu'une autre personne déploie sa propre instance :

1. **Cloner ou copier** ce dossier sur son ordinateur.
2. Installer les dépendances : `npm install`.
3. Se connecter avec son propre compte Google : `npx clasp login`.
4. Créer son projet Apps Script : `npx clasp create --type standalone --title "Mon Briefing Quotidien"`.
5. Pousser les fichiers : `npx clasp push`.
6. Ouvrir son projet : `npx clasp open`.
7. Dans les **Propriétés de script**, renseigner :
   - Sa propre `GEMINI_API_KEY` (gratuite sur [aistudio.google.com](https://aistudio.google.com/)).
   - Son propre `BRIEFING_RECIPIENT_EMAIL`.
8. Exécuter `runBriefingTest` pour valider les autorisations.
9. Exécuter `setupInitialCheckpoint` puis `installDailyTrigger`.

Chaque utilisateur dispose ainsi de sa propre instance étanche, sécurisée et indépendante.

---

## 🛡️ Mesures de Sécurité & Bonnes Pratiques

- **Aucun marquage ou suppression** : Vos e-mails conservent rigoureusement leur statut non lu dans Gmail.
- **Principe du moindre privilège** : Scopes OAuth strictement limités à la lecture et à l'envoi de briefings.
- **Protection XSS** : Tout contenu extrait (expéditeur, sujet, corps, liens) est échappé via `Utils.escapeHtml()` avant d'être injecté dans le template HTML.
- **Anti-doublons & LockService** : Verrou de synchronisation empêchant les collisions si deux déclencheurs s'exécutent au même moment.
- **Zéro secret dans Git** : Les clés API sont exclusivement gérées via les Script Properties et exclues de Git par le `.gitignore`.

---

## 🤝 Dépôt GitHub Privé

Pour lier ce projet à votre compte GitHub privé :

```bash
git remote add origin https://github.com/VOTRE_PSEUDO/google-cc-briefing-agent.git
git branch -M main
git push -u origin main
```
*(Assurez-vous de créer le dépôt en mode **PRIVÉ** sur GitHub).*
