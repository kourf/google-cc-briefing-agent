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

  /**
   * Catégories officielles disponibles (sans aucun emoji pour éviter tout artefact visuel).
   */
  const CATEGORIES = Object.freeze([
    {
      id: 'GEOPOLITIQUE',
      name: 'Géopolitique & International',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'ECONOMIE',
      name: 'Économie, Finance & Entreprises',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'FRANCE_SOCIAL',
      name: 'Politique & Société (France)',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/NATION?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'TECH_IA',
      name: 'Tech, IA & Sciences',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'CULTURE_SPORT',
      name: 'Culture, Médias & Sport',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=fr&gl=FR&ceid=FR:fr'
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
   * Enrichit en un seul lot parallèle tous les articles sources ouverts et les recherches
   * Google Actualités pour chaque segment horodaté du sommaire d'HugoDécrypte.
   *
   * @param {Array<Object>} parsedSegments - Liste des segments { timestamp, title }.
   * @param {string} liensSection - Section liens de la description YouTube.
   * @returns {Object} { segmentHeadlines: Array<Array<string>>, articleSnippets: Array<string> }
   */
  const enrichHugoSegmentsAndArticles = (parsedSegments, liensSection) => {
    let prioritizedUrls = [];
    if (liensSection) {
      const urlMatches = [...liensSection.matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0]);
      const nonSocial = urlMatches.filter(
        (u) => !/youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|tiktok\.com|acast\.com|hugodecrypte\.com/.test(u)
      );
      const uniqueUrls = [...new Set(nonSocial)];
      // Privilégier strictement les médias ouverts avant les paywalls
      prioritizedUrls = [
        ...uniqueUrls.filter((u) => !PAYWALL_REGEX.test(u)),
        ...uniqueUrls.filter((u) => PAYWALL_REGEX.test(u))
      ].slice(0, 12);
    }

    const segmentsToQuery = (parsedSegments || []).slice(0, 10);
    const segmentQueryUrls = segmentsToQuery.map((seg) => {
      const cleanQ = seg.title.replace(/:\s*dernières infos/i, '').replace(/[:«»"“”]/g, ' ').trim();
      return `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQ)}&hl=fr&gl=FR&ceid=FR:fr`;
    });

    const combinedRequests = [
      ...prioritizedUrls.map((u) => ({
        url: u,
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      })),
      ...segmentQueryUrls.map((u) => ({ url: u, muteHttpExceptions: true }))
    ];

    const segmentHeadlines = segmentsToQuery.map(() => []);
    const articleSnippets = [];
    if (combinedRequests.length === 0) {
      return { segmentHeadlines, articleSnippets };
    }

    try {
      const responses = UrlFetchApp.fetchAll(combinedRequests);
      const artCount = prioritizedUrls.length;

      for (let k = 0; k < artCount; k++) {
        const res = responses[k];
        if (res && res.getResponseCode() === 200) {
          const facts = extractArticleFacts(res.getContentText());
          if (facts) {
            articleSnippets.push(`- ${facts}`);
          }
        }
      }

      for (let s = 0; s < segmentsToQuery.length; s++) {
        const res = responses[artCount + s];
        if (res && res.getResponseCode() === 200) {
          const xml = res.getContentText();
          const items = xml.split('<item>').slice(1, 6);
          for (const it of items) {
            const gtMatch = it.match(/<title>([\s\S]*?)<\/title>/);
            const gt = cleanXmlText(gtMatch ? gtMatch[1] : '');
            if (gt) {
              segmentHeadlines[s].push(gt);
            }
          }
        }
      }
    } catch (enrichErr) {
      console.warn(`Segment/Article parallel enrichment warning: ${enrichErr.message}`);
    }

    return { segmentHeadlines, articleSnippets };
  };

  /**
   * Récupère en parallèle les flux HugoDécrypte et les flux Google Actualités par catégorie.
   * Isole strictement la vraie vidéo quotidienne complète d'HugoDécrypte (exclut tous les Shorts),
   * analyse le sommaire détaillé et enrichit les liens sources des articles de presse.
   *
   * @returns {Object|null} Données structurées pour l'analyse IA.
   */
  const fetchDailyNewsData = () => {
    const initialRequests = [
      { url: HUGO_YOUTUBE_FEED, muteHttpExceptions: true },
      { url: HUGO_ACAST_FEED, muteHttpExceptions: true },
      ...CATEGORIES.map((c) => ({ url: c.rssUrl, muteHttpExceptions: true }))
    ];

    let responses = [];
    try {
      responses = UrlFetchApp.fetchAll(initialRequests);
    } catch (e) {
      console.warn(`NewsService fetchAll initial error: ${e.message}`);
      return null;
    }

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

    // 2. Analyse des flux Google Actualités par catégorie (Complément d'information)
    rawContext += `=== COMPLÉMENT D'ACTUALITÉS PAR CATÉGORIE (GOOGLE ACTUALITÉS FRANCE) ===\n`;

    for (let i = 0; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];
      const gRes = responses[i + 2];
      const catItems = [];

      try {
        if (gRes && gRes.getResponseCode() === 200) {
          const gXml = gRes.getContentText();
          const rssItems = gXml.split('<item>').slice(1, 6);

          for (const rItem of rssItems) {
            const tMatch = rItem.match(/<title>([\s\S]*?)<\/title>/);
            const lMatch = rItem.match(/<link>([\s\S]*?)<\/link>/);
            const dMatch = rItem.match(/<description>([\s\S]*?)<\/description>/);
            const fullTitle = cleanXmlText(tMatch ? tMatch[1] : '');
            const link = cleanXmlText(lMatch ? lMatch[1] : '');
            const relatedDesc = cleanXmlText(dMatch ? dMatch[1] : '');

            if (fullTitle) {
              catItems.push({
                title: fullTitle,
                desc: relatedDesc && relatedDesc !== fullTitle ? relatedDesc.substring(0, 280) : '',
                url: link
              });
            }
          }
        }
      } catch (e) {
        console.warn(`Erreur lecture Google News (${cat.id}) : ${e.message}`);
      }

      if (catItems.length > 0) {
        rawContext += `\n[${cat.name}]\n`;
        for (const it of catItems) {
          rawContext += it.desc ? `- ${it.title} (${it.desc})\n` : `- ${it.title}\n`;
        }

        fallbackCategories.push({
          name: cat.name,
          items: catItems.slice(0, 3).map((it) => {
            const parts = it.title.split(' - ');
            const source = parts.length > 1 ? parts.pop().trim() : 'Actualités';
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
