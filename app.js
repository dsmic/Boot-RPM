const startButton = document.getElementById("start");
const rpmDisplay = document.getElementById("rpm");
const freqDisplay = document.getElementById("freq");
const levelDisplay = document.getElementById("level");

let audioContext;
let workletNode;

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

    await audioContext.audioWorklet.addModule(
        createWorkletURL()
    );

    const source =
        audioContext.createMediaStreamSource(stream);


    workletNode =
        new AudioWorkletNode(
            audioContext,
            "rms-processor"
        );


    source.connect(workletNode);


    // Worklet liefert RMS-Werte

    workletNode.port.onmessage = e => {

        const rms = e.data;


        levelDisplay.value =
            Math.min(rms * 8, 1);


        envelope.push(rms);


        // ca. 5 Sekunden behalten
        if (envelope.length > 500)
            envelope.shift();


        if (envelope.length > 300) {

            const result =
                detectFrequency(
                    envelope,
                    100
                );


            if (result) {

                freqDisplay.textContent =
                    result.freq.toFixed(2)
                    + " Hz";


                rpmDisplay.textContent =
                    Math.round(
                        result.freq * 120
                    )
                    + " rpm";


                showDebug(result);

            }
        }
    };
};



function detectFrequency(signal, sampleRate) {

    let n = signal.length;


    // Mittelwert entfernen

    let mean =
        signal.reduce((a,b)=>a+b,0)/n;


    let x =
        signal.map(v=>v-mean);


    // 5-100 Hz Suchbereich

    let minLag =
        Math.floor(sampleRate / 100);

    let maxLag =
        Math.floor(sampleRate / 5);


    let bestLag = 0;
    let bestCorr = -1;


    for(let lag=minLag; lag<=maxLag; lag++){

        let sum = 0;
        let e1 = 0;
        let e2 = 0;


        for(let i=0;i<n-lag;i++){

            sum += x[i]*x[i+lag];
            e1 += x[i]*x[i];
            e2 += x[i+lag]*x[i+lag];

        }


        let corr =
            sum /
            (Math.sqrt(e1*e2)+1e-12);


        if(corr > bestCorr){

            bestCorr = corr;
            bestLag = lag;
        }
    }


    if(bestCorr < 0.4)
        return null;


    return {
        freq: sampleRate / bestLag,
        lag: bestLag,
        corr: bestCorr
    };
}



function showDebug(r){

    let box =
        document.getElementById("debug");


    if(!box){

        box =
        document.createElement("pre");

        box.id="debug";

        document.body.appendChild(box);
    }


    box.textContent =
`
Lag: ${r.lag}
Correlation: ${r.corr.toFixed(3)}
Envelope rate: 100 Hz
`;
}





function createWorkletURL(){

const code = `

class RMSProcessor extends AudioWorkletProcessor {

    constructor(){

        super();

        this.samples=[];
        this.window =
            Math.floor(sampleRate * 0.01);
    }


    process(inputs){

        const input =
            inputs[0][0];


        if(!input)
            return true;


        for(let x of input){

            this.samples.push(x);


            if(this.samples.length >= this.window){

                let sum=0;

                for(let s of this.samples)
                    sum += s*s;


                let rms =
                    Math.sqrt(
                        sum /
                        this.samples.length
                    );


                this.port.postMessage(rms);

                this.samples=[];
            }
        }


        return true;
    }
}


registerProcessor(
    "rms-processor",
    RMSProcessor
);

`;

return URL.createObjectURL(
    new Blob(
        [code],
        {type:"application/javascript"}
    )
);

}
