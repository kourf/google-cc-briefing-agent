/**
 * Google CC Briefing Agent
 * NewsService.js — Extraction des actualités quotidiennes (HugoDécrypte "Actus du jour" en vidéo longue + Google Actualités par catégorie).
 *
 * @author Kouroufia
 * @version 2.2.0
 */

const NewsService = (() => {
  const HUGO_YOUTUBE_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCAcAnMF0OrCtUep3Y4M-ZPw';
  const HUGO_ACAST_FEED = 'https://feeds.acast.com/public/shows/61365f9fb4ac8f42e6668a5c';

  const buildGoogleSearchRss = (query) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`;

  /**
   * Catégories officielles ordonnées selon le modèle PESTEL, suivi de Culture & Savoir,
   * Sport et Faits divers (sources 100% issues de Google Actualités France, zéro émoji).
   */
  const CATEGORIES = Object.freeze([
    {
      id: 'P_POLITIQUE_GEOPOLITIQUE',
      name: 'P — Politique & Géopolitique',
      rssUrls: [
        'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=FR&ceid=FR:fr',
        'https://news.google.com/rss/headlines/section/topic/NATION?hl=fr&gl=FR&ceid=FR:fr'
      ]
    },
    {
      id: 'E_ECONOMIE_FINANCE',
      name: 'E — Économie, Finance & Entreprises',
      rssUrls: [
        'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=fr&gl=FR&ceid=FR:fr'
      ]
    },
    {
      id: 'S_SOCIAL_SOCIETAL',
      name: 'S — Social & Sociétal',
      rssUrls: [
        buildGoogleSearchRss('société OR grève OR "pouvoir d\'achat" OR santé OR éducation France when:2d')
      ]
    },
    {
      id: 'T_TECH_IA',
      name: 'T — Technologie, IA & Innovation',
      rssUrls: [
        'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=fr&gl=FR&ceid=FR:fr'
      ]
    },
    {
      id: 'E_ENVIRONNEMENT',
      name: 'E — Environnement & Écologie',
      rssUrls: [
        buildGoogleSearchRss('environnement OR climat OR écologie OR énergie France monde when:2d')
      ]
    },
    {
      id: 'L_LEGAL_JUSTICE',
      name: 'L — Légal : Justice, Lois & Procès',
      rssUrls: [
        buildGoogleSearchRss('justice OR procès OR "projet de loi" OR "proposition de loi" OR tribunal France when:2d')
      ]
    },
    {
      id: 'CULTURE_SAVOIR',
      name: 'Culture & Savoir (Sciences, Histoire, Cinéma & Livres)',
      rssUrls: [
        'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=fr&gl=FR&ceid=FR:fr',
        'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=fr&gl=FR&ceid=FR:fr'
      ]
    },
    {
      id: 'SPORT',
      name: 'Sport',
      rssUrls: [
        'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=fr&gl=FR&ceid=FR:fr'
      ]
    },
    {
      id: 'FAITS_DIVERS',
      name: 'Faits divers (Délits, Crimes & Accidents marquants)',
      rssUrls: [
        buildGoogleSearchRss('"faits divers" OR "garde à vue" OR "accident mortel" OR meurtre OR braquage France when:2d')
      ]
    }
  ]);

  const PAYWALL_REGEX = /lemonde\.fr|liberation\.fr|mediapart\.fr|lesechos\.fr|lexpress\.fr|lepoint\.fr|telerama\.fr|humanite\.fr|courrierinternational\.com/;

  const NAMED_ENTITIES = Object.freeze({
    quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
    ndash: '–', mdash: '—', hellip: '…', oelig: 'œ', OElig: 'Œ',
    eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
    agrave: 'à', acirc: 'â', auml: 'ä', ccedil: 'ç',
    icirc: 'î', iuml: 'ï', ocirc: 'ô', ouml: 'ö',
    ucirc: 'û', ugrave: 'ù', uuml: 'ü',
    Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Agrave: 'À', Ccedil: 'Ç'
  });

  /**
   * Nettoie les entités XML/HTML (y compris accents français et entités numériques) d'un texte.
   *
   * @param {string} str - Texte brut.
   * @returns {string} Texte nettoyé.
   */
  const cleanXmlText = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&([a-zA-Z]+);/g, (m, k) => (NAMED_ENTITIES[k] !== undefined ? NAMED_ENTITIES[k] : m))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Extrait le titre, la méta-description et le corps factuel d'un article de presse HTML.
   * Privilégie le JSON-LD `articleBody` puis les paragraphes de l'article en filtrant le bruit.
   *
   * @param {string} html - Code HTML brut de l'article.
   * @returns {string} Extrait factuel structuré (vide si page bloquée/paywall).
   */
  const extractArticleFacts = (html) => {
    if (!html) return '';
    const tMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = cleanXmlText(tMatch ? tMatch[1] : '');
    if (
      /accès restreint|403 forbidden|access denied|just a moment|cloudflare/i.test(title) ||
      title.toLowerCase() === 'liberation.fr'
    ) {
      return '';
    }

    const dMatch =
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i) ||
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
    const ogDesc = cleanXmlText(dMatch ? dMatch[1] : '');

    let articleBody = '';
    const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of ldMatches) {
      try {
        const obj = JSON.parse(m[1]);
        const stack = Array.isArray(obj) ? [...obj] : [obj];
        while (stack.length > 0) {
          const node = stack.shift();
          if (!node || typeof node !== 'object') continue;
          if (typeof node.articleBody === 'string' && node.articleBody.length > 80) {
            articleBody = cleanXmlText(node.articleBody);
            break;
          }
          if (Array.isArray(node['@graph'])) {
            stack.push(...node['@graph']);
          }
        }
        if (articleBody) break;
      } catch {}
    }

    let bodyParas = '';
    if (!articleBody) {
      const artMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
      const artBlock = artMatch ? artMatch[1] : html;
      const paras = [...artBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((m) => cleanXmlText(m[1]))
        .filter(
          (p) =>
            p.length > 65 &&
            !/cookie|abonner|newsletter|confidentialité|connecter|publicité|lire aussi|sur le même sujet|pour pouvoir enregistrer|activez les notifications|partenaire autorisé/i.test(
              p
            )
        )
        .slice(0, 5);
      bodyParas = paras.join(' ');
    }

    const bestBody = articleBody || bodyParas;
    const parts = [title, ogDesc && ogDesc !== title ? ogDesc : '', bestBody].filter(Boolean);
    return parts.join(' | ').substring(0, 1500);
  };

  /**
   * Exécute un lot de requêtes HTTP en parallèle avec résilience unitaire :
   * si UrlFetchApp.fetchAll() échoue à cause d'une seule URL inaccessible
   * (ex: "Adresse non disponible"), repli automatique URL par URL sans perdre le reste du lot.
   *
   * @param {Array<Object>} requests - Liste des objets requêtes UrlFetchApp.
   * @returns {Array<GoogleAppsScript.URL_Fetch.HTTPResponse|null>} Réponses alignées index par index.
   */
  const fetchUrlsSafely = (requests) => {
    if (!requests || requests.length === 0) return [];
    try {
      return UrlFetchApp.fetchAll(requests);
    } catch (batchErr) {
      console.warn(`fetchUrlsSafely fallback (${requests.length} URLs): ${batchErr.message}`);
      return requests.map((req) => {
        try {
          const { url, ...opts } = req;
          return UrlFetchApp.fetch(url, { ...opts, validateHttpsCertificates: false });
        } catch {
          return null;
        }
      });
    }
  };

  /**
   * Extrait les dépêches structurées (<title>, <description>, <link>) d'un flux RSS Google Actualités.
   *
   * @param {string} xml - Contenu XML du flux Google Actualités.
   * @param {number} maxItems - Nombre maximal d'articles à extraire.
   * @returns {Array<Object>} Dépêches nettoyées.
   */
  const parseGoogleNewsItems = (xml, maxItems = 5) => {
    if (!xml) return [];
    const results = [];
    const rssItems = xml.split('<item>').slice(1, maxItems + 1);
    for (const rItem of rssItems) {
      const tMatch = rItem.match(/<title>([\s\S]*?)<\/title>/);
      const lMatch = rItem.match(/<link>([\s\S]*?)<\/link>/);
      const dMatch = rItem.match(/<description>([\s\S]*?)<\/description>/);
      const fullTitle = cleanXmlText(tMatch ? tMatch[1] : '');
      const link = cleanXmlText(lMatch ? lMatch[1] : '');
      const relatedDesc = cleanXmlText(dMatch ? dMatch[1] : '');

      if (fullTitle) {
        results.push({
          title: fullTitle,
          desc: relatedDesc && relatedDesc !== fullTitle ? relatedDesc.substring(0, 280) : '',
          url: link
        });
      }
    }
    return results;
  };

  /**
   * Enrichit en parallèle les recherches Google Actualités par segment (isolées des médias tiers)
   * et les articles sources ouverts de la description YouTube.
   *
   * @param {Array<Object>} parsedSegments - Liste des segments { timestamp, title }.
   * @param {string} liensSection - Section liens de la description YouTube.
   * @returns {Object} { segmentHeadlines: Array<Array<string>>, articleSnippets: Array<string> }
   */
  const enrichHugoSegmentsAndArticles = (parsedSegments, liensSection) => {
    let prioritizedUrls = [];
    if (liensSection) {
      const urlMatches = [...liensSection.matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0]);
      // Nettoyage des fragments #anchor (qui provoquent parfois "Adresse non disponible" dans UrlFetchApp)
      const sanitizedUrls = urlMatches
        .map((u) => u.split('#')[0].trim())
        .filter(
          (u) =>
            /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(u) &&
            !/youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|tiktok\.com|acast\.com|hugodecrypte\.com/.test(u)
        );
      const uniqueUrls = [...new Set(sanitizedUrls)];
      // Privilégier strictement les médias ouverts avant les paywalls
      prioritizedUrls = [
        ...uniqueUrls.filter((u) => !PAYWALL_REGEX.test(u)),
        ...uniqueUrls.filter((u) => PAYWALL_REGEX.test(u))
      ].slice(0, 12);
    }

    const segmentsToQuery = (parsedSegments || []).slice(0, 10);
    const segmentRequests = segmentsToQuery.map((seg) => {
      const cleanQ = seg.title.replace(/:\s*dernières infos/i, '').replace(/[:«»"“”]/g, ' ').trim();
      return { url: buildGoogleSearchRss(cleanQ), muteHttpExceptions: true };
    });

    const articleRequests = prioritizedUrls.map((u) => ({
      url: u,
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }));

    // Lots séparés : 1 média tiers bloqué ne peut jamais compromettre les recherches Google News
    const segmentResponses = fetchUrlsSafely(segmentRequests);
    const articleResponses = fetchUrlsSafely(articleRequests);

    const segmentHeadlines = segmentsToQuery.map(() => []);
    for (let s = 0; s < segmentsToQuery.length; s++) {
      const res = segmentResponses[s];
      if (res && res.getResponseCode() === 200) {
        const parsed = parseGoogleNewsItems(res.getContentText(), 5);
        segmentHeadlines[s] = parsed.map((it) => it.title);
      }
    }

    const articleSnippets = [];
    for (let k = 0; k < articleResponses.length; k++) {
      const res = articleResponses[k];
      if (res && res.getResponseCode() === 200) {
        const facts = extractArticleFacts(res.getContentText());
        if (facts) {
          articleSnippets.push(`- ${facts}`);
        }
      }
    }

    return { segmentHeadlines, articleSnippets };
  };

  /**
   * Extrait 5 mots-clés porteurs d'un titre de presse pour rechercher des dépêches
   * complémentaires Google Actualités (ville exacte, motif, acteurs).
   *
   * @param {string} rawTitle - Titre brut d'une dépêche.
   * @returns {string} Requête optimisée pour Google News RSS.
   */
  const buildCorroborationQuery = (rawTitle) => {
    if (!rawTitle) return '';
    const noSource = rawTitle.replace(/\s+-\s+[^-]+$/, '');
    const noPrefix = noSource.replace(/^(?:EN\s+DIRECT|DIRECT|INFO\s+[A-Z-]+|VIDEO|CARTE|ÉDITO)\s*[-:.]\s*/i, '');
    const stopWords = new Set([
      'les', 'des', 'une', 'est', 'sont', 'pour', 'par', 'sur', 'dans', 'avec',
      'qui', 'que', 'dit', 'fait', 'avoir', 'être', 'aux', 'ses', 'son', 'cette',
      'tout', 'tous', 'plus', 'après', 'avant', 'entre', 'contre', 'vers', 'chez',
      'lors', 'sous', 'selon', 'veut', 'peut', 'aussi', 'mais'
    ]);
    const words = noPrefix
      .replace(/['’«»"“”:,.;?!()\[\]]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3 && !stopWords.has(w.toLowerCase()));
    return words.slice(0, 5).join(' ');
  };

  /**
   * Récupère en parallèle les flux HugoDécrypte et les flux Google Actualités par catégorie PESTEL.
   * Isole strictement la vraie vidéo quotidienne complète d'HugoDécrypte (exclut tous les Shorts),
   * analyse le sommaire détaillé et enrichit les liens sources des articles de presse.
   *
   * @returns {Object|null} Données structurées pour l'analyse IA.
   */
  const fetchDailyNewsData = () => {
    const categoryFeedMappings = [];
    for (let cIdx = 0; cIdx < CATEGORIES.length; cIdx++) {
      const cat = CATEGORIES[cIdx];
      for (const rssUrl of cat.rssUrls) {
        categoryFeedMappings.push({ catIndex: cIdx, url: rssUrl });
      }
    }

    const initialRequests = [
      { url: HUGO_YOUTUBE_FEED, muteHttpExceptions: true },
      { url: HUGO_ACAST_FEED, muteHttpExceptions: true },
      ...categoryFeedMappings.map((m) => ({ url: m.url, muteHttpExceptions: true }))
    ];

    const responses = fetchUrlsSafely(initialRequests);

    let rawContext = '';
    let hugoEpisode = null;
    const fallbackCategories = [];

    // 1. Analyse du flux YouTube officiel HugoDécrypte ("Actus du jour")
    try {
      const ytRes = responses[0];
      if (ytRes && ytRes.getResponseCode() === 200) {
        const ytXml = ytRes.getContentText();
        const entries = ytXml.split('<entry>').slice(1);

        // Filtrage strict : éliminer catégoriquement les YouTube Shorts (/shorts/ ou #shorts)
        const fullVideos = entries.filter((e) => {
          const lMatch = e.match(/<link[^>]*href="([^"]+)"/);
          const tMatch = e.match(/<title>([\s\S]*?)<\/title>/);
          const link = lMatch ? lMatch[1] : '';
          const title = tMatch ? tMatch[1] : '';
          return !link.includes('/shorts/') && !title.toLowerCase().includes('#shorts');
        });

        if (fullVideos.length > 0) {
          // Dernière vidéo publique complète sur https://www.youtube.com/@hugodecrypteactus/videos
          // fullVideos est ordonné par YouTube du plus récent au plus ancien.
          const targetEntry = fullVideos[0];

          const titleMatch = targetEntry.match(/<title>([\s\S]*?)<\/title>/);
          const linkMatch = targetEntry.match(/<link[^>]*href="([^"]+)"/);
          const pubMatch = targetEntry.match(/<published>([\s\S]*?)<\/published>/);
          const descMatch = targetEntry.match(/<media:description>([\s\S]*?)<\/media:description>/);

          const title = cleanXmlText(titleMatch ? titleMatch[1] : '');
          const link = linkMatch ? linkMatch[1] : 'https://www.youtube.com/@hugodecrypteactus/videos';
          const pubIso = pubMatch ? pubMatch[1] : '';
          const desc = descMatch ? descMatch[1] : '';

          let publishedDateFormatted = '';
          if (pubIso) {
            try {
              const d = new Date(pubIso);
              publishedDateFormatted = Utils.formatDateFrench(d);
            } catch {
              publishedDateFormatted = 'Date récente';
            }
          }

          // Découpage flexible du Sommaire et des Liens sources (insensible à la casse)
          const sommaireMatch = desc.match(/(?:sommaire|chapitres?|au programme)/i);
          const liensMatch = desc.match(/(?:liens?\s*(?:pour\s*en\s*savoir\s*plus)?|sources?)/i);

          const sommaireIdx = sommaireMatch ? sommaireMatch.index : -1;
          const liensIdx = liensMatch ? liensMatch.index : -1;

          let sommaireSection = '';
          let liensSection = '';

          if (sommaireIdx > -1 && liensIdx > -1) {
            if (liensIdx > sommaireIdx) {
              sommaireSection = desc.substring(sommaireIdx, liensIdx);
              liensSection = desc.substring(liensIdx);
            } else {
              liensSection = desc.substring(liensIdx, sommaireIdx);
              sommaireSection = desc.substring(sommaireIdx);
            }
          } else if (sommaireIdx > -1) {
            sommaireSection = desc.substring(sommaireIdx);
          } else if (liensIdx > -1) {
            liensSection = desc.substring(liensIdx);
          } else {
            sommaireSection = desc;
          }

          // Extraction des segments horodatés du sommaire (ex: 00:27 Titre du sujet)
          const parsedSegments = [];
          const textToParse = sommaireSection || desc;
          const lines = textToParse.split('\n');
          for (const line of lines) {
            const m = line.match(/(\d{1,2}:\d{2})\s+([^\r\n]+)/);
            if (m) {
              const time = m[1];
              const segName = cleanXmlText(m[2]).replace(/^-+\s*/, '');
              const lower = segName.toLowerCase();
              if (!lower.includes('intro') && !lower.includes('outro') && !lower.includes('conclusion')) {
                parsedSegments.push({
                  timestamp: time,
                  title: segName
                });
              }
            }
          }

          // Enrichissement parallèle simultané : articles ouverts de la description + Google News par segment
          const { segmentHeadlines, articleSnippets } = enrichHugoSegmentsAndArticles(parsedSegments, liensSection);

          hugoEpisode = {
            title,
            url: link,
            publishedDate: publishedDateFormatted,
            publishedIso: pubIso,
            editionTitle: `Les Actus du Jour du ${publishedDateFormatted}`,
            segments: parsedSegments
          };

          rawContext += `=== SOURCE PRIORITAIRE : HUGODÉCRYPTE (VIDÉO QUOTIDIENNE DU ${publishedDateFormatted}) ===\n`;
          rawContext += `Titre de l'édition : "${title}"\n`;
          rawContext += `Lien vidéo complète (jamais de short) : ${link}\n`;
          rawContext += `Date de publication : ${publishedDateFormatted} (${pubIso})\n\n`;

          if (parsedSegments.length > 0) {
            rawContext += `SOMMAIRE DÉTAILLÉ DE LA VIDÉO ET FAITS DE PRESSE PAR SEGMENT :\n`;
            for (let s = 0; s < parsedSegments.length; s++) {
              const seg = parsedSegments[s];
              rawContext += `[${seg.timestamp}] ${seg.title}\n`;
              const headlines = segmentHeadlines[s] || [];
              for (const hl of headlines) {
                rawContext += `  • Presse : ${hl}\n`;
              }
            }
            rawContext += `\n`;
          }

          if (articleSnippets.length > 0) {
            rawContext += `DÉTAILS COMPLETS ISSUS DES ARTICLES SOURCES DE LA VIDÉO :\n`;
            rawContext += `${articleSnippets.join('\n')}\n\n`;
          } else if (liensSection) {
            rawContext += `LIENS SOURCES :\n${cleanXmlText(liensSection.substring(0, 1500))}\n\n`;
          }
        }
      }
    } catch (e) {
      console.warn(`Erreur lecture flux YouTube HugoDécrypte : ${e.message}`);
    }

    // 1b. Repli robuste sur le flux audio Acast officiel d'HugoDécrypte si YouTube est indisponible
    if (!hugoEpisode) {
      try {
        const acastRes = responses[1];
        if (acastRes && acastRes.getResponseCode() === 200) {
          const acastXml = acastRes.getContentText();
          const items = acastXml.split('<item>').slice(1);
          const targetItem = items.find((it) => {
            const tMatch = it.match(/<title>([\s\S]*?)<\/title>/i);
            const t = tMatch ? tMatch[1].toLowerCase() : '';
            return !t.includes('pop') && !t.includes('grands formats');
          }) || items[0];

          if (targetItem) {
            const tMatch = targetItem.match(/<title>([\s\S]*?)<\/title>/);
            const lMatch = targetItem.match(/<link>([\s\S]*?)<\/link>/);
            const pMatch = targetItem.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

            const title = cleanXmlText(tMatch ? tMatch[1] : 'Les Actus du Jour');
            const link = cleanXmlText(lMatch ? lMatch[1] : 'https://www.youtube.com/@hugodecrypteactus/videos');
            const pubIso = pMatch ? pMatch[1] : '';

            let publishedDateFormatted = '';
            if (pubIso) {
              try {
                publishedDateFormatted = Utils.formatDateFrench(new Date(pubIso));
              } catch {
                publishedDateFormatted = Utils.formatDateFrench(new Date());
              }
            } else {
              publishedDateFormatted = Utils.formatDateFrench(new Date());
            }

            const fallbackSegments = [
              { timestamp: '01:00', title: title }
            ];

            hugoEpisode = {
              title,
              url: link,
              publishedDate: publishedDateFormatted,
              publishedIso: pubIso,
              editionTitle: `Les Actus du Jour du ${publishedDateFormatted}`,
              segments: fallbackSegments
            };

            rawContext += `=== SOURCE PRIORITAIRE : HUGODÉCRYPTE (ÉDITION QUOTIDIENNE DU ${publishedDateFormatted}) ===\n`;
            rawContext += `Titre de l'édition : "${title}"\n`;
            rawContext += `Lien de l'épisode : ${link}\n`;
            rawContext += `Date de publication : ${publishedDateFormatted}\n\n`;
            rawContext += `SOMMAIRE DÉTAILLÉ DE LA VIDÉO :\n[01:00] ${title}\n\n`;
          }
        }
      } catch (acastErr) {
        console.warn(`Erreur repli Acast HugoDécrypte : ${acastErr.message}`);
      }
    }

    // 1c. Garantie absolue d'existence de hugoEpisode et de segments non-vides
    if (hugoEpisode) {
      if (!hugoEpisode.segments || hugoEpisode.segments.length === 0) {
        hugoEpisode.segments = [{ timestamp: '01:00', title: hugoEpisode.title }];
      }
    } else {
      const todayDateStr = Utils.formatDateFrench(new Date());
      hugoEpisode = {
        title: "Les Actus du Jour — Synthèse Quotidienne",
        url: 'https://www.youtube.com/@hugodecrypteactus/videos',
        publishedDate: todayDateStr,
        publishedIso: new Date().toISOString(),
        editionTitle: `Les Actus du Jour du ${todayDateStr}`,
        segments: [
          { timestamp: '01:00', title: "Actualités marquantes en France et à l'international" }
        ]
      };
      rawContext += `=== SOURCE PRIORITAIRE : HUGODÉCRYPTE (ÉDITION DU ${todayDateStr}) ===\nTitre: ${hugoEpisode.title}\nLien: ${hugoEpisode.url}\n[01:00] Synthèse des temps forts de la journée\n\n`;
    }

    // 2. Analyse des flux Google Actualités par catégorie PESTEL, Culture & Savoir, Sport et Faits divers
    rawContext += `=== COMPLÉMENT D'ACTUALITÉS PAR CATÉGORIE (SOURCES 100% GOOGLE ACTUALITÉS FRANCE) ===\n`;

    const groupedCatItems = CATEGORIES.map(() => []);
    for (let mIdx = 0; mIdx < categoryFeedMappings.length; mIdx++) {
      const mapping = categoryFeedMappings[mIdx];
      const gRes = responses[mIdx + 2];
      const cat = CATEGORIES[mapping.catIndex];

      try {
        if (gRes && gRes.getResponseCode() === 200) {
          const itemsPerFeed = cat.rssUrls.length > 1 ? 3 : 5;
          const parsedItems = parseGoogleNewsItems(gRes.getContentText(), itemsPerFeed);
          groupedCatItems[mapping.catIndex].push(...parsedItems);
        }
      } catch (e) {
        console.warn(`Erreur lecture Google News (${cat.id}) : ${e.message}`);
      }
    }

    const dedupedByCat = [];
    const corrobJobs = [];

    for (let i = 0; i < CATEGORIES.length; i++) {
      const seenTitles = new Set();
      const catItems = [];
      for (const it of groupedCatItems[i]) {
        const normKey = it.title.toLowerCase().substring(0, 50);
        if (!seenTitles.has(normKey)) {
          seenTitles.add(normKey);
          catItems.push(it);
        }
      }
      dedupedByCat.push(catItems);

      // Corroboration multi-journaux Google Actualités sur les 2 titres principaux de chaque rubrique
      for (const topIt of catItems.slice(0, 2)) {
        const q = buildCorroborationQuery(topIt.title);
        if (q) {
          corrobJobs.push({
            catIdx: i,
            req: { url: buildGoogleSearchRss(q), muteHttpExceptions: true }
          });
        }
      }
    }

    const corrobResponses = fetchUrlsSafely(corrobJobs.map((j) => j.req));
    const corrobByCat = CATEGORIES.map(() => []);
    for (let j = 0; j < corrobJobs.length; j++) {
      const res = corrobResponses[j];
      if (res && res.getResponseCode() === 200) {
        const extra = parseGoogleNewsItems(res.getContentText(), 4);
        corrobByCat[corrobJobs[j].catIdx].push(...extra.map((e) => e.title));
      }
    }

    for (let i = 0; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];
      const catItems = dedupedByCat[i];

      if (catItems.length > 0) {
        rawContext += `\n[${cat.name}]\n`;
        const seenContextLines = new Set();
        for (const it of catItems) {
          seenContextLines.add(it.title.toLowerCase().substring(0, 45));
          rawContext += it.desc ? `- ${it.title} (${it.desc})\n` : `- ${it.title}\n`;
        }
        const extraLines = [];
        for (const extraTitle of corrobByCat[i]) {
          const normKey = extraTitle.toLowerCase().substring(0, 45);
          if (!seenContextLines.has(normKey)) {
            seenContextLines.add(normKey);
            extraLines.push(extraTitle);
            if (extraLines.length >= 4) break;
          }
        }
        for (const ext of extraLines) {
          rawContext += `  • Corroboration presse : ${ext}\n`;
        }

        fallbackCategories.push({
          name: cat.name,
          items: catItems.slice(0, 2).map((it) => {
            const parts = it.title.split(' - ');
            const source = parts.length > 1 ? parts.pop().trim() : 'Google Actualités';
            const headline = parts.join(' - ').trim();
            return {
              headline: Utils.sanitizeText(source),
              summary: Utils.sanitizeText(headline),
              url: it.url
            };
          })
        });
      }
    }

    return {
      rawContext,
      hugoEpisode,
      fallbackCategories,
      availableCategories: CATEGORIES
    };
  };

  return {
    CATEGORIES,
    fetchDailyNewsData
  };
})();
