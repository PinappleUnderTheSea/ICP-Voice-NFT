import React, { useState, useEffect } from 'react';
import { AuthClient } from "@dfinity/auth-client";
import { HttpAgent, Actor } from '@dfinity/agent';
import { LedgerCanister, AccountIdentifier } from '@dfinity/ledger-icp';
import { Principal } from '@dfinity/principal';
import './App.css';
import { idlFactory } from '../../declarations/icp_hello_world_rust_backend/icp_hello_world_rust_backend.did.js';
// import logo from '../../../vNFT-logo.png'; // 引入项目 logo

const CANISTER_ID = 'bd3sg-teaaa-aaaaa-qaaba-cai';  // 替换为后端 Canister 的 ID
const LEDGER_CANISTER_ID = 'br5f7-7uaaa-aaaaa-qaaca-cai';  // ICP 账本的 Canister ID (主网)
const HOST = 'http://127.0.0.1:4943';  // 本地开发环境的地址
const GEN_FINGERPRINT_API = 'http://127.0.0.1:8003/gen';  // 生成 voice_fingerprint 的 API
const ANALYZE_FINGERPRINT_API = 'http://127.0.0.1:8003/extract_speaker_fingerprints'
function App() {
  const [authClient, setAuthClient] = useState(null);
  const [userPrincipal, setUserPrincipal] = useState(null);
  const [file, setFile] = useState(null);  // 保存用户上传的音频文件
  const [message, setMessage] = useState("");
  const [voiceFingerprint, setVoiceFingerprint] = useState(null);  // 保存生成的 voice_fingerprint
  const [icpAmount, setIcpAmount] = useState(1);  // 默认支付 1 ICP
  const [identityName, setIdentityName] = useState(""); // 用户输入的 identity_name
  const [audioList, setAudioList] = useState([]);  // 保存音频列表
  const [nftList, setNftList] = useState([]); // 保存 NFT 列表

  useEffect(() => {
    const initAuth = async () => {
      const authClient = await AuthClient.create();
      setAuthClient(authClient);

      if (await authClient.isAuthenticated()) {
        handleAuthenticated(authClient);
      }
    };

    initAuth();
  }, []);

  const handleAuthenticated = async (authClient) => {
    const identity = authClient.getIdentity();
    const principal = identity.getPrincipal().toText();  // 获取用户 Principal
    setUserPrincipal(principal);
    // setMessage(`Logged in as ${principal}`);
  };

  const handleLogin = async () => {
    if (authClient) {
      await authClient.login({
        onSuccess: async () => {
          handleAuthenticated(authClient);
        },
        identityProvider: "http://bw4dl-smaaa-aaaaa-qaacq-cai.localhost:4943/"
      });
    }
  };

  // 处理音频文件上传
  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  // 上传音频到外部服务，并获取 voice_fingerprint
  const generateVoiceFingerprint = async () => {
    if (!file) {
      setMessage("Please upload an audio file.");
      return;
    }

    // 将音频文件先添加到列表中（无论成功与否）
    const newAudio = {
      url: URL.createObjectURL(file),  // 临时 URL，用于播放音频
      type: file.type,
      status: "上传中...", // 上传状态
      fingerprint: null,
    };

    setAudioList([...audioList, newAudio]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(GEN_FINGERPRINT_API, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Fail: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      setVoiceFingerprint(data.voice_fingerprint);
      setMessage("Voice fingerprint generated successfully.");

      // 更新音频状态和指纹
      setAudioList((prevAudioList) =>
        prevAudioList.map((audio) =>
          audio.url === newAudio.url
            ? { ...audio, status: "上传成功" }
            : audio
        )
      );
      await registerVoiceNftWithPayment();

    } catch (error) {
      console.error("Error generating voice fingerprint:", error);
      setMessage(`Failed to generate voice fingerprint. ${error}`);

      // 更新音频状态为失败
      setAudioList((prevAudioList) =>
        prevAudioList.map((audio) =>
          audio.url === newAudio.url
            ? { ...audio, status: "上传失败" }
            : audio
        )
      );
    }


  };

  const analyzeVoiceFingerprint = async () => {
    if (!file) {
      setMessage("Please upload an audio file.");
      return;
    }

    // 将音频文件先添加到列表中（无论成功与否）
    const newAudio = {
      url: URL.createObjectURL(file),  // 临时 URL，用于播放音频
      type: file.type,
      status: "上传中...", // 上传状态
      fingerprint: null,
    };

    setAudioList([...audioList, newAudio]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(ANALYZE_FINGERPRINT_API, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Fail: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      setVoiceFingerprint(data.speaker_fingerprints);
      setMessage("Voice fingerprint generated successfully.");

      // 更新音频状态和指纹
      setAudioList((prevAudioList) =>
        prevAudioList.map((audio) =>
          audio.url === newAudio.url
            ? { ...audio, status: "上传成功" }
            : audio
        )
      );
      await analyzeVoiceNft();

    } catch (error) {
      console.error("Error generating voice fingerprint:", error);
      setMessage(`Failed to generate voice fingerprint. ${error}`);

      // 更新音频状态为失败
      setAudioList((prevAudioList) =>
        prevAudioList.map((audio) =>
          audio.url === newAudio.url
            ? { ...audio, status: "上传失败" }
            : audio
        )
      );
    }


  };

  const { sha224 } = require('js-sha256');

  // 用户支付 ICP 并转换为 cycles，同时注册 Voice NFT
  function accountIdentifier(principal, subaccount = new Uint8Array(32)) {
    return AccountIdentifier.fromPrincipal({ principal, subaccount })
  }

  const registerVoiceNftWithPayment = async () => {
    if (!voiceFingerprint || !identityName) {
      setMessage("Voice fingerprint and identity name are required.");
      return;
    }

    // 创建 HttpAgent 和 LedgerCanister 实例
    const agent = new HttpAgent({ host: HOST, identity: authClient.getIdentity() });
    await agent.fetchRootKey();  // 本地环境需要 fetch root key

    const ledgerActor = LedgerCanister.create({ agent, canisterId: LEDGER_CANISTER_ID });

    // 生成目标 Canister 的 Account Identifier
    const toAccount = accountIdentifier(Principal.fromText(CANISTER_ID), []);

    // 获取用户的 Principal 并生成用户的 Account Identifier
    const fromAccount = accountIdentifier(Principal.fromText(userPrincipal), []);

    const amountE8s = BigInt(icpAmount * 1e8);  // 1 ICP = 10^8 e8s
    const transferFee = await ledgerActor.transactionFee({ certified: true });

    try {
      // 发起支付请求
      const result = await ledgerActor.transfer({
        to: toAccount,
        amount: amountE8s,
        fee: transferFee,
        memo: BigInt(0),  // 可选 Memo
        from_subaccount: [],  // 可选，用户可以传入子账户
        created_at_time: [],  // 可选时间戳
      });

      setMessage(`Successfully paid ${icpAmount} ICP to canister ${CANISTER_ID}, block height: ${result}`);
      await registerVoiceNft();
    } catch (error) {
      // if (error instanceof V) {
      //   setMessage("没米了小子");
      // } else {

      // }
      setMessage("Payment failed with error: ", error);
      console.error("Error during payment:", error);

    }
  };

  // 将 voice_fingerprint 和支付信息发送到后端 Canister，注册 Voice NFT
  const registerVoiceNft = async () => {
    const agent = new HttpAgent({ host: HOST, identity: authClient.getIdentity() });
    await agent.fetchRootKey();
    const actor = Actor.createActor(
      idlFactory,
      {
        agent,
        canisterId: CANISTER_ID,
      });

    try {
      const speakerMapIdl = Object.keys(voiceFingerprint).map(speaker => {
        return {
          fingerprint: speakerMapJson[speaker],  // 转为 vec of float64
          speaker: speaker  // speaker 为文本
        };
      });
      
      const fingerprintMap = {
        speaker_map: speakerMapIdl  // 这将是你需要传递的 IDL 格式
      };
      const result = await actor.register_voice_nft(fingerprintMap);
      console.log(result)
      setMessage("NFT registered successfully: " + result.Ok);
    } catch (error) {
      console.error("Error registering NFT:", error);
      setMessage("Failed to register NFT.");
    }
  };

  const analyzeVoiceNft = async () => {
    const agent = new HttpAgent({ host: HOST, identity: authClient.getIdentity() });
    await agent.fetchRootKey();
    const actor = Actor.createActor(
      idlFactory,
      {
        agent,
        canisterId: CANISTER_ID,
      });

    try {
      const fingerprintArray = Array.from(voiceFingerprint);  // 如果 voiceFingerprint 是 Uint8Array 或者 Buffer
      console.log(fingerprintArray)
      const result = await actor.register_voice_nft({
        'data': fingerprintArray,  
        'name': identityName
      });
      console.log(result)
      setMessage("NFT registered successfully: " + result.Ok);
    } catch (error) {
      console.error("Error registering NFT:", error);
      setMessage("Failed to register NFT.");
    }
  };

  // 获取所有 NFT 列表
  const listNfts = async () => {
    const agent = new HttpAgent({ host: HOST, identity: authClient.getIdentity() });
    await agent.fetchRootKey();
    const actor = Actor.createActor(
      idlFactory,
      {
        agent,
        canisterId: CANISTER_ID,
      });

    try {
      const result = await actor.list_nfts();
      const nfts = result.Ok
      if (result && result.Ok){
        console.log(nfts)  // 请求后端的list_nfts接口
        setNftList(nfts);  // 保存NFT列表
        setMessage("NFTs fetched successfully.");
      }else if (result && result.Err) {
        console.error("Error fetching NFTs:", result.Err);
      } else {
        console.error("Unexpected result format:", result);
      }
    } catch (error) {
      console.error("Error fetching NFTs:", error);
      setMessage("Failed to fetch NFTs.");
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>ICP Voice NFT Registration</h1>
        {userPrincipal ? (
          <>
            <p>Logged in as: {userPrincipal}</p>

            {/* 用户输入名字 */}
            <div>
              <label>
                Identity Name
                <input
                  type="text"
                  value={identityName}
                  onChange={(e) => setIdentityName(e.target.value)}
                />
              </label>
            </div>

            {/* 音频文件上传 */}
            <div>
              <label>
                Upload audio file
                <input type="file" accept="audio/*" onChange={handleFileChange} />
                <button className="analyze-button"  onClick={analyzeVoiceFingerprint}>Analyze</button>
              </label>
            </div>

            <div className="button-container">
              <button className="center-button" onClick={generateVoiceFingerprint}>Generate Voice Fingerprint</button>
              <button className="center-button" onClick={generateVoiceFingerprint}>Mint NFT</button>
            </div>

            
            <div>
              <label>
                ICP Amount
                <input
                  type="number"
                  value={icpAmount}
                  onChange={(e) => setIcpAmount(Number(e.target.value))}
                />
              </label>
            </div>

            {message && <p>{message}</p>}

            {/* 音频列表展示 */}
            <div className="audio-list">
              <h2>已上传音频:</h2>
              <ul>
                {audioList.map((audio, index) => (
                  <li key={index}>
                    <audio controls>
                      <source src={audio.url} type={audio.type} />
                      您的浏览器不支持音频播放。
                    </audio>
                    <p>{audio.status}</p>
                    {audio.fingerprint && <p>Voice Fingerprint: {audio.fingerprint}</p>}
                  </li>
                ))}
              </ul>
            </div>

            {/* 新增 List NFTs 按钮 */}
            <div>
              <button className="center-button" onClick={listNfts}>List My NFTs</button>
            </div>

            {/* 展示获取到的 NFT 列表 */}
            {nftList.length > 0 && (
              <div className="nft-list">
                <h2>My NFTs:</h2>
                <ul>
                  {nftList.map((nft, index) => (
                    <li key={index}>
                      <p>NFT ID: {nft.id.toString()}</p>
                      <p>Owner: {nft.owner.toText()}</p>
                      <p>Name: {nft.name}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="login-container">
            <h1>Please log in to continue</h1>  {/* 提示文字 */}
            <button className="center-button" id="loginButton" onClick={handleLogin}>Login</button>  {/* 登录按钮 */}
          </div>
        )}
      </header>
    </div>
  );
}

export default App;
