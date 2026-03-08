const STORAGE_KEY = "knowledge-habit-tracker";

const timeElement = document.getElementById("time");
const actionElement = document.getElementById("action");
const metaElement = document.getElementById("meta");
const statusTextElement = document.getElementById("status-text");
const statusDotElement = document.getElementById("status-dot");

renderOverlay();
window.setInterval(renderOverlay, 250);
window.addEventListener("storage", renderOverlay);

function renderOverlay() {
  const state = loadState();
  const timer = state.timer || {};
  const running = Boolean(timer.running && timer.startedAt);
  const elapsedMs = getElapsedMs(timer);
  const prediction = resolvePrediction(timer, state);

  timeElement.textContent = formatDuration(elapsedMs);
  actionElement.textContent = `当前动作：${prediction}`;
  statusTextElement.textContent = running ? "计时进行中" : elapsedMs > 0 ? "计时已暂停" : "未开始";
  statusDotElement.classList.toggle("running", running);

  if (running) {
    metaElement.textContent = "悬浮窗会持续刷新，方便你在别的软件里随时看见时间正在运行。";
  } else if (elapsedMs > 0) {
    metaElement.textContent = "计时已暂停，回到主窗口可以继续、结束或重置。";
  } else {
    metaElement.textContent = "在主窗口开始计时后，这里会始终置顶显示。";
  }
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getElapsedMs(timer) {
  const base = Number(timer.elapsedMs) > 0 ? Number(timer.elapsedMs) : 0;
  if (!timer.running || !timer.startedAt) {
    return base;
  }
  return base + (Date.now() - new Date(timer.startedAt).getTime());
}

function resolvePrediction(timer, state) {
  const action =
    (typeof timer.predictedAction === "string" && timer.predictedAction.trim()) ||
    getLatestFormalEventTitle(state) ||
    "尚未开始";
  return action;
}

function getLatestFormalEventTitle(state) {
  if (!Array.isArray(state.events)) {
    return "";
  }
  const record = state.events.find((event) => event && event.source !== "quick-note");
  return record && typeof record.title === "string" ? record.title : "";
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
