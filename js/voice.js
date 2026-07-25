// KisanBot Voice Module — Web Speech API wrapper
const KisanVoice = {
  recognition: null,
  synthesis: window.speechSynthesis,
  isListening: false,
  urduVoice: null,
  englishVoice: null,
  onResult: null,
  onListeningChange: null,

  init() {
    // Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
      // Default to Urdu, will try English as fallback
      this.recognition.lang = 'ur-PK';

      this.recognition.onresult = (event) => {
        let transcript = '';
        let isFinal = false;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
          if (event.results[i].isFinal) isFinal = true;
        }
        if (this.onResult) {
          this.onResult(transcript, isFinal);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.onListeningChange) this.onListeningChange(false);
      };

      this.recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        // If Urdu fails, try English
        if (event.error === 'no-speech' || event.error === 'language-not-supported') {
          if (this.recognition.lang === 'ur-PK') {
            this.recognition.lang = 'en-US';
            console.log('Switching to English recognition');
          }
        }
        this.isListening = false;
        if (this.onListeningChange) this.onListeningChange(false);
      };
    }

    // Load available voices for TTS
    this._loadVoices();
    if (this.synthesis) {
      this.synthesis.onvoiceschanged = () => this._loadVoices();
    }
  },

  _loadVoices() {
    if (!this.synthesis) return;
    const voices = this.synthesis.getVoices();
    // Try to find Urdu voice
    this.urduVoice = voices.find(v => v.lang.startsWith('ur') || v.lang.startsWith('UR'));
    
    // Fallback: Find Hindi voice (shares exact same spoken phonetics and works perfectly for Urdu text)
    if (!this.urduVoice) {
      this.urduVoice = voices.find(v => v.lang.startsWith('hi') || v.lang.startsWith('HI'));
    }
    
    // Find English voice (prefer Pakistani/Indian English)
    this.englishVoice = voices.find(v => v.lang === 'en-IN') ||
                        voices.find(v => v.lang === 'en-US') ||
                        voices.find(v => v.lang.startsWith('en'));
  },

  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  isTTSSupported() {
    return !!window.speechSynthesis;
  },

  startListening(lang = 'ur-PK') {
    if (!this.recognition) return false;
    try {
      this.recognition.lang = lang;
      this.recognition.start();
      this.isListening = true;
      if (this.onListeningChange) this.onListeningChange(true);
      return true;
    } catch (e) {
      console.error('Failed to start recognition:', e);
      return false;
    }
  },

  stopListening() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
      if (this.onListeningChange) this.onListeningChange(false);
    }
  },

  speak(text, lang = 'ur') {
    return new Promise((resolve) => {
      if (!this.synthesis) { resolve(); return; }

      // Cancel any ongoing speech
      this.synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      if (this.urduVoice) {
        utterance.voice = this.urduVoice;
        utterance.lang = this.urduVoice.lang;
      } else {
        utterance.voice = this.englishVoice;
        utterance.lang = 'en-US';
      }

      utterance.rate = 0.85; // Slightly slower for better Urdu pronunciation clarity
      utterance.pitch = 1.05;
      utterance.volume = 1;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      console.log('KisanVoice: Speaking text:', text, 'with voice:', utterance.voice ? utterance.voice.name : 'default', 'and lang:', utterance.lang);
      this.synthesis.speak(utterance);
    });
  },

  stopSpeaking() {
    if (this.synthesis) {
      this.synthesis.cancel();
    }
  },

  // Toggle listening language
  setRecognitionLang(lang) {
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }
};

window.KisanVoice = KisanVoice;
