// 页面加载时读取数据
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['apiKey', 'knowledgeBase'], (result) => {
    if (result.apiKey) document.getElementById('apiKey').value = result.apiKey;
    if (result.knowledgeBase) document.getElementById('knowledgeBase').value = result.knowledgeBase;
  });
});

// 保存数据
document.getElementById('saveBtn').addEventListener('click', () => {
  const key = document.getElementById('apiKey').value.trim();
  const kb = document.getElementById('knowledgeBase').value.trim();

  // 简单校验 JSON 格式
  if (kb) {
    try {
      JSON.parse(kb);
    } catch (e) {
      alert("知识库 JSON 格式错误，请检查！");
      return;
    }
  }

  chrome.storage.local.set({ apiKey: key, knowledgeBase: kb }, () => {
    const status = document.getElementById('status');
    status.textContent = '✅ 保存成功！';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});