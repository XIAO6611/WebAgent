
export async function getKnowledgeBase() {
  const storage = await chrome.storage.local.get([
    'apiKey', 'apiBaseUrl', 'vlmModel', 'llmModel',
    'knowledgeBase', 'resumeText', 'developerMode'
  ]);
  let kbData = {};
  if (storage.knowledgeBase) {
    try {
      kbData = JSON.parse(storage.knowledgeBase);
    } catch(e) {
      console.error("知识库解析失败", e);
    }
  }
  return { 
    apiKey: storage.apiKey || "", 
    apiBaseUrl: storage.apiBaseUrl || "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    vlmModel: storage.vlmModel || "glm-4v-plus",
    llmModel: storage.llmModel || "glm-4-flash",
    kbData, 
    resumeText: storage.resumeText || "", 
    developerMode: !!storage.developerMode
  };
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

