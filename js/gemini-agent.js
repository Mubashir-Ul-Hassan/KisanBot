// KisanBot Gemini AI Agent — Live intelligent responses for all farming queries
const KisanAgent = {
  cache: {},
  CACHE_TTL: 10 * 60 * 1000, // 10 minutes

  // Core method: Ask Gemini AI a farming question with context
  async ask(intent, context = {}) {
    const apiKey = KisanConfig.getGeminiApiKey();
    if (!apiKey) return null;

    const prompt = this._buildPrompt(intent, context);
    if (!prompt) return null;

    // Check cache
    const cacheKey = `${intent}_${JSON.stringify(context)}`;
    const cached = this.cache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      const response = await fetch(`${KisanConfig.GEMINI_BASE_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1200
          }
        })
      });

      if (!response.ok) {
        console.warn('Gemini API returned status:', response.status);
        return null;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!text) return null;

      // Try to parse structured JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let result;
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[0]);
          result._source = 'gemini_ai';
          result._raw = text;
        } catch (e) {
          // If JSON parse fails, use raw text
          result = { text_en: text, text_ur: '', _source: 'gemini_ai', _raw: text };
        }
      } else {
        result = { text_en: text, text_ur: '', _source: 'gemini_ai', _raw: text };
      }

      // Cache the result
      this.cache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    } catch (e) {
      console.warn('Gemini Agent request failed:', e);
      return null;
    }
  },

  // Build intent-specific prompts
  _buildPrompt(intent, ctx) {
    const month = KisanConfig.getCurrentMonth();
    const monthName = KisanConfig.getMonthName(month);
    const season = KisanConfig.getCurrentSeason();
    const seasonName = KisanConfig.getSeasonName(season);
    const province = ctx.province || 'Punjab';
    const crop = ctx.crop || '';
    const userQuery = ctx.rawText || '';

    const systemContext = `You are KisanBot, an expert Pakistani agricultural advisor. Current date context: ${monthName} (${seasonName} season). Province: ${province}.
IMPORTANT: Respond ONLY as a valid JSON object with the fields specified. Do NOT include any text outside the JSON. Do NOT use markdown code blocks. Use Pakistani context (PKR currency, local varieties, local pest names, maund unit = 40kg).`;

    switch (intent) {
      case 'crop_recommendation':
        return `${systemContext}
The farmer asks: "${userQuery || 'Which crop should I grow this season?'}"
Province: ${province}. Water: ${ctx.water || 'unknown'}. Budget: ${ctx.budget || 'medium'}. Soil: ${ctx.soil || 'unknown'}.

Return a JSON object with this structure:
{
  "text_en": "A 2-3 sentence summary of your recommendation in English",
  "text_ur": "Same summary in Urdu script",
  "crops": [
    {
      "name_en": "Crop name English",
      "name_ur": "Crop name Urdu",
      "score": 85,
      "reason_en": "Why this crop is recommended",
      "reason_ur": "Urdu reason",
      "sowing_window": "When to sow",
      "expected_yield": "Expected yield per acre",
      "varieties": ["Recommended variety names for ${province}"],
      "cost_per_acre_pkr": 50000,
      "profit_potential_en": "Profit estimate",
      "tips_en": "Key growing tip",
      "tips_ur": "Urdu tip"
    }
  ]
}

Recommend top 3-4 crops suitable for ${province} in ${monthName} (${seasonName}). Use real Pakistani crop data.`;

      case 'pest_disease':
        return `${systemContext}
The farmer describes: "${userQuery}"
Crop: ${crop || 'unknown'}.

Return a JSON object:
{
  "text_en": "Brief diagnosis summary in English",
  "text_ur": "Same in Urdu script",
  "diagnosis": [
    {
      "name_en": "Pest/Disease name English",
      "name_ur": "Name in Urdu",
      "type": "pest or disease",
      "confidence": "high/medium/low",
      "symptoms_en": "Key symptoms to look for",
      "symptoms_ur": "Urdu symptoms",
      "organic_remedy_en": "Organic treatment method",
      "organic_remedy_ur": "Urdu organic treatment",
      "chemical_remedy_en": "Chemical treatment with specific product names available in Pakistan",
      "chemical_remedy_ur": "Urdu chemical treatment",
      "prevention_en": "How to prevent next time",
      "prevention_ur": "Urdu prevention"
    }
  ]
}

Provide 1-2 most likely diagnoses based on the description. Use medicines/products available in Pakistan.`;

      case 'fertilizer':
        return `${systemContext}
The farmer asks about fertilizer for: ${crop || 'general crops'}
Province: ${province}. Current month: ${monthName}.

Return a JSON object:
{
  "text_en": "Brief fertilizer advice summary in English",
  "text_ur": "Same in Urdu script",
  "plan": {
    "crop_en": "Crop name",
    "crop_ur": "Urdu name",
    "stages": [
      {
        "stage_en": "Stage name (e.g., At sowing time)",
        "stage_ur": "Urdu stage name",
        "timing_en": "When exactly",
        "fertilizers": [
          {"name": "Fertilizer name", "qty": "Amount per acre", "method_en": "How to apply", "method_ur": "Urdu method"}
        ]
      }
    ],
    "total_cost_pkr": 25000,
    "tips_en": ["Important fertilizer tips"],
    "tips_ur": ["Urdu tips"]
  }
}

Provide a practical per-acre fertilizer plan with quantities in bags (50kg) and current approximate PKR costs.`;

      case 'weather':
        return `${systemContext}
The farmer asks about weather for: ${province}. Query: "${userQuery}"
Month: ${monthName}.

Return a JSON object:
{
  "text_en": "Weather summary and farming advisory for ${province} in ${monthName}",
  "text_ur": "Same in Urdu script",
  "advisory_en": "What farming activities to do/avoid based on typical ${monthName} weather in ${province}",
  "advisory_ur": "Urdu farming advisory",
  "typical_conditions": {
    "temp_range": "Expected temperature range",
    "rainfall": "Expected rainfall",
    "humidity": "Expected humidity"
  }
}

Note: Provide general seasonal weather advisory. For live weather data, the app uses OpenWeatherMap API separately.`;

      case 'market':
        return `${systemContext}
The farmer asks about market prices. Crop: ${crop || 'major crops'}. Province: ${province}.
Query: "${userQuery}"

Return a JSON object:
{
  "text_en": "Market price summary in English",
  "text_ur": "Same in Urdu script",
  "prices": [
    {
      "crop_en": "Crop name",
      "crop_ur": "Urdu name",
      "current_price_pkr_per_maund": "Approximate current range",
      "support_price_pkr": "Government support price if applicable",
      "trend_en": "Price trend (rising/stable/falling)",
      "trend_ur": "Urdu trend",
      "best_selling_months_en": "Best months to sell",
      "nearby_mandis": ["Relevant mandi names in ${province}"]
    }
  ],
  "tips_en": ["Selling strategy tips"],
  "tips_ur": ["Urdu tips"],
  "disclaimer_en": "Prices are approximate. Check your local mandi for exact rates.",
  "disclaimer_ur": "قیمتیں تخمینی ہیں۔ درست ریٹ کے لیے اپنی مقامی منڈی سے رابطہ کریں۔"
}

Provide approximate current market prices in PKR per maund (40kg) for Pakistan. Include government support prices where applicable.`;

      case 'soil':
        return `${systemContext}
The farmer asks about soil. Query: "${userQuery}". Province: ${province}.

Return a JSON object:
{
  "text_en": "Soil information and advice in English",
  "text_ur": "Same in Urdu script",
  "soil_advice_en": "Detailed soil management advice for ${province}",
  "soil_advice_ur": "Urdu soil advice",
  "soil_types_in_region": ["Common soil types in ${province} with descriptions"],
  "improvement_tips_en": ["How to improve soil fertility"],
  "improvement_tips_ur": ["Urdu tips"]
}`;

      case 'season':
        return `${systemContext}
Current month: ${monthName}. Season: ${seasonName}. Province: ${province}.
The farmer asks: "${userQuery || 'What should I do this season?'}"

Return a JSON object:
{
  "text_en": "Seasonal farming guide for ${province} in ${monthName}",
  "text_ur": "Same in Urdu script",
  "current_season_en": "${seasonName}",
  "crops_to_sow": [
    {"name_en": "Crop", "name_ur": "Urdu", "priority": "primary/secondary", "sow_by": "Last sowing date", "notes_en": "Key note", "notes_ur": "Urdu note"}
  ],
  "activities_en": ["Farming activities to do right now"],
  "activities_ur": ["Urdu activities"],
  "upcoming_en": "What to prepare for next month",
  "upcoming_ur": "Urdu upcoming"
}`;

      default:
        return `${systemContext}
The farmer asks: "${userQuery}"

Return a JSON object:
{
  "text_en": "Your helpful response in English",
  "text_ur": "Same response in Urdu script"
}

Answer the farmer's question with practical, actionable advice for Pakistani farming.`;
    }
  },

  // Check if the agent is available (has API key)
  isAvailable() {
    return KisanConfig.isGeminiEnabled();
  }
};

window.KisanAgent = KisanAgent;
