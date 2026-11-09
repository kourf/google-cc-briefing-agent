/**
 * Google CC Briefing Agent
 * WeatherService.js — Fetch weather data using wttr.in based on location or agenda.
 *
 * @author Kouroufia
 */

const WeatherService = (() => {
  /**
   * Detects the city from today's agenda, falls back to base location.
   */
  const detectCityFromAgenda = (todayEvents, baseCity) => {
    if (!todayEvents || todayEvents.length === 0) return baseCity;

    for (const event of todayEvents) {
      const title = event.title.toLowerCase();
      const match = title.match(/(déplacement|voyage|trajet|train|vol) (?:à|pour|vers)?\s*([a-zA-ZÀ-ÿ\s]+)/i);
      if (match && match[2]) {
        const city = match[2].trim();
        if (city.length > 2 && city.length < 20) return city;
      }
      
      if (event.isPhysical && event.location) {
        const loc = event.location.split(',')[0].trim(); 
        if (loc.length > 2 && loc.length < 25) return loc;
      }
    }
    return baseCity;
  };

  /**
   * Fetch weather data from wttr.in with quick fallback.
   */
  const getWeatherData = (city) => {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = UrlFetchApp.fetch(url, {
          muteHttpExceptions: true,
          validateHttpsCertificates: true
        });
        if (response && response.getResponseCode() === 200) {
          const content = response.getContentText();
          if (content && content.trim().startsWith('{')) {
            return JSON.parse(content);
          }
        }
      } catch (e) {
        console.warn(`Tentative météo ${attempt} échouée pour ${city} : ${e.message}`);
      }
      Utilities.sleep(500 * attempt);
    }
    return null;
  };

  /**
   * Generates a concise raw weather string to pass to Gemini.
   */
  const getRawWeatherContext = (todayEvents) => {
    const baseCity = Config.DEFAULTS.WEATHER_BASE_LOCATION || 'Annemasse';
    const targetCity = detectCityFromAgenda(todayEvents, baseCity) || baseCity;
    
    console.log(`WeatherService: Target city resolved to ${targetCity}`);
    
    const weatherData = getWeatherData(targetCity);
    if (!weatherData || !weatherData.weather || weatherData.weather.length === 0) {
      console.warn(`WeatherService: Données météo indisponibles pour ${targetCity}.`);
      return null;
    }

    const todayWeather = weatherData.weather[0];
    const hourly = todayWeather.hourly;
    if (!hourly || hourly.length === 0) return null;

    // Use closest times provided by wttr.in (09:00, 15:00, 21:00)
    const targetTimes = ['900', '1500', '2100'];
    const timeLabels = { '900': '9h00', '1500': '15h00', '2100': '21h00' };
    
    let rawString = `Ville détectée : ${targetCity}. Données du jour :\n`;
    
    hourly.forEach(hourData => {
      if (targetTimes.includes(hourData.time)) {
        const temp = hourData.tempC;
        const rainProb = hourData.chanceofrain;
        const label = timeLabels[hourData.time];
        rawString += `- À ${label} : ${temp}°C, Probabilité de pluie: ${rainProb}%\n`;
      }
    });

    return rawString;
  };

  return {
    getRawWeatherContext
  };
})();
