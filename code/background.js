// 全局变量：信息收集箱
let collectedData = "";

// 监听来自 popup 的启动指令
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AGENT") {
    collectedData = ""; 
    sendResponse({ status: "后台中枢已接管，正在解析指令..." }); 
    runAgentLoop(message.payload);
  }
  return true; 
});

// 辅助函数：休眠等待
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 核心循环机制
async function runAgentLoop(userTask) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    
    if (!activeTab || activeTab.url.startsWith("chrome://")) {
      throw new Error("安全限制：无法在系统页面执行。请打开一个真实的网页。");
    }

    const storage = await chrome.storage.local.get(['apiKey', 'knowledgeBase']);
    if (!storage.apiKey) throw new Error("未配置 API Key！请去选项页配置。");

    // ==========================================
    // 💡 知识库占位符自动替换
    // ==========================================
    let parsedTask = userTask;
    let kbData = {};
    if (storage.knowledgeBase) {
      try {
        kbData = JSON.parse(storage.knowledgeBase);
        // 遍历 JSON，把所有的 {{key}} 替换成真实的值
        for (const key in kbData) {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          parsedTask = parsedTask.replace(regex, kbData[key]);
        }
      } catch(e) {
        sendLog("⚠️ 知识库 JSON 格式有误，跳过符号替换。");
      }
    }
    sendLog(`🎯 最终执行指令: "${parsedTask}"`);

    // ==========================================
    // 第一阶段：VLM 视觉 ReAct 循环
    // ==========================================
    let isTaskComplete = false;
    let stepCount = 0;
    const MAX_STEPS = 12; // 给复杂任务多留两步
    let currentPlan = "['分析页面布局并制定初步计划']"; // 初始计划表

    sendLog("🤖 启动 VLM 视觉感知循环...");

    while (!isTaskComplete && stepCount < MAX_STEPS) {
      stepCount++;
      sendLog(`\n🔄 [第 ${stepCount} 轮] 正在观察当前屏幕...`);

      const screenshotBase64 = await chrome.tabs.captureVisibleTab(activeTab.windowId);
      
      const domInfo = await new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id, { type: "GET_DOM_INFO" }, (response) => {
            if (chrome.runtime.lastError) resolve([]);
            else resolve(response || []);
        });
      });

      // 组装 ReAct Prompt
      const systemPrompt = `你是一个高级网页自动操作 Agent。当前是第 ${stepCount} 步。
      
      【你的总任务】: "${parsedTask}"
      【你的知识库】: ${JSON.stringify(kbData)}
      【上一轮剩余计划】: ${currentPlan}
      当前收集箱已有字符数: ${collectedData.length}。
      
      请观察截图和交互元素列表 ${JSON.stringify(domInfo)}。
      
      执行逻辑：
      1. 核对【上一轮剩余计划】。如果计划中的某一步在截图中已完成，请将其划掉。
      2. 如果【剩余计划】为空，或你认为任务已彻底完成，必须输出 action: "done"。
      3. 如果需要输入内容，优先使用【你的知识库】中的数据。
      
      你必须且只能返回 JSON 格式：
      {
        "thought": "一句话描述你看到了什么，以及为什么做下一步",
        "remaining_plan": ["步骤A", "步骤B"],
        "action": "click | type | press_enter | scroll | extract | done",
        "x": 100,
        "y": 200,
        "text": "要输入的文字(仅type动作需要)"
      }`;

      sendLog("📡 呼叫视觉大脑 (glm-4.6v) 思考中...");
      
      const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${storage.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "glm-4.6v",
          messages: [
            {
              "role": "user",
              "content": [
                { "type": "text", "text": systemPrompt },
                { "type": "image_url", "image_url": { "url": screenshotBase64 } }
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
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("模型未返回有效 JSON！");
      const actionData = JSON.parse(jsonMatch[0]);

      // 同步更新计划表
      currentPlan = JSON.stringify(actionData.remaining_plan || []);

      sendLog(`🤔 思考: ${actionData.thought}`);
      sendLog(`📋 剩余计划: ${currentPlan}`);
      sendLog(`🕹️ 动作: [${actionData.action}] ${actionData.text ? '-> ' + actionData.text : ''}`);

      // 执行动作分支
      if (actionData.action === "done") {
        isTaskComplete = true;
        sendLog("✅ Agent 检查计划表已空，判定任务闭环！");
        break;
      } 
      else if (actionData.action === "extract") {
        sendLog("📥 正在提取本页文字...");
        const pageText = await new Promise(resolve => {
          chrome.tabs.sendMessage(activeTab.id, { type: "GET_TEXT_CONTENT" }, r => resolve(r));
        });
        collectedData += `\n\n--- 第 ${stepCount} 步提取 ---\n` + pageText;
        await sleep(1000); 
      } 
      else if (["scroll", "click", "type", "press_enter"].includes(actionData.action)) {
        chrome.tabs.sendMessage(activeTab.id, { type: "EXECUTE_ACTION", action: actionData });
        sendLog(`⚙️ 正在执行物理操作，等待网页响应...`);
        await sleep(3500); // 留足 3.5 秒等待网页加载/跳转
      }
    }

    if (stepCount >= MAX_STEPS) {
      sendLog("⚠️ 达到最大步数限制，为防止死循环已强制停止。");
    }

    // ==========================================
    // 第二阶段：LLM 文档总结与文件生成
    // ==========================================
    if (collectedData.length > 0) {
      sendLog("📝 正在呼叫文本大脑 (glm-4.5-air) 生成 Markdown 报告...");
      const summaryPrompt = `原始任务：“${parsedTask}”。\n以下是收集到的网页文本，请剔除广告，整理成一份排版精美、结构清晰的 Markdown 报告：\n\n${collectedData}`;

      const summaryRes = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${storage.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "glm-4.5-air", 
          messages: [{ "role": "user", "content": summaryPrompt }],
          temperature: 0.3
        })
      });

      if (!summaryRes.ok) throw new Error("总结模型调用失败");

      const summaryResult = await summaryRes.json();
      const markdownData = summaryResult.choices[0].message.content;

      sendLog("💾 导出文件中...");
      saveMarkdownFile(markdownData, "Agent_Report.md");
    } else {
      sendLog("⚠️ 收集箱为空，无数据可生成报告。");
    }

  } catch (error) {
    sendLog(`❌ 发生错误: ${error.message}`);
  }
}

// 辅助导出函数
function saveMarkdownFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const reader = new FileReader();
  reader.readAsDataURL(blob);
  reader.onloadend = function() {
    chrome.downloads.download({
      url: reader.result,
      filename: filename,
      saveAs: true 
    });
  };
}

// 日志推送函数
function sendLog(msg) {
  console.log(msg);
  chrome.runtime.sendMessage({ type: "UPDATE_LOG", payload: msg }).catch(() => {});
}