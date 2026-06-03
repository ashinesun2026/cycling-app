// === 全局錯誤捕捉與螢幕顯示 (iOS/手機調試專用) ===
window.addEventListener('error', (event) => {
  showOnScreenError(`JS 錯誤: ${event.message}\n檔案: ${event.filename.split('/').pop()}:${event.lineno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  showOnScreenError(`Promise 錯誤: ${event.reason}`);
});

function showOnScreenError(msg) {
  console.error(msg);
  let errDiv = document.getElementById('debug-err-log');
  if (!errDiv) {
    errDiv = document.createElement('div');
    errDiv.id = 'debug-err-log';
    errDiv.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;background:rgba(255,0,0,0.95);color:white;padding:12px;border-radius:8px;font-size:12px;z-index:10000;word-break:break-all;font-family:monospace;max-height:180px;overflow-y:auto;box-shadow:0 0 15px rgba(0,0,0,0.5);border:1px solid #ff5555;line-height:1.4;';

    const closeBtn = document.createElement('button');
    closeBtn.innerText = '✕ 關閉';
    closeBtn.style.cssText = 'float:right;background:white;color:red;border:none;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer;font-weight:bold;margin-left:10px;';
    closeBtn.onclick = () => errDiv.remove();
    errDiv.appendChild(closeBtn);

    const title = document.createElement('strong');
    title.innerText = '⚠️ 程式錯誤偵測 (請拍照回傳)：\n';
    errDiv.appendChild(title);

    const content = document.createElement('span');
    content.id = 'debug-err-content';
    content.innerText = msg;
    errDiv.appendChild(content);

    document.body.appendChild(errDiv);
  } else {
    const content = document.getElementById('debug-err-content');
    if (content) {
      content.innerText += '\n' + msg;
    }
  }
}

// === 藍牙規格 UUID ===
const FTMS_SERVICE_UUID = '00001826-0000-1000-8000-00805f9b34fb';
const INDOOR_BIKE_DATA_CHAR_UUID = '00002ad2-0000-1000-8000-00805f9b34fb';
const FITNESS_MACHINE_CONTROL_POINT_CHAR_UUID = '00002ad9-0000-1000-8000-00805f9b34fb';

// === 應用程式狀態 ===
let state = {
  isDemoMode: false,
  isPlaying: false,
  useCompatMode: false, // 是否使用相容連線模式 (acceptAllDevices)

  // 藍牙設備對象
  bikeDevice: null,
  controlPointChar: null,

  // 連線狀態
  isBikeConnected: false,

  // 運動即時數據
  elapsedTime: 0, // 秒
  calories: 0,    // kcal
  distance: 0.0,  // km
  power: 0,       // W
  cadence: 0,     // RPM
  speed: 0.0,     // km/h
  resistance: 5,  // 目前阻力段數 (1-24)
  workoutStartedAt: null,

  // 運動統計數據 (用於結算報告)
  powerSamples: [],
  cadenceSamples: [],
  maxPower: 0,

  // 運動模式設定
  workoutMode: 'free',

  // 間歇挑戰狀態計時
  intervalTimeElapsed: 0,
  intervalPhaseIndex: 0,
  modeStartedElapsed: 0,
  lastAutoResistance: null,
  lastPhaseKey: '',
  autoStartBlocked: false,

  // 定時器
  mainTimer: null,
  demoTimer: null,
  intervalTimer: null
};

// === 多使用者資料庫與檔案管理 ===
let db = {
  users: [],
  activeUserId: 'default'
};

const DEFAULT_USER = {
  id: 'default',
  name: '訪客用戶',
  weight: 70,
  age: 30,
  gender: 'male'
};

const TRAINING_PLANS = {
  free: {
    label: '自由',
    title: '自由騎行',
    targetPower: '自由調整',
    targetCadence: '依體感',
    resistance: null,
    intensity: '自選',
    focus: '暖身、恢復、測試飛輪狀態',
    coach: '自由騎行：依體感調整阻力，先建立穩定踩踏節奏。'
  },
  recovery: {
    label: '恢復',
    title: '恢復騎',
    targetPower: '依階段',
    targetCadence: '70~84 RPM',
    resistance: null,
    intensity: '低',
    focus: '放鬆腿部、促進恢復',
    coach: '恢復騎：低壓力但不是空踩，讓腿有張力、呼吸能放鬆。'
  },
  endurance: {
    label: '耐力',
    title: '有氧耐力',
    targetPower: '依階段',
    targetCadence: '72~86 RPM',
    resistance: null,
    intensity: '中低',
    focus: '基礎心肺、長時間穩定輸出',
    coach: '有氧耐力：從暖身進入巡航，中段穩住輸出，最後兩分鐘緩和。'
  },
  personalized: {
    label: '建議',
    title: '下次訓練',
    targetPower: '依個人化階段',
    targetCadence: '依個人化階段',
    resistance: null,
    intensity: '個人化',
    focus: '依上次健康資料調整',
    coach: '下次訓練：健康資料匯入後自動產生，會依照疲勞、心率、時間與踩踏狀態調整。'
  },
  tempo: {
    label: '節奏',
    title: '燃脂節奏',
    targetPower: '依階段',
    targetCadence: '70~84 RPM',
    resistance: null,
    intensity: '中高',
    focus: '燃脂巡航、配速耐受',
    coach: '燃脂節奏：逐步加壓到可控辛苦，不靠高轉速硬撐。'
  },
  cadence: {
    label: '穩踩',
    title: '穩踩肌耐力',
    targetPower: '依階段',
    targetCadence: '68~82 RPM',
    resistance: null,
    intensity: '中',
    focus: '穩定踩壓、肌耐力、姿勢控制',
    coach: '穩踩肌耐力：不用高轉速，改用中高阻力練穩定推踩。'
  },
  climb: {
    label: '爬坡',
    title: '爬坡肌耐力',
    targetPower: '依階段',
    targetCadence: '60~78 RPM',
    resistance: null,
    intensity: '高',
    focus: '腿力、肌耐力、穩定推踩',
    coach: '爬坡肌耐力：低踏頻可以，重點是阻力張力、核心穩定、膝蓋軌跡。'
  },
  interval: {
    label: '間歇',
    title: '間歇衝刺',
    targetPower: '依階段',
    targetCadence: '依階段',
    resistance: null,
    intensity: '變化',
    focus: '爆發、恢復切換、心肺刺激',
    coach: '間歇衝刺：跟著階段切換，衝刺要乾淨，恢復要真的降下來。'
  },
  pyramid: {
    label: '進階',
    title: '金字塔課表',
    targetPower: '逐段上升再下降',
    targetCadence: '70~92 RPM',
    resistance: null,
    intensity: '進階',
    focus: '配速能力、耐受力、恢復控制',
    coach: '金字塔課表：前段保守，最高點撐住，後段練控制不要亂掉。'
  }
};

const PHASE_PLANS = {
  recovery: [
    { name: '暖身進入', duration: 180, resistance: 3, targetCadence: '72-82', targetPower: '70-95W', info: '先把關節熱開，踩踏順就好。' },
    { name: '恢復巡航', duration: 480, resistance: 4, targetCadence: '72-84', targetPower: '80-110W', info: '保留輕阻力張力，不要空轉。' },
    { name: '血流喚醒', duration: 120, resistance: 5, targetCadence: '70-80', targetPower: '95-125W', info: '短暫加一點壓力，喚醒腿部。' },
    { name: '最後緩和', duration: 120, resistance: 2, targetCadence: '68-78', targetPower: '60-85W', info: '最後兩分鐘放鬆收操。' }
  ],
  endurance: [
    { name: '暖身', duration: 300, resistance: 4, targetCadence: '72-82', targetPower: '85-115W', info: '慢慢進入，不急著拉高功率。' },
    { name: '基礎巡航', duration: 480, resistance: 6, targetCadence: '74-86', targetPower: '110-145W', info: '找到能維持很久的呼吸節奏。' },
    { name: '穩定主段', duration: 600, resistance: 7, targetCadence: '72-84', targetPower: '125-160W', info: '重點是穩，不是瞬間衝高。' },
    { name: '耐力加壓', duration: 300, resistance: 8, targetCadence: '70-82', targetPower: '140-175W', info: '最後主段提高張力，但姿勢不能散。' },
    { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '68-78', targetPower: '70-95W', info: '最後兩分鐘降壓，讓呼吸回穩。' }
  ],
  tempo: [
    { name: '暖身', duration: 240, resistance: 5, targetCadence: '72-82', targetPower: '95-125W', info: '先建立踩踏張力。' },
    { name: '節奏建立', duration: 360, resistance: 8, targetCadence: '72-82', targetPower: '130-165W', info: '進入可控辛苦區。' },
    { name: '高峰巡航', duration: 480, resistance: 10, targetCadence: '70-80', targetPower: '155-195W', info: '呼吸變深，但輸出要穩。' },
    { name: '強度收束', duration: 120, resistance: 8, targetCadence: '72-82', targetPower: '135-170W', info: '不要突然放掉，先收住節奏。' },
    { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '68-78', targetPower: '70-95W', info: '最後兩分鐘緩和。' }
  ],
  cadence: [
    { name: '暖身', duration: 240, resistance: 5, targetCadence: '72-82', targetPower: '95-125W', info: '用中等阻力建立穩定踩壓。' },
    { name: '穩踩主段', duration: 300, resistance: 7, targetCadence: '70-80', targetPower: '120-155W', info: '不是追高轉速，重點是每一下踩得穩。' },
    { name: '肌耐力高點', duration: 300, resistance: 9, targetCadence: '68-78', targetPower: '145-180W', info: '保持核心穩定，膝蓋不要左右晃。' },
    { name: '節奏整理', duration: 120, resistance: 7, targetCadence: '70-82', targetPower: '120-155W', info: '把動作整理回穩定。' },
    { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '68-78', targetPower: '70-95W', info: '最後兩分鐘緩和。' }
  ],
  climb: [
    { name: '暖身', duration: 240, resistance: 6, targetCadence: '70-80', targetPower: '105-135W', info: '先進入低轉高張力節奏。' },
    { name: '坐姿爬坡', duration: 300, resistance: 10, targetCadence: '64-76', targetPower: '150-190W', info: '坐穩骨盆，讓腿穩定推踩。' },
    { name: '陡坡高峰', duration: 240, resistance: 13, targetCadence: '60-72', targetPower: '180-230W', info: '最重階段，重點是穩，不是快。' },
    { name: '滾動爬坡', duration: 300, resistance: 11, targetCadence: '64-76', targetPower: '160-205W', info: '稍降阻力，維持肌耐力輸出。' },
    { name: '最後緩和', duration: 120, resistance: 4, targetCadence: '68-78', targetPower: '80-110W', info: '最後兩分鐘緩和腿部。' }
  ],
  interval: [
    { name: '暖身', duration: 180, resistance: 5, targetCadence: '72-82', targetPower: '95-125W', info: '先穩住踩踏，準備進入間歇。' },
    { name: '加壓準備', duration: 120, resistance: 8, targetCadence: '70-80', targetPower: '130-165W', info: '慢慢提高張力，不要一開始爆衝。' },
    { name: '衝刺一', duration: 60, resistance: 12, targetCadence: '68-78', targetPower: '185-230W', info: '一分鐘強輸出，核心穩住。' },
    { name: '恢復一', duration: 60, resistance: 5, targetCadence: '70-82', targetPower: '85-120W', info: '降壓恢復，但保持踩踏。' },
    { name: '衝刺二', duration: 60, resistance: 13, targetCadence: '66-76', targetPower: '195-240W', info: '第二次高峰，穩定踩壓。' },
    { name: '恢復二', duration: 60, resistance: 5, targetCadence: '70-82', targetPower: '85-120W', info: '把呼吸拉回來。' },
    { name: '衝刺三', duration: 60, resistance: 12, targetCadence: '68-78', targetPower: '185-230W', info: '最後一次高強度，品質優先。' },
    { name: '恢復三', duration: 60, resistance: 5, targetCadence: '70-82', targetPower: '85-120W', info: '穩住不要停。' },
    { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '68-78', targetPower: '70-95W', info: '最後兩分鐘緩和。' }
  ],
  pyramid: [
    { name: '暖身', duration: 180, resistance: 5, targetCadence: '72-82', targetPower: '95-125W', info: '穩定進入課表。' },
    { name: '第一階', duration: 180, resistance: 7, targetCadence: '72-82', targetPower: '125-155W', info: '逐步提高張力。' },
    { name: '第二階', duration: 180, resistance: 9, targetCadence: '70-80', targetPower: '150-185W', info: '呼吸加深，姿勢維持。' },
    { name: '高峰', duration: 180, resistance: 12, targetCadence: '66-76', targetPower: '180-225W', info: '最高點，穩住不要亂衝。' },
    { name: '下降控制', duration: 180, resistance: 9, targetCadence: '70-80', targetPower: '145-180W', info: '降低強度但不鬆掉。' },
    { name: '耐受整理', duration: 180, resistance: 7, targetCadence: '72-82', targetPower: '120-155W', info: '把節奏整理回穩。' },
    { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '68-78', targetPower: '70-95W', info: '最後兩分鐘緩和。' }
  ]
};

// === DOM 元素綁定 ===
const btnConnectBike = document.getElementById('btn-connect-bike');
const btnHealthImport = document.getElementById('btn-health-import');
const bikeConnText = document.getElementById('bike-conn-text');
const healthImportText = document.getElementById('health-import-text');
const demoToggle = document.getElementById('demo-mode-toggle');

const btnPlayPause = document.getElementById('btn-play-pause');
const btnReset = document.getElementById('btn-reset');
const personalizedModeBtn = document.getElementById('mode-personalized');
const personalizedModeDesc = document.getElementById('personalized-mode-desc');

const valPower = document.getElementById('val-power');
const valCadence = document.getElementById('val-cadence');
const valHr = document.getElementById('val-hr');
const valResistance = document.getElementById('val-resistance');
const valTime = document.getElementById('val-time');
const valCalories = document.getElementById('val-calories');
const valDistance = document.getElementById('val-distance');
const calorieRate = document.getElementById('calorie-rate');

const btnResDec = document.getElementById('btn-res-dec');
const btnResInc = document.getElementById('btn-res-inc');
const resRange = document.getElementById('res-range');

const targetPowerZone = document.getElementById('target-power-zone');
const cadenceStatus = document.getElementById('cadence-status');
const hrZone = document.getElementById('hr-zone');
const valStateText = document.getElementById('val-state-text');
const rideFeedback = document.getElementById('ride-feedback');

const roadProgress = document.getElementById('road-progress');
const roadAvatar = document.getElementById('road-avatar');
const intervalPanel = document.getElementById('interval-panel');
const intervalPhase = document.getElementById('interval-phase');
const intervalTimerDisp = document.getElementById('interval-timer');
const intervalProgress = document.getElementById('interval-progress');
const intervalNextTip = document.getElementById('interval-next-tip');

// 新增 DOM：iOS 警告、多使用者與歷史面板
const bluetoothWarningBanner = document.getElementById('bluetooth-warning-banner');
const userSelect = document.getElementById('user-select');
const btnEditProfile = document.getElementById('btn-edit-profile');
const historyList = document.getElementById('history-list');

// 相容模式與連線說明按鈕
const compatModeCheckbox = document.getElementById('compat-mode-checkbox');
const btnHelpGuide = document.getElementById('btn-help-guide');
const modalGuide = document.getElementById('modal-guide');
const btnCloseGuide = document.getElementById('btn-close-guide');

// 新增 DOM：本週累計
const weeklyCount = document.getElementById('weekly-count');
const weeklyTime = document.getElementById('weekly-time');
const weeklyCalories = document.getElementById('weekly-calories');
const weeklyDistance = document.getElementById('weekly-distance');

// 新增 DOM：設定檔 Modal
const modalProfile = document.getElementById('modal-profile');
const formProfile = document.getElementById('form-profile');
const profileModalTitle = document.getElementById('profile-modal-title');
const profileId = document.getElementById('profile-id');
const profileName = document.getElementById('profile-name');
const profileAge = document.getElementById('profile-age');
const profileWeight = document.getElementById('profile-weight');
const btnDeleteProfile = document.getElementById('btn-delete-profile');
const btnCancelProfile = document.getElementById('btn-cancel-profile');

// 新增 DOM：運動報告結算 Modal
const modalSummary = document.getElementById('modal-summary');
const sumTime = document.getElementById('sum-time');
const sumCalories = document.getElementById('sum-calories');
const sumDistance = document.getElementById('sum-distance');
const sumPower = document.getElementById('sum-power');
const sumCadence = document.getElementById('sum-cadence');
const sumHr = document.getElementById('sum-hr');
const analysisReportContent = document.getElementById('analysis-report-content');
const btnCloseSummary = document.getElementById('btn-close-summary');
const btnHealthImportSummary = document.getElementById('btn-health-import-summary');

// 健康資料匯入 Modal
const modalHealthImport = document.getElementById('modal-health-import');
const formHealthImport = document.getElementById('form-health-import');
const healthTargetRecordId = document.getElementById('health-target-record-id');
const healthAvgHr = document.getElementById('health-avg-hr');
const healthMaxHr = document.getElementById('health-max-hr');
const healthActiveKcal = document.getElementById('health-active-kcal');
const healthExerciseMin = document.getElementById('health-exercise-min');
const healthRpe = document.getElementById('health-rpe');
const healthNote = document.getElementById('health-note');
const healthImportCode = document.getElementById('health-import-code');
const btnCancelHealthImport = document.getElementById('btn-cancel-health-import');
const btnParseHealthCode = document.getElementById('btn-parse-health-code');
const healthImportFeedback = document.getElementById('health-import-feedback');
const btnExportHistory = document.getElementById('btn-export-history');
const btnImportHistory = document.getElementById('btn-import-history');
const syncCodeDisplay = document.getElementById('sync-code-display');
const modalSyncCode = document.getElementById('modal-sync-code');
const formSyncCode = document.getElementById('form-sync-code');
const syncCodeInput = document.getElementById('sync-code-input');
const syncModalTitle = document.getElementById('sync-modal-title');
const syncModalHelp = document.getElementById('sync-modal-help');
const btnCancelSyncCode = document.getElementById('btn-cancel-sync-code');
const btnSubmitSyncCode = document.getElementById('btn-submit-sync-code');
let pendingSyncCodeSubmit = null;

// === 0. 本地 LocalStorage 安全存取包裝 ===
// iOS 無痕模式或部分 WebView 會封鎖 LocalStorage，拋出 SecurityError 導致 JS 崩潰。這會使按鈕完全無反應。
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error("無法讀取 LocalStorage (可能是 iOS 無痕模式封鎖):", e);
    return null;
  }
}

function safeSetItem(key, val) {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch (e) {
    console.error("無法寫入 LocalStorage (可能是 iOS 無痕模式封鎖):", e);
    return false;
  }
}

function getPersonalizedTrainingPlan() {
  const raw = safeGetItem('antigravity_next_training_plan');
  if (!raw) return null;
  try {
    const plan = JSON.parse(raw);
    if (!plan || !Array.isArray(plan.phases) || !plan.phases.length) return null;
    return plan;
  } catch (e) {
    console.error('無法讀取個人化訓練模式:', e);
    return null;
  }
}

function getTrainingPlan(mode = state.workoutMode) {
  if (mode === 'personalized') {
    const personalized = getPersonalizedTrainingPlan();
    if (personalized) {
      return {
        ...TRAINING_PLANS.personalized,
        title: personalized.title,
        targetPower: '依階段',
        targetCadence: personalized.cadence,
        focus: personalized.focus,
        coach: personalized.reason
      };
    }
  }
  return TRAINING_PLANS[mode] || TRAINING_PLANS.free;
}

function buildPersonalizedPhases(sourceMode = 'endurance') {
  const templates = {
    recovery: [
      { name: '暖身喚醒', duration: 180, resistance: 3, targetCadence: '68-76', targetPower: '60-90W', info: '慢慢把腿轉開，保留一點阻力張力。' },
      { name: '恢復巡航', duration: 420, resistance: 4, targetCadence: '68-78', targetPower: '70-105W', info: '呼吸要能完整講話，不追瓦數。' },
      { name: '穩踩整理', duration: 360, resistance: 5, targetCadence: '68-78', targetPower: '85-120W', info: '短暫加一點張力，檢查踩踏是否穩定。' },
      { name: '最後緩和', duration: 120, resistance: 2, targetCadence: '64-74', targetPower: '50-80W', info: '最後兩分鐘放鬆收操。' }
    ],
    cadence: [
      { name: '暖身張力', duration: 180, resistance: 5, targetCadence: '68-78', targetPower: '85-115W', info: '不用高轉，先建立穩定踩壓。' },
      { name: '穩踩主段', duration: 300, resistance: 7, targetCadence: '68-78', targetPower: '110-145W', info: '每一下踩踏都要穩，不要左右晃。' },
      { name: '肌耐力高點', duration: 300, resistance: 9, targetCadence: '66-76', targetPower: '135-170W', info: '中高阻力，但不要硬頂到膝蓋不舒服。' },
      { name: '節奏整理', duration: 180, resistance: 7, targetCadence: '68-78', targetPower: '110-145W', info: '回到穩定節奏，讓呼吸可控。' },
      { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '64-74', targetPower: '60-90W', info: '最後兩分鐘緩和。' }
    ],
    endurance: [
      { name: '暖身', duration: 240, resistance: 4, targetCadence: '68-78', targetPower: '80-110W', info: '從可控阻力開始，不急著拉高。' },
      { name: '基礎巡航', duration: 420, resistance: 6, targetCadence: '70-80', targetPower: '105-140W', info: '穩住呼吸和踩踏，不追高轉。' },
      { name: '穩定主段', duration: 480, resistance: 7, targetCadence: '70-80', targetPower: '120-155W', info: '主段重點是穩，不是爆衝。' },
      { name: '耐力加壓', duration: 240, resistance: 8, targetCadence: '68-78', targetPower: '130-165W', info: '最後主段稍微加壓，姿勢不能散。' },
      { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '64-74', targetPower: '60-90W', info: '最後兩分鐘降壓。' }
    ],
    tempo: [
      { name: '暖身', duration: 240, resistance: 5, targetCadence: '68-78', targetPower: '90-120W', info: '先建立張力。' },
      { name: '節奏建立', duration: 360, resistance: 8, targetCadence: '68-78', targetPower: '120-155W', info: '進入可控辛苦區。' },
      { name: '高峰巡航', duration: 420, resistance: 10, targetCadence: '66-76', targetPower: '145-185W', info: '呼吸變深，但踩踏要穩。' },
      { name: '強度收束', duration: 120, resistance: 8, targetCadence: '68-78', targetPower: '120-155W', info: '不要突然放掉，先收住節奏。' },
      { name: '最後緩和', duration: 120, resistance: 3, targetCadence: '64-74', targetPower: '60-90W', info: '最後兩分鐘緩和。' }
    ]
  };
  return templates[sourceMode] || templates.endurance;
}

function savePersonalizedTrainingPlan(prescription, record) {
  const phases = prescription.phases || buildPersonalizedPhases(prescription.mode);
  const totalSeconds = phases.reduce((sum, phase) => sum + phase.duration, 0);
  const plan = {
    id: `next_${Date.now()}`,
    sourceRecordId: record.id,
    createdAt: new Date().toISOString(),
    title: prescription.title,
    mode: 'personalized',
    sourceMode: prescription.mode,
    duration: prescription.duration,
    cadence: prescription.cadence,
    resistance: prescription.resistance,
    focus: prescription.focus,
    reason: prescription.reason,
    totalMinutes: Math.round(totalSeconds / 60),
    phases
  };
  safeSetItem('antigravity_next_training_plan', JSON.stringify(plan));
  updatePersonalizedModeCard();
  return plan;
}

function updatePersonalizedModeCard() {
  if (!personalizedModeBtn || !personalizedModeDesc) return;
  const plan = getPersonalizedTrainingPlan();
  if (!plan) {
    personalizedModeBtn.classList.add('hidden');
    return;
  }
  personalizedModeBtn.classList.remove('hidden');
  personalizedModeDesc.innerText = `${plan.title} / ${plan.totalMinutes || '?'} 分鐘。${plan.focus}`;
}

// === 初始化 ===
function safeInit() {
  try {
    detectBluetoothSupport();
    initUsers();
    updatePersonalizedModeCard();
    updateSyncCodeBadge();
    setupEventListeners();
    updateUI();
    handleInboundHealthImport();
  } catch (err) {
    showOnScreenError(`初始化失敗: ${err.message}\n堆疊: ${err.stack}`);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}

// 1. 偵測 iOS 與 Web Bluetooth 支援度
function detectBluetoothSupport() {
  if (!navigator.bluetooth) {
    bluetoothWarningBanner.classList.remove('hidden');
    console.warn("目前瀏覽器環境不支援 Web Bluetooth API。iOS 請使用 Bluefy 瀏覽器！");
  } else {
    bluetoothWarningBanner.classList.add('hidden');
  }
}

// 2. 初始化使用者管理 (LocalStorage)
function initUsers() {
  const localDb = safeGetItem('antigravity_cycling_db');
  if (localDb) {
    try {
      db = JSON.parse(localDb);
    } catch (e) {
      console.error("載入使用者資料庫出錯，使用預設值:", e);
      db = { users: [DEFAULT_USER], activeUserId: 'default' };
    }
  } else {
    db = {
      users: [DEFAULT_USER],
      activeUserId: 'default'
    };
    saveDb();
  }

  renderUserSelect();
  loadHistory();
}

function saveDb() {
  safeSetItem('antigravity_cycling_db', JSON.stringify(db));
}

// 渲染使用者下拉選單
function renderUserSelect() {
  userSelect.innerHTML = '';
  db.users.forEach(user => {
    const opt = document.createElement('option');
    opt.value = user.id;
    opt.innerText = user.name;
    userSelect.appendChild(opt);
  });

  const optNew = document.createElement('option');
  optNew.value = 'new';
  optNew.innerText = '➕ 新增使用者檔案...';
  userSelect.appendChild(optNew);

  userSelect.value = db.activeUserId;
}

// 取得當前活躍使用者檔案
function getActiveUser() {
  const user = db.users.find(u => u.id === db.activeUserId);
  return user || DEFAULT_USER;
}

// === 事件監聽綁定 ===
function setupEventListeners() {
  // 連線控制
  btnConnectBike.addEventListener('click', connectBike);
  btnHealthImport.addEventListener('click', () => openHealthImportModal());
  demoToggle.addEventListener('change', handleDemoModeToggle);

  // 相容模式與說明按鈕
  compatModeCheckbox.addEventListener('change', (e) => {
    state.useCompatMode = e.target.checked;
    console.log(`已切換相容模式狀態: ${state.useCompatMode}`);
  });

  btnHelpGuide.addEventListener('click', () => {
    modalGuide.classList.remove('hidden');
  });

  btnCloseGuide.addEventListener('click', () => {
    modalGuide.classList.add('hidden');
  });

  // 運動控制
  btnPlayPause.addEventListener('click', handlePlayPause);
  btnReset.addEventListener('click', handleWorkoutResetClick);

  // 阻力調整
  btnResDec.addEventListener('click', () => adjustResistance(-1));
  btnResInc.addEventListener('click', () => adjustResistance(1));

  // 模式選擇
  document.querySelectorAll('.workout-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modeBtn = e.currentTarget;
      document.querySelectorAll('.workout-btn').forEach(b => b.classList.remove('active'));
      modeBtn.classList.add('active');
      setWorkoutMode(modeBtn.dataset.mode);
    });
  });

  // 使用者切換事件
  userSelect.addEventListener('change', (e) => {
    if (e.target.value === 'new') {
      openProfileModal(true);
    } else {
      db.activeUserId = e.target.value;
      saveDb();
      resetWorkout();
      loadHistory();
      updateUI();
    }
  });

  // 個人檔案編輯按鈕
  btnEditProfile.addEventListener('click', () => {
    openProfileModal(false);
  });

  // 取消檔案設定
  btnCancelProfile.addEventListener('click', () => {
    modalProfile.classList.add('hidden');
    userSelect.value = db.activeUserId;
  });

  // 刪除檔案設定
  btnDeleteProfile.addEventListener('click', handleDeleteProfile);

  // 儲存檔案表單提交
  formProfile.addEventListener('submit', handleSaveProfile);

  // 關閉報告視窗
  btnCloseSummary.addEventListener('click', () => {
    modalSummary.classList.add('hidden');
    resetWorkout();
  });

  btnHealthImportSummary.addEventListener('click', () => {
    openHealthImportModal(getLatestRecordForActiveUser()?.id);
  });

  btnCancelHealthImport.addEventListener('click', () => {
    modalHealthImport.classList.add('hidden');
  });

  btnParseHealthCode.addEventListener('click', parseHealthImportCodeIntoForm);
  formHealthImport.addEventListener('submit', handleSaveHealthImport);

  // 歷史紀錄雲端備份與還原
  btnExportHistory.addEventListener('click', exportHistoryToCloud);
  btnImportHistory.addEventListener('click', importHistoryFromCloud);
  if (formSyncCode) {
    formSyncCode.addEventListener('submit', handleSyncCodeSubmit);
  }
  if (btnCancelSyncCode) {
    btnCancelSyncCode.addEventListener('click', closeSyncCodeModal);
  }
  if (syncCodeDisplay) {
    syncCodeDisplay.addEventListener('click', handleSyncCodeBadgeClick);
  }
}

// === 個人檔案編輯 Modal 控制 ===
function openProfileModal(isNew = false) {
  modalProfile.classList.remove('hidden');

  if (isNew) {
    profileModalTitle.innerText = '建立新使用者設定';
    profileId.value = 'user_' + Date.now();
    profileName.value = '';
    profileAge.value = 30;
    profileWeight.value = 70;
    document.querySelector('input[name="profile-gender"][value="male"]').checked = true;
    btnDeleteProfile.classList.add('hidden');
  } else {
    profileModalTitle.innerText = '設定個人檔案';
    const user = getActiveUser();
    profileId.value = user.id;
    profileName.value = user.name;
    profileAge.value = user.age;
    profileWeight.value = user.weight;
    const genderVal = user.gender || 'male';
    const genderRadio = document.querySelector(`input[name="profile-gender"][value="${genderVal}"]`);
    if (genderRadio) {
      genderRadio.checked = true;
    }

    if (user.id === 'default') {
      btnDeleteProfile.classList.add('hidden');
    } else {
      btnDeleteProfile.classList.remove('hidden');
    }
  }
}

function handleSaveProfile(e) {
  e.preventDefault();

  const id = profileId.value;
  const name = profileName.value.trim() || '未命名';
  const age = parseInt(profileAge.value) || 30;
  const weight = parseInt(profileWeight.value) || 70;
  const gender = document.querySelector('input[name="profile-gender"]:checked').value;

  const existingUserIndex = db.users.findIndex(u => u.id === id);
  const newUser = { id, name, age, weight, gender };

  if (existingUserIndex >= 0) {
    db.users[existingUserIndex] = newUser;
  } else {
    db.users.push(newUser);
  }

  db.activeUserId = id;
  saveDb();
  renderUserSelect();
  modalProfile.classList.add('hidden');

  resetWorkout();
  loadHistory();
  updateUI();
}

function handleDeleteProfile() {
  const id = profileId.value;
  if (id === 'default') return;

  if (confirm(`確定要刪除使用者「${profileName.value}」嗎？這將會清除該用戶的所有數據。`)) {
    db.users = db.users.filter(u => u.id !== id);

    let history = getHistoryFromStorage();
    history = history.filter(h => h.userId !== id);
    safeSetItem('antigravity_cycling_history', JSON.stringify(history));

    db.activeUserId = 'default';
    saveDb();
    renderUserSelect();
    modalProfile.classList.add('hidden');

    resetWorkout();
    loadHistory();
    updateUI();
  }
}

// === 運動模式設定 ===
function setWorkoutMode(mode) {
  state.workoutMode = mode;
  const plan = getTrainingPlan(mode);

  state.modeStartedElapsed = state.isPlaying ? state.elapsedTime : 0;
  state.intervalTimeElapsed = 0;
  state.intervalPhaseIndex = 0;
  state.lastAutoResistance = null;
  state.lastPhaseKey = '';

  if (getActivePhases().length) {
    updateTrainingPhase({ forceResistance: true, announce: true });
  } else {
    intervalPanel.classList.add('hidden');
    targetPowerZone.innerText = `目標瓦數: ${plan.targetPower}`;
    resRange.innerText = '手動阻力';
    updateFeedback(`${plan.title}：${plan.coach}`);
  }
}

// === 藍牙連線：飛輪 (FTMS) ===
async function connectBike() {
  if (state.isBikeConnected) {
    disconnectBike();
    return;
  }

  // 安全守衛：避免在未支援藍牙的瀏覽器點擊拋出 crash 導致按鈕失去反應
  if (!navigator.bluetooth) {
    updateFeedback('🚫 您的瀏覽器不支援藍牙 API。請在 iPhone 下載免費的 Bluefy 瀏覽器，並於「設定」中啟用其藍牙權限。');
    modalGuide.classList.remove('hidden'); // 直接跳出教學導引
    return;
  }

  try {
    updateFeedback('正在搜尋飛輪裝置...');

    const options = state.useCompatMode ? {
      acceptAllDevices: true,
      optionalServices: [FTMS_SERVICE_UUID]
    } : {
      filters: [{ services: [FTMS_SERVICE_UUID] }],
      optionalServices: [FTMS_SERVICE_UUID]
    };

    state.bikeDevice = await navigator.bluetooth.requestDevice(options);

    updateFeedback('正在連線飛輪...');
    const server = await state.bikeDevice.gatt.connect();

    updateFeedback('正在取得飛輪服務...');
    const service = await server.getPrimaryService(FTMS_SERVICE_UUID);

    // 監聽數據特徵值
    updateFeedback('正在讀取騎行數據流...');
    const dataChar = await service.getCharacteristic(INDOOR_BIKE_DATA_CHAR_UUID);
    await dataChar.startNotifications();
    dataChar.addEventListener('characteristicvaluechanged', handleIndoorBikeData);

    // 取得阻力控制特徵值
    try {
      state.controlPointChar = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT_CHAR_UUID);
      await requestControl();
    } catch (e) {
      console.warn("此飛輪不支援阻力寫入控制:", e);
      updateFeedback('已連線飛輪，但此飛輪不支援雙向阻力控制。');
    }

    state.isBikeConnected = true;
    state.autoStartBlocked = false;
    btnConnectBike.classList.remove('btn-primary');
    btnConnectBike.classList.add('btn-secondary');
    bikeConnText.innerText = '中斷飛輪';
    btnPlayPause.disabled = false;

    updateFeedback('飛輪連線成功。選好課表後直接踩踏，系統會自動開始計時；也可按「手動開始」。');
    updateUI();
  } catch (error) {
    console.error('飛輪連線失敗:', error);
    let errMsg = error.message || error.toString();
    let errName = error.name || 'Error';
    if (errMsg.includes('User cancelled') || errMsg.includes('cancelled') || errName.includes('User cancelled') || errName.includes('cancelled')) {
      updateFeedback('連線取消：您未選擇任何藍牙設備。');
    } else {
      updateFeedback(`飛輪連線失敗: [${errName}] ${errMsg} (代碼: ${error.code || '無'})`);
    }
  }
}

function disconnectBike() {
  if (state.bikeDevice && state.bikeDevice.gatt.connected) {
    state.bikeDevice.gatt.disconnect();
  }
  state.isBikeConnected = false;
  state.controlPointChar = null;
  btnConnectBike.classList.remove('btn-secondary');
  btnConnectBike.classList.add('btn-primary');
  bikeConnText.innerText = '連線飛輪';

  if (!state.isDemoMode) {
    btnPlayPause.disabled = true;
    pauseWorkout();
  }

  updateFeedback('飛輪已中斷連線。');
  updateUI();
}

async function requestControl() {
  if (state.controlPointChar) {
    await state.controlPointChar.writeValueWithResponse(new Uint8Array([0x00]));
    console.log("已成功取得飛輪控制權 (Request Control Success)");
  }
}

async function sendResistanceToBike(level) {
  if (state.controlPointChar && state.isBikeConnected) {
    const target = Math.max(1, Math.min(24, Math.round(Number(level) || 1)));
    try {
      const buffer = new ArrayBuffer(3);
      const view = new DataView(buffer);
      view.setUint8(0, 0x04);
      view.setInt16(1, target * 10, true);
      await state.controlPointChar.writeValueWithResponse(buffer);
      console.log(`已向飛輪發送阻力指令: ${target}`);
    } catch (e) {
      try {
        await state.controlPointChar.writeValueWithResponse(new Uint8Array([0x04, target]));
        console.log(`已用相容格式發送阻力指令: ${target}`);
      } catch (fallbackError) {
        console.error("發送阻力指令失敗:", e, fallbackError);
      }
    }
  }
}

// === 數據流解析 ===

function handleIndoorBikeData(event) {
  const dataView = event.target.value;
  const flags = dataView.getUint16(0, true);
  let offset = 2;

  if ((flags & 0x0001) === 0) {
    state.speed = dataView.getUint16(offset, true) / 100.0;
    offset += 2;
  }
  if (flags & 0x0002) offset += 2;

  if (flags & 0x0004) {
    state.cadence = dataView.getUint16(offset, true) / 2.0;
    offset += 2;
  }
  if (flags & 0x0008) offset += 2;

  if (flags & 0x0010) {
    const d0 = dataView.getUint8(offset);
    const d1 = dataView.getUint8(offset + 1);
    const d2 = dataView.getUint8(offset + 2);
    state.distance = (d0 | (d1 << 8) | (d2 << 16)) / 1000.0;
    offset += 3;
  }
  if (flags & 0x0020) {
    const rawResistance = dataView.getInt16(offset, true);
    const normalizedResistance = Math.abs(rawResistance) > 24 ? rawResistance / 10 : rawResistance;
    state.resistance = Math.max(1, Math.min(24, Math.round(normalizedResistance)));
    offset += 2;
  }
  if (flags & 0x0040) {
    state.power = dataView.getInt16(offset, true);
    offset += 2;
  }

  maybeAutoStartFromPedaling();
  collectWorkoutSample();
  updateTrainingPhase();
  updateUI();
  updateAnimationSpeeds();
}

// === 運動核心計時 ===
function handlePlayPause() {
  if (state.isPlaying) {
    pauseWorkout('manual');
  } else {
    state.autoStartBlocked = false;
    startWorkout();
  }
}

function startWorkout(trigger = 'manual') {
  if (!state.workoutStartedAt) {
    state.workoutStartedAt = new Date().toISOString();
    state.modeStartedElapsed = state.elapsedTime;
  }
  state.isPlaying = true;
  valStateText.innerText = '騎行中';
  btnPlayPause.innerText = '暫停騎行';
  btnPlayPause.classList.remove('btn-primary');
  btnPlayPause.classList.add('btn-secondary');

  if (!state.mainTimer) {
    state.mainTimer = setInterval(tickWorkout, 1000);
  }

  updateTrainingPhase({ forceResistance: true, announce: true });
  if (state.isDemoMode) startDemoGenerator();

  updateFeedback(trigger === 'auto' ? '偵測到踩踏，已自動開始計時。跟著目前課表阻力騎。' : '運動已開始。跟著課表階段騎，不用手動猜阻力。');
}

function pauseWorkout(reason = 'manual') {
  state.isPlaying = false;
  if (reason === 'manual') {
    state.autoStartBlocked = true;
  }
  valStateText.innerText = '已暫停';
  btnPlayPause.innerText = '手動開始';
  btnPlayPause.classList.remove('btn-secondary');
  btnPlayPause.classList.add('btn-primary');

  if (state.mainTimer) { clearInterval(state.mainTimer); state.mainTimer = null; }
  if (state.demoTimer) { clearInterval(state.demoTimer); state.demoTimer = null; }
  if (state.intervalTimer) { clearInterval(state.intervalTimer); state.intervalTimer = null; }

  state.cadence = 0;
  state.power = 0;
  state.speed = 0;
  updateAnimationSpeeds();
  updateUI();
  updateFeedback('已暫停運動，數據已暫存。若欲結束，請點擊右方「結束並存檔」。');
}

function handleWorkoutResetClick() {
  if (state.elapsedTime > 5) {
    saveAndShowSummary();
    resetWorkout('saved');
  } else {
    resetWorkout();
  }
}

function resetWorkout(reason = 'reset') {
  pauseWorkout('reset');
  state.elapsedTime = 0;
  state.calories = 0;
  state.distance = 0.0;
  state.power = 0;
  state.cadence = 0;
  state.speed = 0.0;
  state.intervalTimeElapsed = 0;
  state.intervalPhaseIndex = 0;
  state.modeStartedElapsed = 0;
  state.lastAutoResistance = null;
  state.lastPhaseKey = '';
  state.autoStartBlocked = false;
  state.workoutStartedAt = null;

  state.powerSamples = [];
  state.cadenceSamples = [];
  state.maxPower = 0;

  valTime.innerText = '00:00:00';
  valStateText.innerText = '未開始';
  valCalories.innerText = '0';
  valDistance.innerText = '0.00';
  calorieRate.innerText = '0 kcal/hr';
  roadProgress.style.width = '0%';
  roadAvatar.style.left = '0%';

  setWorkoutMode(state.workoutMode);
  updateFeedback(reason === 'saved' ? '訓練已存檔。請匯入健康資料，完成這次騎行回饋。' : '運動紀錄已重置。');
  updateUI();
}

function tickWorkout() {
  state.elapsedTime++;

  const hours = String(Math.floor(state.elapsedTime / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((state.elapsedTime % 3600) / 60)).padStart(2, '0');
  const seconds = String(state.elapsedTime % 60).padStart(2, '0');
  valTime.innerText = `${hours}:${minutes}:${seconds}`;

  const currentUser = getActiveUser();

  let kcalSec = 0;
  let method = '估算';

  if (state.power > 0) {
    kcalSec = state.power / 1000.0;
    method = '功率功';
  } else {
    if (state.speed > 0) {
      kcalSec = (currentUser.weight * 0.08) / 60.0;
      method = '速度粗估';
    }
  }

  if (kcalSec > 0) {
    state.calories += kcalSec;
    valCalories.innerText = Math.round(state.calories);
    const hrRate = Math.round(kcalSec * 3600);
    calorieRate.innerText = `${hrRate} kcal/hr (${method})`;
  }

  if (state.isDemoMode && state.speed > 0) {
    state.distance += state.speed / 3600.0;
    valDistance.innerText = state.distance.toFixed(2);
  }

  const progressPercent = Math.min((state.distance / 10.0) * 100, 100);
  roadProgress.style.width = `${progressPercent}%`;
  roadAvatar.style.left = `${progressPercent}%`;

  updateTrainingPhase();

  if (state.distance >= 10.0 && state.distance - (state.speed / 3600.0) < 10.0) {
    updateFeedback('🎉 太棒了！您已完成 10 公里虛擬里程碑！');
  }
}

// === 智慧數據結算存檔 ===
function saveAndShowSummary() {
  const user = getActiveUser();

  const avgPower = state.powerSamples.length > 0 ?
    Math.round(state.powerSamples.reduce((a,b)=>a+b, 0) / state.powerSamples.length) : 0;

  const avgCadence = state.cadenceSamples.length > 0 ?
    Math.round(state.cadenceSamples.reduce((a,b)=>a+b, 0) / state.cadenceSamples.length) : 0;

  const startDate = state.workoutStartedAt || new Date(Date.now() - state.elapsedTime * 1000).toISOString();
  const endDate = new Date().toISOString();
  const plan = getTrainingPlan(state.workoutMode);
  const stabilityScore = calculateStabilityScore(state.powerSamples, state.cadenceSamples);
  const intensityScore = calculateIntensityScore(avgPower, user.weight, state.workoutMode);
  const completionScore = calculateCompletionScore(state.elapsedTime, state.workoutMode);
  const coachScore = Math.round((stabilityScore * 0.4) + (intensityScore * 0.35) + (completionScore * 0.25));

  const record = {
    id: 'workout_' + Date.now(),
    userId: user.id,
    userName: user.name,
    date: new Date().toISOString(),
    startDate,
    endDate,
    mode: state.workoutMode,
    modeTitle: plan.title,
    duration: state.elapsedTime,
    distance: parseFloat(state.distance.toFixed(2)),
    calories: Math.round(state.calories),
    avgPower,
    maxPower: state.maxPower,
    avgCadence,
    stabilityScore,
    intensityScore,
    completionScore,
    coachScore,
    healthImported: false,
    healthMetrics: null
  };

  const history = getHistoryFromStorage();
  history.unshift(record);
  safeSetItem('antigravity_cycling_history', JSON.stringify(history));

  renderSummary(record, user);
  modalSummary.classList.remove('hidden');

  loadHistory();
}

function getHistoryFromStorage() {
  const localHistory = safeGetItem('antigravity_cycling_history');
  if (localHistory) {
    try { return JSON.parse(localHistory); } catch(e) { return []; }
  }
  return [];
}

function renderSummary(record, user = getActiveUser()) {
  sumTime.innerText = formatDuration(record.duration);
  sumCalories.innerText = `${getDisplayCalories(record)} kcal`;
  sumDistance.innerText = `${Number(record.distance || 0).toFixed(2)} km`;
  sumPower.innerText = `${record.avgPower || 0} / ${record.maxPower || 0} W`;
  sumCadence.innerText = `${record.avgCadence || 0} RPM`;
  sumHr.innerText = record.healthImported ? formatHealthSummary(record.healthMetrics) : '尚未匯入';
  generateSportsAdvice(record, user);
}

function getLatestRecordForActiveUser() {
  const user = getActiveUser();
  return getHistoryFromStorage().find(record => record.userId === user.id) || null;
}

function findRecordById(recordId) {
  return getHistoryFromStorage().find(record => record.id === recordId) || null;
}

const SYNC_BUCKET = 'USttZbN2suPCwch8W2QRuH';

function updateSyncCodeBadge() {
  if (!syncCodeDisplay) return;
  const syncCode = safeGetItem('antigravity_sync_code');
  if (syncCode) {
    const cleanCode = syncCode.trim();
    if (cleanCode.length === 6 && !isNaN(Number(cleanCode))) {
      syncCodeDisplay.innerText = `🔑 同步碼: ${cleanCode}`;
      syncCodeDisplay.style.display = 'inline-flex';
      return;
    }
  }
  syncCodeDisplay.style.display = 'none';
}

function handleSyncCodeBadgeClick() {
  const syncCode = safeGetItem('antigravity_sync_code');
  if (!syncCode) return;

  openSyncCodeModal({
    title: '修改雲端同步碼',
    help: `目前同步碼為【${syncCode.trim()}】。若要重新綁定另一台設備，請輸入新的 6 位數同步碼。`,
    defaultValue: syncCode.trim(),
    buttonText: '儲存同步碼',
    onSubmit: (cleanCode) => {
      safeSetItem('antigravity_sync_code', cleanCode);
      updateSyncCodeBadge();
      updateFeedback(`✅ 同步碼已修改為：${cleanCode}`);
      closeSyncCodeModal();
      alert(`🎉 同步碼已成功修改為【${cleanCode}】！`);
    }
  });
}

function openSyncCodeModal({ title, help, defaultValue = '', buttonText = '開始下載', onSubmit }) {
  if (!modalSyncCode || !syncCodeInput) {
    const input = prompt(help, defaultValue);
    if (input) onSubmit(input.trim());
    return;
  }

  pendingSyncCodeSubmit = onSubmit;
  syncModalTitle.innerText = title;
  syncModalHelp.innerText = help;
  syncCodeInput.value = defaultValue;
  if (btnSubmitSyncCode) btnSubmitSyncCode.innerText = buttonText;
  modalSyncCode.classList.remove('hidden');
  setTimeout(() => syncCodeInput.focus(), 50);
}

function closeSyncCodeModal() {
  if (modalSyncCode) modalSyncCode.classList.add('hidden');
  pendingSyncCodeSubmit = null;
}

function handleSyncCodeSubmit(e) {
  e.preventDefault();
  const cleanCode = (syncCodeInput?.value || '').trim();
  if (cleanCode.length !== 6 || isNaN(Number(cleanCode))) {
    updateFeedback('❌ 同步碼格式錯誤，必須為 6 位數字。');
    alert('❌ 同步碼格式錯誤，必須為 6 位數字！');
    return;
  }

  if (typeof pendingSyncCodeSubmit === 'function') {
    pendingSyncCodeSubmit(cleanCode);
  }
}

function exportHistoryToCloud() {
  try {
    const history = getHistoryFromStorage();
    const localDb = safeGetItem('antigravity_cycling_db');
    let dbObj = {};
    if (localDb) {
      try { dbObj = JSON.parse(localDb); } catch(e) {}
    }

    const backupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      summary: {
        historyCount: history.length
      },
      history: history,
      db: dbObj
    };

    // 檢查是否有儲存的同步碼，若無則生成一個
    let syncCode = safeGetItem('antigravity_sync_code');
    let isFirstTime = false;
    if (syncCode) {
      syncCode = syncCode.trim();
    }
    if (!syncCode || syncCode.length !== 6 || isNaN(Number(syncCode))) {
      syncCode = String(Math.floor(100000 + Math.random() * 900000));
      safeSetItem('antigravity_sync_code', syncCode);
      isFirstTime = true;
    }

    updateFeedback('正在上傳備份至雲端...');

    // 使用較長效的 TTL (例如 30 天 = 2592000 秒) 讓同步碼可以重複、長期使用
    fetch(`https://kvdb.io/${SYNC_BUCKET}/sync_${syncCode}?ttl=2592000`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(backupData)
    })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP 錯誤 ${res.status}`);
      return res.text();
    })
    .then(() => {
      updateSyncCodeBadge();
      if (isFirstTime) {
        alert(`🎉 首次雲端上傳成功！\n\n本次已備份 ${history.length} 筆騎行紀錄。\n\n已為您產生專屬的 6 位數同步碼：\n\n👉【 ${syncCode} 】\n\n請在另一台設備上點選「從雲端下載」並輸入此同步碼進行首次綁定。\n\n之後兩台設備將會自動記憶此號碼，一鍵即可完成上傳與下載，不需再次輸入！`);
      } else {
        alert(`🎉 雲端備份上傳成功！\n\n本次已備份 ${history.length} 筆騎行紀錄。\n\n（專屬同步碼：${syncCode}，已自動記錄於本設備）`);
      }
      updateFeedback(`✅ 雲端備份成功！已備份 ${history.length} 筆，同步碼：${syncCode}`);
    })
    .catch(err => {
      alert(`❌ 雲端上傳失敗：${err.message}`);
      updateFeedback(`❌ 雲端上傳失敗：${err.message}`);
    });
  } catch (err) {
    updateFeedback(`❌ 上傳失敗：${err.message}`);
  }
}

function importHistoryFromCloud() {
  updateFeedback('已點選雲端下載。正在檢查同步碼...');

  let syncCode = safeGetItem('antigravity_sync_code');
  if (syncCode) {
    syncCode = syncCode.trim();
  }

  if (syncCode && syncCode.length === 6 && !isNaN(Number(syncCode))) {
    downloadHistoryWithCode(syncCode, true);
    return;
  }

  openSyncCodeModal({
    title: '從雲端下載',
    help: '請輸入另一台設備「上傳至雲端」後產生的 6 位數同步碼。',
    defaultValue: '',
    buttonText: '開始下載',
    onSubmit: (cleanCode) => {
      safeSetItem('antigravity_sync_code', cleanCode);
      closeSyncCodeModal();
      downloadHistoryWithCode(cleanCode, false);
    }
  });
}

function downloadHistoryWithCode(syncCode, isAutoDownload) {
  updateFeedback('正在從雲端下載歷史紀錄...');

  fetch(`https://kvdb.io/${SYNC_BUCKET}/sync_${syncCode}?cb=${Date.now()}`, {
    cache: 'no-store'
  })
  .then(res => {
    if (res.status === 404) {
      throw new Error(`找不到同步碼【${syncCode}】的雲端資料。請確認號碼是否正確，或者上傳端是否已成功上傳過資料。`);
    }
    if (!res.ok) throw new Error(`HTTP 錯誤 ${res.status}`);
    return res.json();
  })
  .then(data => {
    if (!data.history || !Array.isArray(data.history)) {
      throw new Error('無效的備份檔案格式。');
    }

    // 1. 合併使用者資料庫 (db)
    const localDb = safeGetItem('antigravity_cycling_db');
    let currentDb = { users: [DEFAULT_USER], activeUserId: 'default' };
    if (localDb) {
      try { currentDb = JSON.parse(localDb); } catch(e) {}
    }

    const backupDb = data.db || {};
    const backupUsers = backupDb.users || [];
    const currentUsers = currentDb.users || [];

    // 合併使用者清單，ID 不重複
    const mergedUsers = [...currentUsers];
    backupUsers.forEach(bu => {
      if (!mergedUsers.some(u => u.id === bu.id)) {
        mergedUsers.push(bu);
      }
    });

    // 2. 合併騎行歷史紀錄：同 ID 視為同一筆，雲端版本較新時覆蓋本機。
    const currentHistory = getHistoryFromStorage();
    const backupHistory = data.history;
    let addedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const mergedHistory = [...currentHistory];
    backupHistory.forEach(bh => {
      if (!bh || typeof bh !== 'object') return;

      const existingIndex = mergedHistory.findIndex(h => h.id && bh.id && h.id === bh.id);
      if (existingIndex === -1) {
        mergedHistory.push(bh);
        addedCount++;
        return;
      }

      const existing = mergedHistory[existingIndex];
      if (JSON.stringify(existing) === JSON.stringify(bh)) {
        unchangedCount++;
        return;
      }

      mergedHistory[existingIndex] = bh;
      updatedCount++;
    });

    const preferredUserId = backupHistory.find(record => record && record.userId)?.userId || backupDb.activeUserId || 'default';
    if (!mergedUsers.some(user => user.id === preferredUserId)) {
      mergedUsers.push({
        ...DEFAULT_USER,
        id: preferredUserId,
        name: backupHistory.find(record => record && record.userId === preferredUserId)?.userName || '雲端使用者'
      });
    }
    currentDb.users = mergedUsers;
    currentDb.activeUserId = preferredUserId;

    // 儲存使用者資料庫，並切到雲端紀錄所屬使用者，避免下載後被使用者篩選隱藏。
    safeSetItem('antigravity_cycling_db', JSON.stringify(currentDb));
    
    // 依時間排序歷史紀錄 (最新優先)
    mergedHistory.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
    
    safeSetItem('antigravity_cycling_history', JSON.stringify(mergedHistory));

    // 更新 UI 中的同步碼徽章
    updateSyncCodeBadge();

    // 3. 重新讀取與渲染 UI
    initUsers(); // 會呼叫 loadHistory() 與 updateUI()

    const cloudCount = backupHistory.length;
    const activeUserName = currentDb.users.find(user => user.id === preferredUserId)?.name || '雲端使用者';
    const syncSummary = `雲端同步 ${cloudCount} 筆：新增 ${addedCount}、更新 ${updatedCount}、已在手機 ${unchangedCount}。已切換到「${activeUserName}」。`;

    if (isAutoDownload) {
      alert(`🎉 雲端自動下載完成！\n\n${syncSummary}\n\n（使用同步碼：${syncCode}）`);
    } else {
      alert(`🎉 首次同步與綁定成功！\n\n${syncSummary}\n\n已自動為您記錄同步碼：${syncCode}，下次下載將直接自動同步，不需再次輸入！`);
    }
    updateFeedback(`🎉 同步完成：${syncSummary}`);
  })
  .catch(err => {
    alert(`❌ 下載失敗：${err.message}`);
    updateFeedback(`❌ 下載失敗：${err.message}`);
    
    // 如果是首次輸入錯誤導致下載失敗，可以清除不正確的 sync_code
    if (!isAutoDownload) {
      try {
        localStorage.removeItem('antigravity_sync_code');
      } catch (e) {
        console.error('無法清除同步碼:', e);
      }
      updateSyncCodeBadge();
    }
  });
}

function getDisplayCalories(record) {
  return Math.round(record.healthMetrics?.activeKcal || record.calories || 0);
}

function calculateStabilityScore(powerSamples, cadenceSamples) {
  const powerScore = scoreSeriesStability(powerSamples);
  const cadenceScore = scoreSeriesStability(cadenceSamples);
  return Math.round((powerScore + cadenceScore) / 2);
}

function scoreSeriesStability(samples) {
  if (!samples || samples.length < 5) return 60;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (avg <= 0) return 60;
  const variance = samples.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / samples.length;
  const cv = Math.sqrt(variance) / avg;
  return Math.max(35, Math.min(100, Math.round(100 - cv * 180)));
}

function calculateIntensityScore(avgPower, weight, mode) {
  if (!avgPower || !weight) return 55;
  const wattsPerKg = avgPower / weight;
  const base = Math.round(wattsPerKg * 35);
  const bonus = ['tempo', 'climb', 'interval', 'pyramid'].includes(mode) ? 10 : 0;
  return Math.max(35, Math.min(100, base + bonus));
}

function calculateCompletionScore(durationSeconds, mode) {
  const phaseDuration = getPlanDuration(mode);
  const targetMinutes = phaseDuration ? phaseDuration / 60 : 15;
  return Math.max(20, Math.min(100, Math.round((durationSeconds / 60 / targetMinutes) * 100)));
}

function parseRange(text) {
  const match = String(text).match(/(\d+)\s*[~\-]\s*(\d+)/);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

function showHealthImportFeedback(text, type = 'info') {
  if (!healthImportFeedback) return;
  healthImportFeedback.innerText = text;
  healthImportFeedback.className = `modal-feedback-msg ${type}`;
  healthImportFeedback.classList.remove('hidden');
}

function hideHealthImportFeedback() {
  if (!healthImportFeedback) return;
  healthImportFeedback.classList.add('hidden');
}

function openHealthImportModal(recordId = null) {
  hideHealthImportFeedback();
  const target = recordId ? findRecordById(recordId) : getLatestRecordForActiveUser();
  if (!target) {
    // 即使沒有騎行紀錄，也允許開啟彈窗進行解析，但給予明確引導
    healthTargetRecordId.value = '';
    healthAvgHr.value = '';
    healthMaxHr.value = '';
    healthActiveKcal.value = '';
    healthExerciseMin.value = '';
    healthRpe.value = '';
    healthNote.value = '';
    healthImportCode.value = '';
    modalHealthImport.classList.remove('hidden');
    showHealthImportFeedback('⚠️ 目前在此瀏覽器找不到任何騎行紀錄。您可以先貼上匯入網址進行「解析」，但必須在此瀏覽器先進行一次騎行並存檔，才能將數據「套用到訓練」。', 'info');
    return;
  }

  const metrics = target.healthMetrics || {};
  healthTargetRecordId.value = target.id;
  healthAvgHr.value = metrics.avgHr || '';
  healthMaxHr.value = metrics.maxHr || '';
  healthActiveKcal.value = metrics.activeKcal || '';
  healthExerciseMin.value = metrics.exerciseMin || '';
  healthRpe.value = metrics.rpe || '';
  healthNote.value = metrics.note || '';
  healthImportCode.value = '';
  modalHealthImport.classList.remove('hidden');
}

function parseHealthImportCodeIntoForm() {
  hideHealthImportFeedback();
  const raw = healthImportCode.value.trim();
  if (!raw) {
    showHealthImportFeedback('⚠️ 請先在下方文字框貼上捷徑匯入碼或完整的網址，再點擊「解析匯入碼」。', 'error');
    return;
  }

  try {
    let data;
    if (raw.startsWith('http')) {
      const url = new URL(raw);
      data = Object.fromEntries(url.searchParams.entries());
    } else if (raw.includes('=')) {
      data = Object.fromEntries(new URLSearchParams(raw).entries());
    } else {
      data = JSON.parse(raw);
    }

    const metrics = normalizeHealthMetrics(data);
    fillHealthForm(metrics);

    if (!hasUsableHealthMetrics(metrics)) {
      showHealthImportFeedback('⚠️ 已解析，但沒有任何可用數字。這代表捷徑沒有從健康 App 抓到資料，或網址參數是空的。請確認有戴 Apple Watch、健康 App 有該次資料，再重新跑 v7 捷徑；也可以直接手動填上方欄位。', 'error');
      return;
    }

    showHealthImportFeedback('✅ 匯入碼已解析，數字已帶入上方欄位。確認後點「套用到訓練」。', 'success');
  } catch (error) {
    showHealthImportFeedback(`❌ 匯入碼解析失敗：${error.message}`, 'error');
  }
}

function fillHealthForm(metrics) {
  healthAvgHr.value = metrics.avgHr || '';
  healthMaxHr.value = metrics.maxHr || '';
  healthActiveKcal.value = metrics.activeKcal || '';
  healthExerciseMin.value = metrics.exerciseMin || '';
  healthRpe.value = metrics.rpe || '';
  healthNote.value = metrics.note || '';
}

function handleSaveHealthImport(e) {
  e.preventDefault();
  hideHealthImportFeedback();
  const recordId = healthTargetRecordId.value;
  const metrics = normalizeHealthMetrics({
    avgHr: healthAvgHr.value,
    maxHr: healthMaxHr.value,
    activeKcal: healthActiveKcal.value,
    exerciseMin: healthExerciseMin.value,
    rpe: healthRpe.value,
    note: healthNote.value
  });

  if (!metrics.avgHr && !metrics.activeKcal && !metrics.exerciseMin && !metrics.rpe) {
    showHealthImportFeedback('⚠️ 請至少填入一個健康資料欄位。', 'error');
    return;
  }

  const history = getHistoryFromStorage();
  const targetIndex = history.findIndex(record => record.id === recordId);
  if (targetIndex < 0) {
    showHealthImportFeedback('❌ 找不到可更新的騎行紀錄！請確認您是在進行騎行的同一個瀏覽器中開啟此網頁，或是複製下方匯入碼至您的騎行瀏覽器（例如 BLE Link）貼上並解析。', 'error');
    return;
  }

  applyHealthMetricsToRecord(recordId, metrics, { showSummary: true });
  modalHealthImport.classList.add('hidden');
}

function normalizeHealthMetrics(input = {}) {
  const pick = (...keys) => keys.find(key => input[key] !== undefined && input[key] !== '');
  const toNumber = (key) => {
    if (!key) return null;
    const cleaned = String(input[key]).replace(/[^\d.-]/g, '');
    const value = Number(cleaned);
    return Number.isFinite(value) ? Math.round(value) : null;
  };

  const avgHrKey = pick('avgHr', 'averageHeartRate', 'avg_hr');
  const maxHrKey = pick('maxHr', 'maximumHeartRate', 'max_hr');
  const activeKcalKey = pick('activeKcal', 'calories', 'kcal', 'active_calories');
  const exerciseMinKey = pick('exerciseMin', 'minutes', 'exerciseMinutes', 'exercise_min');
  const rpeKey = pick('rpe', 'effort');

  return {
    avgHr: toNumber(avgHrKey),
    maxHr: toNumber(maxHrKey),
    activeKcal: toNumber(activeKcalKey),
    exerciseMin: toNumber(exerciseMinKey),
    rpe: toNumber(rpeKey),
    note: String(input.note || input.memo || '').trim(),
    importedAt: new Date().toISOString()
  };
}

function hasUsableHealthMetrics(metrics = {}) {
  return Boolean(metrics.avgHr || metrics.maxHr || metrics.activeKcal || metrics.exerciseMin || metrics.rpe);
}

function applyHealthMetricsToRecord(recordId, metrics, options = {}) {
  const history = getHistoryFromStorage();
  const targetIndex = history.findIndex(record => record.id === recordId);
  if (targetIndex < 0) {
    updateFeedback('找不到可更新的訓練紀錄。');
    return;
  }

  const current = history[targetIndex];
  const merged = {
    ...current,
    calories: metrics.activeKcal || current.calories,
    healthImported: true,
    healthMetrics: {
      ...(current.healthMetrics || {}),
      ...metrics
    }
  };

  history[targetIndex] = merged;
  safeSetItem('antigravity_cycling_history', JSON.stringify(history));
  const user = getActiveUser();
  const nextPrescription = getNextTrainingPrescription(merged, user, merged.healthMetrics || {});
  const nextPlan = savePersonalizedTrainingPlan(nextPrescription, merged);
  renderSummary(merged, user);
  if (options.showSummary) {
    modalSummary.classList.remove('hidden');
  }
  loadHistory();
  updateUI();
  updateFeedback(`健康資料已匯入，已產生下次訓練模式：${nextPlan.title}。`);
}

function handleInboundHealthImport() {
  const params = new URLSearchParams(window.location.search);
  const hasHealthImport = ['avgHr', 'maxHr', 'activeKcal', 'exerciseMin', 'rpe', 'note'].some(key => params.has(key));
  if (!hasHealthImport) return;

  const rawMetrics = Object.fromEntries(params.entries());
  const metrics = normalizeHealthMetrics(rawMetrics);
  const latest = getLatestRecordForActiveUser();

  hideHealthImportFeedback();

  if (!hasUsableHealthMetrics(metrics)) {
    fillHealthForm(metrics);
    healthTargetRecordId.value = latest?.id || '';
    healthImportCode.value = window.location.href;
    modalHealthImport.classList.remove('hidden');
    showHealthImportFeedback('⚠️ 捷徑網址已收到，但沒有任何可用數字。通常是超過查詢時間、沒戴 Apple Watch，或健康 App 沒有該次紀錄。請重新跑 v7，或手動填入上方欄位。', 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (!latest) {
    // 跨瀏覽器/設備防呆：如果在此瀏覽器找不到歷史紀錄，將數據帶入匯入表單並打開 Modal。
    fillHealthForm(metrics);
    healthTargetRecordId.value = '';
    healthImportCode.value = window.location.href;
    modalHealthImport.classList.remove('hidden');
    showHealthImportFeedback('⚠️ 已偵測到健康數字，但此瀏覽器找不到騎行紀錄。請先在騎行設備按「從雲端下載」同步紀錄，再貼上這段匯入碼解析。', 'error');
  } else {
    applyHealthMetricsToRecord(latest.id, metrics, { showSummary: true });
    updateFeedback('健康資料已自動匯入！');
  }

  window.history.replaceState({}, document.title, window.location.pathname);
}

function formatHealthMiniSummary(metrics) {
  if (!metrics) return '尚未匯入健康摘要';
  const parts = [];
  if (metrics.avgHr) parts.push(`均 ${metrics.avgHr}`);
  if (metrics.maxHr) parts.push(`峰 ${metrics.maxHr}`);
  if (metrics.activeKcal) parts.push(`${metrics.activeKcal} kcal`);
  return parts.length ? parts.join(' / ') : '已匯入健康摘要';
}

function formatHealthSummary(metrics) {
  if (!metrics) return '尚未匯入';
  const pieces = [];
  if (metrics.avgHr || metrics.maxHr) pieces.push(`${metrics.avgHr || '--'} / ${metrics.maxHr || '--'} BPM`);
  if (metrics.activeKcal) pieces.push(`${metrics.activeKcal} kcal`);
  if (metrics.rpe) pieces.push(`RPE ${metrics.rpe}`);
  return pieces.join(' | ') || '已匯入';
}

function getNextTrainingPrescription(record, user, health = {}) {
  const estimatedMaxHr = 220 - (user?.age || 30);
  const avgHrPct = health.avgHr ? Math.round((health.avgHr / estimatedMaxHr) * 100) : null;
  const maxHrPct = health.maxHr ? Math.round((health.maxHr / estimatedMaxHr) * 100) : null;
  const healthMinutes = health.exerciseMin || 0;

  if ((health.rpe || 0) >= 8 || (maxHrPct || 0) >= 90) {
    return {
      mode: 'recovery',
      title: '恢復騎',
      duration: '15-20 分鐘',
      cadence: '68-78 RPM',
      resistance: '2 → 4 → 2',
      focus: '恢復腿部、降低心肺壓力',
      reason: '這次疲勞或心率高峰偏高，下次先恢復，不要連續堆高強度。'
    };
  }

  if (healthMinutes >= 40 && (health.rpe || 0) >= 7) {
    return {
      mode: 'recovery',
      title: '恢復騎',
      duration: '18-22 分鐘',
      cadence: '68-78 RPM',
      resistance: '3 → 5 → 2',
      focus: '保留踩踏張力，但不追瓦數',
      reason: `健康資料顯示這次已騎 ${healthMinutes} 分鐘，RPE ${health.rpe}/10，下一次先做恢復型課表，讓腿和心肺降壓。`
    };
  }

  if ((record.avgCadence || 0) < 68 && (health.rpe || 0) <= 7) {
    return {
      mode: 'cadence',
      title: '穩踩肌耐力',
      duration: '18 分鐘',
      cadence: '68-78 RPM',
      resistance: '5 → 7 → 9 → 7 → 3',
      focus: '中高阻力穩定推踩，不做高轉速空踩',
      reason: `本次平均踏頻 ${record.avgCadence || 0} RPM 偏低，下次用穩踩肌耐力把踏頻拉到 68-78 RPM，但仍保留你偏好的阻力張力。`
    };
  }

  if ((avgHrPct || 0) >= 70 && (avgHrPct || 0) <= 82 && (health.rpe || 0) <= 7) {
    return {
      mode: 'endurance',
      title: '有氧耐力',
      duration: '25-30 分鐘',
      cadence: '70-82 RPM',
      resistance: '4 → 6 → 7 → 8 → 3',
      focus: '穩定心肺與長時間輸出',
      reason: `平均心率約最大心率 ${avgHrPct}%，強度可控，適合用有氧耐力累積穩定度。`
    };
  }

  if ((record.coachScore || 0) >= 75 && (health.rpe || 0) <= 6) {
    return {
      mode: 'tempo',
      title: '燃脂節奏',
      duration: '20-22 分鐘',
      cadence: '70-80 RPM',
      resistance: '5 → 8 → 10 → 8 → 3',
      focus: '可控辛苦、穩定巡航',
      reason: '本次完成品質不錯且疲勞不高，下一次可提高到節奏巡航。'
    };
  }

  return {
    mode: 'endurance',
    title: '有氧耐力',
    duration: '20-25 分鐘',
    cadence: '68-80 RPM',
    resistance: '4 → 6 → 7 → 3',
    focus: '穩定輸出、避免爆衝',
    reason: '目前最適合先建立穩定基礎，再逐步進到節奏或爬坡。'
  };
}

function getNextWorkoutRecommendation(record, user, health = {}) {
  const prescription = getNextTrainingPrescription(record, user, health);
  return `已產生左側「建議｜下次訓練」模式：${prescription.title}。${prescription.reason} 目標 ${prescription.duration}，阻力 ${prescription.resistance}，踏頻 ${prescription.cadence}，重點：${prescription.focus}。`;
}

function getLegacyNextWorkoutRecommendation(record, health = {}) {
  if (health.rpe >= 8) {
    return '下一次安排「恢復騎」15-20 分鐘，阻力維持輕，目標是讓腿恢復，不追求瓦數。';
  }

  if ((record.avgCadence || 0) < 65 && (record.avgPower || 0) < 120) {
    return '下一次做「有氧耐力」前段，讓阻力自動從暖身慢慢加上去，目標是穩定踩壓，不是追高轉速。';
  }

  if ((record.avgCadence || 0) < 75) {
    return '下一次做「穩踩肌耐力」，用中等阻力維持 68-82 RPM，把每一下踩踏穩住。';
  }

  if ((record.stabilityScore || 0) < 65) {
    return '下一次做「有氧耐力」20-30 分鐘，目標不是衝高，而是把功率和踏頻穩住。';
  }

  if (['recovery', 'free'].includes(record.mode) && (record.coachScore || 0) >= 75) {
    return '下一次可進階到「燃脂節奏」，用中等阻力做 20 分鐘穩定巡航。';
  }

  if (['endurance', 'tempo'].includes(record.mode) && (record.coachScore || 0) >= 75) {
    return '下一次可做「間歇衝刺」或「金字塔課表」，增加高低強度切換。';
  }

  if (record.mode === 'climb') {
    return '下一次建議接「恢復騎」或「有氧耐力」，讓腿部肌耐力恢復再進階。';
  }

  return '下一次建議做「有氧耐力」，跟著分段阻力從暖身、主段到最後緩和，累積穩定能力。';
}

function generateSportsAdvice(record, user) {
  analysisReportContent.innerHTML = '';
  const advices = [];

  const health = record.healthMetrics || {};
  if (record.healthImported && hasUsableHealthMetrics(health)) {
    const estimatedMaxHr = 220 - user.age;
    const avgHrPct = health.avgHr ? Math.round((health.avgHr / estimatedMaxHr) * 100) : null;
    const maxHrPct = health.maxHr ? Math.round((health.maxHr / estimatedMaxHr) * 100) : null;
    const rideMinutes = Math.max(1, Math.round((record.duration || 0) / 60));
    const healthMinutes = health.exerciseMin || null;
    const kcalPerMin = health.activeKcal && healthMinutes ? (health.activeKcal / healthMinutes).toFixed(1) : null;

    const parts = [];
    if (healthMinutes) parts.push(`健康紀錄 ${healthMinutes} 分鐘`);
    if (health.activeKcal) parts.push(`${health.activeKcal} kcal`);
    if (health.avgHr) parts.push(`平均心率 ${health.avgHr} BPM${avgHrPct ? `，約最大心率 ${avgHrPct}%` : ''}`);
    if (health.maxHr) parts.push(`最高 ${health.maxHr} BPM${maxHrPct ? `，約最大心率 ${maxHrPct}%` : ''}`);
    if (health.rpe) parts.push(`RPE ${health.rpe}/10`);

    let takeaway = '這次健康資料已套用到本次騎行，以下分析會用健康資料評估強度與恢復需求。';
    if (avgHrPct && avgHrPct >= 82) {
      takeaway = '平均心率偏高，這次比較接近節奏或間歇強度；下次不建議直接接高強度。';
    } else if (avgHrPct && avgHrPct >= 70) {
      takeaway = '平均心率落在有氧到節奏交界，這次有訓練效果，不只是輕鬆踩。';
    } else if (avgHrPct) {
      takeaway = '平均心率偏溫和，這次更像耐力累積或恢復騎。';
    }

    advices.push({
      title: '本次健康資料回饋',
      type: (avgHrPct && avgHrPct >= 82) || (health.rpe && health.rpe >= 8) ? 'warning' : 'success',
      text: `${parts.join('，')}。${kcalPerMin ? `平均消耗約 ${kcalPerMin} kcal/分鐘。` : ''}${takeaway}`
    });

    if (healthMinutes && Math.abs(healthMinutes - rideMinutes) >= 5) {
      advices.push({
        title: '時間來源不一致',
        type: 'warning',
        text: `飛輪本機紀錄約 ${rideMinutes} 分鐘，但健康資料是 ${healthMinutes} 分鐘。這代表 Apple 健康可能記到較完整的一整段自行車訓練，或本網頁只保存了其中一段。熱量與心率評估會以健康資料為主，踏頻與功率仍以飛輪紀錄為主。`
      });
    }
  }

  if (record.avgCadence > 0) {
    if (record.avgCadence < 65) {
      advices.push({
        title: '低踏頻重踩',
        type: 'warning',
        text: `平均踏頻 ${record.avgCadence} RPM。若這次是爬坡或肌耐力段，低踏頻可以接受；若功率也偏低，代表阻力可能卡太重，下一次讓課表自動阻力從暖身慢慢上去，避免膝蓋硬扛。`
      });
    } else if (record.avgCadence <= 84) {
      advices.push({
        title: '穩定踩壓區',
        type: 'success',
        text: `平均踏頻 ${record.avgCadence} RPM，符合目前新版課表的穩踩取向。接下來重點不是轉更快，而是讓功率波動更小、階段切換更穩。`
      });
    } else {
      advices.push({
        title: '轉速偏高',
        type: 'info',
        text: `平均踏頻 ${record.avgCadence} RPM。若不是刻意做輕鬆恢復，代表阻力張力可能不足。下一次可選「穩踩肌耐力」或「燃脂節奏」，讓阻力自動分段加上去。`
      });
    }
  } else {
    advices.push({
      title: '無踏頻感測數據',
      type: 'info',
      text: '本次運動沒有偵測到踏頻。在踏頻大於 0 的狀況下，我們能為您的踩踏迴轉速給予更具體的運動力學分析與建議。'
    });
  }

  if (record.healthImported && (health.avgHr || health.maxHr || health.rpe || health.activeKcal)) {
    const maxHr = 220 - user.age;
    const aerobicLower = Math.round(maxHr * 0.60);
    const aerobicUpper = Math.round(maxHr * 0.82);

    if (health.avgHr && health.avgHr > aerobicUpper) {
      advices.push({
        title: '健康匯入：強度偏高',
        type: 'warning',
        text: `健康資料顯示平均心率 ${health.avgHr} BPM，已高於估算有氧上限 ${aerobicUpper} BPM。若這不是刻意做間歇或爬坡，下次可降低 1-2 段阻力，讓後段品質更穩。`
      });
    } else if (health.avgHr && health.avgHr >= aerobicLower) {
      advices.push({
        title: '健康匯入：有氧區間良好',
        type: 'success',
        text: `健康資料顯示平均心率 ${health.avgHr} BPM，落在 ${aerobicLower}-${aerobicUpper} BPM 的有氧範圍。這次訓練適合列入耐力或燃脂累積。`
      });
    } else {
      advices.push({
        title: '健康匯入：恢復強度',
        type: 'info',
        text: `健康資料顯示本次強度偏溫和。若主觀疲勞 RPE 仍高，代表恢復不足；若體感輕鬆，下次可做有氧耐力或燃脂節奏。`
      });
    }

    if (health.rpe) {
      advices.push({
        title: `主觀疲勞 RPE ${health.rpe}/10`,
        type: health.rpe >= 8 ? 'warning' : 'info',
        text: health.rpe >= 8
          ? '體感疲勞偏高。下一次建議安排恢復騎或短有氧，不要連續高強度。'
          : '體感可控。若睡眠和腿部狀態正常，下一次可以安排進一步課表。'
      });
    }
  } else {
    advices.push({
      title: '健康資料尚未匯入',
      type: 'info',
      text: '目前已先用飛輪功率、踏頻與時間給出分析。跑 iPhone 捷徑或手動填入健康摘要後，系統會補上心率與體感疲勞評估。'
    });
  }

  if (record.avgPower > 0) {
    const powerToWeight = (record.avgPower / user.weight).toFixed(2);
    let levelText = '基礎健康級';
    if (powerToWeight > 2.5) levelText = '業餘競速級 🏆';
    else if (powerToWeight > 1.8) levelText = '進階運動級 ⚡';

    advices.push({
      title: `推重比分析: ${powerToWeight} W/kg`,
      type: 'success',
      text: `以您的體重 ${user.weight}kg 計算，您的平均推重比為 ${powerToWeight} W/kg，屬於【${levelText}】。維持功率踩踏是提升大腿肌肉力量與代謝率最好的管道！`
    });
  }

  advices.push({
    title: `訓練分數 ${record.coachScore || 60}/100`,
    type: (record.coachScore || 60) >= 75 ? 'success' : 'info',
    text: `穩定度 ${record.stabilityScore || 60}，強度 ${record.intensityScore || 55}，完成度 ${record.completionScore || 50}。這個分數用來追蹤每次訓練品質，不只看騎多久。`
  });

  advices.push({
    title: '下次訓練建議',
    type: 'success',
    text: getNextWorkoutRecommendation(record, user, health)
  });

  advices.forEach(adv => {
    const div = document.createElement('div');
    div.className = `advice-item ${adv.type === 'warning' ? 'warning' : ''}`;
    div.innerHTML = `<strong>${adv.type === 'warning' ? '⚠️ ' : '💡 '}${adv.title}</strong><p>${adv.text}</p>`;
    analysisReportContent.appendChild(div);
  });
}

function loadHistory() {
  const user = getActiveUser();
  const history = getHistoryFromStorage();
  const userHistory = history.filter(h => h.userId === user.id);

  historyList.innerHTML = '';

  if (userHistory.length === 0) {
    historyList.innerHTML = `<li class="no-records">帳戶「${user.name}」目前尚未有騎行紀錄。連線飛輪後開始踩踏，或點「手動開始」建立第一次訓練。</li>`;
  } else {
    userHistory.slice(0, 10).forEach(record => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const dateStr = new Date(record.date).toLocaleDateString('zh-TW', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const modeText = (getTrainingPlan(record.mode) || {}).label || '未知';
      const modeClass = getModeBadgeClass(record.mode);
      const healthTag = record.healthImported ? ' | 健康已匯入' : '';

      li.innerHTML = `
        <div class="history-item-left">
          <div class="history-item-meta">
            <span class="mode-badge ${modeClass}">${modeText}</span>
            <span class="history-item-title">${dateStr}</span>
          </div>
          <div class="history-item-data">
            時間: <strong>${formatDuration(record.duration)}</strong> | 平均踏頻: <strong>${record.avgCadence || '--'} RPM</strong>${healthTag}
          </div>
        </div>
        <div class="history-item-right">
          <span class="history-item-calories">${getDisplayCalories(record)} kcal</span>
          <span class="history-item-distance">${record.distance.toFixed(2)} km</span>
        </div>
      `;

      li.addEventListener('click', () => {
        renderSummary(record, user);
        modalSummary.classList.remove('hidden');
      });

      historyList.appendChild(li);
    });
  }

  calculateWeeklyStats(userHistory);
}

function getModeBadgeClass(mode) {
  if (mode === 'recovery') return 'badge-easy';
  if (mode === 'endurance') return 'badge-moderate';
  if (mode === 'tempo') return 'badge-tempo';
  if (mode === 'cadence') return 'badge-spin';
  if (mode === 'climb') return 'badge-climb';
  if (mode === 'personalized') return 'badge-personal';
  if (mode === 'interval' || mode === 'pyramid') return 'badge-hard';
  return 'badge-free';
}

function calculateWeeklyStats(userHistory) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0,0,0,0);

  const weeklyRecords = userHistory.filter(h => new Date(h.date) >= monday);

  let totalTimeSec = 0;
  let totalKcal = 0;
  let totalKm = 0.0;

  weeklyRecords.forEach(r => {
    totalTimeSec += r.duration;
    totalKcal += getDisplayCalories(r);
    totalKm += r.distance;
  });

  weeklyCount.innerText = weeklyRecords.length;
  weeklyTime.innerText = `${Math.round(totalTimeSec / 60)}m`;
  weeklyCalories.innerText = Math.round(totalKcal);
  weeklyDistance.innerText = totalKm.toFixed(1);
}

// === 分段課表與自動阻力 ===
function startIntervalWorkout() {
  updateTrainingPhase({ forceResistance: true, announce: true });
}

function getActivePhases(mode = state.workoutMode) {
  if (mode === 'personalized') {
    return getPersonalizedTrainingPlan()?.phases || [];
  }
  return PHASE_PLANS[mode] || [];
}

function getPlanDuration(mode = state.workoutMode) {
  return getActivePhases(mode).reduce((sum, phase) => sum + phase.duration, 0);
}

function getModeElapsed() {
  return Math.max(0, state.elapsedTime - state.modeStartedElapsed);
}

function getCurrentPhaseContext(mode = state.workoutMode, elapsed = getModeElapsed()) {
  const phases = getActivePhases(mode);
  if (!phases.length) return null;

  const totalDuration = getPlanDuration(mode);
  const clampedElapsed = Math.min(elapsed, Math.max(totalDuration - 1, 0));
  let cursor = 0;

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const phaseEnd = cursor + phase.duration;
    if (clampedElapsed < phaseEnd || i === phases.length - 1) {
      const phaseElapsed = Math.max(0, clampedElapsed - cursor);
      return {
        mode,
        phases,
        phase,
        phaseIndex: i,
        phaseElapsed,
        phaseRemaining: Math.max(0, phase.duration - phaseElapsed),
        totalDuration,
        modeElapsed: elapsed,
        planComplete: elapsed >= totalDuration
      };
    }
    cursor = phaseEnd;
  }

  return null;
}

function updateTrainingPhase(options = {}) {
  const context = getCurrentPhaseContext();
  const plan = getTrainingPlan(state.workoutMode);

  if (!context) {
    intervalPanel.classList.add('hidden');
    targetPowerZone.innerText = `目標瓦數: ${plan.targetPower}`;
    resRange.innerText = '手動阻力';
    return;
  }

  const { phase, phaseIndex, phaseElapsed, phaseRemaining, phases, planComplete } = context;
  const phaseKey = `${state.workoutMode}:${phaseIndex}`;

  state.intervalPhaseIndex = phaseIndex;
  state.intervalTimeElapsed = phaseElapsed;
  updateIntervalUI(context);

  targetPowerZone.innerText = `目標瓦數: ${phase.targetPower}`;
  resRange.innerText = `自動阻力: ${phase.resistance} 段`;

  const shouldApplyResistance =
    options.forceResistance ||
    state.lastPhaseKey !== phaseKey ||
    state.lastAutoResistance !== phase.resistance ||
    (state.isPlaying && state.elapsedTime % 15 === 0 && state.resistance !== phase.resistance);

  if (shouldApplyResistance) {
    setResistanceLevel(phase.resistance, 'auto');
    state.lastAutoResistance = phase.resistance;
  }

  if (options.announce || state.lastPhaseKey !== phaseKey) {
    const next = phases[phaseIndex + 1];
    const doneText = planComplete ? '課表時間已完成，可按「結束並存檔」，或繼續緩和騎。' : '';
    const nextText = next ? `下一段 ${next.name}，阻力 ${next.resistance}。` : '這是最後階段。';
    updateFeedback(`${plan.title}｜${phase.name}：阻力 ${phase.resistance}，目標 ${phase.targetCadence} RPM / ${phase.targetPower}。${phase.info} ${nextText} ${doneText}`.trim());
  }

  state.lastPhaseKey = phaseKey;
}

function updateIntervalUI(context = getCurrentPhaseContext()) {
  if (!context) {
    intervalPanel.classList.add('hidden');
    return;
  }

  const { phase, phaseIndex, phaseElapsed, phaseRemaining, phases, planComplete } = context;
  intervalPanel.classList.remove('hidden');
  intervalPhase.innerText = `課表階段 (${phaseIndex + 1}/${phases.length}): ${phase.name}`;
  intervalTimerDisp.innerText = planComplete ? '完成' : formatCountdown(phaseRemaining);

  const pct = Math.min(100, (phaseElapsed / phase.duration) * 100);
  intervalProgress.style.width = `${pct}%`;

  const nextPhase = phases[phaseIndex + 1];
  if (planComplete) {
    intervalNextTip.innerText = '課表完成：可結束存檔，或保持低阻力緩和。';
  } else if (nextPhase) {
    intervalNextTip.innerText = `下一階段：${nextPhase.name} (阻力 ${nextPhase.resistance} 段)，目標 ${nextPhase.targetCadence} RPM / ${nextPhase.targetPower}`;
  } else {
    intervalNextTip.innerText = '下一階段：課表結束，準備存檔與健康匯入。';
  }
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const m = String(Math.floor(safeSeconds / 60)).padStart(2, '0');
  const s = String(safeSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function hasPedalingSignal() {
  return state.cadence >= 8 || state.power >= 15 || state.speed >= 2;
}

function maybeAutoStartFromPedaling() {
  if (state.isPlaying || !state.isBikeConnected || state.isDemoMode) return;
  if (!hasPedalingSignal()) {
    state.autoStartBlocked = false;
    return;
  }
  if (state.autoStartBlocked) return;
  startWorkout('auto');
}

function collectWorkoutSample() {
  if (!state.isPlaying) return;
  if (state.cadence > 0) state.cadenceSamples.push(state.cadence);
  if (state.power > 0) {
    state.powerSamples.push(state.power);
    if (state.power > state.maxPower) state.maxPower = state.power;
  }
}

// === 手動與自動阻力微調 ===
function adjustResistance(delta) {
  setResistanceLevel(state.resistance + delta, 'manual');
}

function setResistanceLevel(level, source = 'manual') {
  let target = Math.round(Number(level) || state.resistance);
  if (target < 1) target = 1;
  if (target > 24) target = 24;

  state.resistance = target;
  valResistance.innerText = state.resistance;

  sendResistanceToBike(state.resistance);

  const card = document.getElementById('card-resistance');
  card.classList.add('card-glow-active-blue');
  setTimeout(() => card.classList.remove('card-glow-active-blue'), 400);

  if (source === 'manual') {
    resRange.innerText = `手動微調: ${state.resistance} 段`;
  }
}

// === 模擬器數據產生器 (Demo Mode) ===
function handleDemoModeToggle(e) {
  state.isDemoMode = e.target.checked;

  if (state.isDemoMode) {
    state.isBikeConnected = true;
    state.autoStartBlocked = false;
    btnPlayPause.disabled = false;

    btnConnectBike.disabled = true;
    btnHealthImport.disabled = false;
    bikeConnText.innerText = '模擬飛輪 (啟用)';
    healthImportText.innerText = '匯入健康';

    updateFeedback('模擬騎行模式已開啟。點「手動開始」體驗分段課表、自動阻力與踩踏動畫。');

    if (state.isPlaying) {
      startDemoGenerator();
    }
  } else {
    btnConnectBike.disabled = false;
    btnHealthImport.disabled = false;
    bikeConnText.innerText = '連線飛輪';
    healthImportText.innerText = '匯入健康';

    disconnectBike();
    resetWorkout();
  }

  updateUI();
}

function startDemoGenerator() {
  if (state.demoTimer) clearInterval(state.demoTimer);

  state.demoTimer = setInterval(() => {
    if (!state.isPlaying) return;

    updateTrainingPhase();

    let baseCadence = 78;
    let basePower = 120;
    let baseSpeed = 22;
    const context = getCurrentPhaseContext();

    if (context) {
      const cadenceRange = parseRange(context.phase.targetCadence);
      const powerRange = parseRange(context.phase.targetPower);
      if (cadenceRange) baseCadence = Math.round((cadenceRange.min + cadenceRange.max) / 2);
      if (powerRange) basePower = Math.round((powerRange.min + powerRange.max) / 2);
      baseSpeed = Math.max(16, Math.min(31, 16 + basePower / 14));
    }

    state.cadence = Math.round(baseCadence + (Math.random() * 6 - 3));
    state.power = Math.round(basePower + (Math.random() * 20 - 10));
    state.speed = parseFloat((baseSpeed + (Math.random() * 2 - 1)).toFixed(1));

    if (state.cadence > 0) state.cadenceSamples.push(state.cadence);
    if (state.power > 0) {
      state.powerSamples.push(state.power);
      if (state.power > state.maxPower) state.maxPower = state.power;
    }
    updateUI();
    updateAnimationSpeeds();
  }, 1000);
}

// === UI 渲染與回饋引導 ===
function updateUI() {
  valPower.innerText = state.power;
  valCadence.innerText = state.cadence;
  const latest = getLatestRecordForActiveUser();
  if (latest?.healthImported) {
    valHr.innerText = '已匯入';
    hrZone.innerText = formatHealthMiniSummary(latest.healthMetrics);
  } else {
    valHr.innerText = '待匯入';
    hrZone.innerText = '訓練後用捷徑補完健康資料';
  }
  valResistance.innerText = state.resistance;
  valDistance.innerText = state.distance.toFixed(2);

  const currentContext = getCurrentPhaseContext();
  const currentCadenceRange = currentContext ? parseRange(currentContext.phase.targetCadence) : null;
  if (state.cadence === 0) {
    cadenceStatus.innerText = '靜止中';
  } else if (currentCadenceRange && state.cadence < currentCadenceRange.min) {
    cadenceStatus.innerText = '低於本段目標';
  } else if (currentCadenceRange && state.cadence > currentCadenceRange.max) {
    cadenceStatus.innerText = '高於本段目標';
  } else if (currentCadenceRange) {
    cadenceStatus.innerText = '本段節奏內';
  } else if (state.cadence <= 90) {
    cadenceStatus.innerText = '穩定踩踏';
  } else {
    cadenceStatus.innerText = '轉速偏高';
  }

  toggleCardGlow('card-power', state.power > 180, 'card-glow-active-yellow');
  toggleCardGlow('card-cadence', state.cadence > 90, 'card-glow-active-green');
  toggleCardGlow('card-hr', Boolean(latest?.healthImported), 'card-glow-active-red');

  if (state.isPlaying) {
    if (state.workoutMode === 'free') {
      updateFeedback(`自由騎行中。目前踩踏：${state.cadence} RPM / 功率：${state.power} W。`);
    } else {
      updateFeedback(getLiveCoachingText());
    }
  }
}

function getLiveCoachingText() {
  const plan = getTrainingPlan(state.workoutMode);
  const context = getCurrentPhaseContext();
  const phase = context?.phase;
  const powerRange = parseRange(phase?.targetPower || plan.targetPower);
  const cadenceRange = parseRange(phase?.targetCadence || plan.targetCadence);
  const phaseName = phase?.name || plan.title;
  const remaining = context ? formatCountdown(context.phaseRemaining) : '--:--';
  const planDone = context?.planComplete;
  const advice = [];

  if (phase) {
    advice.push(`阻力 ${phase.resistance}`);
  }

  if (powerRange && state.power > 0) {
    if (state.power < powerRange.min) {
      advice.push(`功率偏低，先穩住姿勢，再把踩壓拉到 ${phase.targetPower}`);
    } else if (state.power > powerRange.max) {
      advice.push('功率偏高，這段先收住，避免後段掉速');
    } else {
      advice.push('功率在目標內');
    }
  } else if (phase) {
    advice.push(`目標功率 ${phase.targetPower}`);
  }

  if (cadenceRange && state.cadence > 0) {
    if (state.cadence < cadenceRange.min) {
      if (powerRange && state.power >= powerRange.min) {
        advice.push('踏頻低但功率夠，這是重踩段可接受；保持膝蓋直線和核心穩定');
      } else {
        advice.push(`踏頻低於本段目標 ${phase.targetCadence}，不是硬追高轉；先確認阻力是否太重，再小幅加快`);
      }
    } else if (state.cadence > cadenceRange.max) {
      advice.push('踏頻高於本段目標，阻力張力可能不夠；保持順踩，必要時讓自動阻力接管');
    } else {
      advice.push('踏頻在本段目標內');
    }
  } else if (phase) {
    advice.push(`目標踏頻 ${phase.targetCadence} RPM`);
  }

  if (context && context.modeElapsed < 180) {
    advice.push('前 3 分鐘不要衝，讓呼吸和腿溫上來');
  } else if (context && context.phaseRemaining <= 30 && !planDone) {
    advice.push('剩 30 秒準備切換，先把呼吸整理好');
  }

  if (planDone) {
    advice.push('課表已完成，可結束存檔或繼續低阻力緩和');
  }

  return `${plan.title}｜${phaseName} 剩 ${remaining}：${advice.slice(0, 4).join('；')}。`;
}

function toggleCardGlow(id, condition, glowClass) {
  const el = document.getElementById(id);
  if (condition) {
    el.classList.add(glowClass);
  } else {
    el.classList.remove(glowClass);
  }
}

function updateFeedback(text) {
  rideFeedback.innerText = text;
}

function updateAnimationSpeeds() {
  const root = document.documentElement;

  if (state.speed > 0) {
    const wheelDur = (12 / state.speed).toFixed(2);
    root.style.setProperty('--wheel-speed', `${wheelDur}s`);
    const roadDur = (6 / state.speed).toFixed(2);
    root.style.setProperty('--road-speed', `${roadDur}s`);
  } else {
    root.style.setProperty('--wheel-speed', '0s');
    root.style.setProperty('--road-speed', '0s');
  }

  const cyclistBody = document.getElementById('cyclist-body');
  if (state.cadence > 0) {
    const crankDur = (60 / state.cadence).toFixed(2);
    root.style.setProperty('--crank-speed', `${crankDur}s`);
    cyclistBody.style.animationPlayState = 'running';
  } else {
    root.style.setProperty('--crank-speed', '0s');
    cyclistBody.style.animationPlayState = 'paused';
  }
}

function formatDuration(totalSeconds) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
