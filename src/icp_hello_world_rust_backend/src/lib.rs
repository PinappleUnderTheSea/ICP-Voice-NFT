use serde::{Deserialize, Serialize};
use candid::{CandidType, Principal};  // 使用 candid 库的 Principal 和 CandidType
use ic_cdk;
use ic_stable_structures::{
    DefaultMemoryImpl, StableBTreeMap,
    storable::Storable,
};
use std::mem;
use ic_stable_structures::storable::BoundedStorable;
use std::cell::RefCell;
use std::borrow::Cow;
use include_base64::include_base64;
use std::collections::HashMap;

#[derive(CandidType, Serialize, Deserialize, Clone)]
pub struct MatchArgs {
    pub speaker_map: HashMap<String, Vec<f64>>,  // 用户上传的speaker映射到语音指纹的map
}


// 定义语音指纹 NFT 的结构
#[derive(CandidType, Serialize, Deserialize, Clone)] // 使用 candid 的 CandidType 和 serde 的序列化和反序列化
pub struct VoiceNFT {
    pub id: u64,
    pub owner: Principal, // 使用 candid::Principal
    pub voice_fingerprint: Vec<f64>,  // 使用 f64
    pub name: String,
}

#[derive(CandidType, Serialize, Deserialize, Clone)] 
pub struct RegisterArgs {
    pub name: String,
    pub data: Vec<f64>,
}

impl Storable for VoiceNFT {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(serde_json::to_vec(self).expect("Failed to serialize VoiceNFT"))
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        serde_json::from_slice(&bytes).expect("Failed to deserialize VoiceNFT")
    }
}

impl BoundedStorable for VoiceNFT {
    const MAX_SIZE: u32 = 1024; // 设置最大存储字节数
    const IS_FIXED_SIZE: bool = false; // VoiceNFT 不是固定大小
}

#[derive(CandidType, Deserialize, Clone)]
struct LogoResult {
    logo_type: Cow<'static, str>,
    data: Cow<'static, str>,
}


#[derive(CandidType, Deserialize, Default)]
struct State {
    nfts: Vec<VoiceNFT>,
    logo: Option<LogoResult>,
    name: String,
    txid: u128,
}

// 用于存储语音指纹 NFT 的 StableBTreeMap
thread_local! {
    static STATE: RefCell<State> = RefCell::default();
}


const DEFAULT_LOGO: LogoResult = LogoResult {
    data: Cow::Borrowed(include_base64!("vNFT-logo.png")),
    logo_type: Cow::Borrowed("image/png"),
};


#[ic_cdk::init]
fn init() {
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        state.name = "vNFT".to_string();
        state.logo = Some(DEFAULT_LOGO);
    });
}

// #[ic_cdk::pre_upgrade]
// fn pre_upgrade() {
//     STATE.with(|state| ic_cdk::storage::stable_save((state,)).unwrap());
// }

// #[ic_cdk::post_upgrade]
// fn post_upgrade() {
//     let old_state: Result<(State,), _> = ic_cdk::storage::stable_restore();
//     match old_state {
//         Ok((old_state,)) => {
//             STATE.with(|state| *state.borrow_mut() = old_state);
//         },
//         Err(_) => {
//             STATE.with(|state| *state.borrow_mut() = State::default());  // 如果恢复失败，初始化默认状态
//         },
//     };
    
// }

#[ic_cdk::query]
fn count_all() -> u64 {
    STATE.with(|state| {
        state
            .borrow()
            .nfts
            .len() as u64
    })
}

// 查询自己的NFT
#[ic_cdk::query]
fn list_nfts() -> Result<Vec<VoiceNFT>, String> {
    let caller = ic_cdk::api::caller();
    let owner = Principal::from_slice(caller.as_slice());
    Ok(STATE.with(|state| {
        state
            .borrow()
            .nfts
            .iter()
            .filter(|n| n.owner == owner)
            .cloned()
            .collect()
    }))
}


// 注册语音指纹 NFT
#[ic_cdk::update]
fn register_voice_nft(args: RegisterArgs) -> Result<VoiceNFT, String> {
    let caller = ic_cdk::api::caller();  // 获取 ic_cdk::export::Principal
    let owner = Principal::from_slice(caller.as_slice());  // 将 ic_cdk::export::Principal 转换为 candid::Principal

    // 检查用户是否已经注册了语音指纹 NFT
    let has_nft = STATE.with(|store| {
        store.borrow().nfts.iter().any(|nft| nft.owner == owner && nft.name == args.name)
    });

    if has_nft {
        return Err("You have already registered an NFT for this name.".to_string());
    }

    // 生成新的 NFT
    let new_id = STATE.with(|store| store.borrow().nfts.len() as u64);
    let new_nft = VoiceNFT {
        id: new_id,
        owner,  // owner 现在是 candid::Principal 类型
        voice_fingerprint: args.data,
        name: args.name,
    };

    // 存储新生成的语音指纹 NFT
    STATE.with(|store| {
        store.borrow_mut().nfts.insert(new_id as usize, new_nft.clone());
    });

    Ok(new_nft)
}



// 比对语音指纹的逻辑
fn match_speaker_fingerprint(new_fingerprint: &Vec<f64>, all_nfts: &Vec<VoiceNFT>) -> Option<(Principal, String)> {
    let threshold = 0.90;  // 设置相似度阈值为90%
    let mut best_match: Option<(Principal, String)> = None;
    let mut best_similarity = 0.0;

    for nft in all_nfts {
        let similarity = cosine_similarity(new_fingerprint, &nft.voice_fingerprint);
        if similarity > best_similarity && similarity >= threshold {
            best_similarity = similarity;
            best_match = Some((nft.owner, nft.name.clone()));  // 返回匹配到的owner和name
        }
    }

    best_match
}

fn cosine_similarity(vec1: &Vec<f64>, vec2: &Vec<f64>) -> f64 {
    let dot_product = vec1.iter().zip(vec2.iter()).map(|(a, b)| a * b).sum::<f64>();
    let magnitude1 = vec1.iter().map(|x| x * x).sum::<f64>().sqrt();
    let magnitude2 = vec2.iter().map(|x| x * x).sum::<f64>().sqrt();
    dot_product / (magnitude1 * magnitude2)
}

#[ic_cdk::update]
fn match_speakers(args: MatchArgs) -> HashMap<String, String> {
    let all_nfts = STATE.with(|state| state.borrow().nfts.clone());  // 获取所有NFT

    let mut result: HashMap<String, String> = HashMap::new();

    for (speaker, fingerprint) in args.speaker_map.iter() {
        if let Some((owner, name)) = match_speaker_fingerprint(fingerprint, &all_nfts) {
            result.insert(speaker.clone(), format!("Owner: {}, Name: {}", owner.to_text(), name));
        } else {
            result.insert(speaker.clone(), "不存在".to_string());
        }
    }

    result
}
