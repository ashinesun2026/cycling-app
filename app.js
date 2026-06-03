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
    targetPower: '70~105 W',
    targetCadence: '85~95 RPM',
    resistance: 2,
    intensity: '低',
    focus: '放鬆腿部、促進恢復',
    coach: '恢復騎：阻力保持輕，重點是順踩和放鬆，不追求高瓦數。'
  },
  endurance: {
    label: '耐力',
    title: '有氧耐力',
    targetPower: '95~140 W',
    targetCadence: '80~92 RPM',
    resistance: 5,
    intensity: '中低',
    focus: '基礎心肺、長時間穩定輸出',
    coach: '有氧耐力：把輸出維持穩定，避免一開始衝太高。'
  },
  tempo: {
    label: '節奏',
    title: '燃脂節奏',
    targetPower: '135~175 W',
    targetCadence: '78~88 RPM',
    resistance: 8,
    intensity: '中高',
    focus: '燃脂巡航、配速耐受',
    coach: '燃脂節奏：保持可控壓力，呼吸變深但不要爆掉。'
  },
  cadence: {
    label: '踏頻',
    title: '踏頻技巧',
    targetPower: '90~130 W',
    targetCadence: '95~110 RPM',
    resistance: 4,
    intensity: '技巧',
    focus: '踩踏圓順、神經肌肉協調',
    coach: '踏頻技巧：阻力不要太重，讓雙腳轉得順，不要上下跳。'
  },
  climb: {
    label: '爬坡',
    title: '爬坡肌耐力',
    targetPower: '160~220 W',
    targetCadence: '60~75 RPM',
    resistance: 12,
    intensity: '高',
    focus: '腿力、肌耐力、穩定推踩',
    coach: '爬坡肌耐力：接受低踏頻，但要穩住身體和踩踏張力。'
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
  interval: [
    { name: '有氧熱身', duration: 120, resistance: 3, targetCadence: '85-95', targetPower: '90-110W', info: '輕鬆踩踏，喚醒身體。' },
    { name: '高強度衝刺', duration: 120, resistance: 10, targetCadence: '75-85', targetPower: '180-220W', info: '加重阻力，全力輸出。' },
    { name: '動態恢復', duration: 120, resistance: 4, targetCadence: '85-90', targetPower: '100-120W', info: '放慢速度，調整呼吸。' },
    { name: '極限爬坡', duration: 120, resistance: 12, targetCadence: '70-80', targetPower: '200-240W', info: '穩定踩壓，挑戰腿力。' },
    { name: '緩和冷卻', duration: 120, resistance: 3, targetCadence: '80-90', targetPower: '80-100W', info: '降低強度，讓身體回穩。' }
  ],
  pyramid: [
    { name: '暖身', duration: 90, resistance: 3, targetCadence: '85-92', targetPower: '90-115W', info: '輕鬆進入狀態。' },
    { name: '第一階', duration: 90, resistance: 6, targetCadence: '82-90', targetPower: '120-150W', info: '逐步提高張力。' },
    { name: '第二階', duration: 90, resistance: 9, targetCadence: '75-85', targetPower: '150-185W', info: '維持穩定呼吸。' },
    { name: '高峰', duration: 90, resistance: 12, targetCadence: '68-78', targetPower: '185-225W', info: '最難階段，穩住節奏。' },
    { name: '下降', duration: 90, resistance: 7, targetCadence: '80-90', targetPower: '130-160W', info: '降強度但不要放掉姿勢。' },
    { name: '冷卻', duration: 90, resistance: 3, targetCadence: '82-92', targetPower: '80-110W', info: '放鬆收操。' }
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

// === 初始化 ===
function safeInit() {
  try {
    detectBluetoothSupport();
    initUsers();
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
  const plan = TRAINING_PLANS[mode] || TRAINING_PLANS.free;

  intervalPanel.classList.add('hidden');
  if (state.intervalTimer) {
    clearInterval(state.intervalTimer);
    state.intervalTimer = null;
  }

  targetPowerZone.innerText = `目標瓦數: ${plan.targetPower}`;
  resRange.innerText = plan.resistance ? `目標阻力: ${plan.resistance} 段` : '阻力依課表調整';
  updateFeedback(`${plan.title}：${plan.coach}`);

  if (typeof plan.resistance === 'number') {
    adjustResistance(plan.resistance - state.resistance);
  }

  if (PHASE_PLANS[mode]) {
    if (state.isPlaying) {
      startIntervalWorkout();
    }
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
    btnConnectBike.classList.remove('btn-primary');
    btnConnectBike.classList.add('btn-secondary');
    bikeConnText.innerText = '中斷飛輪';
    btnPlayPause.disabled = false;

    updateFeedback('飛輪連線成功！可以點擊下方「開始騎行」。');
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
    try {
      const cmd = new Uint8Array([0x04, level]);
      await state.controlPointChar.writeValueWithResponse(cmd);
      console.log(`已向飛輪發送阻力指令: ${level}`);
    } catch (e) {
      console.error("發送阻力指令失敗:", e);
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
    if (state.isPlaying && state.cadence > 0) state.cadenceSamples.push(state.cadence);
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
    state.resistance = dataView.getInt16(offset, true);
    offset += 2;
  }
  if (flags & 0x0040) {
    state.power = dataView.getInt16(offset, true);
    offset += 2;
    if (state.isPlaying && state.power > 0) {
      state.powerSamples.push(state.power);
      if (state.power > state.maxPower) state.maxPower = state.power;
    }
  }

  updateUI();
  updateAnimationSpeeds();
}

// === 運動核心計時 ===
function handlePlayPause() {
  if (state.isPlaying) {
    pauseWorkout();
  } else {
    startWorkout();
  }
}

function startWorkout() {
  if (!state.workoutStartedAt) {
    state.workoutStartedAt = new Date().toISOString();
  }
  state.isPlaying = true;
  valStateText.innerText = '騎行中';
  btnPlayPause.innerText = '暫停騎行';
  btnPlayPause.classList.remove('btn-primary');
  btnPlayPause.classList.add('btn-secondary');

  state.mainTimer = setInterval(tickWorkout, 1000);

  if (PHASE_PLANS[state.workoutMode]) startIntervalWorkout();
  if (state.isDemoMode) startDemoGenerator();

  updateFeedback('運動已開始，衝刺吧！');
}

function pauseWorkout() {
  state.isPlaying = false;
  valStateText.innerText = '已暫停';
  btnPlayPause.innerText = '開始騎行';
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
  pauseWorkout();
  state.elapsedTime = 0;
  state.calories = 0;
  state.distance = 0.0;
  state.power = 0;
  state.cadence = 0;
  state.speed = 0.0;
  state.intervalTimeElapsed = 0;
  state.intervalPhaseIndex = 0;
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
  const plan = TRAINING_PLANS[state.workoutMode] || TRAINING_PLANS.free;
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
  const targetMinutes = {
    free: 15,
    recovery: 15,
    endurance: 30,
    tempo: 20,
    cadence: 15,
    climb: 18,
    interval: 10,
    pyramid: 9
  }[mode] || 15;
  return Math.max(20, Math.min(100, Math.round((durationSeconds / 60 / targetMinutes) * 100)));
}

function parseRange(text) {
  const match = String(text).match(/(\d+)\s*[~\-]\s*(\d+)/);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

function openHealthImportModal(recordId = null) {
  const target = recordId ? findRecordById(recordId) : getLatestRecordForActiveUser();
  if (!target) {
    updateFeedback('目前沒有可匯入的訓練紀錄。請先完成一次騎行。');
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
  const raw = healthImportCode.value.trim();
  if (!raw) return;

  try {
    let data;
    if (raw.startsWith('http')) {
      const url = new URL(raw);
      data = Object.fromEntries(url.searchParams.entries());
    } else if (raw.includes('=') && raw.includes('&')) {
      data = Object.fromEntries(new URLSearchParams(raw).entries());
    } else {
      data = JSON.parse(raw);
    }

    fillHealthForm(normalizeHealthMetrics(data));
    updateFeedback('匯入碼已解析，確認數字後按「套用到訓練」。');
  } catch (error) {
    updateFeedback(`匯入碼解析失敗：${error.message}`);
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
    updateFeedback('請至少填入一個健康資料欄位。');
    return;
  }

  applyHealthMetricsToRecord(recordId, metrics);
  modalHealthImport.classList.add('hidden');
}

function normalizeHealthMetrics(input = {}) {
  const pick = (...keys) => keys.find(key => input[key] !== undefined && input[key] !== '');
  const toNumber = (key) => {
    if (!key) return null;
    const value = Number(input[key]);
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

function applyHealthMetricsToRecord(recordId, metrics) {
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
  renderSummary(merged, getActiveUser());
  loadHistory();
  updateUI();
  updateFeedback('健康資料已匯入，訓練回饋已更新。');
}

function handleInboundHealthImport() {
  const params = new URLSearchParams(window.location.search);
  const hasHealthImport = ['avgHr', 'maxHr', 'activeKcal', 'exerciseMin', 'rpe', 'note'].some(key => params.has(key));
  if (!hasHealthImport) return;

  const latest = getLatestRecordForActiveUser();
  if (!latest) {
    updateFeedback('收到健康匯入參數，但目前沒有訓練紀錄可套用。');
    return;
  }

  const metrics = normalizeHealthMetrics(Object.fromEntries(params.entries()));
  applyHealthMetricsToRecord(latest.id, metrics);
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

function getNextWorkoutRecommendation(record, health = {}) {
  if (health.rpe >= 8) {
    return '下一次安排「恢復騎」15-20 分鐘，阻力維持輕，目標是讓腿恢復，不追求瓦數。';
  }

  if ((record.avgCadence || 0) < 75) {
    return '下一次做「踏頻技巧」15 分鐘，把阻力放輕，專注把踏頻穩在 95 RPM 以上。';
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

  return '下一次建議做「有氧耐力」，穩住 80-90 RPM，累積基礎能力。';
}

function generateSportsAdvice(record, user) {
  analysisReportContent.innerHTML = '';
  const advices = [];

  if (record.avgCadence > 0) {
    if (record.avgCadence < 75) {
      advices.push({
        title: '踩踏踏頻偏慢',
        type: 'warning',
        text: `您的平均踏頻為 ${record.avgCadence} RPM。踏頻低於 75 會對膝關節造成較大的受力負擔。建議下次可調輕 1-2 段阻力，並試著將旋轉踏頻保持在 80-90 RPM，不僅能保護關節，還能有效鍛鍊心肺有氧系統。`
      });
    } else if (record.avgCadence <= 92) {
      advices.push({
        title: '黃金踩踏踏頻',
        type: 'success',
        text: `您的平均踏頻為 ${record.avgCadence} RPM。這個轉速落在最有效率的有氧踩踏區間，非常優秀！這能兼顧肌肉耐力與心肺血管的運作，請繼續維持這個優秀的踩踏節奏。`
      });
    } else {
      advices.push({
        title: '高踩踏轉速',
        type: 'success',
        text: `您的平均踏頻為 ${record.avgCadence} RPM。轉速高代表心肺耐力正承受高度挑戰。若您覺得肌肉有些緊繃，可適度將阻力調重 1-2 段，將轉速微幅調整回 85-90 RPM，以獲得更好的腿部力量回饋。`
      });
    }
  } else {
    advices.push({
      title: '無踏頻感測數據',
      type: 'info',
      text: '本次運動沒有偵測到踏頻。在踏頻大於 0 的狀況下，我們能為您的踩踏迴轉速給予更具體的運動力學分析與建議。'
    });
  }

  const health = record.healthMetrics || {};
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
    text: getNextWorkoutRecommendation(record, health)
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
    historyList.innerHTML = `<li class="no-records">帳戶「${user.name}」目前尚未有騎行紀錄，點擊「開始騎行」來建立您的第一次訓練吧！</li>`;
  } else {
    userHistory.slice(0, 10).forEach(record => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const dateStr = new Date(record.date).toLocaleDateString('zh-TW', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const modeText = (TRAINING_PLANS[record.mode] || {}).label || '未知';
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

// === 間歇挑戰排程計時 ===
function startIntervalWorkout() {
  state.intervalTimeElapsed = 0;
  state.intervalPhaseIndex = 0;
  intervalPanel.classList.remove('hidden');
  const phases = getActivePhases();

  updateIntervalUI();

  state.intervalTimer = setInterval(() => {
    if (!state.isPlaying) return;

    state.intervalTimeElapsed++;
    const currentPhase = phases[state.intervalPhaseIndex];
    const remainingTime = currentPhase.duration - state.intervalTimeElapsed;

    if (remainingTime <= 0) {
      state.intervalPhaseIndex++;
      state.intervalTimeElapsed = 0;

      if (state.intervalPhaseIndex >= phases.length) {
        clearInterval(state.intervalTimer);
        state.intervalTimer = null;
        updateFeedback('課表完成。系統已產生本次訓練報告，可匯入健康資料補完回饋。');
        intervalPanel.classList.add('hidden');
        saveAndShowSummary();
        resetWorkout('saved');
        return;
      }

      const nextPhase = phases[state.intervalPhaseIndex];
      adjustResistance(nextPhase.resistance - state.resistance);
      updateFeedback(`🔔 間歇階段切換：${nextPhase.name}！${nextPhase.info}`);
    }

    updateIntervalUI();
  }, 1000);
}

function updateIntervalUI() {
  const phases = getActivePhases();
  const currentPhase = phases[state.intervalPhaseIndex];
  const remainingTime = currentPhase.duration - state.intervalTimeElapsed;

  intervalPhase.innerText = `課表階段 (${state.intervalPhaseIndex + 1}/${phases.length}): ${currentPhase.name}`;

  const m = String(Math.floor(remainingTime / 60)).padStart(2, '0');
  const s = String(remainingTime % 60).padStart(2, '0');
  intervalTimerDisp.innerText = `${m}:${s}`;

  const pct = (state.intervalTimeElapsed / currentPhase.duration) * 100;
  intervalProgress.style.width = `${pct}%`;

  if (state.intervalPhaseIndex + 1 < phases.length) {
    const nextPhase = phases[state.intervalPhaseIndex + 1];
    intervalNextTip.innerText = `下一階段：${nextPhase.name} (阻力 ${nextPhase.resistance} 段)，預計踏頻: ${nextPhase.targetCadence} RPM`;
  } else {
    intervalNextTip.innerText = `下一階段：結束運動。加油，剩最後一里路！`;
  }
}

function getActivePhases() {
  return PHASE_PLANS[state.workoutMode] || PHASE_PLANS.interval;
}

// === 手動與自動阻力微調 ===
function adjustResistance(delta) {
  let target = state.resistance + delta;

  if (target < 1) target = 1;
  if (target > 24) target = 24;

  state.resistance = target;
  valResistance.innerText = state.resistance;

  sendResistanceToBike(state.resistance);

  const card = document.getElementById('card-resistance');
  card.classList.add('card-glow-active-blue');
  setTimeout(() => card.classList.remove('card-glow-active-blue'), 400);
}

// === 模擬器數據產生器 (Demo Mode) ===
function handleDemoModeToggle(e) {
  state.isDemoMode = e.target.checked;

  if (state.isDemoMode) {
    state.isBikeConnected = true;
    btnPlayPause.disabled = false;

    btnConnectBike.disabled = true;
    btnHealthImport.disabled = false;
    bikeConnText.innerText = '模擬飛輪 (啟用)';
    healthImportText.innerText = '匯入健康';

    updateFeedback('模擬騎行模式已開啟！點擊「開始騎行」體驗數值與踩踏動畫。');

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

    let baseCadence = 80;
    let basePower = 120;
    let baseSpeed = 22;

    if (state.workoutMode === 'recovery') {
      baseCadence = 92;
      basePower = 100;
      baseSpeed = 20;
    } else if (state.workoutMode === 'endurance') {
      baseCadence = 86;
      basePower = 125;
      baseSpeed = 23;
    } else if (state.workoutMode === 'tempo') {
      baseCadence = 85;
      basePower = 150;
      baseSpeed = 26;
    } else if (state.workoutMode === 'cadence') {
      baseCadence = 102;
      basePower = 115;
      baseSpeed = 24;
    } else if (state.workoutMode === 'climb') {
      baseCadence = 70;
      basePower = 190;
      baseSpeed = 21;
    } else if (PHASE_PLANS[state.workoutMode]) {
      const currentPhase = getActivePhases()[state.intervalPhaseIndex];
      if (currentPhase.resistance > 5) {
        baseCadence = 78;
        basePower = 210;
        baseSpeed = 29;
      } else {
        baseCadence = 88;
        basePower = 95;
        baseSpeed = 19;
      }
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

  if (state.cadence === 0) {
    cadenceStatus.innerText = '靜止中';
  } else if (state.cadence < 70) {
    cadenceStatus.innerText = '踩踏偏慢 🐢';
  } else if (state.cadence <= 95) {
    cadenceStatus.innerText = '效率踩踏 ⚡';
  } else {
    cadenceStatus.innerText = '高速運轉 🚀';
  }

  toggleCardGlow('card-power', state.power > 180, 'card-glow-active-yellow');
  toggleCardGlow('card-cadence', state.cadence > 90, 'card-glow-active-green');
  toggleCardGlow('card-hr', Boolean(latest?.healthImported), 'card-glow-active-red');

  if (state.isPlaying) {
    if (state.workoutMode === 'free') {
      updateFeedback(`自由騎行中。目前踩踏：${state.cadence} RPM / 功率：${state.power} W。`);
    } else if (PHASE_PLANS[state.workoutMode]) {
      const cur = getActivePhases()[state.intervalPhaseIndex];
      updateFeedback(`課表【${cur.name}】：阻力 ${state.resistance} 段，目標踏頻 ${cur.targetCadence} RPM，目標功率 ${cur.targetPower}。`);
    } else {
      updateFeedback(getLiveCoachingText());
    }
  }
}

function getLiveCoachingText() {
  const plan = TRAINING_PLANS[state.workoutMode] || TRAINING_PLANS.free;
  const powerRange = parseRange(plan.targetPower);
  const cadenceRange = parseRange(plan.targetCadence);

  if (cadenceRange && state.cadence > 0) {
    if (state.cadence < cadenceRange.min) {
      return `${plan.title}：踏頻偏低，先把轉速拉回 ${plan.targetCadence}。`;
    }
    if (state.cadence > cadenceRange.max) {
      return `${plan.title}：踏頻偏高，穩住上半身，必要時加一段阻力。`;
    }
  }

  if (powerRange && state.power > 0) {
    if (state.power < powerRange.min) {
      return `${plan.title}：功率低於目標，慢慢加壓，不要突然衝。`;
    }
    if (state.power > powerRange.max) {
      return `${plan.title}：功率高於目標，這段先收住，保留後段品質。`;
    }
  }

  return `${plan.title}：節奏穩定，維持 ${plan.targetCadence} 與 ${plan.targetPower}。`;
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
