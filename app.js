let audioContext;
let analyser;
let data;

const startButton =
document.getElementById("start");

const rpmDisplay =
document.getElementById("rpm");

const freqDisplay =
document.getElementById("freq");

const levelDisplay =
document.getElementById("level");


startButton.onclick = async () => {

    const stream =
    await navigator.mediaDevices.getUserMedia({
        audio:true
    });

    audioContext =
    new AudioContext();

    const source =
    audioContext.createMediaStreamSource(stream);

    analyser =
    audioContext.createAnalyser();

    analyser.fftSize = 8192;

    source.connect(analyser);

    data =
    new Float32Array(analyser.fftSize);

    update();

};


function update(){

    analyser.getFloatTimeDomainData(data);


    // Pegel messen

    let sum=0;

    for(let x of data){
        sum += x*x;
    }

    let rms =
    Math.sqrt(sum/data.length);

    levelDisplay.value =
    Math.min(rms*5,1);



    // Frequenz bestimmen

    let frequency =
    autoCorrelate(
        data,
        audioContext.sampleRate
    );


    if(frequency){

        freqDisplay.textContent =
        frequency.toFixed(1)+" Hz";


        // Mercury 3.5 4T
        let rpm =
        frequency * 120;


        rpmDisplay.textContent =
        Math.round(rpm)+" rpm";

    }


    requestAnimationFrame(update);
}



function autoCorrelate(buffer, sampleRate){

    let SIZE = buffer.length;

    let rms=0;

    for(let i=0;i<SIZE;i++){
        rms += buffer[i]*buffer[i];
    }

    rms=Math.sqrt(rms/SIZE);


    if(rms<0.01)
        return null;


    let bestOffset=-1;
    let bestCorrelation=0;


    for(let offset=20;
        offset<1000;
        offset++){

        let correlation=0;

        for(let i=0;
            i<SIZE-offset;
            i++){

            correlation +=
            buffer[i] *
            buffer[i+offset];
        }


        correlation /= SIZE;


        if(correlation>bestCorrelation){

            bestCorrelation =
            correlation;

            bestOffset =
            offset;
        }
    }


    if(bestCorrelation>0.01){

        return sampleRate /
        bestOffset;
    }


    return null;
}
