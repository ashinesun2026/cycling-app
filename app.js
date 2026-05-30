// === 藍牙規格 UUID ===
const FTMS_SERVICE_UUID = 0x1826;
const INDOOR_BIKE_DATA_CHAR_UUID = 0x2AD2;
const FITNESS_MACHINE_CONTROL_POINT_CHAR_UUID = 0x2AD9;

const HR_SERVICE_UUID = 0x180D;
const HR_MEASUREMENT_CHAR_UUID = 0x2A37;

// === 應用程式狀態 ===
let state = {
  isDemoMode: false,
  isPlaying: false,
  
  // 藍牙設備對象
  bikeDevice: null,
  hrDevice: null,
  controlPointChar: null,
  
  // 連線狀態
  isBikeConnected: false,
  isHrConnected: false,
  
  // 運動即時數據
  elapsedTime: 0, // 秒
  calories: 0,    // kcal
  distance: 0.0,  // km
  power: 0,       // W
  cadence: 0,     // RPM
  speed: 0.0,     // km/h
  heartRate: null,// BPM
  resistance: 5,  // 目前阻力段數 (1-24)
  
  // 運動統計數據 (用於結算報告)
  powerSamples: [],
  cadenceSamples: [],
  hrSamples: [],
  maxPower: 0,
  maxHr: 0,

  // 運動模式設定
  workoutMode: 'free', // free, easy, moderate, interval
  
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

// 間歇挑戰排程 (總長度 10 分鐘，共 5 個階段)
const INTERVAL_PHASES = [
  { name: '有氧熱身', duration: 120, resistance: 3, targetCadence: '85-95', targetPower: '90-110W', info: '輕鬆踩踏，喚醒身體。' },
  { name: '高強度衝刺', duration: 120, resistance: 10, targetCadence: '75-85', targetPower: '180-220W', info: '加重阻力，全力輸出！' },
  { name: '動態恢復', duration: 120, resistance: 4, targetCadence: '85-90', targetPower: '100-120W', info: '放慢速度，調整呼吸。' },
  { name: '極限爬坡', duration: 120, resistance: 12, targetCadence: '70-80', targetPower: '200-240W', info: '站姿踩踏，挑戰腿力！' },
  { name: '緩和冷卻', duration: 120, resistance: 3, targetCadence: '80-90', targetPower: '80-100W', info: '降低強度，讓心率平緩。' }
];

// === DOM 元素綁定 ===
const btnConnectBike = document.getElementById('btn-connect-bike');
const btnConnectHr = document.getElementById('btn-connect-hr');
const bikeConnText = document.getElementById('bike-conn-text');
const hrConnText = document.getElementById('hr-conn-text');
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

// === 初始化 ===
window.addEventListener('DOMContentLoaded', () => {
  detectBluetoothSupport();
  initUsers();
  setupEventListeners();
  updateUI();
});

// 1. 偵測 iOS 與 Web Bluetooth 支援度
function detectBluetoothSupport() {
  if (!navigator.bluetooth) {
    // 瀏覽器不支援藍牙 API (iOS Safari/Chrome 或一般非安全 HTTP 環境)
    bluetoothWarningBanner.classList.remove('hidden');
    console.warn("目前瀏覽器環境不支援 Web Bluetooth API。iOS 請使用 Bluefy 瀏覽器！");
  } else {
    bluetoothWarningBanner.classList.add('hidden');
  }
}

// 2. 初始化使用者管理 (LocalStorage)
function initUsers() {
  const localDb = localStorage.getItem('antigravity_cycling_db');
  if (localDb) {
    try {
      db = JSON.parse(localDb);
    } catch (e) {
      console.error("載入使用者資料庫出錯，使用預設值:", e);
      db = { users: [DEFAULT_USER], activeUserId: 'default' };
    }
  } else {
    // 首次開啟，寫入預設訪客帳戶
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
  localStorage.setItem('antigravity_cycling_db', JSON.stringify(db));
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
  
  // 新增選項
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
  btnConnectHr.addEventListener('click', connectHeartRate);
  demoToggle.addEventListener('change', handleDemoModeToggle);
  
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
      // 開啟新增使用者彈窗
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
    userSelect.value = db.activeUserId; // 回復下拉選單選擇
  });

  // 刪除檔案設定
  btnDeleteProfile.addEventListener('click', handleDeleteProfile);

  // 儲存檔案表單提交
  formProfile.addEventListener('submit', handleSaveProfile);

  // 關閉報告視窗
  btnCloseSummary.addEventListener('click', () => {
    modalSummary.classList.add('hidden');
    resetWorkout(); // 在確認報告後徹底重置運動數據
  });
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
    document.querySelector(`input[name="profile-gender"][value="${user.gender}"]`).checked = true;
    
    // 預設訪客不可刪除
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
    
    // 刪除此使用者的歷史紀錄
    let history = getHistoryFromStorage();
    history = history.filter(h => h.userId !== id);
    localStorage.setItem('antigravity_cycling_history', JSON.stringify(history));
    
    // 退回到預設用戶
    db.activeUserId = 'default';
    saveDb();
    renderUserSelect();
    modalProfile.classList.add('hidden');
    
    resetWorkout();
    loadHistory();
    updateUI();
  }
}

// === 運動模式與強度設定 ===
function setWorkoutMode(mode) {
  state.workoutMode = mode;
  
  // 重置間歇面板
  intervalPanel.classList.add('hidden');
  if (state.intervalTimer) {
    clearInterval(state.intervalTimer);
    state.intervalTimer = null;
  }
  
  if (mode === 'free') {
    targetPowerZone.innerText = '目標瓦數: 自由調整';
    resRange.innerText = '手動微調';
    updateFeedback('自由騎行模式：您可以自由踩踏並手動加減阻力。');
  } else if (mode === 'easy') {
    targetPowerZone.innerText = '目標瓦數: 80~120 W';
    resRange.innerText = '目標阻力: 3 段';
    updateFeedback('輕鬆熱身模式：踏頻建議維持在 90 RPM 以上有氧區。');
    adjustResistance(3 - state.resistance);
  } else if (mode === 'moderate') {
    targetPowerZone.innerText = '目標瓦數: 130~170 W';
    resRange.innerText = '目標阻力: 8 段';
    updateFeedback('中等燃脂模式：踏頻建議 80~90 RPM。呼吸穩定，高效有氧！');
    adjustResistance(8 - state.resistance);
  } else if (mode === 'interval') {
    targetPowerZone.innerText = '目標瓦數: 依間歇階段';
    resRange.innerText = '阻力自動控制';
    updateFeedback('間歇挑戰模式：點擊「開始騎行」後，將自動控制阻力循環挑戰。');
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
  
  try {
    updateFeedback('正在搜尋飛輪裝置...');
    state.bikeDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE_UUID] }],
      optionalServices: [FTMS_SERVICE_UUID]
    });
    
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
    updateFeedback(`連線失敗: ${error.message || error}`);
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
  
  if (!state.isHrConnected && !state.isDemoMode) {
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

// === 藍牙連線：心率 (HR) ===
async function connectHeartRate() {
  if (state.isHrConnected) {
    disconnectHr();
    return;
  }
  
  try {
    updateFeedback('正在搜尋藍牙心率裝置 (如 Echo 廣播)...');
    state.hrDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HR_SERVICE_UUID] }],
      optionalServices: [HR_SERVICE_UUID]
    });
    
    updateFeedback('正在連線心率設備...');
    const server = await state.hrDevice.gatt.connect();
    
    updateFeedback('正在讀取心率數據流...');
    const service = await server.getPrimaryService(HR_SERVICE_UUID);
    const dataChar = await service.getCharacteristic(HR_MEASUREMENT_CHAR_UUID);
    
    await dataChar.startNotifications();
    dataChar.addEventListener('characteristicvaluechanged', handleHeartRateData);
    
    state.isHrConnected = true;
    btnConnectHr.classList.remove('btn-primary');
    btnConnectHr.classList.add('btn-secondary');
    hrConnText.innerText = '中斷心率';
    
    updateFeedback('心率連線成功！即時心率將顯示於儀表板。');
    updateUI();
  } catch (error) {
    console.error('心率連線失敗:', error);
    updateFeedback(`心率連線失敗: ${error.message || error}`);
  }
}

function disconnectHr() {
  if (state.hrDevice && state.hrDevice.gatt.connected) {
    state.hrDevice.gatt.disconnect();
  }
  state.isHrConnected = false;
  state.heartRate = null;
  btnConnectHr.classList.remove('btn-secondary');
  btnConnectHr.classList.add('btn-primary');
  hrConnText.innerText = '連線心率';
  
  updateFeedback('心率已中斷連線。');
  updateUI();
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

function handleHeartRateData(event) {
  const dataView = event.target.value;
  const hrFlags = dataView.getUint8(0);
  
  if (hrFlags & 0x01) {
    state.heartRate = dataView.getUint16(1, true);
  } else {
    state.heartRate = dataView.getUint8(1);
  }
  
  if (state.isPlaying && state.heartRate > 0) {
    state.hrSamples.push(state.heartRate);
    if (state.heartRate > state.maxHr) state.maxHr = state.heartRate;
  }
  
  updateUI();
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
  state.isPlaying = true;
  valStateText.innerText = '騎行中';
  btnPlayPause.innerText = '暫停騎行';
  btnPlayPause.classList.remove('btn-primary');
  btnPlayPause.classList.add('btn-secondary');
  
  state.mainTimer = setInterval(tickWorkout, 1000);
  
  if (state.workoutMode === 'interval') startIntervalWorkout();
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
  updateFeedback('已暫停運動，數據已暫存。若欲結束，請點擊右方「清除與存檔」。');
}

// 結算與重置處理
function handleWorkoutResetClick() {
  if (state.elapsedTime > 5) {
    // 騎行大於 5 秒，進行存檔並彈出智慧建議視窗
    saveAndShowSummary();
  } else {
    // 時間太短，直接無痛重置
    resetWorkout();
  }
}

function resetWorkout() {
  pauseWorkout();
  state.elapsedTime = 0;
  state.calories = 0;
  state.distance = 0.0;
  state.power = 0;
  state.cadence = 0;
  state.speed = 0.0;
  state.intervalTimeElapsed = 0;
  state.intervalPhaseIndex = 0;
  
  // 清除統計樣本
  state.powerSamples = [];
  state.cadenceSamples = [];
  state.hrSamples = [];
  state.maxPower = 0;
  state.maxHr = 0;
  
  valTime.innerText = '00:00:00';
  valCalories.innerText = '0';
  valDistance.innerText = '0.00';
  calorieRate.innerText = '0 kcal/hr';
  roadProgress.style.width = '0%';
  roadAvatar.style.left = '0%';
  
  setWorkoutMode(state.workoutMode);
  updateFeedback('運動紀錄已重置。');
  updateUI();
}

// 每秒計時
function tickWorkout() {
  state.elapsedTime++;
  
  // 時間格式化
  const hours = String(Math.floor(state.elapsedTime / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((state.elapsedTime % 3600) / 60)).padStart(2, '0');
  const seconds = String(state.elapsedTime % 60).padStart(2, '0');
  valTime.innerText = `${hours}:${minutes}:${seconds}`;
  
  // 取得當前活躍使用者的生理資訊
  const currentUser = getActiveUser();
  
  // 卡路里消耗累計
  let kcalSec = 0;
  let method = '估算';
  
  if (state.power > 0) {
    kcalSec = state.power / 1000.0;
    method = '功率功';
  } else if (state.heartRate > 0) {
    // 基於生理資料 (weight, age, gender) 的心率熱量消耗
    const hr = state.heartRate;
    const w = currentUser.weight;
    const a = currentUser.age;
    
    if (currentUser.gender === 'male') {
      kcalSec = ((-55.0969 + 0.6309 * hr + 0.1988 * w + 0.2017 * a) / 4.184) / 60.0;
    } else {
      kcalSec = ((-20.4022 + 0.4472 * hr - 0.1263 * w + 0.0740 * a) / 4.184) / 60.0;
    }
    method = '心率';
  } else {
    if (state.speed > 0) {
      // 根據體重做簡易速度估算
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
  
  // 模擬里程累計
  if (state.isDemoMode && state.speed > 0) {
    state.distance += state.speed / 3600.0;
    valDistance.innerText = state.distance.toFixed(2);
  }
  
  // 里程碑進度條
  const progressPercent = Math.min((state.distance / 10.0) * 100, 100);
  roadProgress.style.width = `${progressPercent}%`;
  roadAvatar.style.left = `${progressPercent}%`;
  
  if (state.distance >= 10.0 && state.distance - (state.speed / 3600.0) < 10.0) {
    updateFeedback('🎉 太棒了！您已完成 10 公里虛擬里程碑！');
  }
}

// === 智慧數據結算存檔與建議引擎 ===
function saveAndShowSummary() {
  const user = getActiveUser();
  
  // 1. 計算平均指標
  const avgPower = state.powerSamples.length > 0 ? 
    Math.round(state.powerSamples.reduce((a,b)=>a+b, 0) / state.powerSamples.length) : 0;
  
  const avgCadence = state.cadenceSamples.length > 0 ? 
    Math.round(state.cadenceSamples.reduce((a,b)=>a+b, 0) / state.cadenceSamples.length) : 0;
    
  const avgHr = state.hrSamples.length > 0 ? 
    Math.round(state.hrSamples.reduce((a,b)=>a+b, 0) / state.hrSamples.length) : 0;

  // 2. 建構歷史物件
  const record = {
    id: 'workout_' + Date.now(),
    userId: user.id,
    userName: user.name,
    date: new Date().toISOString(),
    mode: state.workoutMode,
    duration: state.elapsedTime,
    distance: parseFloat(state.distance.toFixed(2)),
    calories: Math.round(state.calories),
    avgPower,
    maxPower: state.maxPower,
    avgCadence,
    avgHr,
    maxHr: state.maxHr
  };

  // 3. 寫入 LocalStorage 歷史庫
  const history = getHistoryFromStorage();
  history.unshift(record);
  localStorage.setItem('antigravity_cycling_history', JSON.stringify(history));

  // 4. 渲染結算視窗
  sumTime.innerText = formatDuration(state.elapsedTime);
  sumCalories.innerText = `${Math.round(state.calories)} kcal`;
  sumDistance.innerText = `${state.distance.toFixed(2)} km`;
  sumPower.innerText = `${avgPower} / ${state.maxPower} W`;
  sumCadence.innerText = `${avgCadence} RPM`;
  sumHr.innerText = avgHr > 0 ? `${avgHr} / ${state.maxHr} BPM` : '-- / -- BPM';

  // 5. 啟動智慧回饋建議引擎
  generateSportsAdvice(record, user);

  // 開啟結算 Modal
  modalSummary.classList.remove('hidden');
  
  // 更新歷史列表
  loadHistory();
}

function getHistoryFromStorage() {
  const localHistory = localStorage.getItem('antigravity_cycling_history');
  if (localHistory) {
    try { return JSON.parse(localHistory); } catch(e) { return []; }
  }
  return [];
}

// 智慧建議生成規則
function generateSportsAdvice(record, user) {
  analysisReportContent.innerHTML = '';
  
  const advices = [];
  
  // 規則 1：踏頻分析
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

  // 規則 2：心率區間分析
  if (record.avgHr > 0) {
    const maxHr = 220 - user.age;
    const aerobicLower = Math.round(maxHr * 0.60);
    const aerobicUpper = Math.round(maxHr * 0.82);
    
    if (record.avgHr > aerobicUpper) {
      advices.push({
        title: '心率強度偏高 (高強度無氧區)',
        type: 'warning',
        text: `您的平均心率為 ${record.avgHr} BPM，已高於您有氧區間的上限 (${aerobicUpper} BPM)。此強度多屬於無氧耐力挑戰，乳酸容易堆積。若您的主要運動目標是「減重燃脂」，建議下次降低阻力 2-3 段，將心率維持在 ${aerobicLower} - ${aerobicUpper} BPM 之間，能獲得更好的脂肪消耗效果。`
      });
    } else if (record.avgHr >= aerobicLower) {
      advices.push({
        title: '完美燃脂心率區',
        type: 'success',
        text: `您的平均心率為 ${record.avgHr} BPM，處於非常理想的有氧燃脂心肺區 (${aerobicLower} - ${aerobicUpper} BPM)。這個區間能安全地最大化脂肪卡路里燃燒，並顯著增強心血管耐力，表現得太棒了！`
      });
    } else {
      advices.push({
        title: '輕鬆恢復心率區',
        type: 'info',
        text: `您的平均心率為 ${record.avgHr} BPM，強度偏向溫和。若體力允許且想追求進一步的運動效果，建議下次挑戰時稍微調高 1-2 段阻力，或將踏頻加快，讓心率稍微提升。`
      });
    }
  } else {
    advices.push({
      title: 'Apple Watch 心率連接提醒',
      type: 'info',
      text: '本次運動無心率數據。建議您下次在 iPhone 安裝 Echo / HeartCast App 廣播您的 Apple Watch 心率，App 將能依據精確的心率區間為您的運動強度提供智慧分析建議！'
    });
  }

  // 規則 3：能量與推重比 (Power-to-weight)
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

  // 渲染至畫面上
  advices.forEach(adv => {
    const div = document.createElement('div');
    div.className = `advice-item ${adv.type === 'warning' ? 'warning' : ''}`;
    div.innerHTML = `<strong>${adv.type === 'warning' ? '⚠️ ' : '💡 '}${adv.title}</strong><p>${adv.text}</p>`;
    analysisReportContent.appendChild(div);
  });
}

// 載入並渲染歷史紀錄與本週累計
function loadHistory() {
  const user = getActiveUser();
  const history = getHistoryFromStorage();
  const userHistory = history.filter(h => h.userId === user.id);
  
  // 1. 渲染歷史紀錄列表
  historyList.innerHTML = '';
  
  if (userHistory.length === 0) {
    historyList.innerHTML = `<li class="no-records">帳戶「${user.name}」目前尚未有騎行紀錄，點擊「開始騎行」來建立您的第一次訓練吧！</li>`;
  } else {
    // 渲染最近 10 次紀錄
    userHistory.slice(0, 10).forEach(record => {
      const li = document.createElement('li');
      li.className = 'history-item';
      
      const dateStr = new Date(record.date).toLocaleDateString('zh-TW', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      
      const modeText = {
        free: '自由', easy: '熱身', moderate: '有氧', interval: '間歇'
      }[record.mode] || '未知';
      
      li.innerHTML = `
        <div class="history-item-left">
          <div class="history-item-meta">
            <span class="mode-badge ${record.mode === 'interval' ? 'badge-hard' : record.mode === 'moderate' ? 'badge-moderate' : record.mode === 'easy' ? 'badge-easy' : 'badge-free'}">${modeText}</span>
            <span class="history-item-title">${dateStr}</span>
          </div>
          <div class="history-item-data">
            時間: <strong>${formatDuration(record.duration)}</strong> | 平均踏頻: <strong>${record.avgCadence || '--'} RPM</strong>
          </div>
        </div>
        <div class="history-item-right">
          <span class="history-item-calories">${record.calories} kcal</span>
          <span class="history-item-distance">${record.distance.toFixed(2)} km</span>
        </div>
      `;
      
      // 點擊歷史物件可重新查看該次詳細報告
      li.addEventListener('click', () => {
        // 裝載歷史數據至結算 modal 中呈現
        sumTime.innerText = formatDuration(record.duration);
        sumCalories.innerText = `${record.calories} kcal`;
        sumDistance.innerText = `${record.distance.toFixed(2)} km`;
        sumPower.innerText = `${record.avgPower} / ${record.maxPower} W`;
        sumCadence.innerText = `${record.avgCadence} RPM`;
        sumHr.innerText = record.avgHr > 0 ? `${record.avgHr} / ${record.maxHr} BPM` : '-- / -- BPM';
        
        generateSportsAdvice(record, user);
        modalSummary.classList.remove('hidden');
      });
      
      historyList.appendChild(li);
    });
  }
  
  // 2. 計算本週累計數值
  calculateWeeklyStats(userHistory);
}

// 計算本週累計運動量
function calculateWeeklyStats(userHistory) {
  const now = new Date();
  // 計算本週一的日期
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // 調整星期天為星期一開始
  const monday = new Date(now.setDate(diff));
  monday.setHours(0,0,0,0);
  
  // 篩選本週的紀錄
  const weeklyRecords = userHistory.filter(h => new Date(h.date) >= monday);
  
  let totalTimeSec = 0;
  let totalKcal = 0;
  let totalKm = 0.0;
  
  weeklyRecords.forEach(r => {
    totalTimeSec += r.duration;
    totalKcal += r.calories;
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
  
  updateIntervalUI();
  
  state.intervalTimer = setInterval(() => {
    if (!state.isPlaying) return;
    
    state.intervalTimeElapsed++;
    const currentPhase = INTERVAL_PHASES[state.intervalPhaseIndex];
    const remainingTime = currentPhase.duration - state.intervalTimeElapsed;
    
    if (remainingTime <= 0) {
      state.intervalPhaseIndex++;
      state.intervalTimeElapsed = 0;
      
      if (state.intervalPhaseIndex >= INTERVAL_PHASES.length) {
        clearInterval(state.intervalTimer);
        state.intervalTimer = null;
        updateFeedback('🏆 恭喜！您完成了完整的間歇挑戰！');
        intervalPanel.classList.add('hidden');
        setWorkoutMode('free');
        saveAndShowSummary(); // 自動結束並存檔結算
        return;
      }
      
      const nextPhase = INTERVAL_PHASES[state.intervalPhaseIndex];
      adjustResistance(nextPhase.resistance - state.resistance);
      updateFeedback(`🔔 間歇階段切換：${nextPhase.name}！${nextPhase.info}`);
    }
    
    updateIntervalUI();
  }, 1000);
}

function updateIntervalUI() {
  const currentPhase = INTERVAL_PHASES[state.intervalPhaseIndex];
  const remainingTime = currentPhase.duration - state.intervalTimeElapsed;
  
  intervalPhase.innerText = `間歇階段 (${state.intervalPhaseIndex + 1}/${INTERVAL_PHASES.length}): ${currentPhase.name}`;
  
  const m = String(Math.floor(remainingTime / 60)).padStart(2, '0');
  const s = String(remainingTime % 60).padStart(2, '0');
  intervalTimerDisp.innerText = `${m}:${s}`;
  
  const pct = (state.intervalTimeElapsed / currentPhase.duration) * 100;
  intervalProgress.style.width = `${pct}%`;
  
  if (state.intervalPhaseIndex + 1 < INTERVAL_PHASES.length) {
    const nextPhase = INTERVAL_PHASES[state.intervalPhaseIndex + 1];
    intervalNextTip.innerText = `下一階段：${nextPhase.name} (阻力 ${nextPhase.resistance} 段)，預計踏頻: ${nextPhase.targetCadence} RPM`;
  } else {
    intervalNextTip.innerText = `下一階段：結束運動。加油，剩最後一里路！`;
  }
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
    state.isHrConnected = true;
    btnPlayPause.disabled = false;
    
    btnConnectBike.disabled = true;
    btnConnectHr.disabled = true;
    bikeConnText.innerText = '模擬飛輪 (啟用)';
    hrConnText.innerText = '模擬心率 (啟用)';
    
    updateFeedback('模擬騎行模式已開啟！點擊「開始騎行」體驗數值與踩踏動畫。');
    
    if (state.isPlaying) {
      startDemoGenerator();
    }
  } else {
    btnConnectBike.disabled = false;
    btnConnectHr.disabled = false;
    bikeConnText.innerText = '連線飛輪';
    hrConnText.innerText = '連線心率';
    
    disconnectBike();
    disconnectHr();
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
    let baseHr = 125;
    
    if (state.workoutMode === 'easy') {
      baseCadence = 92;
      basePower = 100;
      baseSpeed = 20;
      baseHr = 115;
    } else if (state.workoutMode === 'moderate') {
      baseCadence = 85;
      basePower = 150;
      baseSpeed = 26;
      baseHr = 145;
    } else if (state.workoutMode === 'interval') {
      const currentPhase = INTERVAL_PHASES[state.intervalPhaseIndex];
      if (currentPhase.resistance > 5) {
        baseCadence = 78;
        basePower = 210;
        baseSpeed = 29;
        baseHr = 162;
      } else {
        baseCadence = 88;
        basePower = 95;
        baseSpeed = 19;
        baseHr = 125;
      }
    }
    
    state.cadence = Math.round(baseCadence + (Math.random() * 6 - 3));
    state.power = Math.round(basePower + (Math.random() * 20 - 10));
    state.speed = parseFloat((baseSpeed + (Math.random() * 2 - 1)).toFixed(1));
    state.heartRate = Math.round(baseHr + (Math.random() * 4 - 2));
    
    // 寫入數據統計樣本以供結算
    if (state.cadence > 0) state.cadenceSamples.push(state.cadence);
    if (state.power > 0) {
      state.powerSamples.push(state.power);
      if (state.power > state.maxPower) state.maxPower = state.power;
    }
    if (state.heartRate > 0) {
      state.hrSamples.push(state.heartRate);
      if (state.heartRate > state.maxHr) state.maxHr = state.heartRate;
    }
    
    updateUI();
    updateAnimationSpeeds();
  }, 1000);
}

// === UI 渲染與回饋引導 ===
function updateUI() {
  valPower.innerText = state.power;
  valCadence.innerText = state.cadence;
  valHr.innerText = state.heartRate !== null ? state.heartRate : '--';
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
  
  if (state.heartRate === null) {
    hrZone.innerText = '等待心率來源...';
  } else {
    const hr = state.heartRate;
    if (hr < 100) hrZone.innerText = '熱身放鬆區 🍃';
    else if (hr < 130) hrZone.innerText = '燃脂有氧區 🏃';
    else if (hr < 155) hrZone.innerText = '心肺強化區 🔥';
    else hrZone.innerText = '極限無氧區 🚨';
  }
  
  toggleCardGlow('card-power', state.power > 180, 'card-glow-active-yellow');
  toggleCardGlow('card-cadence', state.cadence > 90, 'card-glow-active-green');
  toggleCardGlow('card-hr', state.heartRate > 150, 'card-glow-active-red');
  
  // 即時引導
  if (state.isPlaying) {
    if (state.workoutMode === 'free') {
      updateFeedback(`自由騎行中。目前踩踏：${state.cadence} RPM / 功率：${state.power} W。`);
    } else if (state.workoutMode === 'easy') {
      if (state.cadence < 85) {
        updateFeedback('💡 輕鬆熱身：請試著提高轉速至 90 RPM 以上以獲得有氧效益。');
      } else {
        updateFeedback('👍 節奏非常完美！請維持現在的高轉速。');
      }
    } else if (state.workoutMode === 'moderate') {
      if (state.power < 130) {
        updateFeedback('💪 踩踏稍微加把勁，將瓦數提升至 130W 以上，加強燃脂效率。');
      } else if (state.power > 180) {
        updateFeedback('⚡ 強度偏高囉，可以適度降低 1 段阻力或放慢踩踏。');
      } else {
        updateFeedback('🌟 完美！目前正處於最高燃脂有氧區間，請繼續維持。');
      }
    } else if (state.workoutMode === 'interval') {
      const cur = INTERVAL_PHASES[state.intervalPhaseIndex];
      updateFeedback(`🎯 間歇【${cur.name}】：目前阻力 ${state.resistance} 段，目標踏頻為 ${cur.targetCadence} RPM！`);
    }
  }
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

// === 動態 CSS 動畫速度 ===
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

// 輔助函式：時間格式化
function formatDuration(totalSeconds) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
