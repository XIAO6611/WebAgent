# 多模态 Web Agent 插件

`webagent/` 是当前可加载到 Chrome 的插件目录。插件基于 Manifest V3，后台使用 module service worker，页面侧通过 content scripts 完成 DOM 感知、动作执行、表单扫描和弹窗注入。

## 功能概览

- 普通 Agent 模式：执行搜索、浏览、点击、输入、滚动、提取网页文本等任务。
- 表单填写模式：自动识别求职/申请/简历/表单相关任务，读取个人知识库和简历信息，填写当前页面表单。
- 简历导入：在 options 页面支持直接粘贴文本、上传 `.md/.txt` 文件、上传图片解析。
- 知识库维护：支持手动编辑字段，也支持从当前表单中生成更新建议。
- 安全暂停：遇到登录、验证码、安全验证或需要用户确认的弹窗时进入人工接管状态。

## 模块结构

```text
webagent/
├── manifest.json
└── src/
    ├── background/
    │   ├── index.js            # 后台消息入口
    │   ├── agentController.js  # Agent 主循环、填表流程、知识库更新流程
    │   └── promptManager.js    # ReAct、填表、简历解析、知识库更新提示词
    ├── content/
    │   ├── index.js            # content script 消息分发
    │   ├── domScanner.js       # 交互元素扫描、表单字段扫描、阻断检测
    │   ├── actionExecutor.js   # 点击、输入、滚动、字段填充
    │   └── uiInjector.js       # 人工接管、填表检查、知识库更新弹窗
    ├── services/
    │   ├── llmClient.js        # 智谱 API 调用和 JSON 解析
    │   └── memoryService.js    # chrome.storage.local 读写
    ├── ui/
    │   ├── popup/              # 任务输入、日志、知识库更新入口
    │   └── options/            # API Key、简历、知识库配置
    └── utils/
        ├── logger.js
        └── templateEngine.js
```

## 本地加载插件

> 开发和验收时请使用“加载未打包的扩展程序”。“打包扩展程序”只是生成发布用的 `.crx` 包和 `.pem` 私钥，生成后不会自动出现在扩展列表里。

1. 打开 Chrome。
2. 地址栏输入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `D:\cursor\WebAgent\webagent`。
6. 浏览器工具栏出现 “多模态 Web Agent” 后，即加载成功。

如果修改了 `manifest.json`、`src/background/*` 或 content script，请在 `chrome://extensions/` 中点击插件卡片上的刷新按钮，然后刷新测试网页。

## 配置和检验流程

1. 点击插件图标，打开 popup。
2. 点击“配置 API、知识库和简历”。
3. 在 options 页面填写智谱 API Key。
4. 导入简历：
   - 直接粘贴简历文本；或
   - 上传 `.md/.txt` 文件；或
   - 上传简历图片。
5. 点击“从文本解析知识库”或“从图片解析知识库”。
6. 检查下方知识库字段，必要时手动修改。
7. 点击“保存全部设置”。
8. 打开一个真实网页执行测试。

### 普通 Agent 测试

打开搜索、新闻、招聘等普通网页，在 popup 输入类似：

```text
帮我搜索并整理某公司的校招岗位信息
```

点击“开始”，观察日志和页面操作。若任务中产生提取内容，插件会尝试下载 `Agent_Report.md`。

### 表单填写测试

打开一个包含姓名、手机号、邮箱、学校、专业、学历、期望岗位等字段的表单页，在 popup 输入：

```text
根据我的简历帮我填写当前求职表单
```

预期结果：

- Agent 自动进入表单填写模式。
- 插件扫描当前页面表单字段。
- 根据知识库和简历信息填写可确定字段。
- 不会点击提交按钮。
- 页面弹出“填表已暂停”提示，要求用户检查后手动提交。

### 知识库更新测试

1. 表单自动填写后，手动修改或补充某个字段。
2. 打开 popup，点击“更新知识库（当前表单）”。
3. 插件会采集当前表单值并生成更新建议。
4. 在页面弹窗中勾选需要保存的字段。
5. 点击“保存勾选项”。
6. 回到 options 页面检查知识库是否更新。

## 常见问题

- 插件没反应：确认当前页面不是 `chrome://`、`edge://`、扩展页或浏览器系统页。
- API 调用失败：检查 API Key 是否保存、网络是否可访问 `open.bigmodel.cn`。
- 修改代码后仍是旧行为：在 `chrome://extensions/` 点击刷新插件，并刷新目标网页。
- 表单没有被填写：确认页面中存在可见的 `input`、`textarea` 或 `select`，并确认知识库有对应字段。
- 遇到登录或验证码：这是预期行为，Agent 会暂停并等待人工处理。
