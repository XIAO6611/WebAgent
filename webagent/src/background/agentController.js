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

export function broadcastStatus(statusString) {
  currentAgentStatus = statusString;
  try {
    chrome.runtime.sendMessage({ type: "UPDATE_STATUS", status: statusString });
  } catch (e) {}
}

export function resumeAgent() {
  if (hitlResolver) {
    hitlResolver("RESUME");
    hitlResolver = null;
    sendLog("🟢 人工已放行，大脑重新上线...");
    broadcastStatus("RUNNING"); 
  }
}

export function abortAgentFromHITL() {
  if (hitlResolver) {
    hitlResolver(false);
    hitlResolver = null;
    isAgentRunning = false;
    sendLog("🛑 用户已终止挂起任务，系统释放接管权...");
    broadcastStatus("IDLE"); 
  }
}

export function stopAgent() {
  if (isAgentRunning) {
    isAgentRunning = false;
    sendLog("🛑 收到中止指令，正在紧急刹车...");
    if (hitlResolver) {
      hitlResolver(false);
      hitlResolver = null;
    }
    broadcastStatus("IDLE"); 
  }
}

export function refillAgent() {
  if (hitlResolver) {
    hitlResolver("REFILL");
    hitlResolver = null;
    sendLog("🔄 用户请求重新填写，正在重新扫描并覆盖...");
    broadcastStatus("RUNNING"); 
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
  if (!tabId) {
    console.warn("waitForPageLoad: 无效的 tabId，跳过等待");
    return;
  }
  let retries = 0;
  while (retries < 20 && isAgentRunning) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.status === 'complete') {
        await smartSleep(1500);
        return;
      }
    } catch (e) {
      // 标签页可能已关闭或刷新，直接返回，避免抛出异常
      console.warn(`等待标签页 ${tabId} 时出错:`, e.message);
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
  let trajectory = [];
  let lastPlanStr = '';
  let lastUrl = '';
  let collectedJobs = [];
  let listPageUrl = '';

  try {
    const { apiKey, apiBaseUrl, vlmModel, llmModel, kbData, resumeText } = await getKnowledgeBase();
    if (!apiKey) throw new Error("未配置 API Key！");
    const llmConfig = { apiKey, apiBaseUrl, vlmModel, llmModel };

    const parsedTask = injectPlaceholders(userTask, kbData);
    sendLog(`🎯 最终指令: "${parsedTask}"`);

    // ---------- 解析目标数量 ----------
    let targetCount = 1;
    const countMatch = userTask.match(/收集\s*(\d+)\s*个/);
    const firstMatch = /第[一二三四五六七八九十]\s*个/.test(userTask) || /第一个/.test(userTask);
    if (countMatch) {
      targetCount = parseInt(countMatch[1], 10);
      sendLog(`📊 从指令解析目标数量: ${targetCount}`);
    } else if (firstMatch) {
      targetCount = 1;
      sendLog(`📊 识别为"第一个"，目标数量: 1`);
    }

    let isTaskComplete = false;
    let stepCount = 0;
    const MAX_STEPS = 30;
    let currentPlan = "['分析页面布局制定计划']";
    let forceRefill = false;
    sendLog("🤖 启动 VLM 视觉感知循环...");

    while (!isTaskComplete && stepCount < MAX_STEPS && isAgentRunning) {
      stepCount++;

      // ---------- 1. 重新获取当前标签页 ----------
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab || activeTab.url.startsWith("chrome://") || activeTab.url.startsWith("edge://")) {
        sendLog("⚠️ 无效页面，等待切换...");
        await smartSleep(1500);
        continue;
      }

      sendLog(`\n🔄 [第 ${stepCount} 轮] 正在观察屏幕...`);

      // ---------- 2. 截图 ----------
      let screenshotBase64;
      try {
        screenshotBase64 = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'jpeg', quality: 60 });
      } catch (e) {
        sendLog("⚠️ 截图失败，正在重试...");
        await smartSleep(1000);
        continue;
      }

      // ---------- 3. 获取 DOM ----------
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

      // ---------- 4. 构建 DOM + 页面语义 ----------
      const pageMeta = `[PAGE] 标题: ${activeTab.title || ''}, URL: ${activeTab.url}`;
      const simpleDomForLLM = [
        pageMeta,
        ...domInfo.map(el => {
          let str = `[${el.id}] ${el.type}`;
          if (el.text) str += `: ${el.text}`;
          if (el.href) str += ` (href: ${el.href})`;
          return str;
        })
      ];

      let pageSemantics = {};
      try {
        pageSemantics = await chrome.tabs.sendMessage(activeTab.id, { type: "GET_PAGE_SEMANTICS" });
      } catch (e) {
        pageSemantics = { title: activeTab.title || '', url: activeTab.url, headings: [], hasList: false, hasDetail: false, stats: {inputs:0,buttons:0,links:0,forms:0}, matchedKeywords: [] };
      }

      // ---------- 5. 记录列表页 URL ----------
      if (activeTab.url.includes('join.qq.com') && !pageSemantics.hasDetail && !listPageUrl) {
        listPageUrl = activeTab.url;
        sendLog(`📋 已记录目标列表页 URL: ${listPageUrl}`);
      }

      // ---------- 6. 检查是否收集完成 ----------
      if (collectedJobs.length >= targetCount) {
        sendLog(`✅ 已收集 ${collectedJobs.length}/${targetCount} 个职位，任务完成。`);
        isTaskComplete = true;
        break;
      }

      // ---------- 7. 构建 Prompt ----------
      const systemPrompt = buildReActPrompt(
        parsedTask, kbData, currentPlan, collectedData.length,
        simpleDomForLLM, stepCount, visitedUrls, forceRefill,
        trajectory, pageSemantics, collectedJobs.length, targetCount
      );

      sendLog("📡 呼叫大脑思考中...");
      let actionData;
      try {
        actionData = await askVLM(llmConfig, systemPrompt, screenshotBase64);
      } catch (apiError) {
        sendLog(`❌ API 异常: ${apiError.message}`);
        isAgentRunning = false;
        break;
      }
      if (!isAgentRunning) break;

      // ---------- 8. 防重复逻辑 ----------
      if (actionData.action === 'scroll') {
        consecutiveScrolls++;
        if (consecutiveScrolls >= 3) { sendLog("⚠️ 连续滚动无效，结束。"); break; }
      } else { consecutiveScrolls = 0; }
      if (actionData.action === 'extract') {
        consecutiveExtracts++;
        if (consecutiveExtracts >= 2) { sendLog("⚠️ 连续提取无效，结束。"); break; }
      } else { consecutiveExtracts = 0; }

      // ---------- 9. 坐标解析 ----------
      if (['click', 'type'].includes(actionData.action) && actionData.element_id !== undefined) {
        const targetEl = domInfo.find(el => el.id === actionData.element_id);
        if (targetEl) {
          actionData.x = targetEl.x;
          actionData.y = targetEl.y;
          if (actionData.action === 'click' && targetEl.href) visitedUrls.push(targetEl.href);
        }
      }

      // ---------- 10. 计划守卫 ----------
      const currentUrl = activeTab.url;
      if (actionData.remaining_plan) {
        const newPlanStr = JSON.stringify(actionData.remaining_plan);
        if (newPlanStr === lastPlanStr && currentUrl === lastUrl) {
          sendLog("⚠️ 计划停滞，强制清空重规划。");
          currentPlan = "[]";
          trajectory = [];
        } else {
          currentPlan = newPlanStr;
          lastPlanStr = newPlanStr;
          lastUrl = currentUrl;
        }
      }

      // ---------- 11. 日志 & 轨迹 ----------
      sendLog(`🤔 思考: ${actionData.thought}`);
      let actionLog = `🕹️ 动作: [${actionData.action}]`;
      if (actionData.element_id !== undefined) actionLog += ` ID:${actionData.element_id}`;
      if (actionData.action === 'type') actionLog += ` 内容:"${actionData.text}"`;
      if (actionData.expected_outcome) actionLog += ` 预期:${actionData.expected_outcome}`;
      sendLog(actionLog);

      let targetDesc = actionData.element_id !== undefined ? `ID:${actionData.element_id}` : (actionData.url || '无');
      trajectory.push(`第${stepCount}步: ${actionData.action} (${targetDesc})`);
      if (trajectory.length > 6) trajectory.shift();

      // ---------- 12. 动作分发 ----------
      if (actionData.action === "show_hitl") {
        sendLog(`⚠️ 安全网关: ${actionData.message}`);
        try { chrome.tabs.sendMessage(activeTab.id, { type: "EXECUTE_ACTION", action: { ...actionData, hitl_type: "security" } }).catch(()=>{}); } catch(e) {}
        broadcastStatus("WAITING");
        const shouldContinue = await new Promise(resolve => { hitlResolver = resolve; });
        if (!shouldContinue) break;
      }
      else if (actionData.action === "fill_form") {
        // 保持原有 fill_form 逻辑
        sendLog("🪄 触发批量填表（保留原逻辑）");
        try {
          const formScan = await sendTabMessage(activeTab.id, { type: "SCAN_FORM_FIELDS" });
          if (!formScan || !formScan.fields) sendLog("⚠️ 未找到表单");
        } catch(e) { sendLog(`❌ 填表失败: ${e.message}`); }
      }
      else if (actionData.action === "done") {
        if (collectedJobs.length >= targetCount) { 
          isTaskComplete = true; 
          sendLog("✅ 任务闭环。"); 
          break; 
        } else { 
          sendLog(`⚠️ 收集未满(${collectedJobs.length}/${targetCount})，禁止结束。`); 
          continue; 
        }
      }
      else if (actionData.action === "extract") {
        sendLog("📥 提取文本...");
        let extractedText = "";
        try {
          const pageText = await chrome.tabs.sendMessage(activeTab.id, { type: "GET_TEXT_CONTENT" });
          extractedText = pageText || "";
          collectedData += `\n\n--- 第 ${stepCount} 步 ---\n` + extractedText;
          const lines = extractedText.split('\n').filter(l => l.trim());
          let jobName = lines.length > 0 ? lines[0].trim() : `职位 ${collectedJobs.length + 1}`;
          if (!collectedJobs.some(j => j.name === jobName)) {
            collectedJobs.push({ name: jobName, content: extractedText });
            sendLog(`📌 已收集第 ${collectedJobs.length} 个: ${jobName}`);
          } else {
            sendLog(`⚠️ 重复内容，已跳过。`);
          }
        } catch (e) {}
        await smartSleep(1000);

        // ---------- 自动返回列表页 ----------
        if (collectedJobs.length < targetCount && pageSemantics.hasDetail) {
          sendLog(`🔄 已收集 ${collectedJobs.length}/${targetCount}，返回列表继续...`);
          if (listPageUrl && listPageUrl.includes('join.qq.com')) {
            const curTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (curTabs[0]) {
              await chrome.tabs.update(curTabs[0].id, { url: listPageUrl });
              await waitForPageLoad(curTabs[0].id);
              sendLog(`✅ 已跳转至列表页: ${listPageUrl}`);
            }
          } else {
            // 备选方案：点击“岗位投递”
            sendLog("⚠️ 无有效 listPageUrl，尝试点击导航栏返回...");
            try {
              const navResult = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: () => {
                  const links = document.querySelectorAll('a, button');
                  for (let el of links) {
                    if (el.textContent.includes('岗位投递')) {
                      el.click();
                      return true;
                    }
                  }
                  return false;
                }
              });
              if (navResult && navResult[0] && navResult[0].result) {
                await waitForPageLoad(activeTab.id);
                sendLog("✅ 已点击'岗位投递'返回列表。");
              } else {
                sendLog("⚠️ 未找到'岗位投递'，尝试 back...");
                await chrome.tabs.sendMessage(activeTab.id, { type: "EXECUTE_ACTION", action: { action: "back" } }).catch(()=>{});
                await waitForPageLoad(activeTab.id);
              }
            } catch (e) {
              sendLog(`⚠️ 备选返回失败: ${e.message}`);
            }
          }
          continue;
        }
      }
      else if (actionData.action === "goto" && actionData.url) {
        sendLog(`🔗 跳转至: ${actionData.url}`);
        visitedUrls.push(actionData.url);
        try {
          const curTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (curTabs[0]) await chrome.tabs.update(curTabs[0].id, { url: actionData.url });
          else await chrome.tabs.create({ url: actionData.url });
        } catch (e) { sendLog(`⚠️ 跳转失败: ${e.message}`); }
        const newTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (newTabs[0]) await waitForPageLoad(newTabs[0].id);
      }
      else if (actionData.action === "back") {
        const beforeUrl = activeTab.url;
        try {
          const curTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (curTabs[0]) {
            await chrome.tabs.sendMessage(curTabs[0].id, { type: "EXECUTE_ACTION", action: actionData }).catch(()=>{});
            await waitForPageLoad(curTabs[0].id);
          }
        } catch (e) { sendLog(`⚠️ back 异常: ${e.message}`); }
        const afterTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (afterTabs[0] && afterTabs[0].url === beforeUrl && listPageUrl) {
          sendLog(`⚠️ back 无效，强制跳转至列表页: ${listPageUrl}`);
          await chrome.tabs.update(afterTabs[0].id, { url: listPageUrl });
          await waitForPageLoad(afterTabs[0].id);
        }
      }
      else if (["scroll", "click", "type", "press_enter"].includes(actionData.action)) {
        try {
          const curTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (curTabs[0]) {
            await chrome.tabs.sendMessage(curTabs[0].id, { type: "EXECUTE_ACTION", action: actionData }).catch(()=>{});
            await waitForPageLoad(curTabs[0].id);
          }
        } catch (e) { sendLog(`⚠️ 动作执行异常: ${e.message}`); }
      }
    } // end while

    // ---------- 结束 ----------
    if (!isAgentRunning) { sendLog("🛑 任务已中止。"); return; }
    if (stepCount >= MAX_STEPS) sendLog("⚠️ 达到最大步数。");

    if (collectedJobs.length > 0) {
      sendLog(`📝 生成报告，共 ${collectedJobs.length} 个职位...`);
      let reportContent = `# 职位收集报告\n\n`;
      collectedJobs.forEach((job, idx) => {
        reportContent += `## 职位 ${idx+1}: ${job.name}\n\n${job.content}\n\n---\n\n`;
      });
      saveMarkdownFile(reportContent, "职位收集报告.md");
    } else {
      sendLog("⚠️ 未收集到任何职位。");
    }
  } catch (error) {
    sendLog(`❌ 致命错误: ${error.message}`);
  } finally {
    isAgentRunning = false;
    broadcastStatus("IDLE");
    chrome.storage.local.get(['developerMode'], (res) => {
      if (res.developerMode && devLogHistory.length > 0) {
        sendLog("🛠️ 生成开发者日志...");
        const mdContent = `# Web Agent 执行跟踪日志\n\n${devLogHistory.map(log => `- ${log}`).join('\n')}\n`;
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

// ========== 从文本提取简历 ==========
export async function extractProfileFromText(payload) {
  const { apiKey, apiBaseUrl, vlmModel, llmModel, kbData, resumeText: storedResumeText } = await getKnowledgeBase();
  const llmConfig = { apiKey, apiBaseUrl, vlmModel, llmModel };
  const resumeText = payload && payload.resumeText ? payload.resumeText : storedResumeText;
  if (!llmConfig.apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");
  if (!resumeText) throw new Error("请先填写或导入简历文本。");

  const prompt = `${buildProfileExtractionPrompt(kbData, "以下是用户简历文本，请提取其中适合自动填表的个人信息。")}\n\n简历文本：\n${resumeText}`;
  return normalizeExtractedProfile(await askTextJson(llmConfig, prompt));
}

// ========== 从图片提取简历 ==========
export async function extractProfileFromImage(payload) {
  const { apiKey, apiBaseUrl, vlmModel, llmModel, kbData } = await getKnowledgeBase();
  const llmConfig = { apiKey, apiBaseUrl, vlmModel, llmModel };
  if (!llmConfig.apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");
  if (!payload || !payload.imageDataUrl) throw new Error("未收到图片。");

  const prompt = buildProfileExtractionPrompt(kbData, "这是一张或多张简历截图，请提取其中适合自动填表的个人信息。");
  return normalizeExtractedProfile(await askVLM(llmConfig, prompt, payload.imageDataUrl));
}

// ========== 知识库更新 ==========
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
  const { apiKey, apiBaseUrl, vlmModel, llmModel, kbData } = await getKnowledgeBase();
  if (!apiKey) throw new Error("未配置 API Key。");
  const llmConfig = { apiKey, apiBaseUrl, vlmModel, llmModel };

  const screenshotBase64 = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
  const result = await askVLM(llmConfig, buildKnowledgeUpdatePrompt(kbData, payload), screenshotBase64);
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

// ========== 辅助函数（保持不变） ==========
async function reviewAndCorrectFilledForm({ tabId, windowId, profile, knowledgeBase }) {
  const { apiKey, apiBaseUrl, vlmModel, llmModel } = await getKnowledgeBase();
  const llmConfig = { apiKey, apiBaseUrl, vlmModel, llmModel };
  sendLog("启动独立填表质检 Agent：重新扫描当前表单，不读取上一轮填写记忆。");

  const currentScan = await sendTabMessage(tabId, { type: "SCAN_FORM_FIELDS" });
  if (!currentScan || !Array.isArray(currentScan.fields)) return { warnings: [] };

  const localCorrections = buildLocalReviewCorrections(currentScan.fields, knowledgeBase);
  let modelCorrections = [];
  let warnings = [];

  try {
    const screenshotBase64 = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 });
    const reviewDecision = await askVLM(llmConfig, buildFormReviewPrompt(currentScan, {
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
    field.ariaLabel
  ].filter(Boolean).join(" "));

  const priorityKeys = [
    "expected_position", "email", "phone", "name", "gender", 
    "education_level", "graduation_year", "major", "school"
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