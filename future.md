Agent 目前已经跑通了核心的“感知-规划-执行”闭环，
但目前的雏形代码（把所有的网络请求、Prompt 组装、状态机都塞在一个 `background.js` 里）属于 **“上帝对象 (God Object)”** 的写法。

**后续工程化**须对系统进行**解耦和模块化拆分**。

建议按照 **“关注点分离 (Separation of Concerns)”** 的原则，将架构拆分为以下 **4 个核心层级** 和标准的工程目录结构：

---

### 📂 1. 现代化的工程目录结构设计

摒弃直接写原生 JS 的方式，引入构建工具（如 Webpack 或 Vite），将代码按功能划分目录：

```text
Web-Agent-Extension/
├── src/
│   ├── background/             # 【大脑中枢层】 (原 background.js)
│   │   ├── index.js            # Service Worker 入口，负责消息路由
│   │   ├── agentController.js  # Agent 状态机循环控制 (while 循环逻辑)
│   │   └── promptManager.js    # 专门负责组装系统提示词 (Prompt 工程化)
│   │
│   ├── content/                # 【感知与执行层】 (原 content.js)
│   │   ├── index.js            # 注入网页的入口
│   │   ├── domScanner.js       # 负责提取交互元素 (坐标、类型、文本)
│   │   ├── actionExecutor.js   # 负责执行物理动作 (click, type, scroll)
│   │   └── uiInjector.js       # 负责渲染 HITL 人机协同弹窗等 UI
│   │
│   ├── services/               # 【外部服务层】
│   │   ├── llmClient.js        # 封装智谱/阿里云 API 的 Fetch 请求
│   │   └── memoryService.js    # 封装 IndexedDB / chrome.storage 读写逻辑
│   │
│   ├── ui/                     # 【前端界面层】 (原 popup/options)
│   │   ├── popup/              # 用户指令输入面板 (可引入 React/Vue)
│   │   └── options/            # 知识库与 API Key 配置页 (可引入 React/Vue)
│   │
│   └── utils/                  # 【工具库】
│       ├── logger.js           # 统一的日志分发系统
│       └── templateEngine.js   # {{占位符}} 替换逻辑引擎
│
├── package.json                # 依赖管理
├── vite.config.js              # 构建配置 (推荐用 Vite)
└── manifest.json               # Chrome 插件配置
```

---

### 🧩 2. 核心模块的职责拆分说明

拆分后，每个模块只干一件事，互不干扰：

#### 第一层：Services 层 (基础设施)
* **`llmClient.js`**：把 `fetch` 请求抽离出来。无论你以后想换智谱、通义千问还是 OpenAI 的模型，只需要在这里修改接口地址和鉴权方式。它对外只提供 `async function askVLM(image, prompt)` 和 `async function askLLM(prompt)` 两个干净的接口。
* **`memoryService.js`**：负责知识库的增删改查。提供 `getKnowledgeBase()`，甚至以后可以引入向量数据库（Vector DB）进行复杂的 RAG 检索。

#### 第二层：Prompt 层 (提示词工程)
* **`promptManager.js`**：大模型的表现好坏全靠 Prompt。把冗长的字符串从业务逻辑里抽出来，变成模板。比如暴露出 `buildReActPrompt(task, plan, domInfo)` 函数。这样你在调优 Prompt 时，绝对不会改坏业务逻辑。

#### 第三层：Controller 层 (状态机与编排)
* **`agentController.js`**：这才是真正的“大脑调度员”。它不直接发网络请求，也不直接去点击页面。它只负责执行类似这样的高层逻辑：
  ```javascript
  const dom = await scanner.scan();
  const prompt = promptManager.build(dom, memory);
  const decision = await llmClient.askVLM(screenshot, prompt);
  await executor.run(decision.action);
  ```

#### 第四层：Content Script 层 (前端探针)
* **`actionExecutor.js`**：只负责将后端的指令转化为真实的 DOM 事件。
* **`uiInjector.js`**：只负责在宿主网页上画 UI（比如把 HITL 弹窗做成一个漂亮的 React 组件，挂载到 Shadow DOM 里，防止被原网页的 CSS 污染）。

---

### 🛠️ 3. 推荐的“工程化”技术栈升级方案

建议可在大作业的最后阶段（或假期）做一次技术栈的平滑升级：

1. **引入 TypeScript (极度推荐)**：
   * 大模型返回的 JSON 极容易出错（少个字段、拼写错误）。用 TS 定义好 `interface ActionResponse { action: string, x?: number, y?: number, text?: string }`。这样编辑器会立刻提示你哪里写错了，防 Bug 神器。
2. **使用 React / Vue 构建 UI**：
   * 目前你们的 Options 页和 Popup 页是纯 HTML 拼凑的。一旦简历的 JSON 变得庞大（比如要支持添加多个教育经历），用原生 JS 动态渲染表单会非常痛苦。引入 React 可以几分钟搞定复杂的配置表单。
3. **引入打包工具 (Vite/Rollup)**：
   * 浏览器原生不支持 `import`/`export` 这种模块化语法（除非声明为 module，但 Chrome 插件的 Content Script 对此有限制）。使用打包工具可以将你拆分的几十个精美小文件，最终自动打包成 `background.js` 和 `content.js` 给浏览器使用。

### 🚀 总结：现在的最佳策略

对于**目前的期末大作业**，可以不用立刻上 Webpack 和 TypeScript（避免学习成本过高导致烂尾）。

**可以用现有的原生 JS 语法，先做简单的“文件拆分”**：把 API 请求封装成一个函数放最上面，把日志封装成一个函数。只要在答辩 PPT 里画出上面那张 **“关注点分离的架构图”**，向老师展示你们不仅实现了功能，而且具备**成熟的软件工程思维与架构规划能力**，这绝对是极其加分的亮点！