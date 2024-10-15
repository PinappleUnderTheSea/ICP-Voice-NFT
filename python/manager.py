from fastapi import FastAPI, Request, HTTPException, logger
import zmq
import asyncio
import time
import enum
import json
import psutil
import threading

import zmq.asyncio

app = FastAPI()

context = zmq.asyncio.Context()
zmq_socket = context.socket(zmq.ROUTER)
zmq_socket.bind("tcp://localhost:8010")
zmq_socket.setsockopt(zmq.MAXMSGSIZE, 1 * 1024 * 1024 * 1024)

ready_socket = context.socket(zmq.PULL)
ready_socket.bind("tcp://localhost:8011")

logger = logger.logger

class WorkerStatus(enum.Enum):
    Free = 0
    Working = 1
    Offline = 2

worker_cv = {}
worker_data = {}
lock = threading.Lock()

@app.post("/get_vad_segments")
async def get_vad_segments(request: Request):
    # try:
    data = await request.body()
    print('get data')
    identity = await ready_socket.recv()
    print("identity: ", identity)

    await zmq_socket.send_multipart([identity, data])

    id = identity.decode('utf-8')
    print("发出去了： ", id)

    async with worker_cv[id]:
        print("waiting")
        await worker_cv[id].wait()
        res =  {"response": json.loads(worker_data[id])}
        worker_data[id] = {}

    return res
    # except Exception as e:
    #     logger.error(e)
    #     return {"status": "Error", "message": str(e)}

async def notify_thread():
    while True:
        print('aha')
        identity, msg = await zmq_socket.recv_multipart()
        if msg.decode('utf-8') == 'READY':
            print(f"worker: {identity.decode('utf-8')} registered")
            continue
        id = identity.decode('utf-8')
        
        async with worker_cv[id]:
            worker_data[id] = msg
            print(f"{id} get resp")
            worker_cv[id].notify()


@app.post("/register")
async def register(request: Request):
    data = await request.json()
    worker_id = data["id"]

    worker_cv[worker_id] = asyncio.Condition()

    return {"detail": "success"}
 
def check_pid(pid):
    try:
        process = psutil.Process(pid)
        if process.is_running() and process.status() != psutil.STATUS_ZOMBIE:
            return True
        else:
            return False
    except psutil.NoSuchProcess:
        return False


@app.get("/list_worker")
async def list_worker(request: Request):

    lock.acquire()
    res = {}
    for pid in worker_cv.keys():
        if not check_pid(pid):
            del worker_cv[pid]
            continue
        res[pid] = WorkerStatus(worker_cv[pid]).name
    lock.release()
    return {"workers": res}

@app.on_event("startup")
async def startup_event():
    # 启动异步后台任务
    asyncio.create_task(notify_thread())

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8002)
