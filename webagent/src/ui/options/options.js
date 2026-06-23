let kbArray = [];

// 预设默认字典
const defaultPresets = {
  preset_zhipu: { name: "智谱 AI (GLM-4v)", url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", vlm: "glm-4v-plus", llm: "glm-4-flash", key: "" },
  preset_qwen: { name: "阿里通义千问 (Qwen-VL)", url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", vlm: "qwen-vl-max", llm: "qwen-plus", key: "" },
  preset_openai: { name: "OpenAI 原生 (GPT-4o)", url: "https://api.openai.com/v1/chat/completions", vlm: "gpt-4o", llm: "gpt-4o-mini", key: "" },
  preset_siliconflow: { name: "硅基流动 (Qwen2-VL)", url: "https://api.siliconflow.cn/v1/chat/completions", vlm: "OpenGVLab/InternVL2-26B", llm: "Qwen/Qwen2.5-7B-Instruct", key: "" }
};

let allPresets = {};
let currentPresetId = "preset_zhipu";

function renderPresetDropdown() {
  const select = document.getElementById("apiPreset");
  select.innerHTML = "";
  for (const id in allPresets) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = allPresets[id].name;
    select.appendChild(opt);
  }
  const addOpt = document.createElement("option");
  addOpt.value = "__add_new__";
  addOpt.textContent = "➕ 添加其他模型配置...";
  addOpt.style.color = "#2563eb";
  select.appendChild(addOpt);
  
  select.value = currentPresetId;
}

function syncUIFromPreset(id) {
  const p = allPresets[id];
  if (!p) return;
  document.getElementById("apiBaseUrl").value = p.url || "";
  document.getElementById("apiKey").value = p.key || "";
  document.getElementById("vlmModel").value = p.vlm || "";
  document.getElementById("llmModel").value = p.llm || "";
}

function syncPresetFromUI() {
  if (!allPresets[currentPresetId]) return;
  allPresets[currentPresetId].url = document.getElementById("apiBaseUrl").value.trim();
  allPresets[currentPresetId].key = document.getElementById("apiKey").value.trim();
  allPresets[currentPresetId].vlm = document.getElementById("vlmModel").value.trim();
  allPresets[currentPresetId].llm = document.getElementById("llmModel").value.trim();
}

// ========== 合并后的 DOMContentLoaded ==========
document.addEventListener("DOMContentLoaded", () => {
  // 预设下拉框事件
  document.getElementById("apiPreset").addEventListener("change", (e) => {
    if (e.target.value === "__add_new__") {
      const name = prompt("请输入新配置的名称（例如：DeepSeek V3）：", "自定义模型配置");
      if (!name) {
        e.target.value = currentPresetId;
        return;
      }
      syncPresetFromUI();
      const newId = "custom_" + Date.now();
      allPresets[newId] = {
        name: name,
        url: "", key: "", vlm: "", llm: ""
      };
      currentPresetId = newId;
      renderPresetDropdown();
      syncUIFromPreset(currentPresetId);
      setStatus("已新建配置，请在下方填入对应参数并保存。");
      return;
    }
    
    syncPresetFromUI(); 
    currentPresetId = e.target.value;
    syncUIFromPreset(currentPresetId);
  });

  document.getElementById("deletePresetBtn").addEventListener("click", () => {
    if (defaultPresets[currentPresetId]) {
      alert("内置的默认配置无法被删除，但您可以清空里面的 API Key。");
      return;
    }
    if (confirm(`确定要删除 [${allPresets[currentPresetId].name}] 吗？`)) {
      delete allPresets[currentPresetId];
      currentPresetId = "preset_zhipu";
      renderPresetDropdown();
      syncUIFromPreset(currentPresetId);
      setStatus("已删除配置，请点击底部【保存全部设置】生效。");
    }
  });

  // 加载存储数据
  chrome.storage.local.get(null, (result) => {
    allPresets = JSON.parse(JSON.stringify(defaultPresets));

    if (result.savedPresets) {
      for(let id in result.savedPresets) {
          allPresets[id] = result.savedPresets[id];
      }
    } else if (result.apiKey) {
      allPresets["preset_zhipu"].key = result.apiKey;
      if (result.apiBaseUrl) allPresets["preset_zhipu"].url = result.apiBaseUrl;
      if (result.vlmModel) allPresets["preset_zhipu"].vlm = result.vlmModel;
      if (result.llmModel) allPresets["preset_zhipu"].llm = result.llmModel;
    }

    currentPresetId = result.activePresetId || "preset_zhipu";
    if (!allPresets[currentPresetId]) currentPresetId = "preset_zhipu";

    renderPresetDropdown();
    syncUIFromPreset(currentPresetId);

    if (result.resumeText) document.getElementById("resumeText").value = result.resumeText;
    if (result.developerMode) document.getElementById("developerMode").checked = true;
    
    if (result.knowledgeBase) {
      try {
        const rawJson = JSON.parse(result.knowledgeBase);
        kbArray = Object.keys(rawJson).map((key) => ({ key, value: rawJson[key] }));
      } catch (error) {
        setStatus("知识库 JSON 解析失败，请检查数据。", true);
      }
    }
    if (kbArray.length === 0) kbArray = [{ key: "", value: "" }];
    renderList(kbArray);
  });
});

// 其余事件监听器保持不变（resumeFile, resumeImage, extractTextBtn, extractImageBtn, addBtn, searchInput, sortBtn, saveBtn）
// 请确保这些监听器仍在，若已存在则无需重复添加。

// ========== 以下函数保持不变 ==========
document.getElementById("resumeFile").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  document.getElementById("resumeFileName").textContent = file.name;
  document.getElementById("resumeText").value = await file.text();
  setStatus("已读取简历文本文件。");
});

document.getElementById("resumeImage").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  document.getElementById("resumeImageName").textContent = file ? file.name : "未选择图片";
  if (file) setStatus("图片已选择，请点击“从图片解析知识库”。");
});

document.getElementById("extractTextBtn").addEventListener("click", () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  const resumeText = document.getElementById("resumeText").value.trim();
  if (!resumeText) return setStatus("请先填写或上传简历文本。", true);

  showLoading("解析中", "正在从简历文本中提取知识库字段...");
  chrome.runtime.sendMessage({
    type: "EXTRACT_PROFILE_FROM_TEXT",
    payload: { apiKey, resumeText }
  }, (response) => {
    hideLoading();
    handleProfileResponse(response);
  });
});

document.getElementById("extractImageBtn").addEventListener("click", () => {
  const file = document.getElementById("resumeImage").files[0];
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!file) return setStatus("请先选择简历图片。", true);

  showLoading("解析中", "图片已成功上传，正在提取简历信息...");
  const reader = new FileReader();
  reader.onload = () => {
    chrome.runtime.sendMessage({
      type: "EXTRACT_PROFILE_FROM_IMAGE",
      payload: { apiKey, imageDataUrl: reader.result }
    }, (response) => {
      hideLoading();
      handleProfileResponse(response);
    });
  };
  reader.onerror = () => {
    hideLoading();
    setStatus("图片读取失败，请重新选择图片。", true);
  };
  reader.readAsDataURL(file);
});

document.getElementById("addBtn").addEventListener("click", () => {
  kbArray.unshift({ key: "", value: "" });
  document.getElementById("searchInput").value = "";
  renderList(kbArray);
});

document.getElementById("searchInput").addEventListener("input", (event) => {
  const keyword = event.target.value.toLowerCase();
  const filtered = kbArray.filter((item) =>
    String(item.key).toLowerCase().includes(keyword) ||
    String(item.value).toLowerCase().includes(keyword)
  );
  renderList(filtered);
});

document.getElementById("sortBtn").addEventListener("click", () => {
  kbArray.sort((a, b) => a.key.localeCompare(b.key, "zh-CN"));
  document.getElementById("searchInput").value = "";
  renderList(kbArray);
});

document.getElementById("saveBtn").addEventListener("click", () => {
  syncPresetFromUI();

  const resumeText = document.getElementById("resumeText").value.trim();
  const developerMode = document.getElementById("developerMode").checked;
  const finalJsonObj = buildKnowledgeObject();

  chrome.storage.local.set({
    savedPresets: allPresets,
    activePresetId: currentPresetId,
    apiKey: allPresets[currentPresetId].key,
    apiBaseUrl: allPresets[currentPresetId].url,
    vlmModel: allPresets[currentPresetId].vlm,
    llmModel: allPresets[currentPresetId].llm,
    resumeText,
    developerMode,
    knowledgeBase: JSON.stringify(finalJsonObj, null, 2)
  }, () => {
    kbArray = Object.keys(finalJsonObj).map((key) => ({ key, value: finalJsonObj[key] }));
    renderList(kbArray);
    setStatus("保存成功！API 与知识库均已同步。");
  });
});

function renderList(listToRender) {
  const container = document.getElementById("kbList");
  container.innerHTML = "";

  if (listToRender.length === 0) {
    container.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:20px;">当前没有匹配字段。</div>';
    return;
  }

  listToRender.forEach((item) => {
    const row = document.createElement("div");
    row.className = "kv-row";
    const realIndex = kbArray.findIndex((realItem) => realItem === item);

    row.innerHTML = `
      <input type="text" placeholder="字段名，例如 name" value="${escapeHtml(item.key)}" data-index="${realIndex}" class="input-key">
      <input type="text" placeholder="字段内容，例如 张三" value="${escapeHtml(item.value)}" data-index="${realIndex}" class="input-value">
      <button class="btn btn-danger delete-btn" data-index="${realIndex}">删除</button>
    `;
    container.appendChild(row);
  });

  document.querySelectorAll(".input-key").forEach((input) => {
    input.addEventListener("input", (event) => {
      kbArray[event.target.dataset.index].key = event.target.value;
    });
  });
  document.querySelectorAll(".input-value").forEach((input) => {
    input.addEventListener("input", (event) => {
      kbArray[event.target.dataset.index].value = event.target.value;
    });
  });
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      kbArray.splice(Number(event.target.dataset.index), 1);
      renderList(kbArray);
    });
  });
}

function handleProfileResponse(response) {
  if (!response || !response.ok) {
    return setStatus(response && response.error ? response.error : "解析失败。", true);
  }

  mergeProfileIntoList(response.profile || {});
  document.getElementById("searchInput").value = "";
  renderList(kbArray);
  setStatus("解析完成，已合并到知识库列表。请确认后保存。");
}

function mergeProfileIntoList(profile) {
  Object.entries(profile).forEach(([key, value]) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    const existing = kbArray.find((item) => item.key === key);
    if (existing) existing.value = String(value);
    else kbArray.push({ key, value: String(value) });
  });
}

function buildKnowledgeObject() {
  const finalJsonObj = {};
  kbArray.forEach((item) => {
    const key = String(item.key || "").trim();
    const value = String(item.value || "").trim();
    if (key) finalJsonObj[key] = value;
  });
  return finalJsonObj;
}

function showLoading(title, desc) {
  document.getElementById("loadingTitle").textContent = title;
  document.getElementById("loadingDesc").textContent = desc;
  document.getElementById("loadingMask").classList.add("active");
}

function hideLoading() {
  document.getElementById("loadingMask").classList.remove("active");
}

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#dc2626" : "#059669";
  if (!isError) setTimeout(() => { status.textContent = ""; }, 2600);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}