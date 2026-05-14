# 多模态 Web Agent 助手 (V2 模块化架构)

本项目是一个基于 Chrome Extension (Manifest V3) 架构的多模态 Web Agent。通过 VLM 与 LLM 的双模型协同，实现真实网页环境下的视觉理解、跨站信息检索与复杂表单填写。

1. **混合视觉对齐与定位技术 (Magnetic Adsorption)**
   规避了传统纯视觉模型的像素级精度缺陷。系统通过大模型输出粗粒度视觉坐标，底层引擎提取轻量 DOM 特征，利用重力吸附算法强制将点击点重定向至元素的几何中心，实现了“泛化性”与“精确度”的完美融合。
2. **O-P-A-V 闭环状态机引擎**
   打破单向开环执行链路。Agent 通过 `观察(O)-规划(P)-执行(A)-校验(V)` 循环，结合防死循环熔断、跨域新标签页动态追踪等机制，赋予系统自我反思与纠错自愈能力。
3. **SPA 框架深度兼容**
   首创“小手指针嗅探 (Pointer Cursor Check)”与“拟人化鼠标引擎 (Hover & Delay)”，完美穿透 Vue/React 等现代单页应用 (SPA) 复杂的事件拦截与虚拟 DOM 机制。

## 📂 项目模块化目录结构

```text
WebAgent/
├── src/
│   ├── background/             # 【云端决策与中枢层】
│   │   ├── index.js            # 唯一入口：监听前端指令，启动任务
│   │   ├── agentController.js  # 核心引擎：O-P-A-V 状态机与防死锁控制
│   │   └── promptManager.js    # 大脑皮层：注入防撞墙、下钻策略与组合技
│   │
│   ├── content/                # 【浏览器感知与执行层】
│   │   ├── index.js            # 唯一入口：接收大脑指令并分发
│   │   ├── domScanner.js       # 感知器：视口过滤、DOM 提纯与全量组件嗅探
│   │   ├── actionExecutor.js   # 执行器：拟人物理事件注入与混合重力吸附
│   │   └── uiInjector.js       # 安全网关：HITL 拦截弹窗渲染
│   │
│   ├── services/               # 【基础服务层】
│   │   ├── llmClient.js        # 网络通信：封装大模型 API 请求与 80 秒超时熔断
│   │   └── memoryService.js    # 本地记忆：读写本地知识库与授权凭证
│   │
│   ├── ui/                     # 【人机交互界面】
│   │   ├── popup/              # 任务指令下发与实时日志追踪面板
│   │   └── options/            # Semantic Memory 本地知识库配置中心
│   │
│   └── utils/                  # 【工具箱】
│       ├── logger.js           # 内存级日志持久化
│       └── templateEngine.js   # 知识库指令插值替换引擎
│
├── manifest.json               # 插件权限与路由清单
└── README.md                   # 本文档
```

🚀 运行办法
打开 Chrome 浏览器，访问 chrome://extensions/。

打开右上角“开发者模式”。

点击左上角“加载已解压的扩展程序”，选择本项目的根目录。

点击插件图标，选择“去配置 API 和知识库”，填入你的凭证。

打开测试网页（如百度或携程），呼出插件，输入任务，点击“开始执行”。
(若修改了 background 或 manifest 的代码，请务必在插件管理页点击 🔄 刷新按钮。)




