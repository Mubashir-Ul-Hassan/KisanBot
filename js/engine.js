// KisanBot Decision Engine — Pure rule-based recommendations from data
const KisanEngine = {
  data: {},

  // Load all data files
  async loadData() {
    const files = [
      'crop_calendar', 'crop_recommendations', 'soil_data',
      'pest_disease_data', 'fertilizer_data', 'regions', 'market_info'
    ];
    for (const file of files) {
      try {
        const dataKey = file.replace('_data', '');
        if (window.KISAN_DATA && window.KISAN_DATA[dataKey]) {
          this.data[dataKey] = window.KISAN_DATA[dataKey];
        } else {
          const response = await fetch(`data/${file}.json`);
          this.data[dataKey] = await response.json();
        }
      } catch (e) {
        console.error(`Failed to load ${file}.json:`, e);
      }
    }
    // Make data globally accessible for parser
    window.KisanData = this.data;
  },

  // Get current season crops for a region
  getSeasonalCrops(month, province) {
    const season = this._getSeasonForMonth(month);
    const recRules = this.data.crop_recommendations?.recommendation_rules?.by_season_province;
    if (!recRules || !recRules[season] || !recRules[season][province]) {
      return { season, crops: [], notes: '' };
    }

    const regionRec = recRules[season][province];
    const cropDetails = [];

    for (const cropId of [...regionRec.primary, ...regionRec.secondary]) {
      const cropData = this.data.crop_calendar?.crops?.[cropId];
      if (cropData) {
        const isPrimary = regionRec.primary.includes(cropId);
        cropDetails.push({
          id: cropId,
          name_en: cropData.name_en,
          name_ur: cropData.name_ur,
          isPrimary,
          sowing: cropData.sowing_window,
          harvest: cropData.harvest_window,
          duration_days: cropData.duration_days,
          water_req: cropData.water_requirement_mm,
          yield: cropData.expected_yield_maund_per_acre,
          key_notes_en: cropData.key_notes_en,
          key_notes_ur: cropData.key_notes_ur,
          varieties: cropData.varieties?.[province] || []
        });
      }
    }

    return {
      season,
      seasonName: KisanConfig.getSeasonName(season),
      seasonNameUr: KisanConfig.getSeasonName(season, 'ur'),
      province,
      crops: cropDetails,
      notes_en: regionRec.notes_en,
      notes_ur: regionRec.notes_ur,
      source: 'crop_recommendations.json + crop_calendar.json'
    };
  },

  // Score and recommend crops based on multiple factors
  getCropRecommendation(province, soilType, waterAvailability, budget) {
    const month = KisanConfig.getCurrentMonth();
    const season = this._getSeasonForMonth(month);
    const weights = this.data.crop_recommendations?.scoring_weights || {};

    const seasonalCrops = this.getSeasonalCrops(month, province);
    const waterRules = this.data.crop_recommendations?.recommendation_rules?.by_water_availability;
    const budgetRules = this.data.crop_recommendations?.recommendation_rules?.by_budget;
    const soilData = this.data.soil?.soil_types;

    const scored = [];

    for (const crop of seasonalCrops.crops) {
      let score = 0;
      const reasons = [];

      // Season match (always matched since we filter by season)
      score += weights.season_match || 30;
      reasons.push({ en: `✅ Suitable for ${seasonalCrops.seasonName}`, ur: `✅ ${seasonalCrops.seasonNameUr} کے لیے موزوں` });

      // Region match
      if (crop.isPrimary) {
        score += weights.region_match || 25;
        reasons.push({ en: `✅ Primary crop for ${province}`, ur: `✅ ${province} کی بنیادی فصل` });
      } else {
        score += (weights.region_match || 25) * 0.5;
        reasons.push({ en: `⚡ Secondary crop for ${province}`, ur: `⚡ ${province} کی ثانوی فصل` });
      }

      // Soil match
      if (soilType) {
        const cropCalData = this.data.crop_calendar?.crops?.[crop.id];
        if (cropCalData?.suitable_soil?.includes(soilType)) {
          score += weights.soil_match || 20;
          reasons.push({ en: `✅ Good for your soil type`, ur: `✅ آپ کی مٹی کی قسم کے لیے اچھی` });
        } else {
          score -= 10;
          reasons.push({ en: `⚠️ Not ideal for your soil`, ur: `⚠️ آپ کی مٹی کے لیے مثالی نہیں` });
        }
      }

      // Water match
      if (waterAvailability && waterRules?.[waterAvailability]) {
        if (waterRules[waterAvailability].suitable.includes(crop.id)) {
          score += weights.water_match || 15;
          reasons.push({ en: `✅ Matches your irrigation`, ur: `✅ آپ کی آبپاشی سے مطابقت` });
        } else {
          score -= 15;
          reasons.push({ en: `⚠️ May need more water than available`, ur: `⚠️ دستیاب پانی سے زیادہ ضرورت ہو سکتی ہے` });
        }
      }

      // Budget match
      if (budget && budgetRules?.[budget]) {
        if (budgetRules[budget].suitable.includes(crop.id)) {
          score += weights.budget_match || 10;
          reasons.push({ en: `✅ Fits your budget`, ur: `✅ آپ کے بجٹ میں فٹ` });
        }
      }

      scored.push({ ...crop, score, reasons });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return {
      recommendations: scored.slice(0, 5),
      season: seasonalCrops.seasonName,
      province,
      factors: { soilType, waterAvailability, budget },
      source: 'Rule-based scoring from local knowledge base'
    };
  },

  // Get pest/disease advice
  getPestAdvice(cropId, symptomText) {
    const pests = this.data.pest_disease?.pests;
    if (!pests) return null;

    const matches = [];
    const lowerSymptom = (symptomText || '').toLowerCase();

    for (const [id, pest] of Object.entries(pests)) {
      let score = 0;

      // Match by crop
      if (cropId && (pest.crop === cropId || pest.crop === 'general')) {
        score += 5;
      }

      // Match by symptoms
      if (symptomText) {
        const symptomWords = [...pest.symptoms_en.toLowerCase().split(/\s+/), ...pest.symptoms_ur.split(/\s+/)];
        for (const word of symptomWords) {
          if (word.length > 3 && lowerSymptom.includes(word)) score += 1;
        }
      }

      if (score > 0) {
        matches.push({ ...pest, id, matchScore: score });
      }
    }

    matches.sort((a, b) => b.matchScore - a.matchScore);

    return {
      matches: matches.slice(0, 3),
      generalAdvice: this.data.pest_disease?.general_ipm_advice,
      source: 'pest_disease_data.json'
    };
  },

  // Get fertilizer plan for a crop
  getFertilizerPlan(cropId) {
    const plans = this.data.fertilizer?.crop_plans;
    const fertilizers = this.data.fertilizer?.fertilizers;
    const tips = this.data.fertilizer?.general_tips;

    if (!plans || !plans[cropId]) {
      return {
        available: false,
        message_en: `Detailed fertilizer plan for this crop is not available. Follow general recommendations: Apply DAP at sowing and Urea in 2-3 split doses.`,
        message_ur: `اس فصل کا تفصیلی کھاد پلان دستیاب نہیں۔ عام سفارشات پر عمل کریں: بوائی کے وقت DAP اور یوریا 2-3 قسطوں میں لگائیں۔`,
        generalTips: tips,
        source: 'fertilizer_data.json'
      };
    }

    return {
      available: true,
      plan: plans[cropId],
      fertilizers,
      generalTips: tips,
      source: 'fertilizer_data.json'
    };
  },

  // Get market info
  getMarketInfo(cropId, province) {
    const prices = this.data.market_info?.prices;
    const mandis = this.data.market_info?.major_mandis;
    const tips = this.data.market_info?.selling_tips;

    const cropPrice = prices?.[cropId] || null;
    const provinceMandis = mandis?.[province] || [];
    const relevantMandis = provinceMandis.filter(m => !cropId || m.crops.includes(cropId));

    return {
      price: cropPrice,
      mandis: relevantMandis,
      tips,
      source: 'market_info.json',
      note: this.data.market_info?.note
    };
  },

  // Get soil info for a region
  getSoilInfo(soilType) {
    const soilData = this.data.soil?.soil_types?.[soilType];
    const improvement = this.data.soil?.soil_improvement;
    const guide = this.data.soil?.identification_guide;

    return {
      soil: soilData,
      improvement: soilData ? improvement : null,
      guide,
      source: 'soil_data.json'
    };
  },

  // Get region info
  getRegionInfo(province, division) {
    const provData = this.data.regions?.provinces?.[province];
    if (!provData) return null;

    const divData = division ? provData.divisions?.[division] : null;

    return {
      province: provData,
      division: divData,
      agroZones: this.data.regions?.agro_zones,
      source: 'regions.json'
    };
  },

  // Get crop details
  getCropDetails(cropId) {
    const crop = this.data.crop_calendar?.crops?.[cropId];
    if (!crop) return null;
    return { ...crop, id: cropId, source: 'crop_calendar.json' };
  },

  // Helper: determine season for a month
  _getSeasonForMonth(month) {
    if ([10, 11, 12].includes(month)) return 'rabi';
    if ([1, 2].includes(month)) return 'rabi'; // late rabi
    if ([5, 6, 7, 8, 9].includes(month)) return 'kharif';
    if ([3, 4].includes(month)) return 'zaid';
    return 'kharif';
  },

  // Lookup division from district
  lookupDivision(province, district) {
    const provData = this.data.regions?.provinces?.[province];
    if (!provData) return null;

    const distLookup = this.data.regions?.district_lookup?.[district?.toLowerCase()];
    if (distLookup) return distLookup.division;

    return null;
  }
};

window.KisanEngine = KisanEngine;
