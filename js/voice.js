// Thin wrapper over the browser's SpeechRecognition API. No server round
// trip - transcription happens wherever the browser implements it.

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isVoiceSupported() {
  return !!SpeechRecognitionImpl;
}

// callbacks: { onResult(finalTranscript, interimTranscript), onEnd(finalTranscript), onError(errorCode) }
export function createVoiceCapture({ onResult, onEnd, onError }) {
  if (!SpeechRecognitionImpl) {
    throw new Error('Voice input is not supported in this browser.');
  }

  const recognition = new SpeechRecognitionImpl();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';

  let finalTranscript = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += `${transcript} `;
      } else {
        interim += transcript;
      }
    }
    onResult(finalTranscript, interim);
  };

  recognition.onerror = (event) => {
    if (onError) onError(event.error);
  };

  recognition.onend = () => {
    if (onEnd) onEnd(finalTranscript.trim());
  };

  return {
    start: () => {
      finalTranscript = '';
      recognition.start();
    },
    stop: () => recognition.stop(),
  };
}
