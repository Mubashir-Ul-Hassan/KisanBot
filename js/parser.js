// KisanBot Intent Parser — Rule-based + optional Gemini fallback
const KisanParser = {
  // Keyword dictionaries for intent classification (en + ur script + roman urdu)
  keywords: {
    crop_recommendation: {
      en: ['which crop', 'what crop', 'best crop', 'crop advice', 'what to grow', 'what should i grow', 'what to plant', 'what to sow', 'recommend', 'suggestion', 'advice', 'suitable crop', 'profitable crop', 'which seed', 'grow', 'cultivate', 'sow', 'plant'],
      ur: ['کون سی فصل', 'بہترین فصل', 'کیا لگاؤں', 'کیا بوؤں', 'تجویز', 'مشورہ', 'موزوں فصل', 'منافع بخش', 'کون سا بیج', 'فصل کا مشورہ'],
      roman: ['konsi fasal', 'kaunsi fasal', 'fasal lagao', 'fasal lagaon', 'fasal lagayen', 'kya lagaon', 'kya ugaon', 'kya boyon', 'konsa beej', 'kaun sa beej', 'fasal ki tajwiz', 'fasal mashwara', 'best fasal', 'achi fasal', 'munafa fasal', 'fasal advice', 'crop lagao', 'ugao', 'lagao', 'lagaon', 'boyon', 'bojo', 'fasal', 'kashtakari', 'kasht', 'agle mahine', 'aglay mahine', 'is season', 'konsi kasht', 'kya kasht karun', 'hisab sa', 'hisab se']
    },
    pest_disease: {
      en: ['pest', 'disease', 'insect', 'bug', 'worm', 'virus', 'fungus', 'blight', 'rust', 'rot', 'yellowing', 'dying', 'spots', 'holes', 'wilting', 'attack', 'infestation', 'spray', 'pesticide', 'medicine'],
      ur: ['کیڑا', 'بیماری', 'کیڑے', 'وائرس', 'پھپھوندی', 'زنگ', 'گلاؤ', 'پیلا', 'مرنا', 'دھبے', 'سوراخ', 'مرجھانا', 'حملہ', 'سپرے', 'دوائی', 'کیڑے مار'],
      roman: ['keera', 'keere', 'keeray', 'bimari', 'beemari', 'virus', 'phuphundi', 'phaphoond', 'zang', 'galao', 'peela', 'peeli', 'marna', 'mar raha', 'dhabbe', 'surakh', 'murjhana', 'murjha', 'hamla', 'spray', 'dawai', 'dawa', 'keera mar', 'keeray lagay', 'ilaj', 'tibbi', 'kira laga', 'patton pe dhabbe', 'patte peele', 'sundi', 'tela', 'makora']
    },
    fertilizer: {
      en: ['fertilizer', 'urea', 'dap', 'potash', 'manure', 'nutrient', 'feeding', 'npk', 'zinc', 'how much fertilizer', 'when to apply'],
      ur: ['کھاد', 'یوریا', 'ڈی اے پی', 'پوٹاش', 'گوبر', 'غذائیت', 'زنک', 'کتنی کھاد', 'کب لگائیں'],
      roman: ['khad', 'khaad', 'urea', 'dap', 'potash', 'gobar', 'ghizaiyat', 'zinc', 'kitni khad', 'kab lagayen', 'khad kitni', 'khad lagao', 'khad dalo', 'fertilizer kitna', 'khad ka plan', 'khad plan']
    },
    weather: {
      en: ['weather', 'rain', 'temperature', 'forecast', 'climate', 'hot', 'cold', 'monsoon', 'drought', 'flood', 'storm', 'wind'],
      ur: ['موسم', 'بارش', 'درجہ حرارت', 'پیشگوئی', 'آب و ہوا', 'گرمی', 'سردی', 'مانسون', 'خشک سالی', 'سیلاب', 'طوفان', 'ہوا'],
      roman: ['mosam', 'mausam', 'mausim', 'barish', 'baarish', 'garmi', 'garam', 'sardi', 'thand', 'thandi', 'monsoon', 'barsaat', 'sailab', 'toofan', 'hawa', 'dhoop', 'badal', 'weather', 'aaj mosam', 'kal mosam', 'mosam kaisa', 'mosam kesa', 'weather update', 'mosam k hisab', 'mosam ke hisab', 'mosam ki']
    },
    market: {
      en: ['price', 'market', 'sell', 'mandi', 'rate', 'cost', 'profit', 'earning', 'income', 'how much'],
      ur: ['قیمت', 'منڈی', 'بیچنا', 'ریٹ', 'لاگت', 'منافع', 'آمدنی', 'کتنے میں'],
      roman: ['qeemat', 'qimat', 'mandi', 'bechna', 'becho', 'rate', 'daam', 'lagat', 'munafa', 'amdani', 'kitne mein', 'kitnay ka', 'bazaar', 'market', 'bhao', 'bhaw', 'price kya hai', 'rate kya', 'kya rate', 'mandi rate']
    },
    soil: {
      en: ['soil', 'land', 'earth', 'clay', 'sandy', 'loam', 'salt', 'saline', 'soil test', 'soil type'],
      ur: ['مٹی', 'زمین', 'چکنی', 'ریتلی', 'لوم', 'نمکین', 'کلر', 'مٹی ٹیسٹ', 'مٹی کی قسم'],
      roman: ['mitti', 'zameen', 'zamin', 'chikni', 'retli', 'retili', 'namkeen', 'kallar', 'mitti test', 'mitti ki qisam', 'soil type', 'zameen ki qisam', 'mitti kaisi', 'loam mitti']
    },
    season: {
      en: ['season', 'rabi', 'kharif', 'spring', 'winter', 'summer', 'this season', 'current season', 'sowing time', 'when to sow', 'planting time'],
      ur: ['موسم', 'ربیع', 'خریف', 'بہار', 'سردی', 'گرمی', 'اس موسم', 'بوائی کا وقت', 'کب بوئیں', 'لگانے کا وقت'],
      roman: ['season', 'rabi', 'kharif', 'bahar', 'sardi', 'garmi', 'is season', 'is mosam', 'boai ka waqt', 'kab boyen', 'lagane ka waqt', 'kab lagayen', 'konsa season', 'mosam kya hai', 'kaun sa mosam']
    },
    greeting: {
      en: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'salam', 'assalam', 'how are you'],
      ur: ['سلام', 'السلام', 'ہیلو', 'صبح بخیر', 'شام بخیر', 'کیسے ہو', 'خوش آمدید'],
      roman: ['salam', 'assalam', 'assalamu alaikum', 'aslam o alaikum', 'hello', 'hi', 'hey', 'subah bakhair', 'sham bakhair', 'kaise ho', 'kese ho', 'kya haal', 'theek ho', 'adab']
    }
  },

  // Crop name mapping (English + Urdu + common variations)
  cropNames: {
    'wheat': 'wheat', 'gandum': 'wheat', 'گندم': 'wheat',
    'rice': 'rice', 'chawal': 'rice', 'چاول': 'rice', 'dhan': 'rice',
    'cotton': 'cotton', 'kapas': 'cotton', 'کپاس': 'cotton',
    'sugarcane': 'sugarcane', 'ganna': 'sugarcane', 'گنا': 'sugarcane',
    'maize': 'maize', 'corn': 'maize', 'makki': 'maize', 'مکئی': 'maize',
    'gram': 'gram', 'chana': 'gram', 'chickpea': 'gram', 'چنا': 'gram',
    'mustard': 'mustard', 'sarson': 'mustard', 'سرسوں': 'mustard', 'canola': 'mustard',
    'sunflower': 'sunflower', 'suraj mukhi': 'sunflower', 'سورج مکھی': 'sunflower',
    'millet': 'millet', 'bajra': 'millet', 'باجرہ': 'millet',
    'barley': 'barley', 'jau': 'barley', 'جو': 'barley',
    'potato': 'potato', 'aloo': 'potato', 'آلو': 'potato',
    'onion': 'onion', 'pyaz': 'onion', 'پیاز': 'onion',
    'tomato': 'tomato', 'tamatar': 'tomato', 'ٹماٹر': 'tomato',
    'mango': 'mango', 'aam': 'mango', 'آم': 'mango',
    'citrus': 'citrus', 'kinnow': 'citrus', 'kinno': 'citrus', 'کینو': 'citrus',
    'dates': 'dates', 'khajoor': 'dates', 'کھجور': 'dates',
    'groundnut': 'groundnut', 'peanut': 'groundnut', 'moong phali': 'groundnut', 'مونگ پھلی': 'groundnut',
    'lentil': 'lentil', 'masoor': 'lentil', 'مسور': 'lentil',
    'mungbean': 'mungbean', 'moong': 'mungbean', 'مونگ': 'mungbean',
    'sesame': 'sesame', 'til': 'sesame', 'تل': 'sesame',
    'sorghum': 'sorghum', 'jowar': 'sorghum', 'جوار': 'sorghum'
  },

  // Province name mapping
  provinceNames: {
    'punjab': 'punjab', 'پنجاب': 'punjab',
    'sindh': 'sindh', 'sind': 'sindh', 'سندھ': 'sindh',
    'kpk': 'kpk', 'khyber pakhtunkhwa': 'kpk', 'خیبر پختونخوا': 'kpk', 'sarhad': 'kpk', 'صوبہ سرحد': 'kpk',
    'balochistan': 'balochistan', 'baluchistan': 'balochistan', 'بلوچستان': 'balochistan'
  },

  // Parse user input and extract intent + entities
  parse(text) {
    const lower = text.toLowerCase().trim();
    const result = {
      intent: 'unknown',
      confidence: 0,
      crop: null,
      province: null,
      district: null,
      rawText: text,
      entities: {}
    };

    // Detect intent
    let bestIntent = 'unknown';
    let bestScore = 0;

    for (const [intent, langs] of Object.entries(this.keywords)) {
      let score = 0;
      for (const lang of ['en', 'ur', 'roman']) {
        if (!langs[lang]) continue;
        for (const keyword of langs[lang]) {
          if (lower.includes(keyword) || text.includes(keyword)) {
            score += keyword.split(' ').length; // multi-word matches score higher
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    result.intent = bestIntent;
    result.confidence = Math.min(bestScore / 3, 1); // normalize

    // Extract crop name
    for (const [name, cropId] of Object.entries(this.cropNames)) {
      if (lower.includes(name) || text.includes(name)) {
        result.crop = cropId;
        break;
      }
    }

    // Extract province
    for (const [name, provId] of Object.entries(this.provinceNames)) {
      if (lower.includes(name) || text.includes(name)) {
        result.province = provId;
        break;
      }
    }

    // Extract district (will be checked against data)
    if (window.KisanData && window.KisanData.regions) {
      const districtLookup = window.KisanData.regions.district_lookup || {};
      for (const distName of Object.keys(districtLookup)) {
        if (lower.includes(distName)) {
          result.district = distName;
          result.province = districtLookup[distName].province;
          break;
        }
      }
    }

    // If greeting detected, set as greeting
    if (bestIntent === 'greeting') {
      result.intent = 'greeting';
      result.confidence = 1;
    }

    // If still unknown and we have Gemini, try fallback
    if (result.intent === 'unknown' && result.confidence < 0.3) {
      result.needsGemini = true;
    }

    return result;
  },

  // Gemini fallback for complex queries
  async parseWithGemini(text) {
    const apiKey = KisanConfig.getGeminiApiKey();
    if (!apiKey) return null;

    const systemPrompt = `You are an intent parser for a Pakistani farming assistant. 
Given a farmer's query, extract:
1. intent: one of [crop_recommendation, pest_disease, fertilizer, weather, market, soil, season, greeting]
2. crop: the crop mentioned (use English name) or null
3. province: one of [punjab, sindh, kpk, balochistan] or null
4. district: district name or null

IMPORTANT: Return ONLY a JSON object. Do NOT provide any farming advice.
Example: {"intent":"crop_recommendation","crop":null,"province":"punjab","district":"lahore"}`;

    try {
      const response = await fetch(`${KisanConfig.GEMINI_BASE_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: systemPrompt },
              { text: `Parse this farmer query: "${text}"` }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 200
          }
        })
      });

      if (!response.ok) return null;
      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          intent: parsed.intent || 'unknown',
          confidence: 0.7,
          crop: parsed.crop || null,
          province: parsed.province || null,
          district: parsed.district || null,
          rawText: text,
          entities: {},
          source: 'gemini'
        };
      }
    } catch (e) {
      console.warn('Gemini parse failed:', e);
    }
    return null;
  },

  // Detect language of input
  detectLanguage(text) {
    // Check for Urdu characters (Arabic script range)
    const urduPattern = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    if (urduPattern.test(text)) return 'ur';
    return 'en';
  }
};

window.KisanParser = KisanParser;
