// Safe storage fallback for sandboxed environments (like Jupyter/Kaggle iframes)
const safeStorage = {
  _mem: {},
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return this._mem[key] || null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      this._mem[key] = value;
    }
  }
};

// KisanBot Configuration Module
const KisanConfig = {
  // API Keys (stored in safeStorage)
  getWeatherApiKey() {
    return safeStorage.getItem('kisanbot_weather_key') || '';
  },
  setWeatherApiKey(key) {
    safeStorage.setItem('kisanbot_weather_key', key);
  },
  getGeminiApiKey() {
    return safeStorage.getItem('kisanbot_gemini_key') || '';
  },
  setGeminiApiKey(key) {
    safeStorage.setItem('kisanbot_gemini_key', key);
  },

  // Language — default to Urdu-first for the farmer (Section 7)
  getLanguage() {
    return safeStorage.getItem('kisanbot_lang') || 'ur';
  },
  setLanguage(lang) {
    safeStorage.setItem('kisanbot_lang', lang);
  },

  // Default region
  getDefaultProvince() {
    return safeStorage.getItem('kisanbot_province') || '';
  },
  setDefaultProvince(province) {
    safeStorage.setItem('kisanbot_province', province);
  },
  getDefaultDistrict() {
    return safeStorage.getItem('kisanbot_district') || '';
  },
  setDefaultDistrict(district) {
    safeStorage.setItem('kisanbot_district', district);
  },
  // System mode: 'ai' (multi-agent FastAPI backend, primary) or 'local' (offline rules fallback)
  getSystemMode() {
    return safeStorage.getItem('kisanbot_system_mode') || 'ai';
  },
  setSystemMode(mode) {
    safeStorage.setItem('kisanbot_system_mode', mode);
  },
  getBackendUrl() {
    return 'http://localhost:8000';
  },
  // Stable per-device session id so the backend keeps conversation state
  getSessionId() {
    let id = safeStorage.getItem('kisanbot_session_id');
    if (!id) {
      id = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      safeStorage.setItem('kisanbot_session_id', id);
    }
    return id;
  },
  // Feature flags
  isGeminiEnabled() {
    return !!this.getGeminiApiKey();
  },
  isWeatherEnabled() {
    return !!this.getWeatherApiKey();
  },

  // Weather API
  WEATHER_BASE_URL: 'https://api.openweathermap.org/data/2.5',
  WEATHER_CACHE_TTL: 15 * 60 * 1000, // 15 minutes

  // Gemini API
  GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',

  // Current date helpers
  getCurrentMonth() {
    return new Date().getMonth() + 1; // 1-indexed
  },
  getCurrentSeason() {
    const month = this.getCurrentMonth();
    if ([10, 11, 12, 1, 2].includes(month)) return 'rabi';
    if ([5, 6, 7, 8, 9].includes(month)) return 'kharif';
    if ([3, 4].includes(month)) return 'zaid';
    return 'rabi';
  },
  getSeasonName(season, lang = 'en') {
    const names = {
      rabi: { en: 'Rabi (Winter)', ur: 'ربیع (سردیوں کی فصل)' },
      kharif: { en: 'Kharif (Summer)', ur: 'خریف (گرمیوں کی فصل)' },
      zaid: { en: 'Zaid (Spring)', ur: 'زائد (بہار کی فصل)' }
    };
    return names[season]?.[lang] || season;
  },
  getMonthName(month, lang = 'en') {
    const months_en = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const months_ur = ['', 'جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
    return lang === 'ur' ? months_ur[month] : months_en[month];
  }
};

// Make available globally
window.KisanConfig = KisanConfig;
