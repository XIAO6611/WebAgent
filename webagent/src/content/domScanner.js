function extractInteractiveElements() {
  const elements = [];
  // 扩大撒网范围，结合原本的 item/card 和新增的 div/span/li
  const query = document.querySelectorAll('input, textarea, button, a, li, div, span, [class*="item"], [class*="card"]');
  const dpr = window.devicePixelRatio || 1; 
  const seenTexts = new Set();

  query.forEach((el) => {
    const rect = el.getBoundingClientRect();
    // 严格视口过滤：只提取当前肉眼能看到的部分，且面积不能太小
    if (rect.width > 15 && rect.height > 15 && 
        rect.top >= 0 && rect.top <= window.innerHeight && 
        rect.left >= 0 && rect.left <= window.innerWidth) {
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

      // 🌟 黑科技核心：基于标签、鼠标样式(pointer)、role或特征class判定可交互性
      const isClickable = ['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes(el.tagName) || 
                          style.cursor === 'pointer' || 
                          el.hasAttribute('role') ||
                          el.className.includes('item') ||
                          el.className.includes('card');
                          
      if (!isClickable) return;

      let text = el.innerText.trim() || el.placeholder || el.value || el.getAttribute('aria-label') || "";
      text = text.replace(/\s+/g, ' ').substring(0, 40); 

      // 清洗掉没字的纯布局链接
      if (text.length < 2 && el.tagName !== 'INPUT') return;

      if (text) {
          if (seenTexts.has(text)) return; 
          seenTexts.add(text);
      }
      
      let href = "";
      if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:')) {
          href = el.href; 
      }
      
      // 保留完整的坐标，供执行器使用。使用 elements.length 保证 ID 绝对连续
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
  
  return elements.slice(0, 50); // 最多 50 个，保证 Token 不爆炸
}

function extractTextContent() {
  let text = document.body.innerText || "";
  return text.length > 6000 ? text.substring(0, 6000) : text;
}