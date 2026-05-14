function executeAction(action) {
  const actionType = action.action || action.type; 
  const dpr = window.devicePixelRatio || 1; 
  
  let targetX = action.x !== undefined ? Math.round(action.x / dpr) : undefined;
  let targetY = action.y !== undefined ? Math.round(action.y / dpr) : undefined;

  // ==========================================
  // 🧲 混合吸附算法 (Magnetic Adsorption) 增强版
  // ==========================================
  if (targetX !== undefined && targetY !== undefined) {
    // 扩大吸附目标，把卡片和条目也加进来
    const interactables = document.querySelectorAll('button, input, textarea, a, select, [role="button"], [class*="item"], [class*="card"]');
    for (let el of interactables) {
      const rect = el.getBoundingClientRect();
      if (targetX >= rect.left - 15 && targetX <= rect.right + 15 &&
          targetY >= rect.top - 15 && targetY <= rect.bottom + 15) {
        targetX = rect.left + rect.width / 2;
        targetY = rect.top + rect.height / 2;
        break; 
      }
    }
  }

  // 🔴 视觉反馈红点 (在屏幕上画个波纹，让你看清点在哪了)
  if (targetX !== undefined && targetY !== undefined) {
    const dot = document.createElement('div');
    dot.style.cssText = `
      position: fixed; left: ${targetX}px; top: ${targetY}px; 
      width: 15px; height: 15px; background: rgba(255, 0, 0, 0.6); 
      border: 2px solid red; border-radius: 50%; z-index: 2147483647; 
      transform: translate(-50%, -50%); pointer-events: none; 
      box-shadow: 0 0 10px red; transition: all 0.5s ease-out;
    `;
    document.body.appendChild(dot);
    requestAnimationFrame(() => {
        dot.style.transform = "translate(-50%, -50%) scale(3)";
        dot.style.opacity = "0";
    });
    setTimeout(() => dot.remove(), 600);
  }

  // ==========================================
  // 🤖 物理动作执行 (拟人化升级)
  // ==========================================
  if (actionType === "click") {
    let element = document.elementFromPoint(targetX, targetY); 
    if (element) { 
      // 1. 向上溯源：如果点到了内层文字，找到真正能点击的外层卡片容器
      let clickableTarget = element;
      let temp = element;
      while (temp && temp !== document.body) {
        const style = window.getComputedStyle(temp);
        if (['A', 'BUTTON'].includes(temp.tagName) || style.cursor === 'pointer' || temp.className.includes('card') || temp.className.includes('item')) {
          clickableTarget = temp;
          break;
        }
        temp = temp.parentElement;
      }

      // 组装带有真实物理坐标的鼠标事件
      const eventInit = { bubbles: true, cancelable: true, view: window, clientX: targetX, clientY: targetY };

      // 2. 模拟悬停唤醒 (Hover)：欺骗 Vue 触发悬停动画
      clickableTarget.dispatchEvent(new MouseEvent('mouseover', eventInit));
      clickableTarget.dispatchEvent(new MouseEvent('mouseenter', eventInit));
      clickableTarget.dispatchEvent(new MouseEvent('mousemove', eventInit));

      // 3. 拟人按压周期：按下 -> 延迟 80ms -> 抬起 -> 点击
      clickableTarget.dispatchEvent(new MouseEvent('mousedown', eventInit));
      
      setTimeout(() => {
        clickableTarget.dispatchEvent(new MouseEvent('mouseup', eventInit));
        clickableTarget.click(); // 触发原生或绑定的点击路由
        console.log("⚡ 拟人化点击已执行", clickableTarget);
      }, 80); 
    }
  } 
  else if (actionType === "type") {
    const element = document.elementFromPoint(targetX, targetY); 
    if (element) {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: targetX, clientY: targetY }));
      element.click(); 
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") element.value = action.text;
      else if (element.isContentEditable) element.innerText = action.text; 
      
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      // 处理组合技：打字后瞬间物理回车
      if (action.submit_after_type === true) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        if (element.form) element.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
  }
  else if (actionType === "press_enter") {
    if (document.activeElement) {
      const el = document.activeElement;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      if (el.form) el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }
  else if (actionType === "scroll") {
    window.scrollBy({ top: window.innerHeight * 0.8, left: 0, behavior: 'smooth' });
  }
  else if (actionType === "back") {
    window.history.back();
  }
  else if (actionType === "show_hitl") {
    if (typeof showHITLModal === 'function') showHITLModal(action.message);
  }
}