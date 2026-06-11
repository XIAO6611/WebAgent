let kbArray = [];

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["apiKey", "knowledgeBase", "resumeText"], (result) => {
    if (result.apiKey) document.getElementById("apiKey").value = result.apiKey;
    if (result.resumeText) document.getElementById("resumeText").value = result.resumeText;

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
  const apiKey = document.getElementById("apiKey").value.trim();
  const resumeText = document.getElementById("resumeText").value.trim();
  const finalJsonObj = buildKnowledgeObject();

  chrome.storage.local.set({
    apiKey,
    resumeText,
    knowledgeBase: JSON.stringify(finalJsonObj, null, 2)
  }, () => {
    kbArray = Object.keys(finalJsonObj).map((key) => ({ key, value: finalJsonObj[key] }));
    renderList(kbArray);
    setStatus("保存成功。");
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
