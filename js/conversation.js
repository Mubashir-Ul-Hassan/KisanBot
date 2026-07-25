// KisanBot Conversation Manager — Manages interactive Q&A flow
// Hybrid: Gemini AI first → Local rule engine fallback
const KisanConversation = {
  state: {
    province: null,
    district: null,
    division: null,
    soilType: null,
    waterAvailability: null,
    budget: null,
    currentCrop: null,
    intent: null,
    step: 'idle', // idle, asking_province, asking_district, asking_soil, asking_water, asking_budget, answering
    history: []
  },

  reset() {
    const province = KisanConfig.getDefaultProvince() || null;
    const district = KisanConfig.getDefaultDistrict() || null;
    let division = null;
    if (province && district) {
      division = KisanEngine.lookupDivision(province, district);
    }
    this.state = {
      province,
      district,
      division,
      soilType: null,
      waterAvailability: null,
      budget: null,
      currentCrop: null,
      intent: null,
      step: 'idle',
      history: []
    };
  },

  // Process parsed input and determine next action
  async processInput(parsed) {
    // Update state from parsed entities
    if (parsed.province) this.state.province = parsed.province;
    if (parsed.district) {
      this.state.district = parsed.district;
      // Auto-resolve province from district
      if (!this.state.province && window.KisanData?.regions?.district_lookup) {
        const lookup = window.KisanData.regions.district_lookup[parsed.district.toLowerCase()];
        if (lookup) this.state.province = lookup.province;
      }
    }
    if (parsed.crop) this.state.currentCrop = parsed.crop;
    if (parsed.intent !== 'unknown') this.state.intent = parsed.intent;

    // Handle greeting
    if (parsed.intent === 'greeting') {
      return this._greetingResponse();
    }

    // Handle based on intent
    switch (this.state.intent) {
      case 'crop_recommendation':
        return await this._handleCropRecommendation(parsed.rawText);
      case 'pest_disease':
        return await this._handlePestDisease(parsed.rawText);
      case 'fertilizer':
        return await this._handleFertilizer(parsed.rawText);
      case 'weather':
        return await this._handleWeather(parsed.rawText);
      case 'market':
        return await this._handleMarket(parsed.rawText);
      case 'soil':
        return await this._handleSoil(parsed.rawText);
      case 'season':
        return await this._handleSeason(parsed.rawText);
      default:
        // For unknown intents, try Gemini AI directly
        return await this._handleGeneral(parsed.rawText);
    }
  },

  // Process option selection (when user picks from choices)
  processOption(optionType, value) {
    switch (optionType) {
      case 'province':
        this.state.province = value;
        KisanConfig.setDefaultProvince(value);
        break;
      case 'district':
        this.state.district = value;
        KisanConfig.setDefaultDistrict(value);
        this.state.division = KisanEngine.lookupDivision(this.state.province, value);
        break;
      case 'crop':
        this.state.currentCrop = value;
        break;
      case 'soil':
        this.state.soilType = value;
        break;
      case 'water':
        this.state.waterAvailability = value;
        break;
      case 'budget':
        this.state.budget = value;
        break;
    }
  },

  // Build context object for Gemini AI
  _buildContext(rawText) {
    return {
      province: this.state.province || KisanConfig.getDefaultProvince() || 'punjab',
      district: this.state.district || '',
      crop: this.state.currentCrop || '',
      water: this.state.waterAvailability || '',
      budget: this.state.budget || '',
      soil: this.state.soilType || '',
      rawText: rawText || ''
    };
  },

  // CROP RECOMMENDATION FLOW
  async _handleCropRecommendation(rawText) {
    // Step 1: Need province
    if (!this.state.province) {
      return {
        type: 'question',
        text_en: '🗺️ Which province are you in?',
        text_ur: '🗺️ آپ کس صوبے میں ہیں؟',
        options: [
          { value: 'punjab', label_en: 'Punjab (پنجاب)', label_ur: 'پنجاب' },
          { value: 'sindh', label_en: 'Sindh (سندھ)', label_ur: 'سندھ' },
          { value: 'kpk', label_en: 'KPK (خیبر پختونخوا)', label_ur: 'خیبر پختونخوا' },
          { value: 'balochistan', label_en: 'Balochistan (بلوچستان)', label_ur: 'بلوچستان' }
        ],
        optionType: 'province',
        step: 'asking_province'
      };
    }

    // Step 2: Need water availability
    if (!this.state.waterAvailability) {
      return {
        type: 'question',
        text_en: '💧 What is your irrigation source?',
        text_ur: '💧 آپ کی آبپاشی کا ذریعہ کیا ہے؟',
        options: [
          { value: 'canal', label_en: '🏞️ Canal (نہر)', label_ur: 'نہر' },
          { value: 'tubewell', label_en: '🔧 Tube-well (ٹیوب ویل)', label_ur: 'ٹیوب ویل' },
          { value: 'rainfed', label_en: '🌧️ Rainfed/Barani (بارانی)', label_ur: 'بارانی' },
          { value: 'limited', label_en: '🏜️ Limited/Scarce (محدود)', label_ur: 'محدود' }
        ],
        optionType: 'water',
        step: 'asking_water'
      };
    }

    // Step 3: Budget (optional but helpful)
    if (!this.state.budget) {
      return {
        type: 'question',
        text_en: '💰 What is your per-acre budget level?',
        text_ur: '💰 آپ کا فی ایکڑ بجٹ لیول کیا ہے؟',
        options: [
          { value: 'low', label_en: '📉 Low — Minimal investment', label_ur: 'کم — کم سے کم سرمایہ کاری' },
          { value: 'medium', label_en: '📊 Medium — Moderate investment', label_ur: 'درمیانہ — معتدل سرمایہ کاری' },
          { value: 'high', label_en: '📈 High — Maximum investment', label_ur: 'زیادہ — زیادہ سے زیادہ سرمایہ کاری' }
        ],
        optionType: 'budget',
        step: 'asking_budget'
      };
    }

    // All info collected — try Gemini AI first, then fall back to local engine
    const aiResult = await KisanAgent.ask('crop_recommendation', this._buildContext(rawText));

    if (aiResult && aiResult.crops) {
      // AI gave structured crop recommendations
      let weather = null;
      if (this.state.province) {
        const divKey = this.state.division || Object.keys(
          window.KisanData?.regions?.provinces?.[this.state.province]?.divisions || {}
        )[0];
        const divData = window.KisanData?.regions?.provinces?.[this.state.province]?.divisions?.[divKey];
        if (divData) {
          weather = await KisanWeather.getWeatherForRegion(divData);
        }
      }

      return {
        type: 'ai_response',
        intent: 'crop_recommendation',
        aiData: aiResult,
        weather,
        step: 'answering'
      };
    }

    // Fallback: local rule engine
    const result = KisanEngine.getCropRecommendation(
      this.state.province,
      this.state.soilType,
      this.state.waterAvailability,
      this.state.budget
    );

    let weather = null;
    if (this.state.province) {
      const divKey = this.state.division || Object.keys(
        window.KisanData?.regions?.provinces?.[this.state.province]?.divisions || {}
      )[0];
      const divData = window.KisanData?.regions?.provinces?.[this.state.province]?.divisions?.[divKey];
      if (divData) {
        weather = await KisanWeather.getWeatherForRegion(divData);
      }
    }

    return {
      type: 'recommendation',
      data: result,
      weather,
      step: 'answering'
    };
  },

  // PEST/DISEASE FLOW
  async _handlePestDisease(rawText) {
    if (!this.state.currentCrop) {
      return {
        type: 'question',
        text_en: '🌾 Which crop is affected?',
        text_ur: '🌾 کون سی فصل متاثر ہے؟',
        options: [
          { value: 'wheat', label_en: 'Wheat (گندم)', label_ur: 'گندم' },
          { value: 'rice', label_en: 'Rice (چاول)', label_ur: 'چاول' },
          { value: 'cotton', label_en: 'Cotton (کپاس)', label_ur: 'کپاس' },
          { value: 'sugarcane', label_en: 'Sugarcane (گنا)', label_ur: 'گنا' },
          { value: 'maize', label_en: 'Maize (مکئی)', label_ur: 'مکئی' },
          { value: 'potato', label_en: 'Potato (آلو)', label_ur: 'آلو' }
        ],
        optionType: 'crop',
        step: 'asking_crop'
      };
    }

    // Try Gemini AI first
    const aiResult = await KisanAgent.ask('pest_disease', this._buildContext(rawText));

    if (aiResult && (aiResult.diagnosis || aiResult.text_en)) {
      return {
        type: 'ai_response',
        intent: 'pest_disease',
        aiData: aiResult,
        crop: this.state.currentCrop,
        step: 'answering'
      };
    }

    // Fallback: local engine
    const result = KisanEngine.getPestAdvice(this.state.currentCrop, rawText);
    return {
      type: 'pest_advice',
      data: result,
      crop: this.state.currentCrop,
      step: 'answering'
    };
  },

  // FERTILIZER FLOW
  async _handleFertilizer(rawText) {
    if (!this.state.currentCrop) {
      return {
        type: 'question',
        text_en: '🌾 Which crop do you need fertilizer advice for?',
        text_ur: '🌾 کس فصل کے لیے کھاد کا مشورہ چاہیے؟',
        options: [
          { value: 'wheat', label_en: 'Wheat (گندم)', label_ur: 'گندم' },
          { value: 'rice', label_en: 'Rice (چاول)', label_ur: 'چاول' },
          { value: 'cotton', label_en: 'Cotton (کپاس)', label_ur: 'کپاس' },
          { value: 'sugarcane', label_en: 'Sugarcane (گنا)', label_ur: 'گنا' },
          { value: 'maize', label_en: 'Maize (مکئی)', label_ur: 'مکئی' }
        ],
        optionType: 'crop',
        step: 'asking_crop'
      };
    }

    // Try Gemini AI first
    const aiResult = await KisanAgent.ask('fertilizer', this._buildContext(rawText));

    if (aiResult && (aiResult.plan || aiResult.text_en)) {
      return {
        type: 'ai_response',
        intent: 'fertilizer',
        aiData: aiResult,
        crop: this.state.currentCrop,
        step: 'answering'
      };
    }

    // Fallback: local engine
    const result = KisanEngine.getFertilizerPlan(this.state.currentCrop);
    return {
      type: 'fertilizer_plan',
      data: result,
      crop: this.state.currentCrop,
      step: 'answering'
    };
  },

  // WEATHER FLOW
  async _handleWeather(rawText) {
    if (!this.state.province) {
      return {
        type: 'question',
        text_en: '🗺️ Which province do you want weather for?',
        text_ur: '🗺️ کس صوبے کا موسم جاننا ہے؟',
        options: [
          { value: 'punjab', label_en: 'Punjab (پنجاب)', label_ur: 'پنجاب' },
          { value: 'sindh', label_en: 'Sindh (سندھ)', label_ur: 'سندھ' },
          { value: 'kpk', label_en: 'KPK (خیبر پختونخوا)', label_ur: 'خیبر پختونخوا' },
          { value: 'balochistan', label_en: 'Balochistan (بلوچستان)', label_ur: 'بلوچستان' }
        ],
        optionType: 'province',
        step: 'asking_province'
      };
    }

    // Get live weather data from OpenWeatherMap API
    const divKey = this.state.division || Object.keys(
      window.KisanData?.regions?.provinces?.[this.state.province]?.divisions || {}
    )[0];
    const divData = window.KisanData?.regions?.provinces?.[this.state.province]?.divisions?.[divKey];

    const weather = divData ? await KisanWeather.getWeatherForRegion(divData) : null;
    const forecast = divData ? await KisanWeather.getForecast(divData.lat, divData.lon) : null;

    // Also try Gemini AI for farming advisory based on weather
    let aiAdvisory = null;
    if (weather) {
      const weatherContext = this._buildContext(rawText);
      weatherContext.rawText = `Weather is ${weather.temp}°C, humidity ${weather.humidity}%, wind ${weather.wind_speed}km/h, ${weather.description}. ${rawText || 'Give farming advisory.'}`;
      aiAdvisory = await KisanAgent.ask('weather', weatherContext);
    }

    const advisory = KisanWeather.getAdvisory(weather, this.state.currentCrop);

    return {
      type: 'weather_report',
      weather,
      forecast,
      advisory,
      aiAdvisory,
      region: divData?.name_en || this.state.province,
      step: 'answering'
    };
  },

  // MARKET FLOW
  async _handleMarket(rawText) {
    // Try Gemini AI for live market prices
    const aiResult = await KisanAgent.ask('market', this._buildContext(rawText));

    if (aiResult && (aiResult.prices || aiResult.text_en)) {
      // Also include static data as reference baseline
      const staticData = KisanEngine.getMarketInfo(this.state.currentCrop, this.state.province || 'punjab');
      return {
        type: 'ai_response',
        intent: 'market',
        aiData: aiResult,
        staticData,
        crop: this.state.currentCrop,
        step: 'answering'
      };
    }

    // Fallback: static data
    const result = KisanEngine.getMarketInfo(this.state.currentCrop, this.state.province || 'punjab');
    return {
      type: 'market_info',
      data: result,
      crop: this.state.currentCrop,
      step: 'answering'
    };
  },

  // SOIL FLOW
  async _handleSoil(rawText) {
    // Try Gemini AI first
    const aiResult = await KisanAgent.ask('soil', this._buildContext(rawText));

    if (aiResult && aiResult.text_en) {
      return {
        type: 'ai_response',
        intent: 'soil',
        aiData: aiResult,
        step: 'answering'
      };
    }

    // Fallback: local data
    if (this.state.soilType) {
      const result = KisanEngine.getSoilInfo(this.state.soilType);
      return { type: 'soil_info', data: result, step: 'answering' };
    }

    const guide = window.KisanData?.soil?.identification_guide;
    return {
      type: 'soil_guide',
      data: { guide, soilTypes: window.KisanData?.soil?.soil_types },
      step: 'answering'
    };
  },

  // SEASON FLOW
  async _handleSeason(rawText) {
    // Try Gemini AI first
    const aiResult = await KisanAgent.ask('season', this._buildContext(rawText));

    if (aiResult && (aiResult.crops_to_sow || aiResult.text_en)) {
      return {
        type: 'ai_response',
        intent: 'season',
        aiData: aiResult,
        step: 'answering'
      };
    }

    // Fallback: local engine
    const month = KisanConfig.getCurrentMonth();
    const season = KisanConfig.getCurrentSeason();
    const province = this.state.province || 'punjab';
    const result = KisanEngine.getSeasonalCrops(month, province);

    return {
      type: 'season_info',
      data: result,
      month: KisanConfig.getMonthName(month),
      monthUr: KisanConfig.getMonthName(month, 'ur'),
      step: 'answering'
    };
  },

  // GENERAL Q&A — for any question the parser can't classify
  async _handleGeneral(rawText) {
    if (!rawText) return this._defaultResponse();

    // Try Gemini AI
    const aiResult = await KisanAgent.ask('general', this._buildContext(rawText));

    if (aiResult && aiResult.text_en) {
      return {
        type: 'ai_response',
        intent: 'general',
        aiData: aiResult,
        step: 'answering'
      };
    }

    return this._defaultResponse();
  },

  _greetingResponse() {
    const season = KisanConfig.getCurrentSeason();
    const month = KisanConfig.getCurrentMonth();
    const aiStatus = KisanAgent.isAvailable() ? '🟢 AI Agent Active' : '📴 Offline Mode (Local Rules)';
    const aiStatusUr = KisanAgent.isAvailable() ? '🟢 اے آئی ایجنٹ فعال' : '📴 آف لائن موڈ (لوکل رولز)';

    return {
      type: 'greeting',
      text_en: `🌾 Assalam-o-Alaikum! Welcome to KisanBot — your farming assistant.\n\n${aiStatus}\nCurrent season: ${KisanConfig.getSeasonName(season)} (${KisanConfig.getMonthName(month)})\n\nI can help you with:\n• 🌱 Crop recommendations for your region\n• 🐛 Pest & disease identification\n• 🧪 Fertilizer plans\n• 🌤️ Weather updates & farming advisory\n• 💰 Market prices & mandis\n• 🌍 Soil information\n\nAsk me anything or tap the microphone to speak!`,
      text_ur: `🌾 السلام علیکم! کسان بوٹ میں خوش آمدید — آپ کا زرعی معاون۔\n\n${aiStatusUr}\nموجودہ موسم: ${KisanConfig.getSeasonName(season, 'ur')} (${KisanConfig.getMonthName(month, 'ur')})\n\nمیں آپ کی مدد کر سکتا ہوں:\n• 🌱 آپ کے علاقے کے لیے فصل کی سفارشات\n• 🐛 کیڑے اور بیماری کی شناخت\n• 🧪 کھاد کے منصوبے\n• 🌤️ موسم کی تازہ کاری اور زرعی مشاورت\n• 💰 منڈی کی قیمتیں\n• 🌍 مٹی کی معلومات\n\nکچھ بھی پوچھیں یا بولنے کے لیے مائیکروفون دبائیں!`,
      step: 'idle'
    };
  },

  _defaultResponse() {
    return {
      type: 'help',
      text_en: `🤔 I'm not sure what you're asking. You can ask me about:\n\n• "Which crop should I grow this season?" — Crop recommendations\n• "My wheat has yellow spots" — Pest/disease advice\n• "How much urea for rice?" — Fertilizer plans\n• "What's the weather today?" — Weather advisory\n• "What's the price of wheat?" — Market info\n\nTry asking in a different way, or tap one of the quick options below.`,
      text_ur: `🤔 مجھے سمجھ نہیں آیا آپ کیا پوچھ رہے ہیں۔ آپ مجھ سے پوچھ سکتے ہیں:\n\n• "اس موسم کون سی فصل لگاؤں؟" — فصل کی سفارشات\n• "میری گندم میں پیلے دھبے ہیں" — کیڑے/بیماری کا مشورہ\n• "چاول کے لیے کتنی یوریا؟" — کھاد کا منصوبہ\n• "آج موسم کیسا ہے؟" — موسمی مشاورت\n• "گندم کی قیمت کیا ہے؟" — منڈی کی معلومات\n\nدوسرے طریقے سے پوچھیں یا نیچے کوئی تیز آپشن دبائیں۔`,
      step: 'idle'
    };
  }
};

window.KisanConversation = KisanConversation;
