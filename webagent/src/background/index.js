import {
  applyKnowledgeUpdates,
  extractProfileFromImage,
  extractProfileFromText,
  isAgentRunning,
  isFormFillTask,
  proposeKnowledgeUpdatesFromActiveTab,
  resumeAgent,
  abortAgentFromHITL,
  runAgentLoop,
  runFormFillTask,
  stopAgent,
  currentAgentStatus
} from './agentController.js';
import { sendLog, logHistory } from '../utils/logger.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AGENT") {
    if (isAgentRunning) {
      sendLog("⚠️ 已有任务运行中，请勿重复点击开始。");
      sendResponse({ status: "已有任务运行中" });
      return false;
    }
    sendResponse({ status: "后台中枢已接管..." });
    if (isFormFillTask(message.payload || "")) {
      runFormFillTask(message.payload || "");
    } else {
      runAgentLoop(message.payload || "");
    }
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
  else if (message.type === "EXTRACT_PROFILE_FROM_TEXT") {
    extractProfileFromText(message.payload)
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  else if (message.type === "EXTRACT_PROFILE_FROM_IMAGE") {
    extractProfileFromImage(message.payload)
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  else if (message.type === "PROPOSE_KNOWLEDGE_UPDATES_FROM_ACTIVE_TAB") {
    proposeKnowledgeUpdatesFromActiveTab()
      .then(() => sendResponse({ status: "已生成知识库更新建议，请在页面中确认。" }))
      .catch((error) => sendResponse({ status: `知识库更新分析失败: ${error.message}` }));
    return true;
  }
  else if (message.type === "APPLY_KNOWLEDGE_UPDATES") {
    applyKnowledgeUpdates(message.payload)
      .then(() => sendLog("已保存勾选的知识库更新。"))
      .catch((error) => sendLog(`保存知识库更新失败: ${error.message}`));
    sendResponse({ ok: true });
    return false;
  }
});
