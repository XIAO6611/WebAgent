export async function askVLM(apiKey, systemPrompt, screenshotBase64) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  // 💡 MV3 续命黑科技：防止 Chrome 在等待超长响应时强行杀死后台线程
  const keepAlive = setInterval(() => chrome.storage.local.get('keepAlive'), 20000);

  try {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
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
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errDetail = await response.text();
      throw new Error(`HTTP ${response.status} - ${errDetail}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("模型未返回有效 JSON！请重试。");
    
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
        throw new Error("API 请求超时(120秒)。网络拥堵或图片过于复杂，模型处理失败。");
    }
    throw error;
  } finally {
    // 请求结束，一定要清除心跳定时器
    clearInterval(keepAlive);
  }
}

export async function askLLM(apiKey, summaryPrompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  // 💡 MV3 续命黑科技：文本大模型生成长文章极易超过 30 秒，必须持续心跳唤醒
  const keepAlive = setInterval(() => chrome.storage.local.get('keepAlive'), 20000);

  try {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "glm-4.5-air", 
        messages: [{ "role": "user", "content": summaryPrompt }],
        temperature: 0.3
      })
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error("总结模型调用失败");
    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error("生成文档超时(120秒)，请重试或缩短提取的文本量。");
    throw error;
  } finally {
    // 请求结束，一定要清除心跳定时器
    clearInterval(keepAlive);
  }
}