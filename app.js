const SUPABASE_URL = "https://jomglcttafbhuuhpjmft.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MwxrG4702IXAWU5CAg8QaA_gJOSfIE-";
const APP_URL = "https://taichidoi0509-stack.github.io/jakuro-doi/";

const MODE_PRESETS = {
  sanma: { label: "三人打ち", playerCount: 3, startingPoints: 35000, uma: [20, 0, -20] },
  yonin_sanma: { label: "四人三打ち", playerCount: 4, startingPoints: 35000, uma: [20, 10, -10, -20] },
  yonma: { label: "四人打ち", playerCount: 4, startingPoints: 25000, uma: [20, 10, -10, -20] }
};

const RATE_PRESETS = [
  { label: "テンイチ", multiplier: 10 },
  { label: "テンニ", multiplier: 20 },
  { label: "テンサン", multiplier: 30 },
  { label: "テンゴ", multiplier: 50 },
  { label: "テンピン", multiplier: 100 },
  { label: "リャンピン", multiplier: 200 },
  { label: "ウーピン", multiplier: 500 },
  { label: "デカピン", multiplier: 1000 },
  { label: "カスタム", multiplier: null }
];

const YAKUMAN_OPTIONS = [
  "国士無双", "国士無双十三面待ち", "四暗刻", "四暗刻単騎", "大三元", "小四喜", "大四喜",
  "字一色", "緑一色", "清老頭", "九蓮宝燈", "純正九蓮宝燈", "四槓子", "天和", "地和",
  "人和", "数え役満", "流し役満", "四華和", "パッチリ", "その他"
];

let navItems = document.querySelectorAll(".nav-item");
const heroCard = document.querySelector(".hero-card");
const heroStatus = document.querySelector(".hero-status");
const mainContent = document.querySelector(".main-content");
const roadmapSection = document.querySelector(".section-block");

let supabaseClient = null;
let currentSession = null;
let authButton = null;
let currentTab = "home";
let groupWorkspace = null;
let pageWorkspace = null;
let settingsMessage = "";
let exportPeriodMode = "all";
let exportPeriodValue = "";
let exportPeriodOptions = { years: [], months: [] };
let exportMessage = "";
let exportMessageIsError = false;

let userGroups = [];
let activeGroupId = localStorage.getItem("jakuroku-active-group-id") || null;
let activeGroupMembers = [];

let sessionList = [];
let activeMatchSessionId = localStorage.getItem("jakuroku-active-match-session-id") || null;
let activeMatchSession = null;
let activeMatchMembers = [];
let activeHanchans = [];
let activeHanchanResults = [];
let activeTobiTransfers = [];
let activeSessionChips = [];
let activeYakumanRecords = [];
let activeVenuePrepayments = [];

let showCreateSession = false;
let showHanchanEditor = false;
let showChipEditor = false;
let showVenueEditor = false;
let sessionDraft = createDefaultSessionDraft("sanma");
let hanchanDraft = null;
let editingHanchanId = null;
let chipDraft = {};
let venueDraft = { total: 0, prepayments: {} };
let gameMessage = "";

let rankingRaw = {
  sessions: [],
  sessionMembers: [],
  hanchans: [],
  results: [],
  chips: [],
  prepayments: [],
  yakumans: []
};
let rankingMetric = "total";
let rankingPeriodMode = "all";
let rankingPeriodValue = "";
let rankingSelectedMemberId = "";
let rankingOpenSessionId = null;

// Debt management
let debtRecords = [];
let debtEvents = [];
let debtViewMode = "open";
let debtMessage = "";
let debtOpenPaymentId = null;
let debtOpenRerouteId = null;

// Trash / restore management
let trashSessions = [];
let trashDebtRecords = [];
let trashViewMode = "sessions";
let trashMessage = "";

// Realtime synchronization state
let realtimeChannel = null;
let realtimeChannelGroupId = null;
let realtimeRefreshTimer = null;
let realtimePendingRefresh = false;
let realtimeLastLocalWriteAt = 0;

function recordIdsForRealtime() {
  return new Set([
    ...sessionList.map((session) => session.id),
    ...rankingRaw.sessions.map((session) => session.id),
    activeMatchSessionId
  ].filter(Boolean));
}
function hanchanIdsForRealtime() {
  return new Set([
    ...activeHanchans.map((hanchan) => hanchan.id),
    ...rankingRaw.hanchans.map((hanchan) => hanchan.id)
  ].filter(Boolean));
}
function getRealtimeRow(payload) {
  const next = payload?.new || {};
  const previous = payload?.old || {};
  return Object.keys(next).length ? next : previous;
}
function isRelevantRealtimePayload(payload) {
  if (!payload || !activeGroupId) return false;
  const row = getRealtimeRow(payload);
  const table = payload.table;
  if (table === "groups") return row.id === activeGroupId;
  if (table === "group_members" || table === "match_sessions") return row.group_id === activeGroupId;
  if (table === "match_session_members" || table === "match_session_chips" || table === "match_session_venue_prepayments") return recordIdsForRealtime().has(row.session_id);
  if (table === "match_hanchans") return recordIdsForRealtime().has(row.session_id);
  if (table === "match_hanchan_results" || table === "match_tobi_transfers" || table === "match_yakuman_records") return hanchanIdsForRealtime().has(row.hanchan_id);
  if (table === "debt_records" || table === "debt_events") return row.group_id === activeGroupId;
  return false;
}
function hasDirtyRealtimeFormInput() {
  const fields = document.querySelectorAll(".settings-card form input, .settings-card form select, .settings-card form textarea, .debt-card form input, .debt-card form select, .debt-card form textarea, .group-workspace form input, .group-workspace form select, .group-workspace form textarea, .auth-dialog form input, .auth-dialog form select, .auth-dialog form textarea");
  return Array.from(fields).some((field) => {
    if (field.type === "checkbox" || field.type === "radio") return field.checked !== field.defaultChecked;
    if (field.tagName === "SELECT") return Array.from(field.options).some((option) => option.selected !== option.defaultSelected);
    return field.value !== field.defaultValue;
  });
}
function isRealtimeInputInProgress() {
  if (showCreateSession || showHanchanEditor || showChipEditor || showVenueEditor) return true;
  const focused = document.activeElement;
  if (focused?.closest(".settings-card form, .debt-card form, .group-workspace form, .auth-dialog form")) return true;
  return hasDirtyRealtimeFormInput();
}
function removeRealtimeUpdateBanner() {
  document.querySelector(".realtime-update-banner")?.remove();
}
function showRealtimeUpdateBanner() {
  if (document.querySelector(".realtime-update-banner")) return;
  const banner = document.createElement("div");
  banner.className = "realtime-update-banner";
  banner.innerHTML = `<div><strong>他のメンバーが更新しました</strong><span>入力内容を保護するため、自動では反映していません。</span></div><button type="button" class="realtime-update-button">再読み込み</button>`;
  document.body.append(banner);
  banner.querySelector(".realtime-update-button")?.addEventListener("click", async () => {
    if (isRealtimeInputInProgress() && !window.confirm("入力途中の内容は破棄されます。最新の記録を読み込みますか？")) return;
    await refreshCurrentViewFromRealtime(true);
  });
}
function markLocalRealtimeWrite() {
  realtimeLastLocalWriteAt = Date.now();
}
function clearRealtimeRefreshTimer() {
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = null;
}
async function refreshCurrentViewFromRealtime(force = false) {
  clearRealtimeRefreshTimer();
  if (!currentSession || !activeGroupId) return;
  if (!force && isRealtimeInputInProgress()) {
    realtimePendingRefresh = true;
    showRealtimeUpdateBanner();
    return;
  }
  realtimePendingRefresh = false;
  removeRealtimeUpdateBanner();
  try {
    if (currentTab === "game") await loadMatchSessions();
    else if (currentTab === "ranking") await loadRankingData();
    else if (currentTab === "debt") await loadDebtData();
    else if (currentTab === "settings" || currentTab === "home") await loadGroups();
  } catch (error) {
    console.error("Realtime更新の反映に失敗しました。", error);
  }
}
function queueRealtimeRefresh() {
  clearRealtimeRefreshTimer();
  realtimeRefreshTimer = window.setTimeout(() => { void refreshCurrentViewFromRealtime(false); }, 650);
}
function handleRealtimePayload(payload) {
  if (!isRelevantRealtimePayload(payload)) return;
  // A local save reloads immediately; suppress the same device's short notification burst.
  if (Date.now() - realtimeLastLocalWriteAt < 1200) return;
  queueRealtimeRefresh();
}
async function stopRealtimeSubscriptions() {
  clearRealtimeRefreshTimer();
  realtimePendingRefresh = false;
  removeRealtimeUpdateBanner();
  if (realtimeChannel && supabaseClient) {
    try { await supabaseClient.removeChannel(realtimeChannel); } catch (error) { console.warn("Realtime接続の終了に失敗しました。", error); }
  }
  realtimeChannel = null;
  realtimeChannelGroupId = null;
}
async function setupRealtimeSubscriptions() {
  if (!supabaseClient || !currentSession || !activeGroupId) {
    await stopRealtimeSubscriptions();
    return;
  }
  if (realtimeChannel && realtimeChannelGroupId === activeGroupId) return;
  await stopRealtimeSubscriptions();
  realtimeChannelGroupId = activeGroupId;
  const groupId = activeGroupId;
  const channel = supabaseClient.channel(`jakuroku-realtime-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_sessions", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_session_members" }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_hanchans" }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_hanchan_results" }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_tobi_transfers" }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_session_chips" }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_yakuman_records" }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_session_venue_prepayments" }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "debt_records", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "debt_events", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .subscribe((status) => {
      if (realtimeChannel !== channel) return;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("Realtime接続が不安定です。", status);
    });
  realtimeChannel = channel;
}

function ensureDebtNavigation() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav || nav.querySelector('[data-tab="debt"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item";
  button.dataset.tab = "debt";
  button.innerHTML = `<span>借</span><small>借pt</small>`;
  const settingsButton = nav.querySelector('[data-tab="settings"]');
  nav.insertBefore(button, settingsButton || null);
  navItems = document.querySelectorAll(".nav-item");
}
ensureDebtNavigation();
navItems.forEach((item) => item.addEventListener("click", () => switchTab(item.dataset.tab)));

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function roundTo(value, digits = 2) { const p = 10 ** digits; return Math.round((Number(value) + Number.EPSILON) * p) / p; }
function roundOne(value) { return roundTo(value, 1); }
function nearlyEqual(a, b, tolerance = 0.005) { return Math.abs(num(a) - num(b)) < tolerance; }
function signPrefix(value) { return value > 0 ? "+" : ""; }
function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(roundTo(value, digits));
}
function formatScore(value) { return `${signPrefix(num(value))}${formatNumber(value, 1)}`; }
function formatScoreOrBlank(value) { return value === null || value === undefined ? "未入力" : formatScore(value); }
function formatPt(value) { return `${signPrefix(num(value))}${formatNumber(value, 2)} pt`; }
function formatPtPlain(value) { return `${formatNumber(value, 2)} pt`; }

function signedClass(value) {
  if (num(value) > 0.004) return "value-positive";
  if (num(value) < -0.004) return "value-negative";
  return "value-zero";
}
function formatScoreMarkup(value) {
  if (value === null || value === undefined) return '<span class="value-zero">未入力</span>';
  return `<span class="signed-value ${signedClass(value)}">${formatScore(value)}</span>`;
}
function formatPtMarkup(value) {
  return `<span class="signed-value ${signedClass(value)}">${formatPt(value)}</span>`;
}
function formatChipMarkup(value) {
  return `<span class="signed-value ${signedClass(value)}">${signPrefix(num(value))}${formatNumber(value, 1)}枚</span>`;
}
function inputValueClass(value) {
  return signedClass(value);
}
function applySignedInputClass(input, value = input.value) {
  input.classList.remove("value-positive", "value-negative", "value-zero");
  input.classList.add(inputValueClass(value));
}
function formatDate(date) { if (!date) return ""; const [y, m, d] = date.split("-"); return `${y}/${m}/${d}`; }
function todayInJapan() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const data = {}; parts.forEach((part) => { if (part.type !== "literal") data[part.type] = part.value; });
  return `${data.year}-${data.month}-${data.day}`;
}
function setHeroStatus(text, isError = false) { heroStatus.innerHTML = `<span class="status-dot ${isError ? "status-dot-error" : ""}"></span>${escapeHtml(text)}`; }
function getDisplayName(session) { return session?.user?.user_metadata?.display_name || session?.user?.email?.split("@")[0] || "プレイヤー"; }
function getModePreset(mode) { return MODE_PRESETS[mode] || MODE_PRESETS.sanma; }
function getModeLabel(mode) { return getModePreset(mode).label; }
function getActiveGroup() { return userGroups.find((group) => group.id === activeGroupId) || null; }
function getMemberName(id) { return activeGroupMembers.find((member) => member.id === id)?.display_name || "不明なメンバー"; }
function getRatePreset(label) { return RATE_PRESETS.find((item) => item.label === label); }
function getSessionRateMultiplier() { return num(activeMatchSession?.rate_multiplier || 30); }

function createDefaultSessionDraft(mode) {
  const preset = getModePreset(mode);
  return { sessionDate: todayInJapan(), gameMode: mode, rateLabel: "テンサン", customRateLabel: "", rateMultiplier: 30, startingPoints: preset.startingPoints, chipValue: 4, defaultUma: [...preset.uma], tobiEnabled: true, notes: "", memberIds: [] };
}
function createDefaultHanchanDraft() {
  if (!activeMatchSession) return null;
  const results = {};
  activeMatchMembers.forEach((member, index) => { results[member.member_id] = { rank: index + 1, finalPoints: "", pointMode: "manual" }; });
  return { uma: [...activeMatchSession.default_uma], notes: "", results, tobiTransfers: [], yakumanRecords: [] };
}
function createEmptyYakumanRecord() { return { yakumanName: "国士無双", customName: "", winnerMemberId: "", winType: "tsumo", houjuuMemberId: "" }; }
function getYakumanDisplayName(record) { return record.yakumanName === "その他" ? record.customName.trim() : record.yakumanName; }
function getEditingHanchan() { return activeHanchans.find((hanchan) => hanchan.id === editingHanchanId) || null; }
function createHanchanDraftFromRecord(hanchanId) {
  const hanchan = activeHanchans.find((item) => item.id === hanchanId);
  if (!hanchan) return createDefaultHanchanDraft();

  const results = {};
  activeMatchMembers.forEach((member, index) => {
    const saved = activeHanchanResults.find((result) => result.hanchan_id === hanchanId && result.member_id === member.member_id);
    results[member.member_id] = {
      rank: saved ? Number(saved.rank) : index + 1,
      finalPoints: saved ? String(saved.final_points) : "",
      pointMode: "manual"
    };
  });

  const tobiTransfers = getHanchanTransfers(hanchanId).map((transfer) => ({
    fromMemberId: transfer.from_member_id,
    toMemberId: transfer.to_member_id,
    points: num(transfer.points)
  }));

  const yakumanRecords = getHanchanYakumans(hanchanId).map((record) => {
    const known = YAKUMAN_OPTIONS.includes(record.yakuman_name);
    return {
      yakumanName: known ? record.yakuman_name : "その他",
      customName: known ? "" : record.yakuman_name,
      winnerMemberId: record.winner_member_id,
      winType: record.win_type,
      houjuuMemberId: record.houjuu_member_id || ""
    };
  });

  return {
    uma: Array.isArray(hanchan.uma) ? [...hanchan.uma] : [...activeMatchSession.default_uma],
    notes: hanchan.notes || "",
    results,
    tobiTransfers,
    yakumanRecords
  };
}
function startEditHanchan(hanchanId) {
  editingHanchanId = hanchanId;
  hanchanDraft = createHanchanDraftFromRecord(hanchanId);
  showHanchanEditor = true;
  showChipEditor = false;
  showVenueEditor = false;
  renderActiveSessionView();
}
function resetMatchViewState() { showCreateSession = false; showHanchanEditor = false; showChipEditor = false; showVenueEditor = false; hanchanDraft = null; editingHanchanId = null; chipDraft = {}; venueDraft = { total: 0, prepayments: {} }; gameMessage = ""; }

function getGroupWorkspace() {
  if (!groupWorkspace) { groupWorkspace = document.createElement("section"); groupWorkspace.className = "group-workspace"; mainContent.insertBefore(groupWorkspace, roadmapSection); }
  return groupWorkspace;
}
function getPageWorkspace() {
  if (!pageWorkspace) { pageWorkspace = document.createElement("section"); pageWorkspace.className = "page-workspace"; mainContent.insertBefore(pageWorkspace, roadmapSection); }
  return pageWorkspace;
}

async function switchTab(tab) {
  currentTab = tab;
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
  const home = tab === "home";
  heroCard.hidden = !home; roadmapSection.hidden = !home;
  getGroupWorkspace().hidden = !home || !currentSession;
  getPageWorkspace().hidden = home;
  if (home) { if (currentSession) renderGroupWorkspace(); return; }
  if (tab === "game") { await loadMatchSessions(); return; }
  if (tab === "ranking") { await loadRankingData(); return; }
  if (tab === "debt") { await loadDebtData(); return; }
  if (tab === "settings") { await loadExportPeriodOptions(); renderSettingsPage(); return; }
  renderPlaceholderView(tab);
}

function createAuthButton() {
  if (authButton) return;
  authButton = document.createElement("button"); authButton.type = "button"; authButton.className = "hero-button"; authButton.textContent = "ログイン・新規登録";
  authButton.addEventListener("click", async () => {
    if (!currentSession) return openAuthModal("login");
    if (!window.confirm("ログアウトしますか？")) return;
    const { error } = await supabaseClient.auth.signOut(); if (error) alert(`ログアウトに失敗しました。\n${error.message}`);
  });
  heroCard.append(authButton);
}
async function updateAuthUI(session) {
  currentSession = session; createAuthButton();
  if (!session) {
    await stopRealtimeSubscriptions();
    setHeroStatus("ログインすると仲間と共有できます"); authButton.textContent = "ログイン・新規登録"; authButton.classList.remove("hero-button-logout");
    userGroups = []; activeGroupMembers = []; activeGroupId = null; sessionList = []; activeMatchSessionId = null; activeMatchSession = null; activeMatchMembers = []; activeHanchans = []; activeHanchanResults = []; activeTobiTransfers = []; activeSessionChips = []; activeYakumanRecords = []; activeVenuePrepayments = [];
    rankingRaw = { sessions: [], sessionMembers: [], hanchans: [], results: [], chips: [], prepayments: [], yakumans: [] };
    rankingMetric = "total";
    rankingPeriodMode = "all";
    rankingPeriodValue = "";
    rankingSelectedMemberId = "";
    rankingOpenSessionId = null;
    debtRecords = []; debtEvents = []; debtViewMode = "open"; debtMessage = ""; debtOpenPaymentId = null; debtOpenRerouteId = null;
    localStorage.removeItem("jakuroku-active-group-id"); localStorage.removeItem("jakuroku-active-match-session-id"); getGroupWorkspace().hidden = true;
    if (currentTab !== "home") await switchTab("home");
    return;
  }
  setHeroStatus(`${getDisplayName(session)}としてログイン中`); authButton.textContent = "ログアウト"; authButton.classList.add("hero-button-logout"); await loadGroups();
}

function closeAuthModal() { document.querySelector(".auth-overlay")?.remove(); }
function openAuthModal(mode = "login") {
  closeAuthModal(); const signup = mode === "signup";
  document.body.insertAdjacentHTML("beforeend", `<div class="auth-overlay"><section class="auth-dialog" role="dialog" aria-modal="true"><button class="auth-close-button" type="button">×</button><p class="eyebrow">JAKUROKU ACCOUNT</p><h2>${signup ? "アカウントを作成" : "ログイン"}</h2><form id="authForm" class="auth-form">${signup ? `<label>表示名<input name="displayName" type="text" maxlength="40" required></label>` : ""}<label>メールアドレス<input name="email" type="email" autocomplete="email" required></label><label>パスワード<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" required></label><p id="authMessage" class="auth-message"></p><button id="authSubmitButton" class="auth-submit-button" type="submit">${signup ? "登録する" : "ログインする"}</button></form><button id="authModeButton" class="auth-mode-button" type="button">${signup ? "すでに登録済みの場合はログイン" : "初めての場合は新規登録"}</button></section></div>`);
  const overlay = document.querySelector(".auth-overlay"), form = document.getElementById("authForm"), message = document.getElementById("authMessage"), submit = document.getElementById("authSubmitButton");
  document.querySelector(".auth-close-button").addEventListener("click", closeAuthModal); overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAuthModal(); }); document.getElementById("authModeButton").addEventListener("click", () => openAuthModal(signup ? "login" : "signup"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(form); const email = String(fd.get("email") || "").trim(), password = String(fd.get("password") || ""), displayName = String(fd.get("displayName") || "").trim(); message.textContent = ""; submit.disabled = true; submit.textContent = "処理中...";
    try {
      if (signup) { const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: APP_URL, data: { display_name: displayName } } }); if (error) throw error; if (data.session) setTimeout(closeAuthModal, 700); else message.textContent = "確認メールを送信しました。メール内のリンクを開いて登録を完了してください。"; }
      else { const { error } = await supabaseClient.auth.signInWithPassword({ email, password }); if (error) throw error; closeAuthModal(); }
    } catch (error) { message.textContent = error.message || "処理に失敗しました。"; }
    finally { submit.disabled = false; submit.textContent = signup ? "登録する" : "ログインする"; }
  });
}

async function loadGroups() {
  if (!currentSession) return;
  try {
    const { data: memberships, error: mErr } = await supabaseClient.from("group_members").select("group_id, display_name, role").eq("user_id", currentSession.user.id); if (mErr) throw mErr;
    const ids = (memberships || []).map((m) => m.group_id);
    if (!ids.length) { userGroups = []; activeGroupMembers = []; activeGroupId = null; localStorage.removeItem("jakuroku-active-group-id"); await stopRealtimeSubscriptions(); if (currentTab === "home") renderGroupWorkspace(); if (currentTab === "settings") renderSettingsPage(); return; }
    const { data: groups, error: gErr } = await supabaseClient.from("groups").select("id, name, invite_code, created_at").in("id", ids); if (gErr) throw gErr;
    userGroups = (groups || []).map((group) => ({ ...group, membership: memberships.find((m) => m.group_id === group.id) })).sort((a,b) => a.name.localeCompare(b.name, "ja"));
    if (!userGroups.some((g) => g.id === activeGroupId)) activeGroupId = userGroups[0]?.id || null;
    if (activeGroupId) localStorage.setItem("jakuroku-active-group-id", activeGroupId);
    await loadActiveGroupMembers(); await setupRealtimeSubscriptions(); if (currentTab === "home") renderGroupWorkspace(); if (currentTab === "settings") renderSettingsPage();
  } catch (error) { getGroupWorkspace().innerHTML = `<section class="workspace-card"><p class="eyebrow">GROUP</p><h2>グループを読み込めませんでした</h2><p class="workspace-description">${escapeHtml(error.message || "通信状態を確認してください。")}</p><button id="retryLoadGroupsButton" class="primary-button" type="button">再読み込み</button></section>`; document.getElementById("retryLoadGroupsButton")?.addEventListener("click", loadGroups); }
}
async function loadActiveGroupMembers() {
  if (!activeGroupId) { activeGroupMembers = []; return; }
  const { data, error } = await supabaseClient.from("group_members").select("id, user_id, display_name, role, created_at").eq("group_id", activeGroupId).order("created_at", { ascending: true }); if (error) throw error; activeGroupMembers = data || [];
}


function isActiveGroupAdmin() {
  return getActiveGroup()?.membership?.role === "admin";
}

function getCurrentGroupMembership() {
  return getActiveGroup()?.membership || null;
}

async function copyTextToClipboard(textValue, button) {
  try {
    await navigator.clipboard.writeText(textValue);
    if (button) {
      const original = button.textContent;
      button.textContent = "コピー済み";
      setTimeout(() => { button.textContent = original; }, 1500);
    }
  } catch {
    window.prompt("コピーしてください。", textValue);
  }
}

async function switchActiveGroup(groupId) {
  if (!groupId || groupId === activeGroupId) return;
  activeGroupId = groupId;
  localStorage.setItem("jakuroku-active-group-id", activeGroupId);
  activeMatchSessionId = null;
  localStorage.removeItem("jakuroku-active-match-session-id");
  await loadActiveGroupMembers();
  await setupRealtimeSubscriptions();
  settingsMessage = "グループを切り替えました。";
  renderSettingsPage();
}


function getExportPeriodLabel() {
  if (exportPeriodMode === "year") return exportPeriodValue ? `${exportPeriodValue}年` : "年別";
  if (exportPeriodMode === "month") {
    const [year, month] = String(exportPeriodValue || "").split("-");
    return year && month ? `${year}年${Number(month)}月` : "月別";
  }
  return "全期間";
}

function getExportDateRange() {
  if (exportPeriodMode === "year" && /^\d{4}$/.test(exportPeriodValue)) {
    const year = Number(exportPeriodValue);
    return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }
  if (exportPeriodMode === "month" && /^\d{4}-\d{2}$/.test(exportPeriodValue)) {
    const [yearText, monthText] = exportPeriodValue.split("-");
    const year = Number(yearText), month = Number(monthText);
    const next = new Date(Date.UTC(year, month, 1));
    return { from: `${yearText}-${monthText}-01`, to: next.toISOString().slice(0, 10) };
  }
  return { from: null, to: null };
}

async function loadExportPeriodOptions() {
  if (!currentSession || !activeGroupId || !supabaseClient) {
    exportPeriodOptions = { years: [], months: [] };
    return;
  }
  const { data, error } = await supabaseClient
    .from("match_sessions")
    .select("session_date")
    .eq("group_id", activeGroupId)
    .is("deleted_at", null)
    .order("session_date", { ascending: false });
  if (error) throw error;
  const dates = (data || []).map((row) => String(row.session_date || "")).filter(Boolean);
  exportPeriodOptions = {
    years: [...new Set(dates.map((date) => date.slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    months: [...new Set(dates.map((date) => date.slice(0, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a))
  };
  if (exportPeriodMode === "year" && !exportPeriodOptions.years.includes(exportPeriodValue)) exportPeriodValue = exportPeriodOptions.years[0] || "";
  if (exportPeriodMode === "month" && !exportPeriodOptions.months.includes(exportPeriodValue)) exportPeriodValue = exportPeriodOptions.months[0] || "";
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function createCsvText(headers, rows) {
  return `\uFEFF${headers.map(csvCell).join(",")}\r\n${rows.map((row) => headers.map((key) => csvCell(row[key])).join(",")).join("\r\n")}\r\n`;
}

function formatExportNumber(value, digits = 2) {
  const number = num(value);
  const rounded = roundTo(number, digits);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function safeDownloadName(value) {
  return String(value || "jakuroku").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "jakuroku";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.length; });
  return output;
}

function getCrc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localChunks = [], centralChunks = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = getCrc32(dataBytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localChunks.push(local, dataBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);
    offset += local.length + dataBytes.length;
  });

  const centralStart = offset;
  const centralData = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralData.length, true);
  endView.setUint32(16, centralStart, true);
  endView.setUint16(20, 0, true);
  return new Blob([concatBytes([...localChunks, centralData, end])], { type: "application/zip" });
}

function getExportMemberName(memberId, membersById) {
  return membersById.get(memberId)?.display_name || "削除済みメンバー";
}

function buildExportSettlementRows(payload) {
  const sessionMembersBySession = new Map();
  payload.sessionMembers.forEach((row) => {
    if (!sessionMembersBySession.has(row.session_id)) sessionMembersBySession.set(row.session_id, []);
    sessionMembersBySession.get(row.session_id).push(row.member_id);
  });
  const resultsByHanchan = new Map();
  payload.results.forEach((row) => {
    if (!resultsByHanchan.has(row.hanchan_id)) resultsByHanchan.set(row.hanchan_id, []);
    resultsByHanchan.get(row.hanchan_id).push(row);
  });
  const hanchansBySession = new Map();
  payload.hanchans.forEach((row) => {
    if (!hanchansBySession.has(row.session_id)) hanchansBySession.set(row.session_id, []);
    hanchansBySession.get(row.session_id).push(row);
  });
  const chipBySessionMember = new Map(payload.chips.map((row) => [`${row.session_id}:${row.member_id}`, num(row.chip_count)]));
  const prepaidBySessionMember = new Map(payload.prepayments.map((row) => [`${row.session_id}:${row.member_id}`, num(row.paid_molly)]));
  const membersById = new Map(payload.members.map((member) => [member.id, member]));

  return payload.sessions.flatMap((session) => {
    const memberIds = sessionMembersBySession.get(session.id) || [];
    const hanchans = hanchansBySession.get(session.id) || [];
    const scoreByMember = new Map(memberIds.map((id) => [id, 0]));
    hanchans.forEach((hanchan) => (resultsByHanchan.get(hanchan.id) || []).forEach((result) => {
      scoreByMember.set(result.member_id, roundOne(num(scoreByMember.get(result.member_id)) + num(result.total_points)));
    }));
    const cents = Math.round(num(session.venue_fee_total) * 100);
    const baseCents = memberIds.length ? Math.floor(cents / memberIds.length) : 0;
    const remainder = memberIds.length ? cents - baseCents * memberIds.length : 0;

    return memberIds.map((memberId, index) => {
      const hanchanScore = num(scoreByMember.get(memberId));
      const chipCount = num(chipBySessionMember.get(`${session.id}:${memberId}`));
      const chipGameScore = roundOne(chipCount * num(session.chip_value));
      const gameScore = roundOne(hanchanScore + chipGameScore);
      const rate = num(session.rate_multiplier);
      const scorePt = roundTo(hanchanScore * rate, 2);
      const chipPt = roundTo(chipGameScore * rate, 2);
      const gamePt = roundTo(scorePt + chipPt, 2);
      const venueShare = (baseCents + (index < remainder ? 1 : 0)) / 100;
      const venuePrepaidPt = num(prepaidBySessionMember.get(`${session.id}:${memberId}`));
      const finalSettlementPt = roundTo(gamePt - venueShare + venuePrepaidPt, 2);
      return {
        session_id: session.id,
        session_date: session.session_date,
        status: session.status,
        member_id: memberId,
        member_name: getExportMemberName(memberId, membersById),
        hanchan_game_score: formatExportNumber(hanchanScore, 1),
        chip_count: formatExportNumber(chipCount, 1),
        chip_game_score: formatExportNumber(chipGameScore, 1),
        score_pt: formatExportNumber(scorePt, 2),
        chip_pt: formatExportNumber(chipPt, 2),
        game_pt_excluding_venue: formatExportNumber(gamePt, 2),
        venue_fee_total_pt: formatExportNumber(session.venue_fee_total, 2),
        venue_equal_share_pt: formatExportNumber(venueShare, 2),
        venue_prepaid_pt: formatExportNumber(venuePrepaidPt, 2),
        final_settlement_pt_including_venue: formatExportNumber(finalSettlementPt, 2)
      };
    });
  });
}

async function fetchGroupExportPayload(groupId) {
  const range = getExportDateRange();
  let sessionsQuery = supabaseClient
    .from("match_sessions")
    .select("id, group_id, session_date, game_mode, rate_label, rate_multiplier, starting_points, chip_value, default_uma, tobi_enabled, venue_fee_total, notes, status, settled_at, created_at")
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("session_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (range.from) sessionsQuery = sessionsQuery.gte("session_date", range.from);
  if (range.to) sessionsQuery = sessionsQuery.lt("session_date", range.to);

  const [sessionsResponse, membersResponse] = await Promise.all([
    sessionsQuery,
    supabaseClient
      .from("group_members")
      .select("id, group_id, user_id, display_name, role, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
  ]);
  if (sessionsResponse.error) throw sessionsResponse.error;
  if (membersResponse.error) throw membersResponse.error;

  const sessions = sessionsResponse.data || [];
  const members = membersResponse.data || [];
  const sessionIds = sessions.map((session) => session.id);
  if (!sessionIds.length) return { sessions, members, sessionMembers: [], hanchans: [], results: [], chips: [], prepayments: [], tobiTransfers: [], yakumans: [] };

  const [sessionMembersResponse, hanchansResponse, chipsResponse, prepaymentsResponse] = await Promise.all([
    supabaseClient.from("match_session_members").select("session_id, member_id").in("session_id", sessionIds),
    supabaseClient.from("match_hanchans").select("id, session_id, sequence_no, uma, notes, created_at").in("session_id", sessionIds).order("sequence_no", { ascending: true }),
    supabaseClient.from("match_session_chips").select("session_id, member_id, chip_count, updated_at").in("session_id", sessionIds),
    supabaseClient.from("match_session_venue_prepayments").select("session_id, member_id, paid_molly, updated_at").in("session_id", sessionIds)
  ]);
  if (sessionMembersResponse.error) throw sessionMembersResponse.error;
  if (hanchansResponse.error) throw hanchansResponse.error;
  if (chipsResponse.error) throw chipsResponse.error;
  if (prepaymentsResponse.error) throw prepaymentsResponse.error;

  const hanchans = hanchansResponse.data || [];
  const hanchanIds = hanchans.map((hanchan) => hanchan.id);
  if (!hanchanIds.length) return { sessions, members, sessionMembers: sessionMembersResponse.data || [], hanchans, results: [], chips: chipsResponse.data || [], prepayments: prepaymentsResponse.data || [], tobiTransfers: [], yakumans: [] };

  const [resultsResponse, transfersResponse, yakumansResponse] = await Promise.all([
    supabaseClient.from("match_hanchan_results").select("id, hanchan_id, member_id, rank, final_points, score_points, uma_points, tobi_points, total_points").in("hanchan_id", hanchanIds),
    supabaseClient.from("match_tobi_transfers").select("id, hanchan_id, from_member_id, to_member_id, points").in("hanchan_id", hanchanIds),
    supabaseClient.from("match_yakuman_records").select("id, hanchan_id, winner_member_id, yakuman_name, win_type, houjuu_member_id, created_at").in("hanchan_id", hanchanIds)
  ]);
  if (resultsResponse.error) throw resultsResponse.error;
  if (transfersResponse.error) throw transfersResponse.error;
  if (yakumansResponse.error) throw yakumansResponse.error;

  return {
    sessions,
    members,
    sessionMembers: sessionMembersResponse.data || [],
    hanchans,
    results: resultsResponse.data || [],
    chips: chipsResponse.data || [],
    prepayments: prepaymentsResponse.data || [],
    tobiTransfers: transfersResponse.data || [],
    yakumans: yakumansResponse.data || []
  };
}

function buildExportFiles(group, payload) {
  const membersById = new Map(payload.members.map((member) => [member.id, member]));
  const sessionById = new Map(payload.sessions.map((session) => [session.id, session]));
  const hanchanById = new Map(payload.hanchans.map((hanchan) => [hanchan.id, hanchan]));
  const sessionMembersBySession = new Map();
  payload.sessionMembers.forEach((row) => {
    if (!sessionMembersBySession.has(row.session_id)) sessionMembersBySession.set(row.session_id, []);
    sessionMembersBySession.get(row.session_id).push(row.member_id);
  });
  const hanchansBySession = new Map();
  payload.hanchans.forEach((row) => {
    if (!hanchansBySession.has(row.session_id)) hanchansBySession.set(row.session_id, []);
    hanchansBySession.get(row.session_id).push(row);
  });
  const settlements = buildExportSettlementRows(payload);

  const dailyRows = payload.sessions.map((session) => ({
    session_id: session.id,
    session_date: session.session_date,
    status: session.status,
    game_mode: getModeLabel(session.game_mode),
    rate_label: session.rate_label,
    rate_multiplier_pt_per_game_score: formatExportNumber(session.rate_multiplier, 2),
    starting_points: session.starting_points,
    chip_value_per_chip: formatExportNumber(session.chip_value, 2),
    default_uma: Array.isArray(session.default_uma) ? session.default_uma.join(" / ") : "",
    tobi_enabled: session.tobi_enabled ? "あり" : "なし",
    venue_fee_total_pt: formatExportNumber(session.venue_fee_total, 2),
    participant_count: (sessionMembersBySession.get(session.id) || []).length,
    participants: (sessionMembersBySession.get(session.id) || []).map((id) => getExportMemberName(id, membersById)).join(" / "),
    hanchan_count: (hanchansBySession.get(session.id) || []).length,
    notes: session.notes || "",
    settled_at: session.settled_at || "",
    created_at: session.created_at || ""
  }));

  const hanchanRows = payload.results.map((result) => {
    const hanchan = hanchanById.get(result.hanchan_id) || {};
    const session = sessionById.get(hanchan.session_id) || {};
    return {
      session_id: session.id || "",
      session_date: session.session_date || "",
      hanchan_id: result.hanchan_id,
      hanchan_no: hanchan.sequence_no || "",
      member_id: result.member_id,
      member_name: getExportMemberName(result.member_id, membersById),
      rank: result.rank,
      final_points: result.final_points,
      score_points: formatExportNumber(result.score_points, 1),
      uma_points: formatExportNumber(result.uma_points, 1),
      tobi_points: formatExportNumber(result.tobi_points, 1),
      total_game_score: formatExportNumber(result.total_points, 1),
      uma_setting: Array.isArray(hanchan.uma) ? hanchan.uma.join(" / ") : "",
      hanchan_notes: hanchan.notes || ""
    };
  });

  const transferRows = payload.tobiTransfers.map((transfer) => {
    const hanchan = hanchanById.get(transfer.hanchan_id) || {};
    const session = sessionById.get(hanchan.session_id) || {};
    return {
      session_id: session.id || "",
      session_date: session.session_date || "",
      hanchan_id: transfer.hanchan_id,
      hanchan_no: hanchan.sequence_no || "",
      from_member_id: transfer.from_member_id,
      from_member_name: getExportMemberName(transfer.from_member_id, membersById),
      to_member_id: transfer.to_member_id,
      to_member_name: getExportMemberName(transfer.to_member_id, membersById),
      transfer_game_score: formatExportNumber(transfer.points, 1)
    };
  });

  const yakumanRows = payload.yakumans.map((record) => {
    const hanchan = hanchanById.get(record.hanchan_id) || {};
    const session = sessionById.get(hanchan.session_id) || {};
    return {
      session_id: session.id || "",
      session_date: session.session_date || "",
      hanchan_id: record.hanchan_id,
      hanchan_no: hanchan.sequence_no || "",
      winner_member_id: record.winner_member_id,
      winner_name: getExportMemberName(record.winner_member_id, membersById),
      yakuman_name: record.yakuman_name,
      win_type: record.win_type === "tsumo" ? "ツモ" : "ロン",
      houjuu_member_id: record.houjuu_member_id || "",
      houjuu_name: record.houjuu_member_id ? getExportMemberName(record.houjuu_member_id, membersById) : "",
      created_at: record.created_at || ""
    };
  });

  const memberRows = payload.members.map((member) => ({
    member_id: member.id,
    display_name: member.display_name,
    role: member.role === "admin" ? "管理者" : "メンバー",
    account_linked: member.user_id ? "あり" : "なし",
    created_at: member.created_at || ""
  }));

  const contents = [
    { name: "01_日次記録.csv", content: createCsvText(Object.keys(dailyRows[0] || { session_id: "" }), dailyRows) },
    { name: "02_半荘結果.csv", content: createCsvText(Object.keys(hanchanRows[0] || { session_id: "" }), hanchanRows) },
    { name: "03_チップと精算.csv", content: createCsvText(Object.keys(settlements[0] || { session_id: "" }), settlements) },
    { name: "04_飛ばし点.csv", content: createCsvText(Object.keys(transferRows[0] || { session_id: "" }), transferRows) },
    { name: "05_役満記録.csv", content: createCsvText(Object.keys(yakumanRows[0] || { session_id: "" }), yakumanRows) },
    { name: "06_メンバー.csv", content: createCsvText(Object.keys(memberRows[0] || { member_id: "" }), memberRows) },
    { name: "README.txt", content: `雀録 データ出力\n\nグループ: ${group.name}\n対象期間: ${getExportPeriodLabel()}\n出力日時: ${new Date().toLocaleString("ja-JP")}\n\n「03_チップと精算.csv」の game_pt_excluding_venue は、場代を除くゲーム収支です。\nfinal_settlement_pt_including_venue は、場代均等負担と先払いを反映した最終精算額です。\n` }
  ];

  return { files: contents, settlements };
}

async function exportGroupData(kind) {
  const group = getActiveGroup();
  if (!group || !activeGroupId) return;
  const format = kind === "json" ? "JSONバックアップ" : "CSV一式";
  exportMessage = `${format}を作成しています…`;
  exportMessageIsError = false;
  renderSettingsPage();
  try {
    const payload = await fetchGroupExportPayload(activeGroupId);
    const periodLabel = exportPeriodMode === "all" ? "all" : exportPeriodValue || "period";
    const baseName = `jakuroku_${safeDownloadName(group.name)}_${periodLabel}`;
    if (kind === "json") {
      const backup = {
        format: "jakuroku-backup-v1",
        exported_at: new Date().toISOString(),
        period: { mode: exportPeriodMode, value: exportPeriodValue || null, label: getExportPeriodLabel() },
        group: { id: group.id, name: group.name, created_at: group.created_at || null },
        tables: payload
      };
      downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), `${baseName}_backup.json`);
      exportMessage = `JSONバックアップを出力しました（${payload.sessions.length}日分）。`;
    } else {
      const exported = buildExportFiles(group, payload);
      downloadBlob(createZipBlob(exported.files), `${baseName}_csv.zip`);
      exportMessage = `CSV一式を出力しました（${payload.sessions.length}日分、${exported.settlements.length}人分の精算明細）。`;
    }
    exportMessageIsError = false;
  } catch (error) {
    console.error("データ出力に失敗しました。", error);
    exportMessage = error.message || "データ出力に失敗しました。";
    exportMessageIsError = true;
  }
  renderSettingsPage();
}

function renderSettingsPage() {
  const page = getPageWorkspace();

  if (!currentSession) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">SETTINGS</p><h2>ログインが必要です</h2><p class="workspace-description">設定の確認・変更にはログインしてください。</p><button id="settingsHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("settingsHomeButton")?.addEventListener("click", () => switchTab("home"));
    return;
  }

  const group = getActiveGroup();
  if (!group) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">GROUP SETTINGS</p><h2>グループがありません</h2><p class="workspace-description">最初に麻雀仲間のグループを作成するか、招待コードで参加してください。</p><div class="workspace-actions"><button id="settingsCreateGroupButton" class="primary-button" type="button">グループを作成</button><button id="settingsJoinGroupButton" class="secondary-button" type="button">招待コードで参加</button></div></section>`;
    document.getElementById("settingsCreateGroupButton")?.addEventListener("click", () => openGroupModal("create"));
    document.getElementById("settingsJoinGroupButton")?.addEventListener("click", () => openGroupModal("join"));
    return;
  }

  const membership = getCurrentGroupMembership();
  const admin = isActiveGroupAdmin();
  const adminCount = activeGroupMembers.filter((member) => member.role === "admin").length;
  const notice = settingsMessage ? `<p class="settings-notice">${escapeHtml(settingsMessage)}</p>` : "";
  const groupChoices = userGroups.map((item) => `
    <button class="group-choice ${item.id === group.id ? "active" : ""}" data-settings-group-id="${item.id}" type="button">
      <span>${escapeHtml(item.name)}</span>
      <small>${item.membership?.role === "admin" ? "管理者" : "参加中"}</small>
    </button>
  `).join("");

  const memberRows = activeGroupMembers.map((member) => {
    const identity = member.user_id ? "アカウント連携済み" : "ゲスト";
    const own = member.user_id === currentSession.user.id;
    const roleControls = admin ? `
      <div class="member-role-controls">
        <select data-member-role-select="${member.id}" ${!member.user_id ? "" : ""}>
          <option value="admin" ${member.role === "admin" ? "selected" : ""} ${!member.user_id ? "disabled" : ""}>管理者</option>
          <option value="member" ${member.role === "member" ? "selected" : ""}>メンバー</option>
        </select>
        <button class="secondary-button settings-small-button" type="button" data-save-member-role-id="${member.id}">変更</button>
        ${!member.user_id ? `<button class="member-delete-button" type="button" data-settings-remove-guest-id="${member.id}">削除</button>` : ""}
      </div>
    ` : `<span class="member-role-badge">${member.role === "admin" ? "管理者" : "メンバー"}</span>`;

    return `
      <li class="settings-member-row">
        <div class="member-row-main">
          <strong>${escapeHtml(member.display_name)}${own ? " <small>（あなた）</small>" : ""}</strong>
          <span>${identity}${member.role === "admin" ? " ・ 管理者" : ""}</span>
        </div>
        ${roleControls}
      </li>
    `;
  }).join("");

  page.innerHTML = `
    <section class="workspace-card settings-card">
      <div class="workspace-heading">
        <div><p class="eyebrow">SETTINGS</p><h2>グループ・メンバー管理</h2></div>
        <button id="settingsHomeButton" class="icon-text-button" type="button">ホーム</button>
      </div>
      <p class="workspace-description">表示名、招待、グループ名、メンバー権限をここで管理します。</p>
      ${notice}

      <section class="settings-section">
        <div class="settings-section-heading"><div><p class="eyebrow">MY PROFILE</p><h3>あなたの表示名</h3></div></div>
        <form id="settingsDisplayNameForm" class="settings-inline-form">
          <label>このグループでの表示名<input name="displayName" type="text" maxlength="40" required value="${escapeHtml(membership?.display_name || "")}"></label>
          <button class="primary-button" type="submit">保存</button>
        </form>
      </section>

      <section class="settings-section">
        <div class="settings-section-heading"><div><p class="eyebrow">INVITE</p><h3>招待コード</h3></div></div>
        <div class="settings-invite-box">
          <div><strong>${escapeHtml(group.invite_code)}</strong><p>このコードを仲間に共有すると、アカウントでグループへ参加できます。</p></div>
          <div class="settings-action-stack">
            <button id="settingsCopyInviteButton" class="secondary-button" type="button">コピー</button>
            ${admin ? `<button id="settingsRegenerateInviteButton" class="danger-outline-button" type="button">再発行</button>` : ""}
          </div>
        </div>
        ${admin ? `<p class="settings-help">再発行すると、以前の招待コードは使えなくなります。</p>` : ""}
      </section>

      <section class="settings-section">
        <div class="settings-section-heading"><div><p class="eyebrow">GROUP</p><h3>グループ名</h3></div>${admin ? `<span class="member-role-badge">管理者のみ変更可</span>` : ""}</div>
        ${admin ? `
          <form id="settingsGroupNameForm" class="settings-inline-form">
            <label>グループ名<input name="groupName" type="text" maxlength="60" required value="${escapeHtml(group.name)}"></label>
            <button class="primary-button" type="submit">変更</button>
          </form>
        ` : `<p class="settings-readonly-value">${escapeHtml(group.name)}</p>`}
      </section>

      <section class="settings-section">
        <div class="member-panel-heading"><div><p class="eyebrow">MEMBERS</p><h3>メンバーと権限</h3></div>${admin ? `<button id="settingsAddGuestButton" class="secondary-button" type="button">＋ ゲストを追加</button>` : ""}</div>
        <p class="settings-help">管理者はグループ名・招待コード・メンバー権限を管理できます。ゲストは管理者に変更できません。</p>
        <ul class="settings-member-list">${memberRows}</ul>
        ${adminCount <= 1 ? `<p class="settings-help">現在の最後の管理者は、一般メンバーへ変更できません。</p>` : ""}
      </section>

      <section class="settings-section data-export-section">
        <div class="settings-section-heading"><div><p class="eyebrow">DATA EXPORT</p><h3>記録のバックアップ・出力</h3></div><span class="member-role-badge">${escapeHtml(getExportPeriodLabel())}</span></div>
        <p class="settings-help">対象期間の記録を端末へ保存します。CSVには日次記録、半荘結果、チップ・場代精算、飛ばし点、役満記録を含めます。</p>
        <div class="data-export-period-panel">
          <div><p class="data-export-label">対象期間</p><div class="ranking-filter-list"><button type="button" class="ranking-filter-button ${exportPeriodMode === "all" ? "active" : ""}" data-export-period-mode="all">全期間</button><button type="button" class="ranking-filter-button ${exportPeriodMode === "year" ? "active" : ""}" data-export-period-mode="year">年別</button><button type="button" class="ranking-filter-button ${exportPeriodMode === "month" ? "active" : ""}" data-export-period-mode="month">月別</button>${exportPeriodMode === "year" ? `<select id="exportPeriodSelect" class="ranking-member-select">${exportPeriodOptions.years.map((year) => `<option value="${year}" ${exportPeriodValue === year ? "selected" : ""}>${year}年</option>`).join("")}</select>` : exportPeriodMode === "month" ? `<select id="exportPeriodSelect" class="ranking-member-select">${exportPeriodOptions.months.map((month) => { const [year, monthNumber] = month.split("-"); return `<option value="${month}" ${exportPeriodValue === month ? "selected" : ""}>${year}年${Number(monthNumber)}月</option>`; }).join("")}</select>` : ""}</div></div>
        </div>
        <div class="data-export-action-grid"><button id="settingsExportCsvButton" class="primary-button" type="button">CSV一式を出力</button><button id="settingsExportJsonButton" class="secondary-button" type="button">JSONバックアップを出力</button></div>
        <p class="data-export-help">CSVはExcel等で確認するための形式です。JSONは将来の復元用に、そのまま保管してください。招待コードはバックアップへ含めません。</p>
        ${exportMessage ? `<p class="data-export-message ${exportMessageIsError ? "error" : ""}">${escapeHtml(exportMessage)}</p>` : ""}
      </section>

      <section class="settings-section">
        <div class="settings-section-heading"><div><p class="eyebrow">GROUP SWITCH</p><h3>グループを切り替える</h3></div><button id="settingsCreateGroupButton" class="icon-text-button" type="button">＋ 作成</button></div>
        <div class="group-choice-list">${groupChoices}</div>
        <div class="workspace-actions"><button id="settingsJoinGroupButton" class="secondary-button" type="button">招待コードで別グループに参加</button></div>
      </section>
    </section>
  `;

  document.getElementById("settingsHomeButton")?.addEventListener("click", () => switchTab("home"));
  document.getElementById("settingsCopyInviteButton")?.addEventListener("click", (event) => copyTextToClipboard(group.invite_code, event.currentTarget));
  document.getElementById("settingsCreateGroupButton")?.addEventListener("click", () => openGroupModal("create"));
  document.getElementById("settingsJoinGroupButton")?.addEventListener("click", () => openGroupModal("join"));
  document.getElementById("settingsAddGuestButton")?.addEventListener("click", openGuestMemberModal);

  document.getElementById("settingsDisplayNameForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const displayName = String(new FormData(event.currentTarget).get("displayName") || "").trim();
    button.disabled = true;
    try {
      markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("update_my_group_display_name", { p_group_id: activeGroupId, p_display_name: displayName });
      if (error) throw error;
      settingsMessage = "表示名を更新しました。";
      await loadGroups();
    } catch (error) {
      alert(error.message || "表示名を更新できませんでした。");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("settingsGroupNameForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const groupName = String(new FormData(event.currentTarget).get("groupName") || "").trim();
    button.disabled = true;
    try {
      markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("update_group_name", { p_group_id: activeGroupId, p_group_name: groupName });
      if (error) throw error;
      settingsMessage = "グループ名を変更しました。";
      await loadGroups();
    } catch (error) {
      alert(error.message || "グループ名を変更できませんでした。");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("settingsRegenerateInviteButton")?.addEventListener("click", async (event) => {
    if (!confirm("招待コードを再発行しますか？\n以前のコードは使えなくなります。")) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      markLocalRealtimeWrite(); const { data, error } = await supabaseClient.rpc("regenerate_group_invite_code", { p_group_id: activeGroupId });
      if (error) throw error;
      settingsMessage = `招待コードを再発行しました：${data}`;
      await loadGroups();
    } catch (error) {
      alert(error.message || "招待コードを再発行できませんでした。");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-save-member-role-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const memberId = button.dataset.saveMemberRoleId;
      const select = document.querySelector(`[data-member-role-select="${memberId}"]`);
      if (!select) return;
      const target = activeGroupMembers.find((member) => member.id === memberId);
      const role = select.value;
      if (target?.role === role) return;
      if (!confirm(`${target?.display_name || "このメンバー"}の権限を「${role === "admin" ? "管理者" : "メンバー"}」に変更しますか？`)) return;
      button.disabled = true;
      try {
        markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("update_group_member_role", { p_group_id: activeGroupId, p_member_id: memberId, p_role: role });
        if (error) throw error;
        settingsMessage = "メンバー権限を更新しました。";
        await loadGroups();
      } catch (error) {
        alert(error.message || "権限を変更できませんでした。");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-settings-remove-guest-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("このゲストメンバーを削除しますか？")) return;
      button.disabled = true;
      try {
        markLocalRealtimeWrite(); const { error } = await supabaseClient.from("group_members").delete().eq("id", button.dataset.settingsRemoveGuestId).eq("group_id", activeGroupId).is("user_id", null);
        if (error) throw error;
        settingsMessage = "ゲストメンバーを削除しました。";
        await loadActiveGroupMembers();
        renderSettingsPage();
      } catch (error) {
        alert(error.message || "メンバーを削除できませんでした。");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-settings-group-id]").forEach((button) => {
    button.addEventListener("click", () => { void switchActiveGroup(button.dataset.settingsGroupId); });
  });

  document.querySelectorAll("[data-export-period-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      exportPeriodMode = button.dataset.exportPeriodMode;
      exportPeriodValue = exportPeriodMode === "year" ? (exportPeriodOptions.years[0] || "") : exportPeriodMode === "month" ? (exportPeriodOptions.months[0] || "") : "";
      exportMessage = "";
      exportMessageIsError = false;
      renderSettingsPage();
    });
  });
  document.getElementById("exportPeriodSelect")?.addEventListener("change", (event) => {
    exportPeriodValue = event.target.value;
    exportMessage = "";
    exportMessageIsError = false;
    renderSettingsPage();
  });
  document.getElementById("settingsExportCsvButton")?.addEventListener("click", () => { void exportGroupData("csv"); });
  document.getElementById("settingsExportJsonButton")?.addEventListener("click", () => { void exportGroupData("json"); });
}

function renderGroupWorkspace() {
  const ws = getGroupWorkspace(), group = getActiveGroup(); if (!currentSession) { ws.hidden = true; return; } ws.hidden = false;
  if (!group) {
    ws.innerHTML = `<section class="workspace-card"><p class="eyebrow">GROUP SETUP</p><h2>最初のグループを作成</h2><p class="workspace-description">麻雀を打つ仲間ごとにグループを作成します。</p><div class="workspace-actions"><button id="createGroupButton" class="primary-button" type="button">グループを作成</button><button id="joinGroupButton" class="secondary-button" type="button">招待コードで参加</button></div></section>`;
    document.getElementById("createGroupButton").addEventListener("click", () => openGroupModal("create")); document.getElementById("joinGroupButton").addEventListener("click", () => openGroupModal("join")); return;
  }
  const admin = group.membership?.role === "admin";
  const rows = activeGroupMembers.map((m) => `<li class="member-row"><div class="member-row-main"><strong>${escapeHtml(m.display_name)}</strong><span>${m.role === "admin" ? "管理者" : m.user_id ? "アカウント連携済み" : "ゲスト"}</span></div>${admin && !m.user_id ? `<button class="member-delete-button" type="button" data-remove-guest-member-id="${m.id}">削除</button>` : ""}</li>`).join("");
  const choices = userGroups.map((g) => `<button class="group-choice ${g.id === group.id ? "active" : ""}" data-group-id="${g.id}" type="button"><span>${escapeHtml(g.name)}</span><small>${g.membership.role === "admin" ? "管理者" : "参加中"}</small></button>`).join("");
  ws.innerHTML = `<section class="workspace-card"><div class="workspace-heading"><div><p class="eyebrow">ACTIVE GROUP</p><h2>${escapeHtml(group.name)}</h2></div><button id="createAnotherGroupButton" class="icon-text-button" type="button">＋ 作成</button></div><div class="invite-box"><div><p class="invite-label">招待コード</p><strong>${escapeHtml(group.invite_code)}</strong><p>このコードを仲間に送ってください。</p></div><button id="copyInviteCodeButton" class="secondary-button" data-code="${escapeHtml(group.invite_code)}" type="button">コピー</button></div><div class="group-summary-grid"><div><span>あなたの表示名</span><strong>${escapeHtml(group.membership.display_name)}</strong></div><div><span>権限</span><strong>${admin ? "管理者" : "メンバー"}</strong></div></div><section class="member-panel"><div class="member-panel-heading"><div><p class="eyebrow">MEMBERS</p><h3>対局メンバー</h3></div>${admin ? `<button id="addGuestMemberButton" class="secondary-button" type="button">＋ メンバーを追加</button>` : ""}</div><ul class="member-list">${rows}</ul></section>${userGroups.length > 1 ? `<section class="group-switcher"><p class="switcher-label">グループを切り替える</p><div class="group-choice-list">${choices}</div></section>` : ""}<div class="workspace-actions"><button id="openJoinGroupButton" class="secondary-button" type="button">招待コードで別グループに参加</button></div></section>`;
  document.getElementById("createAnotherGroupButton").addEventListener("click", () => openGroupModal("create")); document.getElementById("openJoinGroupButton").addEventListener("click", () => openGroupModal("join")); document.getElementById("addGuestMemberButton")?.addEventListener("click", openGuestMemberModal);
  document.getElementById("copyInviteCodeButton").addEventListener("click", async (e) => { const code = e.currentTarget.dataset.code; try { await navigator.clipboard.writeText(code); e.currentTarget.textContent = "コピー済み"; setTimeout(() => { e.currentTarget.textContent = "コピー"; }, 1500); } catch { window.prompt("招待コードをコピーしてください。", code); } });
  document.querySelectorAll("[data-remove-guest-member-id]").forEach((button) => button.addEventListener("click", async () => { if (!confirm("このゲストメンバーを削除しますか？")) return; try { markLocalRealtimeWrite(); const { error } = await supabaseClient.from("group_members").delete().eq("id", button.dataset.removeGuestMemberId).eq("group_id", activeGroupId).is("user_id", null); if (error) throw error; await loadActiveGroupMembers(); renderGroupWorkspace(); } catch (error) { alert(error.message || "メンバーを削除できませんでした。"); } }));
  document.querySelectorAll(".group-choice").forEach((button) => button.addEventListener("click", async () => { activeGroupId = button.dataset.groupId; localStorage.setItem("jakuroku-active-group-id", activeGroupId); activeMatchSessionId = null; localStorage.removeItem("jakuroku-active-match-session-id"); await loadActiveGroupMembers(); await setupRealtimeSubscriptions(); renderGroupWorkspace(); }));
}

function closeGroupModal() { document.querySelector(".group-overlay")?.remove(); }
function openGroupModal(mode) {
  closeGroupModal(); const create = mode === "create", name = getDisplayName(currentSession);
  document.body.insertAdjacentHTML("beforeend", `<div class="group-overlay"><section class="group-dialog" role="dialog" aria-modal="true"><button class="group-close-button" type="button">×</button><p class="eyebrow">${create ? "CREATE GROUP" : "JOIN GROUP"}</p><h2>${create ? "グループを作成" : "招待コードで参加"}</h2><form id="groupForm" class="auth-form">${create ? `<label>グループ名<input name="groupName" type="text" maxlength="60" required></label>` : `<label>招待コード<input name="inviteCode" type="text" maxlength="10" required></label>`}<label>このグループでの表示名<input name="displayName" type="text" maxlength="40" value="${escapeHtml(name)}" required></label><p id="groupMessage" class="auth-message"></p><button id="groupSubmitButton" class="auth-submit-button" type="submit">${create ? "グループを作成する" : "参加する"}</button></form></section></div>`);
  const overlay = document.querySelector(".group-overlay"), form = document.getElementById("groupForm"), message = document.getElementById("groupMessage"), submit = document.getElementById("groupSubmitButton"); document.querySelector(".group-close-button").addEventListener("click", closeGroupModal); overlay.addEventListener("click", (e) => { if (e.target === overlay) closeGroupModal(); });
  form.addEventListener("submit", async (e) => { e.preventDefault(); const fd = new FormData(form); submit.disabled = true; submit.textContent = "処理中..."; try { markLocalRealtimeWrite(); const result = create ? await supabaseClient.rpc("create_group", { p_group_name: String(fd.get("groupName") || "").trim(), p_owner_name: String(fd.get("displayName") || "").trim() }) : await supabaseClient.rpc("join_group_by_code", { p_invite_code: String(fd.get("inviteCode") || "").trim().toUpperCase(), p_display_name: String(fd.get("displayName") || "").trim() }); if (result.error) throw result.error; activeGroupId = result.data; localStorage.setItem("jakuroku-active-group-id", activeGroupId); closeGroupModal(); await loadGroups(); } catch (error) { message.textContent = error.message || "グループの処理に失敗しました。"; } finally { submit.disabled = false; submit.textContent = create ? "グループを作成する" : "参加する"; } });
}
function closeGuestMemberModal() { document.querySelector(".member-overlay")?.remove(); }
function openGuestMemberModal() {
  closeGuestMemberModal(); document.body.insertAdjacentHTML("beforeend", `<div class="member-overlay"><section class="member-dialog" role="dialog" aria-modal="true"><button class="member-close-button" type="button">×</button><p class="eyebrow">ADD MEMBER</p><h2>メンバーを追加</h2><form id="guestMemberForm" class="auth-form"><label>表示名<input name="displayName" type="text" maxlength="40" required></label><p id="guestMemberMessage" class="auth-message"></p><button id="guestMemberSubmitButton" class="auth-submit-button" type="submit">追加する</button></form></section></div>`);
  const overlay = document.querySelector(".member-overlay"), form = document.getElementById("guestMemberForm"), message = document.getElementById("guestMemberMessage"), submit = document.getElementById("guestMemberSubmitButton"); document.querySelector(".member-close-button").addEventListener("click", closeGuestMemberModal); overlay.addEventListener("click", (e) => { if (e.target === overlay) closeGuestMemberModal(); });
  form.addEventListener("submit", async (e) => { e.preventDefault(); const displayName = String(new FormData(form).get("displayName") || "").trim(); if (activeGroupMembers.some((m) => m.display_name.trim() === displayName)) { message.textContent = "同じ表示名のメンバーがすでにいます。"; return; } submit.disabled = true; try { markLocalRealtimeWrite(); const { error } = await supabaseClient.from("group_members").insert({ group_id: activeGroupId, user_id: null, display_name: displayName, role: "member" }); if (error) throw error; closeGuestMemberModal(); await loadActiveGroupMembers(); if (currentTab === "settings") renderSettingsPage(); else renderGroupWorkspace(); } catch (error) { message.textContent = error.message || "メンバーを追加できませんでした。"; } finally { submit.disabled = false; } });
}

async function loadMatchSessions() {
  const page = getPageWorkspace(); if (!currentSession || !activeGroupId) return renderMatchPage(); page.innerHTML = `<section class="workspace-card loading-card">日次記録を読み込み中...</section>`;
  try {
    const { data, error } = await supabaseClient.from("match_sessions").select("id, group_id, session_date, game_mode, rate_label, rate_multiplier, starting_points, chip_value, default_uma, tobi_enabled, venue_fee_total, notes, status, settled_at, created_at").eq("group_id", activeGroupId).is("deleted_at", null).order("session_date", { ascending: false }).order("created_at", { ascending: false }); if (error) throw error; sessionList = data || [];
    if (!sessionList.some((s) => s.id === activeMatchSessionId)) activeMatchSessionId = sessionList.find((s) => s.status === "open")?.id || sessionList[0]?.id || null;
    if (activeMatchSessionId) { localStorage.setItem("jakuroku-active-match-session-id", activeMatchSessionId); await loadActiveMatchSessionDetail(); }
    else { activeMatchSession = null; activeMatchMembers = []; activeHanchans = []; activeHanchanResults = []; activeTobiTransfers = []; activeSessionChips = []; activeYakumanRecords = []; activeVenuePrepayments = []; }
    renderMatchPage();
  } catch (error) { page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DAILY SESSION</p><h2>日次記録を読み込めませんでした</h2><p class="workspace-description">${escapeHtml(error.message || "通信状態を確認してください。")}</p><button id="retryLoadSessionsButton" class="primary-button" type="button">再読み込み</button></section>`; document.getElementById("retryLoadSessionsButton")?.addEventListener("click", loadMatchSessions); }
}
async function loadActiveMatchSessionDetail() {
  activeMatchSession = sessionList.find((s) => s.id === activeMatchSessionId) || null; if (!activeMatchSession) return;
  const { data: members, error: membersError } = await supabaseClient.from("match_session_members").select("session_id, member_id").eq("session_id", activeMatchSessionId); if (membersError) throw membersError; activeMatchMembers = members || [];
  const { data: hanchans, error: hanchansError } = await supabaseClient.from("match_hanchans").select("id, session_id, sequence_no, uma, notes, created_at").eq("session_id", activeMatchSessionId).order("sequence_no", { ascending: true }); if (hanchansError) throw hanchansError; activeHanchans = hanchans || [];
  const ids = activeHanchans.map((h) => h.id);
  if (ids.length) {
    const [results, transfers, yakumans] = await Promise.all([
      supabaseClient.from("match_hanchan_results").select("id, hanchan_id, member_id, rank, final_points, score_points, uma_points, tobi_points, total_points").in("hanchan_id", ids),
      supabaseClient.from("match_tobi_transfers").select("id, hanchan_id, from_member_id, to_member_id, points").in("hanchan_id", ids),
      supabaseClient.from("match_yakuman_records").select("id, hanchan_id, winner_member_id, yakuman_name, win_type, houjuu_member_id, created_at").in("hanchan_id", ids)
    ]);
    if (results.error) throw results.error; if (transfers.error) throw transfers.error; if (yakumans.error) throw yakumans.error;
    activeHanchanResults = results.data || []; activeTobiTransfers = transfers.data || []; activeYakumanRecords = yakumans.data || [];
  } else { activeHanchanResults = []; activeTobiTransfers = []; activeYakumanRecords = []; }
  const [chips, prepays] = await Promise.all([
    supabaseClient.from("match_session_chips").select("session_id, member_id, chip_count, updated_at").eq("session_id", activeMatchSessionId),
    supabaseClient.from("match_session_venue_prepayments").select("session_id, member_id, paid_molly, updated_at").eq("session_id", activeMatchSessionId)
  ]);
  if (chips.error) throw chips.error; if (prepays.error) throw prepays.error; activeSessionChips = chips.data || []; activeVenuePrepayments = prepays.data || [];
}

function getHanchanResults(id) { return activeHanchanResults.filter((r) => r.hanchan_id === id).sort((a,b) => a.rank - b.rank); }
function getHanchanTransfers(id) { return activeTobiTransfers.filter((t) => t.hanchan_id === id); }
function getHanchanYakumans(id) { return activeYakumanRecords.filter((y) => y.hanchan_id === id).sort((a,b) => a.created_at.localeCompare(b.created_at)); }
function getChipCount(id) { return num(activeSessionChips.find((c) => c.member_id === id)?.chip_count); }
function getVenuePrepayment(id) { return num(activeVenuePrepayments.find((p) => p.member_id === id)?.paid_molly); }
function hasAllChips() { return activeMatchMembers.length > 0 && activeSessionChips.length === activeMatchMembers.length; }
function getVenuePrepaymentTotal() { return activeVenuePrepayments.reduce((sum, p) => sum + num(p.paid_molly), 0); }
function hasMatchingVenuePrepayments() { return nearlyEqual(getVenuePrepaymentTotal(), num(activeMatchSession?.venue_fee_total)); }

function getVenueShares() {
  const total = num(activeMatchSession?.venue_fee_total), count = activeMatchMembers.length; if (!count) return {};
  const cents = Math.round(total * 100), base = Math.floor(cents / count), remainder = cents - base * count, result = {};
  activeMatchMembers.forEach((member, index) => { result[member.member_id] = (base + (index < remainder ? 1 : 0)) / 100; }); return result;
}
function getSessionTotals() {
  if (!activeMatchSession) return [];
  const rate = getSessionRateMultiplier(), shares = getVenueShares();
  return activeMatchMembers.map(({ member_id: memberId }) => {
    const hanchanTotal = activeHanchanResults.filter((r) => r.member_id === memberId).reduce((sum, r) => sum + num(r.total_points), 0);
    const chipCount = getChipCount(memberId), chipPoints = chipCount * num(activeMatchSession.chip_value), totalPoints = roundOne(hanchanTotal + chipPoints);
    const gameSettlementPt = totalPoints * rate, venueShare = num(shares[memberId]), prepaidSettlementPt = getVenuePrepayment(memberId), finalSettlementPt = gameSettlementPt - venueShare + prepaidSettlementPt;
    return { memberId, displayName: getMemberName(memberId), hanchanTotal: roundOne(hanchanTotal), chipCount, chipPoints: roundOne(chipPoints), totalPoints, gameSettlementPt, venueShare, prepaidSettlementPt, finalSettlementPt };
  });
}
function getPaymentRoutes(totals) {
  const debtors = totals.filter((t) => t.finalSettlementPt < -0.004).map((t) => ({ ...t, remaining: -t.finalSettlementPt })).sort((a,b) => b.remaining - a.remaining);
  const creditors = totals.filter((t) => t.finalSettlementPt > 0.004).map((t) => ({ ...t, remaining: t.finalSettlementPt })).sort((a,b) => b.remaining - a.remaining);
  const routes = [];
  let d = 0, c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].remaining, creditors[c].remaining);
    if (amount > 0.004) routes.push({
      from: debtors[d].displayName,
      to: creditors[c].displayName,
      fromMemberId: debtors[d].memberId,
      toMemberId: creditors[c].memberId,
      amount: roundTo(amount, 2)
    });
    debtors[d].remaining -= amount; creditors[c].remaining -= amount;
    if (debtors[d].remaining < 0.004) d += 1; if (creditors[c].remaining < 0.004) c += 1;
  }
  return routes;
}

function renderMatchPage() {
  const page = getPageWorkspace();
  if (!currentSession) { page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DAILY SESSION</p><h2>ログインが必要です</h2><button id="backHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`; document.getElementById("backHomeButton")?.addEventListener("click", () => switchTab("home")); return; }
  if (!getActiveGroup()) { page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DAILY SESSION</p><h2>先にグループを作成してください</h2><button id="backHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`; document.getElementById("backHomeButton")?.addEventListener("click", () => switchTab("home")); return; }
  if (showCreateSession || !activeMatchSession) return renderCreateSessionView(); renderActiveSessionView();
}

function renderCreateSessionView() {
  const page = getPageWorkspace(), preset = getModePreset(sessionDraft.gameMode);
  const memberChoices = activeGroupMembers.map((m) => `<label class="game-member-choice ${sessionDraft.memberIds.includes(m.id) ? "selected" : ""}"><input type="checkbox" data-session-member-id="${m.id}" ${sessionDraft.memberIds.includes(m.id) ? "checked" : ""}><span><strong>${escapeHtml(m.display_name)}</strong><small>${m.role === "admin" ? "管理者" : m.user_id ? "連携済み" : "ゲスト"}</small></span></label>`).join("");
  const umaInputs = sessionDraft.defaultUma.map((value, i) => `<label>${i+1}位<input type="number" step="0.1" data-session-uma-index="${i}" value="${value}"></label>`).join("");
  const rateOptions = RATE_PRESETS.map((item) => `<option value="${item.label}" ${sessionDraft.rateLabel === item.label ? "selected" : ""}>${item.label}${item.multiplier !== null ? `（収支1 = ${item.multiplier} pt）` : ""}</option>`).join("");
  page.innerHTML = `<section class="game-card"><div class="game-card-heading"><div><p class="eyebrow">NEW DAILY SESSION</p><h2>1日の麻雀会を作成</h2></div>${sessionList.length ? `<button id="backToSessionButton" class="icon-text-button" type="button">戻る</button>` : ""}</div><p class="game-description">ゲーム収支は1,000点単位で記録します。レートは「ゲーム収支1を何ptとして精算するか」を保存します。テンサンは収支1 = 30ptです。</p><form id="createSessionForm"><section class="game-section"><p class="game-section-title">対局形式</p><div class="mode-preset-grid">${Object.entries(MODE_PRESETS).map(([mode, option]) => `<button type="button" class="mode-preset-button ${sessionDraft.gameMode === mode ? "active" : ""}" data-session-mode="${mode}"><strong>${option.label}</strong><small>${option.playerCount}人・初期${option.startingPoints.toLocaleString()}点</small></button>`).join("")}</div></section><section class="game-section"><p class="game-section-title">基本設定</p><div class="game-settings-grid"><label>日付<input type="date" data-session-field="sessionDate" value="${sessionDraft.sessionDate}"></label><label>レート区分<select data-session-field="rateLabel">${rateOptions}</select></label><label>初期持ち点<input type="number" step="100" data-session-field="startingPoints" value="${sessionDraft.startingPoints}"></label><label>チップ単価（1枚あたり）<input type="number" min="0" step="0.1" data-session-field="chipValue" value="${sessionDraft.chipValue}"></label></div>${sessionDraft.rateLabel === "カスタム" ? `<div class="game-settings-grid custom-rate-grid"><label>カスタム名<input type="text" maxlength="40" data-session-field="customRateLabel" value="${escapeHtml(sessionDraft.customRateLabel)}" placeholder="例：特別レート"></label><label>レート倍率（pt / 収支1）<input type="number" min="0.01" max="10000" step="0.01" data-session-field="rateMultiplier" value="${sessionDraft.rateMultiplier}"></label></div>` : `<p class="selected-rate-note">選択中：<strong>収支1 = ${sessionDraft.rateMultiplier} pt</strong></p>`}<label class="toggle-row"><input type="checkbox" data-session-field="tobiEnabled" ${sessionDraft.tobiEnabled ? "checked" : ""}><span><strong>飛ばし点を使う</strong><small>飛ばした人・飛ばされた人ごとの移動を半荘ごとに記録します。</small></span></label></section><section class="game-section"><p class="game-section-title">基本ウマ</p><div class="uma-grid">${umaInputs}</div><p class="game-section-note">半荘ごとにも変更できます。</p></section><section class="game-section"><div class="game-section-heading"><p class="game-section-title">参加者を選択</p><span class="selection-counter">${sessionDraft.memberIds.length} / ${preset.playerCount}人</span></div><div class="game-member-grid">${memberChoices}</div></section><section class="game-section"><p class="game-section-title">メモ</p><textarea class="game-notes-input" rows="3" data-session-field="notes">${escapeHtml(sessionDraft.notes)}</textarea></section><p id="createSessionMessage" class="game-form-message"></p><button id="createSessionButton" class="save-game-button" type="submit">この日の記録を開始</button></form></section>`;
  document.getElementById("backToSessionButton")?.addEventListener("click", () => { showCreateSession = false; renderMatchPage(); });
  document.querySelectorAll("[data-session-mode]").forEach((button) => button.addEventListener("click", () => { const next = button.dataset.sessionMode, nextPreset = getModePreset(next), kept = sessionDraft.memberIds.slice(0, nextPreset.playerCount); sessionDraft = createDefaultSessionDraft(next); sessionDraft.memberIds = kept; renderCreateSessionView(); }));
  document.querySelectorAll("[data-session-field]").forEach((input) => { const ev = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input"; input.addEventListener(ev, () => { const field = input.dataset.sessionField; if (field === "tobiEnabled") { sessionDraft.tobiEnabled = input.checked; return; } if (["sessionDate", "rateLabel", "notes", "customRateLabel"].includes(field)) { sessionDraft[field] = input.value; if (field === "rateLabel") { const rate = getRatePreset(input.value); if (rate?.multiplier !== null) sessionDraft.rateMultiplier = rate.multiplier; renderCreateSessionView(); } return; } sessionDraft[field] = num(input.value); }); });
  document.querySelectorAll("[data-session-uma-index]").forEach((input) => input.addEventListener("input", () => { sessionDraft.defaultUma[Number(input.dataset.sessionUmaIndex)] = num(input.value); }));
  document.querySelectorAll("[data-session-member-id]").forEach((box) => box.addEventListener("change", () => { const id = box.dataset.sessionMemberId, limit = getModePreset(sessionDraft.gameMode).playerCount; if (box.checked) { if (sessionDraft.memberIds.length >= limit) { box.checked = false; alert(`${limit}人まで選択できます。`); return; } sessionDraft.memberIds.push(id); } else sessionDraft.memberIds = sessionDraft.memberIds.filter((x) => x !== id); renderCreateSessionView(); }));
  document.getElementById("createSessionForm").addEventListener("submit", createMatchSession);
}
async function createMatchSession(event) {
  event.preventDefault(); const message = document.getElementById("createSessionMessage"), submit = document.getElementById("createSessionButton"), preset = getModePreset(sessionDraft.gameMode);
  if (sessionDraft.memberIds.length !== preset.playerCount) { message.textContent = `参加者を${preset.playerCount}人選択してください。`; return; }
  if (sessionDraft.startingPoints <= 0 || sessionDraft.chipValue < 0 || sessionDraft.rateMultiplier <= 0 || sessionDraft.rateMultiplier > 10000) { message.textContent = "初期持ち点・チップ単価・レート倍率（pt / 収支1）を確認してください。"; return; }
  const rateLabel = sessionDraft.rateLabel === "カスタム" ? sessionDraft.customRateLabel.trim() : sessionDraft.rateLabel; if (!rateLabel) { message.textContent = "カスタム名を入力してください。"; return; }
  submit.disabled = true; submit.textContent = "作成中..."; message.textContent = "";
  try { markLocalRealtimeWrite(); const { data, error } = await supabaseClient.rpc("create_match_session", { p_group_id: activeGroupId, p_session_date: sessionDraft.sessionDate, p_game_mode: sessionDraft.gameMode, p_rate_label: rateLabel, p_rate_multiplier: num(sessionDraft.rateMultiplier), p_starting_points: num(sessionDraft.startingPoints), p_chip_value: num(sessionDraft.chipValue), p_default_uma: sessionDraft.defaultUma.map(num), p_tobi_enabled: sessionDraft.tobiEnabled, p_member_ids: sessionDraft.memberIds, p_notes: sessionDraft.notes }); if (error) throw error; activeMatchSessionId = data; localStorage.setItem("jakuroku-active-match-session-id", data); resetMatchViewState(); gameMessage = "この日の記録を開始しました。"; await loadMatchSessions(); }
  catch (error) { message.textContent = error.message || "日次セッションを作成できませんでした。"; }
  finally { submit.disabled = false; submit.textContent = "この日の記録を開始"; }
}


function renderActiveSessionView() {
  const page = getPageWorkspace();
  const session = activeMatchSession;
  if (!session) return renderMatchPage();

  const totals = getSessionTotals();
  const gameScoreSum = totals.reduce((sum, item) => sum + item.totalPoints, 0);
  const gameSettlementPtSum = totals.reduce((sum, item) => sum + item.gameSettlementPt, 0);
  const finalSettlementPtSum = totals.reduce((sum, item) => sum + item.finalSettlementPt, 0);
  const fee = num(session.venue_fee_total);
  const prepaidTotal = getVenuePrepaymentTotal();
  const venueReady = hasMatchingVenuePrepayments();
  const routes = getPaymentRoutes(totals);

  const sessionOptions = sessionList.map((item) => `
    <option value="${item.id}" ${item.id === session.id ? "selected" : ""}>
      ${formatDate(item.session_date)} / ${getModeLabel(item.game_mode)} / ${item.status === "settled" ? "精算済み" : "進行中"}
    </option>
  `).join("");

  const hanchanCards = activeHanchans.length
    ? activeHanchans.map((hanchan) => {
        const results = getHanchanResults(hanchan.id);
        const transfers = getHanchanTransfers(hanchan.id);
        const yakumans = getHanchanYakumans(hanchan.id);
        const resultRows = results.map((result) => `
          <div class="history-result-row">
            <span>${result.rank}位 ${escapeHtml(getMemberName(result.member_id))}</span>
            <strong>${formatScoreMarkup(result.total_points)}</strong>
          </div>
        `).join("");
        const transferText = transfers.length
          ? transfers.map((transfer) => `${escapeHtml(getMemberName(transfer.from_member_id))} → ${escapeHtml(getMemberName(transfer.to_member_id))} ${formatScore(transfer.points)}`).join(" / ")
          : "飛ばし点なし";
        const yakumanRows = yakumans.map((record) => `
          <div class="yakuman-history-row">
            <strong>${escapeHtml(getMemberName(record.winner_member_id))}</strong>
            <span>${escapeHtml(record.yakuman_name)}</span>
            <small>${record.win_type === "tsumo" ? "ツモ" : `ロン：${escapeHtml(getMemberName(record.houjuu_member_id))}`}</small>
          </div>
        `).join("");
        return `
          <article class="hanchan-history-card">
            <div class="hanchan-history-heading">
              <div><strong>第${hanchan.sequence_no}半荘</strong><small>ウマ：${hanchan.uma.join(" / ")}</small></div>
              <div class="record-action-list">
                <button type="button" class="record-edit-button" data-edit-hanchan-id="${hanchan.id}">編集</button>
                ${session.status === "open" ? `<button type="button" class="record-delete-button" data-delete-hanchan-id="${hanchan.id}">削除</button>` : ""}
              </div>
            </div>
            <div class="history-result-list">${resultRows}</div>
            <p class="history-transfer-note">${transferText}</p>
            ${yakumanRows ? `<section class="yakuman-history-list"><p>役満記録</p>${yakumanRows}</section>` : ""}
            ${hanchan.notes ? `<p class="history-note">${escapeHtml(hanchan.notes)}</p>` : ""}
          </article>
        `;
      }).join("")
    : `<div class="game-empty-result">まだ半荘が登録されていません。</div>`;

  const scoreRows = totals.map((item) => `
    <div class="daily-total-row">
      <span>${escapeHtml(item.displayName)}</span>
      <div>
        <strong>${formatScoreMarkup(item.totalPoints)}</strong>
        <small>半荘 ${formatScoreMarkup(item.hanchanTotal)} ／ チップ ${formatScoreMarkup(item.chipPoints)}</small>
      </div>
    </div>
  `).join("");

  const settlementRows = totals.map((item) => `
    <div class="settlement-pt-result-row">
      <span>${escapeHtml(item.displayName)}</span>
      <div>
        <strong>${formatPtMarkup(item.gameSettlementPt)}</strong>
        <small>${formatScore(item.totalPoints)} × ${session.rate_multiplier}倍</small>
      </div>
    </div>
  `).join("");

  const finalRows = totals.map((item) => `
    <div class="final-settlement-row">
      <span>${escapeHtml(item.displayName)}</span>
      <div class="settlement-breakdown">
        <small>ゲーム ${formatPt(item.gameSettlementPt)} ／ 場代負担 -${formatPtPlain(item.venueShare)} ／ 先払い +${formatPtPlain(item.prepaidSettlementPt)}</small>
        <strong>${formatPtMarkup(item.finalSettlementPt)}</strong>
      </div>
    </div>
  `).join("");

  const routeRows = routes.length
    ? routes.map((route, index) => `
      <div class="payment-route-row payment-route-debt-row">
        <span>${escapeHtml(route.from)} <b>→</b> ${escapeHtml(route.to)}</span>
        <div><strong>${formatPtPlain(route.amount)}</strong>${session.status === "settled" ? `<button type="button" class="route-debt-button" data-register-route-index="${index}">借ptへ登録</button>` : ""}</div>
      </div>
    `).join("")
    : `<p class="game-section-note">送金は不要です。</p>`;

  page.innerHTML = `
    <section class="game-card">
      <div class="game-card-heading">
        <div><p class="eyebrow">DAILY SESSION</p><h2>${formatDate(session.session_date)}の麻雀会</h2></div>
        <span class="session-status ${session.status}">${session.status === "settled" ? "精算済み" : "進行中"}</span>
      </div>
      <div class="session-selector-row">
        <select id="sessionSelect" class="session-select">${sessionOptions}</select>
        <button id="newSessionButton" class="secondary-button" type="button">＋ 新しい日</button>
        <button id="deleteSessionButton" class="danger-outline-button" type="button">この日を削除</button>
      </div>
      <div class="session-info-grid">
        <div><span>形式</span><strong>${getModeLabel(session.game_mode)}</strong></div>
        <div><span>レート</span><strong>${escapeHtml(session.rate_label)}（収支1 = ${session.rate_multiplier} pt）</strong></div>
        <div><span>初期持ち点</span><strong>${Number(session.starting_points).toLocaleString()}点</strong></div>
        <div><span>チップ単価</span><strong>${session.chip_value} / 枚</strong></div>
      </div>
      ${gameMessage ? `<p class="game-success-message">${escapeHtml(gameMessage)}</p>` : ""}

      <section class="game-section">
        <div class="game-section-heading">
          <p class="game-section-title">半荘記録</p>
          ${session.status === "open"
            ? `<button id="toggleHanchanEditorButton" class="secondary-button" type="button">${showHanchanEditor ? "入力を閉じる" : "＋ 半荘を追加"}</button>`
            : showHanchanEditor
              ? `<button id="toggleHanchanEditorButton" class="secondary-button" type="button">編集を閉じる</button>`
              : ""}
        </div>
        <div class="hanchan-history-list">${hanchanCards}</div>
      </section>
      ${showHanchanEditor ? renderHanchanEditor() : ""}

      <section class="game-section">
        <div class="game-section-heading">
          <p class="game-section-title">終了時チップ</p>
          <button id="toggleChipEditorButton" class="secondary-button" type="button">${showChipEditor ? "入力を閉じる" : activeSessionChips.length ? "チップを編集" : "チップを入力"}</button>
        </div>
        ${activeSessionChips.length ? `<div class="chip-summary-list">${activeMatchMembers.map((member) => `<div class="chip-summary-row"><span>${escapeHtml(getMemberName(member.member_id))}</span><strong>${formatChipMarkup(getChipCount(member.member_id))}</strong></div>`).join("")}</div>` : `<p class="game-section-note">チップは麻雀会が終わるタイミングで、全員分をまとめて入力します。</p>`}
      </section>
      ${showChipEditor ? renderChipEditor() : ""}

      <section class="game-section">
        <p class="game-section-title">ゲーム収支</p>
        <div class="daily-total-list">${scoreRows}</div>
        <div class="daily-total-footer"><span>合計</span><strong>${formatScoreMarkup(gameScoreSum)}</strong></div>
      </section>

      <section class="game-section settlement-pt-section">
        <div class="game-section-heading"><p class="game-section-title">ゲーム収支のレート換算（pt）</p><span class="settlement-rate-badge">収支1 = ${session.rate_multiplier} pt</span></div>
        <p class="game-section-note">ゲーム収支合計にこの日のレート倍率を掛けた結果です。</p>
        <div class="settlement-pt-result-list">${settlementRows}</div>
        <div class="daily-total-footer"><span>ゲーム換算pt合計</span><strong>${formatPtMarkup(gameSettlementPtSum)}</strong></div>
      </section>

      <section class="game-section">
        <div class="game-section-heading"><p class="game-section-title">場代精算</p><button id="toggleVenueEditorButton" class="secondary-button" type="button">${showVenueEditor ? "入力を閉じる" : fee > 0 || activeVenuePrepayments.length ? "場代を編集" : "場代を入力"}</button></div>
        <div class="venue-summary-box">
          <div><span>場代合計</span><strong>${formatPtPlain(fee)}</strong></div>
          <div><span>先払い合計</span><strong>${formatPtPlain(prepaidTotal)}</strong></div>
          <div><span>照合</span><strong class="${venueReady ? "status-ok" : "status-error"}">${venueReady ? "一致" : "不一致"}</strong></div>
        </div>
        <p class="game-section-note">場代は参加者で均等負担します。先払いは複数人・一部払いに対応します。</p>
      </section>
      ${showVenueEditor ? renderVenueEditor() : ""}

      <section class="game-section final-settlement-section">
        <p class="game-section-title">場代込み最終精算</p>
        <div class="final-settlement-list">${finalRows}</div>
        <div class="daily-total-footer"><span>最終pt合計</span><strong>${formatPtMarkup(finalSettlementPtSum)}</strong></div>
        <div class="payment-route-box"><p>送金ルート（相殺済み）</p>${venueReady ? routeRows : `<p class="game-section-note">場代合計と先払い合計を一致させると、送金ルートを表示します。</p>`}</div>
        ${session.status === "open" ? `<button id="settleSessionButton" class="save-game-button" type="button">1日の精算を確定</button><p class="game-section-note">半荘・終了時チップ・場代を確認してから確定してください。確定後も必要に応じて編集できます。</p>` : `<p class="settled-note">この麻雀会は精算済みです。半荘・チップ・場代を編集すると、通算集計も自動で更新されます。</p>`}
      </section>
    </section>
  `;

  document.getElementById("sessionSelect").addEventListener("change", async (event) => {
    activeMatchSessionId = event.target.value;
    localStorage.setItem("jakuroku-active-match-session-id", activeMatchSessionId);
    resetMatchViewState();
    await loadMatchSessions();
  });
  document.getElementById("newSessionButton").addEventListener("click", () => {
    resetMatchViewState();
    sessionDraft = createDefaultSessionDraft("sanma");
    showCreateSession = true;
    renderMatchPage();
  });
  document.getElementById("deleteSessionButton").addEventListener("click", deleteActiveMatchSession);
  document.getElementById("toggleHanchanEditorButton")?.addEventListener("click", () => {
    if (showHanchanEditor) {
      showHanchanEditor = false;
      editingHanchanId = null;
      hanchanDraft = null;
    } else {
      editingHanchanId = null;
      hanchanDraft = createDefaultHanchanDraft();
      showHanchanEditor = true;
    }
    renderActiveSessionView();
  });
  document.getElementById("toggleChipEditorButton")?.addEventListener("click", () => {
    showChipEditor = !showChipEditor;
    if (showChipEditor) {
      chipDraft = {};
      activeMatchMembers.forEach((member) => { chipDraft[member.member_id] = getChipCount(member.member_id); });
    }
    renderActiveSessionView();
  });
  document.getElementById("toggleVenueEditorButton")?.addEventListener("click", () => {
    showVenueEditor = !showVenueEditor;
    if (showVenueEditor) {
      venueDraft = { total: fee, prepayments: {} };
      activeMatchMembers.forEach((member) => { venueDraft.prepayments[member.member_id] = getVenuePrepayment(member.member_id); });
    }
    renderActiveSessionView();
  });
  document.getElementById("settleSessionButton")?.addEventListener("click", settleMatchSession);
  document.querySelectorAll("[data-register-route-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = routes[Number(button.dataset.registerRouteIndex)];
      if (route) void openSettlementDebtModal(route);
    });
  });
  document.querySelectorAll("[data-edit-hanchan-id]").forEach((button) => {
    button.addEventListener("click", () => startEditHanchan(button.dataset.editHanchanId));
  });
  document.querySelectorAll("[data-delete-hanchan-id]").forEach((button) => {
    button.addEventListener("click", () => deleteMatchHanchan(button.dataset.deleteHanchanId));
  });
  bindHanchanEditorEvents();
  bindChipEditorEvents();
  bindVenueEditorEvents();
}

function hasEnteredFinalPoints(memberId) { const raw = hanchanDraft?.results?.[memberId]?.finalPoints; return raw !== "" && raw !== null && raw !== undefined && Number.isInteger(Number(raw)); }
function getDraftPointBalance() {
  if (!hanchanDraft || !activeMatchSession) return { expected: 0, total: 0, enteredCount: 0, difference: null, complete: false };
  const expected = num(activeMatchSession.starting_points) * activeMatchMembers.length, entered = activeMatchMembers.filter((m) => hasEnteredFinalPoints(m.member_id)), total = entered.reduce((s,m) => s + Number(hanchanDraft.results[m.member_id].finalPoints), 0), complete = entered.length === activeMatchMembers.length;
  return { expected, total, enteredCount: entered.length, difference: complete ? total - expected : null, complete };
}
function applyAutoFinalPoints() {
  if (!hanchanDraft || !activeMatchSession) return;
  activeMatchMembers.forEach((m) => { const r = hanchanDraft.results[m.member_id]; if (r.pointMode === "auto") { r.finalPoints = ""; r.pointMode = "manual"; } });
  const entered = activeMatchMembers.filter((m) => hasEnteredFinalPoints(m.member_id)); if (entered.length !== activeMatchMembers.length - 1) return;
  const target = activeMatchMembers.find((m) => !hasEnteredFinalPoints(m.member_id)); if (!target) return;
  const expected = num(activeMatchSession.starting_points) * activeMatchMembers.length, used = entered.reduce((s,m) => s + Number(hanchanDraft.results[m.member_id].finalPoints), 0);
  hanchanDraft.results[target.member_id].finalPoints = expected - used; hanchanDraft.results[target.member_id].pointMode = "auto";
}
function calculateDraftHanchanResult(memberId) {
  const r = hanchanDraft.results[memberId]; if (!hasEnteredFinalPoints(memberId)) return { scorePoints: null, umaPoints: null, tobiPoints: null, totalPoints: null };
  const score = roundOne((Number(r.finalPoints) - num(activeMatchSession.starting_points)) / 1000), uma = num(hanchanDraft.uma[Number(r.rank) - 1]), tobi = roundOne(hanchanDraft.tobiTransfers.reduce((s,t) => s + (t.toMemberId === memberId ? num(t.points) : 0) - (t.fromMemberId === memberId ? num(t.points) : 0), 0));
  return { scorePoints: score, umaPoints: uma, tobiPoints: tobi, totalPoints: roundOne(score + uma + tobi) };
}
function renderHanchanEditor() {
  if (!hanchanDraft) hanchanDraft = createDefaultHanchanDraft();
  const editing = getEditingHanchan();
  const isEditing = Boolean(editingHanchanId && editing);
  const no = isEditing ? editing.sequence_no : activeHanchans.length + 1;
  const balance = getDraftPointBalance();
  const uma = hanchanDraft.uma.map((v,i) => `<label>${i+1}位<input type="number" step="0.1" data-hanchan-uma-index="${i}" value="${v}"></label>`).join("");
  const cards = activeMatchMembers.map((m) => { const r = hanchanDraft.results[m.member_id], c = calculateDraftHanchanResult(m.member_id), options = Array.from({ length: activeMatchMembers.length }, (_,i) => `<option value="${i+1}" ${Number(r.rank) === i+1 ? "selected" : ""}>${i+1}位</option>`).join(""); return `<article class="result-entry-card"><div class="result-entry-header"><strong>${escapeHtml(getMemberName(m.member_id))}</strong><span data-hanchan-total-member-id="${m.member_id}">${formatScoreMarkup(c.totalPoints)}</span></div><div class="result-input-grid"><label>順位<select data-hanchan-result-member-id="${m.member_id}" data-hanchan-result-field="rank">${options}</select></label><label>最終持ち点<input class="signed-number-input ${inputValueClass(r.finalPoints)}" type="number" step="100" data-hanchan-result-member-id="${m.member_id}" data-hanchan-result-field="finalPoints" data-hanchan-point-input-id="${m.member_id}" value="${escapeHtml(r.finalPoints)}" placeholder="例：35000 / -1000"><small class="point-mode-badge ${r.pointMode === "auto" ? "auto" : ""}" data-hanchan-point-mode-id="${m.member_id}">${r.pointMode === "auto" ? "自動計算" : "手入力"}</small></label></div><p class="result-breakdown" data-hanchan-breakdown-member-id="${m.member_id}">素点 ${formatScoreMarkup(c.scorePoints)} ／ ウマ ${formatScoreMarkup(c.umaPoints)} ／ 飛ばし点 ${formatScoreMarkup(c.tobiPoints)}</p></article>`; }).join("");
  const transfers = hanchanDraft.tobiTransfers.map((t,i) => `<div class="tobi-transfer-row"><label>飛ばされた人<select data-tobi-index="${i}" data-tobi-field="fromMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${t.fromMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label><label>飛ばした人<select data-tobi-index="${i}" data-tobi-field="toMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${t.toMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label><label>移動量<input type="number" min="0.1" step="0.1" value="${t.points}" data-tobi-index="${i}" data-tobi-field="points"></label><button type="button" class="remove-transfer-button" data-remove-tobi-index="${i}">削除</button></div>`).join("");
  const yakumans = hanchanDraft.yakumanRecords.map((r,i) => `<article class="yakuman-entry-card"><div class="yakuman-entry-heading"><strong>役満 ${i+1}</strong><button type="button" class="remove-transfer-button" data-remove-yakuman-index="${i}">削除</button></div><div class="yakuman-entry-grid"><label>役満<select data-yakuman-index="${i}" data-yakuman-field="yakumanName">${YAKUMAN_OPTIONS.map((name) => `<option value="${name}" ${r.yakumanName === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>${r.yakumanName === "その他" ? `<label>役満名<input type="text" maxlength="60" value="${escapeHtml(r.customName)}" data-yakuman-index="${i}" data-yakuman-field="customName"></label>` : ""}<label>あがった人<select data-yakuman-index="${i}" data-yakuman-field="winnerMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${r.winnerMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label><label>あがり方<select data-yakuman-index="${i}" data-yakuman-field="winType"><option value="tsumo" ${r.winType === "tsumo" ? "selected" : ""}>ツモ</option><option value="ron" ${r.winType === "ron" ? "selected" : ""}>ロン</option></select></label>${r.winType === "ron" ? `<label>放銃者<select data-yakuman-index="${i}" data-yakuman-field="houjuuMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${r.houjuuMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label>` : ""}</div></article>`).join("");
  const balanceText = balance.complete ? balance.difference === 0 ? `最終持ち点合計：${balance.total.toLocaleString()}点 / 一致` : `最終持ち点合計：${balance.total.toLocaleString()}点 / 差額 ${balance.difference > 0 ? "+" : ""}${balance.difference.toLocaleString()}点` : `最終持ち点入力：${balance.enteredCount} / ${activeMatchMembers.length}人`;
  return `<section class="hanchan-editor"><div class="editor-heading"><div><p class="eyebrow">${isEditing ? "EDIT HANCHAN" : "ADD HANCHAN"}</p><h3>第${no}半荘を${isEditing ? "編集" : "登録"}</h3></div></div><form id="hanchanForm"><section class="game-section"><p class="game-section-title">この半荘のウマ</p><div class="uma-grid">${uma}</div></section><section class="game-section"><p class="game-section-title">最終持ち点・順位</p><p id="hanchanPointBalance" class="point-balance ${balance.complete && balance.difference !== 0 ? "error" : ""}">${balanceText}</p><p class="game-section-note">参加人数−1人分を入力すると、残り1人を自動計算します。マイナス持ち点も入力できます。</p><div class="result-entry-list">${cards}</div></section>${activeMatchSession.tobi_enabled ? `<section class="game-section"><div class="game-section-heading"><p class="game-section-title">飛ばし点</p><div class="inline-button-group"><button id="addTobiTenButton" class="secondary-button" type="button">＋ 10移動</button><button id="addTobiFiveButton" class="secondary-button" type="button">＋ 5移動</button></div></div><p class="game-section-note">1人飛ばしは10の移動を1件。ダブロンは飛ばされた人から各人へ5ずつの移動を2件追加します。</p><div class="tobi-transfer-list">${transfers || `<p class="game-section-note">飛ばし点なし</p>`}</div></section>` : ""}<section class="game-section"><div class="game-section-heading"><p class="game-section-title">役満記録</p><button id="addYakumanButton" class="secondary-button" type="button">＋ 役満を追加</button></div><p class="game-section-note">数え役満、流し役満、四華和、パッチリ、その他も記録できます。</p><div class="yakuman-entry-list">${yakumans || `<p class="game-section-note">役満記録なし</p>`}</div></section><section class="game-section"><p class="game-section-title">メモ</p><textarea class="game-notes-input" rows="2" data-hanchan-note>${escapeHtml(hanchanDraft.notes)}</textarea></section><section id="hanchanPreview" class="game-preview"></section><p id="hanchanFormMessage" class="game-form-message"></p><button id="saveHanchanButton" class="save-game-button" type="submit">${isEditing ? `第${no}半荘の変更を保存` : `第${no}半荘を登録`}</button></form></section>`;
}
function bindHanchanEditorEvents() {
  const form = document.getElementById("hanchanForm"); if (!form || !hanchanDraft) return;
  document.querySelectorAll("[data-hanchan-uma-index]").forEach((input) => input.addEventListener("input", () => { hanchanDraft.uma[Number(input.dataset.hanchanUmaIndex)] = num(input.value); refreshHanchanPreview(); refreshAllHanchanCards(); }));
  document.querySelectorAll("[data-hanchan-result-field]").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { const id = input.dataset.hanchanResultMemberId, field = input.dataset.hanchanResultField; if (field === "finalPoints") { hanchanDraft.results[id].finalPoints = input.value; hanchanDraft.results[id].pointMode = "manual"; applySignedInputClass(input); applyAutoFinalPoints(); syncAutoPointInputs(); } else hanchanDraft.results[id][field] = num(input.value); refreshHanchanPreview(); refreshAllHanchanCards(); refreshPointBalance(); }));
  document.querySelectorAll("[data-tobi-field]").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { const t = hanchanDraft.tobiTransfers[Number(input.dataset.tobiIndex)], field = input.dataset.tobiField; t[field] = field === "points" ? num(input.value) : input.value; refreshHanchanPreview(); refreshAllHanchanCards(); }));
  document.getElementById("addTobiTenButton")?.addEventListener("click", () => { hanchanDraft.tobiTransfers.push({ fromMemberId: "", toMemberId: "", points: 10 }); renderActiveSessionView(); }); document.getElementById("addTobiFiveButton")?.addEventListener("click", () => { hanchanDraft.tobiTransfers.push({ fromMemberId: "", toMemberId: "", points: 5 }); renderActiveSessionView(); });
  document.querySelectorAll("[data-remove-tobi-index]").forEach((button) => button.addEventListener("click", () => { hanchanDraft.tobiTransfers.splice(Number(button.dataset.removeTobiIndex), 1); renderActiveSessionView(); }));
  document.getElementById("addYakumanButton")?.addEventListener("click", () => { hanchanDraft.yakumanRecords.push(createEmptyYakumanRecord()); renderActiveSessionView(); }); document.querySelectorAll("[data-remove-yakuman-index]").forEach((button) => button.addEventListener("click", () => { hanchanDraft.yakumanRecords.splice(Number(button.dataset.removeYakumanIndex), 1); renderActiveSessionView(); }));
  document.querySelectorAll("[data-yakuman-field]").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { const r = hanchanDraft.yakumanRecords[Number(input.dataset.yakumanIndex)], field = input.dataset.yakumanField; r[field] = input.value; if (field === "winType" && input.value === "tsumo") r.houjuuMemberId = ""; if (field === "yakumanName" || field === "winType") renderActiveSessionView(); }));
  document.querySelector("[data-hanchan-note]")?.addEventListener("input", (e) => hanchanDraft.notes = e.target.value); form.addEventListener("submit", addMatchHanchan); refreshHanchanPreview(); refreshPointBalance();
}
function syncAutoPointInputs() { activeMatchMembers.forEach((m) => { const r = hanchanDraft.results[m.member_id], input = document.querySelector(`[data-hanchan-point-input-id="${m.member_id}"]`), badge = document.querySelector(`[data-hanchan-point-mode-id="${m.member_id}"]`); if (input) { input.value = r.finalPoints; applySignedInputClass(input, r.finalPoints); } if (badge) { badge.textContent = r.pointMode === "auto" ? "自動計算" : "手入力"; badge.classList.toggle("auto", r.pointMode === "auto"); } }); }
function refreshPointBalance() { const el = document.getElementById("hanchanPointBalance"); if (!el) return; const b = getDraftPointBalance(); el.textContent = b.complete ? b.difference === 0 ? `最終持ち点合計：${b.total.toLocaleString()}点 / 一致` : `最終持ち点合計：${b.total.toLocaleString()}点 / 差額 ${b.difference > 0 ? "+" : ""}${b.difference.toLocaleString()}点` : `最終持ち点入力：${b.enteredCount} / ${activeMatchMembers.length}人`; el.classList.toggle("error", b.complete && b.difference !== 0); }
function refreshAllHanchanCards() { activeMatchMembers.forEach((m) => refreshHanchanMemberCard(m.member_id)); }
function refreshHanchanMemberCard(id) {
  const total = document.querySelector(`[data-hanchan-total-member-id="${id}"]`);
  const detail = document.querySelector(`[data-hanchan-breakdown-member-id="${id}"]`);
  if (!total || !detail) return;
  const calculated = calculateDraftHanchanResult(id);
  total.innerHTML = formatScoreMarkup(calculated.totalPoints);
  detail.innerHTML = `素点 ${formatScoreMarkup(calculated.scorePoints)} ／ ウマ ${formatScoreMarkup(calculated.umaPoints)} ／ 飛ばし点 ${formatScoreMarkup(calculated.tobiPoints)}`;
}
function refreshHanchanPreview() {
  const box = document.getElementById("hanchanPreview");
  if (!box || !hanchanDraft) return;
  const complete = activeMatchMembers.every((member) => hasEnteredFinalPoints(member.member_id));
  const total = complete ? activeMatchMembers.reduce((sum, member) => sum + calculateDraftHanchanResult(member.member_id).totalPoints, 0) : null;
  box.innerHTML = `<p class="game-preview-title">この半荘の収支プレビュー</p><div class="preview-list">${activeMatchMembers.map((member) => `<div class="preview-row"><span>${escapeHtml(getMemberName(member.member_id))}</span><strong>${formatScoreMarkup(calculateDraftHanchanResult(member.member_id).totalPoints)}</strong></div>`).join("")}</div><div class="preview-footer"><span>合計</span><strong>${formatScoreMarkup(total)}</strong></div>`;
}
function validateYakumans() { for (const r of hanchanDraft.yakumanRecords) { const name = getYakumanDisplayName(r); if (!name || name.length > 60) return "役満名を正しく入力してください。"; if (!r.winnerMemberId) return "役満のあがった人を選択してください。"; if (r.winType === "ron" && (!r.houjuuMemberId || r.houjuuMemberId === r.winnerMemberId)) return "ロン役満の放銃者を正しく選択してください。"; } return null; }
async function addMatchHanchan(e) {
  e.preventDefault();
  const message = document.getElementById("hanchanFormMessage");
  const submit = document.getElementById("saveHanchanButton");
  const isEditing = Boolean(editingHanchanId);
  const ranks = activeMatchMembers.map((m) => num(hanchanDraft.results[m.member_id].rank));

  if (new Set(ranks).size !== activeMatchMembers.length) {
    message.textContent = "順位が重複しています。";
    return;
  }
  if (!activeMatchMembers.every((m) => hasEnteredFinalPoints(m.member_id))) {
    message.textContent = "全員の最終持ち点を入力してください。";
    return;
  }
  if (getDraftPointBalance().difference !== 0) {
    message.textContent = "最終持ち点合計が開始時の総点数と一致していません。";
    return;
  }
  if (hanchanDraft.tobiTransfers.some((t) => !t.fromMemberId || !t.toMemberId || t.fromMemberId === t.toMemberId || num(t.points) <= 0)) {
    message.textContent = "飛ばし点の内容を確認してください。";
    return;
  }

  const yakumanError = validateYakumans();
  if (yakumanError) {
    message.textContent = yakumanError;
    return;
  }

  const payload = {
    p_uma: hanchanDraft.uma.map(num),
    p_results: activeMatchMembers.map((m) => ({
      member_id: m.member_id,
      rank: num(hanchanDraft.results[m.member_id].rank),
      final_points: Number(hanchanDraft.results[m.member_id].finalPoints)
    })),
    p_tobi_transfers: hanchanDraft.tobiTransfers.map((t) => ({
      from_member_id: t.fromMemberId,
      to_member_id: t.toMemberId,
      points: num(t.points)
    })),
    p_notes: hanchanDraft.notes,
    p_yakuman_records: hanchanDraft.yakumanRecords.map((r) => ({
      winner_member_id: r.winnerMemberId,
      yakuman_name: getYakumanDisplayName(r),
      win_type: r.winType,
      houjuu_member_id: r.winType === "ron" ? r.houjuuMemberId : null
    }))
  };

  submit.disabled = true;
  submit.textContent = isEditing ? "保存中..." : "登録中...";

  try {
    markLocalRealtimeWrite();
    const response = isEditing
      ? await supabaseClient.rpc("update_match_hanchan", {
          p_hanchan_id: editingHanchanId,
          ...payload
        })
      : await supabaseClient.rpc("add_match_hanchan", {
          p_session_id: activeMatchSessionId,
          ...payload
        });

    if (response.error) throw response.error;

    gameMessage = isEditing
      ? `第${getEditingHanchan()?.sequence_no || ""}半荘を更新しました。`
      : `第${activeHanchans.length + 1}半荘を登録しました。`;

    showHanchanEditor = false;
    editingHanchanId = null;
    hanchanDraft = null;
    await loadMatchSessions();
  } catch (error) {
    message.textContent = error.message || (isEditing ? "半荘を更新できませんでした。" : "半荘を登録できませんでした。");
  } finally {
    submit.disabled = false;
    submit.textContent = isEditing ? "変更を保存" : "半荘を登録";
  }
}

function renderChipEditor() { return `<section class="chip-editor"><form id="chipForm"><p class="game-section-note">その日の麻雀会を終える時点での最終チップ差分を入力します。合計は0枚にしてください。</p><div class="chip-input-list">${activeMatchMembers.map((m) => `<label class="chip-input-row"><span>${escapeHtml(getMemberName(m.member_id))}</span><input class="signed-number-input ${inputValueClass(chipDraft[m.member_id] ?? 0)}" type="number" step="0.5" value="${chipDraft[m.member_id] ?? 0}" data-chip-member-id="${m.member_id}"><small>枚</small></label>`).join("")}</div><p id="chipBalanceMessage" class="game-form-message"></p><button id="saveChipButton" class="save-game-button" type="submit">終了時チップを保存</button></form></section>`; }
function bindChipEditorEvents() { const form = document.getElementById("chipForm"); if (!form) return; document.querySelectorAll("[data-chip-member-id]").forEach((input) => input.addEventListener("input", () => { chipDraft[input.dataset.chipMemberId] = num(input.value); applySignedInputClass(input); refreshChipBalance(); })); form.addEventListener("submit", saveSessionChips); refreshChipBalance(); }
function refreshChipBalance() { const el = document.getElementById("chipBalanceMessage"); if (!el) return; const sum = roundOne(activeMatchMembers.reduce((s,m) => s + num(chipDraft[m.member_id]), 0)); el.textContent = nearlyEqual(sum, 0) ? "チップ合計：0枚" : `チップ合計：${sum > 0 ? "+" : ""}${sum}枚。全員の合計が0枚になるよう調整してください。`; }
async function saveSessionChips(e) { e.preventDefault(); const message = document.getElementById("chipBalanceMessage"), submit = document.getElementById("saveChipButton"), total = roundOne(activeMatchMembers.reduce((s,m) => s + num(chipDraft[m.member_id]), 0)); if (!nearlyEqual(total, 0)) { message.textContent = "チップ合計が0枚になっていません。"; return; } submit.disabled = true; try { markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("set_match_session_chips", { p_session_id: activeMatchSessionId, p_chip_results: activeMatchMembers.map((m) => ({ member_id: m.member_id, chip_count: num(chipDraft[m.member_id]) })) }); if (error) throw error; gameMessage = "終了時チップを保存しました。"; showChipEditor = false; await loadMatchSessions(); } catch (error) { message.textContent = error.message || "終了時チップを保存できませんでした。"; } finally { submit.disabled = false; } }

function getVenueDraftPrepaymentTotal() { return activeMatchMembers.reduce((sum,m) => sum + num(venueDraft.prepayments[m.member_id]), 0); }
function renderVenueEditor() {
  const total = num(venueDraft.total), paid = getVenueDraftPrepaymentTotal(), matching = nearlyEqual(total, paid);
  return `<section class="venue-editor"><form id="venueForm"><p class="game-section-note">場代と、その場で各人が先に支払ったptを入力します。先払いの合計は場代合計と一致させてください。</p><label class="venue-total-field">場代合計（pt）<input type="number" min="0" step="0.01" data-venue-total value="${total}"></label><div class="venue-prepay-list">${activeMatchMembers.map((m) => `<label class="venue-prepay-row"><span>${escapeHtml(getMemberName(m.member_id))}</span><input type="number" min="0" step="0.01" value="${num(venueDraft.prepayments[m.member_id])}" data-venue-prepay-member-id="${m.member_id}"><small>ptを先払い</small></label>`).join("")}</div><p id="venueBalanceMessage" class="game-form-message ${matching ? "" : "venue-error"}">場代 ${formatPtPlain(total)} ／ 先払い ${formatPtPlain(paid)} ${matching ? "／ 一致" : "／ 差額 " + formatPt(total - paid)}</p><button id="saveVenueButton" class="save-game-button" type="submit">場代を保存</button></form></section>`;
}
function bindVenueEditorEvents() { const form = document.getElementById("venueForm"); if (!form) return; document.querySelector("[data-venue-total]").addEventListener("input", (e) => { venueDraft.total = num(e.target.value); refreshVenueDraftBalance(); }); document.querySelectorAll("[data-venue-prepay-member-id]").forEach((input) => input.addEventListener("input", () => { venueDraft.prepayments[input.dataset.venuePrepayMemberId] = num(input.value); refreshVenueDraftBalance(); })); form.addEventListener("submit", saveVenueCosts); }
function refreshVenueDraftBalance() { const el = document.getElementById("venueBalanceMessage"); if (!el) return; const total = num(venueDraft.total), paid = getVenueDraftPrepaymentTotal(), matching = nearlyEqual(total, paid); el.textContent = `場代 ${formatPtPlain(total)} ／ 先払い ${formatPtPlain(paid)} ${matching ? "／ 一致" : "／ 差額 " + formatPt(total - paid)}`; el.classList.toggle("venue-error", !matching); }
async function saveVenueCosts(e) { e.preventDefault(); const message = document.getElementById("venueBalanceMessage"), submit = document.getElementById("saveVenueButton"), total = num(venueDraft.total), paid = getVenueDraftPrepaymentTotal(); if (!nearlyEqual(total, paid)) { message.textContent = "場代合計と先払い合計を一致させてください。"; message.classList.add("venue-error"); return; } submit.disabled = true; submit.textContent = "保存中..."; try { markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("set_match_session_venue_costs", { p_session_id: activeMatchSessionId, p_venue_fee_total: roundTo(total, 2), p_prepayments: activeMatchMembers.map((m) => ({ member_id: m.member_id, paid_molly: roundTo(num(venueDraft.prepayments[m.member_id]), 2) })) }); if (error) throw error; gameMessage = "場代と先払いを保存しました。"; showVenueEditor = false; await loadMatchSessions(); } catch (error) { message.textContent = error.message || "場代を保存できませんでした。"; } finally { submit.disabled = false; submit.textContent = "場代を保存"; } }

async function settleMatchSession() {
  if (!activeHanchans.length) return alert("半荘を1件以上登録してください。"); if (!hasAllChips()) return alert("終了時チップを全員分入力してください。"); if (!hasMatchingVenuePrepayments()) return alert("場代合計と先払い合計を一致させてください。"); if (!confirm("1日の精算を確定します。\n確定後も半荘・チップ・場代は編集できます。")) return;
  try { markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("close_match_session", { p_session_id: activeMatchSessionId }); if (error) throw error; gameMessage = "1日の精算を確定しました。"; await loadMatchSessions(); } catch (error) { alert(error.message || "精算を確定できませんでした。"); }
}


async function deleteMatchHanchan(hanchanId) {
  if (!window.confirm("この半荘記録を削除しますか？\n飛ばし点と役満記録もまとめて削除されます。")) return;
  try {
    markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("delete_match_hanchan", { p_hanchan_id: hanchanId });
    if (error) throw error;
    gameMessage = "半荘記録を削除しました。";
    await loadMatchSessions();
  } catch (error) {
    alert(error.message || "半荘記録を削除できませんでした。");
  }
}

async function deleteActiveMatchSession() {
  if (!activeMatchSession) return;
  const label = formatDate(activeMatchSession.session_date);
  if (!window.confirm(`${label}の記録をすべて削除しますか？\n半荘、チップ、場代、役満記録も削除され、この操作は取り消せません。`)) return;
  try {
    markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("delete_match_session", { p_session_id: activeMatchSessionId });
    if (error) throw error;
    activeMatchSessionId = null;
    localStorage.removeItem("jakuroku-active-match-session-id");
    resetMatchViewState();
    await loadMatchSessions();
  } catch (error) {
    alert(error.message || "日次記録を削除できませんでした。");
  }
}


const RANKING_METRICS = {
  total: { label: "総合pt", unit: "pt", description: "素点とチップを合算し、当日のレートで換算したゲームptです。場代は含みません。" },
  chip: { label: "チップ", unit: "枚", description: "終了時に入力したチップ差分の累積です。" },
  score: { label: "素点pt", unit: "pt", description: "チップを除く半荘収支を、当日のレートで換算した累積です。" }
};

function getRankingYearOptions() {
  return [...new Set(rankingRaw.sessions.map((session) => String(session.session_date || "").slice(0, 4)).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a));
}
function getRankingMonthOptions() {
  return [...new Set(rankingRaw.sessions.map((session) => String(session.session_date || "").slice(0, 7)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
}
function getRankingPeriodLabel() {
  if (rankingPeriodMode === "all") return "全期間";
  if (rankingPeriodMode === "year") return rankingPeriodValue ? `${rankingPeriodValue}年` : "年を選択";
  if (!rankingPeriodValue) return "月を選択";
  const [year, month] = rankingPeriodValue.split("-");
  return `${year}年${Number(month)}月`;
}
function getRankingSessionsForPeriod() {
  if (rankingPeriodMode === "all") return [...rankingRaw.sessions];
  if (rankingPeriodMode === "year") return rankingRaw.sessions.filter((session) => String(session.session_date).startsWith(`${rankingPeriodValue}-`));
  return rankingRaw.sessions.filter((session) => String(session.session_date).startsWith(rankingPeriodValue));
}
function getRankingMemberName(memberId) { return getMemberName(memberId); }
function getMetricValue(record, metric = rankingMetric) {
  if (metric === "chip") return num(record.chipCount);
  if (metric === "score") return num(record.scorePt);
  return num(record.totalPt);
}
function getMetricCumulativeKey(metric = rankingMetric) {
  if (metric === "chip") return "cumulativeChip";
  if (metric === "score") return "cumulativeScore";
  return "cumulativeTotal";
}
function formatMetric(value, metric = rankingMetric) {
  return metric === "chip" ? `${signPrefix(num(value))}${formatNumber(value, 1)}枚` : formatPt(value);
}
function formatMetricMarkup(value, metric = rankingMetric) {
  return `<span class="signed-value ${signedClass(value)}">${formatMetric(value, metric)}</span>`;
}
function metricBreakdownText(player) {
  if (rankingMetric === "chip") return `素点 ${formatPt(player.scorePt)} ／ 総合 ${formatPt(player.totalPt)}`;
  if (rankingMetric === "score") return `チップ ${formatChipMarkup(player.chipCount)} ／ 総合 ${formatPt(player.totalPt)}`;
  return `素点 ${formatPt(player.scorePt)} ／ チップ ${formatChipMarkup(player.chipCount)}`;
}

function buildRankingDashboard() {
  const sessions = getRankingSessionsForPeriod().slice().sort((a, b) => {
    const byDate = String(a.session_date).localeCompare(String(b.session_date));
    return byDate || String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
  const sessionIds = new Set(sessions.map((session) => session.id));
  const membersBySession = new Map();
  const hanchansBySession = new Map();
  const resultsByHanchan = new Map();
  const chipsBySessionMember = new Map();
  rankingRaw.sessionMembers.filter((member) => sessionIds.has(member.session_id)).forEach((member) => {
    if (!membersBySession.has(member.session_id)) membersBySession.set(member.session_id, []);
    membersBySession.get(member.session_id).push(member.member_id);
  });
  rankingRaw.hanchans.filter((hanchan) => sessionIds.has(hanchan.session_id)).forEach((hanchan) => {
    if (!hanchansBySession.has(hanchan.session_id)) hanchansBySession.set(hanchan.session_id, []);
    hanchansBySession.get(hanchan.session_id).push(hanchan);
  });
  rankingRaw.results.forEach((result) => {
    if (!resultsByHanchan.has(result.hanchan_id)) resultsByHanchan.set(result.hanchan_id, []);
    resultsByHanchan.get(result.hanchan_id).push(result);
  });
  rankingRaw.chips.filter((chip) => sessionIds.has(chip.session_id)).forEach((chip) => {
    chipsBySessionMember.set(`${chip.session_id}:${chip.member_id}`, num(chip.chip_count));
  });
  const yakumansByMember = new Map();
  const hanchanIds = new Set(rankingRaw.hanchans.filter((hanchan) => sessionIds.has(hanchan.session_id)).map((hanchan) => hanchan.id));
  rankingRaw.yakumans.filter((record) => hanchanIds.has(record.hanchan_id)).forEach((record) => {
    yakumansByMember.set(record.winner_member_id, (yakumansByMember.get(record.winner_member_id) || 0) + 1);
  });

  const summary = new Map();
  const ensure = (memberId) => {
    if (!summary.has(memberId)) {
      summary.set(memberId, {
        memberId, displayName: getRankingMemberName(memberId), totalPt: 0, scorePt: 0, chipCount: 0,
        sessions: 0, hanchans: 0, rankSum: 0, firstCount: 0, yakumanCount: 0, history: [], recentSessions: []
      });
    }
    return summary.get(memberId);
  };

  const dailySessions = [];
  sessions.forEach((session) => {
    const memberIds = membersBySession.get(session.id) || [];
    const sessionHanchans = hanchansBySession.get(session.id) || [];
    const hanchanTotalByMember = new Map();
    const hanchanStatsByMember = new Map();
    sessionHanchans.forEach((hanchan) => {
      (resultsByHanchan.get(hanchan.id) || []).forEach((result) => {
        hanchanTotalByMember.set(result.member_id, num(hanchanTotalByMember.get(result.member_id)) + num(result.total_points));
        if (!hanchanStatsByMember.has(result.member_id)) hanchanStatsByMember.set(result.member_id, { count: 0, rankSum: 0, firstCount: 0 });
        const stat = hanchanStatsByMember.get(result.member_id);
        stat.count += 1;
        stat.rankSum += num(result.rank);
        if (num(result.rank) === 1) stat.firstCount += 1;
      });
    });
    const multiplier = num(session.rate_multiplier || 30);
    const dailyPlayers = [];
    memberIds.forEach((memberId) => {
      const entry = ensure(memberId);
      const hanchanScore = roundOne(hanchanTotalByMember.get(memberId));
      const chipCount = num(chipsBySessionMember.get(`${session.id}:${memberId}`));
      const chipPt = roundTo(chipCount * num(session.chip_value) * multiplier, 2);
      const scorePt = roundTo(hanchanScore * multiplier, 2);
      const totalPt = roundTo(scorePt + chipPt, 2);
      const stat = hanchanStatsByMember.get(memberId) || { count: 0, rankSum: 0, firstCount: 0 };
      const dailyPlayer = {
        memberId, displayName: getRankingMemberName(memberId), hanchanScore, chipCount, chipPt, scorePt, totalPt,
        hanchans: stat.count, averageRank: stat.count ? roundTo(stat.rankSum / stat.count, 2) : null, firstCount: stat.firstCount
      };
      dailyPlayers.push(dailyPlayer);
      entry.totalPt = roundTo(entry.totalPt + totalPt, 2);
      entry.scorePt = roundTo(entry.scorePt + scorePt, 2);
      entry.chipCount = roundOne(entry.chipCount + chipCount);
      entry.sessions += 1; entry.hanchans += stat.count; entry.rankSum += stat.rankSum; entry.firstCount += stat.firstCount;
      entry.history.push({
        sessionId: session.id, label: formatDate(session.session_date), date: session.session_date,
        totalPt, scorePt, chipCount,
        cumulativeTotal: entry.totalPt, cumulativeScore: entry.scorePt, cumulativeChip: entry.chipCount
      });
      entry.recentSessions.push({ sessionId: session.id, date: session.session_date, mode: session.game_mode, rateLabel: session.rate_label, multiplier, totalPt, scorePt, chipCount });
    });
    dailySessions.push({ sessionId: session.id, date: session.session_date, createdAt: session.created_at, mode: session.game_mode, rateLabel: session.rate_label, rateMultiplier: multiplier, hanchanCount: sessionHanchans.length, players: dailyPlayers });
  });

  const entries = [...summary.values()].map((entry) => ({
    ...entry,
    averageRank: entry.hanchans ? roundTo(entry.rankSum / entry.hanchans, 2) : null,
    firstRate: entry.hanchans ? roundTo((entry.firstCount / entry.hanchans) * 100, 1) : null,
    yakumanCount: yakumansByMember.get(entry.memberId) || 0
  })).sort((a, b) => getMetricValue(b) - getMetricValue(a) || a.displayName.localeCompare(b.displayName, "ja"));
  return { entries, dailySessions };
}

function buildTrendSvg(history, metric = rankingMetric) {
  const key = getMetricCumulativeKey(metric);
  const values = [0, ...history.map((item) => num(item[key]))];
  const width = Math.max(620, 110 + history.length * 88);
  const height = 220, padX = 34, padY = 24, usableWidth = width - padX * 2, usableHeight = height - padY * 2;
  const min = Math.min(...values, 0), max = Math.max(...values, 0), range = max - min || 1;
  const x = (index) => padX + (values.length <= 1 ? usableWidth / 2 : (usableWidth * index) / (values.length - 1));
  const y = (value) => padY + ((max - value) / range) * usableHeight;
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const circles = values.map((value, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${index === 0 ? 3 : 4}" class="trend-point"/>`).join("");
  const labels = history.map((item, index) => `<text x="${x(index + 1).toFixed(1)}" y="${height - 7}" text-anchor="middle" class="trend-label">${escapeHtml(item.label)}</text>`).join("");
  return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="累積${escapeHtml(RANKING_METRICS[metric].label)}推移"><line x1="${padX}" x2="${width-padX}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="trend-zero"/><polyline points="${points}" class="trend-line"/>${circles}${labels}<text x="${padX}" y="${padY-6}" class="trend-scale">${formatNumber(max,0)} ${RANKING_METRICS[metric].unit}</text><text x="${padX}" y="${height-padY+14}" class="trend-scale">${formatNumber(min,0)} ${RANKING_METRICS[metric].unit}</text></svg>`;
}

function buildAllTrendSvg(dailySessions, entries, selectedMemberId, metric = rankingMetric) {
  if (!dailySessions.length || !entries.length) return { legend: "", svg: `<p class="ranking-note">累積${RANKING_METRICS[metric].label}を表示する精算済み記録がありません。</p>` };
  const palette = ["#4f3b82", "#0d6b5b", "#bd6b22", "#b53565", "#2767a8", "#7b5e27", "#66703c", "#8c4f9d"];
  const sessions = [...dailySessions].sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const running = new Map(entries.map((entry) => [entry.memberId, 0]));
  const series = entries.map((entry, index) => ({ memberId: entry.memberId, displayName: entry.displayName, color: palette[index % palette.length], values: [0] }));
  sessions.forEach((session) => {
    const valueByMember = new Map(session.players.map((player) => [player.memberId, getMetricValue(player, metric)]));
    series.forEach((line) => {
      const next = roundTo(num(running.get(line.memberId)) + num(valueByMember.get(line.memberId)), metric === "chip" ? 1 : 2);
      running.set(line.memberId, next); line.values.push(next);
    });
  });
  const values = series.flatMap((line) => line.values);
  const width = Math.max(660, 120 + sessions.length * 96), height = 260, padX = 38, padY = 30, usableWidth = width - padX * 2, usableHeight = height - padY * 2;
  const min = Math.min(...values, 0), max = Math.max(...values, 0), range = max - min || 1;
  const x = (index) => padX + (sessions.length <= 0 ? usableWidth / 2 : (usableWidth * index) / sessions.length);
  const y = (value) => padY + ((max - value) / range) * usableHeight;
  const labelInterval = Math.max(1, Math.ceil(sessions.length / 7));
  const labels = sessions.map((session, index) => (sessions.length <= 7 || index === 0 || index === sessions.length - 1 || index % labelInterval === 0) ? `<text x="${x(index+1).toFixed(1)}" y="${height-8}" text-anchor="middle" class="trend-label">${escapeHtml(formatDate(session.date))}</text>` : "").join("");
  const lines = series.map((line) => {
    const emphasized = line.memberId === selectedMemberId;
    const points = line.values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
    const circles = line.values.slice(1).map((value, index) => `<circle cx="${x(index+1).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${emphasized ? 4 : 3}" class="all-trend-point" style="stroke:${line.color};fill:#fff;opacity:${emphasized ? 1 : .85}"></circle>`).join("");
    return `<polyline points="${points}" class="all-trend-line" style="stroke:${line.color};stroke-width:${emphasized ? 4.5 : 2.8};opacity:${emphasized ? 1 : .78}"></polyline>${circles}`;
  }).join("");
  const legend = series.map((line) => `<span class="trend-legend-item ${line.memberId === selectedMemberId ? "selected" : ""}"><i style="background:${line.color}"></i>${escapeHtml(line.displayName)}</span>`).join("");
  return { legend, svg: `<svg class="trend-svg all-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="全員の累積${escapeHtml(RANKING_METRICS[metric].label)}推移"><line x1="${padX}" x2="${width-padX}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="trend-zero"></line>${lines}${labels}<text x="${padX}" y="${padY-7}" class="trend-scale">${formatNumber(max,0)} ${RANKING_METRICS[metric].unit}</text><text x="${padX}" y="${height-padY+15}" class="trend-scale">${formatNumber(min,0)} ${RANKING_METRICS[metric].unit}</text></svg>` };
}

function renderDailySessionHistory(dailySessions) {
  if (!dailySessions.length) return `<p class="ranking-note">この期間の日次ゲーム収支履歴はありません。</p>`;
  return [...dailySessions].sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).map((session) => {
    const open = rankingOpenSessionId === session.sessionId;
    const metricTotal = roundTo(session.players.reduce((sum, player) => sum + getMetricValue(player), 0), rankingMetric === "chip" ? 1 : 2);
    const rows = session.players.slice().sort((a,b) => getMetricValue(b) - getMetricValue(a)).map((player) => `<div class="daily-history-player-row"><span>${escapeHtml(player.displayName)}</span><div><strong>${formatMetricMarkup(getMetricValue(player))}</strong><small>総合 ${formatPtMarkup(player.totalPt)} ／ チップ ${formatChipMarkup(player.chipCount)} ／ 素点 ${formatPtMarkup(player.scorePt)}</small></div></div>`).join("");
    return `<article class="daily-history-card ${open ? "open" : ""}"><button type="button" class="daily-history-toggle" data-daily-session-id="${session.sessionId}"><div><strong>${formatDate(session.date)}</strong><small>${escapeHtml(getModeLabel(session.mode))} ／ ${escapeHtml(session.rateLabel)}（×${formatNumber(session.rateMultiplier, 0)}）</small></div><span>${open ? "閉じる" : "詳細"}</span></button><div class="daily-history-meta"><span>半荘 ${session.hanchanCount}回</span><span>${escapeHtml(RANKING_METRICS[rankingMetric].label)}合計 ${formatMetricMarkup(metricTotal)}</span></div>${open ? `<div class="daily-history-player-list">${rows}</div>` : ""}</article>`;
  }).join("");
}

function renderRankingPage() {
  const page = getPageWorkspace();
  if (!currentSession) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">RANKING</p><h2>ログインが必要です</h2><button id="rankingBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("rankingBackHomeButton")?.addEventListener("click", () => switchTab("home")); return;
  }
  if (!getActiveGroup()) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">RANKING</p><h2>先にグループを作成してください</h2><button id="rankingBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("rankingBackHomeButton")?.addEventListener("click", () => switchTab("home")); return;
  }

  const years = getRankingYearOptions();
  const months = getRankingMonthOptions();
  if (rankingPeriodMode === "year" && !years.includes(rankingPeriodValue)) rankingPeriodValue = years[0] || "";
  if (rankingPeriodMode === "month" && !months.includes(rankingPeriodValue)) rankingPeriodValue = months[0] || "";
  const dashboard = buildRankingDashboard();
  const entries = dashboard.entries;
  const dailySessions = dashboard.dailySessions;
  if (!entries.some((entry) => entry.memberId === rankingSelectedMemberId)) rankingSelectedMemberId = entries[0]?.memberId || "";
  if (!dailySessions.some((session) => session.sessionId === rankingOpenSessionId)) rankingOpenSessionId = dailySessions[dailySessions.length - 1]?.sessionId || null;
  const selected = entries.find((entry) => entry.memberId === rankingSelectedMemberId) || null;

  if (!entries.length) {
    page.innerHTML = `<section class="workspace-card ranking-empty-card"><p class="eyebrow">RANKING</p><h2>精算済みの記録がありません</h2><p class="workspace-description">日次精算を確定すると、場代を除くゲーム収支をここで確認できます。</p><button id="rankingGoGameButton" class="primary-button" type="button">対局登録へ</button></section>`;
    document.getElementById("rankingGoGameButton")?.addEventListener("click", () => switchTab("game")); return;
  }

  const metricButtons = Object.entries(RANKING_METRICS).map(([key, metric]) => `<button type="button" class="ranking-filter-button ${rankingMetric === key ? "active" : ""}" data-ranking-metric="${key}">${metric.label}</button>`).join("");
  const periodButtons = [["all", "全期間"], ["year", "年別"], ["month", "月別"]].map(([key,label]) => `<button type="button" class="ranking-filter-button ${rankingPeriodMode === key ? "active" : ""}" data-ranking-period-mode="${key}">${label}</button>`).join("");
  const periodSelect = rankingPeriodMode === "year" ? `<select id="rankingPeriodSelect" class="ranking-member-select">${years.map((year) => `<option value="${year}" ${rankingPeriodValue === year ? "selected" : ""}>${year}年</option>`).join("")}</select>` : rankingPeriodMode === "month" ? `<select id="rankingPeriodSelect" class="ranking-member-select">${months.map((month) => { const [year, monthNum] = month.split("-"); return `<option value="${month}" ${rankingPeriodValue === month ? "selected" : ""}>${year}年${Number(monthNum)}月</option>`; }).join("")}</select>` : "";

  const rankingRows = entries.map((entry, index) => `<article class="ranking-row ${entry.memberId === rankingSelectedMemberId ? "selected" : ""}" data-ranking-member-id="${entry.memberId}"><span class="ranking-place">${index+1}</span><div class="ranking-name-block"><strong>${escapeHtml(entry.displayName)}</strong><small>半荘 ${entry.hanchans}回 ／ 平均順位 ${entry.averageRank ?? "-"} ／ 1位率 ${entry.firstRate !== null ? `${entry.firstRate}%` : "-"}</small></div><div class="ranking-score-block"><strong>${formatMetricMarkup(getMetricValue(entry))}</strong><small>${rankingMetric === "chip" ? `総合 ${formatPt(entry.totalPt)}` : rankingMetric === "score" ? `チップ ${formatChipMarkup(entry.chipCount)}` : `素点 ${formatPt(entry.scorePt)} ／ ${formatChipMarkup(entry.chipCount)}`}</small></div></article>`).join("");
  const yakumanEntries = entries.filter((entry) => entry.yakumanCount > 0).sort((a,b) => b.yakumanCount - a.yakumanCount || a.displayName.localeCompare(b.displayName, "ja"));
  const yakumanRows = yakumanEntries.length ? yakumanEntries.map((entry,index) => `<div class="yakuman-ranking-row"><span>${index+1}位　${escapeHtml(entry.displayName)}</span><strong>${entry.yakumanCount}回</strong></div>`).join("") : `<p class="ranking-note">この期間の役満記録はありません。</p>`;
  const recentRows = selected ? selected.recentSessions.slice().sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0,8).map((item) => `<div class="recent-session-row"><div><strong>${formatDate(item.date)}</strong><small>${escapeHtml(getModeLabel(item.mode))} ／ ${escapeHtml(item.rateLabel)}</small></div><div><strong>${formatMetricMarkup(getMetricValue(item))}</strong><small>総合 ${formatPt(item.totalPt)} ／ チップ ${formatChipMarkup(item.chipCount)}</small></div></div>`).join("") : "";
  const allTrend = buildAllTrendSvg(dailySessions, entries, rankingSelectedMemberId, rankingMetric);
  const metric = RANKING_METRICS[rankingMetric];

  page.innerHTML = `
    <section class="game-card ranking-card">
      <div class="game-card-heading"><div><p class="eyebrow">RANKING</p><h2>通算・期間別成績</h2></div><span class="ranking-period-badge">${escapeHtml(getRankingPeriodLabel())}</span></div>
      <p class="game-description">場代を除外し、ゲーム収支のみを集計しています。集計項目と期間を切り替えられます。</p>
      <section class="ranking-control-panel">
        <div><p>指標</p><div class="ranking-filter-list">${metricButtons}</div></div>
        <div><p>期間</p><div class="ranking-filter-list">${periodButtons}${periodSelect}</div></div>
      </section>
      <section class="game-section"><p class="game-section-title">${escapeHtml(metric.label)}ランキング</p><div class="ranking-list">${rankingRows}</div></section>
      <section class="game-section all-trend-section"><div class="game-section-heading"><p class="game-section-title">全員の累積${escapeHtml(metric.label)}推移</p><span class="all-trend-note">${escapeHtml(getRankingPeriodLabel())}</span></div><div class="trend-legend">${allTrend.legend}</div><div class="trend-chart-wrap">${allTrend.svg}</div></section>
      ${selected ? `<section class="game-section ranking-trend-section"><div class="game-section-heading"><p class="game-section-title">${escapeHtml(selected.displayName)}の累積${escapeHtml(metric.label)}推移</p><select id="rankingMemberSelect" class="ranking-member-select">${entries.map((entry) => `<option value="${entry.memberId}" ${entry.memberId === selected.memberId ? "selected" : ""}>${escapeHtml(entry.displayName)}</option>`).join("")}</select></div><div class="ranking-kpi-grid"><div><span>総合pt</span><strong>${formatPtMarkup(selected.totalPt)}</strong></div><div><span>チップ</span><strong>${formatChipMarkup(selected.chipCount)}</strong></div><div><span>素点pt</span><strong>${formatPtMarkup(selected.scorePt)}</strong></div><div><span>平均順位</span><strong>${selected.averageRank ?? "-"}</strong></div></div><div class="trend-chart-wrap">${buildTrendSvg(selected.history, rankingMetric)}</div></section><section class="game-section"><p class="game-section-title">${escapeHtml(selected.displayName)}の直近記録</p><div class="recent-session-list">${recentRows}</div></section>` : ""}
      <section class="game-section daily-history-section"><div class="game-section-heading"><p class="game-section-title">日次ゲーム収支履歴</p><span class="all-trend-note">日付を押すと内訳を表示</span></div><div class="daily-history-list">${renderDailySessionHistory(dailySessions)}</div></section>
      <section class="game-section"><p class="game-section-title">役満ランキング</p><div class="yakuman-ranking-list">${yakumanRows}</div></section>
    </section>
  `;
  document.querySelectorAll("[data-ranking-metric]").forEach((button) => button.addEventListener("click", () => { rankingMetric = button.dataset.rankingMetric; rankingSelectedMemberId = ""; renderRankingPage(); }));
  document.querySelectorAll("[data-ranking-period-mode]").forEach((button) => button.addEventListener("click", () => { rankingPeriodMode = button.dataset.rankingPeriodMode; rankingPeriodValue = rankingPeriodMode === "year" ? (years[0] || "") : rankingPeriodMode === "month" ? (months[0] || "") : ""; rankingSelectedMemberId = ""; rankingOpenSessionId = null; renderRankingPage(); }));
  document.getElementById("rankingPeriodSelect")?.addEventListener("change", (event) => { rankingPeriodValue = event.target.value; rankingSelectedMemberId = ""; rankingOpenSessionId = null; renderRankingPage(); });
  document.querySelectorAll("[data-ranking-member-id]").forEach((row) => row.addEventListener("click", () => { rankingSelectedMemberId = row.dataset.rankingMemberId; renderRankingPage(); }));
  document.getElementById("rankingMemberSelect")?.addEventListener("change", (event) => { rankingSelectedMemberId = event.target.value; renderRankingPage(); });
  document.querySelectorAll("[data-daily-session-id]").forEach((button) => button.addEventListener("click", () => { const id = button.dataset.dailySessionId; rankingOpenSessionId = rankingOpenSessionId === id ? null : id; renderRankingPage(); }));
}

async function loadRankingData() {
  const page = getPageWorkspace();

  if (!currentSession || !activeGroupId) {
    renderRankingPage();
    return;
  }

  page.innerHTML = `<section class="workspace-card loading-card">ランキングを読み込み中...</section>`;

  try {
    const { data: sessions, error: sessionsError } = await supabaseClient
      .from("match_sessions")
      .select("id, session_date, game_mode, rate_label, rate_multiplier, chip_value, status, created_at")
      .eq("group_id", activeGroupId)
      .is("deleted_at", null)
      .eq("status", "settled")
      .order("session_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (sessionsError) throw sessionsError;

    const sessionRows = sessions || [];
    const sessionIds = sessionRows.map((session) => session.id);

    if (!sessionIds.length) {
      rankingRaw = { sessions: [], sessionMembers: [], hanchans: [], results: [], chips: [], prepayments: [], yakumans: [] };
      renderRankingPage();
      return;
    }

    const [membersResponse, hanchansResponse, chipsResponse] = await Promise.all([
      supabaseClient.from("match_session_members").select("session_id, member_id").in("session_id", sessionIds),
      supabaseClient.from("match_hanchans").select("id, session_id, sequence_no").in("session_id", sessionIds),
      supabaseClient.from("match_session_chips").select("session_id, member_id, chip_count").in("session_id", sessionIds)
    ]);

    if (membersResponse.error) throw membersResponse.error;
    if (hanchansResponse.error) throw hanchansResponse.error;
    if (chipsResponse.error) throw chipsResponse.error;

    const hanchanRows = hanchansResponse.data || [];
    const hanchanIds = hanchanRows.map((hanchan) => hanchan.id);
    let resultRows = [];
    let yakumanRows = [];

    if (hanchanIds.length) {
      const [resultsResponse, yakumanResponse] = await Promise.all([
        supabaseClient
          .from("match_hanchan_results")
          .select("hanchan_id, member_id, rank, total_points")
          .in("hanchan_id", hanchanIds),
        supabaseClient
          .from("match_yakuman_records")
          .select("hanchan_id, winner_member_id")
          .in("hanchan_id", hanchanIds)
      ]);

      if (resultsResponse.error) throw resultsResponse.error;
      if (yakumanResponse.error) throw yakumanResponse.error;

      resultRows = resultsResponse.data || [];
      yakumanRows = yakumanResponse.data || [];
    }

    rankingRaw = {
      sessions: sessionRows,
      sessionMembers: membersResponse.data || [],
      hanchans: hanchanRows,
      results: resultRows,
      chips: chipsResponse.data || [],
      prepayments: [],
      yakumans: yakumanRows
    };

    renderRankingPage();
  } catch (error) {
    page.innerHTML = `
      <section class="workspace-card">
        <p class="eyebrow">RANKING</p>
        <h2>ランキングを読み込めませんでした</h2>
        <p class="workspace-description">${escapeHtml(error.message || "通信状態を確認してください。")}</p>
        <button id="retryRankingButton" class="primary-button" type="button">再読み込み</button>
      </section>
    `;
    document.getElementById("retryRankingButton")?.addEventListener("click", loadRankingData);
  }
}


function debtStatusLabel(status) {
  return ({ open: "未精算", paid: "支払済み", rerouted: "横流し済み", offset: "相殺済み", cancelled: "取消" })[status] || status;
}
function debtKindLabel(kind) {
  return ({ manual: "手動", settlement: "精算ルート", reroute: "横流し" })[kind] || kind;
}
function debtEventLabel(eventType) {
  return ({ created: "登録", payment: "支払い", rerouted_out: "横流し", offset: "相殺", cancelled: "取消" })[eventType] || eventType;
}
function formatDebtDate(value) {
  if (!value) return "日付なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
}
function getOpenDebtRecords() {
  return debtRecords.filter((record) => record.status === "open" && num(record.remaining_amount_pt) > 0.004);
}
function getDebtRerouteCandidates(downstreamRecord) {
  return getOpenDebtRecords()
    .filter((candidate) => candidate.id !== downstreamRecord.id
      && candidate.creditor_member_id === downstreamRecord.debtor_member_id
      && candidate.debtor_member_id !== downstreamRecord.creditor_member_id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
function getDebtEvents(recordId) {
  return debtEvents.filter((event) => event.debt_id === recordId).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
}
function getDebtMemberSummary() {
  return activeGroupMembers.map((member) => {
    const outgoing = getOpenDebtRecords().filter((record) => record.debtor_member_id === member.id).reduce((sum, record) => sum + num(record.remaining_amount_pt), 0);
    const incoming = getOpenDebtRecords().filter((record) => record.creditor_member_id === member.id).reduce((sum, record) => sum + num(record.remaining_amount_pt), 0);
    return { member, outgoing: roundTo(outgoing, 2), incoming: roundTo(incoming, 2), net: roundTo(incoming - outgoing, 2) };
  });
}
async function fetchDebtData() {
  if (!currentSession || !activeGroupId) {
    debtRecords = [];
    debtEvents = [];
    return;
  }
  const [recordsResponse, eventsResponse] = await Promise.all([
    supabaseClient
      .from("debt_records")
      .select("id, group_id, source_session_id, debtor_member_id, creditor_member_id, original_amount_pt, remaining_amount_pt, status, record_kind, memo, due_date, paid_at, created_at, updated_at")
      .eq("group_id", activeGroupId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false }),
    supabaseClient
      .from("debt_events")
      .select("id, group_id, debt_id, event_type, amount_pt, related_debt_id, note, occurred_at")
      .eq("group_id", activeGroupId)
      .order("occurred_at", { ascending: false })
  ]);
  if (recordsResponse.error) throw recordsResponse.error;
  if (eventsResponse.error) throw eventsResponse.error;
  debtRecords = recordsResponse.data || [];
  debtEvents = eventsResponse.data || [];
}
async function loadDebtData() {
  const page = getPageWorkspace();
  if (!currentSession || !activeGroupId) {
    renderDebtPage();
    return;
  }
  page.innerHTML = `<section class="workspace-card loading-card">借ptを読み込み中...</section>`;
  try {
    await fetchDebtData();
    renderDebtPage();
  } catch (error) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DEBT</p><h2>借ptを読み込めませんでした</h2><p class="workspace-description">${escapeHtml(error.message || "通信状態を確認してください。")}</p><button id="retryDebtButton" class="primary-button" type="button">再読み込み</button></section>`;
    document.getElementById("retryDebtButton")?.addEventListener("click", () => { void loadDebtData(); });
  }
}
function renderDebtPaymentForm(record) {
  return `<form class="debt-inline-form debt-payment-form" data-debt-payment-form="${record.id}">
    <div class="debt-form-grid">
      <label>支払額（pt）<input name="amount" type="number" min="0.01" max="${num(record.remaining_amount_pt)}" step="0.01" value="${num(record.remaining_amount_pt)}" required></label>
      <label>支払日<input name="paidDate" type="date" value="${todayInJapan()}" required></label>
    </div>
    <label>メモ（任意）<input name="memo" type="text" maxlength="300" placeholder="例：PayPayで送金"></label>
    <div class="debt-form-actions"><button class="primary-button" type="submit">支払いを記録</button><button class="secondary-button" type="button" data-close-debt-payment="${record.id}">閉じる</button></div>
    <p class="debt-form-message"></p>
  </form>`;
}
function renderDebtRerouteForm(record) {
  const candidates = getDebtRerouteCandidates(record);
  if (!candidates.length) {
    return `<div class="debt-inline-form debt-empty-reroute"><p>横流し候補がありません。<br>「${escapeHtml(getMemberName(record.debtor_member_id))}へ支払う未精算借pt」がある場合に横流しできます。</p><button class="secondary-button" type="button" data-close-debt-reroute="${record.id}">閉じる</button></div>`;
  }
  const first = candidates[0];
  const max = roundTo(Math.min(num(first.remaining_amount_pt), num(record.remaining_amount_pt)), 2);
  const options = candidates.map((candidate) => `<option value="${candidate.id}" data-max="${roundTo(Math.min(num(candidate.remaining_amount_pt), num(record.remaining_amount_pt)), 2)}">${escapeHtml(getMemberName(candidate.debtor_member_id))} → ${escapeHtml(getMemberName(candidate.creditor_member_id))}（未精算 ${formatPtPlain(candidate.remaining_amount_pt)}）</option>`).join("");
  return `<form class="debt-inline-form debt-reroute-form" data-debt-reroute-form="${record.id}">
    <p>この <strong>${escapeHtml(getMemberName(record.debtor_member_id))} → ${escapeHtml(getMemberName(record.creditor_member_id))}</strong> の一部または全額を、既存の未精算借ptから横流しします。</p>
    <label>横流し元（A → ${escapeHtml(getMemberName(record.debtor_member_id))}）<select name="upstreamDebtId">${options}</select></label>
    <label>横流し額（pt）<input name="amount" type="number" min="0.01" max="${max}" step="0.01" value="${max}" required></label>
    <label>メモ（任意）<input name="memo" type="text" maxlength="300" placeholder="例：精算を横流し"></label>
    <p class="debt-reroute-hint">最大 ${formatPtPlain(max)} を横流しできます。</p>
    <div class="debt-form-actions"><button class="primary-button" type="submit">横流しを実行</button><button class="secondary-button" type="button" data-close-debt-reroute="${record.id}">閉じる</button></div>
    <p class="debt-form-message"></p>
  </form>`;
}
function renderDebtRecord(record) {
  const open = record.status === "open";
  const events = getDebtEvents(record.id);
  const eventRows = events.length ? events.map((event) => `<li><span>${escapeHtml(debtEventLabel(event.event_type))}</span><strong>${formatPtPlain(event.amount_pt)}</strong><small>${formatDebtDate(event.occurred_at)}${event.note ? ` ／ ${escapeHtml(event.note)}` : ""}</small></li>`).join("") : "";
  return `<article class="debt-record-card ${open ? "open" : "closed"}">
    <div class="debt-record-heading">
      <div><p class="debt-route">${escapeHtml(getMemberName(record.debtor_member_id))} <b>→</b> ${escapeHtml(getMemberName(record.creditor_member_id))}</p><small>${escapeHtml(debtKindLabel(record.record_kind))} ／ 登録 ${formatDebtDate(record.created_at)}${record.due_date ? ` ／ 期限 ${formatDate(record.due_date)}` : ""}</small></div>
      <span class="debt-status-badge ${escapeHtml(record.status)}">${escapeHtml(debtStatusLabel(record.status))}</span>
    </div>
    <div class="debt-amount-grid"><div><span>未精算</span><strong class="${open ? "" : "value-zero"}">${formatPtPlain(record.remaining_amount_pt)}</strong></div><div><span>元の額</span><strong>${formatPtPlain(record.original_amount_pt)}</strong></div></div>
    ${record.memo ? `<p class="debt-memo">${escapeHtml(record.memo)}</p>` : ""}
    ${open ? `<div class="debt-record-actions"><button class="secondary-button" type="button" data-open-debt-payment="${record.id}">支払いを記録</button><button class="secondary-button" type="button" data-open-debt-reroute="${record.id}">横流し</button><button class="danger-outline-button" type="button" data-cancel-debt="${record.id}">取消</button></div>` : ""}
    ${debtOpenPaymentId === record.id ? renderDebtPaymentForm(record) : ""}
    ${debtOpenRerouteId === record.id ? renderDebtRerouteForm(record) : ""}
    ${eventRows ? `<details class="debt-event-details"><summary>履歴を確認（${events.length}件）</summary><ul>${eventRows}</ul></details>` : ""}
  </article>`;
}
function renderDebtPage() {
  const page = getPageWorkspace();
  if (!currentSession) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DEBT</p><h2>ログインが必要です</h2><button id="debtBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("debtBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }
  if (!getActiveGroup()) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DEBT</p><h2>先にグループを作成してください</h2><button id="debtBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("debtBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }
  const openRecords = getOpenDebtRecords();
  const historyRecords = debtRecords.filter((record) => record.status !== "open");
  const displayed = debtViewMode === "open" ? openRecords : historyRecords;
  const openTotal = roundTo(openRecords.reduce((sum, record) => sum + num(record.remaining_amount_pt), 0), 2);
  const memberSummary = getDebtMemberSummary();
  const memberOptions = activeGroupMembers.map((member) => `<option value="${member.id}">${escapeHtml(member.display_name)}</option>`).join("");
  const createForm = activeGroupMembers.length >= 2 ? `<form id="debtCreateForm" class="debt-create-form">
    <div class="debt-form-grid"><label>支払う人<select name="debtorMemberId" required>${memberOptions}</select></label><label>受け取る人<select name="creditorMemberId" required>${memberOptions}</select></label><label>借pt（pt）<input name="amount" type="number" min="0.01" step="0.01" placeholder="例：5000" required></label><label>期限（任意）<input name="dueDate" type="date"></label></div>
    <label>メモ（任意）<input name="memo" type="text" maxlength="300" placeholder="例：前回分の精算"></label>
    <div class="debt-form-actions"><button class="primary-button" type="submit">借ptを追加</button></div><p id="debtCreateMessage" class="debt-form-message"></p>
  </form>` : `<p class="game-section-note">借ptを記録するには、グループに2人以上のメンバーが必要です。</p>`;
  page.innerHTML = `<section class="game-card debt-card">
    <div class="game-card-heading"><div><p class="eyebrow">DEBT</p><h2>借pt管理</h2></div><span class="debt-open-badge">未精算 ${formatPtPlain(openTotal)}</span></div>
    <p class="game-description">未精算の送金を残し、支払い・一部支払い・横流しを記録します。横流しは自動で行わず、対象と金額を選んだときだけ実行します。</p>
    ${debtMessage ? `<p class="settings-notice">${escapeHtml(debtMessage)}</p>` : ""}
    <section class="game-section"><p class="game-section-title">借ptを手動で追加</p>${createForm}</section>
    <section class="game-section"><p class="game-section-title">未精算サマリー</p><div class="debt-member-summary">${memberSummary.map((item) => `<div><span>${escapeHtml(item.member.display_name)}</span><small>支払 ${formatPtPlain(item.outgoing)} ／ 受取 ${formatPtPlain(item.incoming)}</small><strong class="signed-value ${signedClass(item.net)}">差額 ${formatPt(item.net)}</strong></div>`).join("")}</div></section>
    <section class="game-section"><div class="game-section-heading"><p class="game-section-title">借pt一覧</p><div class="debt-view-tabs"><button type="button" class="ranking-filter-button ${debtViewMode === "open" ? "active" : ""}" data-debt-view="open">未精算（${openRecords.length}）</button><button type="button" class="ranking-filter-button ${debtViewMode === "history" ? "active" : ""}" data-debt-view="history">履歴（${historyRecords.length}）</button></div></div><div class="debt-record-list">${displayed.length ? displayed.map(renderDebtRecord).join("") : `<p class="game-section-note">${debtViewMode === "open" ? "未精算の借ptはありません。" : "履歴はまだありません。"}</p>`}</div></section>
  </section>`;
  bindDebtPageEvents();
}
function bindDebtPageEvents() {
  document.querySelectorAll("[data-debt-view]").forEach((button) => button.addEventListener("click", () => { debtViewMode = button.dataset.debtView; debtOpenPaymentId = null; debtOpenRerouteId = null; renderDebtPage(); }));
  document.getElementById("debtCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("debtCreateMessage");
    const fd = new FormData(form);
    const debtorMemberId = String(fd.get("debtorMemberId") || "");
    const creditorMemberId = String(fd.get("creditorMemberId") || "");
    const amount = roundTo(num(fd.get("amount")), 2);
    if (debtorMemberId === creditorMemberId) { message.textContent = "支払う人と受け取る人を別にしてください。"; return; }
    if (amount <= 0) { message.textContent = "借ptは0より大きい値で入力してください。"; return; }
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("create_debt_record", {
        p_group_id: activeGroupId,
        p_debtor_member_id: debtorMemberId,
        p_creditor_member_id: creditorMemberId,
        p_amount_pt: amount,
        p_source_session_id: null,
        p_memo: String(fd.get("memo") || ""),
        p_due_date: String(fd.get("dueDate") || "") || null
      });
      if (error) throw error;
      debtMessage = "借ptを追加しました。";
      await loadDebtData();
    } catch (error) { message.textContent = error.message || "借ptを追加できませんでした。"; }
    finally { submit.disabled = false; }
  });
  document.querySelectorAll("[data-open-debt-payment]").forEach((button) => button.addEventListener("click", () => { debtOpenPaymentId = debtOpenPaymentId === button.dataset.openDebtPayment ? null : button.dataset.openDebtPayment; debtOpenRerouteId = null; renderDebtPage(); }));
  document.querySelectorAll("[data-close-debt-payment]").forEach((button) => button.addEventListener("click", () => { debtOpenPaymentId = null; renderDebtPage(); }));
  document.querySelectorAll("[data-open-debt-reroute]").forEach((button) => button.addEventListener("click", () => { debtOpenRerouteId = debtOpenRerouteId === button.dataset.openDebtReroute ? null : button.dataset.openDebtReroute; debtOpenPaymentId = null; renderDebtPage(); }));
  document.querySelectorAll("[data-close-debt-reroute]").forEach((button) => button.addEventListener("click", () => { debtOpenRerouteId = null; renderDebtPage(); }));
  document.querySelectorAll("[data-debt-payment-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const record = debtRecords.find((item) => item.id === form.dataset.debtPaymentForm);
    if (!record) return;
    const fd = new FormData(form);
    const amount = roundTo(num(fd.get("amount")), 2);
    const message = form.querySelector(".debt-form-message");
    if (amount <= 0 || amount > num(record.remaining_amount_pt)) { message.textContent = "支払額は未精算額の範囲で入力してください。"; return; }
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      markLocalRealtimeWrite();
      const paidDate = String(fd.get("paidDate") || todayInJapan());
      const { error } = await supabaseClient.rpc("mark_debt_payment", { p_debt_id: record.id, p_amount_pt: amount, p_paid_at: `${paidDate}T12:00:00+09:00`, p_memo: String(fd.get("memo") || "") });
      if (error) throw error;
      debtMessage = `${getMemberName(record.debtor_member_id)} → ${getMemberName(record.creditor_member_id)} の支払いを記録しました。`;
      debtOpenPaymentId = null;
      await loadDebtData();
    } catch (error) { message.textContent = error.message || "支払いを記録できませんでした。"; }
    finally { submit.disabled = false; }
  }));
  document.querySelectorAll("[data-debt-reroute-form]").forEach((form) => {
    const amountInput = form.querySelector('input[name="amount"]');
    const select = form.querySelector('select[name="upstreamDebtId"]');
    const hint = form.querySelector(".debt-reroute-hint");
    select?.addEventListener("change", () => {
      const option = select.selectedOptions[0];
      const max = num(option?.dataset.max);
      amountInput.max = String(max);
      amountInput.value = String(max);
      hint.textContent = `最大 ${formatPtPlain(max)} を横流しできます。`;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const downstream = debtRecords.find((item) => item.id === form.dataset.debtRerouteForm);
      if (!downstream) return;
      const fd = new FormData(form);
      const upstreamId = String(fd.get("upstreamDebtId") || "");
      const upstream = debtRecords.find((item) => item.id === upstreamId);
      const amount = roundTo(num(fd.get("amount")), 2);
      const max = Math.min(num(downstream.remaining_amount_pt), num(upstream?.remaining_amount_pt));
      const message = form.querySelector(".debt-form-message");
      if (!upstream || amount <= 0 || amount > max) { message.textContent = "横流し額は両方の未精算額以下で入力してください。"; return; }
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      try {
        markLocalRealtimeWrite();
        const { error } = await supabaseClient.rpc("reroute_debt_record", { p_upstream_debt_id: upstream.id, p_downstream_debt_id: downstream.id, p_amount_pt: amount, p_memo: String(fd.get("memo") || "") });
        if (error) throw error;
        debtMessage = `${formatPtPlain(amount)}を横流ししました。`;
        debtOpenRerouteId = null;
        await loadDebtData();
      } catch (error) { message.textContent = error.message || "横流しできませんでした。"; }
      finally { submit.disabled = false; }
    });
  });
  document.querySelectorAll("[data-cancel-debt]").forEach((button) => button.addEventListener("click", async () => {
    const record = debtRecords.find((item) => item.id === button.dataset.cancelDebt);
    if (!record || !window.confirm(`${getMemberName(record.debtor_member_id)} → ${getMemberName(record.creditor_member_id)} の未精算 ${formatPtPlain(record.remaining_amount_pt)} を取り消しますか？`)) return;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("cancel_debt_record", { p_debt_id: record.id, p_memo: "画面から取消" });
      if (error) throw error;
      debtMessage = "借ptをゴミ箱へ移しました。";
      await loadDebtData();
    } catch (error) { alert(error.message || "借ptを取り消せませんでした。"); }
  }));
}
function closeSettlementDebtModal() { document.querySelector(".debt-modal-overlay")?.remove(); }
async function openSettlementDebtModal(route) {
  try {
    await fetchDebtData();
    const alreadyRegistered = debtRecords.find((record) => record.source_session_id === activeMatchSessionId && record.debtor_member_id === route.fromMemberId && record.creditor_member_id === route.toMemberId);
    if (alreadyRegistered) {
      alert(`この送金ルートはすでに借ptとして登録されています。\n状態：${debtStatusLabel(alreadyRegistered.status)}\n借ptタブから支払い・横流しを管理してください。`);
      return;
    }
    const candidates = getOpenDebtRecords().filter((record) => record.creditor_member_id === route.fromMemberId && record.debtor_member_id !== route.toMemberId);
    const candidateOptions = candidates.length ? candidates.map((record) => `<option value="${record.id}" data-max="${roundTo(Math.min(num(record.remaining_amount_pt), num(route.amount)), 2)}">${escapeHtml(getMemberName(record.debtor_member_id))} → ${escapeHtml(getMemberName(record.creditor_member_id))}（未精算 ${formatPtPlain(record.remaining_amount_pt)}）</option>`).join("") : "";
    closeSettlementDebtModal();
    document.body.insertAdjacentHTML("beforeend", `<div class="debt-modal-overlay"><section class="debt-modal" role="dialog" aria-modal="true"><button type="button" class="debt-modal-close">×</button><p class="eyebrow">REGISTER DEBT</p><h2>送金ルートを借ptへ登録</h2><div class="debt-modal-route"><span>${escapeHtml(route.from)} → ${escapeHtml(route.to)}</span><strong>${formatPtPlain(route.amount)}</strong></div><p>この送金を未精算の借ptとして保存します。横流しは任意です。</p><form id="settlementDebtForm" class="debt-create-form"><label class="debt-checkbox"><input type="checkbox" name="useReroute" ${candidates.length ? "" : "disabled"}><span><strong>既存の未精算借ptを横流しする</strong><small>${candidates.length ? "横流し元と金額を選びます。" : `${escapeHtml(route.from)}へ支払う横流し候補はありません。`}</small></span></label><div id="settlementReroutePanel" class="settlement-reroute-panel" hidden>${candidates.length ? `<label>横流し元（A → ${escapeHtml(route.from)}）<select name="upstreamDebtId">${candidateOptions}</select></label><label>横流し額（pt）<input name="rerouteAmount" type="number" min="0.01" max="${roundTo(Math.min(num(candidates[0].remaining_amount_pt), num(route.amount)), 2)}" step="0.01" value="${roundTo(Math.min(num(candidates[0].remaining_amount_pt), num(route.amount)), 2)}"></label><p class="debt-reroute-hint">新しい送金のうち指定額だけを横流しします。</p>` : ""}</div><label>メモ（任意）<input name="memo" type="text" maxlength="300" value="${escapeHtml(`${formatDate(activeMatchSession?.session_date || "")}の精算より`)}"></label><div class="debt-form-actions"><button class="primary-button" type="submit">借ptへ登録</button><button class="secondary-button" type="button" id="cancelSettlementDebtButton">閉じる</button></div><p class="debt-form-message"></p></form></section></div>`);
    const overlay = document.querySelector(".debt-modal-overlay");
    const form = document.getElementById("settlementDebtForm");
    const checkbox = form.querySelector('input[name="useReroute"]');
    const panel = document.getElementById("settlementReroutePanel");
    const select = panel?.querySelector('select[name="upstreamDebtId"]');
    const amountInput = panel?.querySelector('input[name="rerouteAmount"]');
    const hint = panel?.querySelector(".debt-reroute-hint");
    document.querySelector(".debt-modal-close")?.addEventListener("click", closeSettlementDebtModal);
    document.getElementById("cancelSettlementDebtButton")?.addEventListener("click", closeSettlementDebtModal);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closeSettlementDebtModal(); });
    checkbox?.addEventListener("change", () => { panel.hidden = !checkbox.checked; });
    select?.addEventListener("change", () => {
      const max = num(select.selectedOptions[0]?.dataset.max);
      amountInput.max = String(max);
      amountInput.value = String(max);
      hint.textContent = `最大 ${formatPtPlain(max)} を横流しできます。`;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const message = form.querySelector(".debt-form-message");
      const submit = form.querySelector("button[type=submit]");
      let rerouteAmount = 0;
      let upstream = null;
      if (checkbox?.checked) {
        upstream = debtRecords.find((record) => record.id === String(fd.get("upstreamDebtId") || ""));
        rerouteAmount = roundTo(num(fd.get("rerouteAmount")), 2);
        const max = Math.min(num(upstream?.remaining_amount_pt), num(route.amount));
        if (!upstream || rerouteAmount <= 0 || rerouteAmount > max) { message.textContent = "横流し額は候補と新しい送金の未精算額以下で入力してください。"; return; }
      }
      submit.disabled = true;
      try {
        markLocalRealtimeWrite();
        const { data, error } = await supabaseClient.rpc("create_debt_record", { p_group_id: activeGroupId, p_debtor_member_id: route.fromMemberId, p_creditor_member_id: route.toMemberId, p_amount_pt: route.amount, p_source_session_id: activeMatchSessionId, p_memo: String(fd.get("memo") || ""), p_due_date: null });
        if (error) throw error;
        const newDebtId = data?.debt_id;
        if (checkbox?.checked && newDebtId) {
          const rerouteResponse = await supabaseClient.rpc("reroute_debt_record", { p_upstream_debt_id: upstream.id, p_downstream_debt_id: newDebtId, p_amount_pt: rerouteAmount, p_memo: "精算登録時に横流し" });
          if (rerouteResponse.error) throw rerouteResponse.error;
        }
        debtMessage = checkbox?.checked ? `送金ルートを借ptへ登録し、${formatPtPlain(rerouteAmount)}を横流ししました。` : "送金ルートを借ptへ登録しました。";
        closeSettlementDebtModal();
        gameMessage = "送金ルートを借ptへ登録しました。";
        await loadMatchSessions();
      } catch (error) {
        message.textContent = error.message || "借ptへ登録できませんでした。";
      } finally { submit.disabled = false; }
    });
  } catch (error) { alert(error.message || "借ptの登録画面を開けませんでした。"); }
}

function renderPlaceholderView(tab) {
  const page = getPageWorkspace(); const data = { ranking: { eyebrow: "RANKING", title: "ランキングを読み込み中です", text: "" }, debt: { eyebrow: "DEBT", title: "借ptを読み込み中です", text: "" }, settings: { eyebrow: "SETTINGS", title: "設定画面は次に実装します", text: "招待コード再発行、表示名変更、グループ設定をここにまとめます。" } }[tab] || { eyebrow: "JAKUROKU", title: "画面を読み込み中です", text: "" };
  page.innerHTML = `<section class="workspace-card"><p class="eyebrow">${data.eyebrow}</p><h2>${data.title}</h2><p class="workspace-description">${data.text}</p><button id="placeholderHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`; document.getElementById("placeholderHomeButton").addEventListener("click", () => switchTab("home"));
}

async function initializeSupabase() {
  if (!SUPABASE_URL.startsWith("https://") || !SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) { setHeroStatus("Supabase接続情報を設定してください", true); return; }
  if (!window.supabase) { setHeroStatus("Supabaseライブラリの読み込みに失敗しました", true); return; }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data: { session } } = await supabaseClient.auth.getSession(); await updateAuthUI(session); supabaseClient.auth.onAuthStateChange((_event, value) => { void updateAuthUI(value); });
}


/* v22: trash and restore */
function ensureTrashNavigation() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav || nav.querySelector('[data-tab="trash"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item";
  button.dataset.tab = "trash";
  button.innerHTML = `<span>箱</span><small>ゴミ箱</small>`;
  const settingsButton = nav.querySelector('[data-tab="settings"]');
  nav.insertBefore(button, settingsButton || null);
  navItems = document.querySelectorAll(".nav-item");
  button.addEventListener("click", () => { void switchTab("trash"); });
}
ensureTrashNavigation();

function formatTrashDate(value) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}
function trashDaysLeft(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 30;
  const limit = date.getTime() + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((limit - Date.now()) / (24 * 60 * 60 * 1000)));
}
function canPermanentlyDeleteTrashItem(value) {
  return trashDaysLeft(value) === 0;
}
function isActiveGroupAdmin() {
  return getActiveGroup()?.membership?.role === "admin";
}

async function loadTrashData() {
  const page = getPageWorkspace();
  if (!currentSession || !activeGroupId) {
    renderTrashPage();
    return;
  }
  page.innerHTML = `<section class="workspace-card loading-card">ゴミ箱を読み込み中...</section>`;
  try {
    const [sessionsResponse, debtsResponse] = await Promise.all([
      supabaseClient
        .from("match_sessions")
        .select("id, group_id, session_date, game_mode, rate_label, status, deleted_at, deleted_by, deleted_reason, created_at")
        .eq("group_id", activeGroupId)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabaseClient
        .from("debt_records")
        .select("id, group_id, debtor_member_id, creditor_member_id, original_amount_pt, remaining_amount_pt, status, record_kind, memo, cancelled_at, cancelled_by, cancelled_reason, created_at")
        .eq("group_id", activeGroupId)
        .eq("status", "cancelled")
        .not("cancelled_at", "is", null)
        .order("cancelled_at", { ascending: false })
    ]);
    if (sessionsResponse.error) throw sessionsResponse.error;
    if (debtsResponse.error) throw debtsResponse.error;
    trashSessions = sessionsResponse.data || [];
    trashDebtRecords = debtsResponse.data || [];
    renderTrashPage();
  } catch (error) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">TRASH</p><h2>ゴミ箱を読み込めませんでした</h2><p class="workspace-description">${escapeHtml(error.message || "通信状態を確認してください。")}</p><button id="retryTrashButton" class="primary-button" type="button">再読み込み</button></section>`;
    document.getElementById("retryTrashButton")?.addEventListener("click", () => { void loadTrashData(); });
  }
}

function renderTrashSessionCard(session) {
  const left = trashDaysLeft(session.deleted_at);
  const canDelete = isActiveGroupAdmin() && canPermanentlyDeleteTrashItem(session.deleted_at);
  const permanent = canDelete
    ? `<button type="button" class="danger-outline-button" data-permanent-session-id="${session.id}">完全に削除</button>`
    : `<small class="trash-retention-note">完全削除は${left ? `あと${left}日` : "管理者のみ"}利用できます。</small>`;
  return `<article class="trash-record-card">
    <div class="trash-record-heading"><div><p class="trash-record-title">${escapeHtml(formatDate(session.session_date))} ／ ${escapeHtml(getModeLabel(session.game_mode))}</p><small>${escapeHtml(session.rate_label || "レート未設定")} ／ ${session.status === "settled" ? "精算済み" : "進行中"}</small></div><span class="trash-kind-badge">日次記録</span></div>
    <p class="trash-meta">ゴミ箱へ移動：${escapeHtml(formatTrashDate(session.deleted_at))}${session.deleted_reason ? ` ／ ${escapeHtml(session.deleted_reason)}` : ""}</p>
    <div class="trash-record-actions"><button type="button" class="primary-button" data-restore-session-id="${session.id}">復元</button>${permanent}</div>
  </article>`;
}

function renderTrashDebtCard(record) {
  const left = trashDaysLeft(record.cancelled_at);
  const canDelete = isActiveGroupAdmin() && canPermanentlyDeleteTrashItem(record.cancelled_at);
  const permanent = canDelete
    ? `<button type="button" class="danger-outline-button" data-permanent-debt-id="${record.id}">完全に削除</button>`
    : `<small class="trash-retention-note">完全削除は${left ? `あと${left}日` : "管理者のみ"}利用できます。</small>`;
  return `<article class="trash-record-card">
    <div class="trash-record-heading"><div><p class="trash-record-title">${escapeHtml(getMemberName(record.debtor_member_id))} <b>→</b> ${escapeHtml(getMemberName(record.creditor_member_id))}</p><small>${escapeHtml(debtKindLabel(record.record_kind))} ／ 元の借pt ${formatPtPlain(record.original_amount_pt)}</small></div><span class="trash-kind-badge debt">借pt</span></div>
    <p class="trash-amount">取消時の未精算額：<strong>${formatPtPlain(record.remaining_amount_pt)}</strong></p>
    <p class="trash-meta">ゴミ箱へ移動：${escapeHtml(formatTrashDate(record.cancelled_at))}${record.cancelled_reason ? ` ／ ${escapeHtml(record.cancelled_reason)}` : ""}</p>
    <div class="trash-record-actions"><button type="button" class="primary-button" data-restore-debt-id="${record.id}">復元</button>${permanent}</div>
  </article>`;
}

function renderTrashPage() {
  const page = getPageWorkspace();
  if (!currentSession) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">TRASH</p><h2>ログインが必要です</h2><button id="trashBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("trashBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }
  if (!getActiveGroup()) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">TRASH</p><h2>先にグループを作成してください</h2><button id="trashBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("trashBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }
  const sessionPane = trashViewMode === "sessions";
  const records = sessionPane ? trashSessions : trashDebtRecords;
  page.innerHTML = `<section class="game-card trash-card">
    <div class="game-card-heading"><div><p class="eyebrow">TRASH</p><h2>ゴミ箱</h2></div><span class="trash-count-badge">${trashSessions.length + trashDebtRecords.length}件</span></div>
    <p class="game-description">削除・取消した記録はここへ移動します。復元すると元の画面と集計に戻ります。完全削除はゴミ箱へ移してから30日後に管理者だけ実行できます。</p>
    ${trashMessage ? `<p class="settings-notice">${escapeHtml(trashMessage)}</p>` : ""}
    <div class="trash-tabs"><button type="button" class="ranking-filter-button ${sessionPane ? "active" : ""}" data-trash-view="sessions">日次記録（${trashSessions.length}）</button><button type="button" class="ranking-filter-button ${!sessionPane ? "active" : ""}" data-trash-view="debts">借pt（${trashDebtRecords.length}）</button></div>
    <div class="trash-record-list">${records.length ? (sessionPane ? records.map(renderTrashSessionCard).join("") : records.map(renderTrashDebtCard).join("")) : `<p class="game-section-note">${sessionPane ? "ゴミ箱にある日次記録はありません。" : "ゴミ箱にある借ptはありません。"}</p>`}</div>
  </section>`;
  bindTrashPageEvents();
}

function bindTrashPageEvents() {
  document.querySelectorAll("[data-trash-view]").forEach((button) => button.addEventListener("click", () => {
    trashViewMode = button.dataset.trashView;
    renderTrashPage();
  }));
  document.querySelectorAll("[data-restore-session-id]").forEach((button) => button.addEventListener("click", async () => {
    const session = trashSessions.find((item) => item.id === button.dataset.restoreSessionId);
    if (!session || !confirm(`${formatDate(session.session_date)}の記録を復元しますか？`)) return;
    button.disabled = true;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("restore_match_session", { p_session_id: session.id });
      if (error) throw error;
      trashMessage = `${formatDate(session.session_date)}の記録を復元しました。`;
      await loadTrashData();
    } catch (error) { alert(error.message || "日次記録を復元できませんでした。"); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll("[data-restore-debt-id]").forEach((button) => button.addEventListener("click", async () => {
    const record = trashDebtRecords.find((item) => item.id === button.dataset.restoreDebtId);
    if (!record || !confirm(`${getMemberName(record.debtor_member_id)} → ${getMemberName(record.creditor_member_id)} の借ptを復元しますか？`)) return;
    button.disabled = true;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("restore_cancelled_debt_record", { p_debt_id: record.id });
      if (error) throw error;
      trashMessage = "借ptを復元しました。";
      await loadTrashData();
    } catch (error) { alert(error.message || "借ptを復元できませんでした。"); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll("[data-permanent-session-id]").forEach((button) => button.addEventListener("click", async () => {
    const session = trashSessions.find((item) => item.id === button.dataset.permanentSessionId);
    if (!session || !confirm(`${formatDate(session.session_date)}の記録を完全に削除しますか？\nこの操作は復元できません。`)) return;
    button.disabled = true;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("permanently_delete_match_session", { p_session_id: session.id });
      if (error) throw error;
      trashMessage = "日次記録を完全に削除しました。";
      await loadTrashData();
    } catch (error) { alert(error.message || "完全削除できませんでした。"); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll("[data-permanent-debt-id]").forEach((button) => button.addEventListener("click", async () => {
    const record = trashDebtRecords.find((item) => item.id === button.dataset.permanentDebtId);
    if (!record || !confirm(`${getMemberName(record.debtor_member_id)} → ${getMemberName(record.creditor_member_id)} の借ptを完全に削除しますか？\nこの操作は復元できません。`)) return;
    button.disabled = true;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("permanently_delete_debt_record", { p_debt_id: record.id });
      if (error) throw error;
      trashMessage = "借ptを完全に削除しました。";
      await loadTrashData();
    } catch (error) { alert(error.message || "完全削除できませんでした。"); }
    finally { button.disabled = false; }
  }));
}

async function switchTab(tab) {
  currentTab = tab;
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
  const home = tab === "home";
  heroCard.hidden = !home;
  roadmapSection.hidden = !home;
  getGroupWorkspace().hidden = !home || !currentSession;
  getPageWorkspace().hidden = home;
  if (home) { if (currentSession) renderGroupWorkspace(); return; }
  if (tab === "game") { await loadMatchSessions(); return; }
  if (tab === "ranking") { await loadRankingData(); return; }
  if (tab === "debt") { await loadDebtData(); return; }
  if (tab === "trash") { await loadTrashData(); return; }
  if (tab === "settings") { await loadExportPeriodOptions(); renderSettingsPage(); return; }
  renderPlaceholderView(tab);
}

async function refreshCurrentViewFromRealtime(force = false) {
  clearRealtimeRefreshTimer();
  if (!currentSession || !activeGroupId) return;
  if (!force && isRealtimeInputInProgress()) {
    realtimePendingRefresh = true;
    showRealtimeUpdateBanner();
    return;
  }
  realtimePendingRefresh = false;
  removeRealtimeUpdateBanner();
  try {
    if (currentTab === "game") await loadMatchSessions();
    else if (currentTab === "ranking") await loadRankingData();
    else if (currentTab === "debt") await loadDebtData();
    else if (currentTab === "trash") await loadTrashData();
    else if (currentTab === "settings" || currentTab === "home") await loadGroups();
  } catch (error) {
    console.error("Realtime更新の反映に失敗しました。", error);
  }
}

async function deleteActiveMatchSession() {
  if (!activeMatchSession) return;
  const label = formatDate(activeMatchSession.session_date);
  if (!window.confirm(`${label}の記録をゴミ箱へ移しますか？\n半荘、チップ、場代、役満記録もまとめて非表示になります。ゴミ箱から30日間は復元できます。`)) return;
  try {
    markLocalRealtimeWrite();
    const { error } = await supabaseClient.rpc("delete_match_session", { p_session_id: activeMatchSessionId });
    if (error) throw error;
    gameMessage = "日次記録をゴミ箱へ移しました。";
    activeMatchSessionId = null;
    localStorage.removeItem("jakuroku-active-match-session-id");
    resetMatchViewState();
    await loadMatchSessions();
  } catch (error) {
    alert(error.message || "日次記録をゴミ箱へ移せませんでした。");
  }
}

if ("serviceWorker" in navigator && location.protocol !== "file:") window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch((error) => console.error("Service Workerの登録に失敗しました。", error)));
initializeSupabase();


/* v23: group activity history */
let activityLogs = [];
let activityFilter = "all";
let activityLoadLimit = 50;
let activityRealtimeChannel = null;
let activityRealtimeGroupId = null;

function activityActorName(userId) {
  if (userId && userId === currentSession?.user?.id) return "あなた";
  return activeGroupMembers.find((member) => member.user_id === userId)?.display_name || "メンバー";
}

function activityCategory(eventType) {
  if (["debt_created", "debt_paid", "debt_rerouted", "debt_cancelled", "debt_restored"].includes(eventType)) return "debt";
  if (["group_edited", "member_edited", "invite_code_regenerated"].includes(eventType)) return "settings";
  return "game";
}

function activityCategoryLabel(category) {
  return ({ all: "すべて", game: "対局", debt: "借pt", settings: "設定" })[category] || "その他";
}

function activityEventLabel(eventType) {
  return ({
    session_created: "日次記録を作成",
    session_settled: "1日の精算を確定",
    session_edited: "日次記録を編集",
    session_trashed: "日次記録をゴミ箱へ移動",
    session_restored: "日次記録を復元",
    hanchan_created: "半荘を追加",
    hanchan_edited: "半荘を編集",
    hanchan_deleted: "半荘を削除",
    chips_edited: "終了時チップを編集",
    venue_edited: "場代・先払いを編集",
    debt_created: "借ptを追加",
    debt_paid: "借ptの支払いを記録",
    debt_rerouted: "借ptを横流し",
    debt_cancelled: "借ptをゴミ箱へ移動",
    debt_restored: "借ptを復元",
    group_edited: "グループ設定を編集",
    member_edited: "メンバー設定を編集",
    invite_code_regenerated: "招待コードを再発行"
  })[eventType] || "操作";
}

function formatActivityTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(value));
}

function plainActivityValue(value) {
  if (value === null || value === undefined || value === "") return "未設定";
  if (typeof value === "number") return formatNumber(value, 2);
  return String(value);
}

function activityMemberLabel(memberId) {
  return getMemberName(memberId);
}

function activityResultSnapshot(results) {
  return (results || []).map((row) => ({
    member: row.member || activityMemberLabel(row.member_id),
    rank: Number(row.rank),
    final_points: Number(row.final_points ?? row.finalPoints ?? 0)
  })).sort((a, b) => a.rank - b.rank);
}

function snapshotHanchanForActivity(hanchanId) {
  const hanchan = activeHanchans.find((item) => item.id === hanchanId);
  return {
    uma: [...(hanchan?.uma || [])],
    notes: hanchan?.notes || "",
    results: activityResultSnapshot(activeHanchanResults.filter((item) => item.hanchan_id === hanchanId)),
    tobi: activeTobiTransfers.filter((item) => item.hanchan_id === hanchanId).map((item) => ({
      from: activityMemberLabel(item.from_member_id), to: activityMemberLabel(item.to_member_id), points: num(item.points)
    })),
    yakumans: activeYakumanRecords.filter((item) => item.hanchan_id === hanchanId).map((item) => ({
      winner: activityMemberLabel(item.winner_member_id), name: item.yakuman_name, win_type: item.win_type,
      houjuu: item.houjuu_member_id ? activityMemberLabel(item.houjuu_member_id) : ""
    }))
  };
}

function snapshotDebtForActivity(debtId) {
  const debt = debtRecords.find((item) => item.id === debtId) || trashDebtRecords.find((item) => item.id === debtId);
  if (!debt) return null;
  return {
    debtor: activityMemberLabel(debt.debtor_member_id),
    creditor: activityMemberLabel(debt.creditor_member_id),
    original_amount_pt: num(debt.original_amount_pt),
    remaining_amount_pt: num(debt.remaining_amount_pt),
    status: debt.status,
    memo: debt.memo || ""
  };
}

function snapshotForActivityRpc(name, args) {
  if (name === "update_match_hanchan" || name === "delete_match_hanchan") return snapshotHanchanForActivity(args?.p_hanchan_id);
  if (name === "set_match_session_chips") return {
    chips: activeMatchMembers.map((member) => ({ member: activityMemberLabel(member.member_id), chip_count: num(activeSessionChips.find((item) => item.member_id === member.member_id)?.chip_count) }))
  };
  if (name === "set_match_session_venue_costs") return {
    venue_fee_total: num(activeMatchSession?.venue_fee_total),
    prepayments: activeMatchMembers.map((member) => ({ member: activityMemberLabel(member.member_id), paid_pt: num(activeVenuePrepayments.find((item) => item.member_id === member.member_id)?.paid_molly) }))
  };
  if (["close_match_session", "delete_match_session", "restore_match_session", "permanently_delete_match_session"].includes(name)) {
    return { session_date: activeMatchSession?.session_date || "", status: activeMatchSession?.status || "" };
  }
  if (["mark_debt_payment", "reroute_debt_record", "cancel_debt_record", "restore_cancelled_debt_record", "permanently_delete_debt_record"].includes(name)) {
    return snapshotDebtForActivity(args?.p_debt_id || args?.p_upstream_debt_id || args?.p_downstream_debt_id);
  }
  if (name === "update_group_name") return { group_name: getActiveGroup()?.name || "" };
  if (name === "update_my_group_display_name") return { display_name: getCurrentGroupMembership()?.display_name || "" };
  if (name === "update_group_member_role") {
    const member = activeGroupMembers.find((item) => item.id === args?.p_member_id);
    return member ? { member_name: member.display_name, role: member.role } : null;
  }
  return null;
}

function afterSnapshotForActivityRpc(name, args, result) {
  if (name === "update_match_hanchan") {
    return {
      uma: [...(args?.p_uma || [])],
      notes: args?.p_notes || "",
      results: activityResultSnapshot(args?.p_results || []),
      tobi: (args?.p_tobi_transfers || []).map((item) => ({ from: activityMemberLabel(item.from_member_id), to: activityMemberLabel(item.to_member_id), points: num(item.points) })),
      yakumans: (args?.p_yakuman_records || []).map((item) => ({ winner: activityMemberLabel(item.winner_member_id), name: item.yakuman_name, win_type: item.win_type, houjuu: item.houjuu_member_id ? activityMemberLabel(item.houjuu_member_id) : "" }))
    };
  }
  if (name === "add_match_hanchan") return { session_id: args?.p_session_id, uma: [...(args?.p_uma || [])], results: activityResultSnapshot(args?.p_results || []) };
  if (name === "set_match_session_chips") return { chips: (args?.p_chip_results || []).map((item) => ({ member: activityMemberLabel(item.member_id), chip_count: num(item.chip_count) })) };
  if (name === "set_match_session_venue_costs") return { venue_fee_total: num(args?.p_venue_fee_total), prepayments: (args?.p_prepayments || []).map((item) => ({ member: activityMemberLabel(item.member_id), paid_pt: num(item.paid_molly) })) };
  if (name === "create_match_session") return { session_date: args?.p_session_date, game_mode: getModeLabel(args?.p_game_mode), rate_label: args?.p_rate_label, starting_points: num(args?.p_starting_points), chip_value: num(args?.p_chip_value) };
  if (name === "create_debt_record") return { debtor: activityMemberLabel(args?.p_debtor_member_id), creditor: activityMemberLabel(args?.p_creditor_member_id), amount_pt: num(args?.p_amount_pt), memo: args?.p_memo || "" };
  if (name === "mark_debt_payment") return { amount_pt: num(args?.p_amount_pt), paid_at: args?.p_paid_at || "" };
  if (name === "reroute_debt_record") return { amount_pt: num(args?.p_amount_pt), memo: args?.p_memo || "" };
  if (name === "update_group_name") return { group_name: args?.p_group_name || "" };
  if (name === "update_my_group_display_name") return { display_name: args?.p_display_name || "" };
  if (name === "update_group_member_role") return { role: args?.p_role || "" };
  if (name === "close_match_session") return { status: "settled" };
  if (name === "delete_match_session" || name === "restore_match_session") return { action: name === "delete_match_session" ? "trashed" : "restored" };
  return null;
}

function activityPayloadForRpc(name, args, result, before) {
  const after = afterSnapshotForActivityRpc(name, args, result);
  const entityByName = {
    create_match_session: "session", close_match_session: "session", delete_match_session: "session", restore_match_session: "session", permanently_delete_match_session: "session",
    add_match_hanchan: "hanchan", update_match_hanchan: "hanchan", delete_match_hanchan: "hanchan",
    set_match_session_chips: "session", set_match_session_venue_costs: "session",
    create_debt_record: "debt", mark_debt_payment: "debt", reroute_debt_record: "debt", cancel_debt_record: "debt", restore_cancelled_debt_record: "debt", permanently_delete_debt_record: "debt",
    update_group_name: "group", regenerate_group_invite_code: "group", update_my_group_display_name: "member", update_group_member_role: "member"
  };
  const eventByName = {
    create_match_session: "session_created", close_match_session: "session_settled", delete_match_session: "session_trashed", restore_match_session: "session_restored",
    add_match_hanchan: "hanchan_created", update_match_hanchan: "hanchan_edited", delete_match_hanchan: "hanchan_deleted",
    set_match_session_chips: "chips_edited", set_match_session_venue_costs: "venue_edited",
    create_debt_record: "debt_created", mark_debt_payment: "debt_paid", reroute_debt_record: "debt_rerouted", cancel_debt_record: "debt_cancelled", restore_cancelled_debt_record: "debt_restored",
    update_group_name: "group_edited", update_my_group_display_name: "member_edited", update_group_member_role: "member_edited", regenerate_group_invite_code: "invite_code_regenerated"
  };
  const eventType = eventByName[name];
  const entityType = entityByName[name];
  if (!eventType || !entityType) return null;
  const entityId = result?.data?.debt_id || result?.data?.rerouted_debt_id || (typeof result?.data === "string" ? result.data : null) || args?.p_hanchan_id || args?.p_session_id || args?.p_debt_id || args?.p_upstream_debt_id || args?.p_group_id || activeGroupId || null;
  const date = args?.p_session_date || before?.session_date || activeMatchSession?.session_date || "";
  const summaryByName = {
    create_match_session: `${date ? `${formatDate(date)}の` : ""}日次記録を作成しました。`,
    close_match_session: `${date ? `${formatDate(date)}の` : ""}1日の精算を確定しました。`,
    delete_match_session: `${date ? `${formatDate(date)}の` : ""}日次記録をゴミ箱へ移しました。`,
    restore_match_session: "日次記録をゴミ箱から復元しました。",
    add_match_hanchan: "半荘を追加しました。",
    update_match_hanchan: "半荘結果を編集しました。",
    delete_match_hanchan: "半荘を削除しました。",
    set_match_session_chips: "終了時チップを編集しました。",
    set_match_session_venue_costs: "場代・先払いを編集しました。",
    create_debt_record: "借ptを追加しました。",
    mark_debt_payment: "借ptの支払いを記録しました。",
    reroute_debt_record: "借ptを横流ししました。",
    cancel_debt_record: "借ptをゴミ箱へ移しました。",
    restore_cancelled_debt_record: "借ptをゴミ箱から復元しました。",
    update_group_name: "グループ名を変更しました。",
    update_my_group_display_name: "自分の表示名を変更しました。",
    update_group_member_role: "メンバー権限を変更しました。",
    regenerate_group_invite_code: "招待コードを再発行しました。"
  };
  return {
    groupId: args?.p_group_id || activeGroupId,
    eventType,
    entityType,
    entityId,
    summary: summaryByName[name] || "操作を記録しました。",
    details: { before: before || null, after: after || null, source: "app" }
  };
}

async function recordActivity(payload) {
  if (!payload?.groupId || !supabaseClient) return;
  const { error } = await supabaseClient.rpc("record_group_activity", {
    p_group_id: payload.groupId,
    p_event_type: payload.eventType,
    p_entity_type: payload.entityType,
    p_entity_id: payload.entityId,
    p_summary: payload.summary,
    p_details: payload.details || {}
  });
  if (error) throw error;
}

function installActivityRpcLogger() {
  if (!supabaseClient || supabaseClient.__jakurokuActivityLoggerInstalled) return;
  const originalRpc = supabaseClient.rpc.bind(supabaseClient);
  supabaseClient.__jakurokuActivityLoggerInstalled = true;
  supabaseClient.rpc = async (name, args = {}, options) => {
    if (name === "record_group_activity") return originalRpc(name, args, options);
    const before = snapshotForActivityRpc(name, args);
    const result = await originalRpc(name, args, options);
    if (!result?.error) {
      const payload = activityPayloadForRpc(name, args, result, before);
      if (payload) {
        try { await recordActivity(payload); }
        catch (error) { console.warn("編集履歴の記録に失敗しました。", error); }
      }
    }
    return result;
  };
}

async function loadActivityLogs() {
  if (!supabaseClient || !activeGroupId || !currentSession) { activityLogs = []; return; }
  const { data, error } = await supabaseClient
    .from("group_activity_logs")
    .select("id, group_id, actor_user_id, event_type, entity_type, entity_id, summary, details, created_at")
    .eq("group_id", activeGroupId)
    .order("created_at", { ascending: false })
    .range(0, Math.max(activityLoadLimit - 1, 0));
  if (error) throw error;
  activityLogs = data || [];
}

function activitySnapshotHtml(value, side) {
  if (!value) return `<p class="activity-detail-empty">${side}の情報はありません。</p>`;
  const rows = [];
  if (value.group_name !== undefined) rows.push(["グループ名", plainActivityValue(value.group_name)]);
  if (value.display_name !== undefined) rows.push(["表示名", plainActivityValue(value.display_name)]);
  if (value.member_name !== undefined) rows.push(["対象メンバー", plainActivityValue(value.member_name)]);
  if (value.role !== undefined) rows.push(["権限", value.role === "admin" ? "管理者" : "メンバー"]);
  if (value.session_date !== undefined) rows.push(["日付", formatDate(value.session_date)]);
  if (value.game_mode !== undefined) rows.push(["形式", plainActivityValue(value.game_mode)]);
  if (value.rate_label !== undefined) rows.push(["レート", plainActivityValue(value.rate_label)]);
  if (value.starting_points !== undefined) rows.push(["初期持ち点", `${formatNumber(value.starting_points)}点`]);
  if (value.chip_value !== undefined) rows.push(["チップ単価", `${formatNumber(value.chip_value, 1)}`]);
  if (value.status !== undefined) rows.push(["状態", plainActivityValue(value.status)]);
  if (value.debtor !== undefined) rows.push(["借pt", `${plainActivityValue(value.debtor)} → ${plainActivityValue(value.creditor)}`]);
  if (value.amount_pt !== undefined) rows.push(["金額", formatPtPlain(value.amount_pt)]);
  if (value.original_amount_pt !== undefined) rows.push(["元の金額", formatPtPlain(value.original_amount_pt)]);
  if (value.remaining_amount_pt !== undefined) rows.push(["未精算額", formatPtPlain(value.remaining_amount_pt)]);
  if (value.venue_fee_total !== undefined) rows.push(["場代合計", formatPtPlain(value.venue_fee_total)]);
  if (value.uma?.length) rows.push(["ウマ", value.uma.map((item) => formatScore(item)).join(" / ")]);
  if (value.results?.length) rows.push(["結果", value.results.map((item) => `${item.rank}位 ${item.member} ${formatNumber(item.final_points)}点`).join(" ／ ")]);
  if (value.chips?.length) rows.push(["チップ", value.chips.map((item) => `${item.member} ${signPrefix(num(item.chip_count))}${formatNumber(item.chip_count, 1)}枚`).join(" ／ ")]);
  if (value.prepayments?.length) rows.push(["先払い", value.prepayments.map((item) => `${item.member} ${formatPtPlain(item.paid_pt)}`).join(" ／ ")]);
  if (value.tobi?.length) rows.push(["飛ばし点", value.tobi.map((item) => `${item.from}→${item.to} ${formatScore(item.points)}`).join(" ／ ")]);
  if (value.yakumans?.length) rows.push(["役満", value.yakumans.map((item) => `${item.winner} ${item.name}`).join(" ／ ")]);
  if (value.notes !== undefined && value.notes !== "") rows.push(["メモ", value.notes]);
  if (!rows.length) return `<p class="activity-detail-empty">${side}の情報はありません。</p>`;
  return `<dl class="activity-diff-list">${rows.map(([label, content]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(content)}</dd></div>`).join("")}</dl>`;
}

function renderActivityLog(log) {
  const category = activityCategory(log.event_type);
  const details = log.details || {};
  const hasDiff = details.before || details.after;
  return `<article class="activity-log-card">
    <div class="activity-log-heading">
      <div><span class="activity-type-badge ${category}">${escapeHtml(activityCategoryLabel(category))}</span><p>${escapeHtml(activityEventLabel(log.event_type))}</p></div>
      <time>${escapeHtml(formatActivityTime(log.created_at))}</time>
    </div>
    <p class="activity-log-summary"><strong>${escapeHtml(activityActorName(log.actor_user_id))}</strong> ${escapeHtml(log.summary)}</p>
    ${hasDiff ? `<details class="activity-details"><summary>変更前後を確認</summary><div class="activity-diff-grid"><div><span>変更前</span>${activitySnapshotHtml(details.before, "変更前")}</div><div><span>変更後</span>${activitySnapshotHtml(details.after, "変更後")}</div></div></details>` : ""}
  </article>`;
}

function injectActivityHistorySection() {
  const page = getPageWorkspace();
  if (!page || !currentSession || !getActiveGroup() || page.querySelector(".activity-history-section")) return;
  const parent = page.querySelector(".data-export-section") || page.querySelector(".settings-section:last-of-type");
  if (!parent) return;
  const filtered = activityFilter === "all" ? activityLogs : activityLogs.filter((log) => activityCategory(log.event_type) === activityFilter);
  const section = document.createElement("section");
  section.className = "settings-section activity-history-section";
  section.innerHTML = `<div class="settings-section-heading"><div><p class="eyebrow">ACTIVITY LOG</p><h3>編集履歴</h3></div><span class="member-role-badge">直近${activityLogs.length}件</span></div>
    <p class="settings-help">この更新以降の操作を記録します。誰がいつ何を変更したか、変更前後を確認できます。</p>
    <div class="activity-filter-tabs">${["all", "game", "debt", "settings"].map((type) => `<button type="button" class="ranking-filter-button ${activityFilter === type ? "active" : ""}" data-activity-filter="${type}">${activityCategoryLabel(type)}</button>`).join("")}</div>
    <div class="activity-log-list">${filtered.length ? filtered.map(renderActivityLog).join("") : `<p class="game-section-note">${activityFilter === "all" ? "まだ編集履歴はありません。" : `${activityCategoryLabel(activityFilter)}に関する履歴はありません。`}</p>`}</div>
    ${activityLogs.length >= activityLoadLimit ? `<button id="activityLoadMoreButton" class="secondary-button activity-load-more-button" type="button">さらに表示</button>` : ""}`;
  parent.insertAdjacentElement("afterend", section);
  section.querySelectorAll("[data-activity-filter]").forEach((button) => button.addEventListener("click", () => { activityFilter = button.dataset.activityFilter; renderSettingsPage(); }));
  section.querySelector("#activityLoadMoreButton")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    activityLoadLimit += 50;
    try { await loadActivityLogs(); renderSettingsPage(); }
    catch (error) { alert(error.message || "編集履歴を読み込めませんでした。"); }
  });
}

const renderSettingsPageV22 = renderSettingsPage;
renderSettingsPage = function() {
  renderSettingsPageV22();
  injectActivityHistorySection();
};

const switchTabV22 = switchTab;
switchTab = async function(tab) {
  if (tab === "settings") {
    try { await loadActivityLogs(); }
    catch (error) { console.warn("編集履歴の読み込みに失敗しました。", error); }
  }
  return switchTabV22(tab);
};

const isRelevantRealtimePayloadV22 = isRelevantRealtimePayload;
isRelevantRealtimePayload = function(payload) {
  if (payload?.table === "group_activity_logs") return getRealtimeRow(payload).group_id === activeGroupId;
  return isRelevantRealtimePayloadV22(payload);
};

const refreshCurrentViewFromRealtimeV22 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  if (currentTab === "settings") {
    if (!force && isRealtimeInputInProgress()) { realtimePendingRefresh = true; showRealtimeUpdateBanner(); return; }
    try { await loadActivityLogs(); }
    catch (error) { console.warn("編集履歴のRealtime更新に失敗しました。", error); }
  }
  return refreshCurrentViewFromRealtimeV22(force);
};

const stopRealtimeSubscriptionsV22 = stopRealtimeSubscriptions;
stopRealtimeSubscriptions = async function() {
  if (activityRealtimeChannel && supabaseClient) {
    try { await supabaseClient.removeChannel(activityRealtimeChannel); }
    catch (error) { console.warn("編集履歴のRealtime接続終了に失敗しました。", error); }
  }
  activityRealtimeChannel = null;
  activityRealtimeGroupId = null;
  return stopRealtimeSubscriptionsV22();
};

const setupRealtimeSubscriptionsV22 = setupRealtimeSubscriptions;
setupRealtimeSubscriptions = async function() {
  await setupRealtimeSubscriptionsV22();
  if (!supabaseClient || !currentSession || !activeGroupId) return;
  if (activityRealtimeChannel && activityRealtimeGroupId === activeGroupId) return;
  if (activityRealtimeChannel) {
    try { await supabaseClient.removeChannel(activityRealtimeChannel); } catch (_) {}
  }
  const groupId = activeGroupId;
  const channel = supabaseClient.channel(`jakuroku-activity-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_activity_logs", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .subscribe();
  activityRealtimeChannel = channel;
  activityRealtimeGroupId = groupId;
};

window.setTimeout(() => installActivityRpcLogger(), 0);

/* v24: settlement payment routes batch debt registration */
let activeSettlementDebtBatch = null;
let settlementDebtBatchRealtimeChannel = null;
let settlementDebtBatchRealtimeGroupId = null;

async function loadActiveSettlementDebtBatch() {
  activeSettlementDebtBatch = null;
  if (!supabaseClient || !activeGroupId || !activeMatchSessionId) return;
  const { data, error } = await supabaseClient
    .from("settlement_debt_batches")
    .select("id, group_id, session_id, route_count, total_amount_pt, memo, created_by, created_at")
    .eq("session_id", activeMatchSessionId)
    .maybeSingle();
  if (error) throw error;
  activeSettlementDebtBatch = data || null;
}

function getCurrentSettlementDebtRoutes() {
  if (!activeMatchSession || activeMatchSession.status !== "settled") return [];
  if (!hasMatchingVenuePrepayments()) return [];
  return getPaymentRoutes(getSessionTotals())
    .filter((route) => num(route.amount) > 0.004)
    .map((route) => ({
      debtor_member_id: route.fromMemberId,
      creditor_member_id: route.toMemberId,
      amount_pt: roundTo(num(route.amount), 2),
      from: route.from,
      to: route.to
    }));
}

function formatBatchRegisteredAt(value) {
  if (!value) return "登録済み";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "登録済み";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

function injectSettlementDebtBatchAction() {
  const section = document.querySelector(".final-settlement-section");
  if (!section || section.querySelector(".settlement-debt-batch-box")) return;
  if (!activeMatchSession || activeMatchSession.status !== "settled") return;

  const routes = getCurrentSettlementDebtRoutes();
  const box = document.createElement("div");
  box.className = "settlement-debt-batch-box";

  if (activeSettlementDebtBatch) {
    box.innerHTML = `<div class="settlement-debt-batch-heading"><div><span class="settlement-debt-batch-badge">借pt登録済み</span><strong>送金ルートをまとめて借ptへ登録済みです</strong></div><span>${escapeHtml(formatBatchRegisteredAt(activeSettlementDebtBatch.created_at))}</span></div>
      <p>${activeSettlementDebtBatch.route_count}件・合計 ${formatPtPlain(activeSettlementDebtBatch.total_amount_pt)} を未精算借ptとして保存しています。後から対局結果を編集しても、登録済みの借ptは自動変更されません。</p>
      ${activeSettlementDebtBatch.memo ? `<small>メモ：${escapeHtml(activeSettlementDebtBatch.memo)}</small>` : ""}`;
  } else if (routes.length) {
    const total = roundTo(routes.reduce((sum, route) => sum + num(route.amount_pt), 0), 2);
    box.innerHTML = `<div class="settlement-debt-batch-heading"><div><span class="settlement-debt-batch-badge pending">未登録</span><strong>送金ルートをまとめて借ptへ登録</strong></div><span>${routes.length}件</span></div>
      <p>現在の送金ルート（合計 ${formatPtPlain(total)}）を、未精算の借ptとして一括保存します。登録後の借ptは借ptタブで支払い・横流しを管理します。</p>
      <button id="openSettlementDebtBatchButton" class="primary-button settlement-debt-batch-button" type="button">送金ルートをまとめて借ptへ登録</button>`;
  } else {
    box.innerHTML = `<div class="settlement-debt-batch-heading"><div><span class="settlement-debt-batch-badge neutral">送金なし</span><strong>借ptへの一括登録は不要です</strong></div></div><p>現在の精算結果では、未精算として登録する送金ルートがありません。</p>`;
  }

  const settledNote = section.querySelector(".settled-note");
  if (settledNote) settledNote.insertAdjacentElement("beforebegin", box);
  else section.append(box);
  box.querySelector("#openSettlementDebtBatchButton")?.addEventListener("click", () => { void openSettlementDebtBatchModal(); });
}

function closeSettlementDebtBatchModal() {
  document.querySelector(".settlement-debt-batch-modal-overlay")?.remove();
}

async function openSettlementDebtBatchModal() {
  if (!activeMatchSession || activeMatchSession.status !== "settled") return;
  if (activeSettlementDebtBatch) {
    alert("この日の送金ルートはすでに一括で借ptへ登録されています。借ptタブで支払い・横流しを管理してください。");
    return;
  }
  const routes = getCurrentSettlementDebtRoutes();
  if (!routes.length) {
    alert("借ptへ登録できる送金ルートがありません。場代の先払い合計を確認してください。");
    return;
  }
  const total = roundTo(routes.reduce((sum, route) => sum + num(route.amount_pt), 0), 2);
  closeSettlementDebtBatchModal();
  document.body.insertAdjacentHTML("beforeend", `<div class="settlement-debt-batch-modal-overlay"><section class="debt-modal settlement-debt-batch-modal" role="dialog" aria-modal="true" aria-labelledby="settlementDebtBatchTitle"><button type="button" class="debt-modal-close" aria-label="閉じる">×</button><p class="eyebrow">BATCH REGISTER</p><h2 id="settlementDebtBatchTitle">送金ルートをまとめて借ptへ登録</h2><p>以下の送金ルートを、現在の金額のまま未精算借ptとして保存します。登録後に対局結果や場代を編集しても、この借ptは自動変更されません。</p><div class="settlement-debt-batch-route-list">${routes.map((route) => `<div><span>${escapeHtml(route.from)} <b>→</b> ${escapeHtml(route.to)}</span><strong>${formatPtPlain(route.amount_pt)}</strong></div>`).join("")}</div><div class="settlement-debt-batch-total"><span>登録合計</span><strong>${formatPtPlain(total)}</strong></div><form id="settlementDebtBatchForm" class="debt-create-form"><label>メモ（任意）<input name="memo" type="text" maxlength="300" value="${escapeHtml(`${formatDate(activeMatchSession.session_date)}の精算ルート`)}"></label><div class="debt-form-actions"><button class="primary-button" type="submit">${routes.length}件を借ptへ登録</button><button class="secondary-button" type="button" id="cancelSettlementDebtBatchButton">閉じる</button></div><p class="debt-form-message"></p></form></section></div>`);

  const overlay = document.querySelector(".settlement-debt-batch-modal-overlay");
  const form = document.getElementById("settlementDebtBatchForm");
  document.querySelector(".settlement-debt-batch-modal .debt-modal-close")?.addEventListener("click", closeSettlementDebtBatchModal);
  document.getElementById("cancelSettlementDebtBatchButton")?.addEventListener("click", closeSettlementDebtBatchModal);
  overlay?.addEventListener("click", (event) => { if (event.target === overlay) closeSettlementDebtBatchModal(); });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    const message = form.querySelector(".debt-form-message");
    submit.disabled = true;
    message.textContent = "";
    try {
      markLocalRealtimeWrite();
      const { data, error } = await supabaseClient.rpc("register_session_payment_routes_as_debts", {
        p_session_id: activeMatchSession.id,
        p_routes: routes.map((route) => ({
          debtor_member_id: route.debtor_member_id,
          creditor_member_id: route.creditor_member_id,
          amount_pt: route.amount_pt
        })),
        p_memo: String(new FormData(form).get("memo") || "")
      });
      if (error) throw error;
      activeSettlementDebtBatch = {
        id: data?.batch_id || null,
        group_id: activeGroupId,
        session_id: activeMatchSession.id,
        route_count: num(data?.route_count),
        total_amount_pt: num(data?.total_amount_pt),
        memo: String(new FormData(form).get("memo") || ""),
        created_at: new Date().toISOString()
      };
      gameMessage = `${num(data?.route_count)}件の送金ルートを借ptへ登録しました。`;
      debtMessage = "精算ルートをまとめて借ptへ登録しました。";
      closeSettlementDebtBatchModal();
      await loadMatchSessions();
    } catch (error) {
      message.textContent = error.message || "送金ルートを借ptへ登録できませんでした。";
    } finally {
      submit.disabled = false;
    }
  });
}

const loadActiveMatchSessionDetailV23 = loadActiveMatchSessionDetail;
loadActiveMatchSessionDetail = async function() {
  await loadActiveMatchSessionDetailV23();
  await loadActiveSettlementDebtBatch();
};

const renderActiveSessionViewV23 = renderActiveSessionView;
renderActiveSessionView = function() {
  renderActiveSessionViewV23();
  injectSettlementDebtBatchAction();
};

const isRelevantRealtimePayloadV23 = isRelevantRealtimePayload;
isRelevantRealtimePayload = function(payload) {
  if (payload?.table === "settlement_debt_batches") return getRealtimeRow(payload).group_id === activeGroupId;
  return isRelevantRealtimePayloadV23(payload);
};

const isRealtimeInputInProgressV23 = isRealtimeInputInProgress;
isRealtimeInputInProgress = function() {
  if (document.activeElement?.closest(".settlement-debt-batch-modal")) return true;
  return isRealtimeInputInProgressV23();
};

const stopRealtimeSubscriptionsV23 = stopRealtimeSubscriptions;
stopRealtimeSubscriptions = async function() {
  if (settlementDebtBatchRealtimeChannel && supabaseClient) {
    try { await supabaseClient.removeChannel(settlementDebtBatchRealtimeChannel); }
    catch (error) { console.warn("精算借pt一括登録のRealtime接続終了に失敗しました。", error); }
  }
  settlementDebtBatchRealtimeChannel = null;
  settlementDebtBatchRealtimeGroupId = null;
  return stopRealtimeSubscriptionsV23();
};

const setupRealtimeSubscriptionsV23 = setupRealtimeSubscriptions;
setupRealtimeSubscriptions = async function() {
  await setupRealtimeSubscriptionsV23();
  if (!supabaseClient || !currentSession || !activeGroupId) return;
  if (settlementDebtBatchRealtimeChannel && settlementDebtBatchRealtimeGroupId === activeGroupId) return;
  if (settlementDebtBatchRealtimeChannel) {
    try { await supabaseClient.removeChannel(settlementDebtBatchRealtimeChannel); } catch (_) {}
  }
  const groupId = activeGroupId;
  const channel = supabaseClient.channel(`jakuroku-settlement-debt-batch-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "settlement_debt_batches", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .subscribe();
  settlementDebtBatchRealtimeChannel = channel;
  settlementDebtBatchRealtimeGroupId = groupId;
};

const activityPayloadForRpcV23 = activityPayloadForRpc;
activityPayloadForRpc = function(name, args, result, before) {
  if (name === "register_session_payment_routes_as_debts") {
    const routeCount = Array.isArray(args?.p_routes) ? args.p_routes.length : 0;
    const total = roundTo((args?.p_routes || []).reduce((sum, route) => sum + num(route.amount_pt), 0), 2);
    return {
      groupId: activeGroupId,
      eventType: "debt_created",
      entityType: "session",
      entityId: args?.p_session_id || activeMatchSession?.id || null,
      summary: `${routeCount}件の送金ルートをまとめて借ptへ登録しました。`,
      details: {
        before: null,
        after: {
          session_date: activeMatchSession?.session_date || "",
          amount_pt: total,
          notes: `送金ルート ${routeCount}件を一括登録`,
          routes: (args?.p_routes || []).map((route) => `${activityMemberLabel(route.debtor_member_id)} → ${activityMemberLabel(route.creditor_member_id)} ${formatPtPlain(route.amount_pt)}`)
        },
        source: "app"
      }
    };
  }
  return activityPayloadForRpcV23(name, args, result, before);
};

const activitySnapshotHtmlV23 = activitySnapshotHtml;
activitySnapshotHtml = function(value, side) {
  const base = activitySnapshotHtmlV23(value, side);
  if (!value?.routes?.length) return base;
  const routeRows = value.routes.map((route) => `<li>${escapeHtml(route)}</li>`).join("");
  return `${base}<div class="activity-route-list"><span>登録ルート</span><ul>${routeRows}</ul></div>`;
};

/* v25: match setting templates */
let matchSettingTemplates = [];
let matchSettingTemplatesGroupId = null;
let selectedMatchSettingTemplateId = "";
let templateMessage = "";
let templateRealtimeChannel = null;
let templateRealtimeGroupId = null;

function templateDbModeFromUi(mode) {
  if (mode === "yonin_sanma") return "sanma4";
  return mode === "yonma" ? "yonma" : "sanma";
}

function templateUiModeFromDb(mode) {
  if (mode === "sanma4") return "yonin_sanma";
  return mode === "yonma" ? "yonma" : "sanma";
}

function templateModeLabel(template) {
  return getModeLabel(templateUiModeFromDb(template.game_mode));
}

function getSelectedMatchSettingTemplate() {
  return matchSettingTemplates.find((template) => template.id === selectedMatchSettingTemplateId) || null;
}

function canManageMatchSettingTemplate(template) {
  if (!template || !currentSession) return false;
  return template.created_by === currentSession.user.id || isActiveGroupAdmin();
}

async function loadMatchSettingTemplates() {
  if (!supabaseClient || !currentSession || !activeGroupId) {
    matchSettingTemplates = [];
    matchSettingTemplatesGroupId = null;
    selectedMatchSettingTemplateId = "";
    return;
  }

  const { data, error } = await supabaseClient
    .from("match_setting_templates")
    .select("id, group_id, name, game_mode, rate_label, rate_multiplier, starting_points, uma, chip_unit, tobi_enabled, created_by, created_at, updated_at")
    .eq("group_id", activeGroupId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  matchSettingTemplates = data || [];
  matchSettingTemplatesGroupId = activeGroupId;
  if (!matchSettingTemplates.some((template) => template.id === selectedMatchSettingTemplateId)) {
    selectedMatchSettingTemplateId = "";
  }
}

function templateDraftPayload(templateName) {
  const customRateLabel = String(sessionDraft.customRateLabel || "").trim();
  const rateLabel = sessionDraft.rateLabel === "カスタム" ? customRateLabel : sessionDraft.rateLabel;
  const expectedCount = getModePreset(sessionDraft.gameMode).playerCount;

  if (!String(templateName || "").trim()) return { error: "テンプレート名を入力してください。" };
  if (!rateLabel) return { error: "カスタムレート名を入力してください。" };
  if (!Array.isArray(sessionDraft.defaultUma) || sessionDraft.defaultUma.length !== expectedCount) {
    return { error: "ウマの人数設定を確認してください。" };
  }
  if (num(sessionDraft.rateMultiplier) <= 0 || num(sessionDraft.rateMultiplier) > 10000) {
    return { error: "レート倍率を確認してください。" };
  }
  if (num(sessionDraft.startingPoints) <= 0 || num(sessionDraft.chipValue) < 0) {
    return { error: "初期持ち点とチップ単価を確認してください。" };
  }

  return {
    payload: {
      p_name: String(templateName).trim(),
      p_game_mode: templateDbModeFromUi(sessionDraft.gameMode),
      p_rate_label: rateLabel,
      p_rate_multiplier: roundTo(num(sessionDraft.rateMultiplier), 2),
      p_starting_points: Math.round(num(sessionDraft.startingPoints)),
      p_uma: sessionDraft.defaultUma.map((value) => num(value)),
      p_chip_unit: roundTo(num(sessionDraft.chipValue), 2),
      p_tobi_enabled: Boolean(sessionDraft.tobiEnabled)
    }
  };
}

function applyMatchSettingTemplate(template) {
  if (!template) return;
  const mode = templateUiModeFromDb(template.game_mode);
  const nextDraft = createDefaultSessionDraft(mode);
  const memberLimit = getModePreset(mode).playerCount;
  const templateRateLabel = String(template.rate_label || "カスタム");
  const knownRate = getRatePreset(templateRateLabel);

  nextDraft.sessionDate = sessionDraft.sessionDate || todayInJapan();
  nextDraft.notes = sessionDraft.notes || "";
  nextDraft.memberIds = (sessionDraft.memberIds || []).slice(0, memberLimit);
  nextDraft.rateLabel = knownRate ? templateRateLabel : "カスタム";
  nextDraft.customRateLabel = knownRate ? "" : templateRateLabel;
  nextDraft.rateMultiplier = num(template.rate_multiplier);
  nextDraft.startingPoints = Math.round(num(template.starting_points));
  nextDraft.chipValue = num(template.chip_unit);
  nextDraft.defaultUma = Array.isArray(template.uma)
    ? template.uma.map((value) => num(value))
    : [...getModePreset(mode).uma];
  nextDraft.tobiEnabled = Boolean(template.tobi_enabled);

  sessionDraft = nextDraft;
  selectedMatchSettingTemplateId = template.id;
  templateMessage = `「${template.name}」を反映しました。参加者と日付は必要に応じて選び直してください。`;
}

async function saveMatchSettingTemplate(overwrite = false) {
  const selected = getSelectedMatchSettingTemplate();
  if (overwrite && (!selected || !canManageMatchSettingTemplate(selected))) {
    alert("このテンプレートを更新する権限がありません。");
    return;
  }

  const templateName = overwrite
    ? selected.name
    : window.prompt("テンプレート名を入力してください。", `${getModePreset(sessionDraft.gameMode).label} ${sessionDraft.rateLabel === "カスタム" ? sessionDraft.customRateLabel || "カスタム" : sessionDraft.rateLabel}`);

  if (templateName === null) return;
  const built = templateDraftPayload(templateName);
  if (built.error) {
    templateMessage = built.error;
    renderCreateSessionView();
    return;
  }

  const createButton = document.getElementById("saveMatchTemplateButton");
  const updateButton = document.getElementById("updateMatchTemplateButton");
  const busyButton = overwrite ? updateButton : createButton;
  if (busyButton) busyButton.disabled = true;

  try {
    markLocalRealtimeWrite();
    let data;
    if (overwrite) {
      if (!window.confirm(`「${selected.name}」を現在の設定で上書きしますか？`)) return;
      const response = await supabaseClient.rpc("update_match_setting_template", {
        p_template_id: selected.id,
        ...built.payload
      });
      if (response.error) throw response.error;
      data = { id: selected.id };
      templateMessage = `「${selected.name}」を更新しました。`;
    } else {
      const response = await supabaseClient.rpc("create_match_setting_template", {
        p_group_id: activeGroupId,
        ...built.payload
      });
      if (response.error) throw response.error;
      data = { id: response.data };
      templateMessage = `「${built.payload.p_name}」を保存しました。`;
    }
    await loadMatchSettingTemplates();
    selectedMatchSettingTemplateId = data.id || selectedMatchSettingTemplateId;
    renderCreateSessionView();
  } catch (error) {
    templateMessage = error.message || "テンプレートを保存できませんでした。";
    renderCreateSessionView();
  } finally {
    if (busyButton) busyButton.disabled = false;
  }
}

async function deleteMatchSettingTemplate(templateId) {
  const template = matchSettingTemplates.find((item) => item.id === templateId);
  if (!template) return;
  if (!canManageMatchSettingTemplate(template)) {
    alert("このテンプレートを削除する権限がありません。");
    return;
  }
  if (!window.confirm(`「${template.name}」を削除しますか？\nこの操作は元に戻せません。`)) return;

  try {
    markLocalRealtimeWrite();
    const { error } = await supabaseClient.rpc("delete_match_setting_template", { p_template_id: template.id });
    if (error) throw error;
    if (selectedMatchSettingTemplateId === template.id) selectedMatchSettingTemplateId = "";
    templateMessage = `「${template.name}」を削除しました。`;
    await loadMatchSettingTemplates();
    if (currentTab === "settings") renderSettingsPage();
    else if (currentTab === "game" && showCreateSession) renderCreateSessionView();
  } catch (error) {
    alert(error.message || "テンプレートを削除できませんでした。");
  }
}

function templateSummaryHtml(template) {
  const rate = `${escapeHtml(template.rate_label)}（収支1 = ${formatNumber(template.rate_multiplier, 2)} pt）`;
  const uma = (Array.isArray(template.uma) ? template.uma : []).map((value) => formatScore(value)).join(" / ");
  return `${escapeHtml(templateModeLabel(template))} ／ ${rate} ／ 初期${formatNumber(template.starting_points)}点 ／ チップ${formatNumber(template.chip_unit, 2)} ／ ウマ ${escapeHtml(uma)}${template.tobi_enabled ? " ／ 飛ばし点あり" : ""}`;
}

function injectMatchTemplateChooser() {
  const form = document.getElementById("createSessionForm");
  if (!form || form.querySelector(".match-template-chooser")) return;

  const selected = getSelectedMatchSettingTemplate();
  const canUpdate = canManageMatchSettingTemplate(selected);
  const section = document.createElement("section");
  section.className = "game-section match-template-chooser";
  section.innerHTML = `<div class="game-section-heading"><div><p class="game-section-title">対局設定テンプレート</p><p class="game-section-note">形式・レート・初期持ち点・ウマ・チップ・飛ばし点をまとめて反映します。参加者と日付は保存しません。</p></div><span class="template-count-badge">${matchSettingTemplates.length}件</span></div>
    <div class="template-chooser-row">
      <select id="matchTemplateSelect" class="template-select">
        <option value="">テンプレートを選択</option>
        ${matchSettingTemplates.map((template) => `<option value="${template.id}" ${template.id === selectedMatchSettingTemplateId ? "selected" : ""}>${escapeHtml(template.name)} — ${escapeHtml(templateModeLabel(template))} / ${escapeHtml(template.rate_label)}</option>`).join("")}
      </select>
      <button id="applyMatchTemplateButton" class="secondary-button" type="button" ${selected ? "" : "disabled"}>設定を反映</button>
    </div>
    <div class="template-chooser-actions">
      <button id="saveMatchTemplateButton" class="secondary-button" type="button">現在の設定をテンプレート保存</button>
      ${selected && canUpdate ? `<button id="updateMatchTemplateButton" class="icon-text-button" type="button">選択中を上書き</button><button id="deleteMatchTemplateButton" class="danger-outline-button" type="button">削除</button>` : ""}
    </div>
    ${selected ? `<p class="template-selected-summary"><strong>選択中：</strong>${escapeHtml(selected.name)}<span>${templateSummaryHtml(selected)}</span></p>` : `<p class="template-selected-summary empty">テンプレートを選ぶと、基本設定を一括で反映できます。</p>`}
    ${templateMessage ? `<p class="template-message">${escapeHtml(templateMessage)}</p>` : ""}`;

  form.prepend(section);

  const select = section.querySelector("#matchTemplateSelect");
  select?.addEventListener("change", () => {
    selectedMatchSettingTemplateId = select.value;
    templateMessage = "";
    renderCreateSessionView();
  });
  section.querySelector("#applyMatchTemplateButton")?.addEventListener("click", () => {
    const template = getSelectedMatchSettingTemplate();
    if (!template) return;
    applyMatchSettingTemplate(template);
    renderCreateSessionView();
  });
  section.querySelector("#saveMatchTemplateButton")?.addEventListener("click", () => { void saveMatchSettingTemplate(false); });
  section.querySelector("#updateMatchTemplateButton")?.addEventListener("click", () => { void saveMatchSettingTemplate(true); });
  section.querySelector("#deleteMatchTemplateButton")?.addEventListener("click", () => { void deleteMatchSettingTemplate(selectedMatchSettingTemplateId); });
}

function injectMatchTemplateSettingsSection() {
  const page = getPageWorkspace();
  if (!page || !currentSession || !getActiveGroup() || page.querySelector(".match-template-settings-section")) return;
  const parent = page.querySelector(".data-export-section") || page.querySelector(".settings-section:last-of-type");
  if (!parent) return;

  const list = matchSettingTemplates.length
    ? matchSettingTemplates.map((template) => `<article class="template-settings-card">
        <div class="template-settings-heading"><div><strong>${escapeHtml(template.name)}</strong><span>${escapeHtml(templateModeLabel(template))}</span></div>${canManageMatchSettingTemplate(template) ? `<span class="template-owner-badge">編集可</span>` : `<span class="template-owner-badge readonly">閲覧のみ</span>`}</div>
        <p>${templateSummaryHtml(template)}</p>
        <div class="template-settings-actions"><button class="secondary-button" type="button" data-use-match-template-id="${template.id}">新規記録で使う</button>${canManageMatchSettingTemplate(template) ? `<button class="danger-outline-button" type="button" data-delete-match-template-id="${template.id}">削除</button>` : ""}</div>
      </article>`).join("")
    : `<p class="game-section-note">テンプレートはまだありません。新規記録画面で設定を入力し、「現在の設定をテンプレート保存」を押してください。</p>`;

  const section = document.createElement("section");
  section.className = "settings-section match-template-settings-section";
  section.innerHTML = `<div class="settings-section-heading"><div><p class="eyebrow">MATCH TEMPLATES</p><h3>対局設定テンプレート</h3></div><span class="member-role-badge">${matchSettingTemplates.length}件</span></div>
    <p class="settings-help">よく使う対局条件をグループ内で共有します。ここから選んで新規記録を始められます。設定の上書きは、新規記録画面でテンプレートを選んだ後に行えます。</p>
    <div class="template-settings-list">${list}</div>`;

  parent.insertAdjacentElement("afterend", section);
  section.querySelectorAll("[data-use-match-template-id]").forEach((button) => button.addEventListener("click", async () => {
    const template = matchSettingTemplates.find((item) => item.id === button.dataset.useMatchTemplateId);
    if (!template) return;
    sessionDraft = createDefaultSessionDraft(templateUiModeFromDb(template.game_mode));
    applyMatchSettingTemplate(template);
    showCreateSession = true;
    await switchTab("game");
  }));
  section.querySelectorAll("[data-delete-match-template-id]").forEach((button) => button.addEventListener("click", () => {
    void deleteMatchSettingTemplate(button.dataset.deleteMatchTemplateId);
  }));
}

const renderCreateSessionViewV24 = renderCreateSessionView;
renderCreateSessionView = function() {
  renderCreateSessionViewV24();
  injectMatchTemplateChooser();
};

const renderSettingsPageV24 = renderSettingsPage;
renderSettingsPage = function() {
  renderSettingsPageV24();
  injectMatchTemplateSettingsSection();
};

const loadMatchSessionsV24 = loadMatchSessions;
loadMatchSessions = async function() {
  try { await loadMatchSettingTemplates(); }
  catch (error) { console.warn("対局設定テンプレートを読み込めませんでした。", error); }
  return loadMatchSessionsV24();
};

const loadGroupsV24 = loadGroups;
loadGroups = async function() {
  const result = await loadGroupsV24();
  try { await loadMatchSettingTemplates(); }
  catch (error) { console.warn("対局設定テンプレートを読み込めませんでした。", error); }
  if (currentTab === "settings") renderSettingsPage();
  return result;
};

const switchActiveGroupV24 = switchActiveGroup;
switchActiveGroup = async function(groupId) {
  await switchActiveGroupV24(groupId);
  try { await loadMatchSettingTemplates(); }
  catch (error) { console.warn("対局設定テンプレートを読み込めませんでした。", error); }
  if (currentTab === "settings") renderSettingsPage();
};

const updateAuthUIV24 = updateAuthUI;
updateAuthUI = async function(session) {
  await updateAuthUIV24(session);
  if (!session) {
    matchSettingTemplates = [];
    matchSettingTemplatesGroupId = null;
    selectedMatchSettingTemplateId = "";
  } else {
    try { await loadMatchSettingTemplates(); }
    catch (error) { console.warn("対局設定テンプレートを読み込めませんでした。", error); }
  }
};

const isRelevantRealtimePayloadV24 = isRelevantRealtimePayload;
isRelevantRealtimePayload = function(payload) {
  if (payload?.table === "match_setting_templates") return getRealtimeRow(payload).group_id === activeGroupId;
  return isRelevantRealtimePayloadV24(payload);
};

const stopRealtimeSubscriptionsV24 = stopRealtimeSubscriptions;
stopRealtimeSubscriptions = async function() {
  if (templateRealtimeChannel && supabaseClient) {
    try { await supabaseClient.removeChannel(templateRealtimeChannel); }
    catch (error) { console.warn("テンプレートのRealtime接続終了に失敗しました。", error); }
  }
  templateRealtimeChannel = null;
  templateRealtimeGroupId = null;
  return stopRealtimeSubscriptionsV24();
};

const setupRealtimeSubscriptionsV24 = setupRealtimeSubscriptions;
setupRealtimeSubscriptions = async function() {
  await setupRealtimeSubscriptionsV24();
  if (!supabaseClient || !currentSession || !activeGroupId) return;
  if (templateRealtimeChannel && templateRealtimeGroupId === activeGroupId) return;
  if (templateRealtimeChannel) {
    try { await supabaseClient.removeChannel(templateRealtimeChannel); } catch (_) {}
  }
  const groupId = activeGroupId;
  const channel = supabaseClient.channel(`jakuroku-match-templates-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_setting_templates", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .subscribe();
  templateRealtimeChannel = channel;
  templateRealtimeGroupId = groupId;
};

const refreshCurrentViewFromRealtimeV24 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  const result = await refreshCurrentViewFromRealtimeV24(force);
  if (currentTab === "settings" || (currentTab === "game" && showCreateSession)) {
    try {
      await loadMatchSettingTemplates();
      if (currentTab === "settings") renderSettingsPage();
      else if (currentTab === "game" && showCreateSession) renderCreateSessionView();
    } catch (error) {
      console.warn("テンプレートのRealtime更新に失敗しました。", error);
    }
  }
  return result;
};

const activityPayloadForRpcV24 = activityPayloadForRpc;
activityPayloadForRpc = function(name, args, result, before) {
  if (["create_match_setting_template", "update_match_setting_template", "delete_match_setting_template"].includes(name)) {
    const eventText = {
      create_match_setting_template: "保存",
      update_match_setting_template: "更新",
      delete_match_setting_template: "削除"
    }[name];
    const templateName = args?.p_name || getSelectedMatchSettingTemplate()?.name || "対局設定テンプレート";
    return {
      groupId: activeGroupId,
      eventType: "group_edited",
      entityType: "group",
      entityId: activeGroupId,
      summary: `対局設定テンプレート「${templateName}」を${eventText}しました。`,
      details: {
        before: null,
        after: {
          notes: name === "delete_match_setting_template"
            ? `テンプレートを削除しました：${templateName}`
            : `テンプレート：${templateName} ／ ${getModeLabel(sessionDraft.gameMode)} ／ ${sessionDraft.rateLabel === "カスタム" ? sessionDraft.customRateLabel : sessionDraft.rateLabel}`
        },
        source: "app"
      }
    };
  }
  return activityPayloadForRpcV24(name, args, result, before);
};

/* v26: match calendar and searchable history */
let historySessions = [];
let historySessionMembers = [];
let historyHanchans = [];
let historyCalendarMonth = todayInJapan().slice(0, 7);
let historyPeriodMode = "month";
let historySelectedDate = "";
let historyFilterMode = "all";
let historyFilterRate = "all";
let historyFilterStatus = "all";
let historyFilterMemberIds = [];
let historyKeyword = "";
let historyMessage = "";

function ensureHistoryNavigation() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav || nav.querySelector('[data-tab="history"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item";
  button.dataset.tab = "history";
  button.innerHTML = `<span>歴</span><small>履歴</small>`;
  const rankingButton = nav.querySelector('[data-tab="ranking"]');
  nav.insertBefore(button, rankingButton || null);
  button.addEventListener("click", () => { void switchTab("history"); });
  navItems = document.querySelectorAll(".nav-item");
}

function historyMonthParts(month = historyCalendarMonth) {
  const [yearText, monthText] = String(month || "").split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    const today = todayInJapan();
    return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  }
  return { year, month: monthNumber };
}

function historyMonthLabel(month = historyCalendarMonth) {
  const parts = historyMonthParts(month);
  return `${parts.year}年${parts.month}月`;
}

function shiftHistoryCalendarMonth(offset) {
  const { year, month } = historyMonthParts();
  const value = new Date(Date.UTC(year, month - 1 + Number(offset || 0), 1));
  historyCalendarMonth = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  historySelectedDate = "";
  renderHistoryPage();
}

function getHistorySessionMemberIds(sessionId) {
  return historySessionMembers
    .filter((member) => member.session_id === sessionId)
    .map((member) => member.member_id);
}

function getHistoryParticipants(sessionId) {
  const memberIds = getHistorySessionMemberIds(sessionId);
  return memberIds.map((memberId) => getMemberName(memberId));
}

function getHistoryHanchanCount(sessionId) {
  return historyHanchans.filter((hanchan) => hanchan.session_id === sessionId).length;
}

function getHistoryRateOptions() {
  return [...new Set(historySessions.map((session) => String(session.rate_label || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ja"));
}

function historyMatchesSharedFilters(session) {
  if (historyFilterMode !== "all" && session.game_mode !== historyFilterMode) return false;
  if (historyFilterRate !== "all" && String(session.rate_label || "") !== historyFilterRate) return false;
  if (historyFilterStatus !== "all" && session.status !== historyFilterStatus) return false;

  const memberIds = getHistorySessionMemberIds(session.id);
  if (historyFilterMemberIds.length && !historyFilterMemberIds.every((memberId) => memberIds.includes(memberId))) return false;

  const keyword = String(historyKeyword || "").trim().toLocaleLowerCase("ja");
  if (keyword) {
    const haystack = [
      session.session_date,
      getModeLabel(session.game_mode),
      session.rate_label || "",
      session.notes || "",
      session.status === "settled" ? "精算済み" : "進行中",
      ...getHistoryParticipants(session.id)
    ].join(" ").toLocaleLowerCase("ja");
    if (!haystack.includes(keyword)) return false;
  }
  return true;
}

function historyMatchesPeriod(session) {
  if (historyPeriodMode === "all") return true;
  if (historyPeriodMode === "year") return String(session.session_date || "").startsWith(`${historyMonthParts().year}-`);
  return String(session.session_date || "").startsWith(historyCalendarMonth);
}

function getFilteredHistorySessions(options = {}) {
  const { ignoreSelectedDate = false, ignorePeriod = false } = options;
  return historySessions.filter((session) => {
    if (!historyMatchesSharedFilters(session)) return false;
    if (!ignorePeriod && !historyMatchesPeriod(session)) return false;
    if (!ignoreSelectedDate && historySelectedDate && session.session_date !== historySelectedDate) return false;
    return true;
  });
}

function buildHistoryCalendarHtml() {
  const { year, month } = historyMonthParts();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const calendarSessions = getFilteredHistorySessions({ ignoreSelectedDate: true, ignorePeriod: true })
    .filter((session) => String(session.session_date || "").startsWith(historyCalendarMonth));
  const sessionsByDate = new Map();
  calendarSessions.forEach((session) => {
    const current = sessionsByDate.get(session.session_date) || [];
    current.push(session);
    sessionsByDate.set(session.session_date, current);
  });
  const today = todayInJapan();
  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push(`<div class="history-calendar-cell blank" aria-hidden="true"></div>`);
  for (let day = 1; day <= lastDay; day += 1) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const sessions = sessionsByDate.get(dateKey) || [];
    const settledCount = sessions.filter((session) => session.status === "settled").length;
    const classes = ["history-calendar-cell"];
    if (sessions.length) classes.push("has-session");
    if (dateKey === today) classes.push("today");
    if (dateKey === historySelectedDate) classes.push("selected");
    const meta = sessions.length
      ? `<small>${sessions.length}会${settledCount === sessions.length ? "" : "・進行中"}</small><i class="history-calendar-dot ${settledCount === sessions.length ? "settled" : "open"}"></i>`
      : "";
    cells.push(`<button type="button" class="${classes.join(" ")}" data-history-date="${dateKey}"><strong>${day}</strong>${meta}</button>`);
  }
  while (cells.length % 7) cells.push(`<div class="history-calendar-cell blank" aria-hidden="true"></div>`);
  return `<section class="history-calendar-panel">
    <div class="history-calendar-heading">
      <button type="button" class="calendar-month-button" data-history-calendar-shift="-1" aria-label="前の月">‹</button>
      <div><p class="game-section-title">対局カレンダー</p><strong>${historyMonthLabel()}</strong></div>
      <button type="button" class="calendar-month-button" data-history-calendar-shift="1" aria-label="次の月">›</button>
    </div>
    <div class="history-calendar-actions"><button type="button" class="icon-text-button" data-history-calendar-today>今月へ戻る</button>${historySelectedDate ? `<button type="button" class="icon-text-button" data-history-clear-date>日付指定を解除</button>` : ""}</div>
    <div class="history-calendar-weekdays"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
    <div class="history-calendar-grid">${cells.join("")}</div>
    <p class="history-calendar-note">対局がある日を押すと、その日の記録だけを表示します。</p>
  </section>`;
}

function renderHistorySessionCard(session) {
  const participants = getHistoryParticipants(session.id);
  const hanchanCount = getHistoryHanchanCount(session.id);
  const statusLabel = session.status === "settled" ? "精算済み" : "進行中";
  const statusClass = session.status === "settled" ? "settled" : "open";
  return `<article class="history-session-card">
    <div class="history-session-heading">
      <div><p>${escapeHtml(formatDate(session.session_date))}</p><h3>${escapeHtml(getModeLabel(session.game_mode))}</h3></div>
      <span class="session-status ${statusClass}">${statusLabel}</span>
    </div>
    <div class="history-session-meta">
      <span>${escapeHtml(session.rate_label || "レート未設定")}（×${formatNumber(session.rate_multiplier, 0)}）</span>
      <span>半荘 ${hanchanCount}回</span>
      <span>参加 ${participants.length}人</span>
    </div>
    <p class="history-session-members">${participants.length ? participants.map((name) => `<span>${escapeHtml(name)}</span>`).join("") : "参加者情報がありません。"}</p>
    ${session.notes ? `<p class="history-session-note">${escapeHtml(session.notes)}</p>` : ""}
    <div class="history-session-actions"><button type="button" class="secondary-button" data-open-history-session-id="${session.id}">記録を開く</button></div>
  </article>`;
}

function renderHistoryPage() {
  const page = getPageWorkspace();
  if (!currentSession) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MATCH HISTORY</p><h2>ログインが必要です</h2><p class="workspace-description">対局カレンダーと履歴検索は、ログイン後に利用できます。</p><button id="historyBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("historyBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }
  if (!getActiveGroup()) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MATCH HISTORY</p><h2>先にグループを作成してください</h2><button id="historyBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("historyBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }
  const rates = getHistoryRateOptions();
  const filtered = getFilteredHistorySessions();
  const periodLabel = historyPeriodMode === "all" ? "全期間" : historyPeriodMode === "year" ? `${historyMonthParts().year}年` : historyMonthLabel();
  const selectedDateLabel = historySelectedDate ? formatDate(historySelectedDate) : "";
  page.innerHTML = `<section class="game-card history-card">
    <div class="game-card-heading"><div><p class="eyebrow">MATCH HISTORY</p><h2>対局カレンダー・履歴検索</h2></div><span class="history-result-count">${filtered.length}件</span></div>
    <p class="game-description">対局日、参加者、形式、レートで記録を絞り込めます。複数の参加者を選ぶと、全員が参加した麻雀会だけを表示します。</p>
    ${historyMessage ? `<p class="settings-notice">${escapeHtml(historyMessage)}</p>` : ""}
    ${buildHistoryCalendarHtml()}
    <section class="history-filter-panel">
      <div class="history-filter-heading"><p class="game-section-title">履歴を絞り込む</p><button type="button" class="icon-text-button" data-reset-history-filters>条件をリセット</button></div>
      <div class="history-period-tabs"><span>表示期間</span><div><button type="button" class="ranking-filter-button ${historyPeriodMode === "all" ? "active" : ""}" data-history-period="all">全期間</button><button type="button" class="ranking-filter-button ${historyPeriodMode === "year" ? "active" : ""}" data-history-period="year">${historyMonthParts().year}年</button><button type="button" class="ranking-filter-button ${historyPeriodMode === "month" ? "active" : ""}" data-history-period="month">${historyMonthLabel()}</button></div></div>
      <div class="history-filter-grid">
        <label>形式<select id="historyModeFilter"><option value="all">すべて</option><option value="sanma" ${historyFilterMode === "sanma" ? "selected" : ""}>三人打ち</option><option value="yonin_sanma" ${historyFilterMode === "yonin_sanma" ? "selected" : ""}>四人三打ち</option><option value="yonma" ${historyFilterMode === "yonma" ? "selected" : ""}>四人打ち</option></select></label>
        <label>レート<select id="historyRateFilter"><option value="all">すべて</option>${rates.map((rate) => `<option value="${escapeHtml(rate)}" ${historyFilterRate === rate ? "selected" : ""}>${escapeHtml(rate)}</option>`).join("")}</select></label>
        <label>状態<select id="historyStatusFilter"><option value="all">すべて</option><option value="settled" ${historyFilterStatus === "settled" ? "selected" : ""}>精算済み</option><option value="open" ${historyFilterStatus === "open" ? "selected" : ""}>進行中</option></select></label>
        <label>キーワード<input id="historyKeywordFilter" type="search" value="${escapeHtml(historyKeyword)}" placeholder="メモ・参加者・レートで検索"></label>
      </div>
      <div class="history-member-filter"><span>参加者</span><div>${activeGroupMembers.map((member) => `<button type="button" class="history-member-choice ${historyFilterMemberIds.includes(member.id) ? "active" : ""}" data-history-member-id="${member.id}">${escapeHtml(member.display_name)}</button>`).join("") || `<small>メンバーがいません。</small>`}</div></div>
    </section>
    <section class="history-results-section"><div class="game-section-heading"><div><p class="game-section-title">${selectedDateLabel ? `${selectedDateLabel}の記録` : `${periodLabel}の記録`}</p><p class="game-section-note">${filtered.length}件の麻雀会</p></div></div><div class="history-session-list">${filtered.length ? filtered.map(renderHistorySessionCard).join("") : `<p class="game-section-note">条件に一致する記録はありません。</p>`}</div></section>
  </section>`;
  bindHistoryPageEvents();
}

function bindHistoryPageEvents() {
  document.querySelectorAll("[data-history-calendar-shift]").forEach((button) => button.addEventListener("click", () => shiftHistoryCalendarMonth(Number(button.dataset.historyCalendarShift))));
  document.querySelector("[data-history-calendar-today]")?.addEventListener("click", () => {
    historyCalendarMonth = todayInJapan().slice(0, 7);
    historySelectedDate = "";
    renderHistoryPage();
  });
  document.querySelector("[data-history-clear-date]")?.addEventListener("click", () => {
    historySelectedDate = "";
    renderHistoryPage();
  });
  document.querySelectorAll("[data-history-date]").forEach((button) => button.addEventListener("click", () => {
    const date = button.dataset.historyDate;
    historySelectedDate = historySelectedDate === date ? "" : date;
    renderHistoryPage();
  }));
  document.querySelectorAll("[data-history-period]").forEach((button) => button.addEventListener("click", () => {
    historyPeriodMode = button.dataset.historyPeriod;
    historySelectedDate = "";
    renderHistoryPage();
  }));
  document.getElementById("historyModeFilter")?.addEventListener("change", (event) => { historyFilterMode = event.target.value; historySelectedDate = ""; renderHistoryPage(); });
  document.getElementById("historyRateFilter")?.addEventListener("change", (event) => { historyFilterRate = event.target.value; historySelectedDate = ""; renderHistoryPage(); });
  document.getElementById("historyStatusFilter")?.addEventListener("change", (event) => { historyFilterStatus = event.target.value; historySelectedDate = ""; renderHistoryPage(); });
  document.getElementById("historyKeywordFilter")?.addEventListener("input", (event) => { historyKeyword = event.target.value; historySelectedDate = ""; renderHistoryPage(); });
  document.querySelectorAll("[data-history-member-id]").forEach((button) => button.addEventListener("click", () => {
    const memberId = button.dataset.historyMemberId;
    historyFilterMemberIds = historyFilterMemberIds.includes(memberId)
      ? historyFilterMemberIds.filter((id) => id !== memberId)
      : [...historyFilterMemberIds, memberId];
    historySelectedDate = "";
    renderHistoryPage();
  }));
  document.querySelector("[data-reset-history-filters]")?.addEventListener("click", () => {
    historyPeriodMode = "month";
    historySelectedDate = "";
    historyFilterMode = "all";
    historyFilterRate = "all";
    historyFilterStatus = "all";
    historyFilterMemberIds = [];
    historyKeyword = "";
    historyMessage = "検索条件をリセットしました。";
    renderHistoryPage();
  });
  document.querySelectorAll("[data-open-history-session-id]").forEach((button) => button.addEventListener("click", async () => {
    const sessionId = button.dataset.openHistorySessionId;
    if (!sessionId) return;
    activeMatchSessionId = sessionId;
    localStorage.setItem("jakuroku-active-match-session-id", sessionId);
    resetMatchViewState();
    await switchTab("game");
  }));
}

async function loadHistoryData() {
  const page = getPageWorkspace();
  if (!currentSession || !activeGroupId) {
    renderHistoryPage();
    return;
  }
  page.innerHTML = `<section class="workspace-card loading-card">対局履歴を読み込み中...</section>`;
  try {
    const { data: sessions, error: sessionsError } = await supabaseClient
      .from("match_sessions")
      .select("id, group_id, session_date, game_mode, rate_label, rate_multiplier, notes, status, created_at")
      .eq("group_id", activeGroupId)
      .is("deleted_at", null)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (sessionsError) throw sessionsError;
    historySessions = sessions || [];
    const sessionIds = historySessions.map((session) => session.id);
    if (!sessionIds.length) {
      historySessionMembers = [];
      historyHanchans = [];
      renderHistoryPage();
      return;
    }
    const [membersResponse, hanchansResponse] = await Promise.all([
      supabaseClient.from("match_session_members").select("session_id, member_id").in("session_id", sessionIds),
      supabaseClient.from("match_hanchans").select("id, session_id, sequence_no").in("session_id", sessionIds)
    ]);
    if (membersResponse.error) throw membersResponse.error;
    if (hanchansResponse.error) throw hanchansResponse.error;
    historySessionMembers = membersResponse.data || [];
    historyHanchans = hanchansResponse.data || [];
    renderHistoryPage();
  } catch (error) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MATCH HISTORY</p><h2>対局履歴を読み込めませんでした</h2><p class="workspace-description">${escapeHtml(error.message || "通信状態を確認してください。")}</p><button id="retryHistoryButton" class="primary-button" type="button">再読み込み</button></section>`;
    document.getElementById("retryHistoryButton")?.addEventListener("click", () => { void loadHistoryData(); });
  }
}

const switchTabV25 = switchTab;
switchTab = async function(tab) {
  if (tab === "history") {
    currentTab = tab;
    navItems.forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
    heroCard.hidden = true;
    roadmapSection.hidden = true;
    getGroupWorkspace().hidden = true;
    getPageWorkspace().hidden = false;
    await loadHistoryData();
    return;
  }
  return switchTabV25(tab);
};

const recordIdsForRealtimeV25 = recordIdsForRealtime;
recordIdsForRealtime = function() {
  const ids = recordIdsForRealtimeV25();
  historySessions.forEach((session) => ids.add(session.id));
  return ids;
};

const hanchanIdsForRealtimeV25 = hanchanIdsForRealtime;
hanchanIdsForRealtime = function() {
  const ids = hanchanIdsForRealtimeV25();
  historyHanchans.forEach((hanchan) => ids.add(hanchan.id));
  return ids;
};

const refreshCurrentViewFromRealtimeV25 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  const result = await refreshCurrentViewFromRealtimeV25(force);
  if (currentTab === "history" && currentSession && activeGroupId) {
    await loadHistoryData();
  }
  return result;
};

const switchActiveGroupV25 = switchActiveGroup;
switchActiveGroup = async function(groupId) {
  await switchActiveGroupV25(groupId);
  historySessions = [];
  historySessionMembers = [];
  historyHanchans = [];
  historySelectedDate = "";
  historyFilterMemberIds = [];
  if (currentTab === "history") await loadHistoryData();
};

const updateAuthUIV25 = updateAuthUI;
updateAuthUI = async function(session) {
  await updateAuthUIV25(session);
  if (!session) {
    historySessions = [];
    historySessionMembers = [];
    historyHanchans = [];
    historySelectedDate = "";
    historyFilterMemberIds = [];
  } else if (currentTab === "history") {
    await loadHistoryData();
  }
};

ensureHistoryNavigation();

/* v27: detailed performance analysis */
let rankingModeFilter = "all";
let rankingRateFilter = "all";

const getRankingSessionsForPeriodV26 = getRankingSessionsForPeriod;
getRankingSessionsForPeriod = function() {
  return getRankingSessionsForPeriodV26().filter((session) => {
    const modeMatched = rankingModeFilter === "all" || session.game_mode === rankingModeFilter;
    const rateKey = `${session.rate_label || ""}::${num(session.rate_multiplier || 0)}`;
    const rateMatched = rankingRateFilter === "all" || rateKey === rankingRateFilter;
    return modeMatched && rateMatched;
  });
};

function getRankingRateOptions() {
  return [...new Map(
    rankingRaw.sessions
      .map((session) => {
        const key = `${session.rate_label || ""}::${num(session.rate_multiplier || 0)}`;
        return [key, { key, label: `${session.rate_label || "カスタム"}（×${formatNumber(session.rate_multiplier || 0, 0)}）` }];
      })
  ).values()].sort((a, b) => a.label.localeCompare(b.label, "ja"));
}

function rankingModeFilterHtml() {
  const options = [
    ["all", "すべて"],
    ["sanma", "三人打ち"],
    ["yonin_sanma", "四人三打ち"],
    ["yonma", "四人打ち"]
  ];
  return options.map(([key, label]) => `<button type="button" class="ranking-filter-button ${rankingModeFilter === key ? "active" : ""}" data-ranking-mode-filter="${key}">${label}</button>`).join("");
}

function buildDetailedPerformanceProfile(memberId) {
  const dashboard = buildRankingDashboard();
  const selected = dashboard.entries.find((entry) => entry.memberId === memberId);
  if (!selected) return null;

  const sessions = getRankingSessionsForPeriod().slice().sort((a, b) => {
    const byDate = String(a.session_date).localeCompare(String(b.session_date));
    return byDate || String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
  const sessionIds = new Set(sessions.map((session) => session.id));
  const membersBySession = new Map();
  const hanchansBySession = new Map();
  const resultsByHanchan = new Map();
  const dailyBySession = new Map();

  rankingRaw.sessionMembers.filter((member) => sessionIds.has(member.session_id)).forEach((member) => {
    if (!membersBySession.has(member.session_id)) membersBySession.set(member.session_id, []);
    membersBySession.get(member.session_id).push(member.member_id);
  });
  rankingRaw.hanchans.filter((hanchan) => sessionIds.has(hanchan.session_id)).forEach((hanchan) => {
    if (!hanchansBySession.has(hanchan.session_id)) hanchansBySession.set(hanchan.session_id, []);
    hanchansBySession.get(hanchan.session_id).push(hanchan);
  });
  rankingRaw.results.forEach((result) => {
    if (!resultsByHanchan.has(result.hanchan_id)) resultsByHanchan.set(result.hanchan_id, []);
    resultsByHanchan.get(result.hanchan_id).push(result);
  });
  dashboard.dailySessions.forEach((day) => {
    const player = day.players.find((item) => item.memberId === memberId);
    if (player) dailyBySession.set(day.sessionId, { ...day, player });
  });

  const makeStat = (label) => ({ label, sessions: 0, hanchans: 0, rankSum: 0, firstCount: 0, lastCount: 0, totalPt: 0 });
  const modeStats = new Map();
  const rateStats = new Map();
  const timeline = [];
  const dailyValues = [];

  sessions.forEach((session) => {
    const day = dailyBySession.get(session.id);
    if (!day) return;
    const memberCount = (membersBySession.get(session.id) || []).length || (session.game_mode === "sanma" ? 3 : 4);
    const modeKey = session.game_mode || "other";
    const rateKey = `${session.rate_label || "カスタム"}::${num(session.rate_multiplier || 0)}`;
    if (!modeStats.has(modeKey)) modeStats.set(modeKey, makeStat(getModeLabel(modeKey)));
    if (!rateStats.has(rateKey)) rateStats.set(rateKey, makeStat(`${session.rate_label || "カスタム"}（×${formatNumber(session.rate_multiplier || 0, 0)}）`));
    const modeStat = modeStats.get(modeKey);
    const rateStat = rateStats.get(rateKey);
    [modeStat, rateStat].forEach((stat) => { stat.sessions += 1; stat.totalPt = roundTo(stat.totalPt + num(day.player.totalPt), 2); });
    dailyValues.push({ date: session.session_date, totalPt: num(day.player.totalPt), mode: session.game_mode, rateLabel: session.rate_label });

    const hanchans = (hanchansBySession.get(session.id) || []).slice().sort((a, b) => num(a.sequence_no) - num(b.sequence_no));
    hanchans.forEach((hanchan) => {
      const result = (resultsByHanchan.get(hanchan.id) || []).find((item) => item.member_id === memberId);
      if (!result) return;
      const rank = num(result.rank);
      [modeStat, rateStat].forEach((stat) => {
        stat.hanchans += 1;
        stat.rankSum += rank;
        if (rank === 1) stat.firstCount += 1;
        if (rank === memberCount) stat.lastCount += 1;
      });
      timeline.push({ date: session.session_date, createdAt: session.created_at, sequenceNo: num(hanchan.sequence_no), rank, memberCount });
    });
  });

  let currentWin = 0, currentLast = 0, maxWin = 0, maxLast = 0;
  timeline.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.sequenceNo - b.sequenceNo).forEach((item) => {
    if (item.rank === 1) {
      currentWin += 1;
      currentLast = 0;
    } else if (item.rank === item.memberCount) {
      currentLast += 1;
      currentWin = 0;
    } else {
      currentWin = 0;
      currentLast = 0;
    }
    maxWin = Math.max(maxWin, currentWin);
    maxLast = Math.max(maxLast, currentLast);
  });

  const summarize = (stat) => ({
    ...stat,
    averageRank: stat.hanchans ? roundTo(stat.rankSum / stat.hanchans, 2) : null,
    firstRate: stat.hanchans ? roundTo((stat.firstCount / stat.hanchans) * 100, 1) : null,
    lastRate: stat.hanchans ? roundTo((stat.lastCount / stat.hanchans) * 100, 1) : null
  });
  const bestDay = dailyValues.length ? dailyValues.reduce((best, item) => item.totalPt > best.totalPt ? item : best, dailyValues[0]) : null;
  const worstDay = dailyValues.length ? dailyValues.reduce((worst, item) => item.totalPt < worst.totalPt ? item : worst, dailyValues[0]) : null;

  return {
    selected,
    averageRank: selected.averageRank,
    firstRate: selected.firstRate,
    lastRate: selected.hanchans ? roundTo((timeline.filter((item) => item.rank === item.memberCount).length / selected.hanchans) * 100, 1) : null,
    bestDay,
    worstDay,
    maxWin,
    maxLast,
    modeStats: [...modeStats.values()].map(summarize).sort((a, b) => b.totalPt - a.totalPt),
    rateStats: [...rateStats.values()].map(summarize).sort((a, b) => b.totalPt - a.totalPt)
  };
}

function renderPerformanceTable(rows, emptyText) {
  if (!rows.length) return `<p class="ranking-note">${escapeHtml(emptyText)}</p>`;
  return `<div class="performance-table-wrap"><table class="performance-table"><thead><tr><th>区分</th><th>半荘</th><th>平均順位</th><th>1位率</th><th>ラス率</th><th>ゲームpt</th></tr></thead><tbody>${rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${row.hanchans}回</td><td>${row.averageRank ?? "-"}</td><td>${row.firstRate !== null ? `${row.firstRate}%` : "-"}</td><td>${row.lastRate !== null ? `${row.lastRate}%` : "-"}</td><td>${formatPtMarkup(row.totalPt)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderDetailedPerformanceSection() {
  const dashboard = buildRankingDashboard();
  const entries = dashboard.entries;
  if (!entries.length) return "";
  if (!entries.some((entry) => entry.memberId === rankingSelectedMemberId)) rankingSelectedMemberId = entries[0].memberId;
  const profile = buildDetailedPerformanceProfile(rankingSelectedMemberId);
  if (!profile) return "";
  const playerOptions = entries.map((entry) => `<option value="${entry.memberId}" ${entry.memberId === rankingSelectedMemberId ? "selected" : ""}>${escapeHtml(entry.displayName)}</option>`).join("");
  const labelForDay = (day) => day ? `${formatDate(day.date)}　${formatPtMarkup(day.totalPt)}` : "-";
  return `<section class="game-section detailed-analysis-section">
    <div class="game-section-heading"><div><p class="game-section-title">成績詳細分析</p><p class="game-section-note">順位・連勝／連ラスは半荘単位、最高／最低ゲームptは日次のチップ込みゲーム収支です。</p></div><select id="detailedAnalysisMemberSelect" class="ranking-member-select">${playerOptions}</select></div>
    <div class="detailed-analysis-kpis">
      <div><span>平均順位</span><strong>${profile.averageRank ?? "-"}</strong></div>
      <div><span>1位率</span><strong>${profile.firstRate !== null ? `${profile.firstRate}%` : "-"}</strong></div>
      <div><span>ラス率</span><strong>${profile.lastRate !== null ? `${profile.lastRate}%` : "-"}</strong></div>
      <div><span>最長連勝</span><strong>${profile.maxWin}連勝</strong></div>
      <div><span>最長連ラス</span><strong>${profile.maxLast}連ラス</strong></div>
      <div><span>最高ゲームpt</span><strong>${labelForDay(profile.bestDay)}</strong></div>
      <div><span>最低ゲームpt</span><strong>${labelForDay(profile.worstDay)}</strong></div>
    </div>
    <div class="performance-breakdown-grid">
      <div class="performance-breakdown-card"><p>形式別成績</p>${renderPerformanceTable(profile.modeStats, "形式別の成績がありません。")}</div>
      <div class="performance-breakdown-card"><p>レート別成績</p>${renderPerformanceTable(profile.rateStats, "レート別の成績がありません。")}</div>
    </div>
  </section>`;
}

function bindDetailedAnalysisControls() {
  document.querySelectorAll("[data-ranking-mode-filter]").forEach((button) => button.addEventListener("click", () => {
    rankingModeFilter = button.dataset.rankingModeFilter;
    rankingSelectedMemberId = "";
    rankingOpenSessionId = null;
    renderRankingPage();
  }));
  document.getElementById("rankingRateFilter")?.addEventListener("change", (event) => {
    rankingRateFilter = event.target.value;
    rankingSelectedMemberId = "";
    rankingOpenSessionId = null;
    renderRankingPage();
  });
  document.getElementById("detailedAnalysisMemberSelect")?.addEventListener("change", (event) => {
    rankingSelectedMemberId = event.target.value;
    renderRankingPage();
  });
  document.querySelector("[data-reset-ranking-analysis-filter]")?.addEventListener("click", () => {
    rankingModeFilter = "all";
    rankingRateFilter = "all";
    rankingSelectedMemberId = "";
    rankingOpenSessionId = null;
    renderRankingPage();
  });
}

function getDetailedAnalysisFilterHtml() {
  const rateOptions = getRankingRateOptions();
  if (rankingRateFilter !== "all" && !rateOptions.some((item) => item.key === rankingRateFilter)) rankingRateFilter = "all";
  return `<div class="ranking-analysis-filter-row"><p>形式</p><div class="ranking-filter-list">${rankingModeFilterHtml()}</div><label class="ranking-rate-filter">レート<select id="rankingRateFilter"><option value="all">すべて</option>${rateOptions.map((item) => `<option value="${escapeHtml(item.key)}" ${rankingRateFilter === item.key ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label></div>`;
}

function enhanceRankingWithDetailedAnalysis() {
  const page = getPageWorkspace();
  if (!rankingRaw.sessions.length) return;
  const rankingPanel = page.querySelector(".ranking-control-panel");
  if (!rankingPanel) {
    const emptyCard = page.querySelector(".ranking-empty-card");
    if (emptyCard) {
      emptyCard.insertAdjacentHTML("beforeend", `<div class="ranking-empty-filter"><p>現在の形式・レート条件に一致する精算済み記録がありません。</p>${getDetailedAnalysisFilterHtml()}<button type="button" class="secondary-button" data-reset-ranking-analysis-filter>形式・レート条件をリセット</button></div>`);
      bindDetailedAnalysisControls();
    }
    return;
  }
  rankingPanel.insertAdjacentHTML("beforeend", getDetailedAnalysisFilterHtml());
  const target = page.querySelector(".daily-history-section") || page.querySelector(".yakuman-ranking-list")?.closest(".game-section");
  if (target) target.insertAdjacentHTML("beforebegin", renderDetailedPerformanceSection());
  bindDetailedAnalysisControls();
}

const renderRankingPageV26 = renderRankingPage;
renderRankingPage = function() {
  renderRankingPageV26();
  enhanceRankingWithDetailedAnalysis();
};
