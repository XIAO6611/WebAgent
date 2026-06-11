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

// ✅ 核心优化：智能网页降噪器
// ✅ 核心修复：无痕真实 DOM 降噪器
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
  const controls = document.querySelectorAll(
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']), textarea, select"
  );

  controls.forEach((el, index) => {
    if (!isVisible(el) || el.disabled || el.readOnly) return;

    const rect = el.getBoundingClientRect();
    fields.push({
      id: index,
      selector: buildStableSelector(el),
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") || el.tagName).toLowerCase(),
      name: el.getAttribute("name") || "",
      idAttr: el.id || "",
      label: findLabelText(el),
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      value: getControlValue(el),
      required: Boolean(el.required || el.getAttribute("aria-required") === "true"),
      options: getSelectOptions(el),
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2)
    });
  });

  return {
    url: location.href,
    title: document.title,
    isLoginPage: detectLoginPage(),
    fields
  };
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

function findLabelText(el) {
  if (el.id) {
    const label = document.querySelector(`label[for="${attrEscape(el.id)}"]`);
    if (label && label.innerText.trim()) return label.innerText.trim();
  }

  const parentLabel = el.closest("label");
  if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim();

  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    const labelNode = document.getElementById(ariaLabelledBy);
    if (labelNode && labelNode.innerText.trim()) return labelNode.innerText.trim();
  }

  const geometryLabel = findNearbyTextByGeometry(el);
  if (geometryLabel) return geometryLabel;

  const nearby = [];
  let node = el.parentElement;
  for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
    const text = Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE || child.tagName === "LABEL")
      .map((child) => child.textContent.trim())
      .filter(Boolean)
      .join(" ");
    if (text) nearby.push(text);
  }

  return nearby[0] || el.getAttribute("placeholder") || el.getAttribute("name") || "";
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

function getSelectOptions(el) {
  if (el.tagName !== "SELECT") return [];
  return Array.from(el.options).map((option) => ({
    value: option.value,
    text: option.textContent.trim()
  }));
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none";
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
