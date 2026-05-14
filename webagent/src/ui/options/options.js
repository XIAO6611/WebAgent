let kbArray = []; // 在内存中维护一个对象数组 [{key: "name", value: "张三"}]

document.addEventListener('DOMContentLoaded', () => {
  // 1. 从底层读取数据并初始化
  chrome.storage.local.get(['apiKey', 'knowledgeBase'], (result) => {
    if (result.apiKey) document.getElementById('apiKey').value = result.apiKey;
    
    if (result.knowledgeBase) {
      try {
        const rawJson = JSON.parse(result.knowledgeBase);
        // 将 JSON 对象转换为数组，方便 UI 渲染和排序
        kbArray = Object.keys(rawJson).map(k => ({ key: k, value: rawJson[k] }));
      } catch (e) {
        console.error("解析知识库失败");
      }
    } else {
      // 默认给两个空行
      kbArray = [{ key: "", value: "" }, { key: "", value: "" }];
    }
    renderList(kbArray);
  });
});

// 2. 渲染 UI 列表
function renderList(listToRender) {
  const container = document.getElementById('kbList');
  container.innerHTML = ''; // 清空

  if (listToRender.length === 0) {
    container.innerHTML = '<div style="color:#9ca3af; text-align:center; padding: 20px;">当前暂无数据，请点击右上角新增</div>';
    return;
  }

  listToRender.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    // 将其在原数组中的真实索引绑定到 DOM 上，方便修改
    const realIndex = kbArray.findIndex(realItem => realItem === item);

    row.innerHTML = `
      <input type="text" placeholder="标识 (如: education)" value="${item.key}" data-index="${realIndex}" class="input-key">
      <input type="text" placeholder="映射内容 (如: 中山大学)" value="${item.value}" data-index="${realIndex}" class="input-value">
      <button class="btn btn-danger delete-btn" data-index="${realIndex}">✖</button>
    `;
    container.appendChild(row);
  });

  // 绑定动态事件 (输入同步与删除)
  document.querySelectorAll('.input-key').forEach(input => {
    input.addEventListener('input', (e) => { kbArray[e.target.dataset.index].key = e.target.value; });
  });
  document.querySelectorAll('.input-value').forEach(input => {
    input.addEventListener('input', (e) => { kbArray[e.target.dataset.index].value = e.target.value; });
  });
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      kbArray.splice(e.target.dataset.index, 1);
      renderList(kbArray); // 删完重绘
    });
  });
}

// 3. 新增按钮逻辑
document.getElementById('addBtn').addEventListener('click', () => {
  kbArray.unshift({ key: "", value: "" }); // 插在最前面
  document.getElementById('searchInput').value = ""; // 清空搜索
  renderList(kbArray);
});

// 4. 搜索与筛选逻辑
document.getElementById('searchInput').addEventListener('input', (e) => {
  const keyword = e.target.value.toLowerCase();
  const filtered = kbArray.filter(item => 
    item.key.toLowerCase().includes(keyword) || item.value.toLowerCase().includes(keyword)
  );
  renderList(filtered);
});

// 5. 排序逻辑 (按标识名 A-Z)
document.getElementById('sortBtn').addEventListener('click', () => {
  kbArray.sort((a, b) => a.key.localeCompare(b.key, 'zh-CN'));
  document.getElementById('searchInput').value = "";
  renderList(kbArray);
});

// 6. 核心保存逻辑 (将 UI 数组转回 JSON 格式交给后台)
document.getElementById('saveBtn').addEventListener('click', () => {
  const key = document.getElementById('apiKey').value.trim();
  
  // 过滤掉空的 key，并组装成 JSON 对象
  const finalJsonObj = {};
  kbArray.forEach(item => {
    const k = item.key.trim();
    const v = item.value.trim();
    if (k !== "") {
      finalJsonObj[k] = v;
    }
  });

  // 保存到底层
  chrome.storage.local.set({ 
    apiKey: key, 
    knowledgeBase: JSON.stringify(finalJsonObj) // Agent 后台代码依然读取这个 string
  }, () => {
    const status = document.getElementById('status');
    status.textContent = '✅ 保存成功！格式已自动校验。';
    // 更新后重新渲染去除空行
    kbArray = Object.keys(finalJsonObj).map(k => ({ key: k, value: finalJsonObj[k] }));
    renderList(kbArray);
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});