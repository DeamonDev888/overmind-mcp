const testAPI = async (name, url, key, model) => {
  console.log(`\n--- Test ${name} ---`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{role: 'user', content: 'Ping'}]
      })
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response:`, text.substring(0, 300));
  } catch(e) {
    console.error('Fetch error:', e);
  }
};

(async () => {
  await testAPI('SiliconFlow GLM-5.1', 'https://api.siliconflow.cn/v1/chat/completions', 'sk-mbddibjsghfxgglxzexymxrxcskkpodmtflrxfpymjdyrnwq', 'Pro/zai-org/GLM-5.1');
  await testAPI('Alibaba DeepSeek Pro', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'sk-6c2c10cbcf3d4bf59c47ce830d1ac160', 'deepseek-v4-pro');
  await testAPI('Alibaba DeepSeek Flash', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'sk-6c2c10cbcf3d4bf59c47ce830d1ac160', 'deepseek-v4-flash');
})();
