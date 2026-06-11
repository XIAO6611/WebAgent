export async function getKnowledgeBase() {
  const storage = await chrome.storage.local.get(['apiKey', 'knowledgeBase', 'resumeText']);
  let kbData = {};
  if (storage.knowledgeBase) {
    try {
      kbData = JSON.parse(storage.knowledgeBase);
    } catch(e) {
      console.error("知识库解析失败", e);
    }
  }
  return { apiKey: storage.apiKey, kbData, resumeText: storage.resumeText || "" };
}

export async function saveKnowledgeBase(kbData) {
  await chrome.storage.local.set({
    knowledgeBase: JSON.stringify(kbData || {}, null, 2)
  });
}

export async function mergeKnowledgeUpdates(updates) {
  const { kbData } = await getKnowledgeBase();
  updates.forEach((item) => {
    if (!item || !item.key || item.newValue === undefined || item.newValue === null) return;
    kbData[item.key] = String(item.newValue);
  });
  await saveKnowledgeBase(kbData);
  return kbData;
}
