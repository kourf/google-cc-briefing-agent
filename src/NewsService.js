/**
 * Google CC Briefing Agent
 * NewsService.js — Extraction des actualités quotidiennes (HugoDécrypte "Actus du jour" + Google Actualités par catégorie).
 *
 * @author Kouroufia
 * @version 2.1.0
 */

const NewsService = (() => {
  const HUGO_YOUTUBE_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCAcAnMF0OrCtUep3Y4M-ZPw';
  const HUGO_ACAST_FEED = 'https://feeds.acast.com/public/shows/61365f9fb4ac8f42e6668a5c';

  /**
   * Catégories officielles disponibles et configurables pour les actualités.
   */
  const CATEGORIES = Object.freeze([
    {
      id: 'GEOPOLITIQUE',
      name: '🌍 Géopolitique & International',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'ECONOMIE',
      name: '📈 Économie, Finance & Entreprises',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'FRANCE_SOCIAL',
      name: '🇫🇷 Politique & Social (France)',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/NATION?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'TECH_IA',
      name: '💻 Tech, IA & Sciences',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=fr&gl=FR&ceid=FR:fr'
    },
    {
      id: 'CULTURE_SPORT',
      name: '🎭 Culture, Médias & Sport',
      rssUrl: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=fr&gl=FR&ceid=FR:fr'
    }
  ]);

  /**
   * Nettoie les entités XML/HTML basiques d'un titre RSS.
   */
  const cleanXmlText = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Récupère en parallèle les flux HugoDécrypte (YouTube + Podcast) et les flux Google Actualités par catégorie.
   * Utilise UrlFetchApp.fetchAll pour tout charger simultanément en moins d'une seconde.
   */
  const fetchDailyNewsData = () => {
    const requests = [
      { url: HUGO_YOUTUBE_FEED, muteHttpExceptions: true },
      { url: HUGO_ACAST_FEED, muteHttpExceptions: true },
      ...CATEGORIES.map((c) => ({ url: c.rssUrl, muteHttpExceptions: true }))
    ];

    let responses = [];
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (e) {
      console.warn(`NewsService fetchAll warning: ${e.message}`);
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
        const entries = ytXml.split('<entry>').slice(1, 8);
        const hugoLines = [];

        for (const entry of entries) {
          const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
          const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
          const descMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);

          const title = cleanXmlText(titleMatch ? titleMatch[1] : '');
          const link = linkMatch ? linkMatch[1] : 'https://www.youtube.com/@HugoDecrypte';
          const desc = descMatch ? descMatch[1] : '';

          if (title) {
            hugoLines.push(`- Sujet HugoDécrypte : ${title}`);
          }

          // Si c'est la grande vidéo quotidienne avec SOMMAIRE et LIENS
          if (desc && (desc.includes('SOMMAIRE') || desc.includes('LIENS POUR EN SAVOIR PLUS'))) {
            if (!hugoEpisode) {
              hugoEpisode = {
                title,
                url: link
              };
            }
            const liensIdx = desc.indexOf('LIENS POUR EN SAVOIR PLUS');
            const sommaireIdx = desc.indexOf('SOMMAIRE');
            const startIdx = liensIdx > -1 ? liensIdx : sommaireIdx;
            if (startIdx > -1) {
              const relevantBlock = desc.substring(startIdx, Math.min(desc.length, startIdx + 3000));
              hugoLines.push(`Détails & Sommaire de l'édition HugoDécrypte :\n${cleanXmlText(relevantBlock)}`);
            }
          } else if (!hugoEpisode && title) {
            hugoEpisode = {
              title,
              url: link
            };
          }
        }

        if (hugoLines.length > 0) {
          rawContext += `=== SOURCE PRIORITAIRE : HUGODÉCRYPTE (LES ACTUS DU JOUR) ===\n${hugoLines.join('\n')}\n\n`;
        }
      }
    } catch (e) {
      console.warn(`Erreur lecture flux YouTube HugoDécrypte : ${e.message}`);
    }

    // 2. Analyse du flux Podcast Acast HugoDécrypte
    try {
      const acastRes = responses[1];
      if (acastRes && acastRes.getResponseCode() === 200) {
        const acastXml = acastRes.getContentText();
        const items = acastXml.split('<item>').slice(1, 5);
        const podcastTitles = [];

        for (const item of items) {
          const tMatch = item.match(/<title>([\s\S]*?)<\/title>/);
          const lMatch = item.match(/<link>([\s\S]*?)<\/link>/);
          const t = cleanXmlText(tMatch ? tMatch[1] : '');
          const l = cleanXmlText(lMatch ? lMatch[1] : '');
          if (t) {
            podcastTitles.push(`- Épisode Podcast HugoDécrypte : ${t}`);
            if (!hugoEpisode && l) {
              hugoEpisode = { title: t, url: l };
            }
          }
        }

        if (podcastTitles.length > 0) {
          rawContext += `=== PODCAST HUGODÉCRYPTE ===\n${podcastTitles.join('\n')}\n\n`;
        }
      }
    } catch (e) {
      console.warn(`Erreur lecture flux Acast HugoDécrypte : ${e.message}`);
    }

    // 3. Analyse des flux Google Actualités par catégorie (Complément temps réel & Secours)
    rawContext += `=== ACTUALITÉS EN TEMPS RÉEL PAR CATÉGORIE (GOOGLE ACTUALITÉS) ===\n`;

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
            const fullTitle = cleanXmlText(tMatch ? tMatch[1] : '');
            const link = cleanXmlText(lMatch ? lMatch[1] : '');

            if (fullTitle) {
              catItems.push({
                title: fullTitle,
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
          rawContext += `- ${it.title}\n`;
        }

        fallbackCategories.push({
          name: cat.name,
          items: catItems.slice(0, 3).map((it) => {
            const parts = it.title.split(' - ');
            const source = parts.length > 1 ? parts.pop().trim() : 'Actualités';
            const headline = parts.join(' - ').trim();
            return {
              headline: source,
              summary: headline,
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
