// =====================================================================
// Drehzahlerkennung für Einzylinder-4-Takt-Außenborder (1000–5000 U/min)
// über Autokorrelation der (bandpassgefilterten) Lautstärke-Hüllkurve.
// =====================================================================

// ---- Anpassbare Parameter -------------------------------------------
const ENGINE = {
  minRPM: 1000,
  maxRPM: 5000,
  marginRPM: 300,        // Sicherheitsspanne um den Suchbereich
  strokesPerFiring: 2,   // 4-Takt-Einzylinder: 1 Zündung je 2 Umdrehungen
};

const FILTER = { hp: 80, lp: 3000, q: 0.707 }; // Bandpass in Hz
const ENVELOPE_BLOCK_MS = 3;    // RMS-Blockgröße -> Hüllkurven-Rate ~330 Hz
const BUFFER_SECONDS = 4;       // Analysefenster
const MIN_BUFFER_SECONDS = 2;   // Mindestdatenmenge vor erster Schätzung
const CORR_THRESHOLD = 0.55;    // Mindest-Korrelation für gültige Messung
const HISTORY_LEN = 9;          // Anzahl Messungen für Median-Glättung
const DETECT_INTERVAL_S = 0.1;  // Analyse-Takt (unabhängig von Envelope-Rate)

// ---- DOM ---------------------------------------------------------------
const startButton = document.getElementById("start");
const rpmDisplay = document.getElementById("rpm");
const freqDisplay = document.getElementById("freq");
const levelDisplay = document.getElementById("level");

let audioContext;
let workletNode;

let envelope = [];
let envRate = null;
let freqHistory = [];
let sampleCounter = 0;
let detectEveryN = 1;

startButton.onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(createWorkletURL());

    const source = audioContext.createMediaStreamSource(stream);

    workletNode = new AudioWorkletNode(audioContext, "engine-envelope-processor", {
      processorOptions: {
        blockMs: ENVELOPE_BLOCK_MS,
        hp: FILTER.hp,
        lp: FILTER.lp,
        q: FILTER.q,
      },
    });

    source.connect(workletNode);

    // Stummer Pfad zum Ausgang: verhindert, dass manche Browser den
    // Audio-Graph drosseln/anhalten, wenn er nicht mit destination
    // verbunden ist (z.B. im Hintergrund-Tab).
    const silent = audioContext.createGain();
    silent.gain.value = 0;
    workletNode.connect(silent).connect(audioContext.destination);

    workletNode.port.onmessage = (e) => {
      const msg = e.data;

      if (msg.type === "rate") {
        envRate = msg.envRate;
        detectEveryN = Math.max(1, Math.round(envRate * DETECT_INTERVAL_S));
        return;
      }

      if (msg.type === "rms") {
        if (!envRate) return;

        const rms = msg.value;
        levelDisplay.value = Math.min(rms * 20, 1);

        envelope.push(rms);
        const maxLen = Math.round(envRate * BUFFER_SECONDS);
        if (envelope.length > maxLen) envelope.shift();

        sampleCounter++;
        const minLen = Math.round(envRate * MIN_BUFFER_SECONDS);

        if (envelope.length > minLen && sampleCounter >= detectEveryN) {
          sampleCounter = 0;
          const result = detectFrequency(envelope, envRate);
          updateDisplay(result);
        }
      }
    };
  } catch (err) {
    console.error("Start fehlgeschlagen:", err);
  }
};

// ---- Frequenzerkennung über normierte Autokorrelation ------------------
function detectFrequency(signal, rate) {
  const n = signal.length;
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const x = signal.map((v) => v - mean);

  // Suchbereich auf plausible Zündfrequenzen einschränken
  // (1 Zündung je 2 Umdrehungen -> freq = RPM / 120)
  const freqMin = (ENGINE.minRPM - ENGINE.marginRPM) / 60 / ENGINE.strokesPerFiring;
  const freqMax = (ENGINE.maxRPM + ENGINE.marginRPM) / 60 / ENGINE.strokesPerFiring;

  const minLag = Math.max(1, Math.floor(rate / freqMax));
  const maxLag = Math.min(n - 2, Math.ceil(rate / freqMin));
  if (maxLag <= minLag + 1) return null;

  const corr = new Float64Array(maxLag - minLag + 1);
  let bestIdx = -1;
  let bestCorr = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += x[i] * x[i + lag];
      e1 += x[i] * x[i];
      e2 += x[i + lag] * x[i + lag];
    }
    const c = sum / (Math.sqrt(e1 * e2) + 1e-12);
    corr[lag - minLag] = c;
    if (c > bestCorr) {
      bestCorr = c;
      bestIdx = lag - minLag;
    }
  }

  // Treffer am Rand des Suchbereichs verwerfen: das echte Maximum
  // könnte außerhalb liegen -> Ergebnis wäre unzuverlässig
  if (bestIdx <= 0 || bestIdx >= corr.length - 1) return null;
  if (bestCorr < CORR_THRESHOLD) return null;

  // Parabolische Interpolation um den Peak für Sub-Lag-Genauigkeit
  const c0 = corr[bestIdx - 1], c1 = corr[bestIdx], c2 = corr[bestIdx + 1];
  const denom = c0 - 2 * c1 + c2;
  const delta = denom !== 0 ? 0.5 * (c0 - c2) / denom : 0;
  const refinedLag = bestIdx + minLag + delta;

  return {
    freq: rate / refinedLag,
    lag: refinedLag,
    corr: bestCorr,
  };
}

// ---- Anzeige mit Median-Glättung ---------------------------------------
function updateDisplay(result) {
  freqHistory.push(result ? result.freq : null);
  if (freqHistory.length > HISTORY_LEN) freqHistory.shift();

  const valid = freqHistory.filter((f) => f !== null);

  if (valid.length < Math.ceil(HISTORY_LEN / 2)) {
    freqDisplay.textContent = "–";
    rpmDisplay.textContent = "–";
    return;
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  freqDisplay.textContent = median.toFixed(2) + " Hz";
  rpmDisplay.textContent =
    Math.round(median * 60 * ENGINE.strokesPerFiring) + " rpm";

  if (result) showDebug(result, valid.length);
}

function showDebug(r, validCount) {
  let box = document.getElementById("debug");
  if (!box) {
    box = document.createElement("pre");
    box.id = "debug";
    document.body.appendChild(box);
  }
  box.textContent =
    "Envelope-Rate: " + envRate.toFixed(1) + " Hz\n" +
    "Lag (interpoliert): " + r.lag.toFixed(2) + "\n" +
    "Korrelation: " + r.corr.toFixed(3) + "\n" +
    "Gültige Messungen: " + validCount + "/" + HISTORY_LEN;
}

// ---- AudioWorklet: Bandpass + RMS-Hüllkurve -----------------------------
function createWorkletURL() {
  const code = `
class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
             - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function makeHighpass(f0, fs, Q) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw0 = Math.cos(w0);
  const b0 = (1 + cosw0) / 2, b1 = -(1 + cosw0), b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw0, a2 = 1 - alpha;
  return new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function makeLowpass(f0, fs, Q) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw0 = Math.cos(w0);
  const b0 = (1 - cosw0) / 2, b1 = 1 - cosw0, b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw0, a2 = 1 - alpha;
  return new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

class EngineEnvelopeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const cfg = options.processorOptions;
    this.blockSize = Math.max(1, Math.round(sampleRate * cfg.blockMs / 1000));
    this.buf = new Float32Array(this.blockSize);
    this.idx = 0;
    this.hp = makeHighpass(cfg.hp, sampleRate, cfg.q);
    this.lp = makeLowpass(cfg.lp, sampleRate, cfg.q);
    this.port.postMessage({ type: "rate", envRate: sampleRate / this.blockSize });
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      let s = input[i];
      s = this.hp.process(s);
      s = this.lp.process(s);

      this.buf[this.idx++] = s;

      if (this.idx >= this.blockSize) {
        let sum = 0;
        for (let j = 0; j < this.blockSize; j++) sum += this.buf[j] * this.buf[j];
        const rms = Math.sqrt(sum / this.blockSize);
        this.port.postMessage({ type: "rms", value: rms });
        this.idx = 0;
      }
    }
    return true;
  }
}

registerProcessor("engine-envelope-processor", EngineEnvelopeProcessor);
`;

  return URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
}
