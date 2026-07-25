const startButton = document.getElementById("start");
const rpmDisplay = document.getElementById("rpm");
const freqDisplay = document.getElementById("freq");
const levelDisplay = document.getElementById("level");

let audioContext;
let analyser;
let audioBuffer;

let envelope = [];

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

    analyser =
        audioContext.createAnalyser();

    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;

    source.connect(analyser);

    audioBuffer =
        new Float32Array(analyser.fftSize);

    update();
};



function update() {

    analyser.getFloatTimeDomainData(audioBuffer);


    // -------------------------
    // Lautstärke dieses Blocks
    // -------------------------

    let sum = 0;

    for (let i = 0; i < audioBuffer.length; i++) {
        sum += audioBuffer[i] * audioBuffer[i];
    }

    let rms =
        Math.sqrt(sum / audioBuffer.length);


    levelDisplay.value =
        Math.min(rms * 10, 1);



    // Hüllkurve sammeln

    envelope.push(rms);


    // ca. letzte 2 Sekunden behalten

    if (envelope.length > 100) {
        envelope.shift();
    }



    // genug Daten?

    if (envelope.length === 100) {

        let freq =
            findEnvelopeFrequency(
                envelope,
                audioContext.sampleRate /
                analyser.fftSize
            );


        if (freq) {

            freqDisplay.textContent =
                freq.toFixed(2) + " Hz";


            // Mercury 3.5 4-Takt
            let rpm =
                freq * 120;


            rpmDisplay.textContent =
                Math.round(rpm) + " rpm";
        }
    }


    requestAnimationFrame(update);
}





function findEnvelopeFrequency(signal, sampleRate) {


    const n = signal.length;


    // Mittelwert entfernen

    let mean = 0;

    for (let x of signal)
        mean += x;

    mean /= n;


    let x =
        signal.map(v => v - mean);



    /*
       Erwartungsbereich:

       5 Hz ... 100 Hz

       Bei envelope samplerate:
       ca. 48000/2048 = 23.4 Hz

       Dafür brauchen wir längere Historie.
    */


    let bestLag = 0;
    let best = -1;


    for (let lag = 2;
         lag < n / 2;
         lag++) {


        let corr = 0;


        for (let i = 0;
             i < n - lag;
             i++) {

            corr +=
                x[i] *
                x[i + lag];
        }


        if (corr > best) {

            best = corr;
            bestLag = lag;
        }
    }


    if (bestLag === 0)
        return null;


    let freq =
        sampleRate / bestLag;


    return freq;
}
