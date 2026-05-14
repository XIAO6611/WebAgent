export async function askVLM(apiKey, systemPrompt, screenshotBase64) {
  // 🚨 核心报警器：如果 35 秒内没回包，强制切断并报错
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 80000);

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
        throw new Error("API 请求超时(80秒)。原因是页面太长/太复杂，模型处理失败。");
    }
    throw error;
  }
}

export async function askLLM(apiKey, summaryPrompt) {
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "glm-4.5-air", 
      messages: [{ "role": "user", "content": summaryPrompt }],
      temperature: 0.3
    })
  });
  if (!response.ok) throw new Error("总结模型调用失败");
  const result = await response.json();
  return result.choices[0].message.content;
}