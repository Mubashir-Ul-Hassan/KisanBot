// KisanBot Weather Module — OpenWeatherMap integration
const KisanWeather = {
  cache: {},

  async getWeather(lat, lon) {
    const apiKey = KisanConfig.getWeatherApiKey();
    if (!apiKey) return null;

    const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const cached = this.cache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < KisanConfig.WEATHER_CACHE_TTL)) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${KisanConfig.WEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
      );
      if (!response.ok) return null;
      const data = await response.json();

      const weather = {
        temp: Math.round(data.main.temp),
        feels_like: Math.round(data.main.feels_like),
        humidity: data.main.humidity,
        description: data.weather[0]?.description || '',
        icon: data.weather[0]?.icon || '',
        wind_speed: Math.round(data.wind.speed * 3.6), // m/s to km/h
        clouds: data.clouds?.all || 0,
        city: data.name
      };

      this.cache[cacheKey] = { data: weather, timestamp: Date.now() };
      return weather;
    } catch (e) {
      console.error('Weather fetch failed:', e);
      return null;
    }
  },

  async getForecast(lat, lon) {
    const apiKey = KisanConfig.getWeatherApiKey();
    if (!apiKey) return null;

    const cacheKey = `forecast_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const cached = this.cache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < KisanConfig.WEATHER_CACHE_TTL)) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${KisanConfig.WEATHER_BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&cnt=16`
      );
      if (!response.ok) return null;
      const data = await response.json();

      // Summarize by day
      const days = {};
      for (const item of data.list) {
        const date = item.dt_txt.split(' ')[0];
        if (!days[date]) {
          days[date] = { temps: [], humidity: [], descriptions: [], rain: 0 };
        }
        days[date].temps.push(item.main.temp);
        days[date].humidity.push(item.main.humidity);
        days[date].descriptions.push(item.weather[0]?.description);
        days[date].rain += item.rain?.['3h'] || 0;
      }

      const forecast = Object.entries(days).slice(0, 5).map(([date, d]) => ({
        date,
        temp_min: Math.round(Math.min(...d.temps)),
        temp_max: Math.round(Math.max(...d.temps)),
        humidity: Math.round(d.humidity.reduce((a, b) => a + b) / d.humidity.length),
        description: d.descriptions[Math.floor(d.descriptions.length / 2)],
        rain_mm: Math.round(d.rain * 10) / 10
      }));

      this.cache[cacheKey] = { data: forecast, timestamp: Date.now() };
      return forecast;
    } catch (e) {
      console.error('Forecast fetch failed:', e);
      return null;
    }
  },

  // Generate farming advisory based on weather
  getAdvisory(weather, currentCrop, lang = 'en') {
    const advisories = [];

    if (!weather) {
      return [{
        type: 'info',
        text_en: 'Weather data unavailable. Set your OpenWeatherMap API key in settings.',
        text_ur: 'موسمی ڈیٹا دستیاب نہیں۔ سیٹنگز میں OpenWeatherMap API کلید لگائیں۔'
      }];
    }

    // High temperature warning
    if (weather.temp > 42) {
      advisories.push({
        type: 'danger',
        text_en: `⚠️ Extreme heat alert: ${weather.temp}°C! Irrigate crops in early morning or evening. Avoid field work during midday.`,
        text_ur: `⚠️ شدید گرمی کا الرٹ: ${weather.temp}°C! صبح سویرے یا شام کو فصلوں کو پانی دیں۔ دوپہر میں کھیت کا کام نہ کریں۔`
      });
    } else if (weather.temp > 38) {
      advisories.push({
        type: 'warning',
        text_en: `🌡️ Very hot: ${weather.temp}°C. Increase irrigation frequency. Mulching will help conserve moisture.`,
        text_ur: `🌡️ بہت گرمی: ${weather.temp}°C۔ آبپاشی کی تعداد بڑھائیں۔ ملچنگ نمی بچانے میں مدد کرے گی۔`
      });
    }

    // Cold warning for rabi crops
    if (weather.temp < 5) {
      advisories.push({
        type: 'warning',
        text_en: `🥶 Frost risk: ${weather.temp}°C! Irrigate fields lightly to protect crops from frost damage. Cover nurseries.`,
        text_ur: `🥶 پالا کا خطرہ: ${weather.temp}°C! پالے سے فصلوں کو بچانے کے لیے ہلکی آبپاشی کریں۔ نرسریاں ڈھانپیں۔`
      });
    }

    // High humidity + warm = disease risk
    if (weather.humidity > 80 && weather.temp > 25) {
      advisories.push({
        type: 'warning',
        text_en: `🍄 High humidity (${weather.humidity}%) with warm temperature — fungal disease risk is HIGH. Monitor crops for blight and rust.`,
        text_ur: `🍄 زیادہ نمی (${weather.humidity}%) گرم درجہ حرارت کے ساتھ — فنگل بیماری کا خطرہ زیادہ ہے۔ بلائٹ اور زنگ کے لیے فصلوں کی نگرانی کریں۔`
      });
    }

    // Wind warning
    if (weather.wind_speed > 40) {
      advisories.push({
        type: 'danger',
        text_en: `💨 Strong winds: ${weather.wind_speed} km/h! Do NOT spray pesticides. Secure crop supports.`,
        text_ur: `💨 تیز ہوائیں: ${weather.wind_speed} km/h! کیڑے مار ادویات نہ چھڑکیں۔ فصل کے سہاروں کو مضبوط کریں۔`
      });
    } else if (weather.wind_speed > 25) {
      advisories.push({
        type: 'info',
        text_en: `💨 Moderate winds: ${weather.wind_speed} km/h. Avoid spraying — chemicals will drift.`,
        text_ur: `💨 معتدل ہوائیں: ${weather.wind_speed} km/h۔ اسپرے سے بچیں — کیمیکل اُڑ جائیں گے۔`
      });
    }

    // Good weather
    if (advisories.length === 0) {
      advisories.push({
        type: 'good',
        text_en: `✅ Weather is favorable: ${weather.temp}°C, ${weather.humidity}% humidity, ${weather.description}. Good conditions for field work.`,
        text_ur: `✅ موسم سازگار ہے: ${weather.temp}°C، ${weather.humidity}% نمی، ${weather.description}۔ کھیت کے کام کے لیے اچھے حالات۔`
      });
    }

    return advisories;
  },

  // Get weather for a region from data
  async getWeatherForRegion(regionData) {
    if (!regionData || !regionData.lat || !regionData.lon) return null;
    return await this.getWeather(regionData.lat, regionData.lon);
  }
};

window.KisanWeather = KisanWeather;
