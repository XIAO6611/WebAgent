let collectedData = "";
let currentRunId = 0;
let activeAbortController = null;

chrome.action.onClicked.addListener(async (tab) => {
  try {
    validateRunnableTab(tab);
    await sendTabMessage(tab.id, { type: "TOGGLE_AGENT_PANEL" });
  } catch (error) {
    sendLog(`无法打开悬浮面板: ${error.message}`);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AGENT") {
    stopActiveRun("收到新任务，已停止上一轮任务。", false);
    currentRunId += 1;
    const runId = currentRunId;
    activeAbortController = new AbortController();
    collectedData = "";
    sendResponse({ status: "后台已接管，正在解析指令..." });

    if (isFormFillTask(message.payload || "")) {
      runFormFillTask(message.payload || "", runId);
    } else {
      runAgentLoop(message.payload || "", runId);
    }
  }

  if (message.type === "STOP_AGENT") {
    stopActiveRun("已收到停止指令，正在中断当前任务。", true);
    sendResponse({ status: "已发送停止指令。" });
  }

  if (message.type === "REMEMBER_FORM_INFO") {
    rememberFormInfo(message.payload)
      .then(() => sendLog("已根据你的确认记忆本页表单修改。"))
      .catch((error) => sendLog(`记忆表单信息失败: ${error.message}`));
    sendResponse({ ok: true });
  }

  if (message.type === "EXTRACT_PROFILE_FROM_IMAGE") {
    extractProfileFromImage(message.payload)
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "EXTRACT_PROFILE_FROM_TEXT") {
    extractProfileFromText(message.payload)
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "PROPOSE_KNOWLEDGE_UPDATES") {
    proposeKnowledgeUpdates(sender.tab, message.payload)
      .catch((error) => sendLog(`知识库差异分析失败: ${error.message}`));
    sendResponse({ ok: true });
  }

  if (message.type === "PROPOSE_KNOWLEDGE_UPDATES_FROM_ACTIVE_TAB") {
    proposeKnowledgeUpdatesFromActiveTab()
      .then(() => sendResponse({ status: "已生成知识库更新建议，请在页面中确认。" }))
      .catch((error) => sendResponse({ status: `知识库更新分析失败: ${error.message}` }));
    return true;
  }

  if (message.type === "APPLY_KNOWLEDGE_UPDATES") {
    applyKnowledgeUpdates(message.payload)
      .then(() => sendLog("已保存勾选的知识库更新。"))
      .catch((error) => sendLog(`保存知识库更新失败: ${error.message}`));
    sendResponse({ ok: true });
  }

  return true;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isFormFillTask(task) {
  return /填表|填写|表单|简历|投递|申请|application|apply|form|resume|cv/i.test(task);
}

async function runFormFillTask(userTask, runId) {
  try {
    const activeTab = await getActiveTab();
    validateRunnableTab(activeTab);
    throwIfStopped(runId);

    const storage = await chrome.storage.local.get(["apiKey", "knowledgeBase", "resumeText"]);
    if (!storage.apiKey) throw new Error("未配置 API Key，请先到选项页配置。");
    throwIfStopped(runId);

    sendLog("开始表单填写模式：先扫描当前页面表单字段。");
    const blocker = await detectAndPauseForBlocker(activeTab.id);
    if (blocker.blocked) return;
    throwIfStopped(runId);

    const formScan = await sendTabMessage(activeTab.id, { type: "SCAN_FORM_FIELDS" });
    throwIfStopped(runId);

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
      return;
    }

    const screenshotBase64 = await chrome.tabs.captureVisibleTab(activeTab.windowId);
    const profile = buildProfileContext(storage);

    sendLog(`发现 ${formScan.fields.length} 个可填写字段，正在让模型匹配简历信息与字段。`);
    const decision = await askFormFillDecision({
      apiKey: storage.apiKey,
      userTask,
      formScan,
      profile,
      screenshotBase64,
      signal: activeAbortController.signal
    });
    throwIfStopped(runId);

    const deterministicAssignments = buildDeterministicAssignments(formScan.fields, profile.knowledgeBase);
    const modelAssignments = normalizeAssignments(decision.assignments, formScan.fields, profile.knowledgeBase);
    const assignments = mergeAssignments(deterministicAssignments, modelAssignments);
    if (assignments.length === 0) {
      sendLog("模型没有找到可安全填写的字段，已停止。");
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
    throwIfStopped(runId);

    const successCount = (fillResult.results || []).filter((item) => item.ok).length;
    sendLog(`已填写 ${successCount}/${assignments.length} 个字段。`);

    const warningText = Array.isArray(decision.warnings) && decision.warnings.length
      ? `注意：${decision.warnings.join("；")}。`
      : "";
    const missingText = Array.isArray(decision.missing_fields) && decision.missing_fields.length
      ? `还有这些字段资料不足，需要你手动填写或确认：${decision.missing_fields.join("、")}。`
      : "";
    await sendTabMessage(activeTab.id, {
      type: "SHOW_FORM_REVIEW_MODAL",
      message: `Agent 已暂停在提交前。${missingText}请检查表单内容，确认无误后由你手动提交。${warningText}`
    });
  } catch (error) {
    if (isStopError(error)) {
      sendLog("任务已停止。");
      return;
    }
    sendLog(`发生错误: ${error.message}`);
  } finally {
    finishRun(runId);
  }
}

async function askFormFillDecision({ apiKey, userTask, formScan, profile, screenshotBase64, signal }) {
  const fieldsForPrompt = formScan.fields.map((field) => ({
    selector: field.selector,
    tag: field.tag,
    type: field.type,
    label: field.label,
    name: field.name,
    placeholder: field.placeholder,
    required: field.required,
    options: field.options,
    value: field.value
  }));

  const prompt = `
你是一个求职网站表单填写 Agent。请根据用户任务、用户资料、页面截图和 DOM 字段列表，为当前网页表单生成安全的自动填写计划。

用户任务：
${userTask}

用户资料，包含简历文本、已确认个人信息和历史记忆：
${JSON.stringify(profile, null, 2)}

当前网页：
${formScan.title}
${formScan.url}

字段列表：
${JSON.stringify(fieldsForPrompt, null, 2)}

规则：
1. 只填写能从用户资料中明确推断出的内容，不要编造。
2. 不填写 password、验证码、短信码、一次性代码、文件上传字段。
3. 不点击提交、保存、下一步、申请等按钮；填完必须交给用户检查。
4. select/radio 字段只能填写 options 中存在或语义等价的选项。
5. 返回的 selector 必须来自字段列表。
6. 字段语义必须严格匹配：学校/院校/毕业院校只能填 school；期望岗位/职位/职业/应聘岗位只能填 expected_position 或明确的岗位名称。
7. 如果 expected_position 不存在，不要用 school、major、company 等字段替代，应放入 missing_fields。

只返回 JSON：
{
  "assignments": [
    {
      "selector": "字段列表中的 selector",
      "value": "要填写的内容",
      "reason": "为什么这样填"
    }
  ],
  "missing_fields": ["资料不足无法填写的字段"],
  "warnings": ["需要用户检查的风险点"]
}`;

  sendLog("调用视觉模型生成填表映射。");
  return askVisionJson(apiKey, prompt, screenshotBase64, signal);
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

function buildDeterministicAssignments(fields, knowledgeBase) {
  const assignments = [];
  if (!knowledgeBase || typeof knowledgeBase !== "object") return assignments;

  fields.forEach((field) => {
    if (!field || field.value) return;
    const key = matchFieldKey(field);
    if (!key || knowledgeBase[key] === undefined || knowledgeBase[key] === null) return;
    const value = String(knowledgeBase[key]).trim();
    if (!value || isSuspiciousFieldValue(field, value, knowledgeBase)) return;
    assignments.push({
      selector: field.selector,
      value,
      source: "knowledgeBase",
      key
    });
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
    .map((item) => ({
      selector: item.selector,
      value: String(item.value),
      source: "model"
    }));
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

  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
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

function buildProfileContext(storage) {
  const knowledgeBase = parseJsonObject(storage.knowledgeBase, {});
  return {
    knowledgeBase,
    resumeText: storage.resumeText || "",
    rememberedFormInfo: knowledgeBase.autofillMemory || {}
  };
}

async function extractProfileFromImage(payload) {
  const storage = await chrome.storage.local.get(["apiKey", "knowledgeBase"]);
  const apiKey = payload && payload.apiKey ? payload.apiKey : storage.apiKey;
  if (!apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");
  if (!payload || !payload.imageDataUrl) throw new Error("未收到图片。");

  const existing = parseJsonObject(storage.knowledgeBase, {});
  const prompt = buildProfileExtractionPrompt(existing, "这是一张或多张简历截图，请提取其中适合自动填表的个人信息。");
  return normalizeExtractedProfile(await askVisionJson(apiKey, prompt, payload.imageDataUrl));
}

async function extractProfileFromText(payload) {
  const storage = await chrome.storage.local.get(["apiKey", "knowledgeBase", "resumeText"]);
  const apiKey = payload && payload.apiKey ? payload.apiKey : storage.apiKey;
  const resumeText = payload && payload.resumeText ? payload.resumeText : storage.resumeText;
  if (!apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");
  if (!resumeText) throw new Error("请先填写或导入简历文本。");

  const existing = parseJsonObject(storage.knowledgeBase, {});
  const prompt = `${buildProfileExtractionPrompt(existing, "以下是用户简历文本，请提取其中适合自动填表的个人信息。")}\n\n简历文本：\n${resumeText}`;
  return normalizeExtractedProfile(await askTextJson(prompt, apiKey));
}

function buildProfileExtractionPrompt(existing, task) {
  return `${task}

已有知识库：
${JSON.stringify(existing, null, 2)}

请输出一个扁平 JSON object，字段名使用英文 snake_case，值使用中文或原文。优先提取：
name, gender, phone, email, school, major, education_level, graduation_year, expected_position, city, skills, experience_summary, project_summary。
如果信息不存在，不要编造；如果已有知识库中已有更明确内容，可以保留。
只返回 JSON object，不要 Markdown。`;
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

async function proposeKnowledgeUpdates(tab, payload) {
  if (!tab || !tab.id) throw new Error("缺少当前标签页。");
  const storage = await chrome.storage.local.get(["apiKey", "knowledgeBase"]);
  if (!storage.apiKey) throw new Error("未配置 API Key，请先保存智谱 API Key。");

  const screenshotBase64 = await chrome.tabs.captureVisibleTab(tab.windowId);
  const knowledgeBase = parseJsonObject(storage.knowledgeBase, {});
  const prompt = `你是个人资料知识库维护助手。请观察当前表单截图，并结合页面脚本采集到的字段值，比较已有知识库，找出用户手动修改、AI 填错后被用户修正、或值得新增到知识库的信息。

已有知识库：
${JSON.stringify(knowledgeBase, null, 2)}

当前表单采集值：
${JSON.stringify(payload || {}, null, 2)}

规则：
1. 只建议保存稳定的个人信息，例如姓名、性别、电话、邮箱、学校、学历、专业、期望岗位、城市、技能等。
2. 不要保存验证码、协议勾选、临时网页状态。
3. 如果表单值明显是填错的，例如“期望职业岗位”填成学校名，不要建议写入知识库，应在 reason 说明风险。
4. key 使用英文 snake_case。label 使用中文。

只返回 JSON：
{
  "proposals": [
    {
      "key": "expected_position",
      "label": "期望职业岗位",
      "currentValue": "原知识库中的值，没有则为空字符串",
      "newValue": "建议保存的新值",
      "action": "add | update",
      "reason": "为什么建议更新"
    }
  ]
}`;

  const result = await askVisionJson(storage.apiKey, prompt, screenshotBase64);
  const proposals = Array.isArray(result.proposals) ? result.proposals : [];
  await sendTabMessage(tab.id, {
    type: "SHOW_KNOWLEDGE_UPDATE_MODAL",
    payload: { proposals }
  });
}

async function proposeKnowledgeUpdatesFromActiveTab() {
  const activeTab = await getActiveTab();
  validateRunnableTab(activeTab);

  const blocker = await detectAndPauseForBlocker(activeTab.id);
  if (blocker.blocked) return;

  const payload = await sendTabMessage(activeTab.id, { type: "COLLECT_CURRENT_FORM_VALUES" });
  await proposeKnowledgeUpdates(activeTab, payload);
}

async function applyKnowledgeUpdates(payload) {
  const updates = payload && Array.isArray(payload.updates) ? payload.updates : [];
  if (updates.length === 0) return;

  const storage = await chrome.storage.local.get(["knowledgeBase"]);
  const knowledgeBase = parseJsonObject(storage.knowledgeBase, {});
  updates.forEach((item) => {
    if (!item || !item.key || item.newValue === undefined || item.newValue === null) return;
    knowledgeBase[item.key] = String(item.newValue);
  });

  await chrome.storage.local.set({
    knowledgeBase: JSON.stringify(knowledgeBase, null, 2)
  });
}

async function rememberFormInfo(payload) {
  if (!payload || !Array.isArray(payload.fields)) return;

  const storage = await chrome.storage.local.get(["knowledgeBase"]);
  const knowledgeBase = parseJsonObject(storage.knowledgeBase, {});
  const memory = knowledgeBase.autofillMemory || {};
  const host = safeHost(payload.url) || "unknown";

  memory[host] = {
    title: payload.title || "",
    url: payload.url || "",
    capturedAt: payload.capturedAt || new Date().toISOString(),
    fields: payload.fields
  };

  knowledgeBase.autofillMemory = memory;
  await chrome.storage.local.set({
    knowledgeBase: JSON.stringify(knowledgeBase, null, 2)
  });
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return "";
  }
}

async function runAgentLoop(userTask, runId) {
  try {
    const activeTab = await getActiveTab();
    validateRunnableTab(activeTab);
    throwIfStopped(runId);

    const storage = await chrome.storage.local.get(["apiKey", "knowledgeBase"]);
    if (!storage.apiKey) throw new Error("未配置 API Key，请先到选项页配置。");
    throwIfStopped(runId);

    let parsedTask = userTask;
    let kbData = {};
    if (storage.knowledgeBase) {
      try {
        kbData = JSON.parse(storage.knowledgeBase);
        for (const key in kbData) {
          if (typeof kbData[key] !== "string" && typeof kbData[key] !== "number") continue;
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
          parsedTask = parsedTask.replace(regex, String(kbData[key]));
        }
      } catch (e) {
        sendLog("知识库 JSON 格式有误，跳过占位符替换。");
      }
    }
    sendLog(`最终执行指令: "${parsedTask}"`);

    let isTaskComplete = false;
    let stepCount = 0;
    const MAX_STEPS = 12;
    let currentPlan = "['分析页面布局并制定初始计划']";

    sendLog("启动 VLM 视觉感知循环。");

    while (!isTaskComplete && stepCount < MAX_STEPS && !isRunStopped(runId)) {
      stepCount += 1;
      sendLog(`第 ${stepCount} 轮：正在观察当前屏幕。`);

      const blocker = await detectAndPauseForBlocker(activeTab.id);
      if (blocker.blocked) break;
      throwIfStopped(runId);

      const screenshotBase64 = await chrome.tabs.captureVisibleTab(activeTab.windowId);
      const domInfo = await sendTabMessage(activeTab.id, { type: "GET_DOM_INFO" }).catch(() => []);
      throwIfStopped(runId);

      const systemPrompt = `你是一个高级网页自动操作 Agent。当前是第 ${stepCount} 步。

总任务："${parsedTask}"
知识库：${JSON.stringify(kbData)}
上一轮剩余计划：${currentPlan}
当前收集箱字符数：${collectedData.length}

请观察截图和交互元素列表：${JSON.stringify(domInfo)}

执行逻辑：
1. 核对上一轮剩余计划。如果计划中的某一步已完成，请将其划掉。
2. 如果剩余计划为空，或你认为任务已彻底完成，必须输出 action: "done"。
3. 如果需要输入内容，优先使用知识库中的数据。
4. click/type 必须优先从交互元素列表中选择一个 target_id，并使用该元素的 selector/x/y。不要凭空编造坐标。
5. 如果上一步已经点击并聚焦搜索框，下一步应该直接输出 type 并带上 text，不要重复 click。
6. 如果遇到登录、验证码、隐私授权、地区/身份选择、无法判断的弹窗或必须由用户确认的内容，输出 action: "show_hitl"，并在 text 中说明需要用户处理什么。

只能返回 JSON：
{
  "thought": "一句话描述你看到什么，以及为什么做下一步",
  "remaining_plan": ["步骤A", "步骤B"],
  "action": "click | type | press_enter | scroll | extract | show_hitl | done",
  "target_id": 0,
  "selector": "交互元素列表中的 selector",
  "x": 100,
  "y": 200,
  "text": "type 动作需要输入的文字"
}`;

      sendLog("调用视觉模型思考中。");
      const actionData = await askVisionJson(storage.apiKey, systemPrompt, screenshotBase64, activeAbortController.signal);
      throwIfStopped(runId);
      currentPlan = JSON.stringify(actionData.remaining_plan || []);

      sendLog(`思考: ${actionData.thought || ""}`);
      sendLog(`剩余计划: ${currentPlan}`);
      enrichActionTarget(actionData, domInfo);
      sendLog(formatActionLog(actionData));

      if (actionData.action === "done") {
        isTaskComplete = true;
        sendLog("Agent 判定任务已完成。");
        break;
      } else if (actionData.action === "show_hitl") {
        await sendTabMessage(activeTab.id, {
          type: "EXECUTE_ACTION",
          action: {
            action: "show_hitl",
            message: actionData.text || "Agent 遇到需要用户处理的页面状态，已暂停。"
          }
        });
        sendLog("遇到需要用户处理的页面状态，已暂停。");
        break;
      } else if (actionData.action === "extract") {
        sendLog("正在提取本页文字。");
        const pageText = await sendTabMessage(activeTab.id, { type: "GET_TEXT_CONTENT" });
        throwIfStopped(runId);
        collectedData += `\n\n--- 第 ${stepCount} 步提取 ---\n${pageText}`;
        await sleep(1000);
      } else if (["scroll", "click", "type", "press_enter"].includes(actionData.action)) {
        if (["click", "type"].includes(actionData.action) && !actionData.selector &&
            (!Number.isFinite(Number(actionData.x)) || !Number.isFinite(Number(actionData.y)))) {
          sendLog("本轮动作缺少可执行目标，跳过执行并重新观察页面。");
          await sleep(1000);
          continue;
        }
        await executePageAction(activeTab.id, actionData);
        throwIfStopped(runId);
        sendLog("正在执行页面操作，等待网页响应。");
        await sleep(3500);
      }
    }

    if (isRunStopped(runId)) {
      sendLog("任务已停止。");
      return;
    }

    if (stepCount >= MAX_STEPS) {
      sendLog("达到最大步数限制，已停止。");
    }

    if (collectedData.length > 0) {
      sendLog("正在生成 Markdown 报告。");
      const summaryPrompt = `原始任务："${parsedTask}"\n以下是收集到的网页文本，请整理成结构清晰的 Markdown 报告：\n\n${collectedData}`;
      const markdownData = await askText(summaryPrompt, storage.apiKey, activeAbortController.signal);
      saveMarkdownFile(markdownData, "Agent_Report.md");
    } else {
      sendLog("收集箱为空，无数据可生成报告。");
    }
  } catch (error) {
    if (isStopError(error)) {
      sendLog("任务已停止。");
      return;
    }
    sendLog(`发生错误: ${error.message}`);
  } finally {
    finishRun(runId);
  }
}

async function askVisionJson(apiKey, prompt, screenshotBase64, signal) {
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "glm-4.6v",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: screenshotBase64 } }
          ]
        }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errDetail = await response.text();
    throw new Error(`API 响应错误: ${response.status} - ${errDetail}`);
  }

  const result = await response.json();
  const content = result.choices[0].message.content;
  try {
    return parseModelJson(content);
  } catch (error) {
    sendLog("模型返回的 JSON 格式异常，正在自动修正后重试解析。");
    const fixedContent = await askText(
      `请把下面内容修正为严格 JSON。只返回 JSON，不要解释，不要 Markdown。\n\n${content}`,
      apiKey,
      signal
    );
    return parseModelJson(fixedContent);
  }
}

async function askText(prompt, apiKey, signal) {
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "glm-4.5-air",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3
    })
  });

  if (!response.ok) throw new Error("总结模型调用失败。");

  const result = await response.json();
  return result.choices[0].message.content;
}

async function askTextJson(prompt, apiKey, signal) {
  const content = await askText(prompt, apiKey, signal);
  return parseModelJson(content);
}

function parseModelJson(content) {
  const jsonText = extractJsonObjectText(content);
  if (!jsonText) throw new Error("模型未返回有效 JSON。");

  const attempts = [
    jsonText,
    repairLooseJson(jsonText),
    repairLooseJson(jsonText).replace(/,\s*([}\]])/g, "$1")
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  const preview = jsonText.replace(/\s+/g, " ").slice(0, 240);
  throw new Error(`模型返回的 JSON 格式仍无法解析: ${lastError.message}。片段: ${preview}`);
}

function extractJsonObjectText(content) {
  const text = String(content || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = text.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return text.slice(start);
}

function repairLooseJson(jsonText) {
  return String(jsonText)
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\uFF0C\s*(?="[^"]+"\s*:)/g, ",")
    .replace(/\uFF1A\s*(?=(?:"|\[|\{|-?\d|true|false|null))/g, ":")
    .replace(/(["\]\}0-9])\s*\n\s*(?="[^"]+"\s*:)/g, "$1,\n")
    .replace(/(["\]\}0-9])\s+(?="[^"]+"\s*:)/g, "$1, ")
    .replace(/,\s*([}\]])/g, "$1");
}

function enrichActionTarget(actionData, domInfo) {
  if (!actionData || !Array.isArray(domInfo)) return actionData;

  const targetId = Number(actionData.target_id);
  const target = Number.isFinite(targetId)
    ? domInfo.find((item) => Number(item.id) === targetId)
    : null;

  if (target) {
    actionData.selector = actionData.selector || target.selector;
    actionData.x = Number.isFinite(Number(actionData.x)) ? Number(actionData.x) : target.x;
    actionData.y = Number.isFinite(Number(actionData.y)) ? Number(actionData.y) : target.y;
    actionData.target_text = target.text || target.placeholder || target.ariaLabel || "";
    return actionData;
  }

  if (actionData.selector) {
    const bySelector = domInfo.find((item) => item.selector === actionData.selector);
    if (bySelector) {
      actionData.x = Number.isFinite(Number(actionData.x)) ? Number(actionData.x) : bySelector.x;
      actionData.y = Number.isFinite(Number(actionData.y)) ? Number(actionData.y) : bySelector.y;
      actionData.target_id = bySelector.id;
      actionData.target_text = bySelector.text || bySelector.placeholder || bySelector.ariaLabel || "";
    }
  }

  return actionData;
}

function formatActionLog(actionData) {
  const details = [];
  if (actionData.target_id !== undefined) details.push(`target_id=${actionData.target_id}`);
  if (actionData.selector) details.push(`selector=${actionData.selector}`);
  if (Number.isFinite(Number(actionData.x)) && Number.isFinite(Number(actionData.y))) {
    details.push(`x=${actionData.x}, y=${actionData.y}`);
  }
  if (actionData.target_text) details.push(`目标="${actionData.target_text}"`);
  if (actionData.text) details.push(`输入="${actionData.text}"`);
  return `动作: [${actionData.action}]${details.length ? " " + details.join("；") : ""}`;
}

async function detectAndPauseForBlocker(tabId) {
  const blocker = await sendTabMessage(tabId, { type: "DETECT_PAGE_BLOCKER" }).catch(() => ({ blocked: false }));
  if (!blocker || !blocker.blocked) return { blocked: false };

  const message = blocker.reason || "Agent 遇到需要用户处理的页面状态，已暂停。";
  await sendTabMessage(tabId, {
    type: "EXECUTE_ACTION",
    action: {
      action: "show_hitl",
      message
    }
  }).catch(() => {});
  sendLog(message);
  return { blocked: true, reason: message };
}

async function executePageAction(tabId, action) {
  const actionType = action.action || action.type;

  if (actionType === "click" && hasFinitePoint(action)) {
    try {
      await dispatchTrustedMouseClick(tabId, Number(action.x), Number(action.y));
      sendLog("已通过浏览器真实输入事件点击目标。");
      return;
    } catch (error) {
      sendLog(`真实点击失败，改用页面脚本点击: ${error.message}`);
    }
  }

  if (actionType === "press_enter") {
    try {
      await dispatchTrustedEnter(tabId);
      sendLog("已通过浏览器真实输入事件按下 Enter。");
      return;
    } catch (error) {
      sendLog(`真实 Enter 失败，改用页面脚本按键: ${error.message}`);
    }
  }

  if (actionType === "scroll") {
    try {
      await dispatchTrustedScroll(tabId, Number.isFinite(Number(action.y)) ? Number(action.y) : 700);
      sendLog("已通过浏览器真实输入事件滚动页面。");
      return;
    } catch (error) {
      sendLog(`真实滚动失败，改用页面脚本滚动: ${error.message}`);
    }
  }

  await sendTabMessage(tabId, { type: "EXECUTE_ACTION", action });
}

async function dispatchTrustedMouseClick(tabId, x, y) {
  await withDebugger(tabId, async () => {
    await sendDebuggerCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      clickCount: 0
    });
    await sleep(80);
    await sendDebuggerCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await sleep(80);
    await sendDebuggerCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
  });
}

async function dispatchTrustedEnter(tabId) {
  await withDebugger(tabId, async () => {
    await sendDebuggerCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await sendDebuggerCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
  });
}

async function dispatchTrustedScroll(tabId, deltaY) {
  await withDebugger(tabId, async () => {
    await sendDebuggerCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 400,
      y: 400,
      deltaX: 0,
      deltaY
    });
  });
}

async function withDebugger(tabId, task) {
  const target = { tabId };
  let attached = false;
  try {
    await attachDebugger(target);
    attached = true;
    await task();
  } finally {
    if (attached) {
      await detachDebugger(target).catch(() => {});
    }
  }
}

function attachDebugger(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function detachDebugger(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function sendDebuggerCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

function hasFinitePoint(action) {
  return Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y));
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

      chrome.scripting.executeScript(
        { target: { tabId }, files: ["content.js"] },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(retryResponse);
          });
        }
      );
    });
  });
}

function parseJsonObject(text, fallback) {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
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

function sendLog(msg) {
  console.log(msg);
  chrome.runtime.sendMessage({ type: "UPDATE_LOG", payload: msg }).catch(() => {});
  getActiveTab()
    .then((tab) => {
      if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: "UPDATE_LOG", payload: msg }).catch(() => {});
    })
    .catch(() => {});
}

function stopActiveRun(message, shouldLog) {
  currentRunId += 1;
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  if (shouldLog) sendLog(message);
}

function finishRun(runId) {
  if (runId === currentRunId) activeAbortController = null;
}

function isRunStopped(runId) {
  return runId !== currentRunId || !activeAbortController;
}

function throwIfStopped(runId) {
  if (isRunStopped(runId)) throw new Error("AGENT_STOPPED");
}

function isStopError(error) {
  return error && (error.message === "AGENT_STOPPED" || error.name === "AbortError");
}
