/**
 * Google CC Briefing Agent
 * NewsService.js — Collecte des actualités du jour :
 * 1. HugoDécrypte « Les Actus du Jour » : dernière vidéo longue YouTube (Shorts exclus),
 *    repli sur le flux audio Acast officiel, chapitrage horodaté et articles sources de la description ;
 * 2. Complément Google Actualités en 9 rubriques PESTEL+ avec corroboration multi-sources.
 *
 * Toutes les requêtes passent par Utils.fetchUrlsSafely (parallèle, résilient, budget temps borné).
 *
 * @author Kouroufia
 * @version 3.0.0
 */

const NewsService = (() => {
  const buildGoogleSearchRss = (query) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`;

  const topicFeed = (topic) =>
    `https://news.google.com/rss/headlines/section/topic/${topic}?hl=fr&gl=FR&ceid=FR:fr`;

  /**
   * Flux Google Actualités par rubrique (identifiants de Config.NEWS_CATEGORIES).
   * @type {Readonly<Object<string, Array<string>>>}
   */
  const RSS_BY_CATEGORY = Object.freeze({
    P_POLITIQUE: [topicFeed('WORLD'), topicFeed('NATION')],
    E_ECONOMIE: [topicFeed('BUSINESS')],
    S_SOCIAL: [buildGoogleSearchRss('société OR grève OR "pouvoir d\'achat" OR santé OR éducation France when:2d')],
    T_TECH: [topicFeed('TECHNOLOGY')],
    E_ENVIRONNEMENT: [buildGoogleSearchRss('environnement OR climat OR écologie OR énergie France monde when:2d')],
    L_LEGAL: [buildGoogleSearchRss('justice OR procès OR "projet de loi" OR "proposition de loi" OR tribunal France when:2d')],
    CULTURE_SAVOIR: [topicFeed('SCIENCE'), topicFeed('ENTERTAINMENT')],
    SPORT: [topicFeed('SPORTS')],
    FAITS_DIVERS: [buildGoogleSearchRss('"faits divers" OR "garde à vue" OR "accident mortel" OR meurtre OR braquage France when:2d')]
  });

  const PAYWALL_REGEX = /lemonde\.fr|liberation\.fr|mediapart\.fr|lesechos\.fr|lexpress\.fr|lepoint\.fr|telerama\.fr|humanite\.fr|courrierinternational\.com/;
  const EXCLUDED_LINK_REGEX = /youtube\.com|youtu\.be|instagram\.com|twitter\.com|(?:^|\/\/|\.)x\.com|tiktok\.com|acast\.com|hugodecrypte\.com|spotify\.com|apple\.com|deezer\.com|linktr\.ee/;
  const BROWSER_HEADERS = Object.freeze({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });

  /** Budgets minimaux (temps global restant) pour lancer les étapes facultatives. */
  const MIN_REMAINING_FOR_HUGO_ENRICHMENT_MS = 150000;
  const MIN_REMAINING_FOR_CORROBORATION_MS = 120000;

  /**
   * Rubriques PESTEL+ avec leurs flux RSS.
   * @returns {Array<{id: string, name: string, rssUrls: Array<string>}>}
   */
  const getCategories = () =>
    Config.NEWS_CATEGORIES.map((c) => ({ id: c.id, name: c.name, rssUrls: RSS_BY_CATEGORY[c.id] || [] }));

  /**
   * Lit la première balise correspondante d'un fragment XML.
   * @param {string} xml
   * @param {string} tag - Nom de balise (ex. 'title', 'media:description').
   * @returns {string} Contenu brut (non décodé) ou chaîne vide.
   */
  const readTag = (xml, tag) => {
    const m = String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : '';
  };

  // ---------------------------------------------------------------------------
  // HugoDécrypte
  // ---------------------------------------------------------------------------

  /**
   * Extrait les segments horodatés d'un sommaire (ex. "00:27 Titre du sujet").
   * Ignore intro, outro, conclusion et générique.
   *
   * @param {string} text - Description décodée (avec retours à la ligne).
   * @returns {Array<{timestamp: string, title: string}>}
   */
  const parseSegments = (text) => {
    const segments = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = line.match(/^\s*[-•*]?\s*\(?(\d{1,2}(?::\d{2}){1,2})\)?\s*[-–—:|]?\s*(.+?)\s*$/);
      if (!m) continue;
      const title = Utils.stripMarkup(m[2]).replace(/^[-–—:\s]+/, '');
      if (!title || /^(intro|introduction|outro|conclusion|générique|generique)\b/i.test(title)) continue;
      segments.push({ timestamp: m[1], title });
    }
    return segments;
  };

  /**
   * Extrait les URLs d'articles de presse d'une description (réseaux sociaux exclus),
   * médias ouverts en priorité avant les sites à abonnement.
   *
   * @param {string} text - Description décodée.
   * @returns {Array<string>} 12 URLs maximum.
   */
  const extractArticleUrls = (text) => {
    const urls = [...String(text || '').matchAll(/https?:\/\/[^\s<>"')]+/g)]
      .map((m) => m[0].split('#')[0].replace(/[.,;]+$/, '').trim())
      .filter((u) => /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(u) && !EXCLUDED_LINK_REGEX.test(u));
    const unique = [...new Set(urls)];
    return [...unique.filter((u) => !PAYWALL_REGEX.test(u)), ...unique.filter((u) => PAYWALL_REGEX.test(u))].slice(0, 12);
  };

  /**
   * Extrait titre, description et corps factuel d'un article HTML (JSON-LD prioritaire).
   * @param {string} html
   * @returns {string} Extrait (vide si page bloquée ou paywall).
   */
  const extractArticleFacts = (html) => {
    if (!html) return '';
    const title = Utils.stripMarkup(readTag(html, 'title'));
    if (/accès restreint|403 forbidden|access denied|just a moment|cloudflare/i.test(title) || title.toLowerCase() === 'liberation.fr') {
      return '';
    }

    const dMatch =
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
    const ogDesc = Utils.stripMarkup(dMatch ? dMatch[1] : '');

    let articleBody = '';
    for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const obj = JSON.parse(m[1]);
        const stack = Array.isArray(obj) ? [...obj] : [obj];
        while (stack.length > 0 && !articleBody) {
          const node = stack.shift();
          if (!node || typeof node !== 'object') continue;
          if (typeof node.articleBody === 'string' && node.articleBody.length > 80) {
            articleBody = Utils.stripMarkup(node.articleBody);
          } else if (Array.isArray(node['@graph'])) {
            stack.push(...node['@graph']);
          }
        }
      } catch {}
      if (articleBody) break;
    }

    if (!articleBody) {
      const artMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
      articleBody = [...(artMatch ? artMatch[1] : html).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((m) => Utils.stripMarkup(m[1]))
        .filter(
          (p) =>
            p.length > 65 &&
            !/cookie|abonner|newsletter|confidentialité|connecter|publicité|lire aussi|sur le même sujet|pour pouvoir enregistrer|activez les notifications|partenaire autorisé/i.test(p)
        )
        .slice(0, 5)
        .join(' ');
    }

    return [title, ogDesc && ogDesc !== title ? ogDesc : '', articleBody].filter(Boolean).join(' | ').substring(0, 1500);
  };

  /**
   * Extrait les dépêches d'un flux RSS Google Actualités.
   * @param {string} xml
   * @param {number} maxItems
   * @returns {Array<{title: string, headline: string, source: string, desc: string, url: string}>}
   */
  const parseGoogleNewsItems = (xml, maxItems = 5) => {
    if (!xml) return [];
    const results = [];
    for (const rItem of xml.split('<item>').slice(1, maxItems + 1)) {
      const title = Utils.stripMarkup(readTag(rItem, 'title'));
      if (!title) continue;
      const desc = Utils.stripMarkup(readTag(rItem, 'description'));
      const sourceTag = Utils.stripMarkup(readTag(rItem, 'source'));
      // Format Google Actualités : "<title>Titre - Source</title>" + "<source>Source</source>"
      const parts = title.split(' - ');
      const source = sourceTag || (parts.length > 1 ? parts[parts.length - 1].trim() : 'Google Actualités');
      const suffix = ` - ${source}`;
      const headline = title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
      results.push({
        title,
        headline: headline || title,
        source,
        desc: desc && desc !== title ? desc.substring(0, 280) : '',
        url: Utils.stripMarkup(readTag(rItem, 'link'))
      });
    }
    return results;
  };

  /**
   * Sélectionne la dernière vidéo longue publique de la chaîne :
   * exclusion stricte des Shorts, puis préférence pour une vidéo chapitrée publiée
   * dans les 30 h suivant la plus récente (l'édition quotidienne comporte toujours un sommaire).
   *
   * @param {string} feedXml - Flux YouTube Atom.
   * @returns {Object|null} { title, url, published, description }
   */
  const selectLatestLongVideo = (feedXml) => {
    const videos = String(feedXml || '')
      .split('<entry>')
      .slice(1)
      .map((entry) => {
        const linkMatch = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || entry.match(/<link[^>]*href="([^"]+)"/);
        return {
          title: Utils.stripMarkup(readTag(entry, 'title')),
          url: linkMatch ? linkMatch[1] : '',
          published: readTag(entry, 'published'),
          description: Utils.decodeHtmlEntities(readTag(entry, 'media:description'))
        };
      })
      .filter((v) => v.url && !v.url.includes('/shorts/') && !/#shorts?\b/i.test(`${v.title} ${v.description}`));

    if (videos.length === 0) return null;
    const newestTime = new Date(videos[0].published).getTime() || 0;
    const chaptered = videos.find(
      (v) => parseSegments(v.description).length >= 2 && newestTime - (new Date(v.published).getTime() || 0) <= 30 * 3600 * 1000
    );
    return chaptered || videos[0];
  };

  /**
   * Sélectionne le dernier épisode quotidien du flux Acast (hors formats « Pop » et grands formats).
   * @param {string} feedXml
   * @returns {Object|null} { title, url, published, description }
   */
  const selectLatestAcastEpisode = (feedXml) => {
    const items = String(feedXml || '').split('<item>').slice(1);
    if (items.length === 0) return null;
    const target = items.find((it) => !/\bpop\b|grands?\s+formats?/i.test(Utils.stripMarkup(readTag(it, 'title')))) || items[0];
    const enclosure = target.match(/<enclosure[^>]*url="([^"]+)"/);
    return {
      title: Utils.stripMarkup(readTag(target, 'title')) || 'Les Actus du Jour',
      url: Utils.stripMarkup(readTag(target, 'link')) || (enclosure ? enclosure[1] : Config.NEWS_SOURCES.HUGO_CHANNEL_VIDEOS_URL),
      published: readTag(target, 'pubDate'),
      description: Utils.decodeHtmlEntities(readTag(target, 'description') || readTag(target, 'itunes:summary'))
        .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    };
  };

  /**
   * Date de publication formatée (repli : date du jour).
   * @param {string} raw
   * @returns {string}
   */
  const formatPublished = (raw) => {
    const d = raw ? new Date(raw) : new Date();
    return Utils.formatDateFrench(isNaN(d.getTime()) ? new Date() : d);
  };

  /**
   * Enrichit les segments (recherches Google Actualités dédiées) et extrait les articles sources,
   * en deux appels parallèles indépendants.
   *
   * @param {Array<Object>} segments
   * @param {Array<string>} articleUrls
   * @returns {{segmentHeadlines: Array<Array<string>>, articleSnippets: Array<string>}}
   */
  const enrichHugoSegments = (segments, articleUrls) => {
    const segmentsToQuery = segments.slice(0, 10);
    const segmentResponses = Utils.fetchUrlsSafely(
      segmentsToQuery.map((seg) => ({
        url: buildGoogleSearchRss(seg.title.replace(/:\s*dernières infos/i, '').replace(/[:«»"“”]/g, ' ').trim())
      }))
    );
    const articleResponses = Utils.fetchUrlsSafely(articleUrls.map((url) => ({ url, headers: BROWSER_HEADERS })));

    return {
      segmentHeadlines: segmentsToQuery.map((_, s) => parseGoogleNewsItems(Utils.okText(segmentResponses[s]), 5).map((it) => it.title)),
      articleSnippets: articleResponses
        .map((res) => extractArticleFacts(Utils.okText(res)))
        .filter(Boolean)
        .map((facts) => `- ${facts}`)
    };
  };

  /**
   * Construit l'épisode HugoDécrypte du jour (YouTube, sinon Acast, sinon indisponible)
   * et le contexte texte correspondant pour l'IA.
   *
   * @param {string} youtubeXml
   * @param {string} acastXml
   * @returns {{episode: Object, context: string}}
   */
  const buildHugoEpisode = (youtubeXml, acastXml) => {
    const youtube = selectLatestLongVideo(youtubeXml);
    const acast = youtube ? null : selectLatestAcastEpisode(acastXml);
    const pick = youtube || acast;

    if (!pick) {
      console.warn('HugoDécrypte : ni YouTube ni Acast disponibles ce matin.');
      return {
        episode: {
          available: false,
          source: 'none',
          sourceLabel: 'Voir les vidéos de la chaîne HugoDécrypte',
          title: 'Les Actus du Jour',
          url: Config.NEWS_SOURCES.HUGO_CHANNEL_VIDEOS_URL,
          publishedDate: Utils.formatDateFrench(new Date()),
          segments: []
        },
        context: '=== HUGODÉCRYPTE : AUCUNE ÉDITION DISPONIBLE CE MATIN (ne génère aucun segment) ===\n\n'
      };
    }

    const source = youtube ? 'youtube' : 'acast';
    const publishedDate = formatPublished(pick.published);
    const segments = parseSegments(pick.description);
    const articleUrls = extractArticleUrls(pick.description);

    let enrichment = { segmentHeadlines: [], articleSnippets: [] };
    if (Utils.hasTimeFor(MIN_REMAINING_FOR_HUGO_ENRICHMENT_MS)) {
      enrichment = enrichHugoSegments(segments, articleUrls);
    } else {
      console.warn('HugoDécrypte : enrichissement presse ignoré (budget temps).');
    }

    let context = `=== SOURCE PRIORITAIRE : HUGODÉCRYPTE (${source === 'youtube' ? 'VIDÉO' : 'ÉPISODE AUDIO'} DU ${publishedDate}) ===\n`;
    context += `Titre de l'édition : "${pick.title}"\nLien : ${pick.url}\n\n`;
    if (segments.length > 0) {
      context += 'SOMMAIRE DÉTAILLÉ ET FAITS DE PRESSE PAR SEGMENT :\n';
      segments.forEach((seg, s) => {
        context += `[${seg.timestamp}] ${seg.title}\n`;
        for (const hl of enrichment.segmentHeadlines[s] || []) context += `  • Presse : ${hl}\n`;
      });
      context += '\n';
    } else {
      context += `DESCRIPTION DE L'ÉDITION :\n${Utils.stripMarkup(pick.description).substring(0, 1500)}\n\n`;
    }
    if (enrichment.articleSnippets.length > 0) {
      context += `DÉTAILS COMPLETS ISSUS DES ARTICLES SOURCES :\n${enrichment.articleSnippets.join('\n')}\n\n`;
    } else if (articleUrls.length > 0) {
      context += `LIENS SOURCES :\n${articleUrls.join('\n')}\n\n`;
    }

    return {
      episode: {
        available: true,
        source,
        sourceLabel: source === 'youtube' ? 'Regarder la vidéo complète sur YouTube' : 'Écouter l’épisode complet (Acast)',
        title: pick.title,
        url: pick.url,
        publishedDate,
        segments
      },
      context
    };
  };

  // ---------------------------------------------------------------------------
  // Google Actualités (PESTEL+)
  // ---------------------------------------------------------------------------

  /**
   * Extrait les mots porteurs d'un titre pour une recherche de corroboration.
   * @param {string} headline - Titre sans la source.
   * @returns {string}
   */
  const buildCorroborationQuery = (headline) => {
    if (!headline) return '';
    const noPrefix = headline.replace(/^(?:EN\s+DIRECT|DIRECT|INFO\s+[A-Z-]+|VIDEO|VIDÉO|CARTE|ÉDITO)\s*[-:.]\s*/i, '');
    const stopWords = new Set([
      'les', 'des', 'une', 'est', 'sont', 'pour', 'par', 'sur', 'dans', 'avec', 'qui', 'que', 'dit', 'fait',
      'avoir', 'être', 'aux', 'ses', 'son', 'cette', 'tout', 'tous', 'plus', 'après', 'avant', 'entre',
      'contre', 'vers', 'chez', 'lors', 'sous', 'selon', 'veut', 'peut', 'aussi', 'mais'
    ]);
    return noPrefix
      .replace(/['’«»"“”:,.;?!()[\]]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w.toLowerCase()))
      .slice(0, 5)
      .join(' ');
  };

  /**
   * Construit le complément Google Actualités : dépêches par rubrique, corroboration presse
   * et rubriques de repli (sans IA).
   *
   * @param {Array<Object>} categories - Rubriques avec flux.
   * @param {Array<Object>} feedMappings - { catIndex } aligné sur feedResponses.
   * @param {Array<Object|null>} feedResponses - Réponses HTTP des flux.
   * @returns {{context: string, fallbackCategories: Array<Object>}}
   */
  const buildGoogleNewsComplement = (categories, feedMappings, feedResponses) => {
    const grouped = categories.map(() => []);
    feedMappings.forEach((mapping, idx) => {
      const perFeed = categories[mapping.catIndex].rssUrls.length > 1 ? 3 : 5;
      grouped[mapping.catIndex].push(...parseGoogleNewsItems(Utils.okText(feedResponses[idx]), perFeed));
    });

    // Déduplication par rubrique et préparation de la corroboration (2 titres principaux par rubrique)
    const corrobJobs = [];
    const deduped = grouped.map((items, catIdx) => {
      const seen = new Set();
      const unique = items.filter((it) => {
        const key = it.headline.toLowerCase().substring(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      for (const top of unique.slice(0, 2)) {
        const q = buildCorroborationQuery(top.headline);
        if (q) corrobJobs.push({ catIdx, url: buildGoogleSearchRss(q) });
      }
      return unique;
    });

    const corrobByCat = categories.map(() => []);
    if (corrobJobs.length > 0 && Utils.hasTimeFor(MIN_REMAINING_FOR_CORROBORATION_MS)) {
      const responses = Utils.fetchUrlsSafely(corrobJobs.map((j) => ({ url: j.url })));
      corrobJobs.forEach((job, j) => {
        corrobByCat[job.catIdx].push(...parseGoogleNewsItems(Utils.okText(responses[j]), 4).map((e) => e.title));
      });
    } else if (corrobJobs.length > 0) {
      console.warn('Google Actualités : corroboration ignorée (budget temps).');
    }

    let context = "=== COMPLÉMENT D'ACTUALITÉS PAR RUBRIQUE (SOURCES GOOGLE ACTUALITÉS FRANCE) ===\n";
    const fallbackCategories = [];

    categories.forEach((cat, i) => {
      const items = deduped[i];
      if (items.length === 0) return;

      context += `\n[${cat.name}]\n`;
      const seen = new Set(items.map((it) => it.title.toLowerCase().substring(0, 45)));
      for (const it of items) {
        context += `- ${it.headline} (source : ${it.source})${it.desc ? ` — ${it.desc}` : ''}\n`;
      }
      let extras = 0;
      for (const extraTitle of corrobByCat[i]) {
        const key = extraTitle.toLowerCase().substring(0, 45);
        if (seen.has(key)) continue;
        seen.add(key);
        context += `  • Corroboration presse : ${extraTitle}\n`;
        if (++extras >= 4) break;
      }

      fallbackCategories.push({
        name: cat.name,
        items: items.slice(0, 2).map((it) => ({
          headline: Utils.sanitizeText(it.headline),
          summary: Utils.sanitizeText(`Selon ${it.source}.`),
          url: it.url
        }))
      });
    });

    return { context, fallbackCategories };
  };

  /**
   * Point d'entrée : collecte HugoDécrypte + Google Actualités en parallèle.
   * @returns {{rawContext: string, hugoEpisode: Object, fallbackCategories: Array<Object>}}
   */
  const fetchDailyNewsData = () => {
    const categories = getCategories();
    const feedMappings = [];
    categories.forEach((cat, catIndex) => {
      cat.rssUrls.forEach((url) => feedMappings.push({ catIndex, url }));
    });

    const responses = Utils.fetchUrlsSafely([
      { url: Config.NEWS_SOURCES.HUGO_YOUTUBE_FEED },
      { url: Config.NEWS_SOURCES.HUGO_ACAST_FEED },
      ...feedMappings.map((m) => ({ url: m.url }))
    ]);

    let hugo;
    try {
      hugo = buildHugoEpisode(Utils.okText(responses[0]), Utils.okText(responses[1]));
    } catch (e) {
      console.warn(`HugoDécrypte : erreur de lecture — ${e.message}`);
      hugo = buildHugoEpisode('', '');
    }

    let complement = { context: '', fallbackCategories: [] };
    try {
      complement = buildGoogleNewsComplement(categories, feedMappings, responses.slice(2));
    } catch (e) {
      console.warn(`Google Actualités : erreur de lecture — ${e.message}`);
    }

    return {
      rawContext: `${hugo.context}${complement.context}`,
      hugoEpisode: hugo.episode,
      fallbackCategories: complement.fallbackCategories
    };
  };

  /**
   * Vérification rapide de la disponibilité des flux HugoDécrypte (diagnostic).
   * @returns {{youtube: boolean, acast: boolean, latestTitle: string}}
   */
  const checkHugoFeeds = () => {
    const [yt, acast] = Utils.fetchUrlsSafely([
      { url: Config.NEWS_SOURCES.HUGO_YOUTUBE_FEED },
      { url: Config.NEWS_SOURCES.HUGO_ACAST_FEED }
    ]);
    const video = selectLatestLongVideo(Utils.okText(yt));
    return {
      youtube: Boolean(video),
      acast: Boolean(Utils.okText(acast)),
      latestTitle: video ? video.title : ''
    };
  };

  return {
    fetchDailyNewsData,
    checkHugoFeeds
  };
})();
