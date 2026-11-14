/**
 * Google CC Briefing Agent
 * NewsService.js — Collecte des actualités du jour :
 * 1. HugoDécrypte « Les Actus du Jour » : dernière vidéo longue de la chaîne YouTube
 *    @hugodecrypteactus (Shorts exclus), chapitrage horodaté et articles sources de la description ;
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
   * En-têtes « navigateur » pour les pages YouTube (langue française + consentement cookies
   * pré-accepté, sinon YouTube peut renvoyer sa page de consentement au lieu de la chaîne).
   */
  const YOUTUBE_HEADERS = Object.freeze({
    'User-Agent': BROWSER_HEADERS['User-Agent'],
    'Accept-Language': 'fr-FR,fr;q=0.9',
    Cookie: 'CONSENT=YES+1; SOCS=CAI'
  });

  const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

  /**
   * Vidéos longues du flux RSS de la chaîne (Shorts exclus), de la plus récente à la plus ancienne.
   * @param {string} feedXml - Flux YouTube Atom.
   * @returns {Array<{id: string, title: string, url: string, published: string, description: string}>}
   */
  const parseFeedVideos = (feedXml) =>
    String(feedXml || '')
      .split('<entry>')
      .slice(1)
      .map((entry) => {
        const linkMatch = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || entry.match(/<link[^>]*href="([^"]+)"/);
        const url = linkMatch ? linkMatch[1] : '';
        return {
          id: readTag(entry, 'yt:videoId') || (url.match(/[?&]v=([\w-]{11})/) || [])[1] || '',
          title: Utils.stripMarkup(readTag(entry, 'title')),
          url,
          published: readTag(entry, 'published'),
          description: Utils.decodeHtmlEntities(readTag(entry, 'media:description'))
        };
      })
      .filter((v) => v.url && !v.url.includes('/shorts/') && !/#shorts?\b/i.test(`${v.title} ${v.description}`));

  /**
   * Identifiant de la première vidéo de l'onglet « Vidéos » de la chaîne
   * (https://www.youtube.com/@hugodecrypteactus/videos) : cet onglet ne contient que les
   * vidéos longues, de la plus récente à la plus ancienne (les Shorts ont leur propre onglet).
   * @param {string} html
   * @returns {string} Identifiant (11 caractères) ou chaîne vide.
   */
  const firstVideoIdFromChannelPage = (html) => {
    const m = String(html || '').match(/"videoId":"([\w-]{11})"/);
    return m ? m[1] : '';
  };

  /**
   * Détails d'une vidéo lus sur sa page YouTube (titre, description complète avec chapitres, date).
   * @param {string} id - Identifiant de la vidéo.
   * @returns {Object|null} { id, title, url, published, description }
   */
  const fetchWatchDetails = (id) => {
    const [res] = Utils.fetchUrlsSafely([{ url: `${watchUrl(id)}&hl=fr`, headers: YOUTUBE_HEADERS }]);
    const html = Utils.okText(res);
    if (!html) return null;
    const jsonString = (re) => {
      const m = html.match(re);
      if (!m) return '';
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return '';
      }
    };
    const title =
      jsonString(/"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/) ||
      Utils.stripMarkup((html.match(/<meta\s+name="title"\s+content="([^"]*)"/) || [])[1]);
    if (!title) return null;
    return {
      id,
      title,
      url: watchUrl(id),
      published: jsonString(/"publishDate":"([^"]+)"/) || jsonString(/"uploadDate":"([^"]+)"/),
      description: jsonString(/"shortDescription":"((?:[^"\\]|\\.)*)"/)
    };
  };

  /**
   * Repli sur le seul flux RSS : préférence pour une vidéo chapitrée publiée dans les 30 h
   * suivant la plus récente (l'édition quotidienne comporte toujours un sommaire).
   * @param {Array<Object>} videos
   * @returns {Object|null}
   */
  const selectFromFeed = (videos) => {
    if (videos.length === 0) return null;
    const newestTime = new Date(videos[0].published).getTime() || 0;
    const chaptered = videos.find(
      (v) => parseSegments(v.description).length >= 2 && newestTime - (new Date(v.published).getTime() || 0) <= 30 * 3600 * 1000
    );
    return chaptered || videos[0];
  };

  /**
   * Dernière vidéo longue publique de la chaîne YouTube HugoDécrypte (source unique, jamais de Short) :
   * 1. la page « Vidéos » de la chaîne désigne la dernière vidéo longue (source de vérité) ;
   * 2. son sommaire est lu dans le flux RSS, sinon directement sur la page de la vidéo ;
   * 3. si la page de la chaîne est illisible, le flux RSS seul est utilisé.
   * Le flux RSS YouTube renvoie parfois des erreurs 404 passagères : une seconde tentative
   * est faite si les deux sources ont échoué.
   *
   * @param {string} feedXml - Flux RSS déjà téléchargé.
   * @param {string} pageHtml - Page « Vidéos » déjà téléchargée.
   * @returns {Object|null} { title, url, published, description }
   */
  const resolveLatestVideo = (feedXml, pageHtml) => {
    let feedVideos = parseFeedVideos(feedXml);
    let pageId = firstVideoIdFromChannelPage(pageHtml);

    if (feedVideos.length === 0 && !pageId) {
      console.warn('HugoDécrypte : YouTube n’a pas répondu, nouvelle tentative.');
      Utilities.sleep(1500);
      const [feedRes, pageRes] = Utils.fetchUrlsSafely([
        { url: Config.NEWS_SOURCES.HUGO_YOUTUBE_FEED },
        { url: Config.NEWS_SOURCES.HUGO_CHANNEL_VIDEOS_URL, headers: YOUTUBE_HEADERS }
      ]);
      feedVideos = parseFeedVideos(Utils.okText(feedRes));
      pageId = firstVideoIdFromChannelPage(Utils.okText(pageRes));
    }

    if (pageId) {
      const inFeed = feedVideos.find((v) => v.id === pageId);
      if (inFeed && parseSegments(inFeed.description).length > 0) return inFeed;
      const details = fetchWatchDetails(pageId);
      if (details) return details;
      if (inFeed) return inFeed;
    }
    return selectFromFeed(feedVideos);
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
   * Édition « indisponible » : lien vers la chaîne YouTube, aucun contenu inventé.
   * @returns {{episode: Object, context: string}}
   */
  const buildUnavailableHugo = () => ({
    episode: {
      available: false,
      source: 'none',
      sourceLabel: 'Voir les vidéos de la chaîne HugoDécrypte sur YouTube',
      title: 'Les Actus du Jour',
      url: Config.NEWS_SOURCES.HUGO_CHANNEL_VIDEOS_URL,
      publishedDate: Utils.formatDateFrench(new Date()),
      segments: []
    },
    context: '=== HUGODÉCRYPTE : AUCUNE VIDÉO YOUTUBE DISPONIBLE CE MATIN (ne génère aucun segment) ===\n\n'
  });

  /**
   * Construit l'édition HugoDécrypte du jour (dernière vidéo longue YouTube uniquement)
   * et le contexte texte correspondant pour l'IA.
   *
   * @param {string} feedXml - Flux RSS de la chaîne.
   * @param {string} pageHtml - Page « Vidéos » de la chaîne.
   * @returns {{episode: Object, context: string}}
   */
  const buildHugoEpisode = (feedXml, pageHtml) => {
    const pick = resolveLatestVideo(feedXml, pageHtml);
    if (!pick) {
      console.warn('HugoDécrypte : chaîne YouTube indisponible ce matin.');
      return buildUnavailableHugo();
    }

    const publishedDate = formatPublished(pick.published);
    const segments = parseSegments(pick.description);
    const articleUrls = extractArticleUrls(pick.description);

    let enrichment = { segmentHeadlines: [], articleSnippets: [] };
    if (Utils.hasTimeFor(MIN_REMAINING_FOR_HUGO_ENRICHMENT_MS)) {
      enrichment = enrichHugoSegments(segments, articleUrls);
    } else {
      console.warn('HugoDécrypte : enrichissement presse ignoré (budget temps).');
    }

    let context = `=== SOURCE PRIORITAIRE : HUGODÉCRYPTE (VIDÉO YOUTUBE DU ${publishedDate}) ===\n`;
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
        source: 'youtube',
        sourceLabel: 'Regarder la vidéo complète sur YouTube',
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
      { url: Config.NEWS_SOURCES.HUGO_CHANNEL_VIDEOS_URL, headers: YOUTUBE_HEADERS },
      ...feedMappings.map((m) => ({ url: m.url }))
    ]);

    let hugo;
    try {
      hugo = buildHugoEpisode(Utils.okText(responses[0]), Utils.okText(responses[1]));
    } catch (e) {
      console.warn(`HugoDécrypte : erreur de lecture — ${e.message}`);
      hugo = buildUnavailableHugo();
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
   * Vérification rapide de la chaîne YouTube HugoDécrypte (diagnostic).
   * @returns {{rss: boolean, page: boolean, latestTitle: string, latestUrl: string}}
   */
  const checkHugoFeeds = () => {
    const [feedRes, pageRes] = Utils.fetchUrlsSafely([
      { url: Config.NEWS_SOURCES.HUGO_YOUTUBE_FEED },
      { url: Config.NEWS_SOURCES.HUGO_CHANNEL_VIDEOS_URL, headers: YOUTUBE_HEADERS }
    ]);
    const feedXml = Utils.okText(feedRes);
    const pageHtml = Utils.okText(pageRes);
    const video = resolveLatestVideo(feedXml, pageHtml);
    return {
      rss: parseFeedVideos(feedXml).length > 0,
      page: Boolean(firstVideoIdFromChannelPage(pageHtml)),
      latestTitle: video ? video.title : '',
      latestUrl: video ? video.url : ''
    };
  };

  return {
    fetchDailyNewsData,
    checkHugoFeeds
  };
})();
