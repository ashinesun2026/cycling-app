// ============================================================================
// 飛輪騎行訓練儀表板 - 熱血競技運動風核心邏輯 (app.js)
// ============================================================================

// === 全局錯誤捕捉與螢幕顯示 (iOS/手機除錯專用) ===
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
    title.innerText = '⚠️ 程式錯誤偵測 (請截圖)：\n';
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

// 雲端備份的專屬 Bucket (與原專案一致，確保能讀取舊備份)
const SYNC_BUCKET = 'USttZbN2suPCwch8W2QRuH';

// === 應用程式狀態 ===
let state = {
  isDemoMode: false, // 固定設為 false (使用者要求拿掉模擬功能)
  isPlaying: false,

  // 藍牙設備對象
  bikeDevice: null,
  controlPointChar: null,
  isBikeConnected: false,
  hasBikeControl: false,

  // 運動即時數據
  elapsedTime: 0,      // 秒
  calories: 0,         // kcal
  distance: 0.0,       // km
  power: 0,            // W
  cadence: 0,          // RPM
  speed: 0.0,          // km/h
  resistance: 5,       // 阻力 (1-24)
  bikeReportedResistance: null,
  workoutStartedAt: null,

  // 運動統計數據 (用於分析)
  powerSamples: [],
  cadenceSamples: [],
  fullCadenceHistory: [], // 記錄全程踏頻 (每秒一個數據，最長 30 分鐘)
  maxPower: 0,
  
  // 30分鐘超時延長狀態
  isExtended: false,

  // 運動模式設定
  workoutMode: 'personalized',

  // 統計篩選區間 ('week', 'month', 'year')
  statsRange: 'week',

  // 階段計時與阻力設定
  intervalTimeElapsed: 0,
  intervalPhaseIndex: 0,
  modeStartedElapsed: 0,
  lastAutoResistance: null,
  lastPhaseKey: '',
  manualResistanceOverrideUntil: 0,
  manualResistanceOverrideSource: null,
  autoStartBlocked: false,

  // 定時器
  mainTimer: null
};

let controlPointCommandQueue = Promise.resolve();

// === 多使用者資料庫與檔案管理 (保留原專案 LocalStorage 路徑) ===
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

// === 5大 30 分鐘健身課表定義 (避開空轉高頻) ===
const TRAINING_PLANS = {
  personalized: {
    label: '建議',
    title: '建議模式',
    targetPower: '依個人化階段',
    targetCadence: '依個人化階段',
    focus: '根據上次騎乘回饋動態產生的建議課表',
    coach: '建議模式：已為您載入個人化專屬課表，請點擊「開始」起步！'
  },
  endurance: {
    label: '有氧',
    title: '穩踩有氧耐力',
    targetPower: '90-165W',
    targetCadence: '62-72 RPM',
    focus: '中阻力穩踩、基礎心肺耐力、脂肪氧化燃燒',
    coach: '有氧耐力：維持 5-7 段阻力，踏頻穩在 62-72 RPM，不做空轉高頻。'
  },
  tempo: {
    label: '甜蜜點',
    title: '甜蜜點增能 (Sweet Spot)',
    targetPower: '120-200W',
    targetCadence: '58-70 RPM',
    focus: '中高阻力穩定輸出、乳酸閾值功率 (FTP) 提升',
    coach: '甜蜜點：使用 6-10 段阻力建立張力，踏頻控制在 58-70 RPM，專注於大腿向下推踩。'
  },
  climb: {
    label: '爬坡',
    title: '間歇爬坡阻力 (HIIT Hill)',
    targetPower: '150-240W',
    targetCadence: '50-66 RPM',
    focus: '腿部肌耐力與心肺無氧爆發力',
    coach: '間歇爬坡：利用重阻力 (7-13段) 與低踏頻 (50-66 RPM) 刺激大腿肌力！'
  },
  recovery: {
    label: '恢復',
    title: '穩踩恢復排酸',
    targetPower: '70-125W',
    targetCadence: '58-70 RPM',
    focus: '中阻力恢復踩踏、排除疲勞、不空轉',
    coach: '恢復模式：保留 5-7 段張力，踏頻穩在 58-70 RPM，用穩定踩壓恢復腿部。'
  }
};

// 5大課表的時間序列階段 (每堂課總時長恰好為 30 分鐘 / 1800 秒)
const PHASE_PLANS = {
  endurance: [
    { name: '張力暖身', duration: 300, resistance: 5, targetCadence: '62-70', targetPower: '85-115W', info: '先建立踩踏張力，踏頻不要追快。' },
    { name: '有氧穩踩', duration: 900, resistance: 6, targetCadence: '64-72', targetPower: '105-145W', info: '維持穩定呼吸，每一下踩壓要完整。' },
    { name: '耐力加壓', duration: 420, resistance: 7, targetCadence: '62-70', targetPower: '125-165W', info: '提高張力，保持核心與骨盆穩定。' },
    { name: '張力緩和', duration: 180, resistance: 5, targetCadence: '60-68', targetPower: '80-110W', info: '保留基本阻力收操，不空轉。' }
  ],
  tempo: [
    { name: '張力暖身', duration: 300, resistance: 6, targetCadence: '62-70', targetPower: '95-125W', info: '先建立中阻力張力，熱開膝關節。' },
    { name: '節奏爬升', duration: 600, resistance: 8, targetCadence: '60-68', targetPower: '125-165W', info: '進入甜蜜點，讓肌肉持續出力。' },
    { name: '高峰穩踩', duration: 720, resistance: 10, targetCadence: '58-66', targetPower: '150-200W', info: '瓦數提高，保持骨盆端正，不要用高轉速逃避阻力。' },
    { name: '張力緩和', duration: 180, resistance: 6, targetCadence: '60-68', targetPower: '90-120W', info: '降低強度但保留踩壓張力。' }
  ],
  climb: [
    { name: '陡坡暖身', duration: 300, resistance: 7, targetCadence: '58-66', targetPower: '105-135W', info: '先熟悉重阻力，穩定踩下踏板。' },
    { name: '坐姿爬坡', duration: 600, resistance: 10, targetCadence: '54-64', targetPower: '150-190W', info: '低轉速重踩，用臀部與大腿後側推蹬。' },
    { name: '陡坡高峰', duration: 300, resistance: 13, targetCadence: '50-60', targetPower: '185-230W', info: '最高峰！穩坐核心，一步一步踩實。' },
    { name: '滾動加壓', duration: 420, resistance: 11, targetCadence: '54-64', targetPower: '160-205W', info: '維持力量輸出，呼吸深長。' },
    { name: '張力緩和', duration: 180, resistance: 7, targetCadence: '56-66', targetPower: '95-125W', info: '降低負荷收尾，但保留推踩張力。' }
  ],
  recovery: [
    { name: '張力喚醒', duration: 300, resistance: 5, targetCadence: '60-68', targetPower: '70-95W', info: '用中阻力喚醒腿部，不空轉。' },
    { name: '恢復穩踩', duration: 900, resistance: 6, targetCadence: '62-70', targetPower: '80-115W', info: '呼吸要能完整講話，但踏板仍要有張力。' },
    { name: '穩踩整理', duration: 420, resistance: 7, targetCadence: '60-68', targetPower: '95-125W', info: '短暫提高張力，檢查踩踏是否穩定。' },
    { name: '張力收操', duration: 180, resistance: 5, targetCadence: '58-66', targetPower: '70-95W', info: '收操仍保留基本阻力，避免空踩。' }
  ]
};

// === DOM 元素綁定 ===
const btnConnectBike = document.getElementById('btn-connect-bike');
const btnHealthImport = document.getElementById('btn-health-import');
const bikeConnText = document.getElementById('bike-conn-text');
const healthImportText = document.getElementById('health-import-text');

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

// 多使用者與歷史面板
const bluetoothWarningBanner = document.getElementById('bluetooth-warning-banner');
const userSelect = document.getElementById('user-select');
const btnEditProfile = document.getElementById('btn-edit-profile');
const historyList = document.getElementById('history-list');

// 使用說明說明
const btnHelpGuide = document.getElementById('btn-help-guide');
const modalGuide = document.getElementById('modal-guide');
const btnCloseGuide = document.getElementById('btn-close-guide');

// 本週累計
const weeklyCount = document.getElementById('weekly-count');
const weeklyTime = document.getElementById('weekly-time');
const weeklyCalories = document.getElementById('weekly-calories');
const weeklyDistance = document.getElementById('weekly-distance');
const weeklySvgChart = document.getElementById('weekly-svg-chart');

// 設定檔 Modal
const modalProfile = document.getElementById('modal-profile');
const formProfile = document.getElementById('form-profile');
const profileModalTitle = document.getElementById('profile-modal-title');
const profileId = document.getElementById('profile-id');
const profileName = document.getElementById('profile-name');
const profileAge = document.getElementById('profile-age');
const profileWeight = document.getElementById('profile-weight');
const btnDeleteProfile = document.getElementById('btn-delete-profile');
const btnCancelProfile = document.getElementById('btn-cancel-profile');

// 運動報告結算 Modal
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

// Canvas Trend Chart
const canvas = document.getElementById('trendCanvas');
const ctx = canvas.getContext('2d');
const trendBadge = document.getElementById('trendBadge');

// ============================================================================
// 0. 本地 LocalStorage 安全存取包裝 (保留原專案 key 確保舊資料匯入)
// ============================================================================
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error("無法讀取 LocalStorage:", e);
    return null;
  }
}

function safeSetItem(key, val) {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch (e) {
    console.error("無法寫入 LocalStorage:", e);
    return false;
  }
}

function getPersonalizedTrainingPlan() {
  // 原專案持久化推薦課表的 Key：'antigravity_next_training_plan'
  const raw = safeGetItem('antigravity_next_training_plan');
  if (!raw) return null;
  try {
    const plan = JSON.parse(raw);
    if (!plan || !Array.isArray(plan.phases) || !plan.phases.length) return null;
    const normalizedPlan = normalizeTrainingPlanNoSpin(plan);
    if (JSON.stringify(normalizedPlan) !== JSON.stringify(plan)) {
      safeSetItem('antigravity_next_training_plan', JSON.stringify(normalizedPlan));
    }
    return normalizedPlan;
  } catch (e) {
    console.error('無法讀取建議模式課表:', e);
    return null;
  }
}

function normalizeTrainingPlanNoSpin(plan) {
  const phases = plan.phases.map(phase => {
    const resistance = Math.max(5, Math.min(24, Math.round(Number(phase.resistance) || 5)));
    const cadenceParts = String(phase.targetCadence || '').split('-').map(Number);
    const cadenceMax = cadenceParts.length === 2 ? cadenceParts[1] : 999;
    const targetCadence = cadenceMax > 72 || resistance !== phase.resistance
      ? getNoSpinCadenceRange(resistance)
      : phase.targetCadence;

    return {
      ...phase,
      resistance,
      targetCadence
    };
  });

  return {
    ...plan,
    cadence: getPlanCadenceSummary(phases),
    phases
  };
}

function getNoSpinCadenceRange(resistance) {
  if (resistance >= 11) return '50-62';
  if (resistance >= 9) return '54-66';
  if (resistance >= 7) return '58-68';
  return '60-70';
}

function getPlanCadenceSummary(phases) {
  const ranges = phases
    .map(phase => String(phase.targetCadence || '').split('-').map(Number))
    .filter(parts => parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]));

  if (!ranges.length) return '依階段';

  const min = Math.min(...ranges.map(parts => parts[0]));
  const max = Math.max(...ranges.map(parts => parts[1]));
  return `${min}-${max} RPM`;
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
  return TRAINING_PLANS[mode] || TRAINING_PLANS.endurance;
}

function getActivePhases() {
  if (state.workoutMode === 'personalized') {
    const personalized = getPersonalizedTrainingPlan();
    if (personalized) return personalized.phases;
  }
  return PHASE_PLANS[state.workoutMode] || [];
}

// ============================================================================
// 1. 初始化與事件綁定 (Initialization & Event Listeners)
// ============================================================================
function safeInit() {
  try {
    detectBluetoothSupport();
    initUsers();
    updatePersonalizedModeCard();
    updateSyncCodeBadge();
    setupEventListeners();
    resetWorkout();
    handleInboundHealthImport();
    resizeCanvas();
    drawTrendChart();
  } catch (err) {
    showOnScreenError(`初始化失敗: ${err.message}\n堆疊: ${err.stack}`);
  }
}

window.addEventListener('load', () => {
  resizeCanvas();
  drawTrendChart();
});
window.addEventListener('resize', () => {
  resizeCanvas();
  drawTrendChart();
});

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}

// 偵測 iOS 與 Web Bluetooth 支援度
function detectBluetoothSupport() {
  if (!navigator.bluetooth) {
    bluetoothWarningBanner.classList.remove('hidden');
    console.warn("目前瀏覽器環境不支援 Web Bluetooth API。iOS 請使用 Bluefy 瀏覽器！");
  } else {
    bluetoothWarningBanner.classList.add('hidden');
  }
}

// 初始化使用者管理 (LocalStorage)
function initUsers() {
  // 原專案資料庫 Key：'antigravity_cycling_db'
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
  optNew.innerText = '➕ 新增使用者設定...';
  userSelect.appendChild(optNew);

  userSelect.value = db.activeUserId;
}

function getActiveUser() {
  const user = db.users.find(u => u.id === db.activeUserId);
  return user || DEFAULT_USER;
}

// === 事件監聽綁定 ===
function setupEventListeners() {
  btnConnectBike.addEventListener('click', connectBike);
  
  if (btnHealthImport) {
    btnHealthImport.addEventListener('click', () => openHealthImportModal());
  }

  // 說明導引
  btnHelpGuide.addEventListener('click', () => {
    modalGuide.classList.remove('hidden');
  });

  btnCloseGuide.addEventListener('click', () => {
    closeModalById('modal-guide');
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModalById(btn.dataset.closeModal));
  });

  // 運動控制
  btnPlayPause.addEventListener('click', handlePlayPause);
  btnReset.addEventListener('click', handleWorkoutResetClick);

  // 阻力按鈕
  btnResDec.addEventListener('click', () => adjustResistance(-1));
  btnResInc.addEventListener('click', () => adjustResistance(1));

  // 5大模式切換
  document.querySelectorAll('.workout-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modeBtn = e.currentTarget;
      document.querySelectorAll('.workout-btn').forEach(b => b.classList.remove('active'));
      modeBtn.classList.add('active');
      setWorkoutMode(modeBtn.dataset.mode);
    });
  });

  // 使用者切換
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

  // 個人檔案編輯
  btnEditProfile.addEventListener('click', () => {
    openProfileModal(false);
  });
  btnCancelProfile.addEventListener('click', () => {
    closeModalById('modal-profile');
  });
  btnDeleteProfile.addEventListener('click', handleDeleteProfile);
  formProfile.addEventListener('submit', handleSaveProfile);

  // 結算關閉
  btnCloseSummary.addEventListener('click', () => {
    closeModalById('modal-summary');
  });
  btnHealthImportSummary.addEventListener('click', () => {
    openHealthImportModal(getLatestRecordForActiveUser()?.id);
  });
  btnCancelHealthImport.addEventListener('click', () => {
    closeModalById('modal-health-import');
  });

  btnParseHealthCode.addEventListener('click', parseHealthImportCodeIntoForm);
  formHealthImport.addEventListener('submit', handleSaveHealthImport);

  // 統計區間切換
  document.querySelectorAll('.stats-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.stats-tab-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.statsRange = e.currentTarget.dataset.range;
      loadHistory();
    });
  });

  // 雲端備份與下載
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

// ============================================================================
// 2. 個人檔案管理 (Modal A)
// ============================================================================
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

// ============================================================================
// 3. 運動模式設定與阻力調整 (Workout Mode & Resistance)
// ============================================================================
function setWorkoutMode(mode) {
  state.workoutMode = mode;
  const plan = getTrainingPlan(mode);

  state.modeStartedElapsed = state.isPlaying ? state.elapsedTime : 0;
  state.intervalTimeElapsed = 0;
  state.intervalPhaseIndex = 0;
  state.lastAutoResistance = null;
  state.lastPhaseKey = '';
  state.manualResistanceOverrideUntil = 0;
  state.manualResistanceOverrideSource = null;
  state.isExtended = false;

  // 重置數據折線圖
  state.fullCadenceHistory = [];

  const phases = getActivePhases();
  if (phases.length) {
    updateTrainingPhase({ forceResistance: true, announce: true });
  } else {
    targetPowerZone.innerText = `目標瓦數: ${plan.targetPower}`;
    setResistanceTrend(`手動阻力: ${state.resistance} 段`, state.resistance);
    updateFeedback(`${plan.title}：${plan.coach}`);
  }
  
  // 重置繪圖
  drawTrendChart();
}

function adjustResistance(delta) {
  let target = state.resistance + delta;
  target = Math.max(1, Math.min(24, target)); // 飛輪阻力限制 1-24 段
  setResistanceLevel(target, 'manual');
}

function normalizeResistanceLevel(level) {
  return Math.max(1, Math.min(24, Math.round(Number(level) || 1)));
}

function isResistanceManualOverrideActive() {
  return state.elapsedTime < state.manualResistanceOverrideUntil;
}

function getManualResistanceLabel() {
  return state.manualResistanceOverrideSource === 'bike' ? '飛輪手動同步' : '手動微調';
}

function setManualResistanceOverride(source) {
  state.manualResistanceOverrideUntil = state.elapsedTime + 120;
  state.manualResistanceOverrideSource = source;
}

function getResistanceReportSuffix(targetLevel) {
  if (!Number.isFinite(state.bikeReportedResistance)) return '';
  if (state.bikeReportedResistance === targetLevel) return '';
  return `｜飛輪回報 ${state.bikeReportedResistance} 段`;
}

function setResistanceTrend(text, targetLevel = null) {
  const suffix = Number.isFinite(targetLevel) ? getResistanceReportSuffix(targetLevel) : '';
  resRange.innerText = `${text}${suffix}`;
}

function setResistanceLevel(level, type = 'manual') {
  const target = normalizeResistanceLevel(level);
  state.resistance = target;
  valResistance.innerText = target;

  if (type === 'manual') {
    // 鎖定手動覆蓋 120 秒，期間不接受自動課表干擾
    setManualResistanceOverride('app');
    setResistanceTrend(`手動微調: ${target} 段 (鎖定 2 分鐘)`, target);
    updateFeedback(`您已手動將阻力調整為 ${target} 段。`);
  } else {
    state.manualResistanceOverrideUntil = 0;
    state.manualResistanceOverrideSource = null;
    setResistanceTrend(`自動阻力: ${target} 段`, target);
  }

  // 發送藍牙指令
  sendResistanceToBike(target);
  updateUI();
}

function syncResistanceFromBike(reportedResistance) {
  const target = normalizeResistanceLevel(reportedResistance);
  state.bikeReportedResistance = target;

  if (target === state.resistance) return;

  state.resistance = target;
  setManualResistanceOverride('bike');
  valResistance.innerText = target;
  setResistanceTrend(`飛輪手動同步: ${target} 段 (鎖定 2 分鐘)`, target);
  updateFeedback(`已同步飛輪實體阻力為 ${target} 段，課表自動阻力暫停 2 分鐘。`);
}

// ============================================================================
// 4. 藍牙連線：飛輪 (FTMS Service)
// ============================================================================
async function connectBike() {
  if (state.isBikeConnected) {
    disconnectBike();
    return;
  }
  if (!navigator.bluetooth) {
    updateFeedback('🚫 您的瀏覽器不支援藍牙。iOS 請使用免費的 Bluefy 瀏覽器並開啟藍牙權限。');
    modalGuide.classList.remove('hidden');
    return;
  }

  try {
    setConnectButtonState('scanning');
    updateFeedback('正在搜尋飛輪裝置...');

    const options = {
      filters: [{ services: [FTMS_SERVICE_UUID] }],
      optionalServices: [FTMS_SERVICE_UUID]
    };

    state.bikeDevice = await navigator.bluetooth.requestDevice(options);

    updateFeedback('正在與飛輪建立配對連結...');
    state.bikeDevice.addEventListener('gattserverdisconnected', onBikeDisconnected);
    
    const server = await state.bikeDevice.gatt.connect();

    updateFeedback('正在取得飛輪室內單車服務...');
    const service = await server.getPrimaryService(FTMS_SERVICE_UUID);

    updateFeedback('正在讀取騎行數據流...');
    const dataChar = await service.getCharacteristic(INDOOR_BIKE_DATA_CHAR_UUID);
    await dataChar.startNotifications();
    dataChar.addEventListener('characteristicvaluechanged', handleIndoorBikeData);

    try {
      state.controlPointChar = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT_CHAR_UUID);
      await state.controlPointChar.startNotifications();
      state.controlPointChar.addEventListener('characteristicvaluechanged', handleControlPointResponse);
      
      // 請求控制權
      await requestControl();
    } catch(cpErr) {
      console.warn("此飛輪不支持阻力控制點，將僅支持數據讀取模式:", cpErr);
      state.controlPointChar = null;
      state.hasBikeControl = false;
    }

    state.isBikeConnected = true;
    setConnectButtonState('connected');
    
    // 解鎖開始按鈕
    btnPlayPause.disabled = false;

    if (state.controlPointChar) {
      await sendResistanceToBike(state.resistance);
    }
    
    updateFeedback('🟢 飛輪連線成功！開始踩踏或點擊「開始」即可啟動計時。');
  } catch (err) {
    console.error("藍牙連線出錯:", err);
    disconnectBike();
    updateFeedback(`❌ 連線失敗: ${err.message}`);
  }
}

function setConnectButtonState(status) {
  if (status === 'scanning') {
    btnConnectBike.className = 'btn btn-primary-outline scanning';
    bikeConnText.innerText = '搜尋中...';
  } else if (status === 'connected') {
    btnConnectBike.className = 'btn btn-primary-outline connected';
    bikeConnText.innerText = '🟢 已連線';
  } else {
    btnConnectBike.className = 'btn btn-primary-outline';
    bikeConnText.innerText = '連結飛輪';
  }
}

function disconnectBike() {
  if (state.bikeDevice) {
    try {
      state.bikeDevice.gatt.disconnect();
    } catch(e) {}
  }
  onBikeDisconnected();
}

function onBikeDisconnected() {
  state.isBikeConnected = false;
  state.bikeDevice = null;
  state.controlPointChar = null;
  state.hasBikeControl = false;
  state.bikeReportedResistance = null;
  setConnectButtonState('disconnected');
  
  if (!state.isPlaying) {
    btnPlayPause.disabled = true;
  }
  updateFeedback('🔴 飛輪已中斷連線。');
}

async function requestControl() {
  if (!state.controlPointChar) return false;

  const opRequestControl = new Uint8Array([0x00]);
  const response = await writeControlPointCommand(0x00, opRequestControl);
  state.hasBikeControl = !response || response.resultCode === 0x01;
  console.log("已送出飛輪控制權請求");
  return true;
}

async function sendResistanceToBike(level) {
  if (!state.controlPointChar || !state.isBikeConnected) return false;

  const target = normalizeResistanceLevel(level);
  return enqueueControlPointCommand(async () => {
    try {
      if (!state.hasBikeControl) {
        await requestControl();
      }
      await writeResistanceCommand(target);
      console.log(`已向飛輪發送阻力指令: ${target}`);
      return true;
    } catch (e) {
      try {
        await requestControl();
        await writeResistanceCommand(target);
        console.log(`重新取得控制權後已發送阻力指令: ${target}`);
        return true;
      } catch (err) {
        console.error("發送阻力指令失敗:", e, err);
        updateFeedback(`⚠️ 阻力指令送出失敗：${err.message || err}`);
        return false;
      }
    }
  });
}

function enqueueControlPointCommand(task) {
  const run = controlPointCommandQueue.catch(() => {}).then(task);
  controlPointCommandQueue = run.catch(() => {});
  return run;
}

async function writeResistanceCommand(target) {
  const buffer = new ArrayBuffer(3);
  const view = new DataView(buffer);
  view.setUint8(0, 0x04);
  view.setInt16(1, target * 10, true);
  await writeControlPointCommand(0x04, buffer);
}

async function writeControlPointCommand(requestOpCode, command, timeoutMs = 1500) {
  const responsePromise = waitForControlPointResponse(requestOpCode, timeoutMs);
  await state.controlPointChar.writeValueWithResponse(command);
  const response = await responsePromise;

  if (response && response.resultCode !== 0x01) {
    throw new Error(response.resultText);
  }

  return response;
}

function waitForControlPointResponse(requestOpCode, timeoutMs) {
  if (!state.controlPointChar) return Promise.resolve(null);
  const controlPointChar = state.controlPointChar;

  return new Promise(resolve => {
    let done = false;

    const finish = (response) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      controlPointChar.removeEventListener('characteristicvaluechanged', onResponse);
      resolve(response);
    };

    const onResponse = (event) => {
      const response = parseControlPointResponse(event.target.value);
      if (!response || response.requestOpCode !== requestOpCode) return;
      finish(response);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    controlPointChar.addEventListener('characteristicvaluechanged', onResponse);
  });
}

function handleControlPointResponse(event) {
  const response = parseControlPointResponse(event.target.value);
  if (!response) {
    console.log("控制點回應:", event.target.value);
    return;
  }

  const { requestOpCode, resultCode, resultText } = response;
  console.log(`控制點回應: opcode=0x${requestOpCode.toString(16)} result=${resultText}`);

  if (requestOpCode === 0x00) {
    state.hasBikeControl = resultCode === 0x01;
  }

  if (requestOpCode === 0x04 && resultCode !== 0x01) {
    updateFeedback(`⚠️ 飛輪拒絕阻力調整：${resultText}`);
  }
}

function parseControlPointResponse(value) {
  if (!value || value.byteLength < 3 || value.getUint8(0) !== 0x80) return null;
  const requestOpCode = value.getUint8(1);
  const resultCode = value.getUint8(2);
  const resultTexts = {
    0x01: '成功',
    0x02: '不支援',
    0x03: '參數錯誤',
    0x04: '失敗',
    0x05: '尚未取得控制權'
  };
  return {
    requestOpCode,
    resultCode,
    resultText: resultTexts[resultCode] || `未知錯誤 ${resultCode}`
  };
}

// === 數據流解析 (與原專案 100% 同步) ===
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
    syncResistanceFromBike(normalizedResistance);
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
}

function hasPedalingSignal() {
  return state.cadence >= 8 || state.power >= 15 || state.speed >= 2;
}

function maybeAutoStartFromPedaling() {
  if (state.isPlaying || !state.isBikeConnected) return;
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

// ============================================================================
// 5. 運動核心計時與延長邏輯 (Timer & Extension)
// ============================================================================
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
  updateRideDisplayState();
  valStateText.innerText = '暫停';
  btnPlayPause.className = 'btn btn-primary paused';

  if (!state.mainTimer) {
    state.mainTimer = setInterval(tickWorkout, 1000);
  }

  updateTrainingPhase({ forceResistance: !isResistanceManualOverrideActive(), announce: true });
  updateFeedback(trigger === 'auto' ? '偵測到踩踏，已自動開始計時！' : '運動已啟動，課表倒數開始。');
}

function pauseWorkout(reason = 'manual') {
  state.isPlaying = false;
  updateRideDisplayState();
  if (reason === 'manual') {
    state.autoStartBlocked = true;
  }
  valStateText.innerText = '開始';
  btnPlayPause.className = 'btn btn-primary';

  if (state.mainTimer) {
    clearInterval(state.mainTimer);
    state.mainTimer = null;
  }

  state.cadence = 0;
  state.power = 0;
  state.speed = 0;
  updateUI();
  updateFeedback('運動已暫停。若欲結束存檔，請點擊「結束並存檔」。');
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
  state.isExtended = false;

  state.powerSamples = [];
  state.cadenceSamples = [];
  state.fullCadenceHistory = [];
  state.maxPower = 0;

  valTime.innerText = '00:00:00';
  valCalories.innerText = '0';
  valDistance.innerText = '0.00';
  calorieRate.innerText = '0 kcal/hr';

  setWorkoutMode(state.workoutMode);
  updateFeedback(reason === 'saved' ? '訓練紀錄已儲存！請補完健康資料。' : '數據已重置。');
  
  resizeCanvas();
  drawTrendChart();
  updateUI();
}

function tickWorkout() {
  state.elapsedTime++;

  // 記錄全程踏頻 (供 30 分鐘折線圖使用)
  state.fullCadenceHistory.push(state.cadence);

  // 時間顯示
  const hours = String(Math.floor(state.elapsedTime / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((state.elapsedTime % 3600) / 60)).padStart(2, '0');
  const seconds = String(state.elapsedTime % 60).padStart(2, '0');
  valTime.innerText = `${hours}:${minutes}:${seconds}`;

  const currentUser = getActiveUser();

  // 卡路里運算
  let kcalSec = 0;
  let method = '估算';

  if (state.power > 0) {
    kcalSec = state.power / 1000.0; // 1W = 1J/s. 人體功效率 ~24%，因此做功的焦耳數約等於消耗卡路里數
    method = '功率作功';
  } else if (state.speed > 0) {
    kcalSec = (currentUser.weight * 0.075) / 60.0; // METs 估算
    method = '速度粗估';
  }

  if (kcalSec > 0) {
    state.calories += kcalSec;
    valCalories.innerText = Math.round(state.calories);
    const hrRate = Math.round(kcalSec * 3600);
    calorieRate.innerText = `${hrRate} kcal/hr (${method})`;
  }

  // 累加里程 (在無連線模式下由模擬決定，有連線由飛輪本身發送，若飛輪不發送則由 JS 算速度)
  if (state.isBikeConnected && state.speed > 0) {
    state.distance += state.speed / 3600.0;
    valDistance.innerText = state.distance.toFixed(2);
  }

  // 30分鐘超時檢測
  const targetSeconds = 1800; // 30 分鐘 = 1800 秒
  if (state.elapsedTime >= targetSeconds) {
    if (hasPedalingSignal()) {
      state.isExtended = true;
    } else {
      // 停止踩踏，自動結束並存檔
      saveAndShowSummary();
      resetWorkout('saved');
      return;
    }
  }

  updateTrainingPhase();
  drawTrendChart();
}

// === 課表時序與教練提示 (AI Feedback Engine) ===
function getCurrentPhaseContext() {
  const phases = getActivePhases();
  if (!phases.length) return null;

  let elapsed = state.elapsedTime - state.modeStartedElapsed;
  let totalDuration = phases.reduce((sum, p) => sum + p.duration, 0);
  
  if (elapsed >= totalDuration) {
    // 進入超時延長
    return {
      phase: phases[phases.length - 1],
      phaseIndex: phases.length - 1,
      phaseElapsed: elapsed - totalDuration + phases[phases.length - 1].duration,
      phaseRemaining: 0,
      phases,
      planComplete: true,
      modeElapsed: elapsed,
      totalDuration
    };
  }

  let accum = 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (elapsed < accum + p.duration) {
      return {
        phase: p,
        phaseIndex: i,
        phaseElapsed: elapsed - accum,
        phaseRemaining: accum + p.duration - elapsed,
        phases,
        planComplete: false,
        modeElapsed: elapsed,
        totalDuration
      };
    }
    accum += p.duration;
  }
  return null;
}

function updateTrainingPhase(options = {}) {
  const context = getCurrentPhaseContext();
  const plan = getTrainingPlan(state.workoutMode);
  const manualOverrideActive = isResistanceManualOverrideActive();

  if (!context) {
    targetPowerZone.innerText = `目標瓦數: ${plan.targetPower}`;
    setResistanceTrend(`手動阻力: ${state.resistance} 段`, state.resistance);
    return;
  }

  const { phase, phaseIndex, phaseElapsed, phaseRemaining, phases, planComplete } = context;
  const phaseKey = `${state.workoutMode}:${phaseIndex}`;

  state.intervalPhaseIndex = phaseIndex;
  state.intervalTimeElapsed = phaseElapsed;

  // 更新階段名稱與時間
  if (state.isExtended) {
    valTime.innerText = `延長計時 +${formatCountdown(state.elapsedTime - 1800)}`;
    targetPowerZone.innerText = `目標瓦數: 恢復阻力`;
    setResistanceTrend(`超時自動延續模式`, state.resistance);
  } else if (manualOverrideActive) {
    targetPowerZone.innerText = `目標瓦數: ${phase.targetPower}`;
    setResistanceTrend(`${getManualResistanceLabel()}: ${state.resistance} 段 (鎖定 2 分鐘)`, state.resistance);
  } else {
    targetPowerZone.innerText = `目標瓦數: ${phase.targetPower}`;
    setResistanceTrend(`自動阻力: ${phase.resistance} 段`, phase.resistance);
  }

  // 1. 自動阻力變更 (FTMS)
  const shouldApplyResistance =
    options.forceResistance ||
    (
      !manualOverrideActive &&
      (
        state.lastPhaseKey !== phaseKey ||
        state.lastAutoResistance !== phase.resistance ||
        (
          state.isPlaying &&
          state.elapsedTime % 15 === 0 &&
          state.resistance !== phase.resistance
        )
      )
    );

  if (shouldApplyResistance && !state.isExtended) {
    setResistanceLevel(phase.resistance, 'auto');
    state.lastAutoResistance = phase.resistance;
  }

  // 2. 智慧教練即時語句回饋 (Coach Engine)
  if (state.isPlaying) {
    // 預告倒數
    if (phaseRemaining <= 5 && phaseRemaining > 0 && !planComplete) {
      const next = phases[phaseIndex + 1];
      if (next) {
        updateFeedback(`🏁 注意！ ${phaseRemaining} 秒後將切換至下一階段：【${next.name}】(阻力 ${next.resistance} 段)`);
      }
    } else if (state.elapsedTime % 8 === 0 || options.announce || state.lastPhaseKey !== phaseKey) {
      // 動態踩踏效率與安全監控
      const [minCad, maxCad] = phase.targetCadence.split('-').map(Number);
      
      if (state.cadence > 0) {
        const effectiveResistance = state.bikeReportedResistance || state.resistance;
        if (state.cadence > 110 && effectiveResistance < 5) {
          updateFeedback('⚠️ 踏頻過快且阻力過輕！空踩容易傷膝蓋，請使用大拇指按 ＋ 鍵增加阻力！');
        } else if (state.cadence < minCad) {
          updateFeedback(`🚴 踏頻偏低 (${state.cadence} RPM)！目前課表目標為 ${phase.targetCadence} RPM，請稍微加快速度。`);
        } else if (state.cadence > maxCad) {
          updateFeedback(`🔄 踩踏稍快。建議穩住在 ${phase.targetCadence} RPM 區間，配合呼吸節奏，不急著狂踩。`);
        } else {
          // 踏頻在目標區間內
          const user = getActiveUser();
          const wkg = (state.power / user.weight).toFixed(1);
          const feedbackPool = [
            `🌟 完美節奏！穩定控制在 ${state.cadence} RPM，請繼續維持。`,
            `💪 做得好！目前推重比為 ${wkg} W/kg，感受腿後腱肌群與核心的協同用力。`,
            `🎯 功率正常對標。核心收緊、骨盆坐穩，深吸氣、深吐氣。`
          ];
          updateFeedback(feedbackPool[Math.floor(Math.random() * feedbackPool.length)]);
        }
      } else {
        // 靜止中
        updateFeedback(`【${phase.name}】階段中。目標踏頻為 ${phase.targetCadence} RPM，請踩踏飛輪開始。`);
      }
    }
  }

  state.lastPhaseKey = phaseKey;
}

function updateFeedback(text) {
  if (rideFeedback) {
    rideFeedback.innerText = text;
  }
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const m = String(Math.floor(safeSeconds / 60)).padStart(2, '0');
  const s = String(safeSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ============================================================================
// 6. 30 分鐘全程數據 Canvas 繪圖引擎
// ============================================================================
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawTrendChart() {
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  const isMiniViewport = window.innerWidth <= 390;
  const gridLabelFont = isMiniViewport ? 12 : 9;
  const gridLineWidth = isMiniViewport ? 1.25 : 1;
  
  ctx.clearRect(0, 0, w, h);
  
  // 1. 背景漸層
  ctx.fillStyle = '#090a0f';
  ctx.fillRect(0, 0, w, h);
  
  // 2. 繪製輔助水平網格線與時間座標 (RPM: 0 - 120, Time: 0 - 30m)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = gridLineWidth;
  const rpms = [30, 60, 90];
  rpms.forEach(val => {
    const y = h - (val / 120) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    
    // 標籤
    ctx.fillStyle = isMiniViewport ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)';
    ctx.font = `${gridLabelFont}px "Outfit"`;
    ctx.fillText(`${val} RPM`, 6, y - 4);
  });
  
  // 橫軸時間軸 (0, 5, 10, 15, 20, 25, 30 分鐘)
  const times = [0, 5, 10, 15, 20, 25, 30];
  ctx.textAlign = 'center';
  ctx.fillStyle = isMiniViewport ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)';
  ctx.font = `${gridLabelFont}px "Outfit"`;
  times.forEach(t => {
    const x = (t / 30) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    
    if (t === 0) {
      ctx.textAlign = 'left';
      ctx.fillText(`${t}`, 6, h - 6);
    } else if (t === 30) {
      ctx.textAlign = 'right';
      ctx.fillText(`${t}`, w - 6, h - 6);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(`${t}`, x, h - 6);
    }
  });
  ctx.textAlign = 'left';

  // 3. 繪製目前課表的「目標強度區間」綠黃色區塊
  const phases = getActivePhases();
  if (phases.length) {
    let accumSeconds = 0;
    const totalSimSeconds = 1800; // 30分鐘
    
    phases.forEach((p, idx) => {
      const startX = (accumSeconds / totalSimSeconds) * w;
      const endX = ((accumSeconds + p.duration) / totalSimSeconds) * w;
      const [minCad, maxCad] = p.targetCadence.split('-').map(Number);
      
      const startY = h - (minCad / 120) * h;
      const endY = h - (maxCad / 120) * h;
      
      // 區塊顏色：依阻力難度顯示綠/黃/紅
      let blockColor = 'rgba(57, 255, 20, 0.05)';
      if (p.resistance >= 8) blockColor = 'rgba(255, 94, 0, 0.06)';
      else if (p.resistance >= 5) blockColor = 'rgba(204, 255, 0, 0.05)';
      
      ctx.fillStyle = blockColor;
      ctx.fillRect(startX, endY, endX - startX, startY - endY);
      
      // 繪製目標邊界線
      ctx.strokeStyle = blockColor.replace('0.05', '0.15').replace('0.06', '0.18');
      ctx.lineWidth = 1;
      ctx.strokeRect(startX, endY, endX - startX, startY - endY);
      
      accumSeconds += p.duration;
    });
  }

  // 4. 繪製使用者實際騎行踏頻曲線 (橘色發光線)
  const historyLen = state.fullCadenceHistory.length;
  if (historyLen > 0) {
    ctx.save();
    ctx.strokeStyle = '#ff5e00';
    ctx.shadowColor = '#ff5e00';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    
    for (let i = 0; i < historyLen; i++) {
      // 限制在 30 分鐘 (1800 秒) 內對齊
      const xRatio = i / 1800;
      const x = xRatio * w;
      // 踏頻限制 0-120 RPM 顯示
      const yRatio = Math.min(120, state.fullCadenceHistory[i]) / 120;
      const y = h - yRatio * h;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
    
    // 繪製曲線尾部的發光呼吸點
    const lastIdx = historyLen - 1;
    const lastX = (lastIdx / 1800) * w;
    const lastY = h - (Math.min(120, state.fullCadenceHistory[lastIdx]) / 120) * h;
    
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ff5e00';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    // 5. 繪製當前進度的垂直白線 (Vertical Progress Line)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(lastX, 0);
    ctx.lineTo(lastX, h);
    ctx.stroke();
  }

  // 6. 計算踏頻加速/減速趨勢，並更新徽章 (Slope Calculation)
  if (historyLen > 6) {
    const lastVals = state.fullCadenceHistory.slice(-3); // 最近 3 秒
    const prevVals = state.fullCadenceHistory.slice(-6, -3); // 之前 3 秒
    
    const lastAvg = lastVals.reduce((a,b)=>a+b, 0) / 3;
    const prevAvg = prevVals.reduce((a,b)=>a+b, 0) / 3;
    
    const diff = lastAvg - prevAvg;
    if (diff > 1.8) {
      trendBadge.innerText = '⚡ 踏頻加速中 ↗';
      trendBadge.className = 'trend-badge';
    } else if (diff < -1.8) {
      trendBadge.innerText = '📉 踏頻減速中 ↘';
      trendBadge.className = 'trend-badge slow';
    } else {
      trendBadge.innerText = '🟢 踏頻穩定中 ➔';
      trendBadge.className = 'trend-badge stable';
    }
  } else {
    trendBadge.innerText = '🟢 踏頻穩定中 ➔';
    trendBadge.className = 'trend-badge stable';
  }
}

// ============================================================================
// 7. 數據結算與下次建議引擎 (Summary & Next Workout Prescription)
// ============================================================================
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

  // 1. 存入 LocalStorage 歷史紀錄 (保留原專案 key)
  const history = getHistoryFromStorage();
  history.push(record);
  safeSetItem('antigravity_cycling_history', JSON.stringify(history));

  // 2. 顯示結算 Modal 數據
  modalSummary.classList.remove('hidden');
  sumTime.innerText = formatDuration(state.elapsedTime);
  sumCalories.innerText = `${Math.round(state.calories)} kcal`;
  sumDistance.innerText = `${state.distance.toFixed(2)} km`;
  sumPower.innerText = `${avgPower} / ${state.maxPower} W`;
  sumCadence.innerText = `${avgCadence} RPM`;
  sumHr.innerText = '未匯入';

  // 3. 生成智慧評估報告與下次課表建議
  generateSummaryAnalysisReport(record, user);

  // 重置 UI 與本週累計
  loadHistory();
}

function calculateStabilityScore(powerSamples, cadenceSamples) {
  if (cadenceSamples.length < 10) return 50;
  // 計算踏頻的標準差
  const mean = cadenceSamples.reduce((a,b)=>a+b, 0) / cadenceSamples.length;
  const sqDiffs = cadenceSamples.map(v => Math.pow(v - mean, 2));
  const avgSqDiff = sqDiffs.reduce((a,b)=>a+b, 0) / sqDiffs.length;
  const stdDev = Math.sqrt(avgSqDiff);
  
  // 標準差越小越穩定，大於 10 RPM 判定為極不穩
  const score = 100 - (stdDev * 6);
  return Math.max(30, Math.min(100, Math.round(score)));
}

function calculateIntensityScore(avgPower, weight, mode) {
  if (weight <= 0) weight = 70;
  const wkg = avgPower / weight;
  // 推重比 > 3.0 給予高分，恢復模式下低功率也是合適的
  let targetWkg = 2.0;
  if (mode === 'climb' || mode === 'tempo') targetWkg = 2.8;
  else if (mode === 'recovery') targetWkg = 1.2;
  
  const ratio = wkg / targetWkg;
  return Math.max(40, Math.min(100, Math.round(ratio * 80)));
}

function calculateCompletionScore(elapsedTime, mode) {
  const targetSeconds = 1800; // 30 分鐘
  const score = (elapsedTime / targetSeconds) * 100;
  return Math.max(10, Math.min(100, Math.round(score)));
}

// 產生結算分析與下次建議模式課表，並更新至建議模式中 (localStorage)
function generateSummaryAnalysisReport(record, user) {
  analysisReportContent.innerHTML = '';
  document.getElementById('analysis-text-loading').style.display = 'none';

  const wkg = (record.avgPower / user.weight).toFixed(2);
  
  // 建立分析區塊 DOM
  const secSummary = document.createElement('div');
  secSummary.className = 'advice-section';
  secSummary.innerHTML = `
    <strong>本次訓練總結</strong>
    <p>完成了 【${record.modeTitle}】 課表。平均輸出功率 ${record.avgPower}W，推重比達到 ${wkg} W/kg。踏頻穩定度得分為 ${record.stabilityScore}分，踩踏完成度為 ${record.completionScore}%。</p>
  `;
  analysisReportContent.appendChild(secSummary);

  // 計算下次推薦模式與課表
  let nextMode = 'endurance';
  let nextTitle = '下次建議：穩踩有氧耐力';
  let nextReason = '有氧打底課表。建議踩踏穩在 62-72 RPM，使用 5-7 段中阻力。';
  let nextFocus = '維持中阻力恆定有氧區間，改善踩踏平穩度。';

  if (record.completionScore < 70 || record.stabilityScore < 75) {
    nextMode = 'recovery';
    nextTitle = '下次建議：穩踩恢復排酸';
    nextReason = '您本次運動完成度偏低或踩踏不夠平穩，教練建議下次用 5-7 段張力恢復，不做空轉高頻。';
    nextFocus = '中阻力穩踩排酸，重心收緊骨盆。';
  } else if (record.avgPower / user.weight > 2.5) {
    nextMode = 'climb';
    nextTitle = '下次建議：間歇爬坡阻力';
    nextReason = '您展現出極高的推重比與肌力耐受，下次課表建議進行高強度重阻力間歇，挑戰腿部爆發力！';
    nextFocus = '重阻力低踏頻間歇，挑戰無氧區。';
  } else {
    nextMode = 'tempo';
    nextTitle = '下次建議：甜蜜點增能';
    nextReason = '您順利完成了訓練，各指標均達標。下次建議進行甜蜜點增能，在不產生過度疲勞下提高 FTP 功率。';
    nextFocus = '主段中高阻力恆定輸出，增強心肺。';
  }

  // 將下次建議課表寫入 LocalStorage (供 Suggested Mode 頁籤讀取)
  const prescription = {
    mode: nextMode,
    title: nextTitle,
    reason: nextReason,
    focus: nextFocus,
    cadence: getPlanCadenceSummary(PHASE_PLANS[nextMode]),
    phases: PHASE_PLANS[nextMode]
  };
  savePersonalizedTrainingPlan(prescription, record);

  const secNext = document.createElement('div');
  secNext.className = 'advice-section';
  secNext.innerHTML = `
    <strong>下次訓練建議 (已自動同步至「建議模式」)</strong>
    <p>推薦進行<strong>【${TRAINING_PLANS[nextMode].title}】</strong>模式。${nextReason}</p>
  `;
  analysisReportContent.appendChild(secNext);
}

function savePersonalizedTrainingPlan(prescription, record) {
  const phases = prescription.phases || PHASE_PLANS[prescription.mode];
  const totalSeconds = phases.reduce((sum, p) => sum + p.duration, 0);
  const plan = {
    id: `next_${Date.now()}`,
    sourceRecordId: record.id,
    createdAt: new Date().toISOString(),
    title: prescription.title,
    mode: 'personalized',
    sourceMode: prescription.mode,
    cadence: prescription.cadence,
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
    personalizedModeDesc.innerText = '完成首次訓練並匯入紀錄後，系統將自動產生下次的個人化建議。';
    return;
  }
  personalizedModeDesc.innerText = `${plan.title} / 30 分鐘。${plan.focus}`;
}

// ============================================================================
// 8. Apple Watch 健康資料匯入 (Modal C & Inbound Query)
// ============================================================================
function openHealthImportModal(recordId = null) {
  modalHealthImport.classList.remove('hidden');
  healthImportFeedback.classList.add('hidden');
  formHealthImport.reset();

  if (recordId) {
    healthTargetRecordId.value = recordId;
  } else {
    // 預設套用到當前使用者最新的一筆紀錄
    const latest = getLatestRecordForActiveUser();
    healthTargetRecordId.value = latest ? latest.id : '';
  }
}

function getLatestRecordForActiveUser() {
  const history = getHistoryFromStorage();
  const user = getActiveUser();
  const userRecs = history.filter(h => h.userId === user.id);
  if (!userRecs.length) return null;
  userRecs.sort((a,b) => new Date(b.date) - new Date(a.date));
  return userRecs[0];
}

function parseHealthImportCodeIntoForm() {
  const raw = healthImportCode.value.trim();
  if (!raw) {
    showHealthFeedback('請先貼上快捷鍵複製的匯入網址或 JSON 資料。', 'error');
    return;
  }

  try {
    let parsedData = {};
    if (raw.startsWith('http')) {
      const url = new URL(raw);
      parsedData.avgHr = url.searchParams.get('avgHr');
      parsedData.maxHr = url.searchParams.get('maxHr');
      parsedData.activeKcal = url.searchParams.get('activeKcal');
      parsedData.exerciseMin = url.searchParams.get('exerciseMin');
      parsedData.rpe = url.searchParams.get('rpe');
      parsedData.note = url.searchParams.get('note');
    } else {
      parsedData = JSON.parse(raw);
    }

    if (parsedData.avgHr) healthAvgHr.value = parsedData.avgHr;
    if (parsedData.maxHr) healthMaxHr.value = parsedData.maxHr;
    if (parsedData.activeKcal) healthActiveKcal.value = parsedData.activeKcal;
    if (parsedData.exerciseMin) healthExerciseMin.value = parsedData.exerciseMin;
    if (parsedData.rpe) healthRpe.value = parsedData.rpe;
    if (parsedData.note) healthNote.value = parsedData.note;

    showHealthFeedback('解析成功！請點擊下方「套用到訓練」按鈕儲存。', 'success');
  } catch(e) {
    showHealthFeedback(`解析失敗: 格式不正確。請確定貼上了正確的網址或 JSON 資料。`, 'error');
  }
}

function showHealthFeedback(msg, type) {
  healthImportFeedback.innerText = msg;
  healthImportFeedback.className = `modal-feedback-msg ${type}`;
  healthImportFeedback.classList.remove('hidden');
}

function handleSaveHealthImport(e) {
  e.preventDefault();
  const recordId = healthTargetRecordId.value;
  if (!recordId) {
    alert('找不到套用的運動紀錄，請先完成一次騎行。');
    return;
  }

  const history = getHistoryFromStorage();
  const recordIndex = history.findIndex(h => h.id === recordId);
  if (recordIndex < 0) {
    alert('找不到該筆運動紀錄。');
    return;
  }

  const avgHr = parseInt(healthAvgHr.value) || 0;
  const maxHr = parseInt(healthMaxHr.value) || 0;
  const activeKcal = parseInt(healthActiveKcal.value) || 0;
  const exerciseMin = parseInt(healthExerciseMin.value) || 0;
  const rpe = parseInt(healthRpe.value) || 5;
  const note = healthNote.value.trim();

  // 更新紀錄中的健康資料
  history[recordIndex].healthImported = true;
  history[recordIndex].healthMetrics = {
    avgHr,
    maxHr,
    activeKcal,
    exerciseMin,
    rpe,
    note
  };

  safeSetItem('antigravity_cycling_history', JSON.stringify(history));
  modalHealthImport.classList.add('hidden');

  // 如果結算視窗打開中，同步更新結算視窗的心率/熱量顯示
  if (!modalSummary.classList.contains('hidden')) {
    sumHr.innerText = `${avgHr} / ${maxHr} BPM`;
    if (activeKcal > 0) {
      sumCalories.innerText = `${Math.round(history[recordIndex].calories)} (飛輪) / ${activeKcal} (手錶) kcal`;
    }
    
    // 重新繪製報告，加入 Apple Watch 心率健康分析
    const user = getActiveUser();
    appendAppleWatchAnalysisReport(history[recordIndex], user);
  }

  loadHistory();
}

function appendAppleWatchAnalysisReport(record, user) {
  const content = document.getElementById('analysis-report-content');
  if (!content || !record.healthMetrics) return;

  // 移出原有的健康報告 (如果有的話)
  const oldWatchSec = content.querySelector('.watch-analysis-section');
  if (oldWatchSec) oldWatchSec.remove();

  const metrics = record.healthMetrics;
  const secWatch = document.createElement('div');
  secWatch.className = 'advice-section watch-analysis-section';
  
  // 計算心率區間 (HR Zones)
  // Max HR 預估公式 = 220 - 年齡
  const estMaxHr = 220 - user.age;
  const pctMax = Math.round((metrics.avgHr / estMaxHr) * 100);
  let zoneText = '有氧恢復區';
  if (pctMax >= 90) zoneText = '無氧極限區 (Zone 5)';
  else if (pctMax >= 80) zoneText = '乳酸閾值區 (Zone 4)';
  else if (pctMax >= 70) zoneText = '有氧耐力區 (Zone 3)';
  else if (pctMax >= 60) zoneText = '基礎脂肪燃燒區 (Zone 2)';

  secWatch.innerHTML = `
    <strong>Apple Watch 數據融合分析</strong>
    <p>主動熱量為 ${metrics.activeKcal} kcal，運動分鐘為 ${metrics.exerciseMin} 分鐘。平均心率達最大心率的 ${pctMax}% (${zoneText})。主觀疲勞感 (RPE) 自評為 ${metrics.rpe}/10 段。</p>
  `;
  content.appendChild(secWatch);
}

// 監聽捷徑自動開網址參數匯入 (與原專案 100% 同步)
function handleInboundHealthImport() {
  const urlParams = new URLSearchParams(window.location.search);
  const avgHr = urlParams.get('avgHr');
  const maxHr = urlParams.get('maxHr');
  const activeKcal = urlParams.get('activeKcal');
  const exerciseMin = urlParams.get('exerciseMin');
  const rpe = urlParams.get('rpe');
  const note = urlParams.get('note');

  if (avgHr || maxHr || activeKcal || exerciseMin) {
    const latest = getLatestRecordForActiveUser();
    if (!latest) {
      console.warn("偵測到健康匯入參數，但當前使用者尚未有任何騎行紀錄。");
      return;
    }

    const history = getHistoryFromStorage();
    const idx = history.findIndex(h => h.id === latest.id);
    if (idx >= 0) {
      history[idx].healthImported = true;
      history[idx].healthMetrics = {
        avgHr: parseInt(avgHr) || 0,
        maxHr: parseInt(maxHr) || 0,
        activeKcal: parseInt(activeKcal) || 0,
        exerciseMin: parseInt(exerciseMin) || 0,
        rpe: parseInt(rpe) || 5,
        note: note || ''
      };
      safeSetItem('antigravity_cycling_history', JSON.stringify(history));
      loadHistory();

      // 清除 URL 參數，避免重整時重複匯入
      window.history.replaceState({}, document.title, window.location.pathname);
      alert(`🎉 成功透過捷徑匯入 Apple Watch 數據！\n\n已成功補完您最新一筆騎行紀錄（${formatDate(latest.date)}）！`);
    }
  }
}

// ============================================================================
// 9. 數據持久化與本週累計趨勢圖 (LocalStorage & SVG Trend)
// ============================================================================
function getHistoryFromStorage() {
  // 原專案歷史紀錄 Key：'antigravity_cycling_history'
  const raw = safeGetItem('antigravity_cycling_history');
  if (!raw) return [];
  try {
    return JSON.parse(raw) || [];
  } catch(e) {
    return [];
  }
}

function loadHistory() {
  const history = getHistoryFromStorage();
  const user = getActiveUser();
  
  // 篩選當前使用者的紀錄並以時間降序排序
  const userRecs = history.filter(h => h.userId === user.id);
  userRecs.sort((a,b) => new Date(b.date) - new Date(a.date));

  // 渲染歷史清單 DOM
  historyList.innerHTML = '';
  if (userRecs.length === 0) {
    const li = document.createElement('li');
    li.className = 'no-records';
    li.innerText = '尚未有騎行紀錄。';
    historyList.appendChild(li);
  } else {
    userRecs.forEach(rec => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.onclick = () => showPastSummary(rec);

      const durationStr = formatDuration(rec.duration);
      const isImportedText = rec.healthImported ? '🟢 已匯入健康' : '🔴 待匯入健康';
      
      li.innerHTML = `
        <div class="history-item-left">
          <span class="hist-date">${formatDate(rec.date)}</span>
          <span class="hist-meta">模式: ${rec.modeTitle} | 時間: ${durationStr}</span>
        </div>
        <div class="history-item-right">
          <span class="hist-val">${rec.calories} kcal</span>
          <span class="hist-status-icon" title="${isImportedText}">${rec.healthImported ? '⌚' : '🚲'}</span>
        </div>
      `;
      historyList.appendChild(li);
    });
  }

  // 更新累計統計標題
  const titleEl = document.getElementById('stats-panel-title');
  if (titleEl) {
    if (state.statsRange === 'week') titleEl.innerText = '本週運動累計';
    else if (state.statsRange === 'month') titleEl.innerText = '本月運動累計';
    else if (state.statsRange === 'year') titleEl.innerText = '一年運動累計';
  }

  // 計算並渲染對應區間的運動累計與 SVG 柱狀圖
  calculateStatsByRange(userRecs, state.statsRange);
}

function showPastSummary(rec) {
  modalSummary.classList.remove('hidden');
  sumTime.innerText = formatDuration(rec.duration || 0);
  sumCalories.innerText = `${Math.round(rec.calories || 0)} kcal`;
  sumDistance.innerText = `${Number(rec.distance || 0).toFixed(2)} km`;
  sumPower.innerText = `${rec.avgPower || 0} / ${rec.maxPower || 0} W`;
  sumCadence.innerText = `${rec.avgCadence || 0} RPM`;
  
  if (rec.healthImported && rec.healthMetrics) {
    sumHr.innerText = `${rec.healthMetrics.avgHr || 0} / ${rec.healthMetrics.maxHr || 0} BPM`;
    if (rec.healthMetrics.activeKcal > 0) {
      sumCalories.innerText = `${Math.round(rec.calories || 0)} (飛輪) / ${rec.healthMetrics.activeKcal} (手錶) kcal`;
    }
  } else {
    sumHr.innerText = '未匯入';
  }

  // 自動設定匯入 ID
  healthTargetRecordId.value = rec.id;

  // 重新渲染運動報告
  const user = getActiveUser();
  generateSummaryAnalysisReport(rec, user);
  if (rec.healthImported) {
    appendAppleWatchAnalysisReport(rec, user);
  }
}

function calculateStatsByRange(userRecs, range) {
  const now = new Date();
  let filteredRecs = [];
  let startDate = null;

  if (range === 'week') {
    // 取得本週一的零點
    const day = now.getDay();
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
    startDate = new Date(now.setDate(diffToMonday));
    startDate.setHours(0, 0, 0, 0);
    filteredRecs = userRecs.filter(r => new Date(r.date) >= startDate);
  } else if (range === 'month') {
    // 取得本月一號的零點
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate.setHours(0, 0, 0, 0);
    filteredRecs = userRecs.filter(r => new Date(r.date) >= startDate);
  } else if (range === 'year') {
    // 今年以來的紀錄
    startDate = new Date(now.getFullYear(), 0, 1);
    startDate.setHours(0, 0, 0, 0);
    filteredRecs = userRecs.filter(r => new Date(r.date) >= startDate);
  } else {
    filteredRecs = [...userRecs];
  }

  let count = filteredRecs.length;
  let totalSecs = filteredRecs.reduce((sum, r) => sum + r.duration, 0);
  let totalKcal = filteredRecs.reduce((sum, r) => sum + r.calories, 0);
  let totalDist = filteredRecs.reduce((sum, r) => sum + r.distance, 0);

  weeklyCount.innerText = count;
  weeklyTime.innerText = `${Math.round(totalSecs / 60)}m`;
  weeklyCalories.innerText = Math.round(totalKcal);
  weeklyDistance.innerText = totalDist.toFixed(1);

  // 繪製對應區間的 SVG 柱狀圖
  drawStatsSvgChart(filteredRecs, range);
}

function drawStatsSvgChart(filteredRecs, range) {
  weeklySvgChart.innerHTML = '';
  
  let numBars = 7;
  let chartData = [];
  let chartLabels = [];
  let colWidth = 28;
  let gap = 12;
  let startX = 20;

  if (range === 'week') {
    numBars = 7;
    chartData = Array(7).fill(0);
    chartLabels = ['一', '二', '三', '四', '五', '六', '日'];
    colWidth = 24;
    gap = 10;
    startX = 35;

    filteredRecs.forEach(rec => {
      const recDate = new Date(rec.date);
      let dayIdx = recDate.getDay() - 1; // 0=Mon, 5=Sat, -1=Sun
      if (dayIdx === -1) dayIdx = 6;
      if (dayIdx >= 0 && dayIdx < 7) {
        chartData[dayIdx] += rec.calories;
      }
    });
  } else if (range === 'month') {
    numBars = 5;
    chartData = Array(5).fill(0);
    chartLabels = ['W1', 'W2', 'W3', 'W4', 'W5'];
    colWidth = 32;
    gap = 16;
    startX = 35;

    filteredRecs.forEach(rec => {
      const recDate = new Date(rec.date);
      const dayOfMonth = recDate.getDate();
      const weekIdx = Math.min(4, Math.floor((dayOfMonth - 1) / 7));
      chartData[weekIdx] += rec.calories;
    });
  } else if (range === 'year') {
    numBars = 12;
    chartData = Array(12).fill(0);
    chartLabels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    colWidth = 14;
    gap = 6;
    startX = 30;

    filteredRecs.forEach(rec => {
      const recDate = new Date(rec.date);
      const monthIdx = recDate.getMonth(); // 0-11
      if (monthIdx >= 0 && monthIdx < 12) {
        chartData[monthIdx] += rec.calories;
      }
    });
  }

  const maxVal = Math.max(100, ...chartData);
  const height = 70;

  chartData.forEach((val, idx) => {
    const x = startX + idx * (colWidth + gap);
    const colHeight = (val / maxVal) * (height - 25);
    const y = height - 15 - colHeight;

    // 柱子本體 (帶發光漸層效果)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', colWidth);
    rect.setAttribute('height', Math.max(2, colHeight));
    rect.setAttribute('rx', 3);
    rect.setAttribute('fill', val > 0 ? '#ccff00' : 'rgba(255, 255, 255, 0.04)');
    if (val > 0) {
      rect.setAttribute('filter', 'drop-shadow(0px 0px 4px rgba(204, 255, 0, 0.4))');
    }
    weeklySvgChart.appendChild(rect);

    // 數值文字
    if (val > 0) {
      const txtVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txtVal.setAttribute('x', x + colWidth / 2);
      txtVal.setAttribute('y', y - 4);
      txtVal.setAttribute('text-anchor', 'middle');
      txtVal.setAttribute('fill', '#ccff00');
      txtVal.setAttribute('font-size', range === 'year' ? '6.5px' : '7.5px');
      txtVal.setAttribute('font-family', 'Outfit');
      txtVal.textContent = Math.round(val);
      weeklySvgChart.appendChild(txtVal);
    }

    // 底部標籤
    const txtLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txtLbl.setAttribute('x', x + colWidth / 2);
    txtLbl.setAttribute('y', height - 4);
    txtLbl.setAttribute('text-anchor', 'middle');
    txtLbl.setAttribute('fill', '#8e90a6');
    txtLbl.setAttribute('font-size', '9px');
    txtLbl.textContent = chartLabels[idx];
    weeklySvgChart.appendChild(txtLbl);
  });
}

// ============================================================================
// 10. 歷史紀錄雲端備份與還原 (與原專案 100% 同步，使用同個 KVDB.io bucket)
// ============================================================================
function updateSyncCodeBadge() {
  const syncCode = safeGetItem('antigravity_sync_code');
  if (syncCode && syncCode.trim().length === 6) {
    syncCodeDisplay.innerText = `🔑 同步碼: ${syncCode.trim()}`;
    syncCodeDisplay.style.display = 'inline-block';
  } else {
    syncCodeDisplay.style.display = 'none';
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

    // 保留雲端備份上傳 TTL 限制 (30 天)
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
        alert(`🎉 首次上傳成功！\n\n您的專屬 6 位數同步碼為：\n\n👉【 ${syncCode} 】\n\n請在另一台設備上點擊「下載還原」並輸入此號碼進行綁定。系統將會記住此號碼，以後一鍵即可上傳與下載！`);
      } else {
        alert(`🎉 雲端備份成功！\n\n專屬同步碼：${syncCode}，已自動記錄在您的瀏覽器中。`);
      }
      updateFeedback(`✅ 雲端備份成功！同步碼：${syncCode}`);
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
    help: '請輸入另一台設備上傳備份後產生的 6 位數同步碼。',
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
    db = currentDb;
    
    // 依時間排序歷史紀錄 (最新優先)
    mergedHistory.sort((a, b) => new Date(b.date || b.startTime || 0) - new Date(a.date || a.startTime || 0));
    
    safeSetItem('antigravity_cycling_history', JSON.stringify(mergedHistory));

    // 更新 UI 中的同步碼徽章
    updateSyncCodeBadge();

    // 3. 重新讀取與渲染 UI
    initUsers(); // 會呼叫 loadHistory() 與 updateUI()
    updatePersonalizedModeCard();
    resetWorkout();

    const cloudCount = backupHistory.length;
    const activeUserName = currentDb.users.find(user => user.id === preferredUserId)?.name || '雲端使用者';
    const syncSummary = `雲端同步 ${cloudCount} 筆：新增 ${addedCount}、更新 ${updatedCount}、已在手機 ${unchangedCount}。已切換到「${activeUserName}」。`;

    if (isAutoDownload) {
      alert(`🎉 歷史紀錄雲端下載與合併完成！\n\n${syncSummary}\n\n（使用同步碼：${syncCode}）`);
    } else {
      alert(`🎉 歷史紀錄雲端下載與合併完成！\n\n${syncSummary}\n\n已自動為您記錄同步碼：${syncCode}，下次下載將直接自動同步，不需再次輸入！`);
    }
    updateFeedback(`✅ 雲端下載成功！${syncSummary}`);
  })
  .catch(err => {
    alert(`❌ 下載失敗: ${err.message}`);
    updateFeedback(`❌ 下載失敗: ${err.message}`);
    // 若下載失敗且是自動下載，則清除該無效的同步碼，便於重新輸入
    if (isAutoDownload) {
      localStorage.removeItem('antigravity_sync_code');
      updateSyncCodeBadge();
    }
  });
}

function openSyncCodeModal(opts) {
  modalSyncCode.classList.remove('hidden');
  syncModalTitle.innerText = opts.title || '輸入同步碼';
  syncModalHelp.innerText = opts.help || '';
  syncCodeInput.value = opts.defaultValue || '';
  
  const submitBtn = modalSyncCode.querySelector('[type="submit"]');
  if (submitBtn) {
    submitBtn.innerText = opts.buttonText || '確認';
  }
  
  pendingSyncCodeSubmit = opts.onSubmit;
}

function handleSyncCodeSubmit(e) {
  e.preventDefault();
  const val = syncCodeInput.value.trim();
  if (val.length !== 6 || isNaN(Number(val))) {
    alert('請輸入 6 位數字的同步碼。');
    return;
  }
  if (typeof pendingSyncCodeSubmit === 'function') {
    pendingSyncCodeSubmit(val);
  }
}

function closeSyncCodeModal() {
  modalSyncCode.classList.add('hidden');
  pendingSyncCodeSubmit = null;
}

function handleSyncCodeBadgeClick() {
  const current = safeGetItem('antigravity_sync_code') || '';
  if (confirm(`您的設備目前已記錄同步碼為【${current}】\n\n點選「確定」將清除此記錄，方便您重新綁定其他的同步碼。\n(清除此記錄不會影響您已經保存在本地或雲端的資料)`)) {
    localStorage.removeItem('antigravity_sync_code');
    updateSyncCodeBadge();
    updateFeedback('已清除本機同步碼記錄，您可以重新綁定。');
  }
}

// ============================================================================
// 11. 輔助工具函式 (Helper Functions)
// ============================================================================
function updateUI() {
  updateRideDisplayState();
  valResistance.innerText = state.resistance;
  valPower.innerText = state.power;
  valCadence.innerText = Math.round(state.cadence);
  valDistance.innerText = state.distance.toFixed(2);
  valCalories.innerText = Math.round(state.calories);
  
  if (state.cadence > 0) {
    cadenceStatus.innerText = `${Math.round(state.cadence)} RPM`;
  } else {
    cadenceStatus.innerText = '靜止中';
  }
}

function updateRideDisplayState() {
  document.body.classList.toggle('ride-active', state.isPlaying);
  document.body.classList.toggle('ride-has-signal', hasPedalingSignal());
}

function closeModalById(modalId) {
  if (!modalId) return;
  if (modalId === 'modal-profile') {
    modalProfile.classList.add('hidden');
    userSelect.value = db.activeUserId;
    return;
  }
  if (modalId === 'modal-summary') {
    modalSummary.classList.add('hidden');
    resetWorkout();
    return;
  }
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const r = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${r} ${h}:${min}`;
  } catch (e) {
    return isoString;
  }
}

function formatDuration(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
