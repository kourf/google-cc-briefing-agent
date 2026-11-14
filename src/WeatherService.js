/**
 * Google CC Briefing Agent
 * WeatherService.js — Météo du jour (wttr.in) pour la ville de l'agenda ou Annemasse,
 * bulletin Matin (9h) / Après-midi (15h) / Soir (21h) et mise en forme stricte AGENTS.md
 * (en-tête « Pour [Ville] : », « 10 °C », « 29% », un retour à la ligne par moment).
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const WeatherService = (() => {
  /** Créneaux horaires wttr.in retenus. */
  const PERIODS = Object.freeze([
    { time: '900', label: 'Matin (9h)' },
    { time: '1500', label: 'Après-midi (15h)' },
    { time: '2100', label: 'Soir (21h)' }
  ]);

  /**
   * Met une majuscule à chaque mot d'un nom de ville (ex. "saint-julien-en-genevois").
   * @param {string} city
   * @returns {string}
   */
  const toTitleCase = (city) =>
    String(city || '')
      .trim()
      .toLowerCase()
      .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, letter) => `${sep}${letter.toUpperCase()}`)
      .replace(/-(En|Sur|Sous|Lès|Les|Le|La|De|Du|Des)-/g, (m) => m.toLowerCase());

  /**
   * Extrait une ville d'un lieu d'événement (adresse postale ou nom simple).
   * @param {string} location
   * @returns {string|null}
   */
  const cityFromLocation = (location) => {
    const loc = String(location || '');
    if (!loc || /https?:\/\//i.test(loc)) return null;
    const postal = loc.match(/\b\d{4,5}\s+([\p{L}'’ -]{2,40})/u); // "74100 Annemasse" / "1201 Genève"
    if (postal) return postal[1].split(',')[0].trim();
    const first = loc.split(',')[0].trim();
    return first && !/\d/.test(first) && first.length > 2 && first.length < 30 ? first : null;
  };

  /**
   * Détecte la ville du jour à partir de l'agenda (déplacement explicite, puis lieu physique).
   * @param {Array<Object>} todayEvents
   * @returns {string|null}
   */
  const detectCityFromAgenda = (todayEvents) => {
    // Ville = mots à majuscule (particules autorisées), ex. "Train pour Saint-Julien-en-Genevois - client"
    const travelPattern =
      /(?<!\p{L})(?:[Dd]éplacement|[Vv]oyage|[Tt]rajet|[Tt]rain|[Vv]ol)\s+(?:à|pour|vers|sur)\s+(\p{Lu}[\p{L}'’]*(?:[ -](?:\p{Lu}[\p{L}'’]*|en|sur|sous|lès|les|le|la|de|du|des))*)/u;
    for (const event of todayEvents || []) {
      const m = String(event.title || '').match(travelPattern);
      if (m) {
        const city = m[1].replace(/(?:[ -](?:en|sur|sous|lès|les|le|la|de|du|des))+$/, '').trim();
        if (city.length >= 3) return city;
      }
    }
    for (const event of todayEvents || []) {
      if (event.isPhysical) {
        const city = cityFromLocation(event.location);
        if (city) return city;
      }
    }
    return null;
  };

  /**
   * Interroge wttr.in (2 tentatives rapides maximum).
   * @param {string} city
   * @returns {Object|null} JSON format=j1.
   */
  const fetchWeather = (city) => {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=fr`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        const content = response.getResponseCode() === 200 ? response.getContentText() : '';
        if (content.trim().startsWith('{')) return JSON.parse(content);
      } catch (e) {
        console.warn(`Météo : tentative ${attempt} échouée pour ${city} — ${e.message}`);
      }
      if (attempt === 1) Utilities.sleep(500);
    }
    return null;
  };

  /**
   * Description française d'un créneau horaire wttr.in.
   * @param {Object} hourData
   * @returns {string}
   */
  const describe = (hourData) => {
    const fr = hourData.lang_fr && hourData.lang_fr[0] && hourData.lang_fr[0].value;
    const en = hourData.weatherDesc && hourData.weatherDesc[0] && hourData.weatherDesc[0].value;
    return Utils.sanitizeText(fr || en || '');
  };

  /**
   * Relevé météo structuré du jour. Si la ville de l'agenda est introuvable,
   * repli automatique sur la ville par défaut (Annemasse).
   *
   * @param {Array<Object>} todayEvents
   * @returns {{city: string, minC: string, maxC: string, periods: Array<Object>}|null}
   */
  const getWeatherReport = (todayEvents) => {
    const baseCity = Config.DEFAULTS.WEATHER_BASE_LOCATION;
    const agendaCity = detectCityFromAgenda(todayEvents);
    const candidates = [...new Set([agendaCity ? toTitleCase(agendaCity) : null, baseCity].filter(Boolean))];

    for (const city of candidates) {
      const data = fetchWeather(city);
      const today = data && data.weather && data.weather[0];
      const hourly = today && today.hourly;
      if (!hourly || hourly.length === 0) {
        console.warn(`Météo indisponible pour ${city}.`);
        continue;
      }
      const periods = PERIODS.map((p) => {
        const h = hourly.find((x) => String(x.time) === p.time);
        return h
          ? { label: p.label, tempC: h.tempC, feelsLikeC: h.FeelsLikeC, rainChance: h.chanceofrain, description: describe(h) }
          : null;
      }).filter(Boolean);
      if (periods.length === 0) continue;
      console.log(`Météo : ville retenue ${city}.`);
      return { city, minC: today.mintempC, maxC: today.maxtempC, periods };
    }
    return null;
  };

  /**
   * Contexte brut transmis à Gemini.
   * @param {Object} report
   * @returns {string}
   */
  const buildRawContext = (report) =>
    [
      `Ville : ${report.city}. Minimum ${report.minC} °C, maximum ${report.maxC} °C.`,
      ...report.periods.map(
        (p) => `- ${p.label} : ${p.tempC} °C (ressenti ${p.feelsLikeC} °C), ${p.description || 'ciel variable'}, risque de pluie ${p.rainChance}%`
      )
    ].join('\n');

  /**
   * Conseil vestimentaire déterministe.
   * @param {number} temp
   * @param {number} rain
   * @returns {string}
   */
  const clothingAdvice = (temp, rain) => {
    let advice;
    if (temp <= 3) advice = 'manteau chaud, écharpe et gants';
    else if (temp <= 10) advice = 'manteau ou veste chaude';
    else if (temp <= 16) advice = 'pull ou veste légère';
    else if (temp <= 22) advice = 'tenue légère avec une petite veste';
    else advice = 't-shirt';
    return rain >= 50 ? `${advice}, et prenez un parapluie` : advice;
  };

  /**
   * Bulletin de repli sans IA, au format exact exigé.
   * @param {Object} report
   * @returns {string}
   */
  const buildDeterministicAdvice = (report) =>
    [
      `**Pour ${report.city} :**`,
      ...report.periods.map((p) => {
        const temp = parseInt(p.tempC, 10);
        const rain = parseInt(p.rainChance, 10) || 0;
        const desc = p.description ? `${p.description.toLowerCase()}, ` : '';
        return `• **${p.label} :** ${desc}${temp} °C et ${rain}% de risque de pluie : ${clothingAdvice(temp, rain)}.`;
      })
    ].join('\n');

  /**
   * Met en forme le bulletin en HTML sûr selon AGENTS.md :
   * en-tête « Pour [Ville] : », « 10 °C », « 29% », un retour à la ligne avant chaque moment.
   *
   * @param {string} text - Bulletin brut (IA ou repli).
   * @param {string} city - Ville retenue.
   * @returns {string} HTML.
   */
  const formatAdviceHtml = (text, city) => {
    let t = String(text || '').trim();

    // 1. Typographie chiffrée stricte
    t = t
      .replace(/(-?\d+(?:[.,]\d+)?)\s*(?:degrés?(?:\s*celsius)?|°\s*C\b)/gi, '$1 °C')
      .replace(/(-?\d+(?:[.,]\d+)?)\s*°(?!\s*C)/g, '$1 °C')
      .replace(/(\d+(?:[.,]\d+)?)\s*pour\s*cent\b/gi, '$1%')
      .replace(/(\d+(?:[.,]\d+)?)\s+%/g, '$1%');

    // 2. En-tête de ville obligatoire
    if (!/^\**\s*Pour\s+[^:\n]+:/i.test(t)) {
      t = `**Pour ${city} :**\n${t}`;
    }

    // 3. Échappement HTML puis gras Markdown
    let html = Utils.escapeHtml(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 4. Un retour à la ligne avant chaque moment de la journée
    //    (sensible à la casse : « ce soir : » en milieu de phrase n'est pas un intitulé)
    const periodPattern = (label) =>
      new RegExp(`(?:<br\\s*\\/?>|\\r?\\n)?\\s*(?:[•\\-*]\\s*)?(?:<strong>)?(${label}(?:\\s*\\([^)]+\\))?\\s*:)(?:<\\/strong>)?\\s*`, 'g');
    html = html
      .replace(periodPattern('Matin'), '<br>&bull; <strong>$1</strong> ')
      .replace(periodPattern('(?:Après-midi|Apres-midi|Après-Midi)'), '<br>&bull; <strong>$1</strong> ')
      .replace(periodPattern('Soir'), '<br>&bull; <strong>$1</strong> ')
      .replace(/\r?\n/g, '<br>')
      .replace(/(?:<br\s*\/?>\s*){2,}/g, '<br>')
      .replace(/^(?:<br\s*\/?>)+/, '')
      .trim();
    return html;
  };

  /**
   * Convertit le bulletin HTML en texte brut (version texte de l'e-mail).
   * @param {string} html
   * @returns {string}
   */
  const htmlToPlain = (html) =>
    Utils.decodeHtmlEntities(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();

  /**
   * Section météo complète : relevé, rédaction IA (repli déterministe), mise en forme.
   * @param {Array<Object>} todayEvents
   * @returns {{city: string, html: string, text: string, aiGenerated: boolean}|null}
   */
  const buildWeatherSection = (todayEvents) => {
    const report = getWeatherReport(todayEvents);
    if (!report) return null;
    const aiText = GeminiService.generateWeatherAdvice(buildRawContext(report), report.city);
    const text = aiText || buildDeterministicAdvice(report);
    const html = formatAdviceHtml(text, report.city);
    return {
      city: report.city,
      html,
      text: htmlToPlain(html),
      aiGenerated: Boolean(aiText)
    };
  };

  return {
    getWeatherReport,
    buildWeatherSection
  };
})();
