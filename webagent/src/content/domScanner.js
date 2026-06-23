function extractInteractiveElements() {
  const elements = [];
  const query = document.querySelectorAll('input, textarea, button, a, li, div, span, [class*="item"], [class*="card"]');
  const dpr = window.devicePixelRatio || 1; 
  const seenTexts = new Set();

  query.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 15 && rect.height > 15 && 
        rect.top >= 0 && rect.top <= window.innerHeight && 
        rect.left >= 0 && rect.left <= window.innerWidth) {
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

      const isClickable = ['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes(el.tagName) || 
                          style.cursor === 'pointer' || 
                          el.hasAttribute('role') ||
                          el.className.includes('item') ||
                          el.className.includes('card');
                          
      if (!isClickable) return;

      let text = el.innerText.trim() || el.placeholder || el.value || el.getAttribute('aria-label') || "";
      text = text.replace(/\s+/g, ' ').substring(0, 40); 

      if (text.length < 2 && el.tagName !== 'INPUT') return;

      if (text) {
          if (seenTexts.has(text)) return; 
          seenTexts.add(text);
      }
      
      let href = "";
      if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:')) href = el.href; 
      
      elements.push({
        id: elements.length, 
        type: el.tagName.toLowerCase(),
        text: text,
        href: href,
        x: Math.round((rect.x + rect.width / 2) * dpr), 
        y: Math.round((rect.y + rect.height / 2) * dpr) 
      });
    }
  });
  return elements.slice(0, 50); 
}

function extractTextContent() {
  const noiseSelectors = [
    'script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside',
    '[class*="nav"]', '[class*="menu"]', '[class*="footer"]', 
    '[class*="ad"]', '[class*="sidebar"]', '[class*="banner"]', '[id*="ad"]'
  ];
  const hiddenElements = [];
  
  try {
    // 1. 临时隐藏原网页上的噪音元素（不克隆，直接在原网页操作）
    document.querySelectorAll(noiseSelectors.join(',')).forEach(el => {
      if (el.style && el.style.display !== 'none') {
        hiddenElements.push({ el: el, origDisplay: el.style.display });
        el.style.display = 'none';
      }
    });

    // 2. 获取真实的、人类肉眼可见的纯净文本
    let text = document.body.innerText || "";
    // 压缩连续的多余空行
    text = text.replace(/\n\s*\n/g, '\n').trim();
    
    // 3. 截取前 8000 字，保证长文章不被截断，同时不撑爆大模型的输入限制
    return text.length > 8000 ? text.substring(0, 8000) : text;
  } catch (error) {
    // 容错降级
    return document.body.innerText.substring(0, 5000);
  } finally {
    // 4. 提取完毕后，瞬间恢复网页原貌，做到“无痕提取”
    hiddenElements.forEach(item => {
      if (item.el && item.el.style) item.el.style.display = item.origDisplay;
    });
  }
}

function scanFormFields() {
  const fields = [];
  // 增加对常见 UI 库 (Antd, Element) 自定义选择器和 ARIA 元素的扫描
  const controls = document.querySelectorAll(`
    input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']), 
    textarea, 
    select,
    [role="combobox"], [role="radiogroup"], [role="listbox"],
    .el-select, .ant-select
  `);

  controls.forEach((el, index) => {
    if (!isVisible(el) || el.disabled || el.readOnly || (el.className && el.className.includes('disabled'))) return;

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    let type = (el.getAttribute("type") || tag).toLowerCase();
    
    // 处理伪装的 UI 组件
    if (el.hasAttribute('role') || (el.className && el.className.includes('select'))) {
      type = 'custom_select';
    }

    fields.push({
      id: index,
      selector: buildStableSelector(el),
      tag: tag,
      type: type,
      // 故意降低隐式 name 和 id 的存在感，防止污染大模型
      name: el.getAttribute("name") || "",
      label: findLabelText(el),
      placeholder: el.getAttribute("placeholder") || (tag !== 'input' ? el.innerText.trim().substring(0, 20) : ""),
      value: getControlValue(el),
      options: getSelectOptions(el), // 尝试提取选项
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2)
    });
  });

  return {
    url: location.href,
    title: document.title,
    isLoginPage: detectLoginPage(),
    // 强制过滤掉那些既没有 Label 也没有 Placeholder 的“幽灵输入框”，防止乱填
    fields: fields.filter(f => f.label || f.placeholder)
  };
}

function getSelectOptions(el) {
  if (el.tagName === "SELECT") {
    return Array.from(el.options).map((option) => ({ value: option.value, text: option.textContent.trim() }));
  }
  // 针对自定义组件，尝试寻找紧跟其后的下拉列表内容
  const textContent = el.innerText || "";
  if (textContent.includes('\n')) {
      return textContent.split('\n').map(t => ({ value: t.trim(), text: t.trim() })).filter(t => t.text);
  }
  return [];
}

function findLabelText(el) {
  // 1. 标准关联
  if (el.id) {
    const label = document.querySelector(`label[for="${attrEscape(el.id)}"]`);
    if (label && label.innerText.trim()) return label.innerText.trim();
  }
  const parentLabel = el.closest("label");
  if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim();

  // 2. 🚨核心增强：针对问卷星/自定义 UI 框架的“容器溯源算法”
  let node = el.parentElement;
  let depth = 0;
  while (node && depth < 5) {
    const className = (node.className || "").toString().toLowerCase();
    // 寻找具有“题目容器”特征的节点
    if (className.includes('field') || className.includes('item') || className.includes('question') || className.includes('row')) {
       const clone = node.cloneNode(true);
       // 剔除内部输入框和选项的值，只保留干净的题目文本
       clone.querySelectorAll('input, select, textarea, .el-select, [role="combobox"], [role="radio"]').forEach(n => n.remove());
       const text = clone.innerText.trim();
       if (text) {
           const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
           if (lines.length > 0) return lines[0]; // 提取第一行作为完美题干
       }
    }
    node = node.parentElement;
    depth++;
  }

  // 3. 几何探测降级
  const geometryLabel = findNearbyTextByGeometry(el);
  if (geometryLabel) return geometryLabel;

  return el.getAttribute("placeholder") || "";
}


function getSelectOptions(el) {
  if (el.tagName === "SELECT") {
    return Array.from(el.options).map((option) => ({
      value: option.value,
      text: option.textContent.trim()
    }));
  }
  // 尝试寻找紧跟其后的下拉列表内容（针对自定义组件）
  const textContent = el.innerText || "";
  if (textContent.includes('\n')) {
      return textContent.split('\n').map(t => ({ value: t.trim(), text: t.trim() })).filter(t => t.text);
  }
  return [];
}

function collectCurrentFormValues() {
  const scan = scanFormFields();
  return {
    url: scan.url,
    title: scan.title,
    capturedAt: new Date().toISOString(),
    fields: scan.fields
      .map((field) => ({
        key: field.label || field.placeholder || field.name || field.idAttr,
        value: field.value
      }))
      .filter((item) => item.key && item.value)
  };
}

function detectLoginPage() {
  const hasPassword = Boolean(document.querySelector("input[type='password']"));
  const text = `${document.title} ${document.body.innerText || ""}`.toLowerCase();
  const hasLoginWords = ["login", "sign in", "登录", "登入", "手机号登录", "账号登录"].some((word) => text.includes(word));
  return hasPassword && hasLoginWords;
}

function detectPageBlocker() {
  const text = `${document.title} ${document.body.innerText || ""}`.toLowerCase();
  const blockerWords = [
    "登录", "登入", "注册", "手机号登录", "账号登录", "验证码", "短信验证",
    "人机验证", "安全验证", "滑块验证", "captcha", "verify", "verification",
    "login", "sign in", "sign up", "choose", "请选择", "确认选择"
  ];

  if (detectLoginPage()) {
    return {
      blocked: true,
      reason: "检测到当前页面需要登录，Agent 已暂停，请用户登录后继续。"
    };
  }

  const visibleDialogs = Array.from(document.querySelectorAll(
    "[role='dialog'], [aria-modal='true'], .modal, .dialog, .popup, .login, .captcha"
  )).filter(isVisible);

  const dialogText = visibleDialogs
    .map((node) => node.innerText || node.textContent || "")
    .join(" ")
    .toLowerCase();

  const hasBlockingDialog = visibleDialogs.length > 0 &&
    blockerWords.some((word) => dialogText.includes(word));
  if (hasBlockingDialog) {
    return {
      blocked: true,
      reason: "检测到登录、验证或需要用户选择的弹窗，Agent 已暂停，请用户处理后继续。"
    };
  }

  const hasCaptcha = blockerWords.some((word) => text.includes(word)) &&
    Boolean(document.querySelector("input[type='password'], input[name*='code'], input[placeholder*='验证码'], canvas, iframe"));
  if (hasCaptcha) {
    return {
      blocked: true,
      reason: "检测到验证码或安全验证，Agent 无法可靠自动处理，请用户手动完成。"
    };
  }

  return { blocked: false, reason: "" };
}


function findNearbyTextByGeometry(el) {
  const rect = el.getBoundingClientRect();
  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent.trim();
      if (!text || text.length > 80) return NodeFilter.FILTER_REJECT;
      if (/^[*:\-\s]+$/.test(text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "OPTION"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node = walker.nextNode();
  while (node) {
    const parentRect = node.parentElement.getBoundingClientRect();
    const verticalDistance = rect.top - parentRect.bottom;
    const horizontalOverlap = Math.min(rect.right, parentRect.right) - Math.max(rect.left, parentRect.left);
    const leftDistance = rect.left - parentRect.right;

    const above = verticalDistance >= -8 && verticalDistance <= 120 && parentRect.left <= rect.right;
    const left = Math.abs(parentRect.top - rect.top) <= 80 && leftDistance >= -8 && leftDistance <= 260;
    if (above || left || horizontalOverlap > 0) {
      candidates.push({
        text: node.textContent.trim().replace(/^\*\s*/, "").replace(/^\d+[.、]\s*/, ""),
        score: Math.abs(verticalDistance) + Math.abs(leftDistance)
      });
    }
    node = walker.nextNode();
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates.length ? candidates[0].text : "";
}

function getControlValue(el) {
  if (el.type === "checkbox" || el.type === "radio") return el.checked ? el.value || "true" : "";
  if (el.tagName === "SELECT") {
    const option = el.options[el.selectedIndex];
    return option ? option.textContent.trim() || option.value : "";
  }
  return el.value || "";
}


function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
    if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) {
      const wrapper = el.closest('label') || el.parentElement;
      if (wrapper) {
         const wRect = wrapper.getBoundingClientRect();
         const wStyle = window.getComputedStyle(wrapper);
         return wRect.width > 0 && wRect.height > 0 && wStyle.visibility !== "hidden" && wStyle.display !== "none" && wStyle.opacity !== "0";
      }
    }
    return false;
  }
  return true;
}

function findLabelText(el) {
  let directLabel = "";
  if (el.id) {
    const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label && label.innerText.trim()) directLabel = label.innerText.trim();
  }
  if (!directLabel) {
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input').forEach(n => n.remove());
      directLabel = clone.innerText.trim();
    }
  }

  let containerLabel = "";
  let node = el.parentElement;
  let depth = 0;
  // 向上溯源 5 层，寻找“题目”容器，完美抓取类似 "* 3. 性别" 这样的题干
  while (node && depth < 5) {
    const className = (node.className || "").toString().toLowerCase();
    if (className.includes('field') || className.includes('item') || className.includes('question') || className.includes('row') || el.closest('[role="radiogroup"]')) {
       const clone = node.cloneNode(true);
       clone.querySelectorAll('input, select, textarea, .el-select, [role="combobox"], [role="radio"]').forEach(n => n.remove());
       const text = clone.innerText.trim();
       if (text) {
           const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
           if (lines.length > 0) {
               containerLabel = lines[0];
               break;
           }
       }
    }
    node = node.parentElement;
    depth++;
  }

  // 🚨 核心修复：如果是单选或多选，把【题干】和【选项】组合起来发给大模型！
  // 比如发过去的是 "* 3. 性别 (选项: 男)"，这样大模型就绝对不会搞错了！
  if (el.type === 'radio' || el.type === 'checkbox') {
     const base = containerLabel || findNearbyTextByGeometry(el) || "";
     return directLabel ? `${base} (选项: ${directLabel})` : base;
  }

  return containerLabel || directLabel || findNearbyTextByGeometry(el) || el.getAttribute("placeholder") || "";
}

function buildStableSelector(el) {
  if (el.id) return `#${cssEscape(el.id)}`;
  if (el.name) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[name="${attrEscape(el.name)}"]`;
  }

  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    const siblings = Array.from(node.parentElement ? node.parentElement.children : []);
    const sameTag = siblings.filter((item) => item.tagName === node.tagName);
    if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function attrEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}


// ========== 新增：页面语义分析 ==========
function getPageSemantics() {
  const title = document.title;
  const url = location.href;
  
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(el => el.textContent.trim()).filter(Boolean);
  const paragraphs = Array.from(document.querySelectorAll('p')).map(p => p.textContent.trim()).filter(Boolean);
  const mainTextPreview = paragraphs.join(' ').slice(0, 500);
  
  const potentialItems = document.querySelectorAll('[class*="item"], [class*="card"], [class*="list"], [class*="result"], li, [role="article"]');
  const listItems = document.querySelectorAll('[class*="item"], [class*="card"], [class*="result"], li, [role="article"], [class*="position"], [class*="job"]');
  const hasList = listItems.length >= 3 &&
                Array.from(listItems).filter(el => el.textContent.trim().length > 10).length >= 3 &&
                /search|result|list|position|job/i.test(location.href);
  const mainContent = document.querySelector('main, article, [class*="content"], [class*="detail"], [class*="description"]');
  const hasDetail = mainContent && mainContent.textContent.length > 500 && !hasList;
  
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button])');
  const buttons = document.querySelectorAll('button, input[type=submit], input[type=button]');
  const links = document.querySelectorAll('a[href]');
  const forms = document.querySelectorAll('form');
  
  const keywords = ['职位', '招聘', '详情', '描述', '要求', '岗位', '薪资', '地点', '职责', '工作', '公司', '经验', '学历'];
  const matchedKeywords = keywords.filter(kw => document.body.innerText.includes(kw));
  
  return {
    title,
    url,
    headings: headings.slice(0, 5),
    mainTextPreview,
    hasList,
    hasDetail,
    stats: { inputs: inputs.length, buttons: buttons.length, links: links.length, forms: forms.length },
    matchedKeywords
  };
}
