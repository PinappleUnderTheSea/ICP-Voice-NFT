import zmq
import time
import os
import sys
import requests
import json
import torch
import zmq.asyncio
import asyncio


async def worker(worker_id, ready_socket, socket, pipeline):


    while True:

        await ready_socket.send_multipart([str(worker_id).encode('utf-8')])
        print("worker ready")
        message = await socket.recv_multipart()
        message = json.loads(message[0].decode("utf-8"))
        diarization = pipeline({
            "waveform": torch.tensor(message["waveform"]),
            "sample_rate": message["sample_rate"],
            "channel": 0,
        })
        print("message dealed")

        res = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            res.append({"start": f"{turn.start:.1f}s",
            "stop": f"{turn.end:.1f}s", 
            "speaker": f"{speaker}",
            })
        
        # socket.send_multipart([json.dumps({"resp": "有了"}).encode("utf-8")])
        socket.send_multipart([json.dumps({"resp": res}).encode('utf-8')])
        time.sleep(1)


def register(id):
    url = "http://localhost:8002/register"
    resp = requests.post(url, json={"id": str(id)})
    print(resp.text)
    if resp.status_code != 200:
        return False
    socket.send_multipart([b'READY'])
    return True


if __name__ == "__main__":
    
    from pyannote.audio import Pipeline
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token="YOUR_HF_TOKEN")

    import torch
    device = torch.device(f"cuda:{sys.argv[1]}")
    pipeline.to(device)
    from speechbrain.inference import EncoderClassifier

    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="tmp",
        run_opts={"device": device}
)
    worker_id = os.getpid()
    context = zmq.asyncio.Context()
    socket = context.socket(zmq.DEALER)
    socket.setsockopt_string(zmq.IDENTITY, str(worker_id))
    socket.connect("tcp://localhost:8010")

    ready_socket = context.socket(zmq.PUSH)
    ready_socket.connect("tcp://localhost:8011")
    if not register(worker_id):
        raise RuntimeError("register failed")
    print(f"register {worker_id} success")


    asyncio.run(worker(worker_id, ready_socket, socket, pipeline))
