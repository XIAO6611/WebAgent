import { runAgentLoop, stopAgent, isAgentRunning, resumeAgent, abortAgentFromHITL, currentAgentStatus } from './agentController.js';
import { sendLog, logHistory } from '../utils/logger.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AGENT") {
    if (isAgentRunning) {
      sendLog("⚠️ 已有任务运行中，请勿重复点击开始。");
      sendResponse({ status: "已有任务运行中" });
      return false;
    }
    sendResponse({ status: "后台中枢已接管..." }); 
    runAgentLoop(message.payload);
    return false;
  }
  // 处理前端弹窗的放行与接管请求
  else if (message.type === "RESUME_AGENT") {
    resumeAgent();
    sendResponse({ status: "已放行" });
    return false;
  }
  else if (message.type === "ABORT_AGENT") {
    abortAgentFromHITL();
    sendResponse({ status: "已接管" });
    return false;
  }
  else if (message.type === "STOP_AGENT") {
    stopAgent();
    sendResponse({ status: "已发送停止信号" });
    return false;
  }
  // 向前端返回 currentAgentStatus 状态
  else if (message.type === "GET_LOGS") {
    sendResponse({ logs: logHistory, status: currentAgentStatus });
    return false;
  }
});