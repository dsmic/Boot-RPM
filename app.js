const startButton = document.getElementById("start");
const rpmDisplay = document.getElementById("rpm");
const freqDisplay = document.getElementById("freq");
const levelDisplay = document.getElementById("level");

let audioContext;
let analyser;
let buffer;

let envelope = [];
alert("Version 0.4 läuft");
const RMS_WINDOW = 480; // ca. 10ms bei 48kHz
let rmsBuffer = [];

startButton.onclick = async () => {

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
    });

    audioContext = new AudioContext();

    const source =
        audioContext.createMediaStreamSource(stream);

    analyser = audioContext.createAnalyser();

    analyser.fftSize = 20480;
    analyser.smoothingTimeConstant = 10;

    source.connect(analyser);

    buffer = new Float32Array(analyser.fftSize);

    update();
};


function update() {

    analyser.getFloatTimeDomainData(buffer);


    // Pegelanzeige

    let rms = 0;

    for (let x of buffer)
        rms += x*x;

    rms = Math.sqrt(rms / buffer.length);

    levelDisplay.value = Math.min(rms * 10, 1);



    // Samples sammeln für RMS-Fenster

    for (let x of buffer) {

        rmsBuffer.push(x*x);

        if (rmsBuffer.length >= RMS_WINDOW) {

            let sum = 0;

            for (let v of rmsBuffer)
                sum += v;

            let envelopeValue =
                Math.sqrt(sum / rmsBuffer.length);

            envelope.push(envelopeValue);

            rmsBuffer = [];

            // ca. 3 Sekunden Historie
            if (envelope.length > 300)
                envelope.shift();
        }
    }


    if (envelope.length >= 200) {

        let result =
            autocorrelationFrequency(
                envelope,
                100
            );

        if (result) {

            freqDisplay.textContent =
                result.toFixed(2) + " Hz";

            rpmDisplay.textContent =
                Math.round(result * 120) + " rpm";
        }
    }


    requestAnimationFrame(update);
}



function autocorrelationFrequency(signal, sampleRate) {

    let n = signal.length;


    // Mittelwert entfernen

    let mean =
        signal.reduce((a,b)=>a+b,0)/n;

    let x =
        signal.map(v=>v-mean);



    // Frequenzbereich 5-100 Hz

    let minLag =
        Math.floor(sampleRate / 100);

    let maxLag =
        Math.floor(sampleRate / 5);


    let bestLag = 0;
    let bestCorr = -Infinity;


    for (let lag=minLag;
         lag<=maxLag;
         lag++) {

        let corr=0;
        let e1=0;
        let e2=0;


        for (let i=0;
             i<n-lag;
             i++) {

            corr += x[i]*x[i+lag];
            e1 += x[i]*x[i];
            e2 += x[i+lag]*x[i+lag];
        }


        corr /= Math.sqrt(e1*e2)+1e-12;


        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }


    if (bestCorr < 0.2)
        return null;


    return sampleRate / bestLag;
}
