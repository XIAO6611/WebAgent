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