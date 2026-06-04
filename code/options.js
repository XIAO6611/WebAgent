const FIELD_LABELS = {
  name: "姓名",
  gender: "性别",
  phone: "联系电话",
  email: "邮箱",
  school: "学校名称",
  major: "专业",
  education_level: "学历",
  graduation_year: "毕业年份",
  expected_position: "期望职业岗位",
  city: "期望城市",
  skills: "技能",
  experience_summary: "经历概述",
  project_summary: "项目概述"
};

let selectedImageDataUrl = "";

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["apiKey", "knowledgeBase", "resumeText"], (result) => {
    if (result.apiKey) document.getElementById("apiKey").value = result.apiKey;
    if (result.knowledgeBase) document.getElementById("knowledgeBase").value = result.knowledgeBase;
    if (result.resumeText) document.getElementById("resumeText").value = result.resumeText;
    renderKnowledgeRows(parseKnowledgeBase());
  });
});

document.getElementById("resumeFile").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    try {
      const parsed = JSON.parse(text);
      mergeKnowledge(parsed);
      setStatus("已导入 JSON 到知识库，请检查后保存");
      return;
    } catch (error) {
      alert("JSON 文件格式有误，已改为导入到简历正文。");
    }
  }

  document.getElementById("resumeText").value = text;
  setStatus("已导入简历文本");
});

document.getElementById("resumeImageFile").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  selectedImageDataUrl = await readFileAsDataUrl(file);
  setStatus("已选择简历截图，可点击“从截图提取到知识库”");
});

document.getElementById("extractTextBtn").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  const resumeText = document.getElementById("resumeText").value.trim();
  if (!apiKey) return alert("请先填写并保存或输入智谱 API Key。");
  if (!resumeText) return alert("请先粘贴或导入简历文本。");

  await runExtraction("extractTextBtn", "正在调用模型提取文本简历，请稍候...", {
    type: "EXTRACT_PROFILE_FROM_TEXT",
    payload: { apiKey, resumeText }
  });
});

document.getElementById("extractImageBtn").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) return alert("请先填写并保存或输入智谱 API Key。");
  if (!selectedImageDataUrl) return alert("请先选择一张简历截图或图片。");

  await runExtraction("extractImageBtn", "正在调用视觉模型提取图片简历，请稍候...", {
    type: "EXTRACT_PROFILE_FROM_IMAGE",
    payload: { apiKey, imageDataUrl: selectedImageDataUrl }
  });
});

document.getElementById("addRowBtn").addEventListener("click", () => {
  addKnowledgeRow("", "", "");
});

document.getElementById("syncJsonBtn").addEventListener("click", () => {
  syncTableToJson();
  setStatus("已同步到 JSON");
});

document.getElementById("saveBtn").addEventListener("click", () => {
  if (!persistCurrentSettings()) return;
  setStatus("保存成功");
});

document.getElementById("knowledgeBase").addEventListener("blur", () => {
  renderKnowledgeRows(parseKnowledgeBase());
});

async function runExtraction(buttonId, statusText, message) {
  const button = document.getElementById(buttonId);
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "提取中...";
  setStatus(statusText, { sticky: true });

  try {
    const response = await sendRuntimeMessage(message);
    handleExtractResponse(response);
  } catch (error) {
    setStatus("");
    alert(`提取失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function handleExtractResponse(response) {
  if (!response || !response.ok) {
    setStatus("");
    alert(`提取失败：${response && response.error ? response.error : "未知错误"}`);
    return;
  }

  const profile = response.profile || {};
  if (Object.keys(profile).length === 0) {
    setStatus("");
    alert("模型没有提取到有效字段。请确认简历文本不为空，或改用截图提取。");
    return;
  }

  mergeKnowledge(profile);
  persistCurrentSettings();
  setStatus(`已提取 ${Object.keys(profile).length} 个字段到知识库表格，请检查后保存`, { sticky: true });
}

function mergeKnowledge(profile) {
  const current = parseKnowledgeBase();
  const merged = { ...current, ...profile };
  renderKnowledgeRows(merged);
  document.getElementById("knowledgeBase").value = JSON.stringify(merged, null, 2);
}

function renderKnowledgeRows(data) {
  const tbody = document.getElementById("knowledgeRows");
  tbody.innerHTML = "";

  const entries = Object.entries(data || {}).filter(([key]) => key !== "autofillMemory");
  if (entries.length === 0) {
    ["name", "gender", "phone", "email", "school", "education_level", "expected_position"].forEach((key) => {
      addKnowledgeRow(key, FIELD_LABELS[key] || key, "");
    });
    return;
  }

  entries.forEach(([key, value]) => {
    addKnowledgeRow(key, FIELD_LABELS[key] || "", stringifyValue(value));
  });
}

function addKnowledgeRow(key, label, value) {
  const tbody = document.getElementById("knowledgeRows");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="kb-key" value="${escapeHtml(key)}" placeholder="expected_position"></td>
    <td><input class="kb-label" value="${escapeHtml(label)}" placeholder="期望职业岗位"></td>
    <td><textarea class="kb-value" rows="1" placeholder="内容">${escapeHtml(value)}</textarea></td>
    <td><button class="secondary kb-delete" type="button">删除</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelector(".kb-delete").addEventListener("click", () => tr.remove());
}

function syncTableToJson() {
  const existing = parseKnowledgeBase();
  const next = {};
  document.querySelectorAll("#knowledgeRows tr").forEach((tr) => {
    const key = tr.querySelector(".kb-key").value.trim();
    const value = tr.querySelector(".kb-value").value.trim();
    if (!key || !value) return;
    next[key] = value;
  });

  if (existing.autofillMemory) next.autofillMemory = existing.autofillMemory;
  document.getElementById("knowledgeBase").value = JSON.stringify(next, null, 2);
}

function persistCurrentSettings() {
  const key = document.getElementById("apiKey").value.trim();
  const resumeText = document.getElementById("resumeText").value.trim();
  syncTableToJson();

  const kb = document.getElementById("knowledgeBase").value.trim();
  if (kb) {
    try {
      const parsed = JSON.parse(kb);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("知识库必须是 JSON object");
      }
    } catch (error) {
      alert("知识库 JSON 格式错误，请检查。");
      return false;
    }
  }

  chrome.storage.local.set({ apiKey: key, knowledgeBase: kb, resumeText });
  return true;
}

function parseKnowledgeBase() {
  const text = document.getElementById("knowledgeBase").value.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function stringifyValue(value) {
  if (Array.isArray(value)) return value.join("、");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === undefined || value === null ? "" : String(value);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function setStatus(text, options = {}) {
  const status = document.getElementById("status");
  status.textContent = text;
  if (!text) return;
  if (options.sticky) return;
  setTimeout(() => {
    if (status.textContent === text) status.textContent = "";
  }, 3000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
