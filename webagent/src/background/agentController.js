import { sendLog, clearLogs } from '../utils/logger.js';
import { injectPlaceholders } from '../utils/templateEngine.js';
import { getKnowledgeBase } from '../services/memoryService.js';
import { askVLM, askLLM } from '../services/llmClient.js';
import { buildReActPrompt, buildSummaryPrompt } from './promptManager.js';

export let isAgentRunning = false;
let hitlResolver = null; 
export let currentAgentStatus = "IDLE"; 

export function broadcastStatus(statusString) {
  currentAgentStatus = statusString;
  try {
    chrome.runtime.sendMessage({ type: "UPDATE_STATUS", status: statusString });
  } catch (e) {}
}

export function resumeAgent() {
  if (hitlResolver) {
    hitlResolver(true);
    hitlResolver = null;
    sendLog("🟢 人工已放行，大脑重新上线...");
    broadcastStatus("RUNNING"); 
  }
}

export function abortAgentFromHITL() {
  if (hitlResolver) {
    hitlResolver(false);
    hitlResolver = null;
    sendLog("🛑 用户已手动接管，Agent 退出当前任务。");
    stopAgent();
  }
}

export function stopAgent() {
  if (isAgentRunning) {
    isAgentRunning = false;
    sendLog("🛑 收到中止指令，正在紧急刹车...");
  }
}

async function smartSleep(ms) {
  const slices = ms / 500;
  for (let i = 0; i < slices; i++) {
    if (!isAgentRunning) break; 
    await new Promise(r => setTimeout(r, 500));
  }
}

async function waitForPageLoad(tabId) {
  let retries = 0;
  while (retries < 20 && isAgentRunning) { 
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        await smartSleep(1500); 
        return;
      }
    } catch (e) {
      console.warn("等待过程中标签页已转移或销毁，停止死等。");
      await smartSleep(1000); 
      return; 
    }
    await smartSleep(500);
    retries++;
  }
}

export async function runAgentLoop(userTask) {
  isAgentRunning = true; 
  broadcastStatus("RUNNING"); 
  clearLogs(); 
  let collectedData = "";
  let visitedUrls = []; 
  let consecutiveScrolls = 0; 
  let consecutiveExtracts = 0;
  
  try {
    const { apiKey, kbData } = await getKnowledgeBase();
    if (!apiKey) throw new Error("未配置 API Key！");

    const parsedTask = injectPlaceholders(userTask, kbData);
    sendLog(`🎯 最终指令: "${parsedTask}"`);

    let isTaskComplete = false;
    let stepCount = 0;
    const MAX_STEPS = 30; 
    let currentPlan = "['分析页面布局制定计划']";

    sendLog("🤖 启动 VLM 视觉感知循环...");

    while (!isTaskComplete && stepCount < MAX_STEPS && isAgentRunning) {
      stepCount++;
      
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab || activeTab.url.startsWith("chrome://")) {
          sendLog("⚠️ 无法在当前系统页面执行，等待切换...");
          await smartSleep(1500);
          continue;
      }

      sendLog(`\n🔄 [第 ${stepCount} 轮] 正在观察屏幕...`);

      let screenshotBase64;
      try {
          screenshotBase64 = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'jpeg', quality: 40 });
      } catch (e) {
          sendLog("⚠️ 截图失败(窗口可能失去焦点)，正在重试...");
          await smartSleep(1000);
          continue;
      }
      
      let domInfo = [];
      let retryCount = 0;
      while (retryCount < 4 && isAgentRunning) {
          try {
              domInfo = await chrome.tabs.sendMessage(activeTab.id, { type: "GET_DOM_INFO" });
              if (domInfo && domInfo.length > 3) break; 
          } catch (e) {}
          await smartSleep(1000); 
          retryCount++;
      }

      if (!isAgentRunning) break;

      const simpleDomForLLM = domInfo.map(el => {
          let str = `[${el.id}] ${el.type}`;
          if (el.text) str += `: ${el.text}`;
          if (el.href) str += ` (href: ${el.href})`;
          return str;
      });

      const systemPrompt = buildReActPrompt(parsedTask, kbData, currentPlan, collectedData.length, simpleDomForLLM, stepCount, visitedUrls);
      
      sendLog("📡 呼叫大脑思考中 (限时80秒)...");
      let actionData;
      try {
          actionData = await askVLM(apiKey, systemPrompt, screenshotBase64);
      } catch (apiError) {
          sendLog(`❌ API 异常: ${apiError.message}`);
          isAgentRunning = false;
          break; 
      }

      if (!isAgentRunning) break;

      if (actionData.action === 'scroll') {
          consecutiveScrolls++;
          if (consecutiveScrolls >= 3) {
              sendLog("⚠️ 连续 3 次滚动未发现目标，强行结束。");
              break;
          }
      } else { consecutiveScrolls = 0; }
      
      if (actionData.action === 'extract') {
          consecutiveExtracts++;
          if (consecutiveExtracts >= 2) {
              sendLog("⚠️ 严禁连续 2 次原地提取！强行中断。");
              break; 
          }
      } else { consecutiveExtracts = 0; }

      if (['click', 'type'].includes(actionData.action) && actionData.element_id !== undefined) {
          const targetEl = domInfo.find(el => el.id === actionData.element_id);
          if (targetEl) {
              actionData.x = targetEl.x; 
              actionData.y = targetEl.y; 
              if (actionData.action === 'click' && targetEl.href) visitedUrls.push(targetEl.href);
          }
      }

      currentPlan = JSON.stringify(actionData.remaining_plan || []);
      sendLog(`🤔 思考: ${actionData.thought}`);
      
      let actionLog = `🕹️ 动作: [${actionData.action}]`;
      if (actionData.element_id !== undefined) actionLog += ` ID:${actionData.element_id}`;
      if (actionData.action === 'goto') actionLog += ` 网址:${actionData.url}`;
      sendLog(actionLog);

      // 动作分发
      if (actionData.action === "show_hitl") {
        sendLog(`⚠️ 触发安全网关: ${actionData.message || "请求人工确认"}`);
        try {
            chrome.tabs.sendMessage(activeTab.id, { type: "EXECUTE_ACTION", action: actionData }).catch(()=>{});
        } catch (e) {}

        sendLog("⏸️ Agent 已挂起，等待用户操作...");
        broadcastStatus("WAITING"); 
        
        const shouldContinue = await new Promise(resolve => { hitlResolver = resolve; });
        if (!shouldContinue) break;
      }
      else if (actionData.action === "done") {
        const thought = actionData.thought || "";
        if (thought.includes("登录") || thought.includes("扫码") || thought.includes("挂起")) {
            sendLog("🛡️ 引擎底层拦截：模型企图用 done 逃避登录墙，系统已强制修正为挂起状态！");
            chrome.tabs.sendMessage(activeTab.id, { 
                type: "EXECUTE_ACTION", 
                action: { action: "show_hitl", message: "系统检测到登录墙，请在弹窗中点击恢复执行。" } 
            }).catch(()=>{});
            
            sendLog("⏸️ Agent 已挂起，等待用户操作...");
            broadcastStatus("WAITING"); 
            const shouldContinue = await new Promise(resolve => { hitlResolver = resolve; });
            if (!shouldContinue) break; 
        } else {
            isTaskComplete = true;
            sendLog("✅ Agent 判定任务闭环！");
            break;
        }
      } 
      else if (actionData.action === "extract") {
        sendLog("📥 正在提取本页文字...");
        try {
            const pageText = await chrome.tabs.sendMessage(activeTab.id, { type: "GET_TEXT_CONTENT" });
            collectedData += `\n\n--- 第 ${stepCount} 步提取 ---\n` + (pageText || "");
        } catch (e) {}
        await smartSleep(1000); 
      } 
      else if (actionData.action === "goto" && actionData.url) {
        sendLog(`🔗 正在移动至新网址...`);
        visitedUrls.push(actionData.url); 
        try {
            await chrome.tabs.update(activeTab.id, { url: actionData.url });
        } catch (e) {
            sendLog("⚠️ 原标签页跳转失效，系统将重新捕获焦点...");
        }
        await waitForPageLoad(activeTab.id); 
      }
      else if (["scroll", "click", "type", "press_enter", "back"].includes(actionData.action)) {
        try {
            chrome.tabs.sendMessage(activeTab.id, { type: "EXECUTE_ACTION", action: actionData }).catch(()=>{});
        } catch (e) {}
        sendLog(`⚙️ 执行物理操作，等待网页加载...`);
        await waitForPageLoad(activeTab.id); 
      }
    }

    if (!isAgentRunning) { sendLog("🛑 任务已中止。"); return; }
    if (stepCount >= MAX_STEPS) sendLog("⚠️ 达到最大步数限制。");

    if (collectedData.length > 0) {
      sendLog("📝 正在呼叫文本大脑生成报告...");
      const summaryPrompt = buildSummaryPrompt(parsedTask, collectedData);
      const markdownData = await askLLM(apiKey, summaryPrompt);
      sendLog("💾 导出文件中...");
      saveMarkdownFile(markdownData, "Agent_Report.md");
    } else {
      sendLog("⚠️ 收集箱为空，无数据可生成报告。");
    }
  } catch (error) {
    sendLog(`❌ 发生致命错误: ${error.message}`);
  } finally {
    isAgentRunning = false; 
    broadcastStatus("IDLE"); 
  }
}

function saveMarkdownFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const reader = new FileReader();
  reader.readAsDataURL(blob);
  reader.onloadend = () => {
    chrome.downloads.download({ url: reader.result, filename: filename, saveAs: true });
  };
}