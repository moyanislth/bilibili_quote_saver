// ── Offscreen STT Engine ──
// Runs in chrome.offscreen context. Captures tab audio and runs speech recognition.

let recognition = null;
let audioContext = null;
let mediaStream = null;
let isRunning = false;
let finalTranscript = '';
let interimTranscript = '';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STT_START') {
    startCapture(message.streamId, message.lang || 'zh-CN')
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'STT_STOP') {
    stopCapture();
    sendResponse({ success: true, text: finalTranscript });
    return true;
  }

  if (message.type === 'STT_GET_TEXT') {
    sendResponse({ interim: interimTranscript, final: finalTranscript });
    return true;
  }
});

async function startCapture(streamId, lang) {
  if (isRunning) return;

  // Get the tab's audio stream
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // Create audio context and connect for monitoring
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  // Also connect to destination so STT can hear it via system audio
  source.connect(audioContext.destination);

  // Start speech recognition
  startRecognition(lang);
  isRunning = true;
}

function startRecognition(lang) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    interimTranscript = interim;
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    // Restart on error
    if (isRunning) {
      setTimeout(() => startRecognition(lang), 500);
    }
  };

  recognition.onend = () => {
    if (isRunning) {
      // Commit interim to final
      if (interimTranscript) {
        finalTranscript += interimTranscript;
        interimTranscript = '';
      }
      // Restart (continuous mode stops after ~30s of silence in Chrome)
      setTimeout(() => startRecognition(lang), 200);
    }
  };

  recognition.start();
}

function stopCapture() {
  isRunning = false;

  if (recognition) {
    recognition.stop();
    recognition = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  // Notify background that we're done (so it can close the offscreen doc)
  chrome.runtime.sendMessage({
    type: 'STT_FINISHED',
    text: finalTranscript
  });

  finalTranscript = '';
  interimTranscript = '';
}
