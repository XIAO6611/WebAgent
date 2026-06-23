function executeAction(action) {
  const actionType = action.action || action.type;
  const dpr = window.devicePixelRatio || 1;
  const selectorTarget = action.selector ? document.querySelector(action.selector) : null;
  
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
    let element = selectorTarget || document.elementFromPoint(targetX, targetY);
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

      if (targetX === undefined || targetY === undefined) {
        const rect = clickableTarget.getBoundingClientRect();
        targetX = rect.left + rect.width / 2;
        targetY = rect.top + rect.height / 2;
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
    const element = selectorTarget || document.elementFromPoint(targetX, targetY);
    if (element) {
      if (targetX === undefined || targetY === undefined) {
        const rect = element.getBoundingClientRect();
        targetX = rect.left + rect.width / 2;
        targetY = rect.top + rect.height / 2;
      }
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
    // 🚨 将原本只传 action.message 改为传入整个 action 对象
    if (typeof showHITLModal === 'function') showHITLModal(action);
  }
}

function fillFormFields(assignments) {
  const results = [];

  assignments.forEach((item) => {
    if (!item || !item.selector || item.value === undefined || item.value === null) return;

    const element = document.querySelector(item.selector);
    if (!element) {
      results.push({ selector: item.selector, ok: false, reason: "element_not_found" });
      return;
    }

    const ok = writeElementValue(element, item.value);
    results.push({
      selector: item.selector,
      label: typeof findLabelText === "function" ? findLabelText(element) : "",
      value: typeof getControlValue === "function" ? getControlValue(element) : element.value,
      ok
    });
  });

  return { ok: true, results };
}


function writeElementValue(element, value) {
  element.focus();

  try {
    if (element.tagName === "SELECT") {
      const normalized = String(value).trim().toLowerCase();
      const option = Array.from(element.options).find((opt) => {
        return opt.value.trim().toLowerCase() === normalized || opt.textContent.trim().toLowerCase() === normalized;
      });
      if (option) {
          element.value = option.value;
          // 破解 React select 劫持
          const tracker = element._valueTracker;
          if (tracker) tracker.setValue(element.value);
      }
    } 
    else if (element.type === "checkbox") {
      const targetState = String(value).toLowerCase() === "true" || (Boolean(value) && String(value).toLowerCase() !== "false");
      if (element.checked !== targetState) {
          element.click();
          // 破甲：如果点 input 没用，顺带连它的外层 Label 一起物理点击
          if (element.closest('label')) element.closest('label').click();
      }
    } 
    else if (element.type === "radio") {
      const valStr = String(value).trim().toLowerCase();
      // 🚨 大模型根据提示词，会直接对想要选中的那个选项的 selector 赋值 "true"
      if (valStr === "true") {
          if (!element.checked) {
              element.click();
              if (element.closest('label')) element.closest('label').click();
          }
      } else {
          const name = element.name || "";
          const group = name ? document.querySelectorAll(`input[type="radio"][name="${String(name).replace(/["\\]/g, "\\$&")}"]`) : [element];
          const matched = Array.from(group).find((radio) => {
            const label = typeof findLabelText === "function" ? findLabelText(radio).toLowerCase() : "";
            return radio.value.toLowerCase() === valStr || label.includes(valStr);
          });
          if (matched && !matched.checked) matched.click();
          else if (!element.checked) element.click(); 
      }
    }
    else if (element.tagName !== "DIV" && element.tagName !== "SPAN") {
      // 破解 React/Vue 的输入框劫持
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      
      if (element.tagName === "INPUT" && nativeInputValueSetter) {
        nativeInputValueSetter.call(element, String(value));
      } else if (element.tagName === "TEXTAREA" && nativeTextAreaValueSetter) {
        nativeTextAreaValueSetter.call(element, String(value));
      } else {
        element.value = String(value);
      }
      
      // 必须派发事件，否则 Vue v-model 绑定的变量不会更新
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } else {
      // 针对自定义组件，直接进行物理点击（对于一些弹出式下拉框的起点）
      element.click(); 
    }

    element.blur();
    return true;
  } catch (e) {
    console.error("写入字段失败:", e);
    return false;
  }
}
