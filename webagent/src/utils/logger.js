// 全局日志历史数组，保证弹窗关闭不丢失
export let logHistory = [];
// 专属开发者日志（带精确时间戳）
export let devLogHistory = []; 

export function clearLogs() {
  logHistory = [];
  devLogHistory = []; // 清空开发者日志
}

export function sendLog(msg) {
  console.log(msg);
  logHistory.push(msg); // 存入普通内存（UI显示用）
  
  // 记录带时间戳的日志（导出 Markdown 用）
  const now = new Date();
  const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
  devLogHistory.push(`[${timeString}] ${msg}`);

  try {
    const p = chrome.runtime.sendMessage({ type: "UPDATE_LOG", payload: msg });
    if (p && typeof p.catch === 'function') {
        p.catch(() => {});
    }
  } catch (e) {}
}