# Directives Permanentes du Projet — Assistant de Briefing Quotidien (Google CC)

Ce document constitue la mémoire permanente et les règles directrices strictes du projet. Tout agent Antigravity travaillant sur ce projet doit impérativement respecter ces consignes dans toutes les conversations futures.

---

## 1. Emplacement Strict du Projet
- **Répertoire de travail unique et exclusif** :
  `C:\Users\RO2TK\OneDrive\Bureau\Pro\Antigravity\Assistant de Briefing Quotidien (Inspiré de Google CC) - Antigravity`
- **Interdiction formelle** : Ne jamais créer de dossiers ou fichiers sur le Bureau Windows (`C:\Users\RO2TK\OneDrive\Bureau\...`) ou dans tout autre répertoire. Tous les commits, modifications et commandes `clasp` s'exécutent strictement ici.

---

## 2. Règles Métier & Directives de Formatage

### A. Météo & Conseil Vestimentaire
- **Saut de ligne obligatoire** : Toujours insérer un retour à la ligne avant chaque moment de la journée :
  - `Matin : ...`
  - `Après-midi : ...`
  - `Soir : ...`
- **Typographie chiffrée stricte** :
  - Toujours écrire les températures en chiffres avec symbole : ex. `10 °C` (espace avant `°C`). Ne JAMAIS écrire "dix degrés" ou "degrés Celsius" en toutes lettres.
  - Toujours écrire les pourcentages en chiffres : ex. `29%` ou `29 %`. Ne JAMAIS écrire "pour cent" en toutes lettres.

### B. Les Actus du Jour — Synthèse HugoDécrypte
- **Source Vidéo Longue YouTube** :
  - Analyser impérativement la dernière vidéo publique issue de `https://www.youtube.com/@hugodecrypteactus/videos`.
  - Exclure rigoureusement les formats courts (Shorts YouTube).
  - Source UNIQUE : la chaîne YouTube https://www.youtube.com/@hugodecrypteactus (la page « Vidéos » désigne la dernière vidéo longue ; flux RSS et page de la vidéo pour le chapitrage). Ne JAMAIS utiliser Acast ni aucune source audio (décision du propriétaire du 14/11/2026). Si YouTube est injoignable, afficher un lien vers la chaîne sans inventer de résumé.
- **Règles Anti-Vague (Haute précision journalistique)** :
  - **Lieux précis** : Toujours nommer la ville ou commune exacte (ex. "Trappes" au lieu de "en banlieue parisienne").
  - **Identités et fonctions** : Toujours donner le prénom, le nom ET la fonction ou le poste (ex. "Senny Mayulu, milieu de terrain du PSG", "Marc Ferracci, ministre chargé de l'Industrie").
  - **Acronymes décryptés** : Toujours expliciter les sigles (ex. "la COP31 (conférence mondiale sur le climat)", "le missile Shahid Kaveh").

### C. Complément Google Actualités
- **Intitulé exact de section** :
  `Complément d'actualités issu de Google Actualités :`
- **9 Catégories PESTEL+ Normalisées** :
  1. `P — Politique & Géopolitique`
  2. `E — Économie, Finance & Entreprises`
  3. `S — Social & Sociétal`
  4. `T — Technologie, IA & Innovation`
  5. `E — Environnement & Écologie`
  6. `L — Légal : Justice, Lois & Procès`
  7. `Culture & Savoir (Cinéma, Livres, Histoire & Sciences)`
  8. `Sport`
  9. `Faits divers (Délits, Crimes & Accidents marquants)`
- **Corroboration multi-sources** : Chaque actualité doit être enrichie avec des sources de presse fiables et vérifiées via `fetchUrlsSafely` pour éviter toute coupure d'exécution sur liens protégés (ex. Le Dauphiné Libéré).

### D. Agent de Surveillance & Journal d'Exécution
- **Nom officiel** : `Agent de Contrôle & Bon Fonctionnement`.
- **Règle Zéro Emoji** : Aucun emoji dans la section du rapport de cet agent.
- **Accessibilité non-technique** : Rédaction en français clair et intelligible pour un utilisateur sans compétences informatiques. Expliquer concrètement que le système a vérifié la météo, l'agenda et les emails sans jargon d'ingénierie.

---

## 3. Architecture Technique & Déploiement
- **Plateforme d'exécution** : Google Apps Script (`Script ID: 1q83o0v-0wFqNF_z8VvL82cQjU2PsapNfuql2SBAVx8yppKvqV_YhILTo`).
- **Modèle IA par défaut** : `gemini-3.1-flash-lite` (très rapide, haute disponibilité, quota-safe). Auto-migration active pour prévenir les erreurs 503/429.
- **Déploiement** : Chaque modification doit être synchronisée :
  1. Localement avec Git : `git add .` -> `git commit -m "..."` -> `git push origin main`.
  2. Sur Google Apps Script : `npx clasp push --force`.
