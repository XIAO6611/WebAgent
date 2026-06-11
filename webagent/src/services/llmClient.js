export async function askVLM(apiKey, systemPrompt, screenshotBase64, externalSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const signal = externalSignal || controller.signal;

  // 💡 MV3 续命黑科技：防止 Chrome 在等待超长响应时强行杀死后台线程
  const keepAlive = setInterval(() => chrome.storage.local.get('keepAlive'), 20000);

  try {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal,
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
    return parseModelJson(content);
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

export async function askLLM(apiKey, summaryPrompt, externalSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const signal = externalSignal || controller.signal;

  // 💡 MV3 续命黑科技：文本大模型生成长文章极易超过 30 秒，必须持续心跳唤醒
  const keepAlive = setInterval(() => chrome.storage.local.get('keepAlive'), 20000);

  try {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal,
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

export async function askTextJson(apiKey, prompt, signal) {
  const content = await askLLM(apiKey, prompt, signal);
  return parseModelJson(content);
}

export function parseModelJson(content) {
  const jsonText = extractJsonObjectText(content);
  if (!jsonText) throw new Error("模型未返回有效 JSON。");

  const attempts = [
    jsonText,
    repairLooseJson(jsonText),
    repairLooseJson(jsonText).replace(/,\s*([}\]])/g, "$1")
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  const preview = jsonText.replace(/\s+/g, " ").slice(0, 240);
  throw new Error(`模型返回的 JSON 格式仍无法解析: ${lastError.message}。片段: ${preview}`);
}

function extractJsonObjectText(content) {
  const text = String(content || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = text.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
}

function repairLooseJson(jsonText) {
  return String(jsonText)
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\uFF0C\s*(?="[^"]+"\s*:)/g, ",")
    .replace(/\uFF1A\s*(?=(?:"|\[|\{|-?\d|true|false|null))/g, ":")
    .replace(/(["\]\}0-9])\s*\n\s*(?="[^"]+"\s*:)/g, "$1,\n")
    .replace(/(["\]\}0-9])\s+(?="[^"]+"\s*:)/g, "$1, ")
    .replace(/,\s*([}\]])/g, "$1");
}
