// 全局日志历史数组，保证弹窗关闭不丢失
export let logHistory = [];

export function clearLogs() {
  logHistory = [];
}

export function sendLog(msg) {
  console.log(msg);
  logHistory.push(msg); // 存入内存
  try {
    const p = chrome.runtime.sendMessage({ type: "UPDATE_LOG", payload: msg });
    if (p && typeof p.catch === 'function') {
        p.catch(() => {});
    }
  } catch (e) {}
}