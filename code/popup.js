document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage(); // 打开独立的设置页
});

document.getElementById('startBtn').addEventListener('click', () => {
  const task = document.getElementById('taskInput').value;
  if (!task) return alert("请先输入任务指令！");

  addLog("🚀 启动任务...");
  chrome.runtime.sendMessage({ type: "START_AGENT", payload: task });
});

// 监听来自 background 的实时日志推送
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "UPDATE_LOG") {
    addLog(message.payload);
  }
});

function addLog(text) {
  const logBox = document.getElementById('logBox');
  logBox.innerHTML += `> ${text}<br>`;
  logBox.scrollTop = logBox.scrollHeight;
}