
import { injectPlaceholders } from '../utils/templateEngine.js';
import { getKnowledgeBase, mergeKnowledgeUpdates } from '../services/memoryService.js';
import { askVLM, askLLM, askTextJson } from '../services/llmClient.js';
import { sendLog, clearLogs, devLogHistory } from '../utils/logger.js';
import {
  buildFormFillPrompt,
  buildFormReviewPrompt,
  buildKnowledgeUpdatePrompt,
  buildProfileExtractionPrompt,
  buildReActPrompt,
  buildSummaryPrompt
} from './promptManager.js';

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

    chrome.storage.local.get(['developerMode'], (res) => {
      if (res.developerMode && devLogHistory.length > 0) {
        sendLog("🛠️ 开发者模式已开启，正在生成执行日志...");
        const mdContent = `# Web Agent 执行跟踪日志 (普通任务)\n\n**原始指令:** ${userTask}\n**生成时间:** ${new Date().toLocaleString()}\n\n## 完整执行流水线\n\n${devLogHistory.map(log => `- ${log}`).join('\n')}\n`;
        saveMarkdownFile(mdContent, `Agent_TraceLog_${Date.now()}.md`);
      }
    });
  }
}

function saveMarkdownFile(content, filename) {
  chrome.downloads.download({
    url: `data:text/markdown;charset=utf-8;base64,${base64EncodeUnicode(content)}`,
    filename,
    saveAs: true
  });
}

function base64EncodeUnicode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export async function runFormFillTask(userTask) {
  isAgentRunning = true;
  broadcastStatus("RUNNING");
  clearLogs();

  try {
    const activeTab = await getActiveTab();
    validateRunnableTab(activeTab);

    const { apiKey, kbData, resumeText } = await getKnowledgeBase();
    const canonicalKbData = normalizeKnowledgeBase(kbData);
    if (!apiKey) throw new Error("未配置 API Key，请先到选项页配置。");

    sendLog("开始表单填写模式：正在扫描当前页面字段。");
    const blocker = await detectAndPauseForBlocker(activeTab.id);
    if (blocker.blocked) return;

    const formScan = await sendTabMessage(activeTab.id, { type: "SCAN_FORM_FIELDS" });
    if (!formScan || !Array.isArray(formScan.fields) || formScan.fields.length === 0) {
      throw new Error("当前页面没有发现可填写的表单字段。");
    }

    if (formScan.isLoginPage) {
      await sendTabMessage(activeTab.id, {
        type: "EXECUTE_ACTION",
        action: {
          action: "show_hitl",
          message: "检测到当前页面可能需要登录。Agent 已暂停，请你登录后重新启动填表任务。"
        }
      });
      sendLog("检测到登录页，已暂停并交给用户登录。");
      broadcastStatus("WAITING");
      return;
    }

    const screenshotBase64 = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: "jpeg", quality: 70 });
    const profile = {
      knowledgeBase: canonicalKbData,
      resumeText,
      rememberedFormInfo: canonicalKbData.autofillMemory || {}
    };

    sendLog(`发现 ${formScan.fields.length} 个可填写字段，正在匹配简历信息。`);
    const decision = await askVLM(apiKey, buildFormFillPrompt(userTask, formScan, profile), screenshotBase64);

    const deterministicAssignments = buildDeterministicAssignments(formScan.fields, canonicalKbData);
    const modelAssignments = normalizeAssignments(decision.assignments, formScan.fields, canonicalKbData);
    const assignments = mergeAssignments(deterministicAssignments, modelAssignments);

    if (assignments.length === 0) {
      sendLog("没有找到可安全自动填写的字段。");
      await sendTabMessage(activeTab.id, {
        type: "SHOW_FORM_REVIEW_MODAL",
        message: "没有找到可安全自动填写的字段，请手动检查当前页面。"
      });
      return;
    }

    sendLog(`准备填写 ${assignments.length} 个字段。不会点击提交按钮。`);
    const fillResult = await sendTabMessage(activeTab.id, {
      type: "FILL_FORM_FIELDS",
      payload: assignments
    });

    const successCount = (fillResult.results || []).filter((item) => item.ok).length;
    sendLog(`已填写 ${successCount}/${assignments.length} 个字段。`);

    const reviewResult = await reviewAndCorrectFilledForm({
      tabId: activeTab.id,
      windowId: activeTab.windowId,
      apiKey,
      profile,
      knowledgeBase: canonicalKbData
    });
    const reviewWarnings = reviewResult.warnings || [];

    const warningText = Array.isArray(decision.warnings) && decision.warnings.length
      ? `注意：${decision.warnings.join("；")}。`
      : "";
    const reviewWarningText = reviewWarnings.length
      ? `质检提示：${reviewWarnings.join("；")}。`
      : "";
    const missingText = Array.isArray(decision.missing_fields) && decision.missing_fields.length
      ? `还有这些字段资料不足，需要你手动填写或确认：${decision.missing_fields.join("、")}。`
      : "";

    await sendTabMessage(activeTab.id, {
      type: "SHOW_FORM_REVIEW_MODAL",
      message: `Agent 已暂停在提交前。${missingText}请检查表单内容，确认无误后由你手动提交。${warningText}${reviewWarningText}`
    });
  } catch (error) {
    sendLog(`表单填写失败: ${error.message}`);
  } finally {
    isAgentRunning = false;
    broadcastStatus("IDLE");

    chrome.storage.local.get(['developerMode'], (res) => {
      if (res.developerMode && devLogHistory.length > 0) {
        sendLog("🛠️ 开发者模式已开启，正在生成表单执行日志...");
        const mdContent = `# Web Agent 执行跟踪日志 (填表任务)\n\n**原始指令:** ${userTask}\n**生成时间:** ${new Date().toLocaleString()}\n\n## 完整执行流水线\n\n${devLogHistory.map(log => `- ${log}`).join('\n')}\n`;
        saveMarkdownFile(mdContent, `Agent_FormFill_TraceLog_${Date.now()}.md`);
      }
    });
  }
}

export async function extractProfileFromText(payload) {
  const { apiKey: storedApiKey, kbData, resumeText: storedResumeText } = await getKnowledgeBase();
  const apiKey = payload && payload.apiKey ? payload.apiKey : storedApiKey;
  const resumeText = payload && payload.resumeText ? payload.resumeText : storedResumeText;
  if (!apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");
  if (!resumeText) throw new Error("请先填写或导入简历文本。");

  const prompt = `${buildProfileExtractionPrompt(kbData, "以下是用户简历文本，请提取其中适合自动填表的个人信息。")}\n\n简历文本：\n${resumeText}`;
  return normalizeExtractedProfile(await askTextJson(apiKey, prompt));
}

export async function extractProfileFromImage(payload) {
  const { apiKey: storedApiKey, kbData } = await getKnowledgeBase();
  const apiKey = payload && payload.apiKey ? payload.apiKey : storedApiKey;
  if (!apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");
  if (!payload || !payload.imageDataUrl) throw new Error("未收到图片。");

  const prompt = buildProfileExtractionPrompt(kbData, "这是一张或多张简历截图，请提取其中适合自动填表的个人信息。");
  return normalizeExtractedProfile(await askVLM(apiKey, prompt, payload.imageDataUrl));
}

export async function proposeKnowledgeUpdatesFromActiveTab() {
  const activeTab = await getActiveTab();
  validateRunnableTab(activeTab);
  const blocker = await detectAndPauseForBlocker(activeTab.id);
  if (blocker.blocked) return;

  const payload = await sendTabMessage(activeTab.id, { type: "COLLECT_CURRENT_FORM_VALUES" });
  await proposeKnowledgeUpdates(activeTab, payload);
}

export async function proposeKnowledgeUpdates(tab, payload) {
  if (!tab || !tab.id) throw new Error("缺少当前标签页。");
  const { apiKey, kbData } = await getKnowledgeBase();
  if (!apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");

  const screenshotBase64 = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
  const result = await askVLM(apiKey, buildKnowledgeUpdatePrompt(kbData, payload), screenshotBase64);
  const proposals = Array.isArray(result.proposals) ? result.proposals : [];
  await sendTabMessage(tab.id, {
    type: "SHOW_KNOWLEDGE_UPDATE_MODAL",
    payload: { proposals }
  });
}

export async function applyKnowledgeUpdates(payload) {
  const updates = payload && Array.isArray(payload.updates) ? payload.updates : [];
  if (updates.length === 0) return;
  await mergeKnowledgeUpdates(updates);
}

async function reviewAndCorrectFilledForm({ tabId, windowId, apiKey, profile, knowledgeBase }) {
  sendLog("启动独立填表质检 Agent：重新扫描当前表单，不读取上一轮填写记忆。");

  const currentScan = await sendTabMessage(tabId, { type: "SCAN_FORM_FIELDS" });
  if (!currentScan || !Array.isArray(currentScan.fields)) return { warnings: [] };

  const localCorrections = buildLocalReviewCorrections(currentScan.fields, knowledgeBase);
  let modelCorrections = [];
  let warnings = [];

  try {
    const screenshotBase64 = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 });
    const reviewDecision = await askVLM(apiKey, buildFormReviewPrompt(currentScan, {
      knowledgeBase,
      resumeText: profile.resumeText || ""
    }), screenshotBase64);
    modelCorrections = normalizeAssignments(reviewDecision.corrections, currentScan.fields, knowledgeBase);
    warnings = Array.isArray(reviewDecision.warnings) ? reviewDecision.warnings : [];
  } catch (error) {
    sendLog(`填表质检 Agent 调用失败，已使用本地规则质检: ${error.message}`);
  }

  const corrections = mergeAssignments(localCorrections, modelCorrections);
  if (corrections.length === 0) {
    sendLog("填表质检 Agent 未发现需要自动修正的字段。");
    return { warnings };
  }

  const correctionResult = await sendTabMessage(tabId, {
    type: "FILL_FORM_FIELDS",
    payload: corrections
  });
  const successCount = (correctionResult.results || []).filter((item) => item.ok).length;
  sendLog(`填表质检 Agent 已修正 ${successCount}/${corrections.length} 个字段。`);
  corrections.forEach((item) => {
    if (item.reason) sendLog(`质检修正: ${item.reason}`);
  });

  return { warnings };
}

function buildLocalReviewCorrections(fields, knowledgeBase) {
  const corrections = [];
  fields.forEach((field) => {
    const key = matchFieldKey(field);
    if (!key) return;
    const expectedValue = knowledgeBase[key];
    if (expectedValue === undefined || expectedValue === null || String(expectedValue).trim() === "") return;

    const currentValue = String(field.value || "").trim();
    const normalizedCurrent = normalizeFieldText(currentValue);
    const normalizedExpected = normalizeFieldText(expectedValue);
    if (!currentValue || normalizedCurrent === normalizedExpected) return;

    if (shouldCorrectFieldValue(key, currentValue, knowledgeBase)) {
      corrections.push({
        selector: field.selector,
        value: String(expectedValue),
        source: "review",
        reason: `${field.label || field.placeholder || field.name || key} 当前值“${currentValue}”与知识库字段 ${key} 不一致，已修正为“${expectedValue}”。`
      });
    }
  });
  return corrections;
}

function shouldCorrectFieldValue(key, currentValue, knowledgeBase) {
  const normalizedCurrent = normalizeFieldText(currentValue);
  const strictPersonalFields = new Set([
    "expected_position",
    "school",
    "major",
    "education_level",
    "graduation_year",
    "email",
    "phone",
    "name",
    "gender"
  ]);
  if (strictPersonalFields.has(key)) return true;

  const conflictingKeys = Object.keys(knowledgeBase).filter((candidateKey) => candidateKey !== key);
  const matchesOtherKnowledge = conflictingKeys.some((candidateKey) => {
    const value = knowledgeBase[candidateKey];
    return value !== undefined && value !== null &&
      normalizeFieldText(value) &&
      normalizedCurrent === normalizeFieldText(value);
  });

  if (matchesOtherKnowledge) return true;
  if (key === "expected_position") {
    const school = normalizeFieldText(knowledgeBase.school || "");
    const major = normalizeFieldText(knowledgeBase.major || "");
    if (school && normalizedCurrent === school) return true;
    if (major && normalizedCurrent === major) return true;
  }
  return false;
}

const FIELD_ALIASES = {
  name: ["姓名", "名字", "真实姓名", "name"],
  gender: ["性别", "gender"],
  phone: ["手机", "手机号", "联系电话", "联系方式", "电话", "phone", "mobile"],
  email: ["邮箱", "电子邮箱", "邮件", "email", "e-mail"],
  school: ["学校", "院校", "学校名称", "毕业院校", "就读学校", "大学", "school", "university", "college"],
  major: ["专业", "所学专业", "就读专业", "major"],
  education_level: ["学历", "最高学历", "教育程度", "education", "degree"],
  graduation_year: ["毕业年份", "毕业时间", "graduation"],
  expected_position: ["期望岗位", "期望职位", "期望职业", "应聘岗位", "投递岗位", "申请岗位", "目标岗位", "职业岗位", "position", "job"]
};

function normalizeKnowledgeBase(knowledgeBase) {
  if (!knowledgeBase || typeof knowledgeBase !== "object") return {};

  const normalized = { ...knowledgeBase };
  Object.entries(knowledgeBase).forEach(([rawKey, value]) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    const canonicalKey = matchKnowledgeKey(rawKey);
    if (!canonicalKey) return;
    if (normalized[canonicalKey] === undefined || normalized[canonicalKey] === null || String(normalized[canonicalKey]).trim() === "") {
      normalized[canonicalKey] = value;
    }
  });

  return normalized;
}

function matchKnowledgeKey(rawKey) {
  const keyText = normalizeFieldText(rawKey);
  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    if (keyText === normalizeFieldText(key)) return key;
    if (aliases.some((alias) => keyText === normalizeFieldText(alias))) return key;
  }
  return "";
}

function buildDeterministicAssignments(fields, knowledgeBase) {
  const assignments = [];
  if (!knowledgeBase || typeof knowledgeBase !== "object") return assignments;

  fields.forEach((field) => {
    if (!field || field.value) return;
    const key = matchFieldKey(field);
    if (!key || knowledgeBase[key] === undefined || knowledgeBase[key] === null) return;
    const value = String(knowledgeBase[key]).trim();
    if (!value || isSuspiciousFieldValue(field, value, knowledgeBase)) return;
    assignments.push({ selector: field.selector, value, source: "knowledgeBase", key });
  });

  return assignments;
}

function normalizeAssignments(assignments, fields, knowledgeBase = {}) {
  if (!Array.isArray(assignments)) return [];
  const safeSelectors = new Set(fields.map((field) => field.selector));
  const blockedTypes = new Set(["password", "file", "submit", "button", "reset"]);

  return assignments
    .filter((item) => item && safeSelectors.has(item.selector))
    .filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== "")
    .filter((item) => {
      const field = fields.find((candidate) => candidate.selector === item.selector);
      return field && !blockedTypes.has(field.type) &&
        !isSuspiciousFieldValue(field, String(item.value), knowledgeBase);
    })
    .map((item) => ({ selector: item.selector, value: String(item.value), source: "model" }));
}

function mergeAssignments(primary, secondary) {
  const bySelector = new Map();
  secondary.forEach((item) => bySelector.set(item.selector, item));
  primary.forEach((item) => bySelector.set(item.selector, item));
  return Array.from(bySelector.values());
}

function matchFieldKey(field) {
  const text = normalizeFieldText([
    field.label,
    field.placeholder,
    field.name,
    field.idAttr,
    field.ariaLabel
  ].filter(Boolean).join(" "));

  const priorityKeys = [
    "expected_position",
    "email",
    "phone",
    "name",
    "gender",
    "education_level",
    "graduation_year",
    "major",
    "school"
  ];

  for (const key of priorityKeys) {
    const aliases = FIELD_ALIASES[key] || [];
    if (aliases.some((alias) => text.includes(normalizeFieldText(alias)))) return key;
  }
  return "";
}

function isSuspiciousFieldValue(field, value, knowledgeBase) {
  const key = matchFieldKey(field);
  const normalizedValue = normalizeFieldText(value);
  const school = normalizeFieldText(knowledgeBase.school || "");
  const major = normalizeFieldText(knowledgeBase.major || "");

  if (key === "expected_position" && school && normalizedValue === school) return true;
  if (key === "expected_position" && major && normalizedValue === major) return true;
  if (key === "school" && knowledgeBase.expected_position &&
      normalizedValue === normalizeFieldText(knowledgeBase.expected_position)) return true;
  return false;
}

function normalizeFieldText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function normalizeExtractedProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== "object") return {};

  const source = rawProfile.profile && typeof rawProfile.profile === "object"
    ? rawProfile.profile
    : rawProfile.personal_info && typeof rawProfile.personal_info === "object"
      ? rawProfile.personal_info
      : rawProfile;

  const normalized = {};
  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return;

    normalized[toSnakeCase(key)] = Array.isArray(value)
      ? value.join("、")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  });
  return normalized;
}

function toSnakeCase(key) {
  return String(key)
    .trim()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

async function detectAndPauseForBlocker(tabId) {
  const blocker = await sendTabMessage(tabId, { type: "DETECT_PAGE_BLOCKER" }).catch(() => ({ blocked: false }));
  if (!blocker || !blocker.blocked) return { blocked: false };

  const message = blocker.reason || "Agent 遇到需要用户处理的页面状态，已暂停。";
  await sendTabMessage(tabId, {
    type: "EXECUTE_ACTION",
    action: { action: "show_hitl", message }
  }).catch(() => {});
  sendLog(message);
  return { blocked: true, reason: message };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function validateRunnableTab(activeTab) {
  if (!activeTab || !activeTab.url || /^(chrome|edge|about|chrome-extension):\/\//.test(activeTab.url)) {
    throw new Error("安全限制：无法在系统页面执行。请打开一个真实网页。");
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (!chrome.runtime.lastError) {
        resolve(response);
        return;
      }

      const errorMessage = chrome.runtime.lastError.message || "";
      if (!/Receiving end does not exist|Could not establish connection/i.test(errorMessage)) {
        reject(new Error(errorMessage));
        return;
      }

      injectContentScripts(tabId)
        .then(() => {
          chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(retryResponse);
          });
        })
        .catch((error) => reject(error));
    });
  });
}

async function injectContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "src/content/uiInjector.js",
      "src/content/domScanner.js",
      "src/content/actionExecutor.js",
      "src/content/index.js"
    ]
  });
}

export function isFormFillTask(task) {
  return /填表|填写|表单|简历|投递|申请|application|apply|form|resume|cv/i.test(task || "");
}
