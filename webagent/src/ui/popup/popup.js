document.addEventListener('DOMContentLoaded', () => {
  // 面板打开时，先去后台拉取历史日志
  chrome.runtime.sendMessage({ type: "GET_LOGS" }, (response) => {
    if (response && response.logs) {
      const logBox = document.getElementById('logBox');
      logBox.innerHTML = ''; // 清空默认的
      response.logs.forEach(msg => {
        logBox.innerHTML += `> ${msg}<br>`;
      });
      logBox.scrollTop = logBox.scrollHeight;
    }
  });
});

document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage(); 
});

document.getElementById('startBtn').addEventListener('click', () => {
  const task = document.getElementById('taskInput').value;
  if (!task) return alert("请先输入任务指令！");
  
  // 清空旧面板
  document.getElementById('logBox').innerHTML = '';
  addLog("🚀 启动任务...");
  chrome.runtime.sendMessage({ type: "START_AGENT", payload: task });
});

document.getElementById('stopBtn').addEventListener('click', () => {
  addLog("🛑 正在发送停止指令，请稍候...");
  chrome.runtime.sendMessage({ type: "STOP_AGENT" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "UPDATE_LOG") addLog(message.payload);
});

function addLog(text) {
  const logBox = document.getElementById('logBox');
  logBox.innerHTML += `> ${text}<br>`;
  logBox.scrollTop = logBox.scrollHeight;
}