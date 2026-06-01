document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: "GET_LOGS" }, (response) => {
    if (response) {
      if (response.logs) {
        const logBox = document.getElementById('logBox');
        logBox.innerHTML = ''; 
        response.logs.forEach(msg => { logBox.innerHTML += `> ${msg}<br>`; });
        logBox.scrollTop = logBox.scrollHeight;
      }
      // 初始化状态灯
      updateUIStatus(response.status);
    }
  });
});

// 打开配置页面的按钮逻辑
document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage(); 
});

document.getElementById('startBtn').addEventListener('click', () => {
  const task = document.getElementById('taskInput').value;
  if (!task) return alert("请先输入任务指令！");
  
  document.getElementById('logBox').innerHTML = '';
  addLog("🚀 启动任务...");
  chrome.runtime.sendMessage({ type: "START_AGENT", payload: task });
});

document.getElementById('stopBtn').addEventListener('click', () => {
  addLog("🛑 正在发送停止指令，请稍候...");
  chrome.runtime.sendMessage({ type: "STOP_AGENT" });
});

// 面板里的放行和接管按钮事件
document.getElementById('popupResumeBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: "RESUME_AGENT" });
});
document.getElementById('popupAbortBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: "ABORT_AGENT" });
});

// 唯一的后台消息监听器
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "UPDATE_LOG") {
    addLog(message.payload);
  }
  // 接收字符串状态
  else if (message.type === "UPDATE_STATUS") {
    updateUIStatus(message.status);
  }
});

function addLog(text) {
  const logBox = document.getElementById('logBox');
  logBox.innerHTML += `> ${text}<br>`;
  logBox.scrollTop = logBox.scrollHeight;
}

// 支持三态切换
function updateUIStatus(status) {
  const badge = document.getElementById('statusBadge');
  const startBtn = document.getElementById('startBtn');
  const hitlControls = document.getElementById('hitlControls'); 
  
  if (status === "RUNNING") {
    badge.innerHTML = "🟢 状态: 正在运行";
    badge.style.background = "#d1fae5";
    badge.style.color = "#065f46";
    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    startBtn.innerText = "⏳ 运行中...";
    hitlControls.style.display = "none"; 
  } 
  else if (status === "WAITING") {
    badge.innerHTML = "🟡 状态: 等待人工接管";
    badge.style.background = "#fef08a";
    badge.style.color = "#854d0e";
    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    startBtn.innerText = "⏸️ 已挂起";
    hitlControls.style.display = "flex"; 
  } 
  else { // IDLE
    badge.innerHTML = "⚫ 状态: 闲置中";
    badge.style.background = "#e5e7eb";
    badge.style.color = "#374151";
    startBtn.disabled = false;
    startBtn.style.opacity = "1";
    startBtn.innerText = "▶ 开始";
    hitlControls.style.display = "none"; 
  }
}