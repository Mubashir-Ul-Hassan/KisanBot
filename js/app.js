// KisanBot Main Application Orchestrator
const KisanApp = {
  // DOM references
  elements: {},

  async init() {
    // Cache DOM elements
    this.elements = {
      chatMessages: document.getElementById('chat-messages'),
      textInput: document.getElementById('text-input'),
      sendBtn: document.getElementById('send-btn'),
      micBtn: document.getElementById('mic-btn'),
      micIcon: document.getElementById('mic-icon'),
      micPulse: document.getElementById('mic-pulse'),
      interimText: document.getElementById('interim-text'),
      settingsBtn: document.getElementById('settings-btn'),
      settingsModal: document.getElementById('settings-modal'),
      settingsClose: document.getElementById('settings-close'),
      weatherKeyInput: document.getElementById('weather-key-input'),
      geminiKeyInput: document.getElementById('gemini-key-input'),
      saveSettingsBtn: document.getElementById('save-settings-btn'),
      langToggle: document.getElementById('lang-toggle'),
      quickBtns: document.getElementById('quick-buttons'),
      typingIndicator: document.getElementById('typing-indicator'),
      voiceStatus: document.getElementById('voice-status'),
      provinceSelect: document.getElementById('province-select'),
      districtSelect: document.getElementById('district-select'),
      dashboardColumn: document.getElementById('dashboard-column'),
      dashboardContent: document.getElementById('dashboard-content'),
      dashboardToggle: document.getElementById('dashboard-toggle'),
      dashboardClose: document.getElementById('dashboard-close'),
      systemModeSelect: document.getElementById('system-mode-select'),
      backendStatusBadge: document.getElementById('backend-status-badge'),
      cameraBtn: document.getElementById('camera-btn'),
      photoInput: document.getElementById('photo-input'),
      photoPreview: document.getElementById('photo-preview'),
      photoPreviewImg: document.getElementById('photo-preview-img'),
      photoCancel: document.getElementById('photo-cancel'),
      helplineBar: document.getElementById('helpline-bar'),
      helplineNumber: document.getElementById('helpline-number')
    };

    // Load data
    this._showTyping();
    await KisanEngine.loadData();
    this._hideTyping();

    // Init voice
    KisanVoice.init();
    KisanVoice.onResult = (text, isFinal) => this._onVoiceResult(text, isFinal);
    KisanVoice.onListeningChange = (listening) => this._onListeningChange(listening);

    // Init conversation
    KisanConversation.reset();

    // Update stats on initial loading
    this._updateDashboardPlaceholder();

    // Set up event listeners
    this._setupEventListeners();

    // Load saved settings
    this._loadSettings();

    // Send greeting
    const greeting = KisanConversation.processInput({ intent: 'greeting', rawText: '' });
    this._renderResponse(await greeting);
  },

  _setupEventListeners() {
    // Send button
    this.elements.sendBtn.addEventListener('click', () => this._sendTextInput());

    // Enter key
    this.elements.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendTextInput();
      }
    });

    // Microphone button
    this.elements.micBtn.addEventListener('click', () => this._toggleMic());

    // Settings
    this.elements.settingsBtn.addEventListener('click', () => this._openSettings());
    this.elements.settingsClose.addEventListener('click', () => this._closeSettings());
    this.elements.saveSettingsBtn.addEventListener('click', () => this._saveSettings());

    // Language toggle
    this.elements.langToggle.addEventListener('click', () => this._toggleLanguage());

    // Quick action buttons
    this.elements.quickBtns.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) this._handleQuickAction(btn.dataset.action);
    });

    // Close modal on backdrop click
    this.elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.elements.settingsModal) this._closeSettings();
    });

    // Province select change
    this.elements.provinceSelect.addEventListener('change', () => this._onProvinceChange());

    // Dashboard toggle & close
    this.elements.dashboardToggle.addEventListener('click', () => this._toggleDashboard());
    this.elements.dashboardClose.addEventListener('click', () => this._closeDashboard());

    // Photo upload flow
    if (this.elements.cameraBtn) {
      this.elements.cameraBtn.addEventListener('click', () => this.elements.photoInput.click());
    }
    if (this.elements.photoInput) {
      this.elements.photoInput.addEventListener('change', (e) => this._onPhotoChosen(e));
    }
    if (this.elements.photoCancel) {
      this.elements.photoCancel.addEventListener('click', () => this._clearPhotoPreview());
    }
  },

  _toggleDashboard() {
    this.elements.dashboardColumn.classList.toggle('dashboard-open');
    this.elements.dashboardToggle.classList.remove('badge');
  },

  _closeDashboard() {
    this.elements.dashboardColumn.classList.remove('dashboard-open');
  },

  _openDashboard() {
    this.elements.dashboardColumn.classList.add('dashboard-open');
    this.elements.dashboardToggle.classList.remove('badge');
  },

  _updateDashboardPlaceholder() {
    const province = KisanConfig.getDefaultProvince();
    const district = KisanConfig.getDefaultDistrict();
    const season = KisanConfig.getSeasonName(KisanConfig.getCurrentSeason(), 'en');
    const seasonUr = KisanConfig.getSeasonName(KisanConfig.getCurrentSeason(), 'ur');
    
    const seasonEl = document.getElementById('quick-season');
    const locationEl = document.getElementById('quick-location');
    
    if (seasonEl) {
      seasonEl.innerHTML = `${season} / ${seasonUr}`;
    }
    if (locationEl) {
      if (province && district) {
        locationEl.textContent = `${district.toUpperCase()} (${province.toUpperCase()})`;
      } else if (province) {
        locationEl.textContent = province.toUpperCase();
      } else {
        locationEl.textContent = 'Not Set / غیر متعین';
      }
    }
  },

  // SEND TEXT INPUT
  async _sendTextInput() {
    const text = this.elements.textInput.value.trim();
    if (!text) return;

    this.elements.textInput.value = '';
    this._addMessage(text, 'user');
    await this._processUserInput(text);
  },

  // PROCESS USER INPUT
  async _processUserInput(text) {
    this._showTyping();

    if (KisanConfig.getSystemMode() === 'ai') {
      const geminiKey = KisanConfig.getGeminiApiKey();
      if (!geminiKey) {
        this._hideTyping();
        this._addMessage(
          "⚠️ Gemini API Key is required for AI Multi-Agent mode. Please set it in Settings (⚙️).",
          "bot",
          "⚠️ اے آئی موڈ کے لیے جیمنی API کلید لازمی ہے۔ براہ کرم سیٹنگز (⚙️) میں درج کریں۔"
        );
        return;
      }

      try {
        const payload = {
          text: text,
          session_id: KisanConfig.getSessionId(),
          state: this._buildBackendState(),
          gemini_key: geminiKey
        };

        const res = await fetch(`${KisanConfig.getBackendUrl()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error('Backend returned error status ' + res.status);
        }

        const data = await res.json();
        this._hideTyping();
        this._renderAgentReply(data);
        return;
      } catch (err) {
        console.warn("FastAPI backend connection failed. Using Gemini NLU + local rules.", err);
        // Don't show confusing "offline" message — silently fall through to
        // Gemini NLU + local rules engine (which works great)
      }
    }

    // Parse intent — first try local keyword matching
    let parsed = KisanParser.parse(text);

    // If confidence is low, try Gemini NLU for smart intent parsing
    if (parsed.needsGemini || (parsed.intent === 'unknown' && KisanConfig.isGeminiEnabled())) {
      const geminiParsed = await KisanParser.parseWithGemini(text);
      if (geminiParsed && geminiParsed.intent !== 'unknown') {
        parsed = geminiParsed;
      }
    }

    // If a new intent is detected (different from current), reset transient state
    if (parsed.intent !== 'unknown' && parsed.intent !== KisanConversation.state.intent) {
      KisanConversation.state.waterAvailability = null;
      KisanConversation.state.budget = null;
      KisanConversation.state.soilType = null;
      if (!parsed.crop) KisanConversation.state.currentCrop = null;
    }

    // Process through conversation manager
    const response = await KisanConversation.processInput(parsed);

    this._hideTyping();
    this._renderResponse(response);

    // Speak the response (always in Urdu as requested)
    const spokenText = response.text_ur || response.text_en;
    if (spokenText && KisanVoice.isTTSSupported()) {
      KisanVoice.speak(spokenText, 'ur');
    }
  },

  // RENDER RESPONSE
  _renderResponse(response) {
    if (!response) return;

    switch (response.type) {
      case 'greeting':
      case 'help':
        this._addMessage(response.text_en, 'bot', response.text_ur);
        break;
      case 'question':
        this._addMessage(response.text_en, 'bot', response.text_ur);
        this._addOptionButtons(response.options, response.optionType);
        break;
      case 'ai_response':
        this._renderAIResponse(response);
        break;
      case 'recommendation':
        this._renderRecommendation(response);
        break;
      case 'pest_advice':
        this._renderPestAdvice(response);
        break;
      case 'fertilizer_plan':
        this._renderFertilizerPlan(response);
        break;
      case 'weather_report':
        this._renderWeatherReport(response);
        break;
      case 'market_info':
        this._renderMarketInfo(response);
        break;
      case 'soil_info':
        this._renderSoilInfo(response);
        break;
      case 'soil_guide':
        this._renderSoilGuide(response);
        break;
      case 'season_info':
        this._renderSeasonInfo(response);
        break;
    }

    this._scrollToBottom();
  },

  // RENDER: AI Agent Response (universal for all intents)
  _renderAIResponse(response) {
    const { intent, aiData, weather, staticData, crop } = response;

    const intentLabels = {
      crop_recommendation: { icon: '🌱', en: 'AI Crop Recommendations', ur: 'اے آئی فصل کی سفارشات' },
      pest_disease: { icon: '🐛', en: 'AI Pest & Disease Diagnosis', ur: 'اے آئی کیڑے اور بیماری کی تشخیص' },
      fertilizer: { icon: '🧪', en: 'AI Fertilizer Plan', ur: 'اے آئی کھاد کا منصوبہ' },
      weather: { icon: '🌤️', en: 'AI Weather Advisory', ur: 'اے آئی موسمی مشاورت' },
      market: { icon: '💰', en: 'AI Market Intelligence', ur: 'اے آئی مارکیٹ انٹیلی جنس' },
      soil: { icon: '🌍', en: 'AI Soil Analysis', ur: 'اے آئی مٹی کا تجزیہ' },
      season: { icon: '📅', en: 'AI Seasonal Guide', ur: 'اے آئی موسمی رہنمائی' },
      general: { icon: '🤖', en: 'AI Advisory', ur: 'اے آئی مشاورت' }
    };

    const label = intentLabels[intent] || intentLabels.general;
    let html = `<div class="response-card ai-card">
      <div class="card-header">${label.icon} ${label.en}</div>
      <div class="card-subheader">${label.ur}</div>
      <div class="ai-badge" style="display:inline-block;padding:3px 10px;background:rgba(59,130,246,0.15);color:#3b82f6;border-radius:20px;font-size:0.72rem;font-weight:600;border:1px solid rgba(59,130,246,0.25);margin-bottom:8px;">🤖 Powered by Gemini AI</div>`;

    // Main text response
    if (aiData.text_en) {
      html += `<div class="ai-text" style="font-size:0.92rem;line-height:1.7;color:var(--text-secondary);white-space:pre-wrap;">${this._escapeHTML(aiData.text_en)}</div>`;
    }
    if (aiData.text_ur) {
      html += `<div class="ai-text ur-text" style="font-size:0.92rem;line-height:2.2;white-space:pre-wrap;">${this._escapeHTML(aiData.text_ur)}</div>`;
    }

    // Intent-specific structured data rendering
    if (intent === 'crop_recommendation' && aiData.crops) {
      for (const crop of aiData.crops) {
        const scoreClass = (crop.score || 0) >= 70 ? 'score-high' : (crop.score || 0) >= 50 ? 'score-med' : 'score-low';
        html += `<div class="crop-card">
          <div class="crop-header">
            <span class="crop-name">${crop.name_en || ''} / ${crop.name_ur || ''}</span>
            ${crop.score ? `<span class="crop-score ${scoreClass}">${crop.score}% match</span>` : ''}
          </div>
          <div class="crop-details">
            ${crop.sowing_window ? `<div class="detail-row"><span class="detail-label">📅 Sowing:</span> ${crop.sowing_window}</div>` : ''}
            ${crop.expected_yield ? `<div class="detail-row"><span class="detail-label">🌾 Yield:</span> ${crop.expected_yield}</div>` : ''}
            ${crop.cost_per_acre_pkr ? `<div class="detail-row"><span class="detail-label">💰 Cost:</span> PKR ${Number(crop.cost_per_acre_pkr).toLocaleString()}/acre</div>` : ''}
            ${crop.profit_potential_en ? `<div class="detail-row"><span class="detail-label">📈 Profit:</span> ${crop.profit_potential_en}</div>` : ''}
          </div>
          ${crop.varieties?.length ? `<div class="detail-row"><span class="detail-label">🏷️ Varieties:</span> ${crop.varieties.join(', ')}</div>` : ''}
          ${crop.reason_en ? `<div class="crop-notes">${crop.reason_en}</div>` : ''}
          ${crop.reason_ur ? `<div class="crop-notes ur-text">${crop.reason_ur}</div>` : ''}
          ${crop.tips_en ? `<div class="crop-notes" style="border-left-color:var(--info);">💡 ${crop.tips_en}</div>` : ''}
          ${crop.tips_ur ? `<div class="crop-notes ur-text" style="border-left-color:var(--info);">💡 ${crop.tips_ur}</div>` : ''}
        </div>`;
      }
    }

    if (intent === 'pest_disease' && aiData.diagnosis) {
      for (const d of aiData.diagnosis) {
        html += `<div class="pest-entry">
          <div class="pest-name">${d.name_en || ''} / ${d.name_ur || ''}</div>
          <div class="pest-type">${d.type === 'pest' ? '🐛 Pest' : '🦠 Disease'} — Confidence: ${d.confidence || 'N/A'}</div>
          ${d.symptoms_en ? `<div class="pest-section"><div class="section-title">🔍 Symptoms</div><p>${d.symptoms_en}</p>${d.symptoms_ur ? `<p class="ur-text">${d.symptoms_ur}</p>` : ''}</div>` : ''}
          ${d.organic_remedy_en ? `<div class="pest-section remedy-organic"><div class="section-title">🌿 Organic Remedy</div><p>${d.organic_remedy_en}</p>${d.organic_remedy_ur ? `<p class="ur-text">${d.organic_remedy_ur}</p>` : ''}</div>` : ''}
          ${d.chemical_remedy_en ? `<div class="pest-section remedy-chemical"><div class="section-title">🧪 Chemical Treatment</div><p>${d.chemical_remedy_en}</p>${d.chemical_remedy_ur ? `<p class="ur-text">${d.chemical_remedy_ur}</p>` : ''}</div>` : ''}
          ${d.prevention_en ? `<div class="pest-section"><div class="section-title">🛡️ Prevention</div><p>${d.prevention_en}</p>${d.prevention_ur ? `<p class="ur-text">${d.prevention_ur}</p>` : ''}</div>` : ''}
        </div>`;
      }
    }

    if (intent === 'fertilizer' && aiData.plan) {
      const plan = aiData.plan;
      if (plan.stages) {
        for (const stage of plan.stages) {
          html += `<div class="fert-stage">
            <div class="stage-name">📅 ${stage.stage_en || stage.timing_en || ''}</div>
            ${stage.stage_ur ? `<div class="stage-name-ur ur-text">${stage.stage_ur}</div>` : ''}
            <div class="fert-items">`;
          if (stage.fertilizers) {
            for (const f of stage.fertilizers) {
              html += `<div class="fert-item">
                <span class="fert-name">${f.name || ''}</span>
                <span class="fert-qty">${f.qty || ''}</span>
                ${f.method_en ? `<span class="fert-note">${f.method_en}</span>` : ''}
              </div>`;
            }
          }
          html += `</div></div>`;
        }
      }
      if (plan.total_cost_pkr) {
        html += `<div class="fert-total"><strong>Estimated Cost:</strong> PKR ${Number(plan.total_cost_pkr).toLocaleString()} per acre</div>`;
      }
      if (plan.tips_en) {
        html += `<div class="general-advice"><div class="section-title">💡 Tips</div><ul>${plan.tips_en.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
      }
    }

    if (intent === 'market' && aiData.prices) {
      html += `<div class="all-prices"><table class="price-table">
        <tr><th>Crop</th><th>Price (PKR/maund)</th><th>Trend</th></tr>`;
      for (const p of aiData.prices) {
        html += `<tr>
          <td>${p.crop_en || ''} ${p.crop_ur || ''}</td>
          <td>${p.current_price_pkr_per_maund || 'N/A'}</td>
          <td>${p.trend_en || ''}</td>
        </tr>`;
      }
      html += `</table></div>`;
      if (aiData.disclaimer_en) {
        html += `<div style="font-size:0.75rem;color:var(--warning);padding:8px;background:rgba(245,158,11,0.08);border-radius:10px;margin-top:8px;">⚠️ ${aiData.disclaimer_en}</div>`;
        if (aiData.disclaimer_ur) {
          html += `<div class="ur-text" style="font-size:0.75rem;color:var(--warning);padding:4px 8px;">⚠️ ${aiData.disclaimer_ur}</div>`;
        }
      }
    }

    if (intent === 'season' && aiData.crops_to_sow) {
      html += `<div class="season-crops">`;
      for (const c of aiData.crops_to_sow) {
        const isPrimary = c.priority === 'primary';
        html += `<div class="season-crop-item ${isPrimary ? 'primary' : 'secondary'}">
          <span class="crop-badge">${isPrimary ? '⭐' : '🔹'}</span>
          <span class="crop-name">${c.name_en || ''} / ${c.name_ur || ''}</span>
          ${c.sow_by ? `<span class="crop-timing">Sow by: ${c.sow_by}</span>` : ''}
        </div>`;
      }
      html += `</div>`;
      if (aiData.activities_en) {
        html += `<div class="general-advice"><div class="section-title">✅ Current Activities</div><ul>${aiData.activities_en.map(a => `<li>${a}</li>`).join('')}</ul></div>`;
      }
    }

    // Weather data if available
    if (weather) {
      const advisories = KisanWeather.getAdvisory(weather);
      html += `<div class="response-card weather-mini" style="margin-top:12px;">
        <div class="card-header">🌤️ Live Weather — ${weather.city || ''}</div>
        <div class="weather-stats" style="display:flex;gap:16px;font-size:0.9rem;">
          <span>🌡️ ${weather.temp}°C</span>
          <span>💧 ${weather.humidity}%</span>
          <span>💨 ${weather.wind_speed} km/h</span>
        </div>
        ${advisories.map(a => `<div class="advisory advisory-${a.type}">${a.text_en}</div><div class="advisory advisory-${a.type} ur-text">${a.text_ur}</div>`).join('')}
      </div>`;
    }

    html += `<div class="data-source">🤖 Source: Gemini AI Agent (Live) + Local Knowledge Base</div></div>`;

    const chatEn = aiData.text_en ? aiData.text_en.substring(0, 200) + (aiData.text_en.length > 200 ? '...' : '') : `${label.en} loaded on the Live Insights panel! ${label.icon}`;
    const chatUr = aiData.text_ur ? aiData.text_ur.substring(0, 200) + (aiData.text_ur.length > 200 ? '...' : '') : `${label.ur} لائیو پینل پر لوڈ ہو گئی! ${label.icon}`;

    this._renderToDashboard(html, chatEn, chatUr);
  },

  // RENDER: Crop Recommendations (local engine fallback)
  _renderRecommendation(response) {
    const { data, weather } = response;
    if (!data || !data.recommendations.length) {
      this._addMessage('No crop recommendations found for your criteria.', 'bot', 'آپ کے معیار کے لیے فصل کی سفارشات نہیں ملیں۔');
      return;
    }

    let html = `<div class="response-card recommendation-card">
      <div class="card-header">🌱 Crop Recommendations — ${data.season}</div>
      <div class="card-subheader">فصل کی سفارشات — ${data.province?.toUpperCase()}</div>`;

    for (const crop of data.recommendations) {
      const scoreClass = crop.score >= 60 ? 'score-high' : crop.score >= 40 ? 'score-med' : 'score-low';
      html += `<div class="crop-card">
        <div class="crop-header">
          <span class="crop-name">${crop.name_en} / ${crop.name_ur}</span>
          <span class="crop-score ${scoreClass}">${Math.round(crop.score)}% match</span>
        </div>
        <div class="crop-details">
          <div class="detail-row"><span class="detail-label">📅 Sowing:</span> ${KisanConfig.getMonthName(crop.sowing.start_month)} – ${KisanConfig.getMonthName(crop.sowing.end_month)}</div>
          <div class="detail-row"><span class="detail-label">🌾 Harvest:</span> ${KisanConfig.getMonthName(crop.harvest.start_month)} – ${KisanConfig.getMonthName(crop.harvest.end_month)}</div>
          <div class="detail-row"><span class="detail-label">💧 Water:</span> ${crop.water_req}mm</div>
          <div class="detail-row"><span class="detail-label">📊 Yield:</span> ${crop.yield.medium} maund/acre (avg)</div>
          ${crop.varieties.length ? `<div class="detail-row"><span class="detail-label">🏷️ Varieties:</span> ${crop.varieties.join(', ')}</div>` : ''}
        </div>
        <div class="crop-notes">${crop.key_notes_en}</div>
        <div class="crop-notes ur-text">${crop.key_notes_ur}</div>
        <div class="crop-reasons">
          ${crop.reasons.map(r => `<span class="reason">${r.en}</span>`).join('')}
        </div>
      </div>`;
    }

    html += `<div class="data-source">📚 Source: Local knowledge base (crop_calendar.json, crop_recommendations.json)</div>`;
    html += `</div>`;

    // Add weather advisory if available
    if (weather) {
      const advisories = KisanWeather.getAdvisory(weather);
      html += `<div class="response-card weather-mini">
        <div class="card-header">🌤️ Current Weather — ${weather.city || data.province}</div>
        <div class="weather-stats">
          <span>🌡️ ${weather.temp}°C</span>
          <span>💧 ${weather.humidity}%</span>
          <span>💨 ${weather.wind_speed} km/h</span>
        </div>
        ${advisories.map(a => `<div class="advisory advisory-${a.type}">${a.text_en}</div><div class="advisory advisory-${a.type} ur-text">${a.text_ur}</div>`).join('')}
      </div>`;
    }

    const provinceName = data.province ? data.province.toUpperCase() : '';
    this._renderToDashboard(
      html,
      `I have generated the Crop Recommendations for ${provinceName} (${data.season}) on the Live Insights panel! 📊`,
      `میں نے لائیو پینل پر ${data.season} کے لیے فصل کی سفارشات تیار کر دی ہیں! 📊`
    );
  },

  // RENDER: Pest Advice
  _renderPestAdvice(response) {
    const { data, crop } = response;
    if (!data || !data.matches.length) {
      this._addMessage(`I don't have specific pest/disease data for that. Try describing the symptoms in more detail.`, 'bot',
        `اس کے لیے میرے پاس مخصوص کیڑے/بیماری کا ڈیٹا نہیں ہے۔ علامات کو مزید تفصیل سے بیان کریں۔`);
      return;
    }

    let html = `<div class="response-card pest-card">
      <div class="card-header">🐛 Pest & Disease Matches</div>`;

    for (const match of data.matches) {
      html += `<div class="pest-entry">
        <div class="pest-name">${match.name_en} / ${match.name_ur}</div>
        <div class="pest-type">${match.type === 'pest' ? '🐛 Pest' : '🦠 Disease'} — Peak: ${match.peak_months.map(m => KisanConfig.getMonthName(m)).join(', ')}</div>
        <div class="pest-section">
          <div class="section-title">🔍 Symptoms</div>
          <p>${match.symptoms_en}</p>
          <p class="ur-text">${match.symptoms_ur}</p>
        </div>
        <div class="pest-section remedy-organic">
          <div class="section-title">🌿 Organic Remedy</div>
          <p>${match.organic_remedy_en}</p>
          <p class="ur-text">${match.organic_remedy_ur}</p>
        </div>
        <div class="pest-section remedy-chemical">
          <div class="section-title">🧪 Chemical Treatment</div>
          <p>${match.chemical_remedy_en}</p>
          <p class="ur-text">${match.chemical_remedy_ur}</p>
        </div>
        <div class="pest-section">
          <div class="section-title">🛡️ Prevention</div>
          <p>${match.prevention_en}</p>
          <p class="ur-text">${match.prevention_ur}</p>
        </div>
      </div>`;
    }

    if (data.generalAdvice) {
      html += `<div class="general-advice">
        <div class="section-title">📋 General IPM Advice</div>
        <p>${data.generalAdvice.en}</p>
        <p class="ur-text">${data.generalAdvice.ur}</p>
      </div>`;
    }

    html += `<div class="data-source">📚 Source: pest_disease_data.json</div></div>`;
    
    const cropName = crop ? crop.toUpperCase() : 'your crop';
    const cropNameUr = crop ? (window.KisanData?.crop_calendar?.crops?.[crop]?.name_ur || 'آپ کی فصل') : 'آپ کی فصل';
    this._renderToDashboard(
      html,
      `I have loaded the Pest & Disease management guidelines for ${cropName} on the Live Insights panel! 🐛`,
      `میں نے لائیو پینل پر ${cropNameUr} کے لیے کیڑوں اور بیماریوں سے بچاؤ کی ہدایات لوڈ کر دی ہیں! 🐛`
    );
  },

  // RENDER: Fertilizer Plan
  _renderFertilizerPlan(response) {
    const { data, crop } = response;
    if (!data.available) {
      this._addMessage(data.message_en, 'bot', data.message_ur);
      return;
    }

    const plan = data.plan;
    let html = `<div class="response-card fertilizer-card">
      <div class="card-header">🧪 ${plan.name_en}</div>
      <div class="card-subheader">${plan.name_ur}</div>`;

    for (const [stage, info] of Object.entries(plan.per_acre)) {
      html += `<div class="fert-stage">
        <div class="stage-name">📅 ${info.timing_en}</div>
        <div class="stage-name-ur ur-text">${info.timing_ur}</div>
        <div class="fert-items">`;

      for (const fert of info.fertilizers) {
        const qty = fert.qty_bags ? `${fert.qty_bags} bag(s)` : fert.qty_tons ? `${fert.qty_tons} ton(s)` : '';
        html += `<div class="fert-item">
          <span class="fert-name">${fert.name}</span>
          <span class="fert-qty">${qty}</span>
          <span class="fert-note">${fert.notes_en}</span>
        </div>`;
      }

      html += `</div></div>`;
    }

    // Total
    if (plan.total_per_acre) {
      html += `<div class="fert-total"><strong>Total per Acre:</strong> `;
      const parts = [];
      if (plan.total_per_acre.urea_bags) parts.push(`Urea: ${plan.total_per_acre.urea_bags} bags`);
      if (plan.total_per_acre.dap_bags) parts.push(`DAP: ${plan.total_per_acre.dap_bags} bags`);
      if (plan.total_per_acre.sop_bags) parts.push(`SOP: ${plan.total_per_acre.sop_bags} bags`);
      if (plan.total_per_acre.zinc_bags) parts.push(`Zinc: ${plan.total_per_acre.zinc_bags} bags`);
      if (plan.total_per_acre.fym_tons) parts.push(`FYM: ${plan.total_per_acre.fym_tons} tons`);
      html += parts.join(' | ');
      html += `</div>`;
    }

    // Tips
    if (data.generalTips) {
      html += `<div class="general-advice">
        <div class="section-title">💡 Tips</div>
        <ul>${data.generalTips.en.map(t => `<li>${t}</li>`).join('')}</ul>
      </div>`;
    }

    html += `<div class="data-source">📚 Source: fertilizer_data.json</div></div>`;
    
    const cropName = crop ? crop.toUpperCase() : 'your crop';
    const cropNameUr = crop ? (window.KisanData?.crop_calendar?.crops?.[crop]?.name_ur || 'آپ کی فصل') : 'آپ کی فصل';
    this._renderToDashboard(
      html,
      `I have loaded the per-acre Fertilizer Application Plan for ${cropName} on the Live Insights panel! 🧪`,
      `میں نے لائیو پینل پر ${cropNameUr} کے لیے کھاد کا تفصیلی منصوبہ لوڈ کر دیا ہے! 🧪`
    );
  },

  // RENDER: Weather Report
  _renderWeatherReport(response) {
    const { weather, forecast, advisory, region } = response;

    if (!weather) {
      this._addMessage('⚠️ Weather data unavailable. Please set your OpenWeatherMap API key in Settings (⚙️ icon).', 'bot',
        '⚠️ موسمی ڈیٹا دستیاب نہیں۔ براہ کرم سیٹنگز (⚙️) میں OpenWeatherMap API کلید لگائیں۔');
      return;
    }

    let html = `<div class="response-card weather-card">
      <div class="card-header">🌤️ Weather Report — ${region}</div>
      <div class="weather-current">
        <div class="weather-temp">${weather.temp}°C</div>
        <div class="weather-desc">${weather.description}</div>
        <div class="weather-details">
          <div class="weather-detail-item">Humidity<span class="weather-detail-val">${weather.humidity}%</span></div>
          <div class="weather-detail-item">Wind<span class="weather-detail-val">${weather.wind_speed} km/h</span></div>
          <div class="weather-detail-item">Clouds<span class="weather-detail-val">${weather.clouds}%</span></div>
        </div>
      </div>`;

    // Forecast
    if (forecast && forecast.length) {
      html += `<div class="forecast-section"><div class="section-title">📅 5-Day Forecast</div><div class="forecast-grid">`;
      for (const day of forecast) {
        html += `<div class="forecast-day">
          <div class="forecast-date">${day.date.split('-').slice(1).join('/')}</div>
          <div class="forecast-temp">${day.temp_min}° - ${day.temp_max}°</div>
          <div class="forecast-desc">${day.description}</div>
          ${day.rain_mm > 0 ? `<div class="forecast-rain">🌧️ ${day.rain_mm}mm</div>` : ''}
        </div>`;
      }
      html += `</div></div>`;
    }

    // Advisories
    if (advisory && advisory.length) {
      html += `<div class="advisory-section"><div class="section-title">🌾 Farming Advisory</div>`;
      for (const a of advisory) {
        html += `<div class="advisory advisory-${a.type}">${a.text_en}</div>`;
        html += `<div class="advisory advisory-${a.type} ur-text">${a.text_ur}</div>`;
      }
      html += `</div>`;
    }

    html += `<div class="data-source">📚 Source: OpenWeatherMap API (live data)</div></div>`;
    
    this._renderToDashboard(
      html,
      `I have loaded the Weather Report and Farming Advisory for ${region} on the Live Insights panel! 🌤️`,
      `میں نے لائیو پینل پر ${region} کے لیے موسم کی رپورٹ اور زرعی مشورہ لوڈ کر دیا ہے! 🌤️`
    );
  },

  // RENDER: Market Info
  _renderMarketInfo(response) {
    const { data } = response;
    let html = `<div class="response-card market-card">
      <div class="card-header">💰 Market Information</div>`;

    if (data.price) {
      const p = data.price;
      html += `<div class="price-card">
        <div class="price-crop">${p.name_en} / ${p.name_ur}</div>
        <div class="price-range">PKR ${p.market_range_pkr.min.toLocaleString()} – ${p.market_range_pkr.max.toLocaleString()} per ${p.unit}</div>
        ${p.support_price_pkr > 0 ? `<div class="support-price">Government Support Price: PKR ${p.support_price_pkr.toLocaleString()}</div>` : ''}
        <div class="peak-months">📈 Best selling months: ${p.peak_price_months.map(m => KisanConfig.getMonthName(m)).join(', ')}</div>
      </div>`;
    } else {
      // Show all prices
      const prices = window.KisanData?.market_info?.prices || {};
      html += `<div class="all-prices"><table class="price-table">
        <tr><th>Crop</th><th>Price Range (PKR/maund)</th><th>Best Months</th></tr>`;
      for (const [id, p] of Object.entries(prices)) {
        html += `<tr>
          <td>${p.name_en} ${p.name_ur}</td>
          <td>${p.market_range_pkr.min.toLocaleString()} – ${p.market_range_pkr.max.toLocaleString()}</td>
          <td>${p.peak_price_months.map(m => KisanConfig.getMonthName(m).substring(0, 3)).join(', ')}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    if (data.mandis && data.mandis.length) {
      html += `<div class="mandi-section"><div class="section-title">🏪 Nearby Mandis</div>`;
      for (const m of data.mandis) {
        html += `<div class="mandi-item">${m.name} (${m.name_ur}) — ${m.district}</div>`;
      }
      html += `</div>`;
    }

    if (data.tips) {
      html += `<div class="general-advice"><div class="section-title">💡 Selling Tips</div>
        <ul>${data.tips.en.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
    }

    html += `<div class="data-source">📚 Source: market_info.json (approximate prices)</div></div>`;
    
    const cropName = data.crop ? data.crop.toUpperCase() : 'major crops';
    this._renderToDashboard(
      html,
      `I have loaded the latest crop Market Prices and Mandis for ${cropName} on the Live Insights panel! 💰`,
      `میں نے لائیو پینل پر مارکیٹ ریٹ اور قریبی غلہ منڈیوں کی معلومات لوڈ کر دی ہیں! 💰`
    );
  },

  // RENDER: Soil Info
  _renderSoilInfo(response) {
    const { data } = response;
    if (!data.soil) {
      this._addMessage('Soil type not found in database.', 'bot');
      return;
    }
    const s = data.soil;
    let html = `<div class="response-card soil-card">
      <div class="card-header">🌍 ${s.name_en} / ${s.name_ur}</div>
      <p>${s.description_en}</p>
      <p class="ur-text">${s.description_ur}</p>
      <div class="soil-details">
        <div class="detail-row"><span class="detail-label">pH Range:</span> ${s.ph_range.min} – ${s.ph_range.max}</div>
        <div class="detail-row"><span class="detail-label">Fertility:</span> ${s.fertility}</div>
        <div class="detail-row"><span class="detail-label">Drainage:</span> ${s.drainage}</div>
        <div class="detail-row"><span class="detail-label">Suitable Crops:</span> ${s.suitable_crops.join(', ')}</div>
      </div>
      <div class="data-source">📚 Source: soil_data.json</div>
    </div>`;
    
    this._renderToDashboard(
      html,
      `I have loaded the Soil properties and suitability guidelines for ${s.name_en} on the Live Insights panel! 🌍`,
      `میں نے لائیو پینل پر مٹی کے تجزیے کی تفصیلی رپورٹ لوڈ کر دی ہے! 🌍`
    );
  },

  // RENDER: Soil Guide
  _renderSoilGuide(response) {
    const guide = response.data?.guide;
    if (!guide) return;
    this._addMessage(guide.how_to_identify_en, 'bot', guide.how_to_identify_ur);
  },

  // RENDER: Season Info
  _renderSeasonInfo(response) {
    const { data, month, monthUr } = response;
    let html = `<div class="response-card season-card">
      <div class="card-header">📅 Current Season: ${data.seasonName}</div>
      <div class="card-subheader">موجودہ موسم: ${data.seasonNameUr} — ${monthUr}</div>`;

    if (data.crops.length) {
      html += `<div class="season-crops">`;
      for (const crop of data.crops) {
        html += `<div class="season-crop-item ${crop.isPrimary ? 'primary' : 'secondary'}">
          <span class="crop-badge">${crop.isPrimary ? '⭐' : '🔹'}</span>
          <span class="crop-name">${crop.name_en} / ${crop.name_ur}</span>
          <span class="crop-timing">Sow: ${KisanConfig.getMonthName(crop.sowing.optimal_month)}</span>
        </div>`;
      }
      html += `</div>`;
      html += `<div class="season-note">${data.notes_en}</div>`;
      html += `<div class="season-note ur-text">${data.notes_ur}</div>`;
    }

    html += `<div class="data-source">📚 Source: crop_recommendations.json</div></div>`;
    
    this._renderToDashboard(
      html,
      `I have loaded Sowing & Harvesting schedules for the current season (${data.seasonName}) on the Live Insights panel! 📅`,
      `میں نے لائیو پینل پر موجودہ فصلوں کے سیزن (${data.seasonNameUr}) کا کیلنڈر لوڈ کر دیا ہے! 📅`
    );
  },

  // RENDER DYNAMIC DASHBOARD HELPER
  _renderToDashboard(html, chatTextEn, chatTextUr) {
    if (this.elements.dashboardContent) {
      this.elements.dashboardContent.innerHTML = html;
    }
    
    // Automatically trigger mobile drawer slide-in or visual indication
    this._openDashboard();
    
    // Add text bubble notification to chat area
    this._addMessage(chatTextEn, 'bot', chatTextUr);
  },

  // ADD MESSAGE BUBBLE
  _addMessage(text, sender, urText = '') {
    const bubble = document.createElement('div');
    bubble.className = `message ${sender}-message`;

    let content = `<div class="message-text">${this._escapeHTML(text).replace(/\n/g, '<br>')}</div>`;
    if (urText) {
      content += `<div class="message-text ur-text">${this._escapeHTML(urText).replace(/\n/g, '<br>')}</div>`;
    }
    content += `<div class="message-time">${new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}</div>`;

    bubble.innerHTML = content;
    this.elements.chatMessages.appendChild(bubble);
    this._scrollToBottom();
  },

  // ADD RAW HTML (for cards)
  _addRawHTML(html, sender) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${sender}-message`;
    wrapper.innerHTML = html;
    this.elements.chatMessages.appendChild(wrapper);
    this._scrollToBottom();
  },

  // ADD OPTION BUTTONS
  _addOptionButtons(options, optionType) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message bot-message option-buttons-wrapper';

    let html = '<div class="option-buttons">';
    for (const opt of options) {
      html += `<button class="option-btn" data-type="${optionType}" data-value="${opt.value}">
        <span class="option-label-en">${opt.label_en}</span>
        <span class="option-label-ur ur-text">${opt.label_ur}</span>
      </button>`;
    }
    html += '</div>';
    wrapper.innerHTML = html;

    // Add click handlers
    wrapper.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const value = btn.dataset.value;

        // Show user selection
        this._addMessage(btn.querySelector('.option-label-en').textContent, 'user');

        // Process selection
        KisanConversation.processOption(type, value);

        // Disable buttons
        wrapper.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

        // Continue conversation
        this._continueConversation();
      });
    });

    this.elements.chatMessages.appendChild(wrapper);
    this._scrollToBottom();
  },

  // Continue the conversation after option selection
  async _continueConversation() {
    this._showTyping();
    // Use a minimal parsed object — state is already updated from processOption
    const response = await KisanConversation.processInput({
      intent: KisanConversation.state.intent,
      confidence: 1,
      rawText: '',
      province: KisanConversation.state.province,
      district: KisanConversation.state.district,
      crop: KisanConversation.state.currentCrop
    });
    this._hideTyping();
    this._renderResponse(response);

    // Speak summary of the response (always in Urdu as requested)
    if (response.type !== 'question') {
      const summary = this._getResponseSummary(response);
      if (summary && KisanVoice.isTTSSupported()) {
        KisanVoice.speak(summary, 'ur');
      }
    }
  },

  // Get a short spoken summary of a response (in Urdu)
  _getResponseSummary(response) {
    switch (response.type) {
      case 'recommendation':
        if (response.data?.recommendations?.length) {
          const top = response.data.recommendations[0];
          return `آپ کے لیے سب سے بہترین فصل: ${top.name_ur || top.name_en} ہے، جس کا میچ اسکور ${Math.round(top.score)} فیصد ہے۔`;
        }
        return null;
      case 'season_info':
        if (response.data?.crops?.length) {
          const names = response.data.crops.filter(c => c.isPrimary).map(c => c.name_ur || c.name_en).slice(0, 3);
          return `موجودہ سیزن: ${response.data.seasonNameUr || response.data.seasonName} ہے۔ اس موسم کی اہم فصلیں: ${names.join('، ')} ہیں۔`;
        }
        return null;
      default:
        return null;
    }
  },

  // VOICE HANDLING
  _toggleMic() {
    if (KisanVoice.isListening) {
      KisanVoice.stopListening();
    } else {
      // Try Urdu first, fall back to English
      const lang = KisanConfig.getLanguage() === 'ur' ? 'ur-PK' : 'en-US';
      KisanVoice.startListening(lang);
    }
  },

  _onVoiceResult(text, isFinal) {
    if (this.elements.interimText) {
      this.elements.interimText.textContent = text;
      this.elements.interimText.style.display = text ? 'block' : 'none';
    }

    if (isFinal && text.trim()) {
      if (this.elements.interimText) {
        this.elements.interimText.style.display = 'none';
      }
      this._addMessage(text, 'user');
      this._processUserInput(text);
    }
  },

  _onListeningChange(listening) {
    const micBtn = this.elements.micBtn;
    const pulse = this.elements.micPulse;

    if (listening) {
      micBtn.classList.add('listening');
      if (pulse) pulse.style.display = 'block';
      if (this.elements.voiceStatus) this.elements.voiceStatus.textContent = '🎤 Listening...';
    } else {
      micBtn.classList.remove('listening');
      if (pulse) pulse.style.display = 'none';
      if (this.elements.voiceStatus) this.elements.voiceStatus.textContent = '';
    }
  },

  // QUICK ACTIONS
  async _handleQuickAction(action) {
    // Urdu-first prompts; these are sent as if the farmer typed them, so they go
    // through the same path as normal input (multi-agent backend in AI mode,
    // local rules as offline fallback).
    const labels = {
      'crop': 'میں اس موسم کون سی فصل لگاؤں؟',
      'pest': 'میری فصل پر کیڑا یا بیماری لگ گئی ہے',
      'weather': 'آج موسم کیسا ہے؟',
      'market': 'فصل کی منڈی میں کیا قیمت ہے؟'
    };

    const text = labels[action] || action;
    this._addMessage(text, 'user');
    await this._processUserInput(text);
  },

  // Build the state snapshot the backend orchestrator expects
  _buildBackendState() {
    const s = KisanConversation.state;
    return {
      province: s.province,
      district: s.district,
      place: s.district || s.province,
      crop: s.currentCrop,
      growth_stage: s.growthStage || null,
      water_availability: s.waterAvailability,
      land_size_acres: s.landSizeAcres || null,
      symptoms: s.symptoms || null
    };
  },

  // Sync backend's returned public state back into the conversation state
  _syncBackendState(state) {
    if (!state) return;
    const s = KisanConversation.state;
    s.province = state.province || s.province;
    s.district = state.district || s.district;
    s.currentCrop = state.crop || s.currentCrop;
    s.waterAvailability = state.water_availability || s.waterAvailability;
    if (state.symptoms) s.symptoms = state.symptoms;
    if (state.growth_stage) s.growthStage = state.growth_stage;
  },

  // Render a reply from the multi-agent backend (chat + dashboard + safety blocks)
  _renderAgentReply(data) {
    this._syncBackendState(data.state);
    if (data.helpline) this._updateHelpline(data.helpline);

    // Extra farmer-facing safety blocks appended to the Urdu message
    let extras = '';
    if (data.disclaimer && data.disclaimer.ur) {
      extras += `<div class="kb-disclaimer">⚠️ ${this._escapeHTML(data.disclaimer.ur)}</div>`;
    }
    if (data.needs_human) {
      const hp = data.helpline || {};
      const num = hp.phone ? ` (${this._escapeHTML(hp.phone)})` : '';
      extras += `<div class="kb-needs-human">👨‍🌾 اگر یقین نہ ہو تو اپنے قریبی زرعی دفتر یا ہیلپ لائن${num} سے تصدیق کریں۔</div>`;
    }

    if (data.dashboard_html) {
      this._renderToDashboard(data.dashboard_html, data.text_en, data.text_ur);
    } else {
      this._addMessage(data.text_en, 'bot', data.text_ur);
    }
    if (extras) this._addRawHTML(`<div class="message-text">${extras}</div>`, 'bot');

    const spokenText = data.text_ur || data.text_en;
    if (spokenText && KisanVoice.isTTSSupported()) {
      KisanVoice.speak(spokenText, 'ur');
    }
  },

  _updateHelpline(hp) {
    if (!this.elements.helplineNumber) return;
    if (hp.phone) this.elements.helplineNumber.textContent = hp.phone;
    if (this.elements.helplineBar && hp.phone) {
      this.elements.helplineBar.href = `tel:${hp.phone.replace(/[^0-9+]/g, '')}`;
    }
  },

  // PHOTO UPLOAD FLOW
  _onPhotoChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Show a preview so the farmer can confirm before sending
      if (this.elements.photoPreviewImg) this.elements.photoPreviewImg.src = reader.result;
      if (this.elements.photoPreview) this.elements.photoPreview.style.display = 'flex';
      this._sendPhoto(reader.result, file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // allow re-selecting the same file
  },

  _clearPhotoPreview() {
    if (this.elements.photoPreview) this.elements.photoPreview.style.display = 'none';
    if (this.elements.photoPreviewImg) this.elements.photoPreviewImg.src = '';
  },

  async _sendPhoto(dataUrl, mimeType) {
    this._addMessage('📷 (تصویر بھیجی گئی)', 'user');

    const geminiKey = KisanConfig.getGeminiApiKey();
    if (!geminiKey) {
      this._addMessage('', 'bot',
        'تصویر سے تشخیص کے لیے اے آئی موڈ درکار ہے۔ براہ کرم سیٹنگز (⚙️) میں Gemini کلید درج کریں۔');
      return;
    }

    const base64 = dataUrl.split(',')[1] || '';
    this._showTyping();
    try {
      const res = await fetch(`${KisanConfig.getBackendUrl()}/api/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64,
          mime_type: mimeType,
          session_id: KisanConfig.getSessionId(),
          state: this._buildBackendState(),
          gemini_key: geminiKey
        })
      });
      if (!res.ok) throw new Error('diagnose status ' + res.status);
      const data = await res.json();
      this._hideTyping();
      this._renderAgentReply(data);
    } catch (err) {
      console.warn('Photo diagnosis failed:', err);
      this._hideTyping();
      this._addMessage('', 'bot',
        'معذرت، تصویر کی جانچ نہیں ہو سکی۔ براہ کرم انٹرنیٹ چیک کریں یا دوبارہ کوشش کریں۔ ' +
        'یقینی بنائیں کہ اے آئی سرور چل رہا ہے۔');
    } finally {
      this._clearPhotoPreview();
    }
  },

  // SETTINGS
  _openSettings() {
    this.elements.settingsModal.style.display = 'flex';
    this.elements.weatherKeyInput.value = KisanConfig.getWeatherApiKey();
    this.elements.geminiKeyInput.value = KisanConfig.getGeminiApiKey();

    // Load location settings
    const defaultProvince = KisanConfig.getDefaultProvince();
    const defaultDistrict = KisanConfig.getDefaultDistrict();

    this.elements.provinceSelect.value = defaultProvince;
    this._onProvinceChange(defaultDistrict);

    if (this.elements.systemModeSelect) {
      this.elements.systemModeSelect.value = KisanConfig.getSystemMode();
    }
    this._checkBackendStatus();
  },

  _closeSettings() {
    this.elements.settingsModal.style.display = 'none';
  },

  _saveSettings() {
    KisanConfig.setWeatherApiKey(this.elements.weatherKeyInput.value.trim());
    KisanConfig.setGeminiApiKey(this.elements.geminiKeyInput.value.trim());

    // Save system mode
    if (this.elements.systemModeSelect) {
      KisanConfig.setSystemMode(this.elements.systemModeSelect.value);
    }

    // Save location settings
    const province = this.elements.provinceSelect.value;
    const district = this.elements.districtSelect.value;

    KisanConfig.setDefaultProvince(province);
    KisanConfig.setDefaultDistrict(district);

    // Update active conversation state immediately
    KisanConversation.state.province = province || null;
    KisanConversation.state.district = district || null;
    if (province && district) {
      KisanConversation.state.division = KisanEngine.lookupDivision(province, district);
    } else {
      KisanConversation.state.division = null;
    }

    this._closeSettings();
    this._updateDashboardPlaceholder();
    this._checkBackendStatus();
    this._addMessage('✅ Settings saved!', 'bot', '✅ سیٹنگز محفوظ ہو گئیں!');
  },

  _onProvinceChange(selectedDistrict = '') {
    const province = this.elements.provinceSelect.value;
    const districtSelect = this.elements.districtSelect;

    // Clear current options except the first one
    districtSelect.innerHTML = '<option value="">-- Select District / ضلع منتخب کریں --</option>';

    if (!province || !window.KisanData?.regions?.provinces?.[province]) return;

    const provData = window.KisanData.regions.provinces[province];
    const districts = [];

    // Gather all districts for this province
    for (const [divKey, divData] of Object.entries(provData.divisions || {})) {
      if (divData.districts) {
        districts.push(...divData.districts);
      }
    }

    // Sort districts alphabetically
    districts.sort();

    // Add options to select dropdown
    for (const dist of districts) {
      const option = document.createElement('option');
      option.value = dist.toLowerCase();
      option.textContent = dist;
      if (dist.toLowerCase() === selectedDistrict.toLowerCase()) {
        option.selected = true;
      }
      districtSelect.appendChild(option);
    }
  },

  _loadSettings() {
    // Set initial toggle labels based on config
    const current = KisanConfig.getLanguage();
    const labels = { en: 'EN', ur: 'اردو', both: 'EN/اردو' };
    if (this.elements.langToggle) {
      this.elements.langToggle.textContent = labels[current] || 'EN/اردو';
    }
    document.body.classList.toggle('hide-urdu', current === 'en');
    document.body.classList.toggle('hide-english', current === 'ur');

    if (this.elements.systemModeSelect) {
      this.elements.systemModeSelect.value = KisanConfig.getSystemMode();
    }

    // Run connection status check
    this._checkBackendStatus();
  },

  async _checkBackendStatus() {
    const badge = this.elements.backendStatusBadge;
    if (!badge) return;

    const mode = KisanConfig.getSystemMode();
    const hasGemini = KisanConfig.isGeminiEnabled();
    const hasWeather = KisanConfig.isWeatherEnabled();

    if (mode === 'ai') {
      // AI mode: first try the Python backend, then check Gemini API key
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${KisanConfig.getBackendUrl()}/api/health`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          badge.textContent = "AI Brain: Connected ✓";
          badge.style.background = "rgba(16, 185, 129, 0.15)";
          badge.style.color = "#10b981";
          badge.style.borderColor = "rgba(16, 185, 129, 0.3)";
          return;
        }
      } catch (e) { /* backend unreachable — check Gemini directly */ }

      if (hasGemini) {
        badge.textContent = "Gemini AI: Ready ✓";
        badge.style.background = "rgba(59, 130, 246, 0.15)";
        badge.style.color = "#3b82f6";
        badge.style.borderColor = "rgba(59, 130, 246, 0.3)";
      } else {
        badge.textContent = "AI Mode: Key Missing ⚠️";
        badge.style.background = "rgba(245, 158, 11, 0.15)";
        badge.style.color = "#f59e0b";
        badge.style.borderColor = "rgba(245, 158, 11, 0.3)";
      }
    } else {
      // Local mode
      const extras = [];
      if (hasGemini) extras.push('Gemini NLU');
      if (hasWeather) extras.push('Weather');
      const suffix = extras.length ? ` + ${extras.join(' + ')}` : '';
      badge.textContent = `Local Rules: Active ✓${suffix}`;
      badge.style.background = "rgba(16, 185, 129, 0.15)";
      badge.style.color = "#10b981";
      badge.style.borderColor = "rgba(16, 185, 129, 0.3)";
    }
  },

  _toggleLanguage() {
    const current = KisanConfig.getLanguage();
    const newLang = current === 'ur' ? 'en' : current === 'en' ? 'both' : 'ur';
    KisanConfig.setLanguage(newLang);

    const labels = { en: 'EN', ur: 'اردو', both: 'EN/اردو' };
    this.elements.langToggle.textContent = labels[newLang];

    // Toggle Urdu text visibility
    document.body.classList.toggle('hide-urdu', newLang === 'en');
    document.body.classList.toggle('hide-english', newLang === 'ur');
  },

  // UTILITIES
  _showTyping() {
    if (this.elements.typingIndicator) {
      this.elements.typingIndicator.style.display = 'flex';
    }
  },

  _hideTyping() {
    if (this.elements.typingIndicator) {
      this.elements.typingIndicator.style.display = 'none';
    }
  },

  _scrollToBottom() {
    if (this.elements.chatMessages) {
      this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }
  },

  _escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => KisanApp.init());
