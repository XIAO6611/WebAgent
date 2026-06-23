export function buildReActPrompt(parsedTask, kbData, currentPlan, collectedDataLength, simpleDomForLLM, stepCount, visitedUrls, forceRefill = false, trajectory = [], pageSemantics = {}, collectedCount = 0, totalTarget = 3) {
  const refillRule = forceRefill ?
    "13. 🪄【用户强制重新填表】：用户已点击\"重新填写\"！不要管表单是否填过，你必须立即输出 `\"action\": \"fill_form\"` 进行覆盖！" :
    "13. 🪄【自动填表技能】：当你进入一个需要填写的表单页面时，输出 `\"action\": \"fill_form\"`。**⚠️绝对警告：如果观察截图发现表单的大部分输入框已经有值，绝对不允许再次输出 `fill_form` 陷入死循环！你应该去 click 提交按钮，或者输出 `done`。**";

  const pageContext = `
【当前页面语义分析】
- 标题：${pageSemantics.title || '未知'}
- URL：${pageSemantics.url || '未知'}
- 主要标题：${(pageSemantics.headings || []).join(' | ') || '无'}
- 是否有列表？${pageSemantics.hasList ? '是（可能包含多个条目）' : '否'}
- 是否有详情？${pageSemantics.hasDetail ? '是（可能包含单个实体的详细描述）' : '否'}
- 交互元素：输入框 ${pageSemantics.stats?.inputs || 0} 个，按钮 ${pageSemantics.stats?.buttons || 0} 个，链接 ${pageSemantics.stats?.links || 0} 个
- 内容关键词：${(pageSemantics.matchedKeywords || []).join('、') || '无特定关键词'}
  `;

  const trajectoryText = trajectory.length > 0 ? trajectory.join('\n') : "暂无历史动作，这是第一步。";

  return `你是一个高级网页自动操作 Agent。当前是第 ${stepCount} 步。
  
  ${pageContext}
  
  【总任务】: "${parsedTask}"
  【本地知识库】: ${JSON.stringify(kbData)}
  【剩余计划表】: ${currentPlan}
  【已访问过的链接】: ${JSON.stringify(visitedUrls)}
  
  【任务进度】: 已收集 ${collectedCount}/${totalTarget} 个职位。
  
  🧠【短期记忆（你的历史操作轨迹）】:
  你必须反思过去的步骤！如果你发现你在重复执行同一个动作（死循环），你必须立刻改变策略（比如改用 click，或者向下 scroll，或者提取链接后 goto）。
  ${trajectoryText}
  
  当前收集箱已有字符数: ${collectedDataLength}。
  
  请观察截图，并严格参考以下【极简交互元素列表】(仅包含 id、类型、文本和 href，不包含坐标)：
  ${JSON.stringify(simpleDomForLLM, null, 2)}
  
  【执行逻辑（严格遵守）】：
  1. 🔍【最高优先级：定位搜索框】：在任何新页面，首先查找元素列表中类型为 \`input\` 或 \`textarea\` 的元素。搜索框通常是页面中最显眼的输入框，其 placeholder、text 或附近文字常包含"搜索"、"Search"、"请输入"、"查询"等关键词。即使 placeholder 不明显，你也必须优先选择第一个 \`input\` 元素（排除 type='hidden'、'submit'、'button'、'reset'、'file'）作为搜索框。只有在页面确实没有任何 \`input\` 元素时，才允许考虑点击导航链接。
  2. 💡【搜索框组合技】：在搜索框打字时，为了提高效率，可以在 JSON 中加上 \`"submit_after_type": true\` 瞬间提交。但填写包含多个字段的复杂表单时严禁使用此参数！
  3. 💡【精准搜索策略】：在搜索框输入时，直接结合最终目的构造复合关键词（如："腾讯 校招"）。
  4. 💡【找门策略（仅当绝对无输入框时）】：只有当页面确实没有任何 \`input\` 或 \`textarea\` 元素（例如企业官网首页），并且任务明确需要进入特定入口（如"岗位投递"）时，才允许点击导航链接。此时必须确认该链接的文本与任务直接相关，并优先选择显眼的"加入我们"、"招聘"、"校招"等字样。
  5. 💡【详情页下钻策略】：**⚠️只有当你已经成功执行了搜索，且页面展示了多个职位/商品的结果列表时**，才能触发此策略！此时绝不允许原地 extract，必须提取目标结果的 \`href\` 进入"详情页"后再 \`extract\`。**严禁在非搜索结果页（如首页）误用此策略！**
  6. ⚠️【防绝望幻觉】：如果你在截图里看到了想点的内容，但在列表中死活找不到对应的文字和 ID，绝对不允许盲猜以前的 ID！必须输出 \`scroll\` 动作翻页寻找。
  7. ⚠️【严禁脑补 ID】：绝不允许理所当然地认为"第一个结果就是 ID:0"！网页的 ID:0 通常是左上角的Logo！必须逐行仔细阅读列表找到实际对应的 ID。
  8. ⚠️【防撞墙机制】：动作未生效必须换策略！发现回车无效，立刻换用 click 点击搜索按钮。严禁连续 3 次 scroll，严禁连续 2 次原地 extract！
  9. ⚠️【去重逻辑】：绝不跳转或点击已经存在于【已访问过的链接】中的网址！
  10. 🛡️【安全与阻断策略（最高优先级）】：当你观察到屏幕被"扫码登录框"、"验证码"遮挡，或者你认为需要用户手动登录才能继续时，**绝对不允许输出 "action": "done" 来结束任务！** 你必须且只能输出 "action": "show_hitl" 来挂起任务，并在 message 字段中告诉用户需要扫码！
  11. 🪄【自动填表技能】：当你进入了一个明确包含大量输入框的"求职申请"、"注册"、"信息登记"等表单页面时，不要使用低效的 \`type\` 动作逐个输入！你必须且只能输出 \`"action": "fill_form"\`，底层引擎会瞬间接管。
  12. 📝【计划弹性原则】：\`remaining_plan\` 仅代表在当前页面状态下的**最优猜测**。如果页面实际反馈与预期不符（例如点击后未跳转、弹窗干扰、或进入意外页面），**你完全不需要死守旧计划**。请直接在 \`thought\` 中说明异常原因，并重新生成全新的 \`remaining_plan\`。**执行有效性 > 计划遵从性。**
  13. 📌【预期状态锚点】：在执行每个动作前，请在输出中增加 \`"expected_outcome"\` 字段，描述你期望该动作后页面发生什么变化（例如"页面将显示职位详情"）。这有助于你事后验证。
  ${refillRule}

  你必须且只能返回严格的 JSON 格式：
  {
    "thought": "一句话描述你看到了什么，评估上一轮动作是否生效，比对列表确认真实的 ID，以及下一步要做什么。同时，必须注明上一轮动作是否有效（有效/部分有效/无效）以及原因。",
    "remaining_plan": ["步骤A", "执行提交", "goto: 网址X"],
    "action": "click | type | press_enter | scroll | extract | back | goto | show_hitl | done",
    "element_id": 12, 
    "text": "要输入的文字(仅type动作需要)",
    "submit_after_type": true,
    "url": "要直接跳转的完整网址(仅goto动作需要)",
    "message": "给用户的警告提示语，例如'检测到登录墙，请主人扫码登录' (仅show_hitl动作需要)",
    "expected_outcome": "描述你预期该动作执行后页面会发生什么变化，例如'页面将跳转到岗位列表'"
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
    type: field.type,
    label: field.label,         
    placeholder: field.placeholder,
    options: field.options,     
    value: field.value // 让它看到当前是否已被选中
  }));

  return `你是一个专业的求职网站表单填写 Agent。

用户任务：${userTask}
用户资料：${JSON.stringify(profile, null, 2)}
字段列表：${JSON.stringify(fieldsForPrompt, null, 2)}

【最高优先级约束规则】：
1. **宁缺毋滥**：只填写能从资料中明确推断出的内容。绝不能瞎编！没有数据的字段必须留空，并写入 missing_fields。
2. **防错位机制**：仔细核对 label。如果字段是“父亲姓名”，绝不能填用户名字。如果 label 是“年龄”，绝不能填成手机号！
3. **选项与单选/复选框处理**：
   - 如果是下拉框 (select/custom_select) 且有 options，你填写的 \`value\` 必须绝对匹配 options 里的文字。
   - 如果是单选框 (radio) 或复选框 (checkbox)，请直接选中代表正确选项的那个 \`selector\`，并将其 \`value\` 严格设置为 "true"。
4. **⚠️原文绝对保留（防缩写）**：对于长文本字段（如项目经历、工作经验、自我评价、技能专长等），你必须**一字不差地完整复制**简历资料中的长文本！绝不允许擅自总结、精简或缩写！

只返回 JSON：
{
  "assignments": [
    {
      "selector": "对应的 selector",
      "value": "要填写的内容 (对于radio/checkbox请直接填入字符串 \\"true\\")",
      "reason": "简述匹配依据"
    }
  ],
  "missing_fields": ["缺失或资料不足无法填写的字段 label (如: 紧急联系人、照片)"],
  "warnings": ["风险提示 (如: 某个单选题没有完美的对应项，或者由于选项限制可能填得不准确)"]
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
