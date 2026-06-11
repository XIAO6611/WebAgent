document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ type: "GET_LOGS" }, (response) => {
    if (!response) return;
    if (response.logs) {
      const logBox = document.getElementById("logBox");
      logBox.innerHTML = "";
      response.logs.forEach((msg) => { logBox.innerHTML += `> ${escapeHtml(msg)}<br>`; });
      logBox.scrollTop = logBox.scrollHeight;
    }
    updateUIStatus(response.status);
  });
});

document.getElementById("optionsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("updateKnowledgeBtn").addEventListener("click", () => {
  addLog("正在分析当前表单与知识库差异...");
  chrome.runtime.sendMessage({ type: "PROPOSE_KNOWLEDGE_UPDATES_FROM_ACTIVE_TAB" }, (response) => {
    if (response && response.status) addLog(response.status);
  });
});

document.getElementById("startBtn").addEventListener("click", () => {
  const task = document.getElementById("taskInput").value.trim();
  if (!task) {
    addLog("请先输入任务指令。");
    return;
  }

  document.getElementById("logBox").innerHTML = "";
  addLog("启动任务...");
  chrome.runtime.sendMessage({ type: "START_AGENT", payload: task }, (response) => {
    if (response && response.status) addLog(response.status);
  });
});

document.getElementById("stopBtn").addEventListener("click", () => {
  addLog("正在发送停止指令...");
  chrome.runtime.sendMessage({ type: "STOP_AGENT" }, (response) => {
    if (response && response.status) addLog(response.status);
  });
});

document.getElementById("popupResumeBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RESUME_AGENT" });
});

document.getElementById("popupAbortBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ABORT_AGENT" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "UPDATE_LOG") addLog(message.payload);
  else if (message.type === "UPDATE_STATUS") updateUIStatus(message.status);
});

function addLog(text) {
  const logBox = document.getElementById("logBox");
  logBox.innerHTML += `> ${escapeHtml(text)}<br>`;
  logBox.scrollTop = logBox.scrollHeight;
}

function updateUIStatus(status) {
  const badge = document.getElementById("statusBadge");
  const startBtn = document.getElementById("startBtn");
  const hitlControls = document.getElementById("hitlControls");

  if (status === "RUNNING") {
    badge.textContent = "状态：运行中";
    badge.style.background = "#d1fae5";
    badge.style.color = "#065f46";
    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    startBtn.textContent = "运行中...";
    hitlControls.style.display = "none";
  } else if (status === "WAITING") {
    badge.textContent = "状态：等待人工接管";
    badge.style.background = "#fef08a";
    badge.style.color = "#854d0e";
    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    startBtn.textContent = "已挂起";
    hitlControls.style.display = "flex";
  } else {
    badge.textContent = "状态：空闲";
    badge.style.background = "#e5e7eb";
    badge.style.color = "#374151";
    startBtn.disabled = false;
    startBtn.style.opacity = "1";
    startBtn.textContent = "开始";
    hitlControls.style.display = "none";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
