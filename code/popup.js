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
    alert("请先输入任务指令。");
    return;
  }

  addLog("启动任务...");
  chrome.runtime.sendMessage({ type: "START_AGENT", payload: task }, (response) => {
    if (response && response.status) addLog(response.status);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "UPDATE_LOG") {
    addLog(message.payload);
  }
});

function addLog(text) {
  const logBox = document.getElementById("logBox");
  logBox.innerHTML += `&gt; ${escapeHtml(text)}<br>`;
  logBox.scrollTop = logBox.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
