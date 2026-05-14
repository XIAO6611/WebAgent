// 核心逻辑：将任务指令中的 {{key}} 替换为真实知识库数据
export function injectPlaceholders(task, kbData) {
  let parsedTask = task;
  try {
    for (const key in kbData) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      parsedTask = parsedTask.replace(regex, kbData[key]);
    }
  } catch(e) {
    console.warn("⚠️ 知识库 JSON 格式有误，跳过符号替换。");
  }
  return parsedTask;
}