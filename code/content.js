chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.type === "EXECUTE_ACTION") {
    const action = message.action;
    const actionType = action.action || action.type; 

    if (actionType === "click") {
      const element = document.elementFromPoint(action.x, action.y);
      if (element) {
        element.focus(); 
        element.click();
      }
    } 
    else if (actionType === "type") {
      const element = document.elementFromPoint(action.x, action.y);
      if (element) {
        element.focus();
        if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
          element.value = action.text;
        } else if (element.isContentEditable) {
          element.innerText = action.text; 
        }
        // 触发原生事件让网页框架感知
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    else if (actionType === "press_enter") {
      if (document.activeElement) {
        const enterEvent = new KeyboardEvent('keydown', { 
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        });
        document.activeElement.dispatchEvent(enterEvent);
      }
    }
    else if (actionType === "scroll") {
      window.scrollBy({ top: window.innerHeight * 0.8, left: 0, behavior: 'smooth' });
    }
    else if (actionType === "show_hitl") {
      showHITLModal(action.message);
    }
  }

  if (message.type === "GET_TEXT_CONTENT") {
    let text = document.body.innerText || "";
    if (text.length > 8000) text = text.substring(0, 8000);
    sendResponse(text);
  }

  if (message.type === "GET_DOM_INFO") {
    sendResponse(extractInteractiveElements());
  }
  
  return true; 
});

function extractInteractiveElements() {
  const elements = [];
  const query = document.querySelectorAll('input, textarea, button, a[href]');
  
  query.forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && 
        rect.top >= 0 && rect.top <= window.innerHeight && 
        rect.left >= 0 && rect.left <= window.innerWidth) {
      
      elements.push({
        id: index,
        type: el.tagName.toLowerCase(),
        text: el.innerText.trim() || el.placeholder || el.value || el.getAttribute('aria-label') || "",
        x: Math.round(rect.x + rect.width / 2), 
        y: Math.round(rect.y + rect.height / 2) 
      });
    }
  });
  return elements;
}

function showHITLModal(warningMessage) {
  if (document.getElementById('agent-hitl-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'agent-hitl-modal';
  modal.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 2147483647; 
    background: #fff; border: 2px solid #ff4d4f; border-radius: 8px;
    padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); width: 320px;
    font-family: sans-serif;
  `;
  modal.innerHTML = `
    <h3 style="margin-top:0; color: #ff4d4f; font-size: 16px;">⚠️ Agent 拦截提示</h3>
    <p style="font-size: 14px; color: #333;">${warningMessage}</p>
    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
      <button id="hitl-cancel" style="padding: 8px 16px; cursor: pointer;">手动接管</button>
      <button id="hitl-confirm" style="padding: 8px 16px; background: #ff4d4f; color: white; border: none; cursor: pointer;">放行</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('hitl-cancel').addEventListener('click', () => modal.remove());
  document.getElementById('hitl-confirm').addEventListener('click', () => modal.remove());
}