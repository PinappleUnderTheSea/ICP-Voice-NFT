from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pyannote.audio import Pipeline
from speechbrain.inference import EncoderClassifier
import torchaudio
import torch
import tempfile


app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)


device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")


pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token="YOUR_HF_TOKEN",  
)

pipeline.to(device)

classifier = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="tmp",
    run_opts={"device": device}
)


@app.post("/gen")
async def generate_fingerprint(file: UploadFile = File(...)):
    
    with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
        tmp_file.write(await file.read())
        audio_path = tmp_file.name

    
    signal, fs = torchaudio.load(audio_path)
    signal = signal.to(device)

    
    diarization = pipeline(audio_path)
    speakers = set()
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        speakers.add(speaker)

    if len(speakers) != 1:
        return JSONResponse(
            content={"error": "音频中必须只有一个说话人"},
            status_code=400
        )

    
    embeddings = classifier.encode_batch(signal)
    fingerprint = embeddings.squeeze().tolist()

    return {"voice_fingerprint": fingerprint}


@app.post("/extract_speaker_fingerprints")
async def extract_speaker_fingerprints(file: UploadFile = File(...)):
    
    with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
        tmp_file.write(await file.read())
        audio_path = tmp_file.name

    
    _, fs = torchaudio.load(audio_path, num_frames=1)

    
    diarization = pipeline(audio_path)

    
    speaker_fingerprints = {}
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        
        frame_offset = int(turn.start * fs)
        num_frames = int((turn.end - turn.start) * fs)

        
        signal, _ = torchaudio.load(
            audio_path,
            frame_offset=frame_offset,
            num_frames=num_frames
        )
        signal = signal.to(device)

        
        signal = signal.unsqueeze(0)

        
        embeddings = classifier.encode_batch(signal)
        fingerprint = embeddings.squeeze().tolist()

        
        if speaker in speaker_fingerprints:
            speaker_fingerprints[speaker].append(fingerprint)
        else:
            speaker_fingerprints[speaker] = [fingerprint]

    
    final_fingerprints = {}
    for speaker, fingerprints in speaker_fingerprints.items():
        
        avg_fingerprint = torch.mean(torch.tensor(fingerprints), dim=0).tolist()
        final_fingerprints[speaker] = avg_fingerprint

    return {"speaker_fingerprints": final_fingerprints}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8003)
