// 封装对 chrome.storage 的异步读取
export async function getKnowledgeBase() {
  const storage = await chrome.storage.local.get(['apiKey', 'knowledgeBase']);
  let kbData = {};
  if (storage.knowledgeBase) {
    try {
      kbData = JSON.parse(storage.knowledgeBase);
    } catch(e) {
      console.error("知识库解析失败", e);
    }
  }
  return { apiKey: storage.apiKey, kbData };
}