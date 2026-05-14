export function buildReActPrompt(parsedTask, kbData, currentPlan, collectedDataLength, simpleDomForLLM, stepCount, visitedUrls) {
  return `你是一个高级网页自动操作 Agent。当前是第 ${stepCount} 步。
  
  【总任务】: "${parsedTask}"
  【本地知识库】: ${JSON.stringify(kbData)}
  【剩余计划表】: ${currentPlan}
  【已访问过的链接】: ${JSON.stringify(visitedUrls)}
  当前收集箱已有字符数: ${collectedDataLength}。
  
  请观察截图，并严格参考以下【极简交互元素列表】(仅包含 id、类型、文本和 href，不包含坐标)：
  ${JSON.stringify(simpleDomForLLM, null, 2)}
  
  执行逻辑（严格遵守）：
  1. 划掉【剩余计划表】中已完成的步骤。
  2. 💡【搜索框组合技】：在搜索框打字时，为了提高效率，可以在 JSON 中加上 \`"submit_after_type": true\` 瞬间提交。但填写包含多个字段的复杂表单时严禁使用此参数！
  3. 💡【精准搜索策略】：在搜索框输入时，直接结合最终目的构造复合关键词（如：“腾讯 校招”）。
  4. 💡【找门策略】：**当你处于官网首页（还没有进行搜索时）**，若无明显大搜索框，你的唯一目标是去 \`click\` 顶部导航栏的核心入口（如文本完全等于“岗位投递”的元素）。**⚠️严禁在这一步过度发散或被底部/外部的其他长链接分心！**
  5. 💡【详情页下钻策略】：**⚠️只有当你已经成功执行了搜索，且页面展示了多个职位/商品的结果列表时**，才能触发此策略！此时绝不允许原地 extract，必须提取目标结果的 \`href\` 进入“详情页”后再 \`extract\`。**严禁在非搜索结果页（如首页）误用此策略！**
  6. ⚠️【防绝望幻觉】：如果你在截图里看到了想点的内容，但在列表中死活找不到对应的文字和 ID，绝对不允许盲猜以前的 ID！必须输出 \`scroll\` 动作翻页寻找。
  7. ⚠️【严禁脑补 ID】：绝不允许理所当然地认为“第一个结果就是 ID:0”！网页的 ID:0 通常是左上角的Logo！必须逐行仔细阅读列表找到实际对应的 ID。
  8. ⚠️【防撞墙机制】：动作未生效必须换策略！发现回车无效，立刻换用 click 点击搜索按钮。严禁连续 3 次 scroll，严禁连续 2 次原地 extract！
  9. ⚠️【去重逻辑】：绝不跳转或点击已经存在于【已访问过的链接】中的网址！
  
  你必须且只能返回严格的 JSON 格式：
  {
    "thought": "一句话描述你看到了什么，评估上一轮动作是否生效，比对列表确认真实的 ID，以及下一步要做什么",
    "remaining_plan": ["步骤A", "执行提交", "goto: 网址X"],
    "action": "click | type | press_enter | scroll | extract | back | goto | done",
    "element_id": 12, 
    "text": "要输入的文字(仅type动作需要)",
    "submit_after_type": true,
    "url": "要直接跳转的完整网址(仅goto动作需要)"
  }`;
}

export function buildSummaryPrompt(parsedTask, collectedData) {
  return `原始任务：“${parsedTask}”。\n以下是收集到的网页文本，请整理成一份排版精美、结构清晰的 Markdown 报告：\n\n${collectedData}`;
}