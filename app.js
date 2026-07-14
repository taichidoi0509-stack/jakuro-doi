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
let selectedHanchanDetailId = null;
let chipDraft = {};
let chipTouchedMemberIds = new Set();
let chipAutoMemberId = "";
let lastAutoTobiSignature = "";
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
  return { uma: [...activeMatchSession.default_uma], notes: "", results, rankMode: "auto", tobiTransfers: [], tobiRecipientsByFrom: {}, yakumanRecords: [] };
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
    rankMode: "auto",
    tobiTransfers,
    tobiRecipientsByFrom: buildTobiRecipientsFromTransfers(tobiTransfers),
    yakumanRecords
  };
}
function startEditHanchan(hanchanId) {
  selectedHanchanDetailId = hanchanId;
  editingHanchanId = hanchanId;
  hanchanDraft = createHanchanDraftFromRecord(hanchanId);
  showHanchanEditor = true;
  showChipEditor = false;
  showVenueEditor = false;
  renderActiveSessionView();
}
function resetMatchViewState() { showCreateSession = false; showHanchanEditor = false; showChipEditor = false; showVenueEditor = false; hanchanDraft = null; editingHanchanId = null; selectedHanchanDetailId = null; chipDraft = {}; chipTouchedMemberIds = new Set(); chipAutoMemberId = ""; lastAutoTobiSignature = ""; venueDraft = { total: 0, prepayments: {} }; gameMessage = ""; }

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
  document.body.insertAdjacentHTML("beforeend", `<div class="auth-overlay"><section class="auth-dialog" role="dialog" aria-modal="true"><button class="auth-close-button" type="button">×</button><p class="eyebrow">森研麻雀倶楽部 ACCOUNT</p><h2>${signup ? "アカウントを作成" : "ログイン"}</h2><form id="authForm" class="auth-form">${signup ? `<label>表示名<input name="displayName" type="text" maxlength="40" required></label>` : ""}<label>メールアドレス<input name="email" type="email" autocomplete="email" required></label><label>パスワード<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" required></label><p id="authMessage" class="auth-message"></p><button id="authSubmitButton" class="auth-submit-button" type="submit">${signup ? "登録する" : "ログインする"}</button></form><button id="authModeButton" class="auth-mode-button" type="button">${signup ? "すでに登録済みの場合はログイン" : "初めての場合は新規登録"}</button></section></div>`);
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
    { name: "README.txt", content: `森研麻雀倶楽部 データ出力\n\nグループ: ${group.name}\n対象期間: ${getExportPeriodLabel()}\n出力日時: ${new Date().toLocaleString("ja-JP")}\n\n「03_チップと精算.csv」の game_pt_excluding_venue は、場代を除くゲーム収支です。\nfinal_settlement_pt_including_venue は、場代均等負担と先払いを反映した最終精算額です。\n` }
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

  const sortedHanchans = [...activeHanchans].sort((a, b) => num(a.sequence_no) - num(b.sequence_no));
  if (sortedHanchans.length) {
    const exists = sortedHanchans.some((hanchan) => hanchan.id === selectedHanchanDetailId);
    if (!exists) selectedHanchanDetailId = sortedHanchans[sortedHanchans.length - 1].id;
  } else {
    selectedHanchanDetailId = null;
  }
  const selectedHanchan = sortedHanchans.find((hanchan) => hanchan.id === selectedHanchanDetailId) || null;
  const selectedHanchanDetail = selectedHanchan
    ? buildSelectedHanchanDetail(selectedHanchan, session)
    : `<div class="game-empty-result">まだ半荘が登録されていません。半荘を追加すると、スコア表から各半荘の詳細を開けます。</div>`;

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
    ? routes.map((route) => `
      <div class="payment-route-row payment-route-debt-row">
        <span>${escapeHtml(route.from)} <b>→</b> ${escapeHtml(route.to)}</span>
        <div><strong>${formatPtPlain(route.amount)}</strong>${session.status === "settled" ? `<small class="route-debt-auto-label">借ptへ自動登録</small>` : ""}</div>
      </div>
    `).join("")
    : `<p class="game-section-note">送金は不要です。</p>`;
  const sessionProgress = buildSessionProgressTrend();
  const sessionScoreSheet = buildSessionScoreSheet();
  const nextHanchanNo = sortedHanchans.length + 1;
  const chipStatusLabel = activeSessionChips.length ? "入力済み" : "未入力";
  const venueStatusLabel = fee > 0 || activeVenuePrepayments.length ? (venueReady ? "一致" : "要確認") : "未入力";
  const venueStatusClass = fee > 0 || activeVenuePrepayments.length ? (venueReady ? "ok" : "warn") : "idle";
  const liveHanchanLabel = showHanchanEditor
    ? editingHanchanId ? "半荘編集を閉じる" : "半荘入力を閉じる"
    : session.status === "open" ? `第${nextHanchanNo}半荘を登録` : editingHanchanId ? "編集中" : "精算済み";
  const liveEditorPanel = `${showHanchanEditor ? renderHanchanEditor() : ""}${showChipEditor ? renderChipEditor() : ""}${showVenueEditor ? renderVenueEditor() : ""}`;

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

      <section class="game-section live-input-panel" id="liveInputPanel">
        <div class="game-section-heading live-input-heading">
          <div>
            <p class="eyebrow">LIVE INPUT</p>
            <p class="game-section-title">対局中の入力</p>
            <p class="game-section-note">半荘登録・チップ・場代・精算をここから操作します。対局中はこのエリアだけ見れば進められます。</p>
          </div>
          <span class="session-status ${session.status}">${session.status === "settled" ? "精算済み" : "入力中"}</span>
        </div>
        <div class="live-action-grid">
          <button id="toggleHanchanEditorButton" class="live-action-card primary" type="button" ${session.status !== "open" && !showHanchanEditor ? "disabled" : ""}>
            <span class="live-action-icon">🀄</span>
            <span><strong>${liveHanchanLabel}</strong><small>${sortedHanchans.length}半荘登録済み</small></span>
          </button>
          <button id="toggleChipEditorButton" class="live-action-card" type="button">
            <span class="live-action-icon">◎</span>
            <span><strong>チップ</strong><small>${chipStatusLabel}</small></span>
          </button>
          <button id="toggleVenueEditorButton" class="live-action-card" type="button">
            <span class="live-action-icon">場</span>
            <span><strong>場代</strong><small class="status-${venueStatusClass}">${venueStatusLabel}</small></span>
          </button>
          <button id="jumpFinalSettlementButton" class="live-action-card" type="button">
            <span class="live-action-icon">↔</span>
            <span><strong>精算確認</strong><small>${venueReady ? "送金ルート確認" : "場代を確認"}</small></span>
          </button>
        </div>
        ${liveEditorPanel ? `<div class="live-editor-zone">${liveEditorPanel}</div>` : ""}
      </section>

      <section class="game-section session-progress-section">
        <div class="game-section-heading">
          <p class="game-section-title">この対局のpt推移</p>
          <span class="all-trend-note">半荘ごとの累積ゲーム収支</span>
        </div>
        <div class="trend-legend">${sessionProgress.legend}</div>
        <div class="trend-chart-wrap">${sessionProgress.svg}</div>
      </section>

      <section class="game-section score-sheet-section">
        <div class="game-section-heading">
          <div>
            <p class="game-section-title">スコア表</p>
            <p class="game-section-note">半荘を登録するたびに行が追加されます。第1・第2などを押すと、その半荘の詳細表示・編集へ進めます。</p>
          </div>
        </div>
        ${sessionScoreSheet}
      </section>

      <section class="game-section hanchan-detail-section">
        <div class="game-section-heading">
          <div>
            <p class="game-section-title">半荘詳細</p>
            <p class="game-section-note">スコア表の第1・第2などを押すと、表示する半荘を切り替えられます。</p>
          </div>
          <span class="section-side-note">登録・編集は上部の入力パネルから操作</span>
        </div>
        ${selectedHanchanDetail}
      </section>


      <section class="game-section" id="chipSummarySection">
        <div class="game-section-heading">
          <p class="game-section-title">終了時チップ</p>
          <span class="section-side-note">入力は上部の「チップ」から</span>
        </div>
        ${activeSessionChips.length ? `<div class="chip-summary-list">${activeMatchMembers.map((member) => `<div class="chip-summary-row"><span>${escapeHtml(getMemberName(member.member_id))}</span><strong>${formatChipMarkup(getChipCount(member.member_id))}</strong></div>`).join("")}</div>` : `<p class="game-section-note">チップは麻雀会が終わるタイミングで、全員分をまとめて入力します。</p>`}
      </section>


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

      <section class="game-section" id="venueSummarySection">
        <div class="game-section-heading"><p class="game-section-title">場代精算</p><span class="section-side-note">入力は上部の「場代」から</span></div>
        <div class="venue-summary-box">
          <div><span>場代合計</span><strong>${formatPtPlain(fee)}</strong></div>
          <div><span>先払い合計</span><strong>${formatPtPlain(prepaidTotal)}</strong></div>
          <div><span>照合</span><strong class="${venueReady ? "status-ok" : "status-error"}">${venueReady ? "一致" : "不一致"}</strong></div>
        </div>
        <p class="game-section-note">場代は参加者で均等負担します。先払いは複数人・一部払いに対応します。</p>
      </section>


      <section class="game-section final-settlement-section" id="finalSettlementSection">
        <p class="game-section-title">場代込み最終精算</p>
        <div class="final-settlement-list">${finalRows}</div>
        <div class="daily-total-footer"><span>最終pt合計</span><strong>${formatPtMarkup(finalSettlementPtSum)}</strong></div>
        <div class="payment-route-box"><p>送金ルート（相殺済み）</p>${venueReady ? routeRows : `<p class="game-section-note">場代合計と先払い合計を一致させると、送金ルートを表示します。</p>`}</div>
        ${session.status === "settled" ? `<button id="openResultShareCardButton" class="share-result-button" type="button">結果カードを作成</button><p class="game-section-note">ゲームpt・チップ・役満・送金ルートを1枚の画像にまとめます。</p>` : ""}
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
      chipTouchedMemberIds = new Set();
      chipAutoMemberId = "";
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
  document.getElementById("jumpFinalSettlementButton")?.addEventListener("click", () => {
    document.getElementById("finalSettlementSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("openResultShareCardButton")?.addEventListener("click", () => {
    openResultShareCard({ session, totals, routes, venueReady });
  });
  document.querySelectorAll("[data-register-route-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = routes[Number(button.dataset.registerRouteIndex)];
      if (route) void openSettlementDebtModal(route);
    });
  });
  document.querySelectorAll("[data-select-hanchan-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedHanchanDetailId = button.dataset.selectHanchanId;
      showHanchanEditor = false;
      editingHanchanId = null;
      hanchanDraft = null;
      renderActiveSessionView();
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
function applyAutoFinalPoints(options = {}) {
  if (!hanchanDraft || !activeMatchSession) return;
  // 編集中に値をいったん空にした場合は、自動値を即時に差し戻さない。
  // これにより全桁消去してから打ち直しても入力欄が奪われない。
  if (options.suppressAutoForMemberId) return;

  activeMatchMembers.forEach((m) => {
    const r = hanchanDraft.results[m.member_id];
    if (r.pointMode === "auto") {
      r.finalPoints = "";
      r.pointMode = "manual";
    }
  });

  const entered = activeMatchMembers.filter((m) => hasEnteredFinalPoints(m.member_id));
  if (entered.length !== activeMatchMembers.length - 1) return;

  const target = activeMatchMembers.find((m) => !hasEnteredFinalPoints(m.member_id));
  if (!target) return;

  const expected = num(activeMatchSession.starting_points) * activeMatchMembers.length;
  const used = entered.reduce((sum, member) => sum + Number(hanchanDraft.results[member.member_id].finalPoints), 0);
  hanchanDraft.results[target.member_id].finalPoints = expected - used;
  hanchanDraft.results[target.member_id].pointMode = "auto";
}
function getTobiMembersFromDraft() {
  if (!hanchanDraft || !activeMatchSession?.tobi_enabled) return [];
  if (!activeMatchMembers.every((member) => hasEnteredFinalPoints(member.member_id))) return [];
  return activeMatchMembers.filter((member) => Number(hanchanDraft.results[member.member_id].finalPoints) < 0);
}
function buildTobiRecipientsFromTransfers(transfers) {
  const map = {};
  (transfers || []).forEach((transfer) => {
    if (!transfer?.fromMemberId || !transfer?.toMemberId || num(transfer.points) <= 0) return;
    if (!map[transfer.fromMemberId]) map[transfer.fromMemberId] = [];
    if (!map[transfer.fromMemberId].includes(transfer.toMemberId)) map[transfer.fromMemberId].push(transfer.toMemberId);
  });
  return map;
}
function applyAutoTobiTransfers() {
  if (!hanchanDraft || !activeMatchSession?.tobi_enabled) return;
  const tobiMembers = getTobiMembersFromDraft();
  const manualTransfers = hanchanDraft.tobiTransfers.filter((transfer) => !transfer.autoGenerated);
  const nextTransfers = [...manualTransfers];
  tobiMembers.forEach((fromMember) => {
    const recipients = (hanchanDraft.tobiRecipientsByFrom?.[fromMember.member_id] || []).filter((id) => id && id !== fromMember.member_id);
    if (recipients.length === 1) {
      nextTransfers.push({ fromMemberId: fromMember.member_id, toMemberId: recipients[0], points: 10, autoGenerated: true });
    } else if (recipients.length === 2) {
      recipients.forEach((toMemberId) => nextTransfers.push({ fromMemberId: fromMember.member_id, toMemberId, points: 5, autoGenerated: true }));
    }
  });
  hanchanDraft.tobiTransfers = nextTransfers;
}
function renderTobiTransferRows() {
  return hanchanDraft.tobiTransfers.map((t,i) => `<div class="tobi-transfer-row"><label>飛ばされた人<select data-tobi-index="${i}" data-tobi-field="fromMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${t.fromMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label><label>飛ばした人<select data-tobi-index="${i}" data-tobi-field="toMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${t.toMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label><label>移動量<input type="number" min="0.1" step="0.1" value="${t.points}" data-tobi-index="${i}" data-tobi-field="points"></label><button type="button" class="remove-transfer-button" data-remove-tobi-index="${i}">削除</button></div>`).join("");
}

function renderAutoTobiPanelMarkup() {
  // 入力中にDOMを作り直さないため、全参加者分の受取先パネルを最初から保持する。
  // 実際にトビした人だけを表示・有効化する。
  return `<div id="autoTobiPanel" class="auto-tobi-panel is-idle" aria-live="polite"><p class="auto-tobi-title" data-auto-tobi-title>トビ発生</p><p class="game-section-note" data-auto-tobi-help>最終持ち点がマイナスになると、飛ばし点の受取先を選べます。</p>${activeMatchMembers.map((fromMember) => {
    const candidates = activeMatchMembers.filter((member) => member.member_id !== fromMember.member_id);
    return `<article class="auto-tobi-card" data-auto-tobi-card="${fromMember.member_id}" hidden><strong>${escapeHtml(getMemberName(fromMember.member_id))} がトビ</strong><small>受取先を1人または2人選択</small><div class="tobi-recipient-grid">${candidates.map((member) => `<label class="tobi-recipient-choice"><input type="checkbox" data-auto-tobi-from-member-id="${fromMember.member_id}" value="${member.member_id}"><span>${escapeHtml(getMemberName(member.member_id))}</span></label>`).join("")}</div><p class="auto-tobi-status" data-auto-tobi-status="${fromMember.member_id}">受取先を選択してください</p></article>`;
  }).join("")}</div>`;
}

function bindAutoTobiRecipientEvents(root = document) {
  root.querySelectorAll("[data-auto-tobi-from-member-id]").forEach((input) => input.addEventListener("change", () => {
    const fromMemberId = input.dataset.autoTobiFromMemberId;
    const current = new Set(hanchanDraft.tobiRecipientsByFrom?.[fromMemberId] || []);
    if (input.checked) {
      if (current.size >= 2) { input.checked = false; return; }
      current.add(input.value);
    } else {
      current.delete(input.value);
    }
    hanchanDraft.tobiRecipientsByFrom = { ...(hanchanDraft.tobiRecipientsByFrom || {}), [fromMemberId]: [...current] };
    applyAutoTobiTransfers();
    refreshAutoTobiPanel(true);
    refreshHanchanPreview();
    refreshAllHanchanCards();
  }));
}

function getAutoRanksFromFinalPoints() {
  if (!hanchanDraft || !activeMatchMembers.length) return { complete: false, hasTie: false, valid: false, ranks: {}, displayRanks: {}, umaByMember: {}, tieGroups: [] };
  if (!activeMatchMembers.every((member) => hasEnteredFinalPoints(member.member_id))) return { complete: false, hasTie: false, valid: false, ranks: {}, displayRanks: {}, umaByMember: {}, tieGroups: [] };

  const ordered = [...activeMatchMembers].sort((a, b) => Number(hanchanDraft.results[b.member_id].finalPoints) - Number(hanchanDraft.results[a.member_id].finalPoints));
  const ranks = {};
  const displayRanks = {};
  const umaByMember = {};
  const tieGroups = [];
  let cursor = 0;
  let hasTie = false;

  while (cursor < ordered.length) {
    const points = Number(hanchanDraft.results[ordered[cursor].member_id].finalPoints);
    let end = cursor + 1;
    while (end < ordered.length && Number(hanchanDraft.results[ordered[end].member_id].finalPoints) === points) end += 1;
    const group = ordered.slice(cursor, end);
    const displayRank = cursor + 1;
    const splitUma = roundOne(hanchanDraft.uma.slice(cursor, end).reduce((sum, value) => sum + num(value), 0) / group.length);
    const memberIds = group.map((member) => member.member_id);

    if (group.length > 1) {
      hasTie = true;
      tieGroups.push({ startIndex: cursor, endIndex: end, displayRank, memberIds, splitUma });
    }

    group.forEach((member, offset) => {
      // DB側は順位の重複を許可しないため、保存値は連番にする。
      // 画面表示とウマ計算は displayRanks / umaByMember で同着として扱う。
      ranks[member.member_id] = cursor + offset + 1;
      displayRanks[member.member_id] = displayRank;
      umaByMember[member.member_id] = splitUma;
    });
    cursor = end;
  }

  return { complete: true, hasTie, valid: true, ranks, displayRanks, umaByMember, tieGroups };
}

function getManualRanksFromDraft() {
  if (!hanchanDraft || !activeMatchMembers.length) return { complete: false, hasTie: false, valid: false, ranks: {}, displayRanks: {}, umaByMember: {}, tieGroups: [] };
  if (!activeMatchMembers.every((member) => hasEnteredFinalPoints(member.member_id))) return { complete: false, hasTie: false, valid: false, ranks: {}, displayRanks: {}, umaByMember: {}, tieGroups: [] };
  const ranks = {};
  const seen = new Set();
  const count = activeMatchMembers.length;
  for (const member of activeMatchMembers) {
    const rank = Number(hanchanDraft.results[member.member_id].rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > count || seen.has(rank)) {
      return { complete: true, hasTie: false, valid: false, ranks: {}, umaByMember: {} };
    }
    seen.add(rank);
    ranks[member.member_id] = rank;
  }
  const umaByMember = {};
  activeMatchMembers.forEach((member) => { umaByMember[member.member_id] = num(hanchanDraft.uma[ranks[member.member_id] - 1]); });
  return { complete: true, hasTie: false, valid: true, ranks, umaByMember };
}

function getDraftRankState() {
  return hanchanDraft?.rankMode === "manual" ? getManualRanksFromDraft() : getAutoRanksFromFinalPoints();
}

function syncAutoRanks() {
  const rankState = getDraftRankState();
  if (!rankState.complete || !rankState.valid || hanchanDraft?.rankMode === "manual") return rankState;
  activeMatchMembers.forEach((member) => { hanchanDraft.results[member.member_id].rank = rankState.ranks[member.member_id]; });
  return rankState;
}

function getDraftRank(memberId) {
  const rankState = syncAutoRanks();
  return rankState.complete && rankState.valid ? rankState.ranks[memberId] : null;
}

function calculateDraftHanchanResult(memberId) {
  const r = hanchanDraft.results[memberId];
  const rankState = syncAutoRanks();
  if (!hasEnteredFinalPoints(memberId) || !rankState.complete || !rankState.valid) return { scorePoints: null, umaPoints: null, tobiPoints: null, totalPoints: null };
  const score = roundOne((Number(r.finalPoints) - num(activeMatchSession.starting_points)) / 1000);
  const uma = num(rankState.umaByMember[memberId]);
  const tobi = roundOne(hanchanDraft.tobiTransfers.reduce((sum, transfer) => sum + (transfer.toMemberId === memberId ? num(transfer.points) : 0) - (transfer.fromMemberId === memberId ? num(transfer.points) : 0), 0));
  return { scorePoints: score, umaPoints: uma, tobiPoints: tobi, totalPoints: roundOne(score + uma + tobi) };
}
function renderHanchanEditor() {
  if (!hanchanDraft) hanchanDraft = createDefaultHanchanDraft();
  const editing = getEditingHanchan();
  const isEditing = Boolean(editingHanchanId && editing);
  const no = isEditing ? editing.sequence_no : activeHanchans.length + 1;
  const balance = getDraftPointBalance();
  const uma = hanchanDraft.uma.map((v,i) => `<label>${i+1}位<input type="number" step="0.1" data-hanchan-uma-index="${i}" value="${v}"></label>`).join("");
  const rankState = getDraftRankState();
  const showManualRankControl = hanchanDraft.rankMode === "manual";
  const cards = activeMatchMembers.map((m) => {
    const r = hanchanDraft.results[m.member_id];
    const c = calculateDraftHanchanResult(m.member_id);
    const rankLabel = !rankState.complete
      ? "持ち点入力後に確定"
      : !rankState.valid
        ? "順位を1〜${activeMatchMembers.length}位で重複なく指定"
        : hanchanDraft.rankMode === "manual"
          ? `${rankState.ranks[m.member_id]}位（手入力）`
          : rankState.hasTie
            ? `${rankState.displayRanks?.[m.member_id] || rankState.ranks[m.member_id]}位同着（ウマを均等分配）`
            : `${rankState.ranks[m.member_id]}位（自動）`;
    const rankControl = showManualRankControl
      ? `<label>順位<select data-hanchan-manual-rank-member-id="${m.member_id}">${Array.from({ length: activeMatchMembers.length }, (_, index) => `<option value="${index + 1}" ${Number(r.rank) === index + 1 ? "selected" : ""}>${index + 1}位</option>`).join("")}</select></label>`
      : `<label>順位<output class="auto-rank-output ${!rankState.valid && rankState.complete ? "error" : ""}" data-hanchan-rank-member-id="${m.member_id}">${rankLabel}</output></label>`;
    return `<article class="result-entry-card"><div class="result-entry-header"><strong>${escapeHtml(getMemberName(m.member_id))}</strong><span data-hanchan-total-member-id="${m.member_id}">${formatScoreMarkup(c.totalPoints)}</span></div><div class="result-input-grid">${rankControl}<label>最終持ち点<input class="signed-number-input ${inputValueClass(r.finalPoints)}" type="number" step="100" data-hanchan-result-member-id="${m.member_id}" data-hanchan-result-field="finalPoints" data-hanchan-point-input-id="${m.member_id}" value="${escapeHtml(r.finalPoints)}" placeholder="例：35000 / -1000"><small class="point-mode-badge ${r.pointMode === "auto" ? "auto" : ""}" data-hanchan-point-mode-id="${m.member_id}">${r.pointMode === "auto" ? "自動計算" : "手入力"}</small></label></div><p class="result-breakdown" data-hanchan-breakdown-member-id="${m.member_id}">素点 ${formatScoreMarkup(c.scorePoints)} ／ ウマ ${formatScoreMarkup(c.umaPoints)} ／ 飛ばし点 ${formatScoreMarkup(c.tobiPoints)}</p></article>`;
  }).join("");
  const transfers = renderTobiTransferRows();
  const tobiMembers = getTobiMembersFromDraft();
  const autoTobiPanel = renderAutoTobiPanelMarkup();
  const yakumans = hanchanDraft.yakumanRecords.map((r,i) => `<article class="yakuman-entry-card"><div class="yakuman-entry-heading"><strong>役満 ${i+1}</strong><button type="button" class="remove-transfer-button" data-remove-yakuman-index="${i}">削除</button></div><div class="yakuman-entry-grid"><label>役満<select data-yakuman-index="${i}" data-yakuman-field="yakumanName">${YAKUMAN_OPTIONS.map((name) => `<option value="${name}" ${r.yakumanName === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>${r.yakumanName === "その他" ? `<label>役満名<input type="text" maxlength="60" value="${escapeHtml(r.customName)}" data-yakuman-index="${i}" data-yakuman-field="customName"></label>` : ""}<label>あがった人<select data-yakuman-index="${i}" data-yakuman-field="winnerMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${r.winnerMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label><label>あがり方<select data-yakuman-index="${i}" data-yakuman-field="winType"><option value="tsumo" ${r.winType === "tsumo" ? "selected" : ""}>ツモ</option><option value="ron" ${r.winType === "ron" ? "selected" : ""}>ロン</option></select></label>${r.winType === "ron" ? `<label>放銃者<select data-yakuman-index="${i}" data-yakuman-field="houjuuMemberId"><option value="">選択</option>${activeMatchMembers.map((m) => `<option value="${m.member_id}" ${r.houjuuMemberId === m.member_id ? "selected" : ""}>${escapeHtml(getMemberName(m.member_id))}</option>`).join("")}</select></label>` : ""}</div></article>`).join("");
  const balanceText = balance.complete ? balance.difference === 0 ? `最終持ち点合計：${balance.total.toLocaleString()}点 / 一致` : `最終持ち点合計：${balance.total.toLocaleString()}点 / 差額 ${balance.difference > 0 ? "+" : ""}${balance.difference.toLocaleString()}点` : `最終持ち点入力：${balance.enteredCount} / ${activeMatchMembers.length}人`;
  return `<section class="hanchan-editor"><div class="editor-heading"><div><p class="eyebrow">${isEditing ? "EDIT HANCHAN" : "ADD HANCHAN"}</p><h3>第${no}半荘を${isEditing ? "編集" : "登録"}</h3></div></div><form id="hanchanForm"><section class="game-section"><p class="game-section-title">この半荘のウマ</p><div class="uma-grid">${uma}</div></section><section class="game-section"><p class="game-section-title">最終持ち点</p><p id="hanchanPointBalance" class="point-balance ${balance.complete && balance.difference !== 0 ? "error" : ""}">${balanceText}</p><p class="game-section-note">順位は最終持ち点の高い順に自動で確定します。同点は同着として、該当順位のウマを均等に分配します。例：2・3位同点なら、2位ウマと3位ウマの平均を両者へ配分します。</p><div class="tie-rank-control">${rankState.complete && rankState.hasTie && hanchanDraft.rankMode !== "manual" ? `<p class="game-section-note">同着を自動処理しています。順位を例外的に分ける場合のみ、手入力へ切り替えてください。</p><button type="button" id="enableManualRankButton" class="secondary-button">順位を手入力で指定</button>` : ""}${hanchanDraft.rankMode === "manual" ? `<p class="game-section-note">手入力中：同点でも順位を分けて登録できます。順位は重複なく指定してください。</p><button type="button" id="enableAutoRankButton" class="secondary-button">持ち点から自動判定へ戻す</button>` : ""}</div><div class="result-entry-list">${cards}</div></section>${activeMatchSession.tobi_enabled ? `<section class="game-section"><div class="game-section-heading"><p class="game-section-title">飛ばし点</p><div class="inline-button-group"><button id="addTobiTenButton" class="secondary-button" type="button">＋ 手動10移動</button><button id="addTobiFiveButton" class="secondary-button" type="button">＋ 手動5移動</button></div></div><div id="autoTobiPanelHost">${autoTobiPanel}</div><p id="autoTobiNote" class="game-section-note">${tobiMembers.length ? "上の選択が飛ばし点へ自動反映されます。イレギュラー時だけ手動移動を追加してください。" : "最終持ち点がマイナスになると、自動で飛ばし点の受取先を選べます。"}</p><div id="tobiTransferList" class="tobi-transfer-list">${transfers || `<p class="game-section-note">飛ばし点なし</p>`}</div></section>` : ""}<section class="game-section"><div class="game-section-heading"><p class="game-section-title">役満記録</p><button id="addYakumanButton" class="secondary-button" type="button">＋ 役満を追加</button></div><p class="game-section-note">数え役満、流し役満、四華和、パッチリ、その他も記録できます。</p><div class="yakuman-entry-list">${yakumans || `<p class="game-section-note">役満記録なし</p>`}</div></section><section class="game-section"><p class="game-section-title">メモ</p><textarea class="game-notes-input" rows="2" data-hanchan-note>${escapeHtml(hanchanDraft.notes)}</textarea></section><section id="hanchanPreview" class="game-preview"></section><p id="hanchanFormMessage" class="game-form-message"></p><button id="saveHanchanButton" class="save-game-button" type="submit">${isEditing ? `第${no}半荘の変更を保存` : `第${no}半荘を登録`}</button></form></section>`;
}
function bindTobiTransferEvents(root = document) {
  root.querySelectorAll("[data-tobi-field]").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
    const transfer = hanchanDraft.tobiTransfers[Number(input.dataset.tobiIndex)];
    const field = input.dataset.tobiField;
    transfer[field] = field === "points" ? num(input.value) : input.value;
    refreshHanchanPreview();
    refreshAllHanchanCards();
  }));
  root.querySelectorAll("[data-remove-tobi-index]").forEach((button) => button.addEventListener("click", () => {
    hanchanDraft.tobiTransfers.splice(Number(button.dataset.removeTobiIndex), 1);
    refreshAutoTobiPanel(true);
    refreshHanchanPreview();
    refreshAllHanchanCards();
  }));
}

function bindHanchanEditorEvents() {
  const form = document.getElementById("hanchanForm"); if (!form || !hanchanDraft) return;
  document.querySelectorAll("[data-hanchan-uma-index]").forEach((input) => input.addEventListener("input", () => { hanchanDraft.uma[Number(input.dataset.hanchanUmaIndex)] = num(input.value); refreshHanchanPreview(); refreshAllHanchanCards(); }));
  document.querySelectorAll("[data-hanchan-result-field]").forEach((input) => input.addEventListener("input", () => {
    const id = input.dataset.hanchanResultMemberId;
    hanchanDraft.results[id].finalPoints = input.value;
    hanchanDraft.results[id].pointMode = "manual";
    applySignedInputClass(input);
    applyAutoFinalPoints({ suppressAutoForMemberId: input.value === "" ? id : "" });
    applyAutoTobiTransfers();
    syncAutoPointInputs();
    syncAutoRanks();
    refreshAutoRankOutputs();
    refreshHanchanPreview();
    refreshAllHanchanCards();
    refreshPointBalance();
    refreshAutoTobiPanel(false);
  }));
  document.getElementById("enableManualRankButton")?.addEventListener("click", () => { hanchanDraft.rankMode = "manual"; const automatic = getAutoRanksFromFinalPoints(); if (automatic.complete && automatic.valid) activeMatchMembers.forEach((member) => { hanchanDraft.results[member.member_id].rank = automatic.ranks[member.member_id]; }); renderActiveSessionView(); });
  document.getElementById("enableAutoRankButton")?.addEventListener("click", () => { hanchanDraft.rankMode = "auto"; syncAutoRanks(); renderActiveSessionView(); });
  document.querySelectorAll("[data-hanchan-manual-rank-member-id]").forEach((input) => input.addEventListener("change", () => { const id = input.dataset.hanchanManualRankMemberId; hanchanDraft.results[id].rank = Number(input.value); refreshHanchanPreview(); refreshAllHanchanCards(); }));
  bindAutoTobiRecipientEvents(form);
  bindTobiTransferEvents(form);
  document.getElementById("addTobiTenButton")?.addEventListener("click", () => { hanchanDraft.tobiTransfers.push({ fromMemberId: "", toMemberId: "", points: 10 }); refreshAutoTobiPanel(true); });
  document.getElementById("addTobiFiveButton")?.addEventListener("click", () => { hanchanDraft.tobiTransfers.push({ fromMemberId: "", toMemberId: "", points: 5 }); refreshAutoTobiPanel(true); });
  document.getElementById("addYakumanButton")?.addEventListener("click", () => { hanchanDraft.yakumanRecords.push(createEmptyYakumanRecord()); renderActiveSessionView(); }); document.querySelectorAll("[data-remove-yakuman-index]").forEach((button) => button.addEventListener("click", () => { hanchanDraft.yakumanRecords.splice(Number(button.dataset.removeYakumanIndex), 1); renderActiveSessionView(); }));
  document.querySelectorAll("[data-yakuman-field]").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { const r = hanchanDraft.yakumanRecords[Number(input.dataset.yakumanIndex)], field = input.dataset.yakumanField; r[field] = input.value; if (field === "winType" && input.value === "tsumo") r.houjuuMemberId = ""; if (field === "yakumanName" || field === "winType") renderActiveSessionView(); }));
  document.querySelector("[data-hanchan-note]")?.addEventListener("input", (e) => hanchanDraft.notes = e.target.value); form.addEventListener("submit", addMatchHanchan); refreshHanchanPreview(); refreshPointBalance();
}
function syncAutoPointInputs() {
  const focused = document.activeElement;
  activeMatchMembers.forEach((m) => {
    const r = hanchanDraft.results[m.member_id];
    const input = document.querySelector(`[data-hanchan-point-input-id="${m.member_id}"]`);
    const badge = document.querySelector(`[data-hanchan-point-mode-id="${m.member_id}"]`);
    if (input && input !== focused) {
      input.value = r.finalPoints;
      applySignedInputClass(input, r.finalPoints);
    }
    if (badge) {
      badge.textContent = r.pointMode === "auto" ? "自動計算" : "手入力";
      badge.classList.toggle("auto", r.pointMode === "auto");
    }
  });
}
function refreshAutoRankOutputs() {
  const state = getDraftRankState();
  activeMatchMembers.forEach((member) => {
    const output = document.querySelector(`[data-hanchan-rank-member-id="${member.member_id}"]`);
    if (!output) return;
    output.textContent = !state.complete ? "持ち点入力後に確定" : !state.valid ? "順位を確認" : state.hasTie ? `${state.displayRanks?.[member.member_id] || state.ranks[member.member_id]}位同着（ウマ均等分配）` : `${state.ranks[member.member_id]}位（自動）`;
    output.classList.toggle("error", Boolean(state.complete && !state.valid));
  });
}
function refreshAutoTobiPanel(force = false) {
  const tobiMembers = getTobiMembersFromDraft();
  const nextSignature = tobiMembers.map((member) => member.member_id).sort().join("|");
  const host = document.getElementById("autoTobiPanelHost");
  const note = document.getElementById("autoTobiNote");
  const transferList = document.getElementById("tobiTransferList");
  const panel = document.getElementById("autoTobiPanel");
  if (!host || !note || !transferList || !panel) {
    lastAutoTobiSignature = nextSignature;
    return;
  }

  // トビ発生時もDOMを置換しない。iPhone PWAで発生していた上部へのスクロールと
  // チラつきは、host.innerHTMLによるチェックボックス領域の再生成が原因だった。
  const tobiIds = new Set(tobiMembers.map((member) => member.member_id));
  panel.classList.toggle("is-idle", !tobiIds.size);
  panel.classList.toggle("is-active", Boolean(tobiIds.size));
  note.textContent = tobiIds.size
    ? "上の選択が飛ばし点へ自動反映されます。イレギュラー時だけ手動移動を追加してください。"
    : "最終持ち点がマイナスになると、自動で飛ばし点の受取先を選べます。";

  activeMatchMembers.forEach((fromMember) => {
    const card = panel.querySelector(`[data-auto-tobi-card="${fromMember.member_id}"]`);
    if (!card) return;
    const active = tobiIds.has(fromMember.member_id);
    card.hidden = !active;
    if (!active) return;
    const recipients = hanchanDraft.tobiRecipientsByFrom?.[fromMember.member_id] || [];
    const count = recipients.length;
    card.querySelectorAll("[data-auto-tobi-from-member-id]").forEach((input) => {
      input.checked = recipients.includes(input.value);
      input.disabled = count >= 2 && !input.checked;
    });
    const status = card.querySelector(`[data-auto-tobi-status="${fromMember.member_id}"]`);
    if (status) {
      status.textContent = count === 1 ? "10を1人へ配分" : count === 2 ? "5ずつを2人へ配分" : "受取先を選択してください";
      status.classList.toggle("ready", count === 1 || count === 2);
    }
  });

  // 点数入力時は送金行を作り直さない。受取先を操作した時だけ更新する。
  if (force) {
    transferList.innerHTML = renderTobiTransferRows() || `<p class="game-section-note">飛ばし点なし</p>`;
    bindTobiTransferEvents(transferList);
  }
  lastAutoTobiSignature = nextSignature;
}

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
function getEffectiveUmaForSave(rankState) {
  const effective = hanchanDraft.uma.map(num);
  if (!rankState?.valid || hanchanDraft.rankMode === "manual") return effective;
  (rankState.tieGroups || []).forEach((group) => {
    for (let index = group.startIndex; index < group.endIndex; index += 1) {
      effective[index] = num(group.splitUma);
    }
  });
  return effective;
}
function validateYakumans() { for (const r of hanchanDraft.yakumanRecords) { const name = getYakumanDisplayName(r); if (!name || name.length > 60) return "役満名を正しく入力してください。"; if (!r.winnerMemberId) return "役満のあがった人を選択してください。"; if (r.winType === "ron" && (!r.houjuuMemberId || r.houjuuMemberId === r.winnerMemberId)) return "ロン役満の放銃者を正しく選択してください。"; } return null; }
async function addMatchHanchan(e) {
  e.preventDefault();
  const message = document.getElementById("hanchanFormMessage");
  const submit = document.getElementById("saveHanchanButton");
  const isEditing = Boolean(editingHanchanId);
  const rankState = syncAutoRanks();

  if (!rankState.valid) {
    message.textContent = hanchanDraft.rankMode === "manual" ? `手入力の順位を1位から${activeMatchMembers.length}位まで重複なく指定してください。` : "順位を自動判定できません。";
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
    p_uma: getEffectiveUmaForSave(rankState),
    p_results: activeMatchMembers.map((m) => ({
      member_id: m.member_id,
      rank: rankState.ranks[m.member_id],
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

    selectedHanchanDetailId = isEditing ? editingHanchanId : null;
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

function renderChipEditor() { return `<section class="chip-editor"><form id="chipForm"><p class="game-section-note">終了時のチップ差分を入力します。3人なら2人を入力した時点で、残り1人は合計0枚になるよう自動計算します。</p><div class="chip-input-list">${activeMatchMembers.map((m) => `<label class="chip-input-row"><span>${escapeHtml(getMemberName(m.member_id))}</span><input class="signed-number-input ${inputValueClass(chipDraft[m.member_id] ?? 0)}" type="number" step="0.5" value="${chipDraft[m.member_id] ?? 0}" data-chip-member-id="${m.member_id}"><small data-chip-mode-id="${m.member_id}">${chipAutoMemberId === m.member_id ? "枚（自動計算）" : "枚"}</small></label>`).join("")}</div><p id="chipBalanceMessage" class="game-form-message"></p><button id="saveChipButton" class="save-game-button" type="submit">終了時チップを保存</button></form></section>`; }
function applyAutoChipCount() {
  if (chipTouchedMemberIds.size !== activeMatchMembers.length - 1) return;
  const target = activeMatchMembers.find((member) => !chipTouchedMemberIds.has(member.member_id));
  if (!target) return;
  const used = activeMatchMembers.filter((member) => member.member_id !== target.member_id).reduce((sum, member) => sum + num(chipDraft[member.member_id]), 0);
  chipDraft[target.member_id] = roundOne(-used);
  chipAutoMemberId = target.member_id;
}
function syncAutoChipInput() {
  if (!chipAutoMemberId) return;
  const input = document.querySelector(`[data-chip-member-id="${chipAutoMemberId}"]`);
  const mode = document.querySelector(`[data-chip-mode-id="${chipAutoMemberId}"]`);
  if (input) { input.value = chipDraft[chipAutoMemberId]; applySignedInputClass(input, chipDraft[chipAutoMemberId]); }
  if (mode) mode.textContent = "枚（自動計算）";
}
function bindChipEditorEvents() { const form = document.getElementById("chipForm"); if (!form) return; document.querySelectorAll("[data-chip-member-id]").forEach((input) => input.addEventListener("input", () => { const id = input.dataset.chipMemberId; if (chipAutoMemberId === id) chipAutoMemberId = ""; chipTouchedMemberIds.add(id); chipDraft[id] = num(input.value); applyAutoChipCount(); applySignedInputClass(input); syncAutoChipInput(); refreshChipBalance(); })); form.addEventListener("submit", saveSessionChips); refreshChipBalance(); }
function refreshChipBalance() { const el = document.getElementById("chipBalanceMessage"); if (!el) return; const sum = roundOne(activeMatchMembers.reduce((s,m) => s + num(chipDraft[m.member_id]), 0)); const autoText = chipAutoMemberId ? ` ${getMemberName(chipAutoMemberId)}は自動計算です。` : ""; el.textContent = nearlyEqual(sum, 0) ? `チップ合計：0枚。${autoText}` : `チップ合計：${sum > 0 ? "+" : ""}${sum}枚。全員の合計が0枚になるよう調整してください。`; }
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
  if (!activeHanchans.length) return alert("半荘を1件以上登録してください。");
  if (!hasAllChips()) return alert("終了時チップを全員分入力してください。");
  if (!hasMatchingVenuePrepayments()) return alert("場代合計と先払い合計を一致させてください。");
  if (!confirm("1日の精算を確定します。\n送金が必要な場合は、未精算の借ptとして自動登録されます。\n確定後も半荘・チップ・場代は編集できます。")) return;

  const routes = getPaymentRoutes(getSessionTotals())
    .filter((route) => num(route.amount) > 0.004)
    .map((route) => ({
      debtor_member_id: route.fromMemberId,
      creditor_member_id: route.toMemberId,
      amount_pt: roundTo(num(route.amount), 2)
    }));

  let sessionClosed = false;
  try {
    markLocalRealtimeWrite();
    const { error } = await supabaseClient.rpc("close_match_session", { p_session_id: activeMatchSessionId });
    if (error) throw error;
    sessionClosed = true;

    let autoDebtRegistered = false;
    if (routes.length) {
      const { data, error: debtError } = await supabaseClient.rpc("register_session_payment_routes_as_debts", {
        p_session_id: activeMatchSessionId,
        p_routes: routes,
        p_memo: `${formatDate(activeMatchSession?.session_date || "")}の精算ルート（自動登録）`
      });
      if (debtError) throw debtError;
      autoDebtRegistered = num(data?.route_count) > 0;
      debtMessage = `${num(data?.route_count)}件の送金ルートを未精算借ptとして自動登録しました。`;
    }

    gameMessage = routes.length
      ? (autoDebtRegistered ? "精算を確定し、送金ルートを借ptへ自動登録しました。送金後は精算タブで送金済みにしてください。" : "精算を確定しました。")
      : "精算を確定しました。送金は不要です。";
    await loadMatchSessions();
  } catch (error) {
    const message = error?.message || "精算を確定できませんでした。";
    if (sessionClosed) {
      gameMessage = "精算は確定しましたが、借ptの自動登録に失敗しました。精算画面から再登録してください。";
      await loadMatchSessions();
      alert(message);
      return;
    }
    alert(message);
  }
}


async function deleteMatchHanchan(hanchanId) {
  if (!window.confirm("この半荘記録を削除しますか？\n飛ばし点と役満記録もまとめて削除されます。")) return;
  try {
    markLocalRealtimeWrite(); const { error } = await supabaseClient.rpc("delete_match_hanchan", { p_hanchan_id: hanchanId });
    if (error) throw error;
    if (selectedHanchanDetailId === hanchanId) selectedHanchanDetailId = null;
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


function buildSessionProgressTrend() {
  if (!activeHanchans.length || !activeMatchMembers.length) {
    return { legend: "", svg: `<p class="ranking-note">この対局のpt推移は、半荘を登録すると表示されます。</p>` };
  }
  const palette = ["#4f3b82", "#0d6b5b", "#bd6b22", "#b53565", "#2767a8", "#7b5e27", "#66703c", "#8c4f9d"];
  const hanchans = [...activeHanchans].sort((a, b) => num(a.sequence_no) - num(b.sequence_no));
  const running = new Map(activeMatchMembers.map((member) => [member.member_id, 0]));
  const series = activeMatchMembers.map((member, index) => ({
    memberId: member.member_id,
    displayName: getMemberName(member.member_id),
    color: palette[index % palette.length],
    values: [0]
  }));
  hanchans.forEach((hanchan) => {
    const resultMap = new Map(getHanchanResults(hanchan.id).map((result) => [result.member_id, num(result.total_points)]));
    series.forEach((line) => {
      const next = roundOne(num(running.get(line.memberId)) + num(resultMap.get(line.memberId)));
      running.set(line.memberId, next);
      line.values.push(next);
    });
  });
  const values = series.flatMap((line) => line.values);
  const width = Math.max(660, 120 + hanchans.length * 54);
  const height = 260;
  const padX = 42;
  const padY = 30;
  const usableWidth = width - padX * 2;
  const usableHeight = height - padY * 2;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const x = (index) => padX + (hanchans.length <= 0 ? usableWidth / 2 : (usableWidth * index) / hanchans.length);
  const y = (value) => padY + ((max - value) / range) * usableHeight;
  const labelInterval = Math.max(1, Math.ceil(hanchans.length / 10));
  const labels = hanchans.map((hanchan, index) => (hanchans.length <= 10 || index === 0 || index === hanchans.length - 1 || (index + 1) % labelInterval === 0)
    ? `<text x="${x(index + 1).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="trend-label">${hanchan.sequence_no}</text>`
    : "").join("");
  const lines = series.map((line) => {
    const points = line.values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
    const circles = line.values.slice(1).map((value, index) => `<circle cx="${x(index + 1).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3.3" class="all-trend-point" style="stroke:${line.color};fill:#fff;opacity:.9"></circle>`).join("");
    return `<polyline points="${points}" class="all-trend-line" style="stroke:${line.color};stroke-width:3.2;opacity:.88"></polyline>${circles}`;
  }).join("");
  const legend = series.map((line) => `<span class="trend-legend-item"><i style="background:${line.color}"></i>${escapeHtml(line.displayName)}</span>`).join("");
  const scaleTop = `<text x="${padX}" y="${padY - 7}" class="trend-scale">${formatNumber(max, 1)}</text>`;
  const scaleBottom = `<text x="${padX}" y="${height - padY + 15}" class="trend-scale">${formatNumber(min, 1)}</text>`;
  return {
    legend,
    svg: `<svg class="trend-svg session-progress-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="この対局の半荘別pt推移"><line x1="${padX}" x2="${width - padX}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="trend-zero"></line>${lines}${labels}${scaleTop}${scaleBottom}<text x="${width - padX}" y="${height - 8}" text-anchor="end" class="trend-scale">半荘</text></svg>`
  };
}


function buildSelectedHanchanDetail(hanchan, session) {
  const results = getHanchanResults(hanchan.id);
  const transfers = getHanchanTransfers(hanchan.id);
  const yakumans = getHanchanYakumans(hanchan.id);
  const resultRows = results.map((result) => {
    const samePointResults = results.filter((item) => Number(item.final_points) === Number(result.final_points));
    const rankLabel = samePointResults.length > 1
      ? `${Math.min(...samePointResults.map((item) => Number(item.rank)))}位同着`
      : `${result.rank}位`;
    return `<div class="history-result-row">
      <span>${rankLabel} ${escapeHtml(getMemberName(result.member_id))}</span>
      <strong>${formatScoreMarkup(result.total_points)}</strong>
    </div>`;
  }).join("");
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
  return `<article class="hanchan-history-card hanchan-detail-card">
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
  </article>`;
}

function buildSessionScoreSheet() {
  const members = [...activeMatchMembers].map((member) => ({
    memberId: member.member_id,
    displayName: getMemberName(member.member_id)
  }));
  if (!members.length) {
    return `<p class="ranking-note">参加者を設定するとスコア表が表示されます。</p>`;
  }
  const hanchans = [...activeHanchans].sort((a, b) => num(a.sequence_no) - num(b.sequence_no));
  if (!hanchans.length) {
    return `<p class="ranking-note">半荘を登録すると、この対局専用のスコア表に行が追加されます。</p>`;
  }
  const totalByMember = new Map(members.map((member) => [member.memberId, 0]));
  const rowHtml = hanchans.map((hanchan) => {
    const results = getHanchanResults(hanchan.id);
    const resultMap = new Map(results.map((result) => [result.member_id, result]));
    const cells = members.map((member) => {
      const result = resultMap.get(member.memberId);
      if (!result) {
        return `<td class="score-sheet-cell score-sheet-cell-empty">—</td>`;
      }
      totalByMember.set(member.memberId, roundOne(num(totalByMember.get(member.memberId)) + num(result.total_points)));
      const samePointResults = results.filter((item) => Number(item.final_points) === Number(result.final_points));
      const rankLabel = samePointResults.length > 1
        ? `${Math.min(...samePointResults.map((item) => Number(item.rank)))}位同着`
        : `${result.rank}位`;
      return `<td class="score-sheet-cell">
        <span class="score-sheet-rank">${escapeHtml(rankLabel)}</span>
        <strong>${formatScoreMarkup(result.total_points)}</strong>
      </td>`;
    }).join("");
    const selectedClass = hanchan.id === selectedHanchanDetailId ? " selected" : "";
    return `<tr class="score-sheet-hanchan-row${selectedClass}">
      <th scope="row"><button type="button" class="score-sheet-round-button" data-select-hanchan-id="${hanchan.id}">第${hanchan.sequence_no}</button></th>
      ${cells}
    </tr>`;
  }).join("");
  const totalCells = members.map((member) => `<td class="score-sheet-total-cell"><strong>${formatScoreMarkup(totalByMember.get(member.memberId))}</strong></td>`).join("");
  const chipCells = members.map((member) => {
    const chipCount = getChipCount(member.memberId);
    const chipPoint = roundOne(chipCount * num(activeMatchSession?.chip_value));
    return `<td class="score-sheet-total-cell"><strong>${formatChipMarkup(chipCount)}</strong><small>${formatScoreMarkup(chipPoint)}</small></td>`;
  }).join("");
  return `<div class="score-sheet-scroll" aria-label="半荘別スコア表">
    <table class="session-score-sheet" style="--score-sheet-members: ${members.length};">
      <thead>
        <tr>
          <th scope="col">半荘</th>
          ${members.map((member) => `<th scope="col">${escapeHtml(member.displayName)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rowHtml}
      </tbody>
      <tfoot>
        <tr class="score-sheet-total-row"><th scope="row">Total</th>${totalCells}</tr>
        <tr class="score-sheet-chip-row"><th scope="row">Chip</th>${chipCells}</tr>
      </tfoot>
    </table>
  </div>`;
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
function getDebtPairSummary() {
  const pairs = new Map();
  getOpenDebtRecords().forEach((record) => {
    const key = `${record.debtor_member_id}:${record.creditor_member_id}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        debtorMemberId: record.debtor_member_id,
        creditorMemberId: record.creditor_member_id,
        amount: 0,
        count: 0,
        sourceSessionCount: 0,
        manualCount: 0
      });
    }
    const pair = pairs.get(key);
    pair.amount = roundTo(pair.amount + num(record.remaining_amount_pt), 2);
    pair.count += 1;
    if (record.record_kind === "settlement") pair.sourceSessionCount += 1;
    if (record.record_kind === "manual") pair.manualCount += 1;
  });
  return [...pairs.values()].filter((pair) => pair.amount > 0.004).sort((a, b) => b.amount - a.amount || getMemberName(a.debtorMemberId).localeCompare(getMemberName(b.debtorMemberId), "ja"));
}
function getOptimizedDebtRoutesFromOpen() {
  const debtors = getDebtMemberSummary()
    .filter((item) => item.net < -0.004)
    .map((item) => ({ memberId: item.member.id, displayName: item.member.display_name, remaining: roundTo(-item.net, 2) }))
    .sort((a, b) => b.remaining - a.remaining || a.displayName.localeCompare(b.displayName, "ja"));
  const creditors = getDebtMemberSummary()
    .filter((item) => item.net > 0.004)
    .map((item) => ({ memberId: item.member.id, displayName: item.member.display_name, remaining: roundTo(item.net, 2) }))
    .sort((a, b) => b.remaining - a.remaining || a.displayName.localeCompare(b.displayName, "ja"));
  const routes = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = roundTo(Math.min(debtors[d].remaining, creditors[c].remaining), 2);
    if (amount > 0.004) {
      routes.push({
        fromMemberId: debtors[d].memberId,
        toMemberId: creditors[c].memberId,
        from: debtors[d].displayName,
        to: creditors[c].displayName,
        amount
      });
    }
    debtors[d].remaining = roundTo(debtors[d].remaining - amount, 2);
    creditors[c].remaining = roundTo(creditors[c].remaining - amount, 2);
    if (debtors[d].remaining < 0.004) d += 1;
    if (creditors[c].remaining < 0.004) c += 1;
  }
  return routes;
}
function shouldShowDebtConsolidationButton(openRecords, pairSummary, optimizedRoutes) {
  if (!openRecords.length || !optimizedRoutes.length) return false;
  if (openRecords.length > pairSummary.length) return true;
  if (pairSummary.length !== optimizedRoutes.length) return true;
  const pairKey = (from, to) => `${from}:${to}`;
  const pairs = new Map(pairSummary.map((pair) => [pairKey(pair.debtorMemberId, pair.creditorMemberId), roundTo(pair.amount, 2)]));
  return optimizedRoutes.some((route) => !nearlyEqual(pairs.get(pairKey(route.fromMemberId, route.toMemberId)), route.amount));
}
function renderDebtConsolidationSection(openRecords, memberSummary, pairSummary, optimizedRoutes) {
  const netRows = memberSummary.length ? memberSummary
    .slice()
    .sort((a, b) => b.net - a.net || a.member.display_name.localeCompare(b.member.display_name, "ja"))
    .map((item) => `<div class="debt-net-row"><span>${escapeHtml(item.member.display_name)}</span><small>支払 ${formatPtPlain(item.outgoing)} ／ 受取 ${formatPtPlain(item.incoming)}</small><strong class="signed-value ${signedClass(item.net)}">差額 ${formatPt(item.net)}</strong></div>`)
    .join("") : `<p class="game-section-note">メンバーがいません。</p>`;
  const pairRows = pairSummary.length ? pairSummary.map((pair) => `<div class="debt-route-aggregate-row"><span>${escapeHtml(getMemberName(pair.debtorMemberId))} <b>→</b> ${escapeHtml(getMemberName(pair.creditorMemberId))}</span><strong>${formatPtPlain(pair.amount)}</strong><small>${pair.count}件を合算</small></div>`).join("") : `<p class="game-section-note">未精算の借ptはありません。</p>`;
  const optimizedRows = optimizedRoutes.length ? optimizedRoutes.map((route) => `<div class="debt-optimized-route-row"><span>${escapeHtml(route.from)} <b>→</b> ${escapeHtml(route.to)}</span><strong>${formatPtPlain(route.amount)}</strong></div>`).join("") : `<p class="game-section-note">最短ルートで送金する必要はありません。</p>`;
  const showButton = shouldShowDebtConsolidationButton(openRecords, pairSummary, optimizedRoutes);
  return `<section class="game-section debt-consolidation-section">
    <div class="game-section-heading">
      <div><p class="game-section-title">未精算借ptのまとめ</p><small class="all-trend-note">現在残っている借ptを合算し、最短送金ルートを計算します。</small></div>
      ${showButton ? `<button id="consolidateOpenDebtButton" class="primary-button debt-consolidate-button" type="button">最短ルートにまとめ直す</button>` : ""}
    </div>
    <div class="debt-consolidation-grid">
      <article class="debt-consolidation-card"><p>メンバー別差額</p><div class="debt-net-list">${netRows}</div></article>
      <article class="debt-consolidation-card"><p>同じ相手同士で合算</p><div class="debt-route-aggregate-list">${pairRows}</div></article>
      <article class="debt-consolidation-card optimized"><p>最短精算ルート</p><div class="debt-optimized-route-list">${optimizedRows}</div></article>
    </div>
    <p class="game-section-note">「まとめ直す」を押すと、現在の未精算借ptを取消し、上の最短ルートを新しい未精算借ptとして作り直します。送金済み扱いにはしません。</p>
  </section>`;
}
async function consolidateOpenDebtsToOptimizedRoutes() {
  const openRecords = getOpenDebtRecords();
  const pairSummary = getDebtPairSummary();
  const optimizedRoutes = getOptimizedDebtRoutesFromOpen();
  if (!openRecords.length || !optimizedRoutes.length) return;
  if (!shouldShowDebtConsolidationButton(openRecords, pairSummary, optimizedRoutes)) {
    debtMessage = "すでに最短ルートに近い形でまとまっています。";
    renderDebtPage();
    return;
  }
  const routeText = optimizedRoutes.map((route) => `・${route.from} → ${route.to}：${formatPtPlain(route.amount)}`).join("\n");
  if (!window.confirm(`現在の未精算借pt ${openRecords.length}件を取消し、以下の最短ルート ${optimizedRoutes.length}件にまとめ直します。\n\n${routeText}\n\n送金済みにはせず、未精算借ptとして作り直します。実行しますか？`)) return;
  const button = document.getElementById("consolidateOpenDebtButton");
  if (button) {
    button.disabled = true;
    button.textContent = "まとめ直し中...";
  }
  try {
    markLocalRealtimeWrite();
    for (const record of openRecords) {
      const { error } = await supabaseClient.rpc("cancel_debt_record", {
        p_debt_id: record.id,
        p_memo: "最短ルートへまとめ直し"
      });
      if (error) throw error;
    }
    for (const route of optimizedRoutes) {
      const { error } = await supabaseClient.rpc("create_debt_record", {
        p_group_id: activeGroupId,
        p_debtor_member_id: route.fromMemberId,
        p_creditor_member_id: route.toMemberId,
        p_amount_pt: route.amount,
        p_source_session_id: null,
        p_memo: "未精算借ptを最短ルートへまとめ直し",
        p_due_date: null
      });
      if (error) throw error;
    }
    debtOpenPaymentId = null;
    debtOpenRerouteId = null;
    debtViewMode = "open";
    debtMessage = `${openRecords.length}件の未精算借ptを、最短ルート${optimizedRoutes.length}件にまとめ直しました。`;
    await loadDebtData();
  } catch (error) {
    debtMessage = error.message || "借ptをまとめ直せませんでした。";
    await loadDebtData();
  } finally {
    if (button) button.disabled = false;
  }
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
    <div class="debt-form-actions"><button class="primary-button" type="submit">送金済みにする</button><button class="secondary-button" type="button" data-close-debt-payment="${record.id}">閉じる</button></div>
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
    ${open ? `<div class="debt-record-actions"><button class="secondary-button" type="button" data-open-debt-payment="${record.id}">送金済みにする</button><button class="secondary-button" type="button" data-open-debt-reroute="${record.id}">横流し</button><button class="danger-outline-button" type="button" data-cancel-debt="${record.id}">取消</button></div>` : ""}
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
  const debtPairSummary = getDebtPairSummary();
  const optimizedDebtRoutes = getOptimizedDebtRoutesFromOpen();
  const debtConsolidationSection = renderDebtConsolidationSection(openRecords, memberSummary, debtPairSummary, optimizedDebtRoutes);
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
    ${debtConsolidationSection}
    <section class="game-section"><p class="game-section-title">借ptを手動で追加</p>${createForm}</section>
    <section class="game-section"><div class="game-section-heading"><p class="game-section-title">借pt一覧</p><div class="debt-view-tabs"><button type="button" class="ranking-filter-button ${debtViewMode === "open" ? "active" : ""}" data-debt-view="open">未精算（${openRecords.length}）</button><button type="button" class="ranking-filter-button ${debtViewMode === "history" ? "active" : ""}" data-debt-view="history">履歴（${historyRecords.length}）</button></div></div><div class="debt-record-list">${displayed.length ? displayed.map(renderDebtRecord).join("") : `<p class="game-section-note">${debtViewMode === "open" ? "未精算の借ptはありません。" : "履歴はまだありません。"}</p>`}</div></section>
  </section>`;
  bindDebtPageEvents();
}
function bindDebtPageEvents() {
  document.getElementById("consolidateOpenDebtButton")?.addEventListener("click", () => { void consolidateOpenDebtsToOptimizedRoutes(); });
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
      debtMessage = `${getMemberName(record.debtor_member_id)} → ${getMemberName(record.creditor_member_id)} の送金済みにするしました。`;
      debtOpenPaymentId = null;
      await loadDebtData();
    } catch (error) { message.textContent = error.message || "送金済みにするできませんでした。"; }
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
    debt_paid: "借ptの送金済みにする",
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
    mark_debt_payment: "借ptの送金済みにするしました。",
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
    box.innerHTML = `<div class="settlement-debt-batch-heading"><div><span class="settlement-debt-batch-badge">借pt登録済み</span><strong>送金ルートは借ptへ自動登録済みです</strong></div><span>${escapeHtml(formatBatchRegisteredAt(activeSettlementDebtBatch.created_at))}</span></div>
      <p>${activeSettlementDebtBatch.route_count}件・合計 ${formatPtPlain(activeSettlementDebtBatch.total_amount_pt)} を未精算借ptとして保存しています。送金が終わったら精算タブで「送金済みにする」を実行してください。後から対局結果を編集しても、登録済みの借ptは自動変更されません。</p>
      ${activeSettlementDebtBatch.memo ? `<small>メモ：${escapeHtml(activeSettlementDebtBatch.memo)}</small>` : ""}`;
  } else if (routes.length) {
    const total = roundTo(routes.reduce((sum, route) => sum + num(route.amount_pt), 0), 2);
    box.innerHTML = `<div class="settlement-debt-batch-heading"><div><span class="settlement-debt-batch-badge pending">未登録</span><strong>送金ルートを借ptへ登録</strong></div><span>${routes.length}件</span></div>
      <p>この対局は旧記録のため、送金ルートが未登録です。未精算借ptとして登録すると、精算タブで送金済み・横流しを管理できます。</p>
      <button id="openSettlementDebtBatchButton" class="primary-button settlement-debt-batch-button" type="button">送金ルートを借ptへ登録</button>`;
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
  document.body.insertAdjacentHTML("beforeend", `<div class="settlement-debt-batch-modal-overlay"><section class="debt-modal settlement-debt-batch-modal" role="dialog" aria-modal="true" aria-labelledby="settlementDebtBatchTitle"><button type="button" class="debt-modal-close" aria-label="閉じる">×</button><p class="eyebrow">BATCH REGISTER</p><h2 id="settlementDebtBatchTitle">送金ルートを借ptへ登録</h2><p>以下の送金ルートを、現在の金額のまま未精算借ptとして保存します。登録後に対局結果や場代を編集しても、この借ptは自動変更されません。</p><div class="settlement-debt-batch-route-list">${routes.map((route) => `<div><span>${escapeHtml(route.from)} <b>→</b> ${escapeHtml(route.to)}</span><strong>${formatPtPlain(route.amount_pt)}</strong></div>`).join("")}</div><div class="settlement-debt-batch-total"><span>登録合計</span><strong>${formatPtPlain(total)}</strong></div><form id="settlementDebtBatchForm" class="debt-create-form"><label>メモ（任意）<input name="memo" type="text" maxlength="300" value="${escapeHtml(`${formatDate(activeMatchSession.session_date)}の精算ルート`)}"></label><div class="debt-form-actions"><button class="primary-button" type="submit">${routes.length}件を借ptへ登録</button><button class="secondary-button" type="button" id="cancelSettlementDebtBatchButton">閉じる</button></div><p class="debt-form-message"></p></form></section></div>`);

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
      summary: `${routeCount}件の送金ルートを借ptへ登録しました。`,
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


/* v29: shareable daily result card */
function closeResultShareCard() {
  document.querySelector(".result-share-modal-overlay")?.remove();
}

function shareCardSignedPt(value) {
  const amount = num(value);
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${Math.abs(amount).toLocaleString("ja-JP", { maximumFractionDigits: 2 })} pt`;
}

function shareCardSignedScore(value) {
  const amount = num(value);
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${Math.abs(amount).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}`;
}

function shareCardChipText(value) {
  const amount = num(value);
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${Math.abs(amount).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}枚`;
}

function shareCardValueColor(value) {
  if (num(value) > 0.004) return "#16834b";
  if (num(value) < -0.004) return "#c73e42";
  return "#4d5a54";
}

function shareCardRoundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function shareCardEllipsis(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function getShareCardYakumanLines() {
  return activeYakumanRecords
    .map((record) => `${getMemberName(record.winner_member_id)}：${record.yakuman_name}${record.win_type === "ron" ? "（ロン）" : "（ツモ）"}`)
    .slice(0, 5);
}

function createResultShareCanvas({ session, totals, routes, venueReady }) {
  const ranked = [...totals].sort((a, b) => b.gameSettlementPt - a.gameSettlementPt || a.displayName.localeCompare(b.displayName, "ja"));
  const yakumanLines = getShareCardYakumanLines();
  const routeLines = venueReady && routes.length
    ? routes.slice(0, 5).map((route) => `${route.from} → ${route.to}　${formatPtPlain(route.amount)}`)
    : ["送金なし"];
  const width = 1080;
  const playerBlockHeight = 136;
  const yakumanBlockHeight = yakumanLines.length ? 74 + yakumanLines.length * 44 : 0;
  const routeBlockHeight = 74 + routeLines.length * 44;
  const height = Math.max(1240, 440 + ranked.length * playerBlockHeight + yakumanBlockHeight + routeBlockHeight + 160);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0c392c");
  bg.addColorStop(.55, "#155541");
  bg.addColorStop(1, "#0b2f25");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = .13;
  ctx.strokeStyle = "#ecf6e8";
  ctx.lineWidth = 2;
  for (let i = -height; i < width + height; i += 58) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#f5f1e5";
  ctx.font = "800 28px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillText("森研麻雀倶楽部", 72, 88);
  ctx.font = "700 22px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillStyle = "#cee4d6";
  ctx.fillText(shareCardEllipsis(ctx, getActiveGroup()?.name || "麻雀会", 430), 72, 124);

  ctx.textAlign = "right";
  ctx.fillStyle = "#f5f1e5";
  ctx.font = "900 42px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillText(formatDate(session.session_date), width - 72, 88);
  ctx.font = "700 22px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillStyle = "#cee4d6";
  ctx.fillText(`${getModeLabel(session.game_mode)} ／ ${session.rate_label}`, width - 72, 124);
  ctx.textAlign = "left";

  shareCardRoundedRect(ctx, 56, 166, width - 112, 178, 24, "#f7f4eb");
  ctx.fillStyle = "#245342";
  ctx.font = "800 23px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillText("ゲームpt（場代を除く）", 88, 218);
  ctx.fillStyle = "#163c2f";
  ctx.font = "900 28px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillText(`収支1 = ${num(session.rate_multiplier).toLocaleString("ja-JP", { maximumFractionDigits: 2 })} pt`, 88, 260);
  ctx.textAlign = "right";
  ctx.font = "800 22px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillStyle = "#627068";
  ctx.fillText(`半荘 ${activeHanchans.length}回`, width - 88, 218);
  ctx.fillText(`チップ ${num(session.chip_value).toLocaleString("ja-JP", { maximumFractionDigits: 2 })} / 枚`, width - 88, 260);
  ctx.textAlign = "left";

  let y = 382;
  ctx.fillStyle = "#eaf6ef";
  ctx.font = "900 24px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillText("TODAY'S RESULT", 72, y);
  y += 28;

  ranked.forEach((item, index) => {
    const cardY = y + index * playerBlockHeight;
    shareCardRoundedRect(ctx, 56, cardY, width - 112, 116, 20, "#ffffff");
    shareCardRoundedRect(ctx, 78, cardY + 20, 66, 66, 18, index === 0 ? "#caa63d" : index === 1 ? "#a9b2b8" : index === 2 ? "#be855c" : "#e8eee9");
    ctx.fillStyle = index < 3 ? "#fff" : "#285243";
    ctx.textAlign = "center";
    ctx.font = "900 28px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    ctx.fillText(String(index + 1), 111, cardY + 63);
    ctx.textAlign = "left";

    ctx.fillStyle = "#1c3028";
    ctx.font = "900 31px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    ctx.fillText(shareCardEllipsis(ctx, item.displayName, 360), 170, cardY + 51);
    ctx.fillStyle = "#748077";
    ctx.font = "700 20px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    ctx.fillText(`素点 ${shareCardSignedScore(item.hanchanTotal)} ／ チップ ${shareCardChipText(item.chipCount)}`, 170, cardY + 82);

    ctx.textAlign = "right";
    ctx.fillStyle = shareCardValueColor(item.gameSettlementPt);
    ctx.font = "900 36px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    ctx.fillText(shareCardSignedPt(item.gameSettlementPt), width - 84, cardY + 62);
    ctx.font = "700 18px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    ctx.fillStyle = "#748077";
    ctx.fillText(`ゲーム収支 ${shareCardSignedScore(item.totalPoints)}`, width - 84, cardY + 88);
    ctx.textAlign = "left";
  });

  y += ranked.length * playerBlockHeight + 24;
  if (yakumanLines.length) {
    const blockHeight = 60 + yakumanLines.length * 39;
    shareCardRoundedRect(ctx, 56, y, width - 112, blockHeight, 20, "#fff5e8");
    ctx.fillStyle = "#9a5317";
    ctx.font = "900 24px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    ctx.fillText("YAKUMAN", 84, y + 38);
    ctx.fillStyle = "#63370e";
    ctx.font = "700 21px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    yakumanLines.forEach((line, index) => ctx.fillText(shareCardEllipsis(ctx, line, width - 170), 84, y + 76 + index * 38));
    y += blockHeight + 22;
  }

  shareCardRoundedRect(ctx, 56, y, width - 112, routeBlockHeight, 20, "#edf7f1");
  ctx.fillStyle = "#215946";
  ctx.font = "900 24px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.fillText("PAYMENT ROUTES", 84, y + 38);
  ctx.fillStyle = "#2b3d34";
  ctx.font = "700 21px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  routeLines.forEach((line, index) => ctx.fillText(shareCardEllipsis(ctx, line, width - 170), 84, y + 76 + index * 38));

  ctx.fillStyle = "#cfe3d7";
  ctx.font = "700 18px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("記録・集計：森研麻雀倶楽部", width / 2, height - 52);
  ctx.textAlign = "left";
  return canvas;
}

function downloadResultShareCard(canvas) {
  const dateText = String(activeMatchSession?.session_date || todayInJapan()).replaceAll("-", "");
  const link = document.createElement("a");
  link.download = `moriken-mahjong-result-${dateText}.png`;
  link.href = canvas.toDataURL("image/png");
  document.body.append(link);
  link.click();
  link.remove();
}

function openResultShareCard(data) {
  closeResultShareCard();
  const canvas = createResultShareCanvas(data);
  const canShareFile = Boolean(navigator.share && window.File && (typeof navigator.canShare !== "function" || navigator.canShare({ files: [new File(["x"], "moriken-mahjong.png", { type: "image/png" })] })));
  document.body.insertAdjacentHTML("beforeend", `
    <div class="result-share-modal-overlay">
      <section class="result-share-modal" role="dialog" aria-modal="true" aria-labelledby="resultShareCardTitle">
        <button class="result-share-close" type="button" aria-label="閉じる">×</button>
        <p class="eyebrow">RESULT CARD</p>
        <h2 id="resultShareCardTitle">結果共有カード</h2>
        <p>場代を除いたゲームptを中心に、チップ・役満・送金ルートをまとめた画像です。</p>
        <div class="result-share-canvas-wrap"></div>
        <div class="result-share-actions">
          <button id="downloadResultShareCardButton" class="primary-button" type="button">PNGを保存</button>
          ${canShareFile ? `<button id="nativeShareResultCardButton" class="secondary-button" type="button">共有</button>` : ""}
          <button id="closeResultShareCardButton" class="secondary-button" type="button">閉じる</button>
        </div>
      </section>
    </div>
  `);
  const overlay = document.querySelector(".result-share-modal-overlay");
  overlay.querySelector(".result-share-canvas-wrap")?.append(canvas);
  const close = closeResultShareCard;
  overlay.querySelector(".result-share-close")?.addEventListener("click", close);
  overlay.querySelector("#closeResultShareCardButton")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.querySelector("#downloadResultShareCardButton")?.addEventListener("click", () => downloadResultShareCard(canvas));
  overlay.querySelector("#nativeShareResultCardButton")?.addEventListener("click", async () => {
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("画像を作成できませんでした。");
      const dateText = String(data.session.session_date || todayInJapan()).replaceAll("-", "");
      const file = new File([blob], `moriken-mahjong-result-${dateText}.png`, { type: "image/png" });
      await navigator.share({ title: "森研麻雀倶楽部 結果カード", text: `${formatDate(data.session.session_date)}の麻雀会`, files: [file] });
    } catch (error) {
      if (error?.name !== "AbortError") alert(error?.message || "共有できませんでした。PNGを保存して共有してください。");
    }
  });
}

/* v30: venue management and venue analytics */
let matchVenues = [];
let matchVenuesGroupId = null;
let venueRealtimeChannel = null;
let venueRealtimeGroupId = null;
let venueAnalyticsSelectedId = "";

function resetVenueState() {
  matchVenues = [];
  matchVenuesGroupId = null;
  venueAnalyticsSelectedId = "";
}

async function loadMatchVenues() {
  if (!supabaseClient || !currentSession || !activeGroupId) {
    resetVenueState();
    return [];
  }
  if (matchVenuesGroupId !== activeGroupId) {
    matchVenues = [];
    matchVenuesGroupId = activeGroupId;
    venueAnalyticsSelectedId = "";
  }
  const { data, error } = await supabaseClient
    .from("match_venues")
    .select("id, group_id, name, note, is_archived, created_at, updated_at")
    .eq("group_id", activeGroupId)
    .order("is_archived", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  matchVenues = data || [];
  return matchVenues;
}

function getMatchVenue(venueId) {
  return matchVenues.find((venue) => venue.id === venueId) || null;
}

function getMatchVenueName(venueId, fallback = "会場未設定") {
  if (!venueId) return fallback;
  return getMatchVenue(venueId)?.name || "削除済み会場";
}

function getSelectableVenues(currentVenueId = "") {
  return matchVenues.filter((venue) => !venue.is_archived || venue.id === currentVenueId);
}

async function fetchVenueSessionMeta(sessionIds = []) {
  if (!supabaseClient || !activeGroupId || !sessionIds.length) return [];
  const { data, error } = await supabaseClient
    .from("match_sessions")
    .select("id, venue_id, venue_fee_total")
    .eq("group_id", activeGroupId)
    .in("id", sessionIds);
  if (error) throw error;
  return data || [];
}

function mergeVenueSessionMeta(rows, metaRows) {
  const byId = new Map((metaRows || []).map((row) => [row.id, row]));
  (rows || []).forEach((row) => {
    const meta = byId.get(row.id);
    if (!meta) return;
    row.venue_id = meta.venue_id || null;
    if (meta.venue_fee_total !== undefined && meta.venue_fee_total !== null) row.venue_fee_total = meta.venue_fee_total;
  });
}

async function hydrateVenueSessionRows(rows) {
  if (!rows?.length) return;
  const metaRows = await fetchVenueSessionMeta(rows.map((row) => row.id));
  mergeVenueSessionMeta(rows, metaRows);
}

async function recordVenueActivity(summary, entityType = "group", entityId = activeGroupId, details = {}) {
  try {
    await recordActivity({
      groupId: activeGroupId,
      eventType: "group_edited",
      entityType,
      entityId,
      summary,
      details: { before: null, after: details, source: "venue" }
    });
  } catch (error) {
    console.warn("会場操作の履歴を記録できませんでした。", error);
  }
}

async function promptCreateMatchVenue(defaultName = "") {
  const name = window.prompt("会場名を入力してください。", defaultName);
  if (name === null) return null;
  if (!String(name).trim()) {
    alert("会場名を入力してください。");
    return null;
  }
  const note = window.prompt("補足メモ（任意）を入力してください。", "");
  if (note === null) return null;
  const { data, error } = await supabaseClient.rpc("create_match_venue", {
    p_group_id: activeGroupId,
    p_name: String(name).trim(),
    p_note: String(note).trim()
  });
  if (error) throw error;
  await recordVenueActivity(`会場「${String(name).trim()}」を追加しました。`, "group", activeGroupId, { venue_name: String(name).trim() });
  await loadMatchVenues();
  return data;
}

function buildVenueSelectOptions(selectedId = "", includeBlank = true) {
  const options = [];
  if (includeBlank) options.push(`<option value="">会場を設定しない</option>`);
  getSelectableVenues(selectedId).forEach((venue) => {
    const archived = venue.is_archived ? "（アーカイブ）" : "";
    options.push(`<option value="${venue.id}" ${venue.id === selectedId ? "selected" : ""}>${escapeHtml(venue.name)}${archived}</option>`);
  });
  return options.join("");
}

function injectVenueCreateSection() {
  const form = document.getElementById("createSessionForm");
  if (!form || form.querySelector(".session-venue-create-section")) return;
  const selectedId = sessionDraft.venueId || "";
  const section = document.createElement("section");
  section.className = "game-section session-venue-create-section";
  section.innerHTML = `
    <div class="game-section-heading"><div><p class="game-section-title">会場</p><p class="game-section-note">会場を選ぶと、あとから会場別の成績・場代を集計できます。未設定のままでも記録できます。</p></div></div>
    <div class="session-venue-picker">
      <select id="newSessionVenueSelect">${buildVenueSelectOptions(selectedId)}</select>
      <button id="createVenueFromSessionButton" class="secondary-button" type="button">＋ 会場を追加</button>
    </div>
  `;
  const notesSection = Array.from(form.querySelectorAll(".game-section")).find((node) => node.querySelector("textarea[data-session-field='notes']"));
  if (notesSection) form.insertBefore(section, notesSection);
  else form.append(section);

  section.querySelector("#newSessionVenueSelect")?.addEventListener("change", (event) => {
    sessionDraft.venueId = event.target.value || "";
  });
  section.querySelector("#createVenueFromSessionButton")?.addEventListener("click", async () => {
    try {
      const venueId = await promptCreateMatchVenue();
      if (!venueId) return;
      sessionDraft.venueId = venueId;
      renderCreateSessionView();
    } catch (error) {
      alert(error.message || "会場を追加できませんでした。");
    }
  });

  const existingSubmitCapture = form.dataset.venueSubmitCaptureBound;
  if (!existingSubmitCapture) {
    form.dataset.venueSubmitCaptureBound = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const beforeSessionId = activeMatchSessionId;
      await createMatchSessionV29(event);
      const createdSessionId = activeMatchSessionId;
      const selectedVenueId = sessionDraft.venueId || "";
      if (!createdSessionId || createdSessionId === beforeSessionId || !selectedVenueId) return;
      try {
        markLocalRealtimeWrite();
        const { error } = await supabaseClient.rpc("set_match_session_venue", {
          p_session_id: createdSessionId,
          p_venue_id: selectedVenueId
        });
        if (error) throw error;
        await recordVenueActivity(`新しい日次記録に会場「${getMatchVenueName(selectedVenueId)}」を設定しました。`, "session", createdSessionId, { venue_id: selectedVenueId });
        await loadMatchSessions();
      } catch (error) {
        alert(`日次記録は作成しましたが、会場を設定できませんでした。\n${error.message || ""}`);
      }
    }, true);
  }
}

function injectActiveSessionVenueSection() {
  const page = getPageWorkspace();
  const session = activeMatchSession;
  if (!page || !session || page.querySelector(".session-venue-summary-section")) return;
  const currentVenueId = session.venue_id || "";
  const currentVenue = getMatchVenue(currentVenueId);
  const costSection = Array.from(page.querySelectorAll(".game-section")).find((node) => node.querySelector(".game-section-title")?.textContent?.trim() === "場代精算");
  const section = document.createElement("section");
  section.className = "game-section session-venue-summary-section";
  section.innerHTML = `
    <div class="game-section-heading"><div><p class="game-section-title">会場</p><p class="game-section-note">会場を設定すると、会場別の対局数・場代・成績を集計できます。</p></div><span class="venue-current-badge ${currentVenueId ? "set" : ""}">${escapeHtml(getMatchVenueName(currentVenueId))}</span></div>
    <div class="session-venue-picker">
      <select id="activeSessionVenueSelect">${buildVenueSelectOptions(currentVenueId)}</select>
      <button id="saveActiveSessionVenueButton" class="secondary-button" type="button">会場を保存</button>
      <button id="createVenueFromActiveSessionButton" class="icon-text-button" type="button">＋ 会場追加</button>
    </div>
    ${currentVenue?.note ? `<p class="venue-note-display">${escapeHtml(currentVenue.note)}</p>` : ""}
  `;
  if (costSection) costSection.insertAdjacentElement("beforebegin", section);
  else page.querySelector(".game-card")?.append(section);

  section.querySelector("#saveActiveSessionVenueButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const nextVenueId = section.querySelector("#activeSessionVenueSelect")?.value || "";
    if ((session.venue_id || "") === nextVenueId) return;
    button.disabled = true;
    button.textContent = "保存中...";
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("set_match_session_venue", {
        p_session_id: session.id,
        p_venue_id: nextVenueId || null
      });
      if (error) throw error;
      session.venue_id = nextVenueId || null;
      const row = sessionList.find((item) => item.id === session.id);
      if (row) row.venue_id = session.venue_id;
      await recordVenueActivity(
        nextVenueId ? `会場を「${getMatchVenueName(nextVenueId)}」に変更しました。` : "会場設定を解除しました。",
        "session",
        session.id,
        { venue_id: nextVenueId || null }
      );
      gameMessage = "会場を保存しました。";
      renderActiveSessionView();
    } catch (error) {
      alert(error.message || "会場を保存できませんでした。");
      button.disabled = false;
      button.textContent = "会場を保存";
    }
  });
  section.querySelector("#createVenueFromActiveSessionButton")?.addEventListener("click", async () => {
    try {
      const venueId = await promptCreateMatchVenue();
      if (!venueId) return;
      session.venue_id = venueId;
      renderActiveSessionView();
    } catch (error) {
      alert(error.message || "会場を追加できませんでした。");
    }
  });
}

function venueSettingsRowHtml(venue) {
  return `<article class="venue-settings-row ${venue.is_archived ? "archived" : ""}">
    <div class="venue-settings-main"><strong>${escapeHtml(venue.name)}</strong>${venue.is_archived ? `<span class="venue-archive-label">アーカイブ</span>` : ""}${venue.note ? `<p>${escapeHtml(venue.note)}</p>` : `<p class="venue-empty-note">メモなし</p>`}</div>
    <div class="venue-settings-actions"><button class="secondary-button" type="button" data-edit-venue-id="${venue.id}">編集</button><button class="${venue.is_archived ? "secondary-button" : "danger-outline-button"}" type="button" data-toggle-venue-archive-id="${venue.id}" data-venue-archive-state="${venue.is_archived ? "restore" : "archive"}">${venue.is_archived ? "復帰" : "アーカイブ"}</button></div>
  </article>`;
}

function injectVenueSettingsSection() {
  const page = getPageWorkspace();
  const card = page?.querySelector(".settings-card");
  if (!card || card.querySelector(".venue-settings-section")) return;
  const active = matchVenues.filter((venue) => !venue.is_archived);
  const archived = matchVenues.filter((venue) => venue.is_archived);
  const section = document.createElement("section");
  section.className = "settings-section venue-settings-section";
  section.innerHTML = `
    <div class="settings-section-heading"><div><p class="eyebrow">VENUES</p><h3>会場管理</h3></div><span class="member-role-badge">${active.length}会場</span></div>
    <p class="settings-help">会場を登録すると、新規記録・過去記録への紐付けと、会場別の成績・場代集計に使えます。アーカイブしても過去の記録には残ります。</p>
    <form id="createVenueForm" class="venue-create-form"><label>会場名<input name="venueName" type="text" maxlength="80" required placeholder="例：○○雀荘"></label><label>メモ（任意）<input name="venueNote" type="text" maxlength="200" placeholder="例：フリー打ち放題"></label><button class="primary-button" type="submit">会場を追加</button></form>
    <div class="venue-settings-list">${active.length ? active.map(venueSettingsRowHtml).join("") : `<p class="game-section-note">登録された会場はありません。</p>`}</div>
    ${archived.length ? `<details class="venue-archived-details"><summary>アーカイブ済み（${archived.length}件）</summary><div class="venue-settings-list">${archived.map(venueSettingsRowHtml).join("")}</div></details>` : ""}
  `;
  const anchor = card.querySelector(".match-template-settings-section") || card.querySelector(".data-export-section") || card.lastElementChild;
  anchor?.insertAdjacentElement("afterend", section);

  section.querySelector("#createVenueForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type='submit']");
    const formData = new FormData(form);
    submit.disabled = true;
    try {
      markLocalRealtimeWrite();
      const name = String(formData.get("venueName") || "").trim();
      const note = String(formData.get("venueNote") || "").trim();
      const { data, error } = await supabaseClient.rpc("create_match_venue", { p_group_id: activeGroupId, p_name: name, p_note: note });
      if (error) throw error;
      await recordVenueActivity(`会場「${name}」を追加しました。`, "group", activeGroupId, { venue_id: data, venue_name: name });
      settingsMessage = `会場「${name}」を追加しました。`;
      await loadMatchVenues();
      renderSettingsPage();
    } catch (error) {
      alert(error.message || "会場を追加できませんでした。");
      submit.disabled = false;
    }
  });

  section.querySelectorAll("[data-edit-venue-id]").forEach((button) => button.addEventListener("click", async () => {
    const venue = getMatchVenue(button.dataset.editVenueId);
    if (!venue) return;
    const name = window.prompt("会場名を編集してください。", venue.name);
    if (name === null) return;
    if (!String(name).trim()) { alert("会場名を入力してください。"); return; }
    const note = window.prompt("補足メモを編集してください。", venue.note || "");
    if (note === null) return;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("update_match_venue", { p_venue_id: venue.id, p_name: String(name).trim(), p_note: String(note).trim() });
      if (error) throw error;
      await recordVenueActivity(`会場「${venue.name}」を編集しました。`, "group", activeGroupId, { before_name: venue.name, after_name: String(name).trim() });
      settingsMessage = "会場情報を更新しました。";
      await loadMatchVenues();
      renderSettingsPage();
    } catch (error) { alert(error.message || "会場を編集できませんでした。"); }
  }));

  section.querySelectorAll("[data-toggle-venue-archive-id]").forEach((button) => button.addEventListener("click", async () => {
    const venue = getMatchVenue(button.dataset.toggleVenueArchiveId);
    if (!venue) return;
    const restore = button.dataset.venueArchiveState === "restore";
    if (!window.confirm(`会場「${venue.name}」を${restore ? "復帰" : "アーカイブ"}しますか？`)) return;
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("archive_match_venue", { p_venue_id: venue.id, p_is_archived: !restore });
      if (error) throw error;
      await recordVenueActivity(`会場「${venue.name}」を${restore ? "復帰" : "アーカイブ"}しました。`, "group", activeGroupId, { venue_id: venue.id, is_archived: !restore });
      settingsMessage = `会場「${venue.name}」を${restore ? "復帰" : "アーカイブ"}しました。`;
      await loadMatchVenues();
      renderSettingsPage();
    } catch (error) { alert(error.message || "会場の状態を変更できませんでした。"); }
  }));
}

function buildVenueAnalytics() {
  const sessions = getRankingSessionsForPeriod();
  const dashboard = buildRankingDashboard();
  const dailyBySessionId = new Map(dashboard.dailySessions.map((item) => [item.sessionId, item]));
  const membersBySession = new Map();
  rankingRaw.sessionMembers.forEach((member) => {
    if (!membersBySession.has(member.session_id)) membersBySession.set(member.session_id, []);
    membersBySession.get(member.session_id).push(member.member_id);
  });
  const hanchanCountBySession = new Map();
  rankingRaw.hanchans.forEach((hanchan) => hanchanCountBySession.set(hanchan.session_id, (hanchanCountBySession.get(hanchan.session_id) || 0) + 1));
  const prepaymentBySessionMember = new Map(rankingRaw.prepayments.map((row) => [`${row.session_id}:${row.member_id}`, num(row.paid_molly)]));
  const stats = new Map();

  const ensure = (key, session) => {
    if (!stats.has(key)) {
      const venue = getMatchVenue(key);
      stats.set(key, {
        id: key,
        name: key === "__none__" ? "会場未設定" : venue?.name || "削除済み会場",
        archived: Boolean(venue?.is_archived),
        sessions: 0,
        hanchans: 0,
        venueFeeTotal: 0,
        members: new Map()
      });
    }
    return stats.get(key);
  };

  sessions.forEach((session) => {
    const key = session.venue_id || "__none__";
    const stat = ensure(key, session);
    const players = dailyBySessionId.get(session.id)?.players || [];
    const memberIds = membersBySession.get(session.id) || players.map((player) => player.memberId);
    const share = memberIds.length ? num(session.venue_fee_total) / memberIds.length : 0;
    stat.sessions += 1;
    stat.hanchans += hanchanCountBySession.get(session.id) || 0;
    stat.venueFeeTotal = roundTo(stat.venueFeeTotal + num(session.venue_fee_total), 2);
    players.forEach((player) => {
      if (!stat.members.has(player.memberId)) stat.members.set(player.memberId, { memberId: player.memberId, displayName: player.displayName, sessions: 0, gamePt: 0, finalPt: 0, chipCount: 0 });
      const row = stat.members.get(player.memberId);
      row.sessions += 1;
      row.gamePt = roundTo(row.gamePt + num(player.totalPt), 2);
      row.chipCount = roundOne(row.chipCount + num(player.chipCount));
      const prepaid = num(prepaymentBySessionMember.get(`${session.id}:${player.memberId}`));
      row.finalPt = roundTo(row.finalPt + num(player.totalPt) - share + prepaid, 2);
    });
  });

  return [...stats.values()].map((stat) => ({
    ...stat,
    averageVenueFee: stat.sessions ? roundTo(stat.venueFeeTotal / stat.sessions, 2) : 0,
    memberRows: [...stat.members.values()].sort((a, b) => b.gamePt - a.gamePt || a.displayName.localeCompare(b.displayName, "ja"))
  })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, "ja"));
}

function renderVenueAnalyticsSection() {
  const stats = buildVenueAnalytics();
  if (!stats.length) return "";
  if (!stats.some((item) => item.id === venueAnalyticsSelectedId)) venueAnalyticsSelectedId = stats[0].id;
  const selected = stats.find((item) => item.id === venueAnalyticsSelectedId) || stats[0];
  const summaryRows = stats.map((item) => `<button type="button" class="venue-analysis-summary ${item.id === selected.id ? "selected" : ""}" data-venue-analysis-id="${item.id}"><strong>${escapeHtml(item.name)}</strong><span>${item.sessions}会 ／ ${item.hanchans}半荘</span><small>場代 ${formatPtPlain(item.venueFeeTotal)}</small></button>`).join("");
  const playerRows = selected.memberRows.length ? selected.memberRows.map((row, index) => `<tr><td>${index + 1}</td><th>${escapeHtml(row.displayName)}</th><td>${row.sessions}会</td><td>${formatPtMarkup(row.gamePt)}</td><td>${formatPtMarkup(row.finalPt)}</td><td>${formatChipMarkup(row.chipCount)}</td></tr>`).join("") : `<tr><td colspan="6">記録がありません。</td></tr>`;
  return `<section class="game-section venue-analysis-section"><div class="game-section-heading"><div><p class="game-section-title">会場別集計</p><p class="game-section-note">ゲームptは場代を除外、最終精算ptは場代均等負担と先払いを反映しています。</p></div><span class="all-trend-note">${escapeHtml(getRankingPeriodLabel())}</span></div><div class="venue-analysis-summary-list">${summaryRows}</div><div class="venue-analysis-detail"><div class="venue-analysis-detail-heading"><div><strong>${escapeHtml(selected.name)}</strong>${selected.archived ? `<span>アーカイブ済み</span>` : ""}</div><div><span>対局 ${selected.sessions}会</span><span>半荘 ${selected.hanchans}回</span><span>場代合計 ${formatPtPlain(selected.venueFeeTotal)}</span><span>平均場代 ${formatPtPlain(selected.averageVenueFee)}</span></div></div><div class="venue-player-table-wrap"><table class="venue-player-table"><thead><tr><th>#</th><th>プレイヤー</th><th>対局</th><th>ゲームpt</th><th>最終精算pt</th><th>チップ</th></tr></thead><tbody>${playerRows}</tbody></table></div></div></section>`;
}

function injectVenueAnalyticsSection() {
  const page = getPageWorkspace();
  if (!page || page.querySelector(".venue-analysis-section")) return;
  const markup = renderVenueAnalyticsSection();
  if (!markup) return;
  const target = page.querySelector(".yakuman-ranking-list")?.closest(".game-section") || page.querySelector(".daily-history-section");
  if (target) target.insertAdjacentHTML("beforebegin", markup);
  else page.querySelector(".ranking-card")?.insertAdjacentHTML("beforeend", markup);
  page.querySelectorAll("[data-venue-analysis-id]").forEach((button) => button.addEventListener("click", () => {
    venueAnalyticsSelectedId = button.dataset.venueAnalysisId;
    renderRankingPage();
  }));
}

const createMatchSessionV29 = createMatchSession;
const renderCreateSessionViewV29 = renderCreateSessionView;
renderCreateSessionView = function() {
  renderCreateSessionViewV29();
  injectVenueCreateSection();
};

const renderActiveSessionViewV29 = renderActiveSessionView;
renderActiveSessionView = function() {
  renderActiveSessionViewV29();
  injectActiveSessionVenueSection();
};

const renderSettingsPageV29 = renderSettingsPage;
renderSettingsPage = function() {
  renderSettingsPageV29();
  injectVenueSettingsSection();
};

const renderRankingPageV29 = renderRankingPage;
renderRankingPage = function() {
  renderRankingPageV29();
  injectVenueAnalyticsSection();
};

const renderHistorySessionCardV29 = renderHistorySessionCard;
renderHistorySessionCard = function(session) {
  const original = renderHistorySessionCardV29(session);
  const venueTag = `<span class="history-venue-tag">会場：${escapeHtml(getMatchVenueName(session.venue_id))}</span>`;
  return original.replace(/(<div class="history-session-meta">[\s\S]*?)(<\/div>\s*<p class="history-session-members">)/, `$1${venueTag}$2`);
};

const loadMatchSessionsV29 = loadMatchSessions;
loadMatchSessions = async function() {
  const result = await loadMatchSessionsV29();
  try {
    await loadMatchVenues();
    await hydrateVenueSessionRows(sessionList);
    if (activeMatchSessionId) activeMatchSession = sessionList.find((item) => item.id === activeMatchSessionId) || activeMatchSession;
    if (currentTab === "game") renderMatchPage();
  } catch (error) {
    console.warn("会場情報を読み込めませんでした。", error);
  }
  return result;
};

const loadRankingDataV29 = loadRankingData;
loadRankingData = async function() {
  const result = await loadRankingDataV29();
  try {
    await loadMatchVenues();
    await hydrateVenueSessionRows(rankingRaw.sessions);
    const sessionIds = rankingRaw.sessions.map((session) => session.id);
    if (sessionIds.length) {
      const { data, error } = await supabaseClient.from("match_session_venue_prepayments").select("session_id, member_id, paid_molly").in("session_id", sessionIds);
      if (error) throw error;
      rankingRaw.prepayments = data || [];
    } else {
      rankingRaw.prepayments = [];
    }
    if (currentTab === "ranking") renderRankingPage();
  } catch (error) {
    console.warn("会場別集計の情報を読み込めませんでした。", error);
  }
  return result;
};

const loadHistoryDataV29 = loadHistoryData;
loadHistoryData = async function() {
  const result = await loadHistoryDataV29();
  try {
    await loadMatchVenues();
    await hydrateVenueSessionRows(historySessions);
    if (currentTab === "history") renderHistoryPage();
  } catch (error) {
    console.warn("履歴の会場情報を読み込めませんでした。", error);
  }
  return result;
};

const loadGroupsV29 = loadGroups;
loadGroups = async function() {
  const result = await loadGroupsV29();
  try { await loadMatchVenues(); }
  catch (error) { console.warn("会場情報を読み込めませんでした。", error); }
  if (currentTab === "settings") renderSettingsPage();
  return result;
};

const switchActiveGroupV29 = switchActiveGroup;
switchActiveGroup = async function(groupId) {
  resetVenueState();
  await switchActiveGroupV29(groupId);
  try { await loadMatchVenues(); }
  catch (error) { console.warn("会場情報を読み込めませんでした。", error); }
  if (currentTab === "settings") renderSettingsPage();
};

const updateAuthUIV29 = updateAuthUI;
updateAuthUI = async function(session) {
  await updateAuthUIV29(session);
  if (!session) resetVenueState();
  else {
    try { await loadMatchVenues(); }
    catch (error) { console.warn("会場情報を読み込めませんでした。", error); }
  }
};

const isRelevantRealtimePayloadV29 = isRelevantRealtimePayload;
isRelevantRealtimePayload = function(payload) {
  if (payload?.table === "match_venues") return getRealtimeRow(payload).group_id === activeGroupId;
  return isRelevantRealtimePayloadV29(payload);
};

const stopRealtimeSubscriptionsV29 = stopRealtimeSubscriptions;
stopRealtimeSubscriptions = async function() {
  if (venueRealtimeChannel && supabaseClient) {
    try { await supabaseClient.removeChannel(venueRealtimeChannel); }
    catch (error) { console.warn("会場のRealtime接続終了に失敗しました。", error); }
  }
  venueRealtimeChannel = null;
  venueRealtimeGroupId = null;
  return stopRealtimeSubscriptionsV29();
};

const setupRealtimeSubscriptionsV29 = setupRealtimeSubscriptions;
setupRealtimeSubscriptions = async function() {
  await setupRealtimeSubscriptionsV29();
  if (!supabaseClient || !currentSession || !activeGroupId) return;
  if (venueRealtimeChannel && venueRealtimeGroupId === activeGroupId) return;
  if (venueRealtimeChannel) {
    try { await supabaseClient.removeChannel(venueRealtimeChannel); } catch (_) {}
  }
  const groupId = activeGroupId;
  venueRealtimeChannel = supabaseClient.channel(`jakuroku-venues-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_venues", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .subscribe();
  venueRealtimeGroupId = groupId;
};

const fetchGroupExportPayloadV29 = fetchGroupExportPayload;
fetchGroupExportPayload = async function(groupId) {
  const payload = await fetchGroupExportPayloadV29(groupId);
  try {
    const [venuesResponse, metaRows] = await Promise.all([
      supabaseClient.from("match_venues").select("id, group_id, name, note, is_archived, created_at, updated_at").eq("group_id", groupId).order("name", { ascending: true }),
      fetchVenueSessionMeta(payload.sessions.map((session) => session.id))
    ]);
    if (venuesResponse.error) throw venuesResponse.error;
    payload.venues = venuesResponse.data || [];
    mergeVenueSessionMeta(payload.sessions, metaRows);
  } catch (error) {
    console.warn("出力用の会場情報を取得できませんでした。", error);
    payload.venues = [];
  }
  return payload;
};

const buildExportFilesV29 = buildExportFiles;
buildExportFiles = function(group, payload) {
  const result = buildExportFilesV29(group, payload);
  const venueRows = (payload.venues || []).map((venue) => ({
    venue_id: venue.id,
    venue_name: venue.name,
    note: venue.note || "",
    status: venue.is_archived ? "アーカイブ" : "利用中",
    created_at: venue.created_at || "",
    updated_at: venue.updated_at || ""
  }));
  const assignmentRows = (payload.sessions || []).map((session) => ({
    session_id: session.id,
    session_date: session.session_date,
    venue_id: session.venue_id || "",
    venue_name: getMatchVenueName(session.venue_id, "会場未設定"),
    venue_fee_total_pt: formatExportNumber(session.venue_fee_total, 2)
  }));
  const readmeIndex = result.files.findIndex((file) => file.name === "README.txt");
  const insertAt = readmeIndex >= 0 ? readmeIndex : result.files.length;
  result.files.splice(insertAt, 0,
    { name: "07_会場一覧.csv", content: createCsvText(Object.keys(venueRows[0] || { venue_id: "" }), venueRows) },
    { name: "08_対局と会場.csv", content: createCsvText(Object.keys(assignmentRows[0] || { session_id: "" }), assignmentRows) }
  );
  return result;
};


// v31: JSON backup restore UI
let backupRestoreState = {
  backup: null,
  fileName: "",
  sourceMembers: [],
  memberMap: {},
  preview: null,
  message: "",
  isError: false,
  busy: false
};

function getBackupRestoreTables(backup) {
  return backup && typeof backup === "object" && backup.tables && typeof backup.tables === "object" ? backup.tables : {};
}

function getBackupRestoreSourceMembers(backup) {
  const tables = getBackupRestoreTables(backup);
  const memberRows = Array.isArray(tables.members) ? tables.members : [];
  const sessionMemberRows = Array.isArray(tables.sessionMembers) ? tables.sessionMembers : [];
  const namesById = new Map(memberRows.map((member) => [String(member.id || ""), String(member.display_name || "不明なメンバー")]));
  const ids = [...new Set(sessionMemberRows.map((row) => String(row.member_id || "")).filter(Boolean))];
  return ids.map((id) => ({ id, displayName: namesById.get(id) || "不明なメンバー" }));
}

function normalizeRestoreName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja-JP");
}

function buildDefaultBackupMemberMap(sourceMembers) {
  const targetIds = new Set(activeGroupMembers.map((member) => String(member.id)));
  const targetsByName = new Map();
  activeGroupMembers.forEach((member) => {
    const key = normalizeRestoreName(member.display_name);
    if (key && !targetsByName.has(key)) targetsByName.set(key, String(member.id));
  });
  return Object.fromEntries(sourceMembers.map((source) => {
    const direct = targetIds.has(source.id) ? source.id : "";
    const byName = targetsByName.get(normalizeRestoreName(source.displayName)) || "";
    return [source.id, direct || byName];
  }));
}

function backupRestoreError(message) {
  backupRestoreState.preview = null;
  backupRestoreState.message = message;
  backupRestoreState.isError = true;
  backupRestoreState.busy = false;
}

async function previewBackupRestore() {
  if (!backupRestoreState.backup || !activeGroupId) return;
  backupRestoreState.busy = true;
  backupRestoreState.message = "バックアップ内容を確認しています…";
  backupRestoreState.isError = false;
  renderSettingsPage();
  try {
    const { data, error } = await supabaseClient.rpc("preview_jakuroku_backup", {
      p_target_group_id: activeGroupId,
      p_backup: backupRestoreState.backup,
      p_member_map: backupRestoreState.memberMap
    });
    if (error) throw error;
    backupRestoreState.preview = data || null;
    backupRestoreState.message = "内容を確認しました。復元前に対象と対応付けを確認してください。";
    backupRestoreState.isError = false;
  } catch (error) {
    backupRestoreError(error.message || "バックアップ内容を確認できませんでした。");
    renderSettingsPage();
    return;
  }
  backupRestoreState.busy = false;
  renderSettingsPage();
}

async function readBackupRestoreFile(file) {
  if (!file) return;
  backupRestoreState.busy = true;
  backupRestoreState.message = "JSONファイルを読み込んでいます…";
  backupRestoreState.isError = false;
  renderSettingsPage();
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error("JSONバックアップは15MB以下のファイルを選択してください。");
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup || typeof backup !== "object" || !String(backup.format || "").startsWith("jakuroku-backup-v")) {
      throw new Error("森研麻雀倶楽部のJSONバックアップファイルを選択してください。");
    }
    const sourceMembers = getBackupRestoreSourceMembers(backup);
    if (!sourceMembers.length) throw new Error("バックアップ内に復元対象の参加メンバーが見つかりません。");
    backupRestoreState.backup = backup;
    backupRestoreState.fileName = file.name;
    backupRestoreState.sourceMembers = sourceMembers;
    backupRestoreState.memberMap = buildDefaultBackupMemberMap(sourceMembers);
    backupRestoreState.preview = null;
    backupRestoreState.busy = false;
    await previewBackupRestore();
  } catch (error) {
    backupRestoreState.backup = null;
    backupRestoreState.fileName = "";
    backupRestoreState.sourceMembers = [];
    backupRestoreState.memberMap = {};
    backupRestoreError(error.message || "JSONファイルを読み込めませんでした。");
    renderSettingsPage();
  }
}

function clearBackupRestoreState() {
  backupRestoreState = {
    backup: null,
    fileName: "",
    sourceMembers: [],
    memberMap: {},
    preview: null,
    message: "",
    isError: false,
    busy: false
  };
  renderSettingsPage();
}

function renderBackupRestoreSection() {
  const hasBackup = Boolean(backupRestoreState.backup);
  const preview = backupRestoreState.preview || {};
  const unresolvedCount = Number(preview.unresolved_member_count || 0);
  const newSessionCount = Number(preview.new_session_count || 0);
  const canRestore = hasBackup && Boolean(backupRestoreState.preview) && !backupRestoreState.busy && unresolvedCount === 0 && newSessionCount > 0;
  const sourceName = escapeHtml(String(backupRestoreState.backup?.group?.name || preview.source_group_name || "不明なグループ"));
  const exportedAt = backupRestoreState.backup?.exported_at ? new Date(backupRestoreState.backup.exported_at).toLocaleString("ja-JP") : "不明";
  const status = backupRestoreState.message ? `<p class="backup-restore-message ${backupRestoreState.isError ? "error" : ""}">${escapeHtml(backupRestoreState.message)}</p>` : "";
  const memberRows = hasBackup ? backupRestoreState.sourceMembers.map((source) => {
    const selected = String(backupRestoreState.memberMap[source.id] || "");
    const options = [`<option value="">対応先を選択</option>`, ...activeGroupMembers.map((target) => `<option value="${escapeHtml(target.id)}" ${selected === String(target.id) ? "selected" : ""}>${escapeHtml(target.display_name)}${target.user_id ? "" : "（ゲスト）"}</option>`)].join("");
    return `<label class="backup-member-map-row"><span><strong>${escapeHtml(source.displayName)}</strong><small>バックアップ側</small></span><select data-backup-member-map-id="${escapeHtml(source.id)}">${options}</select></label>`;
  }).join("") : "";
  const previewBlock = hasBackup ? `
    <div class="backup-restore-preview">
      <div class="backup-restore-preview-grid">
        <div><span>バックアップ元</span><strong>${sourceName}</strong></div>
        <div><span>出力日時</span><strong>${escapeHtml(exportedAt)}</strong></div>
        <div><span>日次記録</span><strong>${Number(preview.session_count || 0)}日分</strong></div>
        <div><span>新規復元</span><strong>${newSessionCount}日分</strong></div>
        <div><span>重複のため除外</span><strong>${Number(preview.already_imported_session_count || 0)}日分</strong></div>
        <div><span>未対応メンバー</span><strong class="${unresolvedCount ? "is-negative" : "is-positive"}">${unresolvedCount}人</strong></div>
      </div>
      <details class="backup-member-map-details" ${unresolvedCount ? "open" : ""}>
        <summary>参加メンバーの対応付け（${backupRestoreState.sourceMembers.length}人）</summary>
        <p>バックアップ側の参加者を、現在のグループ内メンバーへ対応付けます。同じグループを復元する場合は通常そのままで問題ありません。</p>
        <div class="backup-member-map-list">${memberRows}</div>
        <button id="backupRestoreRecheckButton" class="secondary-button" type="button" ${backupRestoreState.busy ? "disabled" : ""}>対応付けを再確認</button>
      </details>
      ${unresolvedCount ? `<p class="backup-restore-warning">未対応の参加者がいるため、復元はまだ実行できません。</p>` : ""}
      ${newSessionCount === 0 && backupRestoreState.preview ? `<p class="backup-restore-warning">新たに復元する日次記録はありません。すでに復元済み、または同じグループ内に存在する記録です。</p>` : ""}
      <div class="backup-restore-actions"><button id="backupRestoreExecuteButton" class="primary-button" type="button" ${canRestore ? "" : "disabled"}>${backupRestoreState.busy ? "処理中…" : "この内容で復元"}</button><button id="backupRestoreClearButton" class="secondary-button" type="button" ${backupRestoreState.busy ? "disabled" : ""}>選択を解除</button></div>
    </div>` : "";

  return `<section class="settings-section backup-restore-section">
    <div class="settings-section-heading"><div><p class="eyebrow">DATA RESTORE</p><h3>JSONバックアップを復元</h3></div>${hasBackup ? `<span class="member-role-badge">${escapeHtml(backupRestoreState.fileName)}</span>` : ""}</div>
    <p class="settings-help">既存記録は上書きしません。同じバックアップをもう一度選んでも、すでに復元済みの日次記録は重複作成されません。現在は対局・半荘・チップ・場代・飛ばし点・役満を復元します。</p>
    <label class="backup-file-input"><span>JSONバックアップを選択</span><input id="backupRestoreFileInput" type="file" accept="application/json,.json" ${backupRestoreState.busy ? "disabled" : ""}></label>
    ${status}
    ${previewBlock}
  </section>`;
}

function injectBackupRestoreSection() {
  const page = getPageWorkspace();
  if (!page || page.querySelector(".backup-restore-section")) return;
  const exportSection = page.querySelector(".data-export-section");
  if (exportSection) exportSection.insertAdjacentHTML("afterend", renderBackupRestoreSection());
  else page.querySelector(".settings-card")?.insertAdjacentHTML("beforeend", renderBackupRestoreSection());

  document.getElementById("backupRestoreFileInput")?.addEventListener("change", (event) => { void readBackupRestoreFile(event.target.files?.[0]); });
  document.querySelectorAll("[data-backup-member-map-id]").forEach((select) => {
    select.addEventListener("change", () => {
      backupRestoreState.memberMap[select.dataset.backupMemberMapId] = select.value;
      backupRestoreState.preview = null;
      backupRestoreState.message = "対応付けを変更しました。「対応付けを再確認」を押してください。";
      backupRestoreState.isError = false;
      renderSettingsPage();
    });
  });
  document.getElementById("backupRestoreRecheckButton")?.addEventListener("click", () => { void previewBackupRestore(); });
  document.getElementById("backupRestoreClearButton")?.addEventListener("click", clearBackupRestoreState);
  document.getElementById("backupRestoreExecuteButton")?.addEventListener("click", async () => {
    const preview = backupRestoreState.preview;
    if (!preview || !backupRestoreState.backup || Number(preview.unresolved_member_count || 0) > 0 || Number(preview.new_session_count || 0) <= 0) return;
    const confirmed = window.confirm(`${preview.source_group_name || "バックアップ"}から${preview.new_session_count}日分・${preview.session_count || 0}日中の新規記録を復元します。\n\n既存データは上書きされません。実行しますか？`);
    if (!confirmed) return;
    backupRestoreState.busy = true;
    backupRestoreState.message = "バックアップを復元しています…";
    backupRestoreState.isError = false;
    renderSettingsPage();
    try {
      markLocalRealtimeWrite();
      const { data, error } = await supabaseClient.rpc("restore_jakuroku_backup", {
        p_target_group_id: activeGroupId,
        p_backup: backupRestoreState.backup,
        p_member_map: backupRestoreState.memberMap,
        p_options: { source: "settings_json_restore", file_name: backupRestoreState.fileName }
      });
      if (error) throw error;
      backupRestoreState.message = data?.message || "バックアップを復元しました。";
      backupRestoreState.isError = false;
      backupRestoreState.busy = false;
      await Promise.all([
        loadMatchSessions(),
        loadRankingData(),
        loadHistoryData(),
        loadExportPeriodOptions()
      ]);
      await loadActivityLogs().catch(() => {});
      renderSettingsPage();
    } catch (error) {
      backupRestoreError(error.message || "バックアップを復元できませんでした。");
      renderSettingsPage();
    }
  });
}

const renderSettingsPageV30 = renderSettingsPage;
renderSettingsPage = function() {
  renderSettingsPageV30();
  injectBackupRestoreSection();
};

/* v32: extended JSON backup v2 */
function isBackupV2(backup = backupRestoreState.backup) {
  return String(backup?.format || "") === "jakuroku-backup-v2";
}

function defaultBackupRestoreOptions(backup = backupRestoreState.backup) {
  if (!isBackupV2(backup)) {
    return {
      include_matches: true,
      include_venues: false,
      include_templates: false,
      include_debts: false,
      include_activity_logs: false,
      include_trash: false
    };
  }
  return {
    include_matches: true,
    include_venues: true,
    include_templates: true,
    include_debts: true,
    include_activity_logs: false,
    include_trash: false
  };
}

function getBackupRestoreOptions() {
  const defaults = defaultBackupRestoreOptions();
  const source = backupRestoreState.options || {};
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, Boolean(source[key] ?? defaults[key])]));
}

function getBackupRestoreSourceMembersV2(backup) {
  const tables = getBackupRestoreTables(backup);
  const rows = [];
  const pushId = (value) => {
    const id = String(value || "");
    if (id) rows.push(id);
  };
  (Array.isArray(tables.sessionMembers) ? tables.sessionMembers : []).forEach((row) => pushId(row.member_id));
  const trash = tables.trash && typeof tables.trash === "object" ? tables.trash : {};
  (Array.isArray(trash.sessionMembers) ? trash.sessionMembers : []).forEach((row) => pushId(row.member_id));
  (Array.isArray(tables.debtRecords) ? tables.debtRecords : []).forEach((row) => {
    pushId(row.debtor_member_id);
    pushId(row.creditor_member_id);
  });
  const namesById = new Map((Array.isArray(tables.members) ? tables.members : []).map((member) => [String(member.id || ""), String(member.display_name || "不明なメンバー")]));
  return [...new Set(rows)].map((id) => ({ id, displayName: namesById.get(id) || "不明なメンバー" }));
}

async function fetchBackupSessionBundle(groupId, deletedOnly) {
  let sessionsQuery = supabaseClient
    .from("match_sessions")
    .select("id, group_id, session_date, game_mode, rate_label, rate_multiplier, starting_points, chip_value, default_uma, tobi_enabled, venue_fee_total, venue_id, notes, status, settled_at, deleted_at, deleted_by, deleted_reason, created_at")
    .eq("group_id", groupId)
    .order("session_date", { ascending: true })
    .order("created_at", { ascending: true });
  sessionsQuery = deletedOnly
    ? sessionsQuery.not("deleted_at", "is", null)
    : sessionsQuery.is("deleted_at", null);

  const { data: sessionsData, error: sessionsError } = await sessionsQuery;
  if (sessionsError) throw sessionsError;
  const sessions = sessionsData || [];
  const sessionIds = sessions.map((row) => row.id);
  const empty = { sessions, sessionMembers: [], hanchans: [], results: [], chips: [], prepayments: [], tobiTransfers: [], yakumans: [] };
  if (!sessionIds.length) return empty;

  const [sessionMembersResponse, hanchansResponse, chipsResponse, prepaymentsResponse] = await Promise.all([
    supabaseClient.from("match_session_members").select("session_id, member_id").in("session_id", sessionIds),
    supabaseClient.from("match_hanchans").select("id, session_id, sequence_no, uma, notes, created_at").in("session_id", sessionIds).order("sequence_no", { ascending: true }),
    supabaseClient.from("match_session_chips").select("session_id, member_id, chip_count, updated_at").in("session_id", sessionIds),
    supabaseClient.from("match_session_venue_prepayments").select("session_id, member_id, paid_molly, updated_at").in("session_id", sessionIds)
  ]);
  [sessionMembersResponse, hanchansResponse, chipsResponse, prepaymentsResponse].forEach((response) => {
    if (response.error) throw response.error;
  });

  const hanchans = hanchansResponse.data || [];
  const hanchanIds = hanchans.map((row) => row.id);
  if (!hanchanIds.length) {
    return {
      ...empty,
      sessionMembers: sessionMembersResponse.data || [],
      hanchans,
      chips: chipsResponse.data || [],
      prepayments: prepaymentsResponse.data || []
    };
  }

  const [resultsResponse, transfersResponse, yakumansResponse] = await Promise.all([
    supabaseClient.from("match_hanchan_results").select("id, hanchan_id, member_id, rank, final_points, score_points, uma_points, tobi_points, total_points").in("hanchan_id", hanchanIds),
    supabaseClient.from("match_tobi_transfers").select("id, hanchan_id, from_member_id, to_member_id, points").in("hanchan_id", hanchanIds),
    supabaseClient.from("match_yakuman_records").select("id, hanchan_id, winner_member_id, yakuman_name, win_type, houjuu_member_id, created_at").in("hanchan_id", hanchanIds)
  ]);
  [resultsResponse, transfersResponse, yakumansResponse].forEach((response) => {
    if (response.error) throw response.error;
  });

  return {
    sessions,
    sessionMembers: sessionMembersResponse.data || [],
    hanchans,
    results: resultsResponse.data || [],
    chips: chipsResponse.data || [],
    prepayments: prepaymentsResponse.data || [],
    tobiTransfers: transfersResponse.data || [],
    yakumans: yakumansResponse.data || []
  };
}

async function fetchFullBackupV2Payload(groupId) {
  const [activeBundle, trashBundle, membersResponse, venuesResponse, templatesResponse, debtsResponse, debtEventsResponse, activitiesResponse] = await Promise.all([
    fetchBackupSessionBundle(groupId, false),
    fetchBackupSessionBundle(groupId, true),
    supabaseClient.from("group_members").select("id, group_id, user_id, display_name, role, created_at").eq("group_id", groupId).order("created_at", { ascending: true }),
    supabaseClient.from("match_venues").select("id, group_id, name, note, is_archived, created_at, updated_at").eq("group_id", groupId).order("created_at", { ascending: true }),
    supabaseClient.from("match_setting_templates").select("id, group_id, name, game_mode, rate_label, rate_multiplier, starting_points, uma, chip_unit, tobi_enabled, created_by, created_at, updated_at").eq("group_id", groupId).order("created_at", { ascending: true }),
    supabaseClient.from("debt_records").select("id, group_id, source_session_id, debtor_member_id, creditor_member_id, original_amount_pt, remaining_amount_pt, status, record_kind, memo, due_date, paid_at, cancelled_at, cancelled_by, cancelled_reason, created_at, updated_at").eq("group_id", groupId).order("created_at", { ascending: true }),
    supabaseClient.from("debt_events").select("id, group_id, debt_id, event_type, amount_pt, related_debt_id, note, occurred_at").eq("group_id", groupId).order("occurred_at", { ascending: true }),
    supabaseClient.from("group_activity_logs").select("id, group_id, actor_user_id, event_type, entity_type, entity_id, summary, details, created_at").eq("group_id", groupId).order("created_at", { ascending: true })
  ]);

  [membersResponse, venuesResponse, templatesResponse, debtsResponse, debtEventsResponse, activitiesResponse].forEach((response) => {
    if (response.error) throw response.error;
  });

  return {
    ...activeBundle,
    members: membersResponse.data || [],
    venues: venuesResponse.data || [],
    templates: templatesResponse.data || [],
    debtRecords: debtsResponse.data || [],
    debtEvents: debtEventsResponse.data || [],
    activityLogs: activitiesResponse.data || [],
    trash: trashBundle
  };
}

const exportGroupDataV31 = exportGroupData;
exportGroupData = async function(kind) {
  if (kind !== "json") return exportGroupDataV31(kind);
  const group = getActiveGroup();
  if (!group || !activeGroupId) return;
  exportMessage = "拡張JSONバックアップを作成しています…";
  exportMessageIsError = false;
  renderSettingsPage();
  try {
    const payload = await fetchFullBackupV2Payload(activeGroupId);
    const backup = {
      format: "jakuroku-backup-v2",
      exported_at: new Date().toISOString(),
      scope: { type: "full_group", label: "グループ全体" },
      group: { id: group.id, name: group.name, created_at: group.created_at || null },
      tables: payload
    };
    const baseName = `jakuroku_${safeDownloadName(group.name)}_full`;
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), `${baseName}_backup_v2.json`);
    exportMessage = `拡張JSONバックアップ v2を出力しました（対局${payload.sessions.length}日分、ゴミ箱${payload.trash.sessions.length}日分）。`;
    exportMessageIsError = false;
  } catch (error) {
    console.error("拡張JSONバックアップの出力に失敗しました。", error);
    exportMessage = error.message || "拡張JSONバックアップの出力に失敗しました。";
    exportMessageIsError = true;
  }
  renderSettingsPage();
};

function getPreviewBlockForBackupV2(preview) {
  const active = preview?.active_matches || {};
  const trash = preview?.trash_matches || {};
  return {
    active,
    trash,
    unresolvedActive: Number(active.unresolved_member_count || 0),
    unresolvedTrash: Number(trash.unresolved_member_count || 0),
    unresolvedDebt: Number(preview?.unresolved_debt_member_count || 0),
    newActive: Number(active.new_session_count || 0),
    newTrash: Number(trash.new_session_count || 0),
    venues: Number(preview?.venues_count || 0),
    templates: Number(preview?.templates_count || 0),
    debts: Number(preview?.debt_records_count || 0),
    debtEvents: Number(preview?.debt_events_count || 0),
    activities: Number(preview?.activity_logs_count || 0)
  };
}

function backupRestoreErrorV32(message) {
  backupRestoreState.preview = null;
  backupRestoreState.message = message;
  backupRestoreState.isError = true;
  backupRestoreState.busy = false;
}

previewBackupRestore = async function() {
  if (!backupRestoreState.backup || !activeGroupId) return;
  backupRestoreState.busy = true;
  backupRestoreState.message = "バックアップ内容を確認しています…";
  backupRestoreState.isError = false;
  renderSettingsPage();
  try {
    const v2 = isBackupV2();
    const { data, error } = await supabaseClient.rpc(v2 ? "preview_jakuroku_backup_v2" : "preview_jakuroku_backup", v2 ? {
      p_target_group_id: activeGroupId,
      p_backup: backupRestoreState.backup,
      p_member_map: backupRestoreState.memberMap,
      p_options: getBackupRestoreOptions()
    } : {
      p_target_group_id: activeGroupId,
      p_backup: backupRestoreState.backup,
      p_member_map: backupRestoreState.memberMap
    });
    if (error) throw error;
    backupRestoreState.preview = data || null;
    backupRestoreState.message = v2
      ? "拡張バックアップの内容を確認しました。復元対象と参加メンバーを確認してください。"
      : "内容を確認しました。復元前に参加メンバーの対応付けを確認してください。";
    backupRestoreState.isError = false;
  } catch (error) {
    backupRestoreErrorV32(error.message || "バックアップ内容を確認できませんでした。");
    renderSettingsPage();
    return;
  }
  backupRestoreState.busy = false;
  renderSettingsPage();
};

readBackupRestoreFile = async function(file) {
  if (!file) return;
  backupRestoreState.busy = true;
  backupRestoreState.message = "JSONファイルを読み込んでいます…";
  backupRestoreState.isError = false;
  renderSettingsPage();
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error("JSONバックアップは25MB以下のファイルを選択してください。");
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup || typeof backup !== "object" || !String(backup.format || "").startsWith("jakuroku-backup-v")) {
      throw new Error("森研麻雀倶楽部のJSONバックアップファイルを選択してください。");
    }
    const sourceMembers = isBackupV2(backup)
      ? getBackupRestoreSourceMembersV2(backup)
      : getBackupRestoreSourceMembers(backup);
    backupRestoreState.backup = backup;
    backupRestoreState.fileName = file.name;
    backupRestoreState.sourceMembers = sourceMembers;
    backupRestoreState.memberMap = buildDefaultBackupMemberMap(sourceMembers);
    backupRestoreState.options = defaultBackupRestoreOptions(backup);
    backupRestoreState.preview = null;
    backupRestoreState.busy = false;
    await previewBackupRestore();
  } catch (error) {
    backupRestoreState.backup = null;
    backupRestoreState.fileName = "";
    backupRestoreState.sourceMembers = [];
    backupRestoreState.memberMap = {};
    backupRestoreState.options = defaultBackupRestoreOptions(null);
    backupRestoreErrorV32(error.message || "JSONファイルを読み込めませんでした。");
    renderSettingsPage();
  }
};

clearBackupRestoreState = function() {
  backupRestoreState = {
    backup: null,
    fileName: "",
    sourceMembers: [],
    memberMap: {},
    options: defaultBackupRestoreOptions(null),
    preview: null,
    message: "",
    isError: false,
    busy: false
  };
  renderSettingsPage();
};

function renderBackupRestoreOption(key, title, description, checked, disabled = false) {
  return `<label class="backup-restore-option ${disabled ? "is-disabled" : ""}"><input type="checkbox" data-backup-restore-option="${key}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span></label>`;
}

function renderBackupRestoreSectionV32() {
  const hasBackup = Boolean(backupRestoreState.backup);
  const v2 = isBackupV2();
  const preview = backupRestoreState.preview || {};
  const options = getBackupRestoreOptions();
  const status = backupRestoreState.message ? `<p class="backup-restore-message ${backupRestoreState.isError ? "error" : ""}">${escapeHtml(backupRestoreState.message)}</p>` : "";
  const sourceName = escapeHtml(String(backupRestoreState.backup?.group?.name || preview?.active_matches?.source_group_name || preview.source_group_name || "不明なグループ"));
  const exportedAt = backupRestoreState.backup?.exported_at ? new Date(backupRestoreState.backup.exported_at).toLocaleString("ja-JP") : "不明";
  const memberRows = hasBackup && backupRestoreState.sourceMembers.length ? backupRestoreState.sourceMembers.map((source) => {
    const selected = String(backupRestoreState.memberMap[source.id] || "");
    const targetOptions = [`<option value="">対応先を選択</option>`, ...activeGroupMembers.map((target) => `<option value="${escapeHtml(target.id)}" ${selected === String(target.id) ? "selected" : ""}>${escapeHtml(target.display_name)}${target.user_id ? "" : "（ゲスト）"}</option>`)].join("");
    return `<label class="backup-member-map-row"><span><strong>${escapeHtml(source.displayName)}</strong><small>バックアップ側</small></span><select data-backup-member-map-id="${escapeHtml(source.id)}">${targetOptions}</select></label>`;
  }).join("") : "";

  let previewBlock = "";
  let canRestore = false;
  if (hasBackup && backupRestoreState.preview) {
    if (v2) {
      const values = getPreviewBlockForBackupV2(preview);
      const unresolved = (options.include_matches ? values.unresolvedActive : 0)
        + (options.include_trash ? values.unresolvedTrash : 0)
        + ((options.include_debts || options.include_trash) ? values.unresolvedDebt : 0);
      const hasSelectedData = (options.include_matches && values.newActive > 0)
        || (options.include_trash && values.newTrash > 0)
        || (options.include_venues && values.venues > 0)
        || (options.include_templates && values.templates > 0)
        || (options.include_debts && values.debts > 0)
        || (options.include_activity_logs && values.activities > 0);
      canRestore = !backupRestoreState.busy && unresolved === 0 && hasSelectedData;
      previewBlock = `
        <div class="backup-restore-preview">
          <div class="backup-restore-preview-grid">
            <div><span>バックアップ元</span><strong>${sourceName}</strong></div>
            <div><span>出力日時</span><strong>${escapeHtml(exportedAt)}</strong></div>
            <div><span>通常の対局</span><strong>${values.newActive}日分を新規復元</strong></div>
            <div><span>ゴミ箱の対局</span><strong>${values.newTrash}日分</strong></div>
            <div><span>会場</span><strong>${values.venues}件</strong></div>
            <div><span>テンプレート</span><strong>${values.templates}件</strong></div>
            <div><span>借pt</span><strong>${values.debts}件</strong></div>
            <div><span>編集履歴</span><strong>${values.activities}件</strong></div>
          </div>
          <div class="backup-restore-option-grid">
            ${renderBackupRestoreOption("include_matches", "対局・半荘・チップ・場代・役満", "通常の対局記録を復元します。既存データは上書きしません。", options.include_matches)}
            ${renderBackupRestoreOption("include_venues", "会場", "会場名・メモ・アーカイブ状態を復元します。", options.include_venues)}
            ${renderBackupRestoreOption("include_templates", "設定テンプレート", "形式・レート・ウマなどの保存済みテンプレートを復元します。", options.include_templates)}
            ${renderBackupRestoreOption("include_debts", "借pt", "未精算・精算済みの借ptと履歴を復元します。", options.include_debts)}
            ${renderBackupRestoreOption("include_activity_logs", "編集履歴", "復元元の履歴を『復元済み履歴』として追加します。", options.include_activity_logs)}
            ${renderBackupRestoreOption("include_trash", "ゴミ箱", "削除済みの対局と取消済み借ptをゴミ箱状態のまま復元します。", options.include_trash)}
          </div>
          <details class="backup-member-map-details" ${(unresolved > 0 || backupRestoreState.sourceMembers.length) ? "open" : ""}>
            <summary>参加メンバーの対応付け（${backupRestoreState.sourceMembers.length}人）</summary>
            <p>対局・借ptを復元する場合、バックアップ側の参加者を現在のグループ内メンバーへ対応付けます。同じグループのバックアップでは通常そのままで問題ありません。</p>
            ${memberRows ? `<div class="backup-member-map-list">${memberRows}</div>` : `<p class="game-section-note">対応付けが必要な参加メンバーはいません。</p>`}
            <button id="backupRestoreRecheckButton" class="secondary-button" type="button" ${backupRestoreState.busy ? "disabled" : ""}>対応付けを再確認</button>
          </details>
          ${unresolved ? `<p class="backup-restore-warning">選択した復元対象に未対応の参加者が${unresolved}人います。対応付け後に再確認してください。</p>` : ""}
          ${!hasSelectedData ? `<p class="backup-restore-warning">選択した復元対象に新規データがありません。復元対象を見直してください。</p>` : ""}
          <div class="backup-restore-actions"><button id="backupRestoreExecuteButton" class="primary-button" type="button" ${canRestore ? "" : "disabled"}>${backupRestoreState.busy ? "処理中…" : "選択した内容を復元"}</button><button id="backupRestoreClearButton" class="secondary-button" type="button" ${backupRestoreState.busy ? "disabled" : ""}>選択を解除</button></div>
        </div>`;
    } else {
      const unresolved = Number(preview.unresolved_member_count || 0);
      const newSessions = Number(preview.new_session_count || 0);
      canRestore = !backupRestoreState.busy && unresolved === 0 && newSessions > 0;
      previewBlock = `
        <div class="backup-restore-preview">
          <div class="backup-restore-preview-grid">
            <div><span>バックアップ元</span><strong>${sourceName}</strong></div>
            <div><span>出力日時</span><strong>${escapeHtml(exportedAt)}</strong></div>
            <div><span>日次記録</span><strong>${Number(preview.session_count || 0)}日分</strong></div>
            <div><span>新規復元</span><strong>${newSessions}日分</strong></div>
            <div><span>重複のため除外</span><strong>${Number(preview.already_imported_session_count || 0)}日分</strong></div>
            <div><span>未対応メンバー</span><strong class="${unresolved ? "is-negative" : "is-positive"}">${unresolved}人</strong></div>
          </div>
          <details class="backup-member-map-details" ${unresolved ? "open" : ""}>
            <summary>参加メンバーの対応付け（${backupRestoreState.sourceMembers.length}人）</summary>
            <p>バックアップ側の参加者を、現在のグループ内メンバーへ対応付けます。</p>
            <div class="backup-member-map-list">${memberRows}</div>
            <button id="backupRestoreRecheckButton" class="secondary-button" type="button" ${backupRestoreState.busy ? "disabled" : ""}>対応付けを再確認</button>
          </details>
          ${unresolved ? `<p class="backup-restore-warning">未対応の参加者がいるため、復元はまだ実行できません。</p>` : ""}
          <div class="backup-restore-actions"><button id="backupRestoreExecuteButton" class="primary-button" type="button" ${canRestore ? "" : "disabled"}>${backupRestoreState.busy ? "処理中…" : "この内容で復元"}</button><button id="backupRestoreClearButton" class="secondary-button" type="button" ${backupRestoreState.busy ? "disabled" : ""}>選択を解除</button></div>
        </div>`;
    }
  }

  return `<section class="settings-section backup-restore-section">
    <div class="settings-section-heading"><div><p class="eyebrow">DATA RESTORE</p><h3>JSONバックアップを復元</h3></div>${hasBackup ? `<span class="member-role-badge">${v2 ? "v2" : "旧形式"} ／ ${escapeHtml(backupRestoreState.fileName)}</span>` : ""}</div>
    <p class="settings-help">既存データは上書きしません。v2では会場・テンプレート・借pt・編集履歴・ゴミ箱も選択して復元できます。旧形式のJSONは、対局データのみ復元できます。</p>
    <label class="backup-file-input"><span>JSONバックアップを選択</span><input id="backupRestoreFileInput" type="file" accept="application/json,.json" ${backupRestoreState.busy ? "disabled" : ""}></label>
    ${status}
    ${previewBlock}
  </section>`;
}

injectBackupRestoreSection = function() {
  const page = getPageWorkspace();
  if (!page || page.querySelector(".backup-restore-section")) return;
  const exportSection = page.querySelector(".data-export-section");
  if (exportSection) exportSection.insertAdjacentHTML("afterend", renderBackupRestoreSectionV32());
  else page.querySelector(".settings-card")?.insertAdjacentHTML("beforeend", renderBackupRestoreSectionV32());

  document.getElementById("backupRestoreFileInput")?.addEventListener("change", (event) => { void readBackupRestoreFile(event.target.files?.[0]); });
  document.querySelectorAll("[data-backup-member-map-id]").forEach((select) => {
    select.addEventListener("change", () => {
      backupRestoreState.memberMap[select.dataset.backupMemberMapId] = select.value;
      backupRestoreState.preview = null;
      backupRestoreState.message = "対応付けを変更しました。「対応付けを再確認」を押してください。";
      backupRestoreState.isError = false;
      renderSettingsPage();
    });
  });
  document.querySelectorAll("[data-backup-restore-option]").forEach((input) => {
    input.addEventListener("change", () => {
      backupRestoreState.options = { ...getBackupRestoreOptions(), [input.dataset.backupRestoreOption]: input.checked };
      backupRestoreState.message = "復元対象を変更しました。内容を確認後に復元してください。";
      backupRestoreState.isError = false;
      renderSettingsPage();
    });
  });
  document.getElementById("backupRestoreRecheckButton")?.addEventListener("click", () => { void previewBackupRestore(); });
  document.getElementById("backupRestoreClearButton")?.addEventListener("click", clearBackupRestoreState);
  document.getElementById("backupRestoreExecuteButton")?.addEventListener("click", async () => {
    const preview = backupRestoreState.preview;
    const backup = backupRestoreState.backup;
    if (!preview || !backup) return;
    const v2 = isBackupV2(backup);
    const options = getBackupRestoreOptions();
    const message = v2
      ? `${backup.group?.name || "バックアップ"}から、選択した拡張データを復元します。\n\n既存データは上書きされません。実行しますか？`
      : `${preview.source_group_name || "バックアップ"}から${preview.new_session_count || 0}日分の新規記録を復元します。\n\n既存データは上書きされません。実行しますか？`;
    if (!window.confirm(message)) return;
    backupRestoreState.busy = true;
    backupRestoreState.message = "バックアップを復元しています…";
    backupRestoreState.isError = false;
    renderSettingsPage();
    try {
      markLocalRealtimeWrite();
      const { data, error } = await supabaseClient.rpc(v2 ? "restore_jakuroku_backup_v2" : "restore_jakuroku_backup", v2 ? {
        p_target_group_id: activeGroupId,
        p_backup: backup,
        p_member_map: backupRestoreState.memberMap,
        p_options: { ...options, source: "settings_json_restore_v2", file_name: backupRestoreState.fileName }
      } : {
        p_target_group_id: activeGroupId,
        p_backup: backup,
        p_member_map: backupRestoreState.memberMap,
        p_options: { source: "settings_json_restore", file_name: backupRestoreState.fileName }
      });
      if (error) throw error;
      backupRestoreState.message = data?.message || "バックアップを復元しました。";
      backupRestoreState.isError = false;
      backupRestoreState.busy = false;
      await Promise.all([
        loadMatchSessions(),
        loadRankingData(),
        loadHistoryData(),
        loadExportPeriodOptions(),
        loadMatchVenues().catch(() => []),
        loadMatchSettingTemplates().catch(() => [])
      ]);
      await Promise.all([loadActivityLogs().catch(() => {}), fetchDebtData().catch(() => {})]);
      renderSettingsPage();
    } catch (error) {
      backupRestoreErrorV32(error.message || "バックアップを復元できませんでした。");
      renderSettingsPage();
    }
  });
};

const renderSettingsPageV31 = renderSettingsPage;
renderSettingsPage = function() {
  renderSettingsPageV31();
  const section = document.querySelector(".data-export-section");
  if (section) {
    const heading = section.querySelector("h3");
    if (heading) heading.textContent = "記録のバックアップ・出力";
    const jsonButton = section.querySelector("#settingsExportJsonButton");
    if (jsonButton) jsonButton.textContent = "拡張JSONバックアップ v2を出力";
    const help = section.querySelector(".data-export-help");
    if (help) help.textContent = "CSVは選択期間の確認用です。JSON v2はグループ全体の対局・会場・テンプレート・借pt・編集履歴・ゴミ箱を保存します。招待コードは含めません。";
    const badge = section.querySelector(".member-role-badge");
    if (badge) badge.textContent = "JSONはグループ全体";
  }
};

/* v33: in-app feedback board */
let feedbackItems = [];
let feedbackComments = [];
let feedbackStatusFilter = "all";
let feedbackExpandedId = "";
let feedbackShowCreateForm = false;
let feedbackMessage = "";
let feedbackMessageIsError = false;
let feedbackBusy = false;
let feedbackRealtimeChannel = null;
let feedbackRealtimeGroupId = null;

const FEEDBACK_STATUS_OPTIONS = [
  { value: "all", label: "すべて" },
  { value: "open", label: "未確認" },
  { value: "in_progress", label: "対応中" },
  { value: "resolved", label: "完了" },
  { value: "declined", label: "見送り" }
];

function feedbackCategoryLabel(value) {
  return {
    feature_request: "機能要望",
    bug: "不具合",
    usability: "使いにくい点",
    other: "その他"
  }[value] || "その他";
}

function feedbackStatusLabel(value) {
  return {
    open: "未確認",
    in_progress: "対応中",
    resolved: "完了",
    declined: "見送り"
  }[value] || "未確認";
}

function feedbackSeverityLabel(value) {
  return {
    low: "低",
    normal: "通常",
    high: "高",
    critical: "緊急"
  }[value] || "通常";
}

function feedbackPriorityLabel(value) {
  return {
    low: "低",
    normal: "通常",
    high: "高",
    critical: "最優先"
  }[value] || "通常";
}

function formatFeedbackTime(value) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function feedbackCommentListFor(feedbackId) {
  return feedbackComments
    .filter((comment) => comment.feedback_id === feedbackId)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function feedbackCounts() {
  return feedbackItems.reduce((counts, item) => {
    counts.all += 1;
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, { all: 0, open: 0, in_progress: 0, resolved: 0, declined: 0 });
}

function ensureFeedbackNavigation() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav || nav.querySelector('[data-tab="feedback"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item";
  button.dataset.tab = "feedback";
  button.innerHTML = `<span>声</span><small>意見</small>`;
  const settingsButton = nav.querySelector('[data-tab="settings"]');
  nav.insertBefore(button, settingsButton || null);
  navItems = document.querySelectorAll(".nav-item");
  button.addEventListener("click", () => { void switchTab("feedback"); });
}

function renderFeedbackFilters(counts) {
  return `<div class="feedback-filter-tabs">${FEEDBACK_STATUS_OPTIONS.map((option) => {
    const count = counts[option.value] || 0;
    return `<button class="ranking-filter-button ${feedbackStatusFilter === option.value ? "active" : ""}" type="button" data-feedback-status-filter="${option.value}">${escapeHtml(option.label)}（${count}）</button>`;
  }).join("")}</div>`;
}

function renderFeedbackCreateForm() {
  if (!feedbackShowCreateForm) return "";
  return `<form id="feedbackCreateForm" class="feedback-create-form">
    <div class="feedback-form-heading"><div><p class="eyebrow">NEW FEEDBACK</p><h3>意見を投稿</h3></div><button id="feedbackCloseCreateButton" class="icon-text-button" type="button">閉じる</button></div>
    <p class="settings-help">要望、不具合、使いにくい点をそのまま残してください。不具合は、発生した画面と手順も書くと対応しやすくなります。</p>
    <div class="feedback-form-grid">
      <label>種別<select name="category"><option value="feature_request">機能要望</option><option value="bug">不具合</option><option value="usability">使いにくい点</option><option value="other">その他</option></select></label>
      <label>重要度<select name="severity"><option value="low">低</option><option value="normal" selected>通常</option><option value="high">高</option><option value="critical">緊急</option></select></label>
    </div>
    <label>件名<input name="title" type="text" maxlength="100" required placeholder="例：役満の入力画面で保存できない"></label>
    <label>内容<textarea name="body" rows="5" maxlength="2000" required placeholder="何をしたいか、何が起きたかを書いてください。"></textarea></label>
    <div class="feedback-form-grid">
      <label>発生した画面・操作（任意）<input name="screenName" type="text" maxlength="100" placeholder="例：対局記録 ＞ 半荘追加"></label>
      <label>再現手順（任意）<textarea name="reproductionSteps" rows="3" maxlength="2000" placeholder="例：1. 半荘追加 2. ..."></textarea></label>
    </div>
    <div class="feedback-form-actions"><button class="primary-button" type="submit">投稿する</button><button id="feedbackCancelCreateButton" class="secondary-button" type="button">キャンセル</button></div>
    <p class="feedback-form-message"></p>
  </form>`;
}

function renderFeedbackComment(comment) {
  return `<article class="feedback-comment">
    <div class="feedback-comment-heading"><strong>${escapeHtml(getMemberName(comment.author_member_id))}</strong><time>${escapeHtml(formatFeedbackTime(comment.created_at))}</time></div>
    <p>${escapeHtml(comment.body || "")}</p>
  </article>`;
}

function renderFeedbackManagement(item) {
  if (!isActiveGroupAdmin()) {
    return item.admin_note
      ? `<section class="feedback-admin-note"><p>管理側コメント</p><div>${escapeHtml(item.admin_note)}</div></section>`
      : "";
  }
  return `<details class="feedback-management-details" ${item.status !== "resolved" && item.status !== "declined" ? "open" : ""}>
    <summary>管理用：対応状況を更新</summary>
    <form class="feedback-management-form" data-feedback-management-id="${item.id}">
      <div class="feedback-form-grid">
        <label>対応状況<select name="status"><option value="open" ${item.status === "open" ? "selected" : ""}>未確認</option><option value="in_progress" ${item.status === "in_progress" ? "selected" : ""}>対応中</option><option value="resolved" ${item.status === "resolved" ? "selected" : ""}>完了</option><option value="declined" ${item.status === "declined" ? "selected" : ""}>見送り</option></select></label>
        <label>優先度<select name="priority"><option value="low" ${item.priority === "low" ? "selected" : ""}>低</option><option value="normal" ${item.priority === "normal" ? "selected" : ""}>通常</option><option value="high" ${item.priority === "high" ? "selected" : ""}>高</option><option value="critical" ${item.priority === "critical" ? "selected" : ""}>最優先</option></select></label>
      </div>
      <label>管理側コメント<textarea name="adminNote" rows="3" maxlength="2000" placeholder="対応内容・見送り理由など">${escapeHtml(item.admin_note || "")}</textarea></label>
      <div class="feedback-form-actions"><button class="secondary-button" type="submit">管理内容を保存</button></div>
      <p class="feedback-management-message"></p>
    </form>
  </details>`;
}

function renderFeedbackItem(item) {
  const expanded = feedbackExpandedId === item.id;
  const comments = feedbackCommentListFor(item.id);
  const admin = isActiveGroupAdmin();
  const screen = item.screen_name ? `<div class="feedback-context-row"><span>画面・操作</span><strong>${escapeHtml(item.screen_name)}</strong></div>` : "";
  const steps = item.reproduction_steps ? `<section class="feedback-steps"><p>再現手順</p><div>${escapeHtml(item.reproduction_steps)}</div></section>` : "";
  const adminNote = !admin && item.admin_note ? renderFeedbackManagement(item) : "";
  const expandedContent = expanded ? `<div class="feedback-expanded-content">
    ${screen}
    ${steps}
    ${admin ? renderFeedbackManagement(item) : adminNote}
    <section class="feedback-comments-section">
      <div class="feedback-comments-heading"><strong>コメント</strong><span>${comments.length}件</span></div>
      <div class="feedback-comment-list">${comments.length ? comments.map(renderFeedbackComment).join("") : `<p class="feedback-empty-comments">まだコメントはありません。</p>`}</div>
      <form class="feedback-comment-form" data-feedback-comment-id="${item.id}">
        <label>コメント<textarea name="body" rows="3" maxlength="1000" required placeholder="補足、同じ不具合の報告、解決確認など"></textarea></label>
        <div class="feedback-form-actions"><button class="secondary-button" type="submit">コメントを追加</button></div>
        <p class="feedback-comment-message"></p>
      </form>
    </section>
  </div>` : "";

  return `<article class="feedback-item-card ${expanded ? "open" : ""}">
    <button type="button" class="feedback-item-toggle" data-feedback-toggle-id="${item.id}" aria-expanded="${expanded ? "true" : "false"}">
      <div class="feedback-item-title-block"><div class="feedback-badge-row"><span class="feedback-category-badge ${escapeHtml(item.category)}">${escapeHtml(feedbackCategoryLabel(item.category))}</span><span class="feedback-status-badge ${escapeHtml(item.status)}">${escapeHtml(feedbackStatusLabel(item.status))}</span><span class="feedback-severity-badge ${escapeHtml(item.severity)}">重要度：${escapeHtml(feedbackSeverityLabel(item.severity))}</span></div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(getMemberName(item.author_member_id))} ／ ${escapeHtml(formatFeedbackTime(item.created_at))}</small></div>
      <span class="feedback-toggle-icon">${expanded ? "−" : "＋"}</span>
    </button>
    <div class="feedback-item-body"><p>${escapeHtml(item.body || "")}</p></div>
    <div class="feedback-item-meta"><span>優先度：${escapeHtml(feedbackPriorityLabel(item.priority))}</span><span>最終更新：${escapeHtml(formatFeedbackTime(item.updated_at || item.created_at))}</span></div>
    ${expandedContent}
  </article>`;
}

function renderFeedbackPage() {
  const page = getPageWorkspace();
  if (!currentSession) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">FEEDBACK</p><h2>ログインが必要です</h2><p class="workspace-description">意見・不具合の投稿と確認にはログインしてください。</p><button id="feedbackBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("feedbackBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }
  if (!getActiveGroup()) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">FEEDBACK</p><h2>先にグループを選択してください</h2><p class="workspace-description">フィードバックはグループ単位で共有されます。</p><button id="feedbackBackHomeButton" class="primary-button" type="button">ホームへ戻る</button></section>`;
    document.getElementById("feedbackBackHomeButton")?.addEventListener("click", () => { void switchTab("home"); });
    return;
  }

  const counts = feedbackCounts();
  const records = feedbackStatusFilter === "all"
    ? feedbackItems
    : feedbackItems.filter((item) => item.status === feedbackStatusFilter);
  const message = feedbackMessage ? `<p class="feedback-page-message ${feedbackMessageIsError ? "error" : ""}">${escapeHtml(feedbackMessage)}</p>` : "";
  const createButton = feedbackShowCreateForm
    ? ""
    : `<button id="feedbackOpenCreateButton" class="primary-button" type="button">＋ 投稿する</button>`;

  page.innerHTML = `<section class="game-card feedback-page-card">
    <div class="game-card-heading"><div><p class="eyebrow">TEAM FEEDBACK</p><h2>フィードバック</h2></div>${createButton}</div>
    <p class="game-description">実際に使って気づいた要望、不具合、使いにくい点を残す場所です。投稿内容と対応状況はグループ内で共有されます。</p>
    ${message}
    ${renderFeedbackCreateForm()}
    <section class="feedback-overview-section">
      <div class="feedback-overview-grid"><div><span>未確認</span><strong>${counts.open}</strong></div><div><span>対応中</span><strong>${counts.in_progress}</strong></div><div><span>完了</span><strong>${counts.resolved}</strong></div><div><span>合計</span><strong>${counts.all}</strong></div></div>
      ${renderFeedbackFilters(counts)}
    </section>
    <div class="feedback-list">${records.length ? records.map(renderFeedbackItem).join("") : `<p class="feedback-empty-state">${feedbackStatusFilter === "all" ? "まだ投稿はありません。使って気づいた点を最初の1件として残してください。" : "この状態の投稿はありません。"}</p>`}</div>
  </section>`;
  bindFeedbackPageEvents();
}

function setFeedbackMessage(message, isError = false) {
  feedbackMessage = message;
  feedbackMessageIsError = isError;
}

async function loadFeedbackData() {
  const page = getPageWorkspace();
  if (!currentSession || !activeGroupId) {
    feedbackItems = [];
    feedbackComments = [];
    renderFeedbackPage();
    return;
  }
  page.innerHTML = `<section class="workspace-card loading-card">フィードバックを読み込み中...</section>`;
  try {
    const { data: feedbackData, error: feedbackError } = await supabaseClient
      .from("group_feedback")
      .select("id, group_id, author_member_id, category, title, body, screen_name, reproduction_steps, severity, status, priority, admin_note, created_at, updated_at")
      .eq("group_id", activeGroupId)
      .order("updated_at", { ascending: false });
    if (feedbackError) throw feedbackError;
    feedbackItems = feedbackData || [];
    const ids = feedbackItems.map((item) => item.id);
    if (ids.length) {
      const { data: commentData, error: commentError } = await supabaseClient
        .from("group_feedback_comments")
        .select("id, feedback_id, author_member_id, body, created_at")
        .in("feedback_id", ids)
        .order("created_at", { ascending: true });
      if (commentError) throw commentError;
      feedbackComments = commentData || [];
    } else {
      feedbackComments = [];
    }
    renderFeedbackPage();
  } catch (error) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">FEEDBACK</p><h2>フィードバックを読み込めませんでした</h2><p class="workspace-description">${escapeHtml(error.message || "通信状態を確認してください。")}</p><button id="retryFeedbackButton" class="primary-button" type="button">再読み込み</button></section>`;
    document.getElementById("retryFeedbackButton")?.addEventListener("click", () => { void loadFeedbackData(); });
  }
}

function bindFeedbackPageEvents() {
  document.getElementById("feedbackOpenCreateButton")?.addEventListener("click", () => {
    feedbackShowCreateForm = true;
    feedbackMessage = "";
    feedbackMessageIsError = false;
    renderFeedbackPage();
  });
  document.getElementById("feedbackCloseCreateButton")?.addEventListener("click", () => {
    feedbackShowCreateForm = false;
    renderFeedbackPage();
  });
  document.getElementById("feedbackCancelCreateButton")?.addEventListener("click", () => {
    feedbackShowCreateForm = false;
    renderFeedbackPage();
  });
  document.querySelectorAll("[data-feedback-status-filter]").forEach((button) => button.addEventListener("click", () => {
    feedbackStatusFilter = button.dataset.feedbackStatusFilter || "all";
    renderFeedbackPage();
  }));
  document.querySelectorAll("[data-feedback-toggle-id]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.feedbackToggleId;
    feedbackExpandedId = feedbackExpandedId === id ? "" : id;
    renderFeedbackPage();
  }));

  const createForm = document.getElementById("feedbackCreateForm");
  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (feedbackBusy) return;
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const message = form.querySelector(".feedback-form-message");
    const values = new FormData(form);
    feedbackBusy = true;
    submit.disabled = true;
    message.textContent = "投稿しています…";
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("create_group_feedback", {
        p_group_id: activeGroupId,
        p_category: String(values.get("category") || "other"),
        p_title: String(values.get("title") || ""),
        p_body: String(values.get("body") || ""),
        p_screen_name: String(values.get("screenName") || ""),
        p_reproduction_steps: String(values.get("reproductionSteps") || ""),
        p_severity: String(values.get("severity") || "normal")
      });
      if (error) throw error;
      feedbackShowCreateForm = false;
      setFeedbackMessage("投稿しました。グループ内のメンバーが内容を確認できます。");
      await loadFeedbackData();
    } catch (error) {
      message.textContent = error.message || "投稿できませんでした。";
    } finally {
      feedbackBusy = false;
      if (submit?.isConnected) submit.disabled = false;
    }
  });

  document.querySelectorAll(".feedback-comment-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (feedbackBusy) return;
    const targetForm = event.currentTarget;
    const feedbackId = targetForm.dataset.feedbackCommentId;
    const submit = targetForm.querySelector('button[type="submit"]');
    const message = targetForm.querySelector(".feedback-comment-message");
    const values = new FormData(targetForm);
    feedbackBusy = true;
    submit.disabled = true;
    message.textContent = "追加しています…";
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("add_group_feedback_comment", {
        p_feedback_id: feedbackId,
        p_body: String(values.get("body") || "")
      });
      if (error) throw error;
      setFeedbackMessage("コメントを追加しました。");
      await loadFeedbackData();
    } catch (error) {
      message.textContent = error.message || "コメントを追加できませんでした。";
    } finally {
      feedbackBusy = false;
      if (submit?.isConnected) submit.disabled = false;
    }
  }));

  document.querySelectorAll(".feedback-management-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (feedbackBusy) return;
    const targetForm = event.currentTarget;
    const feedbackId = targetForm.dataset.feedbackManagementId;
    const submit = targetForm.querySelector('button[type="submit"]');
    const message = targetForm.querySelector(".feedback-management-message");
    const values = new FormData(targetForm);
    feedbackBusy = true;
    submit.disabled = true;
    message.textContent = "保存しています…";
    try {
      markLocalRealtimeWrite();
      const { error } = await supabaseClient.rpc("update_group_feedback_management", {
        p_feedback_id: feedbackId,
        p_status: String(values.get("status") || "open"),
        p_priority: String(values.get("priority") || "normal"),
        p_admin_note: String(values.get("adminNote") || "")
      });
      if (error) throw error;
      setFeedbackMessage("対応状況を更新しました。");
      await loadFeedbackData();
    } catch (error) {
      message.textContent = error.message || "対応状況を更新できませんでした。";
    } finally {
      feedbackBusy = false;
      if (submit?.isConnected) submit.disabled = false;
    }
  }));
}

const switchTabV32 = switchTab;
switchTab = async function(tab) {
  if (tab !== "feedback") return switchTabV32(tab);
  currentTab = "feedback";
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.tab === "feedback"));
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  getPageWorkspace().hidden = false;
  await loadFeedbackData();
};

const refreshCurrentViewFromRealtimeV32 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  if (currentTab === "feedback") {
    clearRealtimeRefreshTimer();
    if (!currentSession || !activeGroupId) return;
    if (!force && isRealtimeInputInProgress()) {
      realtimePendingRefresh = true;
      showRealtimeUpdateBanner();
      return;
    }
    realtimePendingRefresh = false;
    removeRealtimeUpdateBanner();
    try { await loadFeedbackData(); }
    catch (error) { console.warn("フィードバックのRealtime更新に失敗しました。", error); }
    return;
  }
  return refreshCurrentViewFromRealtimeV32(force);
};

const isRelevantRealtimePayloadV32 = isRelevantRealtimePayload;
isRelevantRealtimePayload = function(payload) {
  const row = getRealtimeRow(payload);
  if (payload?.table === "group_feedback") return row.group_id === activeGroupId;
  if (payload?.table === "group_feedback_comments") {
    return currentTab === "feedback" || feedbackItems.some((item) => item.id === row.feedback_id);
  }
  return isRelevantRealtimePayloadV32(payload);
};

const isRealtimeInputInProgressV32 = isRealtimeInputInProgress;
isRealtimeInputInProgress = function() {
  if (document.activeElement?.closest(".feedback-create-form, .feedback-comment-form, .feedback-management-form")) return true;
  return isRealtimeInputInProgressV32();
};

const stopRealtimeSubscriptionsV32 = stopRealtimeSubscriptions;
stopRealtimeSubscriptions = async function() {
  if (feedbackRealtimeChannel && supabaseClient) {
    try { await supabaseClient.removeChannel(feedbackRealtimeChannel); }
    catch (error) { console.warn("フィードバックのRealtime接続終了に失敗しました。", error); }
  }
  feedbackRealtimeChannel = null;
  feedbackRealtimeGroupId = null;
  return stopRealtimeSubscriptionsV32();
};

const setupRealtimeSubscriptionsV32 = setupRealtimeSubscriptions;
setupRealtimeSubscriptions = async function() {
  await setupRealtimeSubscriptionsV32();
  if (!supabaseClient || !currentSession || !activeGroupId) return;
  if (feedbackRealtimeChannel && feedbackRealtimeGroupId === activeGroupId) return;
  if (feedbackRealtimeChannel) {
    try { await supabaseClient.removeChannel(feedbackRealtimeChannel); } catch (_) {}
  }
  const groupId = activeGroupId;
  feedbackRealtimeChannel = supabaseClient.channel(`jakuroku-feedback-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_feedback", filter: `group_id=eq.${groupId}` }, handleRealtimePayload)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_feedback_comments" }, handleRealtimePayload)
    .subscribe();
  feedbackRealtimeGroupId = groupId;
};

const switchActiveGroupV32 = switchActiveGroup;
switchActiveGroup = async function(groupId) {
  await switchActiveGroupV32(groupId);
  feedbackItems = [];
  feedbackComments = [];
  feedbackExpandedId = "";
  feedbackStatusFilter = "all";
  feedbackShowCreateForm = false;
  feedbackMessage = "";
  feedbackMessageIsError = false;
  if (currentTab === "feedback") await loadFeedbackData();
};

const updateAuthUIV32 = updateAuthUI;
updateAuthUI = async function(session) {
  await updateAuthUIV32(session);
  if (!session) {
    feedbackItems = [];
    feedbackComments = [];
    feedbackExpandedId = "";
    feedbackShowCreateForm = false;
    feedbackMessage = "";
    feedbackMessageIsError = false;
  }
};

ensureFeedbackNavigation();

/* v34: mobile information architecture / navigation redesign */
const switchTabV33 = switchTab;
let navigationHubV34 = "";
let settingsFocusV34 = "";

const PRIMARY_NAV_V34 = [
  { id: "home", symbol: "⌂", label: "ホーム" },
  { id: "game", symbol: "対", label: "対局" },
  { id: "analytics", symbol: "析", label: "分析" },
  { id: "debt", symbol: "借", label: "精算" },
  { id: "settings", symbol: "設", label: "設定" }
];

function primaryAreaForV34(tab = currentTab) {
  if (tab === "home") return "home";
  if (["game", "history"].includes(tab)) return "game";
  if (["ranking", "analytics"].includes(tab)) return "analytics";
  if (tab === "debt") return "debt";
  if (["settings", "trash", "feedback"].includes(tab)) return "settings";
  if (String(tab || "").startsWith("hub-")) return String(tab).replace("hub-", "");
  return "";
}

function setPrimaryNavActiveV34(area) {
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.tab === area));
}

function configurePrimaryNavigationV34() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav) return;
  nav.innerHTML = PRIMARY_NAV_V34.map((item) => `
    <button type="button" class="nav-item nav-item-v34" data-tab="${item.id}" aria-label="${item.label}">
      <span>${item.symbol}</span><small>${item.label}</small>
    </button>
  `).join("");
  navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => item.addEventListener("click", () => {
    const area = item.dataset.tab;
    if (area === "home") {
      settingsFocusV34 = "";
      navigationHubV34 = "";
      void switchTabV33("home");
      return;
    }
    renderNavigationHubV34(area);
  }));
  setPrimaryNavActiveV34(primaryAreaForV34());
}

function hubCardV34(feature, symbol, title, text, meta = "") {
  return `
    <button type="button" class="hub-menu-card" data-v34-feature="${feature}">
      <span class="hub-menu-icon">${symbol}</span>
      <span class="hub-menu-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small>${meta ? `<em>${escapeHtml(meta)}</em>` : ""}</span>
      <span class="hub-menu-arrow" aria-hidden="true">›</span>
    </button>
  `;
}

function renderNavigationHubV34(area) {
  navigationHubV34 = area;
  settingsFocusV34 = "";
  currentTab = `hub-${area}`;
  setPrimaryNavActiveV34(area);
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  const page = getPageWorkspace();
  page.hidden = false;

  const groupName = getActiveGroup()?.name || "グループを選択";
  const itemMap = {
    game: {
      eyebrow: "MATCH",
      title: "対局メニュー",
      text: "記録する・過去の対局を探す、の入口を分けています。",
      cards: [
        hubCardV34("game-session", "対", "日次記録", "新規対局、進行中の半荘入力、精算済み対局の確認", activeMatchSession ? `進行中：${formatDate(activeMatchSession.session_date)}` : ""),
        hubCardV34("history", "歴", "対局履歴", "カレンダー、期間・形式・レート・参加者で過去記録を探す")
      ]
    },
    analytics: {
      eyebrow: "ANALYTICS",
      title: "分析メニュー",
      text: "結果を見る目的ごとに、ランキングと会場分析を分けています。",
      cards: [
        hubCardV34("ranking", "順", "ランキング・成績詳細", "総合pt、素点pt、チップ、形式・レート別の成績を確認"),
        hubCardV34("venue-analysis", "場", "会場別集計", "会場ごとの対局数、場代、プレイヤー別成績を確認")
      ]
    },
    debt: {
      eyebrow: "SETTLEMENT",
      title: "精算メニュー",
      text: "借ptの残高確認、支払い記録、手動の横流しを管理します。",
      cards: [
        hubCardV34("debt-manage", "借", "借ptを管理", "未精算・完了・取消済みを確認し、支払い・横流しを記録"),
        hubCardV34("history", "歴", "精算済みの対局を探す", "対局履歴から日次精算、場代、送金ルートを確認")
      ]
    },
    settings: {
      eyebrow: "SETTINGS",
      title: "設定・管理メニュー",
      text: "設定項目を目的別に分け、普段使わない管理機能はここへまとめました。",
      cards: [
        hubCardV34("settings-group", "人", "グループ・メンバー", "表示名、招待コード、グループ名、参加メンバーと権限"),
        hubCardV34("settings-setup", "場", "会場・対局テンプレート", "会場の管理と、よく使う対局設定のテンプレート"),
        hubCardV34("settings-data", "保", "バックアップ・編集履歴", "CSV・JSON出力、JSON復元、操作の編集履歴"),
        hubCardV34("trash", "箱", "ゴミ箱", "削除した日次記録と取消済み借ptの復元・完全削除"),
        hubCardV34("feedback", "声", "意見・不具合報告", "機能要望、不具合、使いにくい点をグループ内で共有")
      ]
    }
  };

  const data = itemMap[area];
  if (!data) return;
  page.innerHTML = `
    <section class="navigation-hub-card">
      <div class="navigation-hub-heading">
        <div><p class="eyebrow">${data.eyebrow}</p><h2>${data.title}</h2></div>
        <span class="navigation-hub-group">${escapeHtml(groupName)}</span>
      </div>
      <p class="navigation-hub-description">${data.text}</p>
      <div class="hub-menu-list">${data.cards.join("")}</div>
    </section>
  `;
  page.querySelectorAll("[data-v34-feature]").forEach((button) => button.addEventListener("click", () => {
    void openNavigationFeatureV34(button.dataset.v34Feature);
  }));
  window.scrollTo(0, 0);
}

function mountViewContextV34(area, label, note = "") {
  const page = getPageWorkspace();
  page.querySelector(".navigation-context-bar")?.remove();
  const context = document.createElement("div");
  context.className = "navigation-context-bar";
  context.innerHTML = `
    <button type="button" class="navigation-context-back" data-v34-back-area="${area}">‹ ${escapeHtml(area === "settings" ? "設定メニュー" : area === "analytics" ? "分析メニュー" : area === "debt" ? "精算メニュー" : "対局メニュー")}</button>
    <div><span>${escapeHtml(area === "settings" ? "SETTINGS" : area === "analytics" ? "ANALYTICS" : area === "debt" ? "SETTLEMENT" : "MATCH")}</span><strong>${escapeHtml(label)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>
  `;
  page.prepend(context);
  context.querySelector("[data-v34-back-area]")?.addEventListener("click", () => renderNavigationHubV34(area));
}

function settingsSectionKeyV34(section) {
  if (section.classList.contains("match-template-settings-section") || section.classList.contains("venue-settings-section")) return "setup";
  if (section.classList.contains("data-export-section") || section.classList.contains("backup-restore-section") || section.classList.contains("activity-history-section")) return "data";
  const eyebrow = String(section.querySelector(".eyebrow")?.textContent || "").trim();
  if (["MY PROFILE", "INVITE", "GROUP", "MEMBERS", "GROUP SWITCH"].includes(eyebrow)) return "group";
  return "other";
}

function applySettingsFocusV34() {
  if (!settingsFocusV34) return;
  const page = getPageWorkspace();
  const card = page.querySelector(".settings-card");
  if (!card) return;
  const config = {
    group: { title: "グループ・メンバー", text: "表示名、招待、グループ情報、参加メンバーを管理します。" },
    setup: { title: "会場・対局テンプレート", text: "普段使う会場と対局条件を、グループで共通化します。" },
    data: { title: "バックアップ・編集履歴", text: "データの保全、復元、操作履歴の確認を行います。" }
  }[settingsFocusV34];
  if (!config) return;
  card.querySelectorAll(":scope > .settings-section").forEach((section) => {
    section.hidden = settingsSectionKeyV34(section) !== settingsFocusV34;
  });
  const heading = card.querySelector(":scope > .workspace-heading");
  if (heading) {
    const eyebrow = heading.querySelector(".eyebrow");
    const title = heading.querySelector("h2");
    const description = card.querySelector(":scope > .workspace-description");
    if (eyebrow) eyebrow.textContent = "SETTINGS";
    if (title) title.textContent = config.title;
    if (description) description.textContent = config.text;
  }
  mountViewContextV34("settings", config.title);
  setPrimaryNavActiveV34("settings");
}

const renderSettingsPageBeforeV34 = renderSettingsPage;
renderSettingsPage = function() {
  renderSettingsPageBeforeV34();
  applySettingsFocusV34();
};

async function openSettingsFeatureV34(focus) {
  settingsFocusV34 = focus;
  navigationHubV34 = "settings";
  await switchTabV33("settings");
  setPrimaryNavActiveV34("settings");
  window.scrollTo(0, 0);
}

async function openNavigationFeatureV34(feature) {
  settingsFocusV34 = "";
  if (feature === "game-session") {
    await switchTabV33("game");
    setPrimaryNavActiveV34("game");
    mountViewContextV34("game", "日次記録", "対局の作成・入力・精算");
  } else if (feature === "history") {
    await switchTabV33("history");
    setPrimaryNavActiveV34("game");
    mountViewContextV34("game", "対局履歴", "カレンダーと条件検索");
  } else if (feature === "ranking") {
    await switchTabV33("ranking");
    setPrimaryNavActiveV34("analytics");
    mountViewContextV34("analytics", "ランキング・成績詳細", "場代を除いたゲーム成績");
  } else if (feature === "venue-analysis") {
    await switchTabV33("ranking");
    setPrimaryNavActiveV34("analytics");
    mountViewContextV34("analytics", "会場別集計", "会場ごとの対局・場代・成績");
    requestAnimationFrame(() => document.querySelector(".venue-analysis-section")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  } else if (feature === "debt-manage") {
    await switchTabV33("debt");
    setPrimaryNavActiveV34("debt");
    mountViewContextV34("debt", "借ptを管理", "未精算・支払い・横流し");
  } else if (feature === "settings-group") {
    await openSettingsFeatureV34("group");
  } else if (feature === "settings-setup") {
    await openSettingsFeatureV34("setup");
  } else if (feature === "settings-data") {
    await openSettingsFeatureV34("data");
  } else if (feature === "trash") {
    await switchTabV33("trash");
    setPrimaryNavActiveV34("settings");
    mountViewContextV34("settings", "ゴミ箱", "削除済みの記録・借ptを復元");
  } else if (feature === "feedback") {
    await switchTabV33("feedback");
    setPrimaryNavActiveV34("settings");
    mountViewContextV34("settings", "意見・不具合報告", "要望と不具合をグループ内で共有");
  }
  window.scrollTo(0, 0);
}

const refreshCurrentViewFromRealtimeBeforeV34 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  if (String(currentTab || "").startsWith("hub-")) {
    if (!force && isRealtimeInputInProgress()) return;
    renderNavigationHubV34(String(currentTab).replace("hub-", ""));
    return;
  }
  const result = await refreshCurrentViewFromRealtimeBeforeV34(force);
  if (["history", "ranking", "debt", "trash", "feedback"].includes(currentTab)) {
    setPrimaryNavActiveV34(primaryAreaForV34(currentTab));
  }
  if (currentTab === "settings" && settingsFocusV34) applySettingsFocusV34();
  return result;
};

configurePrimaryNavigationV34();

/* v35: home dashboard / operational overview */
let homeDashboardStateV35 = {
  groupId: "",
  loading: false,
  loaded: false,
  error: "",
  sessions: [],
  openDebts: [],
  feedback: [],
  hanchanCounts: {}
};
let homeDashboardLoadTokenV35 = 0;

function resetHomeDashboardStateV35(groupId = "") {
  homeDashboardStateV35 = {
    groupId,
    loading: false,
    loaded: false,
    error: "",
    sessions: [],
    openDebts: [],
    feedback: [],
    hanchanCounts: {}
  };
}

function getHomeSessionStatusLabelV35(status) {
  return status === "open" ? "進行中" : status === "settled" ? "精算済み" : "記録";
}

function getHomeSessionMetaV35(session) {
  const hanchans = Number(homeDashboardStateV35.hanchanCounts[session.id] || 0);
  const pieces = [getModeLabel(session.game_mode), session.rate_label || "レート未設定"];
  if (hanchans > 0) pieces.push(`${hanchans}半荘`);
  return pieces.join(" ／ ");
}

function buildHomeDashboardV35() {
  const group = getActiveGroup();
  const state = homeDashboardStateV35;
  const sessions = state.sessions || [];
  const openSession = sessions.find((item) => item.status === "open") || null;
  const latestSession = sessions[0] || null;
  const unsettledDebt = (state.openDebts || []).reduce((sum, item) => sum + num(item.remaining_amount_pt), 0);
  const feedbackOpen = (state.feedback || []).filter((item) => ["open", "in_progress"].includes(item.status)).length;
  const settledCount = sessions.filter((item) => item.status === "settled").length;
  const recentSessions = sessions.slice(0, 3);

  const primaryCard = openSession
    ? `<section class="home-resume-card">
        <div class="home-resume-heading">
          <div><p class="eyebrow">IN PROGRESS</p><h2>進行中の対局があります</h2></div>
          <span class="home-live-badge">入力中</span>
        </div>
        <strong class="home-resume-date">${escapeHtml(formatDate(openSession.session_date))}</strong>
        <p>${escapeHtml(getHomeSessionMetaV35(openSession))}</p>
        <button type="button" class="home-primary-action" data-v35-open-session="${openSession.id}">対局入力へ戻る <span>›</span></button>
      </section>`
    : `<section class="home-resume-card home-resume-card-empty">
        <div class="home-resume-heading"><div><p class="eyebrow">NEXT MATCH</p><h2>次の麻雀会を記録</h2></div><span class="home-live-badge muted">準備完了</span></div>
        <p>対局形式、参加者、レートを設定して、その日の記録を開始します。</p>
        <button type="button" class="home-primary-action" data-v35-action="new-session">新しい対局を作成 <span>＋</span></button>
      </section>`;

  const recentMarkup = recentSessions.length
    ? recentSessions.map((session) => `
      <button type="button" class="home-recent-session" data-v35-open-session="${session.id}">
        <span class="home-session-status ${session.status === "open" ? "open" : "settled"}">${getHomeSessionStatusLabelV35(session.status)}</span>
        <span class="home-recent-session-main"><strong>${escapeHtml(formatDate(session.session_date))}</strong><small>${escapeHtml(getHomeSessionMetaV35(session))}</small></span>
        <span class="home-recent-arrow">›</span>
      </button>
    `).join("")
    : `<div class="home-empty-card"><strong>まだ対局記録がありません。</strong><span>最初の対局を作成すると、ここに直近の記録が表示されます。</span></div>`;

  return `
    <section class="home-dashboard">
      <section class="home-dashboard-header">
        <div><p class="eyebrow">HOME</p><h2>${escapeHtml(group.name)}</h2><p>今の状況と、よく使う操作をまとめています。</p></div>
        <button type="button" class="home-settings-link" data-v35-action="settings">設定</button>
      </section>

      ${primaryCard}

      <section class="home-summary-grid">
        <button type="button" class="home-summary-card" data-v35-action="history"><span>最近の対局</span><strong>${sessions.length}<small>日</small></strong><em>${latestSession ? `直近 ${formatDate(latestSession.session_date)}` : "まだ記録なし"}</em></button>
        <button type="button" class="home-summary-card" data-v35-action="debt"><span>未精算の借pt</span><strong>${formatPtPlain(unsettledDebt)}</strong><em>${state.openDebts.length ? `${state.openDebts.length}件の精算待ち` : "未精算なし"}</em></button>
        <button type="button" class="home-summary-card" data-v35-action="feedback"><span>未対応の意見</span><strong>${feedbackOpen}<small>件</small></strong><em>${feedbackOpen ? "確認・対応が必要" : "未対応なし"}</em></button>
        <button type="button" class="home-summary-card" data-v35-action="ranking"><span>精算済み対局</span><strong>${settledCount}<small>日</small></strong><em>成績・推移を確認</em></button>
      </section>

      <section class="home-action-panel">
        <div class="home-section-heading"><div><p class="eyebrow">QUICK ACTIONS</p><h3>よく使う操作</h3></div></div>
        <div class="home-action-grid">
          <button type="button" class="home-action-card primary" data-v35-action="new-session"><span>＋</span><strong>対局を作成</strong><small>新しい麻雀会を始める</small></button>
          <button type="button" class="home-action-card" data-v35-action="history"><span>歴</span><strong>対局履歴</strong><small>過去の記録を探す</small></button>
          <button type="button" class="home-action-card" data-v35-action="debt"><span>借</span><strong>借ptを確認</strong><small>支払い・受け取りを管理</small></button>
          <button type="button" class="home-action-card" data-v35-action="feedback"><span>声</span><strong>意見を送る</strong><small>要望・不具合を共有</small></button>
        </div>
      </section>

      <section class="home-recent-panel">
        <div class="home-section-heading"><div><p class="eyebrow">RECENT MATCHES</p><h3>最近の対局</h3></div><button type="button" class="home-text-action" data-v35-action="history">すべて見る</button></div>
        <div class="home-recent-list">${recentMarkup}</div>
      </section>
    </section>
  `;
}

function bindHomeDashboardEventsV35(workspace) {
  workspace.querySelectorAll("[data-v35-open-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.v35OpenSession;
      if (!id) return;
      activeMatchSessionId = id;
      localStorage.setItem("jakuroku-active-match-session-id", id);
      showCreateSession = false;
      await openNavigationFeatureV34("game-session");
    });
  });

  workspace.querySelectorAll("[data-v35-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.v35Action;
      if (action === "new-session") {
        showCreateSession = true;
        sessionDraft = createDefaultSessionDraft();
        await openNavigationFeatureV34("game-session");
      } else if (action === "history") {
        await openNavigationFeatureV34("history");
      } else if (action === "debt") {
        await openNavigationFeatureV34("debt-manage");
      } else if (action === "feedback") {
        await openNavigationFeatureV34("feedback");
      } else if (action === "ranking") {
        await openNavigationFeatureV34("ranking");
      } else if (action === "settings") {
        await openSettingsFeatureV34("group");
      }
    });
  });
}

function renderHomeDashboardV35() {
  const workspace = getGroupWorkspace();
  const group = getActiveGroup();
  if (!group || !currentSession) return;

  heroCard.hidden = true;
  roadmapSection.hidden = true;
  workspace.hidden = false;

  if (homeDashboardStateV35.groupId !== group.id) resetHomeDashboardStateV35(group.id);

  if (homeDashboardStateV35.loading) {
    workspace.innerHTML = `<section class="home-dashboard"><section class="home-dashboard-loading">ホームを読み込み中...</section></section>`;
    return;
  }

  if (homeDashboardStateV35.error) {
    workspace.innerHTML = `<section class="home-dashboard"><section class="home-dashboard-error"><p class="eyebrow">HOME</p><h2>ホームを読み込めませんでした</h2><p>${escapeHtml(homeDashboardStateV35.error)}</p><button type="button" class="primary-button" data-v35-retry-home>再読み込み</button></section></section>`;
    workspace.querySelector("[data-v35-retry-home]")?.addEventListener("click", () => { void loadHomeDashboardV35(true); });
    return;
  }

  if (!homeDashboardStateV35.loaded) {
    workspace.innerHTML = `<section class="home-dashboard"><section class="home-dashboard-loading">ホームを読み込み中...</section></section>`;
    void loadHomeDashboardV35();
    return;
  }

  workspace.innerHTML = buildHomeDashboardV35();
  bindHomeDashboardEventsV35(workspace);
}

async function loadHomeDashboardV35(force = false) {
  if (!currentSession || !activeGroupId) return;
  const groupId = activeGroupId;
  if (homeDashboardStateV35.groupId !== groupId) resetHomeDashboardStateV35(groupId);
  if (homeDashboardStateV35.loading && !force) return;

  const token = ++homeDashboardLoadTokenV35;
  homeDashboardStateV35.loading = true;
  homeDashboardStateV35.error = "";
  if (currentTab === "home") renderHomeDashboardV35();

  try {
    const [sessionsResult, debtsResult, feedbackResult] = await Promise.all([
      supabaseClient
        .from("match_sessions")
        .select("id, session_date, game_mode, rate_label, status, settled_at, created_at")
        .eq("group_id", groupId)
        .is("deleted_at", null)
        .order("session_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(12),
      supabaseClient
        .from("debt_records")
        .select("id, remaining_amount_pt")
        .eq("group_id", groupId)
        .eq("status", "open"),
      supabaseClient
        .from("group_feedback")
        .select("id, status")
        .eq("group_id", groupId)
    ]);

    if (sessionsResult.error) throw sessionsResult.error;
    if (token !== homeDashboardLoadTokenV35 || activeGroupId !== groupId) return;

    const sessions = sessionsResult.data || [];
    const sessionIds = sessions.map((item) => item.id);
    let hanchanCounts = {};
    if (sessionIds.length) {
      const hanchanResult = await supabaseClient
        .from("match_hanchans")
        .select("session_id")
        .in("session_id", sessionIds);
      if (!hanchanResult.error) {
        hanchanCounts = (hanchanResult.data || []).reduce((acc, item) => {
          acc[item.session_id] = (acc[item.session_id] || 0) + 1;
          return acc;
        }, {});
      }
    }

    if (token !== homeDashboardLoadTokenV35 || activeGroupId !== groupId) return;
    homeDashboardStateV35 = {
      groupId,
      loading: false,
      loaded: true,
      error: "",
      sessions,
      openDebts: debtsResult.error ? [] : (debtsResult.data || []),
      feedback: feedbackResult.error ? [] : (feedbackResult.data || []),
      hanchanCounts
    };
  } catch (error) {
    if (token !== homeDashboardLoadTokenV35 || activeGroupId !== groupId) return;
    homeDashboardStateV35.loading = false;
    homeDashboardStateV35.loaded = false;
    homeDashboardStateV35.error = error?.message || "通信状態を確認してください。";
  }

  if (currentTab === "home" && activeGroupId === groupId) renderHomeDashboardV35();
}

const renderGroupWorkspaceBeforeV35 = renderGroupWorkspace;
renderGroupWorkspace = function() {
  if (!currentSession || !getActiveGroup()) {
    return renderGroupWorkspaceBeforeV35();
  }
  renderHomeDashboardV35();
};

const switchTabBeforeV35 = switchTab;
switchTab = async function(tab) {
  const result = await switchTabBeforeV35(tab);
  if (tab === "home") {
    navigationHubV34 = "";
    settingsFocusV34 = "";
    setPrimaryNavActiveV34("home");
    renderHomeDashboardV35();
  }
  return result;
};

const refreshCurrentViewFromRealtimeBeforeV35 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  if (currentTab === "home") {
    if (!force && isRealtimeInputInProgress()) return;
    await loadHomeDashboardV35(true);
    return;
  }
  return refreshCurrentViewFromRealtimeBeforeV35(force);
};

const updateAuthUIBeforeV35 = updateAuthUI;
updateAuthUI = async function(session) {
  if (!session) resetHomeDashboardStateV35();
  await updateAuthUIBeforeV35(session);
};

/* v36: match dashboard / operational match hub */
let matchDashboardStateV36 = {
  groupId: "",
  loading: false,
  loaded: false,
  error: "",
  sessions: [],
  hanchanCounts: {}
};
let matchDashboardLoadTokenV36 = 0;

function resetMatchDashboardStateV36(groupId = "") {
  matchDashboardStateV36 = {
    groupId,
    loading: false,
    loaded: false,
    error: "",
    sessions: [],
    hanchanCounts: {}
  };
}

function getMatchDashboardMetaV36(session) {
  const hanchans = Number(matchDashboardStateV36.hanchanCounts[session.id] || 0);
  const items = [getModeLabel(session.game_mode), session.rate_label || "レート未設定"];
  if (hanchans > 0) items.push(`${hanchans}半荘`);
  return items.join(" ／ ");
}

function getMatchDashboardStatusV36(status) {
  if (status === "open") return "入力中";
  if (status === "settled") return "精算済み";
  return "記録";
}

function buildMatchDashboardV36() {
  const sessions = matchDashboardStateV36.sessions || [];
  const openSession = sessions.find((item) => item.status === "open") || null;
  const recentSessions = sessions.slice(0, 4);
  const settledCount = sessions.filter((item) => item.status === "settled").length;
  const weekBoundary = new Date();
  weekBoundary.setHours(0, 0, 0, 0);
  weekBoundary.setDate(weekBoundary.getDate() - 6);
  const recentWeekCount = sessions.filter((item) => {
    const date = new Date(`${item.session_date}T00:00:00`);
    return !Number.isNaN(date.valueOf()) && date >= weekBoundary;
  }).length;

  const primaryMarkup = openSession
    ? `<section class="match-dashboard-primary is-open">
        <div class="match-dashboard-primary-heading">
          <div><p class="eyebrow">IN PROGRESS</p><h2>進行中の対局</h2></div>
          <span class="match-dashboard-live">入力中</span>
        </div>
        <strong>${escapeHtml(formatDate(openSession.session_date))}</strong>
        <p>${escapeHtml(getMatchDashboardMetaV36(openSession))}</p>
        <button type="button" class="match-dashboard-primary-action" data-v36-open-session="${openSession.id}">入力を再開する <span>›</span></button>
      </section>`
    : `<section class="match-dashboard-primary">
        <div class="match-dashboard-primary-heading">
          <div><p class="eyebrow">NEW MATCH</p><h2>次の対局を記録</h2></div>
          <span class="match-dashboard-ready">準備完了</span>
        </div>
        <p>形式・参加者・レートを選び、その日の麻雀会を開始します。</p>
        <button type="button" class="match-dashboard-primary-action" data-v36-action="new-session">新しい対局を作成 <span>＋</span></button>
      </section>`;

  const recentMarkup = recentSessions.length
    ? recentSessions.map((session) => `
      <button type="button" class="match-dashboard-recent-row" data-v36-open-session="${session.id}">
        <span class="match-dashboard-row-status ${session.status === "open" ? "open" : "settled"}">${getMatchDashboardStatusV36(session.status)}</span>
        <span class="match-dashboard-row-main"><strong>${escapeHtml(formatDate(session.session_date))}</strong><small>${escapeHtml(getMatchDashboardMetaV36(session))}</small></span>
        <span class="match-dashboard-row-arrow">›</span>
      </button>
    `).join("")
    : `<div class="match-dashboard-empty"><strong>まだ対局記録がありません。</strong><span>最初の対局を作成すると、ここに最近の記録が表示されます。</span></div>`;

  return `
    <section class="match-dashboard">
      <header class="match-dashboard-header">
        <div><p class="eyebrow">MATCH</p><h2>対局</h2><p>今日の入力、過去記録、対局の開始をここから行います。</p></div>
        <span class="match-dashboard-group">${escapeHtml(getActiveGroup()?.name || "")}</span>
      </header>

      ${primaryMarkup}

      <section class="match-dashboard-stats" aria-label="対局の状況">
        <button type="button" class="match-dashboard-stat" data-v36-action="history"><span>最近7日</span><strong>${recentWeekCount}<small>日</small></strong><em>記録を確認</em></button>
        <button type="button" class="match-dashboard-stat" data-v36-action="history"><span>精算済み</span><strong>${settledCount}<small>日</small></strong><em>履歴から探す</em></button>
        <button type="button" class="match-dashboard-stat" data-v36-action="history"><span>全対局</span><strong>${sessions.length}<small>日</small></strong><em>カレンダーで見る</em></button>
      </section>

      <section class="match-dashboard-command-panel">
        <div class="match-dashboard-section-heading"><div><p class="eyebrow">START HERE</p><h3>目的から選ぶ</h3></div></div>
        <div class="match-dashboard-command-grid">
          <button type="button" class="match-dashboard-command primary" data-v36-action="new-session"><span>＋</span><strong>対局を作成</strong><small>新しい麻雀会を開始</small></button>
          <button type="button" class="match-dashboard-command" data-v36-action="history"><span>歴</span><strong>対局履歴</strong><small>カレンダー・条件検索</small></button>
          <button type="button" class="match-dashboard-command" data-v36-action="open-current"><span>入</span><strong>${openSession ? "入力を再開" : "直近記録を開く"}</strong><small>${openSession ? "進行中の対局へ戻る" : "最近の対局を確認"}</small></button>
        </div>
      </section>

      <section class="match-dashboard-recent-panel">
        <div class="match-dashboard-section-heading"><div><p class="eyebrow">RECENT</p><h3>最近の対局</h3></div><button type="button" class="match-dashboard-text-action" data-v36-action="history">すべて見る</button></div>
        <div class="match-dashboard-recent-list">${recentMarkup}</div>
      </section>
    </section>
  `;
}

function bindMatchDashboardEventsV36(workspace) {
  workspace.querySelectorAll("[data-v36-open-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sessionId = button.dataset.v36OpenSession;
      if (!sessionId) return;
      activeMatchSessionId = sessionId;
      localStorage.setItem("jakuroku-active-match-session-id", sessionId);
      showCreateSession = false;
      await openNavigationFeatureV34("game-session");
    });
  });

  workspace.querySelectorAll("[data-v36-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.v36Action;
      if (action === "new-session") {
        showCreateSession = true;
        sessionDraft = createDefaultSessionDraft();
        await openNavigationFeatureV34("game-session");
        return;
      }
      if (action === "history") {
        await openNavigationFeatureV34("history");
        return;
      }
      if (action === "open-current") {
        const target = matchDashboardStateV36.sessions.find((item) => item.status === "open") || matchDashboardStateV36.sessions[0];
        if (!target) {
          showCreateSession = true;
          sessionDraft = createDefaultSessionDraft();
        } else {
          activeMatchSessionId = target.id;
          localStorage.setItem("jakuroku-active-match-session-id", target.id);
          showCreateSession = false;
        }
        await openNavigationFeatureV34("game-session");
      }
    });
  });
}

function renderMatchDashboardV36() {
  const page = getPageWorkspace();
  if (!currentSession) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MATCH</p><h2>ログインが必要です</h2><button type="button" class="primary-button" data-v36-home>ホームへ戻る</button></section>`;
    page.querySelector("[data-v36-home]")?.addEventListener("click", () => void switchTab("home"));
    return;
  }
  if (!getActiveGroup()) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MATCH</p><h2>先にグループを作成してください</h2><button type="button" class="primary-button" data-v36-home>ホームへ戻る</button></section>`;
    page.querySelector("[data-v36-home]")?.addEventListener("click", () => void switchTab("home"));
    return;
  }

  navigationHubV34 = "game";
  settingsFocusV34 = "";
  currentTab = "hub-game";
  setPrimaryNavActiveV34("game");
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  page.hidden = false;

  if (matchDashboardStateV36.groupId !== activeGroupId) resetMatchDashboardStateV36(activeGroupId);

  if (matchDashboardStateV36.error) {
    page.innerHTML = `<section class="match-dashboard"><section class="match-dashboard-error"><p class="eyebrow">MATCH</p><h2>対局を読み込めませんでした</h2><p>${escapeHtml(matchDashboardStateV36.error)}</p><button type="button" class="primary-button" data-v36-retry>再読み込み</button></section></section>`;
    page.querySelector("[data-v36-retry]")?.addEventListener("click", () => void loadMatchDashboardV36(true));
    return;
  }

  if (matchDashboardStateV36.loading || !matchDashboardStateV36.loaded) {
    page.innerHTML = `<section class="match-dashboard"><section class="match-dashboard-loading">対局の状況を読み込み中...</section></section>`;
    void loadMatchDashboardV36();
    return;
  }

  page.innerHTML = buildMatchDashboardV36();
  bindMatchDashboardEventsV36(page);
  window.scrollTo(0, 0);
}

async function loadMatchDashboardV36(force = false) {
  if (!currentSession || !activeGroupId || !supabaseClient) return;
  const groupId = activeGroupId;
  if (matchDashboardStateV36.groupId !== groupId) resetMatchDashboardStateV36(groupId);
  if (matchDashboardStateV36.loading && !force) return;

  const token = ++matchDashboardLoadTokenV36;
  matchDashboardStateV36.loading = true;
  matchDashboardStateV36.error = "";
  if (currentTab === "hub-game") renderMatchDashboardV36();

  try {
    const { data: sessions, error } = await supabaseClient
      .from("match_sessions")
      .select("id, session_date, game_mode, rate_label, status, created_at")
      .eq("group_id", groupId)
      .is("deleted_at", null)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw error;
    if (token !== matchDashboardLoadTokenV36 || activeGroupId !== groupId) return;

    const sessionRows = sessions || [];
    const sessionIds = sessionRows.map((item) => item.id);
    let hanchanCounts = {};
    if (sessionIds.length) {
      const { data: hanchans, error: hanchansError } = await supabaseClient
        .from("match_hanchans")
        .select("session_id")
        .in("session_id", sessionIds);
      if (!hanchansError) {
        hanchanCounts = (hanchans || []).reduce((acc, item) => {
          acc[item.session_id] = (acc[item.session_id] || 0) + 1;
          return acc;
        }, {});
      }
    }
    if (token !== matchDashboardLoadTokenV36 || activeGroupId !== groupId) return;
    matchDashboardStateV36 = {
      groupId,
      loading: false,
      loaded: true,
      error: "",
      sessions: sessionRows,
      hanchanCounts
    };
  } catch (error) {
    if (token !== matchDashboardLoadTokenV36 || activeGroupId !== groupId) return;
    matchDashboardStateV36.loading = false;
    matchDashboardStateV36.loaded = false;
    matchDashboardStateV36.error = error?.message || "通信状態を確認してください。";
  }

  if (currentTab === "hub-game" && activeGroupId === groupId) renderMatchDashboardV36();
}

const renderNavigationHubBeforeV36 = renderNavigationHubV34;
renderNavigationHubV34 = function(area) {
  if (area === "game") {
    renderMatchDashboardV36();
    return;
  }
  return renderNavigationHubBeforeV36(area);
};

const refreshCurrentViewFromRealtimeBeforeV36 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  if (currentTab === "hub-game") {
    if (!force && isRealtimeInputInProgress()) return;
    await loadMatchDashboardV36(true);
    return;
  }
  return refreshCurrentViewFromRealtimeBeforeV36(force);
};

const switchActiveGroupBeforeV36 = switchActiveGroup;
switchActiveGroup = async function(groupId) {
  resetMatchDashboardStateV36();
  return switchActiveGroupBeforeV36(groupId);
};

const updateAuthUIBeforeV36 = updateAuthUI;
updateAuthUI = async function(session) {
  if (!session) resetMatchDashboardStateV36();
  await updateAuthUIBeforeV36(session);
};

/* v37: bottom navigation visual refresh */
function navIconV37(name) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
  const icons = {
    home: `<svg ${common}><path d="M3.5 10.7 12 3.8l8.5 6.9v9.1a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2v-9.1Z"></path><path d="M9 21v-6.3h6V21"></path></svg>`,
    match: `<svg ${common}><rect x="3.2" y="5.1" width="8.2" height="13.8" rx="1.4"></rect><rect x="12.6" y="5.1" width="8.2" height="13.8" rx="1.4"></rect><path d="M5.9 8.1h2.8M5.9 11.1h2.8M5.9 14.1h2.8M15.3 8.1h2.8M15.3 11.1h2.8M15.3 14.1h2.8"></path></svg>`,
    analytics: `<svg ${common}><path d="M4 19.5h16"></path><path d="M5.3 16.7 10 12l3.2 2.7 5.5-7"></path><path d="M15.8 7.7h2.9v2.9"></path></svg>`,
    settle: `<svg ${common}><path d="M4 7.5h12.5"></path><path d="m13.4 4.5 3 3-3 3"></path><path d="M20 16.5H7.5"></path><path d="m10.6 19.5-3-3 3-3"></path><circle cx="6" cy="7.5" r="1.25"></circle><circle cx="18" cy="16.5" r="1.25"></circle></svg>`,
    settings: `<svg ${common}><circle cx="12" cy="12" r="3.1"></circle><path d="M19.1 13.6c.1-.5.1-1 .1-1.6s0-1.1-.1-1.6l2-1.5-2-3.4-2.4 1a7.9 7.9 0 0 0-2.7-1.6L13.6 2h-3.9L9.3 4.9a7.9 7.9 0 0 0-2.7 1.6l-2.4-1-2 3.4 2 1.5c-.1.5-.1 1-.1 1.6s0 1.1.1 1.6l-2 1.5 2 3.4 2.4-1a7.9 7.9 0 0 0 2.7 1.6l.4 2.9h3.9l.4-2.9a7.9 7.9 0 0 0 2.7-1.6l2.4 1 2-3.4-2-1.5Z"></path></svg>`
  };
  return icons[name] || icons.home;
}

const PRIMARY_NAV_V37 = [
  { id: "home", icon: "home", label: "ホーム" },
  { id: "game", icon: "match", label: "対局" },
  { id: "analytics", icon: "analytics", label: "分析" },
  { id: "debt", icon: "settle", label: "精算" },
  { id: "settings", icon: "settings", label: "設定" }
];

function configurePrimaryNavigationV37() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav) return;
  nav.innerHTML = PRIMARY_NAV_V37.map((item) => `
    <button type="button" class="nav-item nav-item-v37" data-tab="${item.id}" aria-label="${item.label}">
      <span class="nav-icon-v37">${navIconV37(item.icon)}</span>
      <small>${item.label}</small>
    </button>
  `).join("");
  navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => item.addEventListener("click", () => {
    const area = item.dataset.tab;
    if (area === "home") {
      settingsFocusV34 = "";
      navigationHubV34 = "";
      void switchTabV33("home");
      return;
    }
    renderNavigationHubV34(area);
  }));
  setPrimaryNavActiveV34(primaryAreaForV34());
}

const setPrimaryNavActiveBeforeV37 = setPrimaryNavActiveV34;
setPrimaryNavActiveV34 = function(area) {
  setPrimaryNavActiveBeforeV37(area);
  navItems.forEach((item) => {
    const isActive = item.dataset.tab === area;
    item.setAttribute("aria-current", isActive ? "page" : "false");
  });
};

configurePrimaryNavigationV37();


/* v40: guided session creation wizard */
let createSessionStepV40 = 0;
const CREATE_SESSION_STEPS_V40 = [
  { label: "形式", detail: "対局形式" },
  { label: "設定", detail: "日付・レート・会場" },
  { label: "参加者", detail: "ウマ・参加者" },
  { label: "確認", detail: "メモ・開始" }
];

function clampCreateSessionStepV40(value) {
  return Math.max(0, Math.min(CREATE_SESSION_STEPS_V40.length - 1, Number(value) || 0));
}

function getCreateSessionWizardSectionsV40(form) {
  const mode = form.querySelector(".mode-preset-grid")?.closest(".game-section");
  const basic = form.querySelector(".game-settings-grid")?.closest(".game-section");
  const uma = form.querySelector(".uma-grid")?.closest(".game-section");
  const members = form.querySelector(".game-member-grid")?.closest(".game-section");
  const venue = form.querySelector(".session-venue-create-section");
  const notes = form.querySelector("textarea[data-session-field='notes']")?.closest(".game-section");
  return [
    [mode].filter(Boolean),
    [basic, venue].filter(Boolean),
    [uma, members].filter(Boolean),
    [notes].filter(Boolean)
  ];
}

function validateCreateSessionStepV40(step) {
  const preset = getModePreset(sessionDraft.gameMode);
  if (step === 0 && !sessionDraft.gameMode) return "対局形式を選択してください。";
  if (step === 1) {
    if (!sessionDraft.sessionDate) return "日付を入力してください。";
    if (sessionDraft.startingPoints <= 0 || sessionDraft.chipValue < 0 || sessionDraft.rateMultiplier <= 0 || sessionDraft.rateMultiplier > 10000) {
      return "初期持ち点・チップ単価・レート倍率を確認してください。";
    }
    if (sessionDraft.rateLabel === "カスタム" && !String(sessionDraft.customRateLabel || "").trim()) return "カスタム名を入力してください。";
  }
  if (step === 2 && sessionDraft.memberIds.length !== preset.playerCount) return `参加者を${preset.playerCount}人選択してください。`;
  return "";
}

function renderCreateSessionWizardV40() {
  const form = document.getElementById("createSessionForm");
  if (!form || form.dataset.v40WizardReady === "1") return;
  form.dataset.v40WizardReady = "1";
  createSessionStepV40 = clampCreateSessionStepV40(createSessionStepV40);
  const groups = getCreateSessionWizardSectionsV40(form);
  groups.flat().forEach((section) => section.classList.add("create-wizard-section-v40"));

  const heading = form.closest(".game-card")?.querySelector(".game-card-heading");
  const intro = form.closest(".game-card")?.querySelector(".game-description");
  const progress = document.createElement("nav");
  progress.className = "create-wizard-progress-v40";
  progress.setAttribute("aria-label", "対局作成の進行状況");
  progress.innerHTML = CREATE_SESSION_STEPS_V40.map((item, index) => `
    <button type="button" class="create-wizard-progress-item-v40" data-v40-go-step="${index}" aria-label="${index + 1} ${escapeHtml(item.detail)}">
      <span>${index + 1}</span><small>${escapeHtml(item.label)}</small>
    </button>
  `).join("");
  if (intro) intro.insertAdjacentElement("afterend", progress);
  else if (heading) heading.insertAdjacentElement("afterend", progress);
  else form.insertAdjacentElement("beforebegin", progress);

  const controls = document.createElement("div");
  controls.className = "create-wizard-controls-v40";
  controls.innerHTML = `
    <button type="button" class="create-wizard-back-v40" data-v40-back>戻る</button>
    <div class="create-wizard-controls-copy-v40"><small data-v40-step-count></small><strong data-v40-step-title></strong></div>
    <button type="button" class="create-wizard-next-v40" data-v40-next>次へ</button>
  `;
  form.appendChild(controls);

  const update = () => {
    const step = clampCreateSessionStepV40(createSessionStepV40);
    createSessionStepV40 = step;
    groups.forEach((sectionGroup, index) => {
      sectionGroup.forEach((section) => {
        section.hidden = index !== step;
        section.classList.toggle("is-wizard-active-v40", index === step);
      });
    });
    progress.querySelectorAll("[data-v40-go-step]").forEach((button) => {
      const index = Number(button.dataset.v40GoStep);
      button.classList.toggle("active", index === step);
      button.classList.toggle("done", index < step);
      button.disabled = index > step;
    });
    controls.querySelector("[data-v40-back]").hidden = step === 0;
    controls.querySelector("[data-v40-step-count]").textContent = `STEP ${step + 1} / ${CREATE_SESSION_STEPS_V40.length}`;
    controls.querySelector("[data-v40-step-title]").textContent = CREATE_SESSION_STEPS_V40[step].detail;
    const next = controls.querySelector("[data-v40-next]");
    const submit = document.getElementById("createSessionButton");
    if (submit) submit.hidden = step !== CREATE_SESSION_STEPS_V40.length - 1;
    next.hidden = step === CREATE_SESSION_STEPS_V40.length - 1;
    const message = document.getElementById("createSessionMessage");
    if (message && step !== CREATE_SESSION_STEPS_V40.length - 1) message.textContent = "";
    if (!globalThis.__morikenCreateScrollRestoreV43) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  controls.querySelector("[data-v40-back]").addEventListener("click", () => {
    createSessionStepV40 -= 1;
    update();
  });
  controls.querySelector("[data-v40-next]").addEventListener("click", () => {
    const error = validateCreateSessionStepV40(createSessionStepV40);
    if (error) {
      const message = document.getElementById("createSessionMessage");
      if (message) message.textContent = error;
      return;
    }
    createSessionStepV40 += 1;
    update();
  });
  progress.querySelectorAll("[data-v40-go-step]").forEach((button) => button.addEventListener("click", () => {
    const target = Number(button.dataset.v40GoStep);
    if (target > createSessionStepV40) return;
    createSessionStepV40 = target;
    update();
  }));
  form.addEventListener("input", () => {
    const message = document.getElementById("createSessionMessage");
    if (message) message.textContent = "";
  });
  update();
}

const renderCreateSessionViewBeforeV40 = renderCreateSessionView;
renderCreateSessionView = function() {
  renderCreateSessionViewBeforeV40();
  renderCreateSessionWizardV40();
};

const createMatchSessionBeforeV40 = createMatchSession;
createMatchSession = async function(event) {
  const error = validateCreateSessionStepV40(2);
  if (error) {
    event?.preventDefault?.();
    const message = document.getElementById("createSessionMessage");
    if (message) message.textContent = error;
    createSessionStepV40 = error.includes("参加者") ? 2 : 1;
    renderCreateSessionView();
    return;
  }
  return createMatchSessionBeforeV40(event);
};

/* v41: grouped operational UI refinements */
function buildAnalyticsDashboardV41() {
  const page = getPageWorkspace();
  navigationHubV34 = "analytics";
  currentTab = "hub-analytics";
  setPrimaryNavActiveV34("analytics");
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  page.hidden = false;

  const settled = sessionList.filter((session) => session.status === "settled");
  const recent = settled.slice(0, 4);
  const recentMarkup = recent.length ? recent.map((session) => `
    <button type="button" class="v41-mini-session" data-v41-open-history="${session.id}">
      <span>${escapeHtml(formatDate(session.session_date))}</span>
      <strong>${escapeHtml(getModeLabel(session.game_mode))}</strong>
      <small>${escapeHtml(session.rate_label || "レート未設定")}</small>
      <b>›</b>
    </button>
  `).join("") : `<div class="v41-empty-inline"><strong>精算済みの対局がありません。</strong><span>日次精算を確定すると、ランキングと分析が表示されます。</span><button type="button" data-v41-go-game>対局を作成</button></div>`;

  page.innerHTML = `
    <section class="v41-dashboard v41-analytics-dashboard">
      <header class="v41-dashboard-heading">
        <div><p class="eyebrow">ANALYTICS</p><h2>成績を確認</h2><p>まず全体像を見て、必要な分析へ進みます。</p></div>
        <span class="v41-dashboard-badge">精算済み ${settled.length}日</span>
      </header>
      <section class="v41-feature-hero">
        <div><span class="v41-feature-icon">↗</span><p>RANKING</p><h3>ランキング・成績詳細</h3><small>総合pt、素点pt、チップ、形式別・レート別の成績を確認します。</small></div>
        <button type="button" data-v41-go-ranking>ランキングを見る</button>
      </section>
      <section class="v41-dashboard-grid">
        <button type="button" class="v41-dashboard-tile" data-v41-go-ranking><span>☷</span><strong>総合ランキング</strong><small>期間・形式・レートで絞り込み</small></button>
        <button type="button" class="v41-dashboard-tile" data-v41-go-venue><span>⌂</span><strong>会場別集計</strong><small>会場ごとの対局数・場代・成績</small></button>
      </section>
      <section class="v41-recent-section"><div class="v41-section-heading"><div><p class="eyebrow">RECENT SETTLEMENTS</p><h3>最近精算した対局</h3></div><button type="button" data-v41-go-history>履歴を見る</button></div><div class="v41-mini-session-list">${recentMarkup}</div></section>
    </section>
  `;
  page.querySelector("[data-v41-go-ranking]")?.addEventListener("click", () => void openNavigationFeatureV34("ranking"));
  page.querySelector("[data-v41-go-venue]")?.addEventListener("click", () => void openNavigationFeatureV34("venue-analysis"));
  page.querySelector("[data-v41-go-history]")?.addEventListener("click", () => void openNavigationFeatureV34("history"));
  page.querySelector("[data-v41-go-game]")?.addEventListener("click", () => void openNavigationFeatureV34("game-session"));
  page.querySelectorAll("[data-v41-open-history]").forEach((button) => button.addEventListener("click", async () => {
    activeMatchSessionId = button.dataset.v41OpenHistory;
    localStorage.setItem("jakuroku-active-match-session-id", activeMatchSessionId);
    await openNavigationFeatureV34("game-session");
  }));
  window.scrollTo(0, 0);
}

function buildSettlementDashboardV41() {
  const page = getPageWorkspace();
  navigationHubV34 = "debt";
  currentTab = "hub-debt";
  setPrimaryNavActiveV34("debt");
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  page.hidden = false;

  const open = debtRecords.filter((record) => record.status === "open" && num(record.remaining_amount_pt) > 0.004);
  const total = open.reduce((sum, record) => sum + num(record.remaining_amount_pt), 0);
  page.innerHTML = `
    <section class="v41-dashboard v41-settlement-dashboard">
      <header class="v41-dashboard-heading">
        <div><p class="eyebrow">SETTLEMENT</p><h2>精算を管理</h2><p>未精算の借ptと、精算済み対局の送金内容を確認します。</p></div>
        <span class="v41-dashboard-badge">未精算 ${open.length}件</span>
      </header>
      <section class="v41-feature-hero v41-settlement-hero">
        <div><span class="v41-feature-icon">⇄</span><p>OPEN BALANCE</p><h3>${formatPtPlain(total)}</h3><small>${open.length ? "未精算の借ptがあります。支払い記録・横流しを管理できます。" : "未精算の借ptはありません。"}</small></div>
        <button type="button" data-v41-go-debt>借ptを管理</button>
      </section>
      <section class="v41-dashboard-grid">
        <button type="button" class="v41-dashboard-tile" data-v41-go-debt><span>⇄</span><strong>借pt一覧</strong><small>支払い・一部支払い・横流し</small></button>
        <button type="button" class="v41-dashboard-tile" data-v41-go-history><span>▣</span><strong>日次精算を確認</strong><small>過去対局の場代・送金ルート</small></button>
      </section>
      <section class="v41-operation-note"><strong>使い方</strong><span>対局を精算確定すると送金ルートが表示されます。必要なものだけ「借ptへ登録」で残してください。</span></section>
    </section>
  `;
  page.querySelector("[data-v41-go-debt]")?.addEventListener("click", () => void openNavigationFeatureV34("debt-manage"));
  page.querySelector("[data-v41-go-history]")?.addEventListener("click", () => void openNavigationFeatureV34("history"));
  window.scrollTo(0, 0);
}

const renderNavigationHubBeforeV41 = renderNavigationHubV34;
renderNavigationHubV34 = function(area) {
  if (area === "analytics") return buildAnalyticsDashboardV41();
  if (area === "debt") return buildSettlementDashboardV41();
  return renderNavigationHubBeforeV41(area);
};

function getSectionTitleV41(section) {
  return String(section.querySelector(".game-section-title")?.textContent || "").trim();
}

function mountSessionFlowV41() {
  const page = getPageWorkspace();
  const gameCard = page.querySelector(".game-card");
  const session = activeMatchSession;
  if (!gameCard || !session || gameCard.querySelector(".session-flow-v41")) return;

  const titleToKey = {
    "半荘記録": "hanchan",
    "終了時チップ": "chips",
    "場代精算": "venue",
    "場代込み最終精算": "settlement"
  };
  gameCard.querySelectorAll(":scope > .game-section").forEach((section) => {
    const key = titleToKey[getSectionTitleV41(section)];
    if (key) section.dataset.v41FlowSection = key;
  });
  const firstSection = gameCard.querySelector("[data-v41-flow-section='hanchan']");
  const flow = document.createElement("section");
  flow.className = "session-flow-v41";
  const completed = {
    hanchan: activeHanchans.length > 0,
    chips: hasAllChips(),
    venue: hasMatchingVenuePrepayments(),
    settlement: session.status === "settled"
  };
  const steps = [
    ["hanchan", "1", "半荘入力", activeHanchans.length ? `${activeHanchans.length}半荘` : "未入力"],
    ["chips", "2", "チップ", completed.chips ? "入力済み" : "未入力"],
    ["venue", "3", "場代", completed.venue ? "照合済み" : "確認待ち"],
    ["settlement", "4", "精算", completed.settlement ? "確定済み" : "未確定"]
  ];
  flow.innerHTML = `
    <div class="session-flow-heading-v41"><div><p class="eyebrow">SESSION FLOW</p><h3>${session.status === "settled" ? "この日の精算結果" : "この日の入力・精算手順"}</h3></div><small>${session.status === "settled" ? "記録は編集できます" : "上から順に確認すると漏れません"}</small></div>
    <div class="session-flow-steps-v41">${steps.map(([key, number, label, state]) => `<button type="button" class="session-flow-step-v41 ${completed[key] ? "complete" : ""}" data-v41-flow-go="${key}"><span>${completed[key] ? "✓" : number}</span><strong>${label}</strong><small>${state}</small></button>`).join("")}</div>
  `;
  (firstSection || gameCard.querySelector(".session-info-grid"))?.insertAdjacentElement("afterend", flow);
  flow.querySelectorAll("[data-v41-flow-go]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.v41FlowGo;
    const target = gameCard.querySelector(`[data-v41-flow-section='${key}']`);
    if (!target) return;
    if (key === "hanchan" && !showHanchanEditor && session.status === "open") document.getElementById("toggleHanchanEditorButton")?.click();
    if (key === "chips" && !showChipEditor) document.getElementById("toggleChipEditorButton")?.click();
    if (key === "venue" && !showVenueEditor) document.getElementById("toggleVenueEditorButton")?.click();
    requestAnimationFrame(() => (gameCard.querySelector(`[data-v41-flow-section='${key}']`) || target).scrollIntoView({ behavior: "smooth", block: "start" }));
  }));
}

const renderActiveSessionViewBeforeV41 = renderActiveSessionView;
renderActiveSessionView = function() {
  renderActiveSessionViewBeforeV41();
  mountSessionFlowV41();
};

function addEmptyStateActionsV41() {
  document.querySelectorAll(".game-empty-result, .ranking-empty-card, .home-empty-card, .v41-empty-inline").forEach((element) => {
    element.classList.add("empty-state-v41");
  });
}
const renderMatchPageBeforeV41 = renderMatchPage;
renderMatchPage = function() {
  renderMatchPageBeforeV41();
  addEmptyStateActionsV41();
};

/* v42: settings hierarchy and mobile reading refinements */
function buildSettingsDashboardV42() {
  const page = getPageWorkspace();
  if (!currentSession || !getActiveGroup()) {
    return renderNavigationHubBeforeV41("settings");
  }

  navigationHubV34 = "settings";
  settingsFocusV34 = "";
  currentTab = "hub-settings";
  setPrimaryNavActiveV34("settings");
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  page.hidden = false;

  const admin = isActiveGroupAdmin();
  const unresolvedFeedback = Array.isArray(feedbackItems)
    ? feedbackItems.filter((item) => ["open", "in_progress"].includes(item.status)).length
    : 0;
  const openDebtCount = Array.isArray(debtRecords)
    ? debtRecords.filter((item) => item.status === "open" && num(item.remaining_amount_pt) > 0.004).length
    : 0;

  const groupCards = [
    hubCardV34("settings-group", "人", "グループ・メンバー", "表示名、招待コード、グループ名、参加メンバーと権限"),
    hubCardV34("settings-setup", "場", "会場・対局テンプレート", "会場の管理と、よく使う対局条件の登録")
  ].join("");
  const dataCards = [
    hubCardV34("settings-data", "保", "バックアップ・編集履歴", "CSV・JSON出力、JSON復元、操作履歴の確認")
  ].join("");
  const operationCards = [
    hubCardV34("feedback", "声", "意見・不具合報告", "機能要望、不具合、使いにくい点をグループ内で共有", unresolvedFeedback ? `未対応 ${unresolvedFeedback}件` : "未対応なし"),
    hubCardV34("trash", "箱", "ゴミ箱", "削除した日次記録と取消済み借ptの復元・完全削除")
  ].join("");

  page.innerHTML = `
    <section class="v42-settings-dashboard">
      <header class="v42-settings-heading">
        <div><p class="eyebrow">SETTINGS</p><h2>設定・管理</h2><p>普段使う設定、データ保全、運用ツールを目的別に分けています。</p></div>
        <span class="v42-role-badge">${admin ? "管理者" : "メンバー"}</span>
      </header>
      <section class="v42-settings-summary">
        <div><span>グループ</span><strong>${escapeHtml(getActiveGroup().name)}</strong></div>
        <div><span>未精算借pt</span><strong>${openDebtCount}件</strong></div>
        <button type="button" data-v42-go-feedback><span>未対応の意見</span><strong>${unresolvedFeedback}件</strong><b>›</b></button>
      </section>
      <section class="v42-settings-category">
        <div class="v42-category-heading"><p class="eyebrow">DAILY SETTINGS</p><h3>普段使う</h3><small>参加・会場・対局条件の管理</small></div>
        <div class="hub-menu-list">${groupCards}</div>
      </section>
      <section class="v42-settings-category">
        <div class="v42-category-heading"><p class="eyebrow">DATA MANAGEMENT</p><h3>データ管理</h3><small>バックアップ、復元、履歴の確認</small></div>
        <div class="hub-menu-list">${dataCards}</div>
      </section>
      <section class="v42-settings-category v42-management-category">
        <div class="v42-category-heading"><p class="eyebrow">OPERATIONS</p><h3>運用・その他</h3><small>実運用中の要望確認と削除済みデータの管理</small></div>
        <div class="hub-menu-list">${operationCards}</div>
      </section>
    </section>
  `;

  page.querySelectorAll("[data-v34-feature]").forEach((button) => button.addEventListener("click", () => {
    void openNavigationFeatureV34(button.dataset.v34Feature);
  }));
  page.querySelector("[data-v42-go-feedback]")?.addEventListener("click", () => void openNavigationFeatureV34("feedback"));
  window.scrollTo(0, 0);
}

const renderNavigationHubBeforeV42 = renderNavigationHubV34;
renderNavigationHubV34 = function(area) {
  if (area === "settings") return buildSettingsDashboardV42();
  return renderNavigationHubBeforeV42(area);
};

function mountSettingsSectionSwitcherV42() {
  if (currentTab !== "settings" || !settingsFocusV34) return;
  const page = getPageWorkspace();
  const card = page.querySelector(".settings-card");
  if (!card || card.querySelector(".v42-settings-switcher")) return;
  const labels = {
    group: "グループ",
    setup: "会場・テンプレート",
    data: "データ管理"
  };
  const switcher = document.createElement("nav");
  switcher.className = "v42-settings-switcher";
  switcher.setAttribute("aria-label", "設定カテゴリ");
  switcher.innerHTML = Object.entries(labels).map(([key, label]) => `
    <button type="button" class="${settingsFocusV34 === key ? "active" : ""}" data-v42-settings-focus="${key}">${label}</button>
  `).join("");
  card.insertAdjacentElement("afterbegin", switcher);
  switcher.querySelectorAll("[data-v42-settings-focus]").forEach((button) => button.addEventListener("click", () => {
    void openSettingsFeatureV34(button.dataset.v42SettingsFocus);
  }));
}

const renderSettingsPageBeforeV42 = renderSettingsPage;
renderSettingsPage = function() {
  renderSettingsPageBeforeV42();
  mountSettingsSectionSwitcherV42();
};

function decorateContentCardsV42() {
  const page = getPageWorkspace();
  page?.querySelectorAll(".history-session-card, .ranking-entry, .debt-record, .venue-analysis-card").forEach((card) => {
    card.classList.add("v42-readable-card");
  });
}

const renderHistoryPageBeforeV42 = renderHistoryPage;
renderHistoryPage = function() {
  renderHistoryPageBeforeV42();
  decorateContentCardsV42();
};
const renderRankingPageBeforeV42 = renderRankingPage;
renderRankingPage = function() {
  renderRankingPageBeforeV42();
  decorateContentCardsV42();
};
const renderDebtPageBeforeV42 = renderDebtPage;
renderDebtPage = function() {
  renderDebtPageBeforeV42();
  decorateContentCardsV42();
};


/* v43: keep the current viewport while options are selected in the create-session wizard */
function getCreateScrollAnchorV43(target) {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-session-member-id]")) return "members";
  if (target.closest("[data-session-field='rateLabel']")) return "settings";
  if (target.closest("[data-session-mode]")) return "mode";
  return null;
}

function findCreateScrollAnchorV43(form, anchor) {
  if (!form) return null;
  if (anchor === "members") return form.querySelector(".game-member-grid")?.closest(".game-section") || null;
  if (anchor === "settings") return form.querySelector(".game-settings-grid")?.closest(".game-section") || null;
  if (anchor === "mode") return form.querySelector(".mode-preset-grid")?.closest(".game-section") || null;
  return null;
}

function captureCreateScrollV43(target) {
  const form = document.getElementById("createSessionForm");
  const anchor = getCreateScrollAnchorV43(target);
  const section = findCreateScrollAnchorV43(form, anchor);
  if (!anchor || !section) return;
  globalThis.__morikenCreateScrollRestoreV43 = {
    anchor,
    viewportOffset: section.getBoundingClientRect().top,
    fallbackY: window.scrollY
  };
}

function mountCreateScrollCaptureV43() {
  const form = document.getElementById("createSessionForm");
  if (!form || form.dataset.v43ScrollCapture === "1") return;
  form.dataset.v43ScrollCapture = "1";

  form.addEventListener("click", (event) => {
    if (event.target.closest("[data-session-mode]")) captureCreateScrollV43(event.target);
  }, true);

  form.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-session-member-id], [data-session-field='rateLabel']")) {
      captureCreateScrollV43(target);
    }
  }, true);
}

const renderCreateSessionViewBeforeV43 = renderCreateSessionView;
renderCreateSessionView = function() {
  const restore = globalThis.__morikenCreateScrollRestoreV43 || null;
  renderCreateSessionViewBeforeV43();
  mountCreateScrollCaptureV43();

  if (!restore) return;
  globalThis.__morikenCreateScrollRestoreV43 = null;
  requestAnimationFrame(() => {
    const form = document.getElementById("createSessionForm");
    const section = findCreateScrollAnchorV43(form, restore.anchor);
    const nextY = section
      ? Math.max(0, window.scrollY + section.getBoundingClientRect().top - restore.viewportOffset)
      : Math.max(0, Number(restore.fallbackY) || 0);
    window.scrollTo({ top: nextY, behavior: "auto" });
  });
};

/* v44: exact viewport preservation for create-session selections (iOS/PWA safe) */
function getCreateInteractiveTargetV44(target) {
  if (!(target instanceof Element)) return null;
  const member = target.closest("[data-session-member-id]");
  if (member) return { key: "member", selector: `[data-session-member-id="${member.dataset.sessionMemberId || ""}"]` };
  const rate = target.closest("[data-session-field='rateLabel']");
  if (rate) return { key: "rate", selector: "[data-session-field='rateLabel']" };
  const mode = target.closest("[data-session-mode]");
  if (mode) return { key: "mode", selector: `[data-session-mode="${mode.dataset.sessionMode || ""}"]` };
  return null;
}

function getCreateScrollRootsV44() {
  const roots = [];
  const scrolling = document.scrollingElement;
  if (scrolling) roots.push(scrolling);
  if (document.documentElement && !roots.includes(document.documentElement)) roots.push(document.documentElement);
  if (document.body && !roots.includes(document.body)) roots.push(document.body);
  const shell = document.querySelector(".app-shell");
  if (shell && (shell.scrollHeight > shell.clientHeight + 2 || shell.scrollTop)) roots.push(shell);
  return roots;
}

function captureCreateViewportV44(target) {
  const item = getCreateInteractiveTargetV44(target);
  if (!item) return;
  const node = document.querySelector(item.selector);
  if (!node) return;
  globalThis.__morikenCreateViewportV44 = {
    ...item,
    top: node.getBoundingClientRect().top,
    roots: getCreateScrollRootsV44().map((root) => ({ root, top: root.scrollTop })),
    windowY: window.scrollY
  };
}

function restoreCreateViewportV44(state) {
  if (!state) return;
  const apply = () => {
    const node = document.querySelector(state.selector);
    if (!node) return;
    const delta = node.getBoundingClientRect().top - state.top;
    if (Math.abs(delta) > 0.5) {
      window.scrollBy(0, delta);
      getCreateScrollRootsV44().forEach((root) => {
        if (root === document.scrollingElement || root === document.documentElement || root === document.body) return;
        const prior = state.roots.find((entry) => entry.root === root);
        if (prior) root.scrollTop = prior.top + delta;
      });
    }
  };
  requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
  setTimeout(apply, 60);
  setTimeout(apply, 180);
}

function mountCreateViewportCaptureV44() {
  const form = document.getElementById("createSessionForm");
  if (!form || form.dataset.v44ViewportCapture === "1") return;
  form.dataset.v44ViewportCapture = "1";
  const capture = (event) => captureCreateViewportV44(event.target);
  form.addEventListener("pointerdown", capture, true);
  form.addEventListener("touchstart", capture, { capture: true, passive: true });
  form.addEventListener("change", capture, true);
  form.addEventListener("click", capture, true);
}

const renderCreateSessionViewBeforeV44 = renderCreateSessionView;
renderCreateSessionView = function() {
  const restore = globalThis.__morikenCreateViewportV44 || null;
  globalThis.__morikenCreateViewportV44 = null;
  renderCreateSessionViewBeforeV44();
  mountCreateViewportCaptureV44();
  if (restore) restoreCreateViewportV44(restore);
};


/* v47: avoid full-page rerenders while configuring a new daily session */
function clearCreateSessionMessageV47() {
  const message = document.getElementById("createSessionMessage");
  if (message) message.textContent = "";
}

function updateCreateMemberSelectionV47(form) {
  if (!form) return;
  const limit = getModePreset(sessionDraft.gameMode).playerCount;
  form.querySelectorAll("[data-session-member-id]").forEach((box) => {
    const selected = sessionDraft.memberIds.includes(box.dataset.sessionMemberId);
    box.checked = selected;
    box.closest(".game-member-choice")?.classList.toggle("selected", selected);
  });
  const counter = form.querySelector(".selection-counter");
  if (counter) counter.textContent = `${sessionDraft.memberIds.length} / ${limit}人`;
}

function syncCreateRateBlockV47(form) {
  if (!form) return;
  const select = form.querySelector("[data-session-field='rateLabel']");
  if (select) select.value = sessionDraft.rateLabel;
  const basicSection = select?.closest(".game-section");
  if (!basicSection) return;
  basicSection.querySelector(".custom-rate-grid")?.remove();
  basicSection.querySelector(".selected-rate-note")?.remove();

  const settingsGrid = basicSection.querySelector(".game-settings-grid");
  if (!settingsGrid) return;
  if (sessionDraft.rateLabel === "カスタム") {
    const custom = document.createElement("div");
    custom.className = "game-settings-grid custom-rate-grid";
    custom.innerHTML = `<label>カスタム名<input type="text" maxlength="40" data-session-field="customRateLabel" value="${escapeHtml(sessionDraft.customRateLabel)}" placeholder="例：特別レート"></label><label>レート倍率（pt / 収支1）<input type="number" min="0.01" max="10000" step="0.01" data-session-field="rateMultiplier" value="${sessionDraft.rateMultiplier}"></label>`;
    settingsGrid.insertAdjacentElement("afterend", custom);
    custom.querySelectorAll("[data-session-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.sessionField;
        sessionDraft[field] = field === "rateMultiplier" ? num(input.value) : input.value;
      });
    });
  } else {
    const note = document.createElement("p");
    note.className = "selected-rate-note";
    note.innerHTML = `選択中：<strong>収支1 = ${sessionDraft.rateMultiplier} pt</strong>`;
    settingsGrid.insertAdjacentElement("afterend", note);
  }
}

function updateCreateModeInlineV47(form, next) {
  if (!form || !next || !MODE_PRESETS[next]) return;
  const nextPreset = getModePreset(next);
  const kept = sessionDraft.memberIds.slice(0, nextPreset.playerCount);
  sessionDraft = createDefaultSessionDraft(next);
  sessionDraft.memberIds = kept;

  form.querySelectorAll("[data-session-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sessionMode === next);
  });
  const startingPoints = form.querySelector("[data-session-field='startingPoints']");
  if (startingPoints) startingPoints.value = sessionDraft.startingPoints;
  const chipValue = form.querySelector("[data-session-field='chipValue']");
  if (chipValue) chipValue.value = sessionDraft.chipValue;
  const date = form.querySelector("[data-session-field='sessionDate']");
  if (date) date.value = sessionDraft.sessionDate;
  const rate = form.querySelector("[data-session-field='rateLabel']");
  if (rate) rate.value = sessionDraft.rateLabel;
  const tobi = form.querySelector("[data-session-field='tobiEnabled']");
  if (tobi) tobi.checked = sessionDraft.tobiEnabled;

  const umaGrid = form.querySelector(".uma-grid");
  if (umaGrid) {
    umaGrid.innerHTML = sessionDraft.defaultUma.map((value, index) => `<label>${index + 1}位<input type="number" step="0.1" data-session-uma-index="${index}" value="${value}"></label>`).join("");
    umaGrid.querySelectorAll("[data-session-uma-index]").forEach((input) => input.addEventListener("input", () => {
      sessionDraft.defaultUma[Number(input.dataset.sessionUmaIndex)] = num(input.value);
    }));
  }
  updateCreateMemberSelectionV47(form);
  syncCreateRateBlockV47(form);
  clearCreateSessionMessageV47();
}

function mountInlineCreateUpdatesV47() {
  const form = document.getElementById("createSessionForm");
  if (!form || form.dataset.v47InlineUpdates === "1") return;
  form.dataset.v47InlineUpdates = "1";

  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-mode]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    updateCreateModeInlineV47(form, button.dataset.sessionMode);
  }, true);

  form.addEventListener("change", (event) => {
    const member = event.target.closest("[data-session-member-id]");
    if (member) {
      event.stopImmediatePropagation();
      const id = member.dataset.sessionMemberId;
      const limit = getModePreset(sessionDraft.gameMode).playerCount;
      if (member.checked) {
        if (sessionDraft.memberIds.length >= limit) {
          member.checked = false;
          alert(`${limit}人まで選択できます。`);
          return;
        }
        if (!sessionDraft.memberIds.includes(id)) sessionDraft.memberIds.push(id);
      } else {
        sessionDraft.memberIds = sessionDraft.memberIds.filter((value) => value !== id);
      }
      updateCreateMemberSelectionV47(form);
      clearCreateSessionMessageV47();
      return;
    }

    const field = event.target.closest("[data-session-field='rateLabel']");
    if (field) {
      event.stopImmediatePropagation();
      sessionDraft.rateLabel = field.value;
      const preset = getRatePreset(field.value);
      if (preset?.multiplier !== null) sessionDraft.rateMultiplier = preset.multiplier;
      syncCreateRateBlockV47(form);
      clearCreateSessionMessageV47();
    }
  }, true);
}

const renderCreateSessionViewBeforeV47 = renderCreateSessionView;
renderCreateSessionView = function() {
  renderCreateSessionViewBeforeV47();
  mountInlineCreateUpdatesV47();
};

/* v55: personal member page */
let myPageDataV55 = {
  groupId: "",
  loading: false,
  loaded: false,
  error: "",
  sessions: [],
  hanchans: [],
  results: [],
  chips: [],
  yakumans: [],
  debts: []
};
let myPageLoadTokenV55 = 0;

function resetMyPageDataV55(groupId = "") {
  myPageDataV55 = {
    groupId,
    loading: false,
    loaded: false,
    error: "",
    sessions: [],
    hanchans: [],
    results: [],
    chips: [],
    yakumans: [],
    debts: []
  };
}

function getSelfMemberV55() {
  return activeGroupMembers.find((member) => member.user_id === currentSession?.user?.id) || null;
}

function buildSelfProfileV55() {
  const self = getSelfMemberV55();
  if (!self) return null;

  const sessionMap = new Map((myPageDataV55.sessions || []).map((session) => [session.id, session]));
  const hanchansBySession = new Map();
  (myPageDataV55.hanchans || []).forEach((hanchan) => {
    if (!hanchansBySession.has(hanchan.session_id)) hanchansBySession.set(hanchan.session_id, []);
    hanchansBySession.get(hanchan.session_id).push(hanchan);
  });
  hanchansBySession.forEach((items) => items.sort((a, b) => num(a.sequence_no) - num(b.sequence_no)));

  const resultsByHanchan = new Map();
  (myPageDataV55.results || []).forEach((result) => {
    if (!resultsByHanchan.has(result.hanchan_id)) resultsByHanchan.set(result.hanchan_id, []);
    resultsByHanchan.get(result.hanchan_id).push(result);
  });

  const chipBySession = new Map();
  (myPageDataV55.chips || [])
    .filter((chip) => chip.member_id === self.id)
    .forEach((chip) => chipBySession.set(chip.session_id, num(chip.chip_count)));

  const hanchanToSession = new Map();
  (myPageDataV55.hanchans || []).forEach((hanchan) => hanchanToSession.set(hanchan.id, hanchan.session_id));

  const thisMonth = new Date().toISOString().slice(0, 7);
  const stats = {
    memberId: self.id,
    displayName: self.display_name || "あなた",
    totalPt: 0,
    scorePt: 0,
    chipCount: 0,
    monthPt: 0,
    sessions: 0,
    hanchans: 0,
    rankSum: 0,
    firstCount: 0,
    lastCount: 0,
    bestSession: null,
    worstSession: null,
    history: [],
    recentSessions: []
  };

  const orderedSessions = (myPageDataV55.sessions || []).slice().sort((a, b) => {
    const byDate = String(a.session_date || "").localeCompare(String(b.session_date || ""));
    return byDate || String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  orderedSessions.forEach((session) => {
    const sessionHanchans = hanchansBySession.get(session.id) || [];
    let hanchanGameScore = 0;
    let hanchanCount = 0;
    let rankSum = 0;
    let firstCount = 0;
    let lastCount = 0;

    sessionHanchans.forEach((hanchan) => {
      const rows = resultsByHanchan.get(hanchan.id) || [];
      const selfRow = rows.find((row) => row.member_id === self.id);
      if (!selfRow) return;
      hanchanGameScore = roundTo(hanchanGameScore + num(selfRow.total_points), 2);
      hanchanCount += 1;
      const rank = num(selfRow.rank);
      const playerCount = rows.length || getModePreset(session.game_mode).playerCount;
      rankSum += rank;
      if (rank === 1) firstCount += 1;
      if (rank === playerCount) lastCount += 1;
    });

    if (!hanchanCount && !chipBySession.has(session.id)) return;

    const multiplier = num(session.rate_multiplier || 30);
    const chipCount = num(chipBySession.get(session.id));
    const chipPt = roundTo(chipCount * num(session.chip_value) * multiplier, 2);
    const scorePt = roundTo(hanchanGameScore * multiplier, 2);
    const totalPt = roundTo(scorePt + chipPt, 2);
    const item = {
      sessionId: session.id,
      label: formatDate(session.session_date),
      date: session.session_date,
      mode: session.game_mode,
      rateLabel: session.rate_label,
      multiplier,
      totalPt,
      scorePt,
      chipCount,
      hanchans: hanchanCount,
      averageRank: hanchanCount ? roundTo(rankSum / hanchanCount, 2) : null
    };

    stats.sessions += 1;
    stats.hanchans += hanchanCount;
    stats.rankSum += rankSum;
    stats.firstCount += firstCount;
    stats.lastCount += lastCount;
    stats.totalPt = roundTo(stats.totalPt + totalPt, 2);
    stats.scorePt = roundTo(stats.scorePt + scorePt, 2);
    stats.chipCount = roundOne(stats.chipCount + chipCount);
    if (String(session.session_date || "").startsWith(thisMonth)) stats.monthPt = roundTo(stats.monthPt + totalPt, 2);
    item.cumulativeTotal = stats.totalPt;
    item.cumulativeScore = stats.scorePt;
    item.cumulativeChip = stats.chipCount;
    stats.history.push(item);
    stats.recentSessions.push(item);
    if (!stats.bestSession || totalPt > stats.bestSession.totalPt) stats.bestSession = item;
    if (!stats.worstSession || totalPt < stats.worstSession.totalPt) stats.worstSession = item;
  });

  stats.averageRank = stats.hanchans ? roundTo(stats.rankSum / stats.hanchans, 2) : null;
  stats.firstRate = stats.hanchans ? roundTo((stats.firstCount / stats.hanchans) * 100, 1) : null;
  stats.lastRate = stats.hanchans ? roundTo((stats.lastCount / stats.hanchans) * 100, 1) : null;
  stats.recentSessions = stats.recentSessions.slice().reverse().slice(0, 6);

  const yakumans = (myPageDataV55.yakumans || [])
    .filter((record) => record.winner_member_id === self.id)
    .map((record) => {
      const session = sessionMap.get(hanchanToSession.get(record.hanchan_id));
      return {
        ...record,
        sessionDate: session?.session_date || "",
        mode: session?.game_mode || "",
        rateLabel: session?.rate_label || ""
      };
    })
    .sort((a, b) => String(b.created_at || b.sessionDate || "").localeCompare(String(a.created_at || a.sessionDate || "")));

  const openDebts = (myPageDataV55.debts || []).filter((record) => record.status === "open" && num(record.remaining_amount_pt) > 0.004);
  const payDebts = openDebts.filter((record) => record.debtor_member_id === self.id);
  const receiveDebts = openDebts.filter((record) => record.creditor_member_id === self.id);
  const payTotal = roundTo(payDebts.reduce((sum, record) => sum + num(record.remaining_amount_pt), 0), 2);
  const receiveTotal = roundTo(receiveDebts.reduce((sum, record) => sum + num(record.remaining_amount_pt), 0), 2);

  return {
    self,
    stats,
    yakumans,
    debt: {
      payDebts,
      receiveDebts,
      payTotal,
      receiveTotal,
      net: roundTo(receiveTotal - payTotal, 2)
    }
  };
}

function renderMyPageV55() {
  const page = getPageWorkspace();
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  page.hidden = false;
  setPrimaryNavActiveV34("home");

  if (!currentSession || !activeGroupId) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MY PAGE</p><h2>ログインが必要です</h2><p class="workspace-description">ログインしてグループに参加すると、自分専用ページを表示できます。</p></section>`;
    return;
  }

  if (myPageDataV55.loading) {
    page.innerHTML = `<section class="workspace-card loading-card">マイページを読み込み中...</section>`;
    return;
  }

  if (myPageDataV55.error) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MY PAGE</p><h2>マイページを読み込めませんでした</h2><p class="workspace-description">${escapeHtml(myPageDataV55.error)}</p><button type="button" class="primary-button" data-v55-retry-my-page>再読み込み</button></section>`;
    page.querySelector("[data-v55-retry-my-page]")?.addEventListener("click", () => void loadMyPageDataV55(true));
    return;
  }

  const profile = buildSelfProfileV55();
  if (!profile) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">MY PAGE</p><h2>メンバー情報が見つかりません</h2><p class="workspace-description">このグループのメンバーとして参加できているか確認してください。</p></section>`;
    return;
  }

  const { stats, debt, yakumans } = profile;
  const monthLabel = new Date().toISOString().slice(0, 7).replace("-", "年") + "月";
  const trend = stats.history.length ? buildTrendSvg(stats.history, "total") : `<p class="ranking-note">精算済みの対局が増えると、自分の累積pt推移が表示されます。</p>`;
  const recentRows = stats.recentSessions.length ? stats.recentSessions.map((item) => `
    <button type="button" class="my-page-session-row" data-v55-open-session="${item.sessionId}">
      <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(getModeLabel(item.mode))} ／ ${escapeHtml(item.rateLabel || "レート未設定")} ／ ${item.hanchans}半荘</small></span>
      <b class="${signedClass(item.totalPt)}">${formatPtPlain(item.totalPt)}</b>
    </button>
  `).join("") : `<p class="ranking-note">まだ精算済みの対局がありません。</p>`;

  const yakumanRows = yakumans.length ? yakumans.slice(0, 6).map((item) => `
    <div class="my-page-yakuman-row"><span>${escapeHtml(item.yakuman_name || "役満")}</span><small>${escapeHtml(item.sessionDate ? formatDate(item.sessionDate) : "日付不明")} ／ ${escapeHtml(item.win_type || "")}</small></div>
  `).join("") : `<p class="ranking-note">役満記録はまだありません。</p>`;

  page.innerHTML = `
    <section class="v41-dashboard my-page-card my-page-unified-v57">
      <header class="v41-dashboard-heading my-page-heading-v57">
        <div>
          <p class="eyebrow">MY PAGE</p>
          <h2>${escapeHtml(stats.displayName)}のマイページ</h2>
          <p>自分の成績、未精算借pt、最近の対局を確認できます。</p>
        </div>
        <button type="button" class="secondary-button" data-v55-my-page-refresh>更新</button>
      </header>

      <section class="v41-dashboard-grid my-page-kpi-grid my-page-kpi-grid-v57">
        <div class="v41-dashboard-tile my-page-kpi my-page-kpi-v57 main"><span>計</span><strong>累計pt</strong><b class="${signedClass(stats.totalPt)}">${formatPtMarkup(stats.totalPt)}</b><small>チップ込み・場代除外</small></div>
        <div class="v41-dashboard-tile my-page-kpi my-page-kpi-v57"><span>月</span><strong>${escapeHtml(monthLabel)}</strong><b class="${signedClass(stats.monthPt)}">${formatPtMarkup(stats.monthPt)}</b><small>今月の総合pt</small></div>
        <div class="v41-dashboard-tile my-page-kpi my-page-kpi-v57"><span>順</span><strong>平均順位</strong><b>${stats.averageRank ?? "-"}</b><small>${stats.hanchans}半荘</small></div>
        <div class="v41-dashboard-tile my-page-kpi my-page-kpi-v57"><span>率</span><strong>1位率 / ラス率</strong><b>${stats.firstRate !== null ? `${stats.firstRate}%` : "-"} / ${stats.lastRate !== null ? `${stats.lastRate}%` : "-"}</b><small>半荘単位</small></div>
      </section>

      <section class="v41-recent-section my-page-debt-panel my-page-section-v57">
        <div class="v41-section-heading"><div><p class="eyebrow">OPEN BALANCE</p><h3>自分の未精算借pt</h3></div><button type="button" data-v55-go-debt>精算へ</button></div>
        <div class="v41-dashboard-grid my-page-debt-grid my-page-debt-grid-v57">
          <button type="button" class="v41-dashboard-tile my-page-debt-tile-v57" data-v55-go-debt><span>払</span><strong>支払う</strong><b>${formatPtPlain(debt.payTotal)}</b><small>${debt.payDebts.length}件</small></button>
          <button type="button" class="v41-dashboard-tile my-page-debt-tile-v57" data-v55-go-debt><span>受</span><strong>受け取る</strong><b>${formatPtPlain(debt.receiveTotal)}</b><small>${debt.receiveDebts.length}件</small></button>
          <button type="button" class="v41-dashboard-tile my-page-debt-tile-v57" data-v55-go-debt><span>差</span><strong>差額</strong><b class="${signedClass(debt.net)}">${formatPtPlain(debt.net)}</b><small>＋なら受け取り超過</small></button>
        </div>
      </section>

      <section class="v41-recent-section my-page-chart-section my-page-section-v57">
        <div class="v41-section-heading"><div><p class="eyebrow">TREND</p><h3>自分の累積pt推移</h3></div></div>
        <p class="game-section-note">日次精算ごとの総合pt。場代は含めません。</p>
        <div class="trend-chart-wrap">${trend}</div>
      </section>

      <section class="my-page-split-grid my-page-split-grid-v57">
        <article class="v41-recent-section my-page-section-v57"><div class="v41-section-heading"><h3>成績内訳</h3></div><div class="my-page-stat-list">
          <div><span>対局数</span><strong>${stats.sessions}日</strong></div>
          <div><span>半荘数</span><strong>${stats.hanchans}半荘</strong></div>
          <div><span>素点pt</span><strong>${formatPtMarkup(stats.scorePt)}</strong></div>
          <div><span>チップ</span><strong>${formatChipMarkup(stats.chipCount)}</strong></div>
          <div><span>最高日次pt</span><strong>${stats.bestSession ? formatPtMarkup(stats.bestSession.totalPt) : "-"}</strong></div>
          <div><span>最低日次pt</span><strong>${stats.worstSession ? formatPtMarkup(stats.worstSession.totalPt) : "-"}</strong></div>
        </div></article>
        <article class="v41-recent-section my-page-section-v57"><div class="v41-section-heading"><h3>役満記録</h3></div><div class="my-page-yakuman-list">${yakumanRows}</div></article>
      </section>

      <section class="v41-recent-section my-page-section-v57"><div class="v41-section-heading"><h3>最近の自分の対局</h3><button type="button" data-v55-go-history>履歴へ</button></div><div class="my-page-session-list">${recentRows}</div></section>
    </section>
  `;

  mountViewContextV34("home", "マイページ", "自分の成績と未精算状況");
  page.querySelector("[data-v55-my-page-refresh]")?.addEventListener("click", () => void loadMyPageDataV55(true));
  page.querySelectorAll("[data-v55-go-debt]").forEach((button) => button.addEventListener("click", () => void openNavigationFeatureV34("debt-manage")));
  page.querySelector("[data-v55-go-history]")?.addEventListener("click", () => void openNavigationFeatureV34("history"));
  page.querySelectorAll("[data-v55-open-session]").forEach((button) => button.addEventListener("click", async () => {
    activeMatchSessionId = button.dataset.v55OpenSession;
    localStorage.setItem("jakuroku-active-match-session-id", activeMatchSessionId);
    await openNavigationFeatureV34("game-session");
  }));
}

async function loadMyPageDataV55(force = false) {
  if (!currentSession || !activeGroupId) {
    renderMyPageV55();
    return;
  }
  const groupId = activeGroupId;
  if (myPageDataV55.groupId !== groupId) resetMyPageDataV55(groupId);
  if (myPageDataV55.loaded && !force) {
    renderMyPageV55();
    return;
  }
  const token = ++myPageLoadTokenV55;
  myPageDataV55.loading = true;
  myPageDataV55.error = "";
  renderMyPageV55();

  try {
    if (!activeGroupMembers.length) await loadActiveGroupMembers();
    const self = getSelfMemberV55();
    if (!self) throw new Error("このグループのメンバー情報が見つかりません。");

    const [sessionsResponse, debtsResponse] = await Promise.all([
      supabaseClient
        .from("match_sessions")
        .select("id, session_date, game_mode, rate_label, rate_multiplier, chip_value, status, created_at")
        .eq("group_id", groupId)
        .is("deleted_at", null)
        .eq("status", "settled")
        .order("session_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseClient
        .from("debt_records")
        .select("id, debtor_member_id, creditor_member_id, original_amount_pt, remaining_amount_pt, status, memo, due_date, created_at, updated_at")
        .eq("group_id", groupId)
        .eq("status", "open")
    ]);
    if (sessionsResponse.error) throw sessionsResponse.error;
    if (debtsResponse.error) throw debtsResponse.error;
    if (token !== myPageLoadTokenV55 || activeGroupId !== groupId) return;

    const sessions = sessionsResponse.data || [];
    const sessionIds = sessions.map((session) => session.id);
    let hanchans = [];
    let results = [];
    let chips = [];
    let yakumans = [];

    if (sessionIds.length) {
      const [hanchansResponse, chipsResponse] = await Promise.all([
        supabaseClient
          .from("match_hanchans")
          .select("id, session_id, sequence_no")
          .in("session_id", sessionIds),
        supabaseClient
          .from("match_session_chips")
          .select("session_id, member_id, chip_count")
          .in("session_id", sessionIds)
      ]);
      if (hanchansResponse.error) throw hanchansResponse.error;
      if (chipsResponse.error) throw chipsResponse.error;
      hanchans = hanchansResponse.data || [];
      chips = chipsResponse.data || [];
      const hanchanIds = hanchans.map((hanchan) => hanchan.id);
      if (hanchanIds.length) {
        const [resultsResponse, yakumanResponse] = await Promise.all([
          supabaseClient
            .from("match_hanchan_results")
            .select("hanchan_id, member_id, rank, total_points, score_points, uma_points, tobi_points")
            .in("hanchan_id", hanchanIds),
          supabaseClient
            .from("match_yakuman_records")
            .select("hanchan_id, winner_member_id, yakuman_name, win_type, created_at")
            .in("hanchan_id", hanchanIds)
        ]);
        if (resultsResponse.error) throw resultsResponse.error;
        if (yakumanResponse.error) throw yakumanResponse.error;
        results = resultsResponse.data || [];
        yakumans = yakumanResponse.data || [];
      }
    }

    if (token !== myPageLoadTokenV55 || activeGroupId !== groupId) return;
    myPageDataV55 = {
      groupId,
      loading: false,
      loaded: true,
      error: "",
      sessions,
      hanchans,
      results,
      chips,
      yakumans,
      debts: debtsResponse.data || []
    };
  } catch (error) {
    if (token !== myPageLoadTokenV55 || activeGroupId !== groupId) return;
    myPageDataV55.loading = false;
    myPageDataV55.loaded = false;
    myPageDataV55.error = error?.message || "通信状態を確認してください。";
  }

  renderMyPageV55();
}

function mountMyPageShortcutsV55() {
  const homeGrid = document.querySelector(".home-action-grid");
  if (homeGrid && !homeGrid.querySelector("[data-v55-open-my-page]")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "home-action-card my-page-shortcut-card-v55";
    button.dataset.v55OpenMyPage = "1";
    button.innerHTML = `<span>私</span><strong>マイページ</strong><small>自分の成績・借ptを見る</small>`;
    homeGrid.insertBefore(button, homeGrid.children[1] || null);
  }
  const analyticsGrid = document.querySelector(".v41-analytics-dashboard .v41-dashboard-grid");
  if (analyticsGrid && !analyticsGrid.querySelector("[data-v55-open-my-page]")) {
    analyticsGrid.insertAdjacentHTML("afterbegin", `<button type="button" class="v41-dashboard-tile my-page-shortcut-tile-v55" data-v55-open-my-page><span>私</span><strong>マイページ</strong><small>自分の累計pt・借pt・最近の対局</small></button>`);
  }
  document.querySelectorAll("[data-v55-open-my-page]").forEach((button) => {
    if (button.dataset.v55Bound === "1") return;
    button.dataset.v55Bound = "1";
    button.addEventListener("click", () => void openNavigationFeatureV34("my-page"));
  });
}

const openNavigationFeatureBeforeV55 = openNavigationFeatureV34;
openNavigationFeatureV34 = async function(feature) {
  if (feature === "my-page") {
    navigationHubV34 = "home";
    settingsFocusV34 = "";
    currentTab = "my-page";
    setPrimaryNavActiveV34("home");
    await loadMyPageDataV55(true);
    window.scrollTo(0, 0);
    return;
  }
  return openNavigationFeatureBeforeV55(feature);
};

const renderHomeDashboardBeforeV55 = renderHomeDashboardV35;
renderHomeDashboardV35 = function() {
  renderHomeDashboardBeforeV55();
  mountMyPageShortcutsV55();
};

const renderNavigationHubBeforeV55 = renderNavigationHubV34;
renderNavigationHubV34 = function(area) {
  const result = renderNavigationHubBeforeV55(area);
  if (area === "analytics") mountMyPageShortcutsV55();
  return result;
};

const updateAuthUIBeforeV55 = updateAuthUI;
updateAuthUI = async function(session) {
  if (!session) resetMyPageDataV55();
  await updateAuthUIBeforeV55(session);
};


/* v62: シンプル運用UI。機能を残しつつ、日常操作と詳細確認を分離する。 */
const V62_COLLAPSED_KEY = "moriken-v62-collapsed-sections";
const V62_DETAIL_TITLES = new Set([
  "この対局のpt推移",
  "半荘詳細",
  "終了時チップ",
  "ゲーム収支",
  "ゲーム収支のレート換算（pt）",
  "場代精算"
]);
const V62_COMPACTABLE_TITLES = new Set([
  "この対局のpt推移",
  "半荘詳細",
  "終了時チップ",
  "ゲーム収支",
  "ゲーム収支のレート換算（pt）",
  "場代精算",
  "編集履歴",
  "JSONバックアップを復元",
  "拡張JSONバックアップ v2を出力"
]);
function getV62CollapsedSections() {
  try {
    const parsed = JSON.parse(localStorage.getItem(V62_COLLAPSED_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}
function setV62CollapsedSection(key, collapsed) {
  const map = getV62CollapsedSections();
  map[key] = !!collapsed;
  localStorage.setItem(V62_COLLAPSED_KEY, JSON.stringify(map));
}
function v62SectionKey(title) {
  return `${currentTab || "page"}:${activeMatchSessionId || "none"}:${title}`;
}
function simplifySectionV62(section, title) {
  if (!section || section.dataset.v62Simplified === "1") return;
  section.dataset.v62Simplified = "1";
  section.classList.add("v62-section");
  if (V62_DETAIL_TITLES.has(title)) section.classList.add("v62-secondary-section");
  const heading = section.querySelector(".game-section-heading") || section.querySelector(".settings-section-heading") || section.querySelector(".v41-section-heading");
  const targetHeading = heading || section;
  const key = v62SectionKey(title);
  const collapsedMap = getV62CollapsedSections();
  const defaultCollapsed = V62_DETAIL_TITLES.has(title) && !["半荘詳細"].includes(title);
  const shouldCollapse = collapsedMap[key] ?? defaultCollapsed;

  if (V62_COMPACTABLE_TITLES.has(title)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "v62-section-toggle";
    button.textContent = shouldCollapse ? "表示" : "閉じる";
    button.addEventListener("click", () => {
      const next = !section.classList.contains("v62-collapsed");
      section.classList.toggle("v62-collapsed", next);
      button.textContent = next ? "表示" : "閉じる";
      setV62CollapsedSection(key, next);
    });
    targetHeading.appendChild(button);
    section.classList.toggle("v62-collapsed", !!shouldCollapse);
  }
}
function addPageFocusBarV62(page) {
  if (!page || page.querySelector(".v62-focus-bar")) return;
  let title = "必要な操作だけを先に表示";
  let text = "詳細情報は必要なときだけ開けます。";
  const map = {
    home: ["今日見るべき情報", "新しい対局、未精算、最近の記録だけを先に確認します。"],
    "hub-game": ["対局の入口", "進行中の対局へ戻るか、新しい対局を作成します。"],
    game: [showCreateSession ? "新しい対局を作成" : "対局中の操作", showCreateSession ? "形式、設定、参加者、確認の順で進めます。" : "半荘登録・チップ・場代・精算を上から処理します。"],
    "hub-analysis": ["成績を見る", "ランキング、マイページ、会場別集計を目的別に開きます。"],
    "hub-settlement": ["未精算を整理", "未精算借ptの確認、まとめ直し、送金済み処理を行います。"],
    settings: ["管理・設定", "普段使う設定とデータ管理を分けて表示します。"],
    "my-page": ["自分の状況", "自分の成績、借pt、最近の対局だけをまとめます。"]
  };
  if (map[currentTab]) [title, text] = map[currentTab];
  const bar = document.createElement("section");
  bar.className = "v62-focus-bar";
  bar.innerHTML = `<div><p class="eyebrow">FOCUS</p><h3>${escapeHtml(title)}</h3><small>${escapeHtml(text)}</small></div>`;
  const first = page.firstElementChild;
  if (first) page.insertBefore(bar, first); else page.appendChild(bar);
}
function simplifyActiveSessionV62(page) {
  if (!page) return;
  const live = page.querySelector(".live-input-panel");
  if (live && !live.querySelector(".v62-live-note")) {
    const note = document.createElement("p");
    note.className = "v62-live-note";
    note.textContent = "対局中はここだけ見れば入力できます。下の表と精算は確認用です。";
    live.querySelector(".live-input-heading")?.appendChild(note);
  }
  page.querySelectorAll(".game-section").forEach((section) => {
    const title = section.querySelector(".game-section-title")?.textContent?.trim();
    if (title) simplifySectionV62(section, title);
  });
}
function simplifyDashboardCardsV62(page) {
  if (!page) return;
  page.querySelectorAll(".v41-dashboard-tile, .home-action-card, .hub-menu-card, .live-action-card").forEach((card) => {
    card.classList.add("v62-action-surface");
  });
  page.querySelectorAll(".workspace-description, .game-section-note, .v41-dashboard-tile small, .home-action-card small, .hub-menu-card small").forEach((el) => {
    const text = el.textContent.trim();
    if (text.length > 46) el.classList.add("v62-muted-short");
  });
}
function simplifySettingsV62(page) {
  if (!page) return;
  page.querySelectorAll(".settings-section").forEach((section) => {
    const title = section.querySelector("h3")?.textContent?.trim() || section.querySelector(".game-section-title")?.textContent?.trim();
    if (title) simplifySectionV62(section, title);
  });
}
function applySimpleUiV62() {
  document.body.classList.add("v62-simple-ui");
  const page = getPageWorkspace?.();
  if (!page || page.hidden) return;
  page.classList.add("v62-page");
  addPageFocusBarV62(page);
  simplifyDashboardCardsV62(page);
  simplifyActiveSessionV62(page);
  simplifySettingsV62(page);
}
function scheduleSimpleUiV62() {
  requestAnimationFrame(() => {
    applySimpleUiV62();
    requestAnimationFrame(applySimpleUiV62);
  });
}
const switchTabBeforeV62 = switchTab;
switchTab = async function(tab) {
  await switchTabBeforeV62(tab);
  scheduleSimpleUiV62();
};
const renderActiveSessionViewBeforeV62 = renderActiveSessionView;
renderActiveSessionView = function() {
  renderActiveSessionViewBeforeV62();
  scheduleSimpleUiV62();
};
const renderCreateSessionViewBeforeV62 = renderCreateSessionView;
renderCreateSessionView = function() {
  renderCreateSessionViewBeforeV62();
  scheduleSimpleUiV62();
};
if (typeof renderHomeDashboardV35 === "function") {
  const renderHomeDashboardBeforeV62 = renderHomeDashboardV35;
  renderHomeDashboardV35 = function() {
    renderHomeDashboardBeforeV62();
    scheduleSimpleUiV62();
  };
}
if (typeof renderMatchDashboardV36 === "function") {
  const renderMatchDashboardBeforeV62 = renderMatchDashboardV36;
  renderMatchDashboardV36 = function() {
    renderMatchDashboardBeforeV62();
    scheduleSimpleUiV62();
  };
}
if (typeof renderSettingsPage === "function") {
  const renderSettingsPageBeforeV62 = renderSettingsPage;
  renderSettingsPage = function() {
    renderSettingsPageBeforeV62();
    scheduleSimpleUiV62();
  };
}
if (typeof renderMyPageV55 === "function") {
  const renderMyPageBeforeV62 = renderMyPageV55;
  renderMyPageV55 = function() {
    renderMyPageBeforeV62();
    scheduleSimpleUiV62();
  };
}
scheduleSimpleUiV62();


/* v63: reduce visual noise with a clear action strip and simple/detail switch */
const V63_DISPLAY_MODE_KEY = "moriken-v63-display-mode";
function getV63DisplayMode() {
  return localStorage.getItem(V63_DISPLAY_MODE_KEY) || "simple";
}
function setV63DisplayMode(mode) {
  localStorage.setItem(V63_DISPLAY_MODE_KEY, mode === "detail" ? "detail" : "simple");
}
function v63ScrollToElement(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}
function v63FindButtonByText(text) {
  return [...document.querySelectorAll("button")].find((button) => (button.textContent || "").trim().includes(text));
}
async function v63RunAction(action) {
  if (!action) return;
  if (action.tab && action.tab !== currentTab) {
    await switchTab(action.tab);
    requestAnimationFrame(() => v63RunAction({ ...action, tab: null }));
    return;
  }
  if (Number.isInteger(action.createStep)) {
    const target = document.querySelector(`[data-v40-go-step="${action.createStep}"]`);
    if (target && !target.disabled) target.click();
    v63ScrollToElement(document.querySelector(".create-wizard-progress-v40") || document.getElementById("createSessionForm"));
    return;
  }
  if (action.click) {
    const clickable = document.querySelector(action.click) || v63FindButtonByText(action.textClick || "");
    if (clickable && !clickable.disabled) clickable.click();
  }
  if (action.scroll) {
    requestAnimationFrame(() => v63ScrollToElement(document.querySelector(action.scroll)));
  }
}
function getV63PageKind() {
  if (currentTab === "game" && showCreateSession) return "game-create";
  if (currentTab === "game") return "game-active";
  return currentTab;
}
function getV63Actions() {
  const kind = getV63PageKind();
  const activeSessionOpen = activeMatchSession?.status === "open";
  const actions = {
    home: [
      { icon: "🀄", label: "対局開始", sub: "新しい日を作る", tab: "game" },
      { icon: "👤", label: "マイページ", sub: "自分の状況", tab: "my-page" },
      { icon: "💴", label: "精算", sub: "未精算を確認", tab: "hub-settlement" }
    ],
    "hub-game": [
      { icon: "🀄", label: "対局開始", sub: "新しい記録", tab: "game" },
      { icon: "📅", label: "履歴", sub: "過去の対局", tab: "history" },
      { icon: "▶", label: "進行中", sub: "入力へ戻る", tab: "game", scroll: "#liveInputPanel" }
    ],
    "game-create": [
      { icon: "1", label: "形式", sub: "打ち方", createStep: 0 },
      { icon: "2", label: "設定", sub: "日付・レート", createStep: 1 },
      { icon: "3", label: "参加者", sub: "メンバー", createStep: 2 },
      { icon: "4", label: "確認", sub: "開始", createStep: 3 }
    ],
    "game-active": [
      { icon: "🀄", label: activeSessionOpen ? "半荘" : "詳細", sub: activeSessionOpen ? "登録する" : "記録を見る", click: "#toggleHanchanEditorButton", scroll: "#liveInputPanel" },
      { icon: "表", label: "スコア表", sub: "点数推移", scroll: ".score-sheet-section" },
      { icon: "💴", label: "精算", sub: "送金確認", scroll: ".final-settlement-section" }
    ],
    "hub-analysis": [
      { icon: "👤", label: "マイページ", sub: "自分だけ", tab: "my-page" },
      { icon: "📈", label: "ランキング", sub: "全体成績", scroll: ".ranking-page, .ranking-section" },
      { icon: "🏠", label: "会場", sub: "場所別", scroll: ".venue-analytics-section" }
    ],
    "hub-settlement": [
      { icon: "💴", label: "未精算", sub: "一覧", scroll: ".debt-record-list" },
      { icon: "⇄", label: "まとめ直し", sub: "最短ルート", scroll: ".debt-consolidation-section" },
      { icon: "✓", label: "履歴", sub: "送金済み", click: "[data-debt-view='history']", scroll: ".debt-record-list" }
    ],
    settings: [
      { icon: "招", label: "招待", sub: "コード確認", scroll: ".settings-section" },
      { icon: "🏠", label: "会場", sub: "テンプレ", textClick: "会場", click: "[data-v42-settings-focus='daily']" },
      { icon: "🗄", label: "データ", sub: "保存・復元", click: "[data-v42-settings-focus='data']" }
    ],
    "my-page": [
      { icon: "📈", label: "成績", sub: "自分の推移", scroll: ".my-page-trend, .trend-chart-wrap" },
      { icon: "💴", label: "借pt", sub: "支払・受取", scroll: ".my-page-debt, .debt-summary-card" },
      { icon: "🀄", label: "最近", sub: "自分の対局", scroll: ".recent-session-list" }
    ],
    history: [
      { icon: "📅", label: "カレンダー", sub: "日付で探す", scroll: ".history-calendar-panel" },
      { icon: "🔎", label: "検索", sub: "条件指定", scroll: ".history-filter-panel" },
      { icon: "🀄", label: "対局一覧", sub: "記録を開く", scroll: ".history-session-list" }
    ]
  };
  return actions[kind] || [];
}
function addV63ActionStrip(page) {
  if (!page) return;
  page.querySelector(".v63-action-strip")?.remove();
  const focus = page.querySelector(".v62-focus-bar") || page.firstElementChild;
  const actions = getV63Actions();
  if (!focus || !actions.length) return;
  const strip = document.createElement("section");
  strip.className = "v63-action-strip";
  strip.innerHTML = `
    <div class="v63-action-copy">
      <p class="eyebrow">NEXT ACTION</p>
      <strong>よく使う操作</strong>
    </div>
    <div class="v63-action-buttons">
      ${actions.map((action, index) => `
        <button type="button" class="v63-action-button ${index === 0 ? "primary" : ""}" data-v63-action="${index}">
          <span class="v63-action-icon">${escapeHtml(action.icon)}</span>
          <span><strong>${escapeHtml(action.label)}</strong><small>${escapeHtml(action.sub || "")}</small></span>
        </button>
      `).join("")}
    </div>
  `;
  focus.insertAdjacentElement("afterend", strip);
  strip.querySelectorAll("[data-v63-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.v63Action);
      void v63RunAction(actions[index]);
    });
  });
}
function addV63ModeSwitch(page) {
  if (!page) return;
  const focus = page.querySelector(".v62-focus-bar");
  if (!focus || focus.querySelector(".v63-mode-switch")) return;
  const mode = getV63DisplayMode();
  const switcher = document.createElement("div");
  switcher.className = "v63-mode-switch";
  switcher.innerHTML = `
    <button type="button" class="${mode === "simple" ? "active" : ""}" data-v63-mode="simple">シンプル</button>
    <button type="button" class="${mode === "detail" ? "active" : ""}" data-v63-mode="detail">詳細</button>
  `;
  focus.appendChild(switcher);
  switcher.querySelectorAll("[data-v63-mode]").forEach((button) => button.addEventListener("click", () => {
    setV63DisplayMode(button.dataset.v63Mode);
    applyV63Ui();
  }));
}
function applyV63Density(page) {
  const mode = getV63DisplayMode();
  document.body.classList.toggle("v63-detail-mode", mode === "detail");
  document.body.classList.toggle("v63-simple-mode", mode !== "detail");
  if (!page) return;
  page.classList.add("v63-page");
  const isDetail = mode === "detail";
  page.querySelectorAll(".game-section-note, .workspace-description, .history-calendar-note, .ranking-note").forEach((note) => {
    if ((note.textContent || "").trim().length > 34) {
      note.classList.toggle("v63-note-compact", !isDetail);
    }
  });
  page.querySelectorAll(".secondary-button, .icon-text-button, .danger-outline-button").forEach((button) => {
    if (!button.closest(".v63-action-strip") && !button.closest(".create-wizard-controls-v40")) {
      button.classList.toggle("v63-secondary-action", !isDetail);
    }
  });
}
function applyV63Ui() {
  const page = getPageWorkspace?.();
  if (!page || page.hidden) return;
  addV63ActionStrip(page);
  addV63ModeSwitch(page);
  applyV63Density(page);
}
function scheduleV63Ui() {
  requestAnimationFrame(() => {
    applyV63Ui();
    requestAnimationFrame(applyV63Ui);
  });
}
const switchTabBeforeV63 = switchTab;
switchTab = async function(tab) {
  await switchTabBeforeV63(tab);
  scheduleV63Ui();
};
["renderActiveSessionView", "renderCreateSessionView", "renderSettingsPage", "renderMyPageV55", "renderHomeDashboardV35", "renderMatchDashboardV36", "renderHistoryPage", "renderDebtPage", "renderRankingPage"].forEach((name) => {
  if (typeof globalThis[name] === "function") {
    const previous = globalThis[name];
    globalThis[name] = function(...args) {
      const result = previous.apply(this, args);
      scheduleV63Ui();
      return result;
    };
  }
});
scheduleV63Ui();


/* v64: monthly titles and comeback simulator */
const V64_MONTHLY_TITLE_KEY = "moriken-v64-monthly-title-month";
const v64ComebackDraftBySession = {};

function getV64RankingMonths() {
  return [...new Set((rankingRaw.sessions || [])
    .map((session) => String(session.session_date || "").slice(0, 7))
    .filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
}
function getV64SelectedMonth() {
  const months = getV64RankingMonths();
  if (!months.length) return "";
  const saved = localStorage.getItem(V64_MONTHLY_TITLE_KEY) || "";
  return months.includes(saved) ? saved : months[0];
}
function setV64SelectedMonth(month) {
  localStorage.setItem(V64_MONTHLY_TITLE_KEY, month || "");
}
function formatV64MonthLabel(month) {
  if (!month) return "月を選択";
  const [year, monthNum] = String(month).split("-");
  return `${year}年${Number(monthNum)}月`;
}
function buildV64MonthlyTitleStats(month) {
  if (!month) return { entries: [], hanchanCount: 0, sessionCount: 0 };
  const sessions = (rankingRaw.sessions || []).filter((session) => String(session.session_date || "").startsWith(month));
  const sessionIds = new Set(sessions.map((session) => session.id));
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const membersBySession = new Map();
  const hanchansBySession = new Map();
  const resultsByHanchan = new Map();
  const chipsBySessionMember = new Map();
  (rankingRaw.sessionMembers || []).filter((member) => sessionIds.has(member.session_id)).forEach((member) => {
    if (!membersBySession.has(member.session_id)) membersBySession.set(member.session_id, []);
    membersBySession.get(member.session_id).push(member.member_id);
  });
  (rankingRaw.hanchans || []).filter((hanchan) => sessionIds.has(hanchan.session_id)).forEach((hanchan) => {
    if (!hanchansBySession.has(hanchan.session_id)) hanchansBySession.set(hanchan.session_id, []);
    hanchansBySession.get(hanchan.session_id).push(hanchan);
  });
  (rankingRaw.results || []).forEach((result) => {
    if (!resultsByHanchan.has(result.hanchan_id)) resultsByHanchan.set(result.hanchan_id, []);
    resultsByHanchan.get(result.hanchan_id).push(result);
  });
  (rankingRaw.chips || []).filter((chip) => sessionIds.has(chip.session_id)).forEach((chip) => {
    chipsBySessionMember.set(`${chip.session_id}:${chip.member_id}`, num(chip.chip_count));
  });

  const monthHanchanIds = new Set();
  (rankingRaw.hanchans || []).forEach((hanchan) => {
    if (sessionIds.has(hanchan.session_id)) monthHanchanIds.add(hanchan.id);
  });
  const yakumanByMember = new Map();
  (rankingRaw.yakumans || []).filter((record) => monthHanchanIds.has(record.hanchan_id)).forEach((record) => {
    yakumanByMember.set(record.winner_member_id, (yakumanByMember.get(record.winner_member_id) || 0) + 1);
  });

  const stats = new Map();
  const ensure = (memberId) => {
    if (!stats.has(memberId)) {
      stats.set(memberId, {
        memberId,
        displayName: getRankingMemberName(memberId),
        totalPt: 0,
        scorePt: 0,
        chipCount: 0,
        sessions: 0,
        hanchans: 0,
        rankSum: 0,
        firstCount: 0,
        lastCount: 0,
        yakumanCount: 0,
        bestSessionPt: null,
        worstSessionPt: null
      });
    }
    return stats.get(memberId);
  };

  sessions.forEach((session) => {
    const memberIds = membersBySession.get(session.id) || [];
    const sessionHanchans = hanchansBySession.get(session.id) || [];
    const hanchanTotalByMember = new Map();
    const sessionStatsByMember = new Map();
    sessionHanchans.forEach((hanchan) => {
      const results = (resultsByHanchan.get(hanchan.id) || []).filter((result) => memberIds.includes(result.member_id));
      if (!results.length) return;
      const maxRank = Math.max(...results.map((result) => num(result.rank)));
      results.forEach((result) => {
        hanchanTotalByMember.set(result.member_id, roundOne(num(hanchanTotalByMember.get(result.member_id)) + num(result.total_points)));
        if (!sessionStatsByMember.has(result.member_id)) sessionStatsByMember.set(result.member_id, { hanchans: 0, rankSum: 0, firstCount: 0, lastCount: 0 });
        const stat = sessionStatsByMember.get(result.member_id);
        stat.hanchans += 1;
        stat.rankSum += num(result.rank);
        if (num(result.rank) === 1) stat.firstCount += 1;
        if (num(result.rank) === maxRank) stat.lastCount += 1;
      });
    });
    const multiplier = num(sessionMap.get(session.id)?.rate_multiplier || session.rate_multiplier || 30);
    memberIds.forEach((memberId) => {
      const entry = ensure(memberId);
      const hanchanScore = roundOne(hanchanTotalByMember.get(memberId));
      const chipCount = num(chipsBySessionMember.get(`${session.id}:${memberId}`));
      const chipPt = roundTo(chipCount * num(session.chip_value) * multiplier, 2);
      const scorePt = roundTo(hanchanScore * multiplier, 2);
      const totalPt = roundTo(scorePt + chipPt, 2);
      const stat = sessionStatsByMember.get(memberId) || { hanchans: 0, rankSum: 0, firstCount: 0, lastCount: 0 };
      entry.totalPt = roundTo(entry.totalPt + totalPt, 2);
      entry.scorePt = roundTo(entry.scorePt + scorePt, 2);
      entry.chipCount = roundOne(entry.chipCount + chipCount);
      entry.sessions += 1;
      entry.hanchans += stat.hanchans;
      entry.rankSum += stat.rankSum;
      entry.firstCount += stat.firstCount;
      entry.lastCount += stat.lastCount;
      entry.bestSessionPt = entry.bestSessionPt === null ? totalPt : Math.max(entry.bestSessionPt, totalPt);
      entry.worstSessionPt = entry.worstSessionPt === null ? totalPt : Math.min(entry.worstSessionPt, totalPt);
    });
  });

  yakumanByMember.forEach((count, memberId) => {
    ensure(memberId).yakumanCount = count;
  });

  const entries = [...stats.values()].map((entry) => ({
    ...entry,
    averageRank: entry.hanchans ? roundTo(entry.rankSum / entry.hanchans, 2) : null,
    firstRate: entry.hanchans ? roundTo((entry.firstCount / entry.hanchans) * 100, 1) : null,
    lastRate: entry.hanchans ? roundTo((entry.lastCount / entry.hanchans) * 100, 1) : null,
    avoidLastRate: entry.hanchans ? roundTo(100 - (entry.lastCount / entry.hanchans) * 100, 1) : null
  })).filter((entry) => entry.sessions > 0 || entry.yakumanCount > 0);

  return { entries, hanchanCount: monthHanchanIds.size, sessionCount: sessions.length };
}
function v64TopEntries(entries, getter, direction = "max", options = {}) {
  const filtered = entries.filter((entry) => {
    const value = getter(entry);
    if (value === null || value === undefined || Number.isNaN(Number(value))) return false;
    if (options.minHanchans && num(entry.hanchans) < options.minHanchans) return false;
    if (options.positiveOnly && num(value) <= 0.004) return false;
    return true;
  });
  if (!filtered.length) return { entries: [], value: null };
  const values = filtered.map((entry) => num(getter(entry)));
  const target = direction === "min" ? Math.min(...values) : Math.max(...values);
  const winners = filtered.filter((entry) => nearlyEqual(getter(entry), target, 0.0001)).sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
  return { entries: winners, value: target };
}
function v64WinnerNames(winners) {
  return winners.map((entry) => escapeHtml(entry.displayName)).join(" / ");
}
function v64MonthlyTitleCard(title, icon, result, valueHtml, note, emptyText = "該当なし") {
  const hasWinner = result.entries.length && result.value !== null;
  return `<article class="v64-title-card ${hasWinner ? "" : "empty"}">
    <span class="v64-title-icon">${escapeHtml(icon)}</span>
    <div>
      <small>${escapeHtml(title)}</small>
      <strong>${hasWinner ? v64WinnerNames(result.entries) : escapeHtml(emptyText)}</strong>
      <b>${hasWinner ? valueHtml(result.value, result.entries) : "—"}</b>
      <em>${escapeHtml(note)}</em>
    </div>
  </article>`;
}
function renderV64MonthlyTitlesMarkup() {
  const months = getV64RankingMonths();
  if (!months.length) return "";
  const selectedMonth = getV64SelectedMonth();
  const stats = buildV64MonthlyTitleStats(selectedMonth);
  const entries = stats.entries;
  const minHanchans = stats.hanchanCount >= 6 ? 3 : 1;
  const titles = [
    v64MonthlyTitleCard("月間王者", "王", v64TopEntries(entries, (entry) => entry.totalPt), (value) => formatPtMarkup(value), "総合ptが最も高い"),
    v64MonthlyTitleCard("素点王", "点", v64TopEntries(entries, (entry) => entry.scorePt), (value) => formatPtMarkup(value), "チップを除いたゲームpt"),
    v64MonthlyTitleCard("チップ王", "枚", v64TopEntries(entries, (entry) => entry.chipCount, "max"), (value) => formatChipMarkup(value), "終了時チップの合計"),
    v64MonthlyTitleCard("トップ率王", "トップ", v64TopEntries(entries, (entry) => entry.firstRate, "max", { minHanchans }), (value) => `${formatNumber(value, 1)}%`, `${minHanchans}半荘以上で集計`),
    v64MonthlyTitleCard("ラス回避職人", "避", v64TopEntries(entries, (entry) => entry.avoidLastRate, "max", { minHanchans }), (value) => `${formatNumber(value, 1)}%`, `${minHanchans}半荘以上で集計`),
    v64MonthlyTitleCard("役満賞", "役", v64TopEntries(entries, (entry) => entry.yakumanCount, "max", { positiveOnly: true }), (value) => `${formatNumber(value, 0)}回`, "今月の役満記録")
  ].join("");
  return `<section class="game-section monthly-title-section-v64">
    <div class="game-section-heading">
      <div>
        <p class="game-section-title">月間タイトル</p>
        <p class="game-section-note">その月の成績から自動表彰します。場代は除外し、ゲームptだけで判定します。</p>
      </div>
      <select id="v64MonthlyTitleMonthSelect" class="ranking-member-select">
        ${months.map((month) => `<option value="${escapeHtml(month)}" ${month === selectedMonth ? "selected" : ""}>${escapeHtml(formatV64MonthLabel(month))}</option>`).join("")}
      </select>
    </div>
    <div class="v64-title-summary"><span>${escapeHtml(formatV64MonthLabel(selectedMonth))}</span><strong>${stats.sessionCount}会・${stats.hanchanCount}半荘</strong></div>
    <div class="v64-title-grid">${titles}</div>
  </section>`;
}
function mountV64MonthlyTitles() {
  const page = getPageWorkspace?.();
  if (!page || currentTab !== "ranking") return;
  if (page.querySelector(".monthly-title-section-v64")) return;
  const panel = page.querySelector(".ranking-control-panel");
  const markup = renderV64MonthlyTitlesMarkup();
  if (!panel || !markup) return;
  panel.insertAdjacentHTML("afterend", markup);
  const select = page.querySelector("#v64MonthlyTitleMonthSelect");
  select?.addEventListener("change", () => {
    setV64SelectedMonth(select.value);
    renderRankingPage();
  });
}

function getV64ComebackDraft() {
  const key = activeMatchSessionId || "no-session";
  if (!v64ComebackDraftBySession[key]) v64ComebackDraftBySession[key] = {};
  activeMatchMembers.forEach((member) => {
    if (v64ComebackDraftBySession[key][member.member_id] === undefined) v64ComebackDraftBySession[key][member.member_id] = 0;
  });
  return v64ComebackDraftBySession[key];
}
function resetV64ComebackDraft() {
  const key = activeMatchSessionId || "no-session";
  v64ComebackDraftBySession[key] = {};
  activeMatchMembers.forEach((member) => { v64ComebackDraftBySession[key][member.member_id] = 0; });
}
function buildV64CurrentSessionScoreEntries() {
  const totals = new Map(activeMatchMembers.map((member) => [member.member_id, 0]));
  activeHanchans.forEach((hanchan) => {
    getHanchanResults(hanchan.id).forEach((result) => {
      totals.set(result.member_id, roundOne(num(totals.get(result.member_id)) + num(result.total_points)));
    });
  });
  return activeMatchMembers.map((member) => {
    const hanchanScore = roundOne(totals.get(member.member_id));
    const chipScore = roundOne(getChipCount(member.member_id) * num(activeMatchSession?.chip_value));
    const currentScore = roundOne(hanchanScore + chipScore);
    return {
      memberId: member.member_id,
      displayName: getMemberName(member.member_id),
      hanchanScore,
      chipScore,
      currentScore
    };
  }).sort((a, b) => b.currentScore - a.currentScore || a.displayName.localeCompare(b.displayName, "ja"));
}
function renderV64ComebackProjectionMarkup() {
  const entries = buildV64CurrentSessionScoreEntries();
  const draft = getV64ComebackDraft();
  if (!entries.length) return `<p class="game-section-note">参加者を設定すると逆転条件を表示します。</p>`;
  const projected = entries.map((entry) => ({
    ...entry,
    nextScore: roundOne(num(draft[entry.memberId])),
    projectedScore: roundOne(entry.currentScore + num(draft[entry.memberId]))
  })).sort((a, b) => b.projectedScore - a.projectedScore || a.displayName.localeCompare(b.displayName, "ja"));
  const inputSum = roundOne(projected.reduce((sum, entry) => sum + num(entry.nextScore), 0));
  const rows = projected.map((entry, index) => `<div class="v64-projection-row ${index === 0 ? "leader" : ""}">
    <span>${index + 1}位　${escapeHtml(entry.displayName)}</span>
    <div><strong>${formatScoreMarkup(entry.projectedScore)}</strong><small>現在 ${formatScore(entry.currentScore)} ／ 仮 ${formatScore(entry.nextScore)}</small></div>
  </div>`).join("");
  return `<div class="v64-projection-box">
    <div class="v64-projection-heading"><strong>仮入力後の順位</strong><span class="${nearlyEqual(inputSum, 0) ? "status-ok" : "status-error"}">仮入力合計 ${formatScore(inputSum)}</span></div>
    ${rows}
    <p class="game-section-note">仮入力は保存されません。次の半荘の収支を入れると、終了時の並びを試算できます。</p>
  </div>`;
}
function renderV64ComebackSimulatorMarkup() {
  if (!activeMatchSession || !activeMatchMembers.length) return "";
  const entries = buildV64CurrentSessionScoreEntries();
  const draft = getV64ComebackDraft();
  const hanchanCount = activeHanchans.length;
  const leader = entries[0];
  const second = entries[1];
  const currentRows = entries.map((entry, index) => `<div class="v64-current-row ${index === 0 ? "leader" : ""}">
    <span>${index + 1}位　${escapeHtml(entry.displayName)}</span>
    <div><strong>${formatScoreMarkup(entry.currentScore)}</strong><small>半荘 ${formatScore(entry.hanchanScore)} ／ チップ ${formatScore(entry.chipScore)}</small></div>
  </div>`).join("");
  const conditionRows = entries.map((entry, index) => {
    if (index === 0) {
      const margin = second ? roundOne(entry.currentScore - second.currentScore) : 0;
      return `<article class="v64-condition-card leader"><strong>${escapeHtml(entry.displayName)}</strong><span>現在首位</span><small>2位との差：${formatScore(margin)}。この差を守れば首位維持。</small></article>`;
    }
    const gap = roundOne(leader.currentScore - entry.currentScore);
    const need = roundOne(gap + 0.1);
    return `<article class="v64-condition-card"><strong>${escapeHtml(entry.displayName)}</strong><span>首位まで ${formatScore(gap)}</span><small>次の半荘で ${escapeHtml(leader.displayName)} より ${formatScore(need)} 以上上回ると単独首位。</small></article>`;
  }).join("");
  const inputRows = entries.map((entry) => `<label class="v64-sim-input-row">
    <span>${escapeHtml(entry.displayName)}</span>
    <input class="signed-number-input ${inputValueClass(draft[entry.memberId] || 0)}" type="number" step="0.1" value="${escapeHtml(draft[entry.memberId] ?? 0)}" data-v64-comeback-member-id="${entry.memberId}">
    <small>次半荘</small>
  </label>`).join("");
  return `<section class="game-section comeback-simulator-section" id="comebackSimulatorSection">
    <div class="game-section-heading">
      <div>
        <p class="game-section-title">逆転シミュレーター</p>
        <p class="game-section-note">現在の総合収支から、最終半荘前の逆転条件を確認できます。チップ入力済みの場合はチップも含めます。</p>
      </div>
      <span class="section-side-note">${hanchanCount}半荘終了時点</span>
    </div>
    <div class="v64-simulator-layout">
      <div class="v64-sim-card"><div class="v64-sim-card-heading"><strong>現在順位</strong><small>ゲーム収支ベース</small></div>${currentRows}</div>
      <div class="v64-sim-card"><div class="v64-sim-card-heading"><strong>逆転条件</strong><small>次半荘で必要な差分</small></div><div class="v64-condition-grid">${conditionRows}</div></div>
      <div class="v64-sim-card v64-sim-input-card"><div class="v64-sim-card-heading"><strong>次半荘を仮入力</strong><button type="button" class="v64-mini-button" data-v64-reset-comeback>リセット</button></div><div class="v64-sim-input-list">${inputRows}</div><div id="v64ComebackProjection">${renderV64ComebackProjectionMarkup()}</div></div>
    </div>
  </section>`;
}
function refreshV64ComebackProjection() {
  const box = document.getElementById("v64ComebackProjection");
  if (box) box.innerHTML = renderV64ComebackProjectionMarkup();
}
function bindV64ComebackSimulator() {
  document.querySelectorAll("[data-v64-comeback-member-id]").forEach((input) => {
    input.addEventListener("input", () => {
      const draft = getV64ComebackDraft();
      draft[input.dataset.v64ComebackMemberId] = input.value === "" ? 0 : num(input.value);
      applySignedInputClass(input, draft[input.dataset.v64ComebackMemberId]);
      refreshV64ComebackProjection();
    });
  });
  document.querySelector("[data-v64-reset-comeback]")?.addEventListener("click", () => {
    resetV64ComebackDraft();
    document.querySelectorAll("[data-v64-comeback-member-id]").forEach((input) => {
      input.value = 0;
      applySignedInputClass(input, 0);
    });
    refreshV64ComebackProjection();
  });
}
function mountV64ComebackSimulator() {
  const page = getPageWorkspace?.();
  if (!page || currentTab !== "game" || showCreateSession || !activeMatchSession) return;
  if (page.querySelector(".comeback-simulator-section")) return;
  const anchor = page.querySelector(".score-sheet-section") || page.querySelector("#liveInputPanel") || page.querySelector(".final-settlement-section");
  const markup = renderV64ComebackSimulatorMarkup();
  if (!anchor || !markup) return;
  if (anchor.classList.contains("score-sheet-section")) anchor.insertAdjacentHTML("afterend", markup);
  else anchor.insertAdjacentHTML("afterend", markup);
  bindV64ComebackSimulator();
}
function scheduleV64Ui() {
  requestAnimationFrame(() => {
    mountV64MonthlyTitles();
    mountV64ComebackSimulator();
    if (typeof scheduleV63Ui === "function") scheduleV63Ui();
  });
}

const renderRankingPageBeforeV64 = renderRankingPage;
renderRankingPage = function(...args) {
  const result = renderRankingPageBeforeV64.apply(this, args);
  scheduleV64Ui();
  return result;
};
const renderActiveSessionViewBeforeV64 = renderActiveSessionView;
renderActiveSessionView = function(...args) {
  const result = renderActiveSessionViewBeforeV64.apply(this, args);
  scheduleV64Ui();
  return result;
};
const switchTabBeforeV64 = switchTab;
switchTab = async function(tab) {
  const result = await switchTabBeforeV64(tab);
  scheduleV64Ui();
  return result;
};
if (typeof getV63Actions === "function") {
  const getV63ActionsBeforeV64 = getV63Actions;
  getV63Actions = function() {
    const actions = getV63ActionsBeforeV64.apply(this, arguments).slice();
    const kind = typeof getV63PageKind === "function" ? getV63PageKind() : currentTab;
    if (kind === "game-active" && !actions.some((action) => action.label === "逆転")) {
      actions.splice(2, 0, { icon: "逆", label: "逆転", sub: "条件確認", scroll: ".comeback-simulator-section" });
    }
    if (kind === "hub-analysis" && !actions.some((action) => action.label === "月間")) {
      actions.splice(2, 0, { icon: "🏆", label: "月間", sub: "タイトル", tab: "ranking", scroll: ".monthly-title-section-v64" });
    }
    return actions;
  };
}
scheduleV64Ui();


/* v65: Moriken Rating - Elo based player strength indicator */
const V65_RATING_INITIAL = 1500;
const V65_RATING_K = 28;
const V65_RATING_SCORE_WEIGHT = 0.15;
const V65_RATING_SCORE_CAP = 6;
let ratingSelectedMemberIdV65 = "";

function clampV65(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function formatV65Rating(value) {
  return formatNumber(Math.round(num(value)), 0);
}
function formatV65RatingDelta(value) {
  const rounded = Math.round(num(value));
  return `${rounded > 0 ? "+" : ""}${formatNumber(rounded, 0)}`;
}
function ratingDeltaClassV65(value) {
  const v = Math.round(num(value));
  return v > 0 ? "positive" : v < 0 ? "negative" : "zero";
}
function getV65RatingTitle(value) {
  const rating = Math.round(num(value));
  if (rating >= 1900) return "森研最強位";
  if (rating >= 1800) return "雀聖";
  if (rating >= 1700) return "雀豪";
  if (rating >= 1600) return "強者";
  if (rating >= 1500) return "森研雀士";
  if (rating >= 1400) return "一般雀士";
  if (rating >= 1300) return "初級雀士";
  return "雀士見習い";
}
function getV65MemberName(memberId) {
  return getMemberName(memberId) || getRankingMemberName?.(memberId) || "不明なメンバー";
}
function getV65CurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}
function normalizeV65RatingSource(source) {
  const sessions = (source?.sessions || []).slice();
  const hanchans = (source?.hanchans || []).slice();
  const results = (source?.results || []).slice();
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const resultsByHanchan = new Map();
  results.forEach((result) => {
    if (!resultsByHanchan.has(result.hanchan_id)) resultsByHanchan.set(result.hanchan_id, []);
    resultsByHanchan.get(result.hanchan_id).push(result);
  });
  const orderedHanchans = hanchans
    .filter((hanchan) => sessionById.has(hanchan.session_id))
    .sort((a, b) => {
      const sessionA = sessionById.get(a.session_id) || {};
      const sessionB = sessionById.get(b.session_id) || {};
      const byDate = String(sessionA.session_date || "").localeCompare(String(sessionB.session_date || ""));
      if (byDate) return byDate;
      const byCreated = String(sessionA.created_at || "").localeCompare(String(sessionB.created_at || ""));
      if (byCreated) return byCreated;
      return num(a.sequence_no) - num(b.sequence_no);
    });
  return { sessions, hanchans: orderedHanchans, resultsByHanchan, sessionById };
}
function buildV65RatingDatasetFrom(source, options = {}) {
  const { sessions, hanchans, resultsByHanchan, sessionById } = normalizeV65RatingSource(source);
  const monthKey = options.monthKey || getV65CurrentMonthKey();
  const ratings = new Map();
  const entries = new Map();
  const hanchanEvents = [];
  const latestSessionId = hanchans.length ? hanchans[hanchans.length - 1]?.session_id : "";

  const ensureEntry = (memberId) => {
    if (!entries.has(memberId)) {
      entries.set(memberId, {
        memberId,
        displayName: getV65MemberName(memberId),
        rating: V65_RATING_INITIAL,
        totalDelta: 0,
        monthDelta: 0,
        latestSessionDelta: 0,
        hanchans: 0,
        rankSum: 0,
        firstCount: 0,
        lastCount: 0,
        highestRating: V65_RATING_INITIAL,
        lowestRating: V65_RATING_INITIAL,
        history: [],
        recent: []
      });
    }
    if (!ratings.has(memberId)) ratings.set(memberId, V65_RATING_INITIAL);
    return entries.get(memberId);
  };

  (activeGroupMembers || []).forEach((member) => {
    if (member?.id) ensureEntry(member.id);
  });

  hanchans.forEach((hanchan) => {
    const session = sessionById.get(hanchan.session_id) || {};
    const rows = (resultsByHanchan.get(hanchan.id) || [])
      .filter((row) => row.member_id)
      .map((row) => ({
        ...row,
        rank: num(row.rank),
        total: num(row.total_points)
      }));
    if (rows.length < 2) return;
    rows.forEach((row) => ensureEntry(row.member_id));

    const before = new Map(rows.map((row) => [row.member_id, num(ratings.get(row.member_id) ?? V65_RATING_INITIAL)]));
    const delta = new Map(rows.map((row) => [row.member_id, 0]));
    const pairK = V65_RATING_K / Math.max(1, rows.length - 1);

    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        let actualA = 0.5;
        if (a.rank < b.rank) actualA = 1;
        else if (a.rank > b.rank) actualA = 0;
        const ratingA = before.get(a.member_id);
        const ratingB = before.get(b.member_id);
        const expectedA = 1 / (1 + (10 ** ((ratingB - ratingA) / 400)));
        const expectedB = 1 - expectedA;
        delta.set(a.member_id, num(delta.get(a.member_id)) + pairK * (actualA - expectedA));
        delta.set(b.member_id, num(delta.get(b.member_id)) + pairK * ((1 - actualA) - expectedB));
      }
    }

    rows.forEach((row) => {
      const compensation = clampV65(row.total * V65_RATING_SCORE_WEIGHT, -V65_RATING_SCORE_CAP, V65_RATING_SCORE_CAP);
      delta.set(row.member_id, num(delta.get(row.member_id)) + compensation);
    });

    const playerCount = rows.length;
    const dateKey = String(session.session_date || "");
    rows.forEach((row) => {
      const entry = ensureEntry(row.member_id);
      const beforeRating = num(before.get(row.member_id));
      const change = roundTo(num(delta.get(row.member_id)), 2);
      const afterRating = roundTo(beforeRating + change, 2);
      ratings.set(row.member_id, afterRating);
      entry.rating = afterRating;
      entry.totalDelta = roundTo(afterRating - V65_RATING_INITIAL, 2);
      if (dateKey.startsWith(monthKey)) entry.monthDelta = roundTo(entry.monthDelta + change, 2);
      if (latestSessionId && hanchan.session_id === latestSessionId) entry.latestSessionDelta = roundTo(entry.latestSessionDelta + change, 2);
      entry.hanchans += 1;
      entry.rankSum += row.rank;
      if (row.rank === 1) entry.firstCount += 1;
      if (row.rank === playerCount) entry.lastCount += 1;
      entry.highestRating = Math.max(entry.highestRating, afterRating);
      entry.lowestRating = Math.min(entry.lowestRating, afterRating);
      const event = {
        memberId: row.member_id,
        displayName: entry.displayName,
        sessionId: hanchan.session_id,
        hanchanId: hanchan.id,
        sequenceNo: num(hanchan.sequence_no),
        date: session.session_date || "",
        label: `${formatDate(session.session_date)} 第${num(hanchan.sequence_no)}半荘`,
        rank: row.rank,
        total: row.total,
        beforeRating,
        afterRating,
        delta: change
      };
      entry.history.push(event);
      entry.recent.push(event);
      hanchanEvents.push(event);
    });
  });

  const playedEntries = [...entries.values()]
    .filter((entry) => entry.hanchans > 0)
    .map((entry) => ({
      ...entry,
      rating: roundTo(entry.rating, 2),
      totalDelta: roundTo(entry.totalDelta, 2),
      monthDelta: roundTo(entry.monthDelta, 2),
      latestSessionDelta: roundTo(entry.latestSessionDelta, 2),
      highestRating: roundTo(entry.highestRating, 2),
      lowestRating: roundTo(entry.lowestRating, 2),
      averageRank: entry.hanchans ? roundTo(entry.rankSum / entry.hanchans, 2) : null,
      firstRate: entry.hanchans ? roundTo((entry.firstCount / entry.hanchans) * 100, 1) : null,
      lastRate: entry.hanchans ? roundTo((entry.lastCount / entry.hanchans) * 100, 1) : null,
      recent: entry.recent.slice(-5).reverse()
    }))
    .sort((a, b) => b.rating - a.rating || b.hanchans - a.hanchans || a.displayName.localeCompare(b.displayName, "ja"));

  const latestSession = latestSessionId ? sessionById.get(latestSessionId) : null;
  return {
    entries: playedEntries,
    hanchanCount: hanchanEvents.length,
    sessionCount: sessions.length,
    latestSessionId,
    latestSessionDate: latestSession?.session_date || "",
    monthKey,
    events: hanchanEvents
  };
}
function buildV65RatingDataset() {
  return buildV65RatingDatasetFrom({
    sessions: rankingRaw.sessions || [],
    hanchans: rankingRaw.hanchans || [],
    results: rankingRaw.results || []
  });
}
function buildV65RatingTrendSvg(history) {
  const values = [V65_RATING_INITIAL, ...(history || []).map((item) => num(item.afterRating))];
  if (values.length <= 1) return `<p class="ranking-note">半荘を登録するとRating推移が表示されます。</p>`;
  const width = Math.max(620, 110 + (values.length - 1) * 58);
  const height = 220;
  const padX = 36;
  const padY = 24;
  const usableWidth = width - padX * 2;
  const usableHeight = height - padY * 2;
  const min = Math.min(...values, V65_RATING_INITIAL - 20);
  const max = Math.max(...values, V65_RATING_INITIAL + 20);
  const range = max - min || 1;
  const x = (index) => padX + (values.length <= 1 ? usableWidth / 2 : (usableWidth * index) / (values.length - 1));
  const y = (value) => padY + ((max - value) / range) * usableHeight;
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const labelInterval = Math.max(1, Math.ceil((values.length - 1) / 8));
  const labels = (history || []).map((item, index) => ((index === 0 || index === history.length - 1 || (index + 1) % labelInterval === 0)
    ? `<text x="${x(index + 1).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="trend-label">${escapeHtml(String(item.sequenceNo || index + 1))}</text>`
    : "")).join("");
  const circles = values.map((value, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${index === 0 ? 3 : 4}" class="trend-point"></circle>`).join("");
  return `<svg class="trend-svg rating-trend-svg-v65" viewBox="0 0 ${width} ${height}" role="img" aria-label="Rating推移"><line x1="${padX}" x2="${width - padX}" y1="${y(V65_RATING_INITIAL).toFixed(1)}" y2="${y(V65_RATING_INITIAL).toFixed(1)}" class="trend-zero"></line><polyline points="${points}" class="trend-line"></polyline>${circles}${labels}<text x="${padX}" y="${padY - 6}" class="trend-scale">${formatV65Rating(max)}</text><text x="${padX}" y="${height - padY + 14}" class="trend-scale">${formatV65Rating(min)}</text></svg>`;
}
function renderV65RatingRows(entries) {
  return entries.map((entry, index) => `
    <button type="button" class="v65-rating-row ${entry.memberId === ratingSelectedMemberIdV65 ? "selected" : ""}" data-v65-rating-member-id="${entry.memberId}">
      <span class="v65-rating-place">${index + 1}</span>
      <div class="v65-rating-player"><strong>${escapeHtml(entry.displayName)}</strong><small>${escapeHtml(getV65RatingTitle(entry.rating))} ／ ${entry.hanchans}半荘 ／ 平均順位 ${entry.averageRank ?? "-"}</small></div>
      <div class="v65-rating-main"><strong>${formatV65Rating(entry.rating)}</strong><small class="${ratingDeltaClassV65(entry.monthDelta)}">今月 ${formatV65RatingDelta(entry.monthDelta)}</small></div>
    </button>
  `).join("");
}
function renderV65RatingDetail(entry) {
  if (!entry) return "";
  const recentRows = entry.recent.length ? entry.recent.map((item) => `<div class="v65-rating-recent-row"><span>${escapeHtml(item.label)}</span><strong class="${ratingDeltaClassV65(item.delta)}">${formatV65RatingDelta(item.delta)}</strong></div>`).join("") : `<p class="ranking-note">直近のRating変動はまだありません。</p>`;
  return `<article class="v65-rating-detail">
    <div class="v65-rating-detail-head">
      <div><p class="eyebrow">PLAYER RATING</p><h3>${escapeHtml(entry.displayName)}</h3><small>${escapeHtml(getV65RatingTitle(entry.rating))}</small></div>
      <strong>${formatV65Rating(entry.rating)}</strong>
    </div>
    <div class="v65-rating-stat-grid">
      <div><span>通算変動</span><strong class="${ratingDeltaClassV65(entry.totalDelta)}">${formatV65RatingDelta(entry.totalDelta)}</strong></div>
      <div><span>今月変動</span><strong class="${ratingDeltaClassV65(entry.monthDelta)}">${formatV65RatingDelta(entry.monthDelta)}</strong></div>
      <div><span>最高Rating</span><strong>${formatV65Rating(entry.highestRating)}</strong></div>
      <div><span>最低Rating</span><strong>${formatV65Rating(entry.lowestRating)}</strong></div>
      <div><span>トップ率</span><strong>${entry.firstRate !== null ? `${entry.firstRate}%` : "-"}</strong></div>
      <div><span>ラス率</span><strong>${entry.lastRate !== null ? `${entry.lastRate}%` : "-"}</strong></div>
    </div>
    <div class="trend-chart-wrap v65-rating-trend-wrap">${buildV65RatingTrendSvg(entry.history)}</div>
    <div class="v65-rating-recent-list"><div class="v65-mini-heading"><strong>直近5半荘の変動</strong><small>順位Elo＋収支補正</small></div>${recentRows}</div>
  </article>`;
}
function renderV65RatingSectionMarkup() {
  const data = buildV65RatingDataset();
  if (!data.entries.length) return "";
  if (!data.entries.some((entry) => entry.memberId === ratingSelectedMemberIdV65)) ratingSelectedMemberIdV65 = data.entries[0]?.memberId || "";
  const selected = data.entries.find((entry) => entry.memberId === ratingSelectedMemberIdV65) || data.entries[0];
  const top = data.entries[0];
  const latestRows = data.entries
    .filter((entry) => Math.abs(num(entry.latestSessionDelta)) > 0.004)
    .sort((a, b) => b.latestSessionDelta - a.latestSessionDelta)
    .slice(0, 4)
    .map((entry) => `<span><b>${escapeHtml(entry.displayName)}</b><strong class="${ratingDeltaClassV65(entry.latestSessionDelta)}">${formatV65RatingDelta(entry.latestSessionDelta)}</strong></span>`)
    .join("");
  return `<section class="game-section rating-section-v65" id="morikenRatingSection">
    <div class="game-section-heading">
      <div>
        <p class="game-section-title">森研Rating</p>
        <p class="game-section-note">順位Eloを基準に、半荘収支を±6まで補正します。場代・借pt・レート倍率・チップは除外します。</p>
      </div>
      <span class="section-side-note">K=28 / 初期1500</span>
    </div>
    <div class="v65-rating-summary">
      <article><span>現在1位</span><strong>${escapeHtml(top.displayName)} ${formatV65Rating(top.rating)}</strong><small>${escapeHtml(getV65RatingTitle(top.rating))}</small></article>
      <article><span>対象</span><strong>${data.sessionCount}日・${data.hanchanCount}半荘</strong><small>精算済み対局から再計算</small></article>
      <article><span>直近日次変動</span><strong>${data.latestSessionDate ? escapeHtml(formatDate(data.latestSessionDate)) : "-"}</strong><small>半荘追加・編集で自動更新</small></article>
    </div>
    ${latestRows ? `<div class="v65-latest-delta-strip">${latestRows}</div>` : ""}
    <div class="v65-rating-layout">
      <div class="v65-rating-ranking">${renderV65RatingRows(data.entries)}</div>
      ${renderV65RatingDetail(selected)}
    </div>
  </section>`;
}
function bindV65RatingSection() {
  document.querySelectorAll("[data-v65-rating-member-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ratingSelectedMemberIdV65 = button.dataset.v65RatingMemberId;
      const section = document.querySelector(".rating-section-v65");
      if (section) {
        section.outerHTML = renderV65RatingSectionMarkup();
        bindV65RatingSection();
        requestAnimationFrame(() => document.querySelector(".rating-section-v65")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    });
  });
}
function mountV65RatingSection() {
  const page = getPageWorkspace?.();
  if (!page || currentTab !== "ranking") return;
  page.querySelector(".rating-section-v65")?.remove();
  const markup = renderV65RatingSectionMarkup();
  if (!markup) return;
  const anchor = page.querySelector(".monthly-title-section-v64") || page.querySelector(".ranking-control-panel");
  if (anchor) anchor.insertAdjacentHTML("afterend", markup);
  else page.insertAdjacentHTML("beforeend", markup);
  bindV65RatingSection();
}
function mountV65MyPageRating() {
  const page = getPageWorkspace?.();
  if (!page || currentTab !== "my-page" || !myPageDataV55?.loaded || myPageDataV55?.loading) return;
  page.querySelector(".my-page-rating-section-v65")?.remove();
  const self = getSelfMemberV55?.();
  if (!self) return;
  const data = buildV65RatingDatasetFrom({
    sessions: myPageDataV55.sessions || [],
    hanchans: myPageDataV55.hanchans || [],
    results: myPageDataV55.results || []
  });
  const entry = data.entries.find((item) => item.memberId === self.id);
  if (!entry) return;
  const rankingIndex = data.entries.findIndex((item) => item.memberId === self.id);
  const recentRows = entry.recent.length ? entry.recent.map((item) => `<div class="v65-rating-recent-row"><span>${escapeHtml(item.label)}</span><strong class="${ratingDeltaClassV65(item.delta)}">${formatV65RatingDelta(item.delta)}</strong></div>`).join("") : `<p class="ranking-note">直近のRating変動はまだありません。</p>`;
  const markup = `<section class="v41-recent-section my-page-section-v57 my-page-rating-section-v65">
    <div class="v41-section-heading"><div><p class="eyebrow">MORIKEN RATING</p><h3>自分の森研Rating</h3></div><button type="button" data-v65-go-rating>全体を見る</button></div>
    <div class="v65-my-rating-hero">
      <div><span>現在Rating</span><strong>${formatV65Rating(entry.rating)}</strong><small>${rankingIndex >= 0 ? `${rankingIndex + 1}位 ／ ` : ""}${escapeHtml(getV65RatingTitle(entry.rating))}</small></div>
      <div><span>今月変動</span><strong class="${ratingDeltaClassV65(entry.monthDelta)}">${formatV65RatingDelta(entry.monthDelta)}</strong><small>半荘ごとに自動再計算</small></div>
      <div><span>最高 / 最低</span><strong>${formatV65Rating(entry.highestRating)} / ${formatV65Rating(entry.lowestRating)}</strong><small>通算Rating幅</small></div>
    </div>
    <div class="trend-chart-wrap v65-rating-trend-wrap">${buildV65RatingTrendSvg(entry.history)}</div>
    <div class="v65-rating-recent-list"><div class="v65-mini-heading"><strong>直近5半荘</strong><small>Rating変動</small></div>${recentRows}</div>
  </section>`;
  const anchor = page.querySelector(".my-page-kpi-grid") || page.querySelector(".my-page-debt-panel") || page.querySelector(".my-page-card");
  if (anchor) anchor.insertAdjacentHTML("afterend", markup);
  page.querySelector("[data-v65-go-rating]")?.addEventListener("click", async () => {
    await openNavigationFeatureV34("ranking");
    requestAnimationFrame(() => document.querySelector(".rating-section-v65")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });
}
function scheduleV65Ui() {
  requestAnimationFrame(() => {
    mountV65RatingSection();
    mountV65MyPageRating();
  });
}

const renderRankingPageBeforeV65 = renderRankingPage;
renderRankingPage = function(...args) {
  const result = renderRankingPageBeforeV65.apply(this, args);
  scheduleV65Ui();
  return result;
};
if (typeof renderMyPageV55 === "function") {
  const renderMyPageBeforeV65 = renderMyPageV55;
  renderMyPageV55 = function(...args) {
    const result = renderMyPageBeforeV65.apply(this, args);
    scheduleV65Ui();
    return result;
  };
}
const switchTabBeforeV65 = switchTab;
switchTab = async function(tab) {
  const result = await switchTabBeforeV65(tab);
  scheduleV65Ui();
  return result;
};
if (typeof getV63Actions === "function") {
  const getV63ActionsBeforeV65 = getV63Actions;
  getV63Actions = function() {
    const actions = getV63ActionsBeforeV65.apply(this, arguments).slice();
    const kind = typeof getV63PageKind === "function" ? getV63PageKind() : currentTab;
    if (kind === "hub-analysis" && !actions.some((action) => action.label === "Rating")) {
      actions.splice(2, 0, { icon: "R", label: "Rating", sub: "実力指標", tab: "ranking", scroll: ".rating-section-v65" });
    }
    if (kind === "my-page" && !actions.some((action) => action.label === "Rating")) {
      actions.splice(1, 0, { icon: "R", label: "Rating", sub: "自分の実力", scroll: ".my-page-rating-section-v65" });
    }
    return actions;
  };
}
scheduleV65Ui();

/* v66: Daily Sanma "What would you discard?" challenge */
const V66_NANIKIRU_DATE_KEY = "moriken-nanikiru-date";
let nanikiruStateV66 = {
  groupId: "",
  date: "",
  loading: false,
  loaded: false,
  submitting: false,
  error: "",
  answerError: "",
  data: null,
  selectedSlot: 1,
  selectedTile: ""
};
let nanikiruRealtimeChannelV66 = null;
let nanikiruRealtimeGroupIdV66 = null;
let nanikiruRealtimeTimerV66 = null;

const V66_DIFFICULTY_LABELS = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
  oni: "鬼"
};
const V66_CATEGORY_LABELS = {
  efficiency: "牌効率",
  all_red: "全赤",
  flower_north: "華・北",
  riichi_chip: "リーチ・チップ",
  defense: "押し引き",
  special: "特殊条件"
};
const V66_RESULT_LABELS = {
  best: "最善打",
  acceptable: "有力打",
  wrong: "不正解"
};
const V66_HONOR_LABELS = {
  "1z": "東",
  "2z": "南",
  "3z": "西",
  "4z": "北",
  "5z": "白",
  "6z": "發",
  "7z": "中"
};
const V66_FLOWER_LABELS = {
  F1: "春",
  F2: "夏",
  F3: "秋",
  F4: "冬"
};

function resetNanikiruStateV66(groupId = "") {
  nanikiruStateV66 = {
    groupId,
    date: todayInJapan(),
    loading: false,
    loaded: false,
    submitting: false,
    error: "",
    answerError: "",
    data: null,
    selectedSlot: 1,
    selectedTile: ""
  };
}

function normalizeNanikiruPayloadV66(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    try { return JSON.parse(payload); } catch (_) { return null; }
  }
  return payload;
}

function getNanikiruQuestionsV66() {
  return Array.isArray(nanikiruStateV66.data?.questions) ? nanikiruStateV66.data.questions : [];
}

function getNanikiruQuestionV66(slot = nanikiruStateV66.selectedSlot) {
  return getNanikiruQuestionsV66().find((question) => Number(question.slotNo) === Number(slot)) || null;
}

function setDefaultNanikiruSlotV66() {
  const questions = getNanikiruQuestionsV66();
  if (!questions.length) {
    nanikiruStateV66.selectedSlot = 1;
    return;
  }
  if (questions.some((question) => Number(question.slotNo) === Number(nanikiruStateV66.selectedSlot))) return;
  const firstUnanswered = questions.find((question) => !question.myAttempt);
  nanikiruStateV66.selectedSlot = Number(firstUnanswered?.slotNo || questions[0].slotNo || 1);
}

function tileInfoV66(codeValue) {
  const code = String(codeValue || "").trim();
  if (V66_FLOWER_LABELS[code]) return { code, label: V66_FLOWER_LABELS[code], main: V66_FLOWER_LABELS[code], sub: "華", suit: "flower", red: false };
  if (V66_HONOR_LABELS[code]) return { code, label: V66_HONOR_LABELS[code], main: V66_HONOR_LABELS[code], sub: "", suit: "honor", red: false };
  const match = code.match(/^([1-9])([mps])(r?)$/i);
  if (!match) return { code, label: code || "?", main: code || "?", sub: "", suit: "unknown", red: false };
  const [, number, suitCode, redFlag] = match;
  const suitLabel = suitCode === "m" ? "萬" : suitCode === "p" ? "筒" : "索";
  return {
    code,
    label: `${redFlag ? "赤" : ""}${number}${suitLabel}`,
    main: number,
    sub: suitLabel,
    suit: suitCode,
    red: Boolean(redFlag)
  };
}

const V67_TILE_ASSET_BASE = "./assets/mahjong";

function tileAssetPathV67(codeValue) {
  const code = String(codeValue || "").trim();
  if (V66_FLOWER_LABELS[code]) return `${V67_TILE_ASSET_BASE}/blank.gif`;
  if (V66_HONOR_LABELS[code]) return `${V67_TILE_ASSET_BASE}/${code}.gif`;
  const match = code.match(/^([1-9])([mps])(r?)$/i);
  if (!match) return "";
  const number = match[1];
  const suit = match[2].toLowerCase();
  const red = Boolean(match[3]);
  if (number === "5" && (suit === "p" || suit === "s")) {
    return `${V67_TILE_ASSET_BASE}/5${suit}r.gif`;
  }
  return `${V67_TILE_ASSET_BASE}/${number}${suit}${red ? "r" : ""}.gif`;
}

function renderNanikiruTileV66(code, options = {}) {
  const info = tileInfoV66(code);
  const sizeClass = options.small ? "small" : options.large ? "large" : "";
  const assetPath = tileAssetPathV67(info.code);
  if (assetPath) {
    const flowerGlyph = info.suit === "flower"
      ? `<span class="v67-flower-glyph" aria-hidden="true">${escapeHtml(info.main)}</span>`
      : "";
    return `<span class="v66-mahjong-tile has-tile-image suit-${info.suit} ${info.red ? "is-red" : ""} ${sizeClass}" aria-label="${escapeHtml(info.label)}" title="${escapeHtml(info.label)}"><img src="${assetPath}" alt="" aria-hidden="true" decoding="async">${flowerGlyph}</span>`;
  }
  return `<span class="v66-mahjong-tile suit-${info.suit} ${info.red ? "is-red" : ""} ${sizeClass}" aria-label="${escapeHtml(info.label)}" title="${escapeHtml(info.label)}"><b>${escapeHtml(info.main)}</b>${info.sub ? `<small>${escapeHtml(info.sub)}</small>` : ""}${info.red ? '<i>赤</i>' : ""}</span>`;
}

function renderNanikiruTilesV66(codes, options = {}) {
  return (Array.isArray(codes) ? codes : []).map((code) => renderNanikiruTileV66(code, options)).join("");
}

function formatNanikiruScoreV66(value) {
  const score = num(value);
  return Number.isInteger(score) ? String(score) : formatNumber(score, 1);
}

function getNanikiruResultClassV66(resultType) {
  return resultType === "best" ? "best" : resultType === "acceptable" ? "acceptable" : "wrong";
}

function formatNanikiruContextV66(contextValue) {
  const context = contextValue && typeof contextValue === "object" ? contextValue : {};
  const windLabels = { east: "東", south: "南", west: "西", north: "北" };
  const pieces = [];
  if (context.roundWind) pieces.push(`${windLabels[context.roundWind] || context.roundWind}場`);
  if (context.seatWind) pieces.push(`${windLabels[context.seatWind] || context.seatWind}家`);
  if (context.turn) pieces.push(`${context.turn}巡目`);
  if (context.handState === "two_shanten") pieces.push("二向聴");
  if (context.closedHand) pieces.push("門前");
  if (context.flowerHan) pieces.push(`華${context.flowerHan}翻`);
  if (context.fourFlowersYakuman) pieces.push("四華和条件");
  return pieces;
}

function renderNanikiruSituationDetailsV66(question) {
  const context = question.context && typeof question.context === "object" ? question.context : {};
  const chips = [];
  const contextPieces = formatNanikiruContextV66(context);
  contextPieces.forEach((piece) => chips.push(`<span>${escapeHtml(piece)}</span>`));
  if (context.allRed) chips.push("<span>全赤</span>");
  if (context.northIsCommonYakuhai) chips.push("<span>北＝共通役牌</span>");
  if (Array.isArray(context.chipTargets) && context.chipTargets.length) chips.push("<span>一発・裏チップ</span>");
  if (Array.isArray(context.opponentActions) && context.opponentActions.some((item) => item?.action === "riichi")) chips.push("<span>他家リーチあり</span>");

  const detailRows = [];
  if (context.visibleTiles && typeof context.visibleTiles === "object") {
    const visible = Object.entries(context.visibleTiles).map(([tile, count]) => `${tileInfoV66(tile).label} ${count}枚見え`).join(" ／ ");
    if (visible) detailRows.push(`<div><span>見えている牌</span><strong>${escapeHtml(visible)}</strong></div>`);
  }
  if (context.points && typeof context.points === "object") {
    const seatLabels = { self: "自分", east: "東家", south: "南家", west: "西家", north: "北家" };
    const points = Object.entries(context.points).map(([seat, value]) => `${seatLabels[seat] || seat} ${formatNumber(value, 0)}点`).join(" ／ ");
    if (points) detailRows.push(`<div><span>点棒状況</span><strong>${escapeHtml(points)}</strong></div>`);
  }
  if (context.note) detailRows.push(`<div><span>補足</span><strong>${escapeHtml(context.note)}</strong></div>`);

  return `${chips.length ? `<div class="v66-context-chips">${chips.join("")}</div>` : ""}${detailRows.length ? `<div class="v66-context-details">${detailRows.join("")}</div>` : ""}`;
}

function renderNanikiruDistributionV66(reveal) {
  const distribution = Array.isArray(reveal?.distribution) ? reveal.distribution : [];
  if (!distribution.length) return `<p class="v66-empty-note">まだ回答分布はありません。</p>`;
  const total = distribution.reduce((sum, item) => sum + num(item.count), 0) || 1;
  return `<div class="v66-distribution-list">${distribution.map((item) => {
    const percent = Math.round((num(item.count) / total) * 100);
    return `<div class="v66-distribution-row"><div class="v66-distribution-tile">${renderNanikiruTileV66(item.tile, { small: true })}<strong>${escapeHtml(tileInfoV66(item.tile).label)}</strong></div><div class="v66-distribution-meter"><span style="width:${percent}%"></span></div><b>${num(item.count)}人<br><small>${percent}%</small></b></div>`;
  }).join("")}</div>`;
}

function renderNanikiruMemberNamesV66(names, emptyText) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (!list.length) return `<span class="v66-member-empty">${escapeHtml(emptyText)}</span>`;
  return list.map((name) => `<span class="v66-member-chip">${escapeHtml(name)}</span>`).join("");
}

function renderNanikiruRevealV66(question) {
  const attempt = question.myAttempt;
  const reveal = question.reveal || {};
  const explanation = reveal.explanation && typeof reveal.explanation === "object" ? reveal.explanation : {};
  const resultClass = getNanikiruResultClassV66(attempt?.resultType);
  const resultLabel = V66_RESULT_LABELS[attempt?.resultType] || "判定済み";
  const bestTiles = Array.isArray(reveal.bestTiles) ? reveal.bestTiles : [];
  const acceptableTiles = Array.isArray(reveal.acceptableTiles) ? reveal.acceptableTiles : [];
  const sections = [
    ["牌効率", explanation.efficiency],
    ["打点・価値", explanation.value],
    ["チップ", explanation.chip],
    ["守備", explanation.defense]
  ].filter(([, value]) => value);

  return `<section class="v66-answer-reveal ${resultClass}">
    <div class="v66-result-banner">
      <div><span>あなたの回答</span><div>${renderNanikiruTileV66(attempt?.selectedTile, { large: true })}<strong>${escapeHtml(tileInfoV66(attempt?.selectedTile).label)}</strong></div></div>
      <p><small>判定</small><strong>${escapeHtml(resultLabel)}</strong><em>${formatNanikiruScoreV66(attempt?.score)}点</em></p>
    </div>
    <div class="v66-correct-answer-box">
      <div><span>最善打</span><div class="v66-answer-tile-line">${renderNanikiruTilesV66(bestTiles, { large: true })}<strong>${bestTiles.map((tile) => tileInfoV66(tile).label).join("・")}</strong></div></div>
      ${acceptableTiles.length ? `<div><span>有力打</span><div class="v66-answer-tile-line">${renderNanikiruTilesV66(acceptableTiles)}<strong>${acceptableTiles.map((tile) => tileInfoV66(tile).label).join("・")}</strong></div></div>` : ""}
    </div>
    <article class="v66-explanation-card">
      <div class="v66-section-title"><p class="eyebrow">ANSWER</p><h3>${escapeHtml(explanation.summary || "解説")}</h3></div>
      ${sections.map(([label, value]) => `<section><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value)}</p></section>`).join("")}
    </article>
    <div class="v66-community-grid">
      <article><span>最善打を選んだ人</span><div class="v66-member-list">${renderNanikiruMemberNamesV66(reveal.bestMembers, "まだいません")}</div></article>
      ${Array.isArray(reveal.acceptableMembers) && reveal.acceptableMembers.length ? `<article><span>有力打を選んだ人</span><div class="v66-member-list">${renderNanikiruMemberNamesV66(reveal.acceptableMembers, "まだいません")}</div></article>` : ""}
    </div>
    <article class="v66-distribution-card"><div class="v66-section-title"><p class="eyebrow">GROUP ANSWERS</p><h3>みんなが切った牌</h3></div>${renderNanikiruDistributionV66(reveal)}</article>
    <div class="v66-question-footer-actions"><button type="button" class="primary-button" data-v66-next-question>次の問題へ</button><button type="button" class="secondary-button" data-v66-question-list>10問の一覧を見る</button></div>
  </section>`;
}

function renderNanikiruAnswerFormV66(question) {
  const selected = nanikiruStateV66.selectedTile;
  return `<section class="v66-answer-panel">
    <div class="v66-section-title"><p class="eyebrow">YOUR DISCARD</p><h3>何を切る？</h3><small>牌を選んでから回答を確定してください。</small></div>
    <div class="v66-answer-options">${(question.answerOptions || []).map((tile) => `<button type="button" class="v66-answer-option ${selected === tile ? "selected" : ""}" data-v66-answer-tile="${escapeHtml(tile)}" aria-pressed="${selected === tile ? "true" : "false"}">${renderNanikiruTileV66(tile, { large: true })}<strong>${escapeHtml(tileInfoV66(tile).label)}</strong></button>`).join("")}</div>
    ${nanikiruStateV66.answerError ? `<p class="v66-answer-error">${escapeHtml(nanikiruStateV66.answerError)}</p>` : ""}
    <button type="button" class="v66-submit-answer" data-v66-submit-answer ${selected && !nanikiruStateV66.submitting ? "" : "disabled"}>${nanikiruStateV66.submitting ? "判定中..." : selected ? `${escapeHtml(tileInfoV66(selected).label)}を切る` : "切る牌を選択"}</button>
    <p class="v66-answer-count">現在 ${num(question.answeredCount)}人が回答済みです。回答前は他のメンバーの選択を表示しません。</p>
  </section>`;
}

function renderNanikiruQuestionV66(question) {
  if (!question) return `<section class="workspace-card"><h2>問題がありません</h2><p class="workspace-description">出題データを確認してください。</p></section>`;
  const difficulty = V66_DIFFICULTY_LABELS[question.difficulty] || question.difficulty || "難易度未設定";
  const category = V66_CATEGORY_LABELS[question.category] || question.category || "三麻";
  const dora = Array.isArray(question.doraIndicators) ? question.doraIndicators : [];
  const flowers = Array.isArray(question.selfFlowers) ? question.selfFlowers : [];

  return `<article class="v66-question-card" data-v66-question-card>
    <header class="v66-question-heading">
      <div><p class="eyebrow">QUESTION ${Number(question.slotNo) || "-"} / ${num(nanikiruStateV66.data?.summary?.scheduledCount) || 10}</p><h2>${escapeHtml(question.title || "今日の何切る？")}</h2></div>
      <div class="v66-question-badges"><span class="difficulty-${escapeHtml(question.difficulty || "beginner")}">${escapeHtml(difficulty)}</span><span>${escapeHtml(category)}</span></div>
    </header>
    <p class="v66-situation-text">${escapeHtml(question.situationText || "")}</p>
    ${renderNanikiruSituationDetailsV66(question)}
    <section class="v66-table-state">
      <div class="v66-state-block"><span>ドラ表示牌</span><div class="v66-mini-tile-row">${dora.length ? renderNanikiruTilesV66(dora) : "<em>なし</em>"}</div></div>
      <div class="v66-state-block"><span>抜き華</span><div class="v66-mini-tile-row">${flowers.length ? renderNanikiruTilesV66(flowers) : "<em>なし</em>"}</div></div>
      <div class="v66-rule-reminder"><strong>森研三麻</strong><small>全赤・華強制抜き・北は共通役牌・ツモ損あり</small></div>
    </section>
    <section class="v66-hand-area">
      <div class="v66-hand-label"><span>手牌</span><small>横にスクロールできます</small></div>
      <div class="v66-hand-scroll"><div class="v66-hand-tiles">${renderNanikiruTilesV66(question.handTiles, { large: true })}<span class="v66-drawn-gap"></span><div class="v66-drawn-tile"><small>ツモ</small>${renderNanikiruTileV66(question.drawnTile, { large: true })}</div></div></div>
    </section>
    ${question.myAttempt ? renderNanikiruRevealV66(question) : renderNanikiruAnswerFormV66(question)}
  </article>`;
}

function renderNanikiruSlotNavigationV66(questions) {
  return `<div class="v66-slot-navigation" data-v66-question-list-anchor>${questions.map((question) => {
    const attempt = question.myAttempt;
    const active = Number(question.slotNo) === Number(nanikiruStateV66.selectedSlot);
    const resultClass = attempt ? getNanikiruResultClassV66(attempt.resultType) : "unanswered";
    return `<button type="button" class="v66-slot-button ${active ? "active" : ""} ${resultClass}" data-v66-slot="${Number(question.slotNo)}"><span>${Number(question.slotNo)}</span><small>${attempt ? (attempt.resultType === "best" ? "○" : attempt.resultType === "acceptable" ? "△" : "×") : "未"}</small></button>`;
  }).join("")}</div>`;
}

function renderNanikiruPageV66() {
  const page = getPageWorkspace();
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  page.hidden = false;
  setPrimaryNavActiveV34("analytics");

  if (!currentSession || !activeGroupId) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DAILY QUIZ</p><h2>ログインが必要です</h2><p class="workspace-description">ログインしてグループに参加すると、今日の何切る？に回答できます。</p></section>`;
    return;
  }
  if (nanikiruStateV66.loading && !nanikiruStateV66.loaded) {
    page.innerHTML = `<section class="workspace-card loading-card">今日の何切る？を読み込み中...</section>`;
    return;
  }
  if (nanikiruStateV66.error && !nanikiruStateV66.loaded) {
    page.innerHTML = `<section class="workspace-card"><p class="eyebrow">DAILY QUIZ</p><h2>問題を読み込めませんでした</h2><p class="workspace-description">${escapeHtml(nanikiruStateV66.error)}</p><button type="button" class="primary-button" data-v66-retry>再読み込み</button></section>`;
    page.querySelector("[data-v66-retry]")?.addEventListener("click", () => void loadNanikiruDataV66(true));
    return;
  }

  const data = nanikiruStateV66.data;
  const questions = getNanikiruQuestionsV66();
  const summary = data?.summary || {};
  const scheduled = num(summary.scheduledCount);
  const answered = num(summary.answeredCount);
  const completion = scheduled ? Math.min(100, Math.round((answered / scheduled) * 100)) : 0;
  const question = getNanikiruQuestionV66();

  page.innerHTML = `<section class="v66-nanikiru-page">
    <header class="v66-page-hero">
      <div><p class="eyebrow">DAILY SANMA CHALLENGE</p><h1>今日の何切る？</h1><p>全赤・華あり・チップありの森研三麻。1日10問で判断力を磨きます。</p></div>
      <button type="button" class="v66-refresh-button" data-v66-refresh>更新</button>
    </header>
    <section class="v66-progress-card">
      <div class="v66-progress-main"><span>本日の進捗</span><strong>${answered}<small> / ${scheduled || 10}問</small></strong><div class="v66-progress-track"><i style="width:${completion}%"></i></div></div>
      <div class="v66-progress-stat"><span>最善打</span><strong>${num(summary.bestCount)}</strong></div>
      <div class="v66-progress-stat"><span>有力打</span><strong>${num(summary.acceptableCount)}</strong></div>
      <div class="v66-progress-stat"><span>得点</span><strong>${formatNanikiruScoreV66(summary.score)}<small>点</small></strong></div>
      <div class="v66-progress-stat"><span>連続完走</span><strong>${num(summary.completionStreak)}<small>日</small></strong></div>
    </section>
    ${data?.message ? `<p class="v66-page-message">${escapeHtml(data.message)}</p>` : ""}
    <section class="v66-question-index"><div class="v66-section-title"><p class="eyebrow">TODAY'S 10</p><h3>問題を選ぶ</h3><small>○ 最善打　△ 有力打　× 不正解</small></div>${renderNanikiruSlotNavigationV66(questions)}</section>
    ${renderNanikiruQuestionV66(question)}
  </section>`;
  bindNanikiruPageEventsV66(page);
  mountViewContextV34("analytics", "今日の何切る？", "森研三麻・1日10問");
  if (typeof scheduleSimpleUiV62 === "function") scheduleSimpleUiV62();
  if (typeof scheduleV63Ui === "function") scheduleV63Ui();
}

function bindNanikiruPageEventsV66(page) {
  page.querySelector("[data-v66-refresh]")?.addEventListener("click", () => void loadNanikiruDataV66(true));
  page.querySelectorAll("[data-v66-slot]").forEach((button) => button.addEventListener("click", () => {
    nanikiruStateV66.selectedSlot = Number(button.dataset.v66Slot || 1);
    nanikiruStateV66.selectedTile = "";
    nanikiruStateV66.answerError = "";
    renderNanikiruPageV66();
    requestAnimationFrame(() => document.querySelector("[data-v66-question-card]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }));
  page.querySelectorAll("[data-v66-answer-tile]").forEach((button) => button.addEventListener("click", () => {
    nanikiruStateV66.selectedTile = button.dataset.v66AnswerTile || "";
    nanikiruStateV66.answerError = "";
    page.querySelectorAll("[data-v66-answer-tile]").forEach((option) => {
      const selected = option.dataset.v66AnswerTile === nanikiruStateV66.selectedTile;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    const submit = page.querySelector("[data-v66-submit-answer]");
    if (submit) {
      submit.disabled = !nanikiruStateV66.selectedTile;
      submit.textContent = `${tileInfoV66(nanikiruStateV66.selectedTile).label}を切る`;
    }
  }));
  page.querySelector("[data-v66-submit-answer]")?.addEventListener("click", () => void submitNanikiruAnswerV66());
  page.querySelector("[data-v66-next-question]")?.addEventListener("click", () => {
    const questions = getNanikiruQuestionsV66();
    const currentIndex = questions.findIndex((item) => Number(item.slotNo) === Number(nanikiruStateV66.selectedSlot));
    const nextUnanswered = questions.slice(currentIndex + 1).find((item) => !item.myAttempt) || questions.find((item) => !item.myAttempt) || questions[Math.min(currentIndex + 1, questions.length - 1)];
    if (!nextUnanswered) return;
    nanikiruStateV66.selectedSlot = Number(nextUnanswered.slotNo);
    nanikiruStateV66.selectedTile = "";
    renderNanikiruPageV66();
    requestAnimationFrame(() => document.querySelector("[data-v66-question-card]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });
  page.querySelector("[data-v66-question-list]")?.addEventListener("click", () => {
    document.querySelector("[data-v66-question-list-anchor]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function loadNanikiruDataV66(force = false) {
  if (!currentSession || !activeGroupId || !supabaseClient) return;
  const groupId = activeGroupId;
  const date = todayInJapan();
  if (nanikiruStateV66.groupId !== groupId || nanikiruStateV66.date !== date) resetNanikiruStateV66(groupId);
  if (nanikiruStateV66.loading && !force) return;
  nanikiruStateV66.loading = true;
  nanikiruStateV66.error = "";
  if (currentTab === "nanikiru") renderNanikiruPageV66();
  else mountNanikiruHomeCardV66();
  try {
    const { data, error } = await supabaseClient.rpc("get_nanikiru_daily", {
      p_group_id: groupId,
      p_date: date
    });
    if (error) throw error;
    if (activeGroupId !== groupId) return;
    const payload = normalizeNanikiruPayloadV66(data);
    if (!payload) throw new Error("問題データの形式を読み取れませんでした。");
    const wasLoaded = nanikiruStateV66.loaded;
    nanikiruStateV66.data = payload;
    nanikiruStateV66.loaded = true;
    nanikiruStateV66.loading = false;
    nanikiruStateV66.error = "";
    if (!wasLoaded) {
      const questions = Array.isArray(payload.questions) ? payload.questions : [];
      const firstUnanswered = questions.find((item) => !item.myAttempt);
      nanikiruStateV66.selectedSlot = Number(firstUnanswered?.slotNo || questions[0]?.slotNo || 1);
    } else {
      setDefaultNanikiruSlotV66();
    }
    localStorage.setItem(V66_NANIKIRU_DATE_KEY, date);
  } catch (error) {
    nanikiruStateV66.loading = false;
    nanikiruStateV66.error = error?.message || "今日の問題を読み込めませんでした。";
  }
  if (currentTab === "nanikiru") renderNanikiruPageV66();
  else mountNanikiruHomeCardV66();
}

async function submitNanikiruAnswerV66() {
  const question = getNanikiruQuestionV66();
  if (!question || question.myAttempt || nanikiruStateV66.submitting) return;
  const selectedTile = nanikiruStateV66.selectedTile;
  if (!selectedTile) {
    nanikiruStateV66.answerError = "切る牌を選択してください。";
    renderNanikiruPageV66();
    return;
  }
  nanikiruStateV66.submitting = true;
  nanikiruStateV66.answerError = "";
  const submit = document.querySelector("[data-v66-submit-answer]");
  if (submit) { submit.disabled = true; submit.textContent = "判定中..."; }
  try {
    markLocalRealtimeWrite();
    const { data, error } = await supabaseClient.rpc("submit_nanikiru_answer", {
      p_group_id: activeGroupId,
      p_question_id: question.questionId,
      p_selected_tile: selectedTile,
      p_date: todayInJapan()
    });
    if (error) throw error;
    const payload = normalizeNanikiruPayloadV66(data);
    if (!payload) throw new Error("判定結果を読み取れませんでした。");
    nanikiruStateV66.data = payload;
    nanikiruStateV66.loaded = true;
    nanikiruStateV66.selectedTile = "";
    nanikiruStateV66.answerError = "";
  } catch (error) {
    nanikiruStateV66.answerError = error?.message || "回答を保存できませんでした。";
  } finally {
    nanikiruStateV66.submitting = false;
    renderNanikiruPageV66();
    requestAnimationFrame(() => document.querySelector("[data-v66-question-card]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function buildNanikiruHomeCardV66() {
  if (nanikiruStateV66.loading && !nanikiruStateV66.loaded) {
    return `<section class="v66-home-challenge loading"><div><p class="eyebrow">DAILY CHALLENGE</p><h3>今日の何切る？</h3><p>本日の10問を読み込んでいます。</p></div><span class="v66-home-spinner"></span></section>`;
  }
  if (nanikiruStateV66.error && !nanikiruStateV66.loaded) {
    return `<section class="v66-home-challenge error"><div><p class="eyebrow">DAILY CHALLENGE</p><h3>今日の何切る？</h3><p>${escapeHtml(nanikiruStateV66.error)}</p></div><button type="button" data-v66-home-retry>再読み込み</button></section>`;
  }
  const summary = nanikiruStateV66.data?.summary || {};
  const scheduled = num(summary.scheduledCount) || 10;
  const answered = num(summary.answeredCount);
  const complete = scheduled > 0 && answered >= scheduled;
  return `<button type="button" class="v66-home-challenge ${complete ? "complete" : ""}" data-v66-open-nanikiru>
    <div class="v66-home-challenge-copy"><p class="eyebrow">DAILY CHALLENGE</p><h3>今日の何切る？</h3><p>全赤・華あり・チップありの三麻問題</p></div>
    <div class="v66-home-challenge-progress"><strong>${answered}<small> / ${scheduled}問</small></strong><span>${complete ? "本日完走" : `得点 ${formatNanikiruScoreV66(summary.score)}点`}</span></div>
    <span class="v66-home-challenge-arrow">›</span>
  </button>`;
}

function mountNanikiruHomeCardV66() {
  if (currentTab !== "home" || !currentSession || !activeGroupId) return;
  const dashboard = document.querySelector(".home-dashboard");
  if (!dashboard) return;
  dashboard.querySelector(".v66-home-challenge")?.remove();
  const anchor = dashboard.querySelector(".home-resume-card") || dashboard.querySelector(".home-dashboard-header");
  if (!anchor) return;
  anchor.insertAdjacentHTML("afterend", buildNanikiruHomeCardV66());
  dashboard.querySelector("[data-v66-open-nanikiru]")?.addEventListener("click", () => void openNavigationFeatureV34("nanikiru"));
  dashboard.querySelector("[data-v66-home-retry]")?.addEventListener("click", () => void loadNanikiruDataV66(true));
  if (!nanikiruStateV66.loaded && !nanikiruStateV66.loading) void loadNanikiruDataV66();
}

function mountNanikiruHubCardV66(area) {
  if (area !== "analytics") return;
  const list = document.querySelector(".navigation-hub-card .hub-menu-list");
  if (!list || list.querySelector('[data-v34-feature="nanikiru"]')) return;
  list.insertAdjacentHTML("afterbegin", hubCardV34("nanikiru", "何", "今日の何切る？", "森研三麻の1日10問。正解者と回答分布も確認"));
  list.querySelector('[data-v34-feature="nanikiru"]')?.addEventListener("click", () => void openNavigationFeatureV34("nanikiru"));
}

async function openNanikiruPageV66() {
  navigationHubV34 = "analytics";
  settingsFocusV34 = "";
  currentTab = "nanikiru";
  setPrimaryNavActiveV34("analytics");
  heroCard.hidden = true;
  roadmapSection.hidden = true;
  getGroupWorkspace().hidden = true;
  const page = getPageWorkspace();
  page.hidden = false;
  renderNanikiruPageV66();
  await loadNanikiruDataV66();
  window.scrollTo(0, 0);
}

function clearNanikiruRealtimeTimerV66() {
  if (nanikiruRealtimeTimerV66) window.clearTimeout(nanikiruRealtimeTimerV66);
  nanikiruRealtimeTimerV66 = null;
}

function queueNanikiruRealtimeRefreshV66() {
  clearNanikiruRealtimeTimerV66();
  nanikiruRealtimeTimerV66 = window.setTimeout(() => {
    if (currentSession && activeGroupId) void loadNanikiruDataV66(true);
  }, 500);
}

async function stopNanikiruRealtimeV66() {
  clearNanikiruRealtimeTimerV66();
  if (nanikiruRealtimeChannelV66 && supabaseClient) {
    try { await supabaseClient.removeChannel(nanikiruRealtimeChannelV66); } catch (_) {}
  }
  nanikiruRealtimeChannelV66 = null;
  nanikiruRealtimeGroupIdV66 = null;
}

async function setupNanikiruRealtimeV66() {
  if (!supabaseClient || !currentSession || !activeGroupId) {
    await stopNanikiruRealtimeV66();
    return;
  }
  if (nanikiruRealtimeChannelV66 && nanikiruRealtimeGroupIdV66 === activeGroupId) return;
  await stopNanikiruRealtimeV66();
  const groupId = activeGroupId;
  nanikiruRealtimeChannelV66 = supabaseClient
    .channel(`jakuroku-nanikiru-${groupId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "nanikiru_answer_events", filter: `group_id=eq.${groupId}` }, () => {
      if (Date.now() - realtimeLastLocalWriteAt < 1200) return;
      queueNanikiruRealtimeRefreshV66();
    })
    .subscribe();
  nanikiruRealtimeGroupIdV66 = groupId;
}

const renderHomeDashboardBeforeV66 = renderHomeDashboardV35;
renderHomeDashboardV35 = function(...args) {
  const result = renderHomeDashboardBeforeV66.apply(this, args);
  mountNanikiruHomeCardV66();
  return result;
};

const renderNavigationHubBeforeV66 = renderNavigationHubV34;
renderNavigationHubV34 = function(area) {
  const result = renderNavigationHubBeforeV66(area);
  mountNanikiruHubCardV66(area);
  return result;
};

const openNavigationFeatureBeforeV66 = openNavigationFeatureV34;
openNavigationFeatureV34 = async function(feature) {
  if (feature === "nanikiru") return openNanikiruPageV66();
  return openNavigationFeatureBeforeV66(feature);
};

const setupRealtimeSubscriptionsBeforeV66 = setupRealtimeSubscriptions;
setupRealtimeSubscriptions = async function() {
  const result = await setupRealtimeSubscriptionsBeforeV66();
  await setupNanikiruRealtimeV66();
  return result;
};

const stopRealtimeSubscriptionsBeforeV66 = stopRealtimeSubscriptions;
stopRealtimeSubscriptions = async function() {
  await stopNanikiruRealtimeV66();
  return stopRealtimeSubscriptionsBeforeV66();
};

const switchActiveGroupBeforeV66 = switchActiveGroup;
switchActiveGroup = async function(groupId) {
  const result = await switchActiveGroupBeforeV66(groupId);
  resetNanikiruStateV66(groupId || activeGroupId || "");
  await setupNanikiruRealtimeV66();
  if (currentTab === "nanikiru") await loadNanikiruDataV66(true);
  else if (currentTab === "home") mountNanikiruHomeCardV66();
  return result;
};

const updateAuthUIBeforeV66 = updateAuthUI;
updateAuthUI = async function(session) {
  if (!session) resetNanikiruStateV66();
  const result = await updateAuthUIBeforeV66(session);
  if (session && activeGroupId) {
    await setupNanikiruRealtimeV66();
    if (currentTab === "home") mountNanikiruHomeCardV66();
  }
  return result;
};

const refreshCurrentViewFromRealtimeBeforeV66 = refreshCurrentViewFromRealtime;
refreshCurrentViewFromRealtime = async function(force = false) {
  if (currentTab === "nanikiru") {
    await loadNanikiruDataV66(true);
    return;
  }
  return refreshCurrentViewFromRealtimeBeforeV66(force);
};

if (typeof getV63Actions === "function") {
  const getV63ActionsBeforeV66 = getV63Actions;
  getV63Actions = function() {
    const actions = getV63ActionsBeforeV66.apply(this, arguments).slice();
    const kind = typeof getV63PageKind === "function" ? getV63PageKind() : currentTab;
    if (kind === "home" && !actions.some((action) => action.label === "何切る")) {
      actions.splice(1, 0, { icon: "何", label: "何切る", sub: "今日の10問", tab: "nanikiru" });
    }
    if (kind === "hub-analysis" && !actions.some((action) => action.label === "何切る")) {
      actions.unshift({ icon: "何", label: "何切る", sub: "今日の10問", tab: "nanikiru" });
    }
    if (kind === "nanikiru") {
      const currentQuestion = getNanikiruQuestionV66();
      return [
        { icon: "問", label: "問題一覧", sub: "1〜10問", scroll: "[data-v66-question-list-anchor]" },
        { icon: "▶", label: "回答", sub: currentQuestion?.myAttempt ? "解説を見る" : "牌を選ぶ", scroll: "[data-v66-question-card]" },
        { icon: "析", label: "分析へ", sub: "成績メニュー", tab: "hub-analysis" }
      ];
    }
    return actions;
  };
}

const v63RunActionBeforeV66 = typeof v63RunAction === "function" ? v63RunAction : null;
if (v63RunActionBeforeV66) {
  v63RunAction = async function(action) {
    if (action?.tab === "nanikiru") return openNavigationFeatureV34("nanikiru");
    if (action?.tab === "hub-analysis") return renderNavigationHubV34("analytics");
    return v63RunActionBeforeV66(action);
  };
}

const primaryAreaForBeforeV66 = primaryAreaForV34;
primaryAreaForV34 = function(tab = currentTab) {
  if (tab === "nanikiru") return "analytics";
  return primaryAreaForBeforeV66(tab);
};

if (currentSession && activeGroupId) {
  void setupNanikiruRealtimeV66();
  if (currentTab === "home") mountNanikiruHomeCardV66();
}
