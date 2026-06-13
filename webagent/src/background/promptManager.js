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
  10. 🛡️【安全与阻断策略（最高优先级）】：当你观察到屏幕被“扫码登录框”、“验证码”遮挡，或者你认为需要用户手动登录才能继续时，**绝对不允许输出 "action": "done" 来结束任务！** 你必须且只能输出 "action": "show_hitl" 来挂起任务，并在 message 字段中告诉用户需要扫码！
  
  你必须且只能返回严格的 JSON 格式：
  {
    "thought": "一句话描述你看到了什么，评估上一轮动作是否生效，比对列表确认真实的 ID，以及下一步要做什么",
    "remaining_plan": ["步骤A", "执行提交", "goto: 网址X"],
    "action": "click | type | press_enter | scroll | extract | back | goto | show_hitl | done",
    "element_id": 12, 
    "text": "要输入的文字(仅type动作需要)",
    "submit_after_type": true,
    "url": "要直接跳转的完整网址(仅goto动作需要)",
    "message": "给用户的警告提示语，例如'检测到登录墙，请主人扫码登录' (仅show_hitl动作需要)"
  }`;
}

export function buildSummaryPrompt(parsedTask, collectedData) {
  return `你是一个顶级数据分析师。你的最终目标是根据用户的原始任务：“${parsedTask}”，从以下粗糙的网页抓取文本中提炼并结构化信息。
  
  【提取与排版规则（自适应适用）】：
  1. 如果任务是收集求职/租房/酒店/竞品等具有对比性质的信息：请强制输出 Markdown 表格，并自动提取合理的核心维度（如：公司、岗位、薪资、地点、核心要求等）。
  2. 如果任务是查阅教程、攻略、百科或新闻文章：请采用层级分明的 Markdown 列表与加粗标题进行精美排版，保留文章核心脉络和操作步骤。
  3. 如果发现收集的文本中含有无关的噪音（如版权声明、侧边栏残余文字等），请直接剔除，不要写进报告。
  4. 在内容的最后，请基于你收集到的信息，给用户提供一段简短的总结或建议（例如：哪个岗位最值得投，或者这篇教程的核心难点是什么）。

  【收集到的网页数据如下】：
  ${collectedData}`;
}

export function buildFormFillPrompt(userTask, formScan, profile) {
  const fieldsForPrompt = formScan.fields.map((field) => ({
    selector: field.selector,
    tag: field.tag,
    type: field.type,
    label: field.label,
    name: field.name,
    placeholder: field.placeholder,
    required: field.required,
    options: field.options,
    value: field.value
  }));

  return `你是一个求职网站表单填写 Agent。请根据用户任务、用户资料、页面截图和 DOM 字段列表，为当前网页表单生成安全的自动填写计划。

用户任务：
${userTask}

用户资料，包含简历文本、已确认个人信息和历史记忆：
${JSON.stringify(profile, null, 2)}

当前网页：
${formScan.title}
${formScan.url}

字段列表：
${JSON.stringify(fieldsForPrompt, null, 2)}

规则：
1. 只填写能从用户资料中明确推断出的内容，不要编造。
2. 不填写 password、验证码、短信码、一次性代码、文件上传字段。
3. 不点击提交、保存、下一步、申请等按钮；填完必须交给用户检查。
4. select/radio 字段只能填写 options 中存在或语义等价的选项。
5. 返回的 selector 必须来自字段列表。
6. 字段语义必须严格匹配：学校/院校/毕业院校只能填 school；期望岗位/职位/职业/应聘岗位只能填 expected_position 或明确的岗位名称。
7. 如果 expected_position 不存在，不要用 school、major、company 等字段替代，应放入 missing_fields。

只返回 JSON：
{
  "assignments": [
    {
      "selector": "字段列表中的 selector",
      "value": "要填写的内容",
      "reason": "为什么这样填"
    }
  ],
  "missing_fields": ["资料不足无法填写的字段"],
  "warnings": ["需要用户检查的风险点"]
}`;
}

export function buildProfileExtractionPrompt(existing, task) {
  return `${task}

已有知识库：
${JSON.stringify(existing, null, 2)}

请输出一个扁平 JSON object，字段名使用英文 snake_case，值使用中文或原文。优先提取：
name, gender, phone, email, school, major, education_level, graduation_year, expected_position, city, skills, experience_summary, project_summary。
如果信息不存在，不要编造；如果已有知识库中已有更明确内容，可以保留。
只返回 JSON object，不要 Markdown。`;
}

export function buildKnowledgeUpdatePrompt(knowledgeBase, payload) {
  return `你是个人资料知识库维护助手。请观察当前表单截图，并结合页面脚本采集到的字段值，比较已有知识库，找出用户手动修改、AI 填错后被用户修正、或值得新增到知识库的信息。

已有知识库：
${JSON.stringify(knowledgeBase, null, 2)}

当前表单采集值：
${JSON.stringify(payload || {}, null, 2)}

规则：
1. 只建议保存稳定的个人信息，例如姓名、性别、电话、邮箱、学校、学历、专业、期望岗位、城市、技能等。
2. 不要保存验证码、协议勾选、临时网页状态。
3. 如果表单值明显是填错的，例如“期望职业岗位”填成学校名，不要建议写入知识库，应在 reason 说明风险。
4. key 使用英文 snake_case。label 使用中文。

只返回 JSON：
{
  "proposals": [
    {
      "key": "expected_position",
      "label": "期望职业岗位",
      "currentValue": "原知识库中的值，没有则为空字符串",
      "newValue": "建议保存的新值",
      "action": "add | update",
      "reason": "为什么建议更新"
    }
  ]
}`;
}

export function buildFormReviewPrompt(formScan, profile) {
  const fieldsForPrompt = formScan.fields.map((field) => ({
    selector: field.selector,
    tag: field.tag,
    type: field.type,
    label: field.label,
    name: field.name,
    placeholder: field.placeholder,
    required: field.required,
    options: field.options,
    value: field.value
  }));

  return `你是一个独立的表单质检 Agent。你没有上一轮填表 Agent 的记忆，只能根据当前页面截图、当前表单字段值和用户知识库判断是否填写正确。

用户资料：
${JSON.stringify(profile, null, 2)}

当前网页：
${formScan.title}
${formScan.url}

当前表单字段和值：
${JSON.stringify(fieldsForPrompt, null, 2)}

检查规则：
1. 严格按字段语义检查，不能把学校、专业、公司名称填到期望职业岗位。
2. “期望职业岗位/期望职位/应聘岗位/目标岗位”只能使用 expected_position 或明确岗位名称。
3. 如果 expected_position 是“AI产品”“AI产品经理”“产品”等，不能把 school 的值用于该字段。
4. 学校/毕业院校只能使用 school；专业只能使用 major；邮箱只能使用 email；手机号只能使用 phone。
5. 只修正有明确证据的错误，不要补全资料不足的字段，不要点击提交。
6. 返回的 selector 必须来自字段列表。

只返回 JSON：
{
  "corrections": [
    {
      "selector": "字段列表中的 selector",
      "value": "修正后的值",
      "reason": "为什么当前值错误，以及为什么这样修正"
    }
  ],
  "warnings": ["仍需用户人工检查的问题"]
}`;
}
