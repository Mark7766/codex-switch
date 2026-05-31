// Dev-only runner. Uses compiled output in dist/electron.
const { DeepSeekProxy } = require('../dist/electron/proxy/server');

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('Missing DEEPSEEK_API_KEY');
  process.exit(1);
}

const modelMapping = {
  'gpt-5-codex': 'deepseek-v4-flash',
  'gpt-5.4-mini': 'deepseek-v4-flash',
  'gpt-4o': 'deepseek-v4-flash',
  'gpt-4o-mini': 'deepseek-v4-flash',
  'gpt-3.5-turbo': 'deepseek-v4-flash',
};

const proxy = new DeepSeekProxy({
  apiKey,
  port: parseInt(process.env.PORT || '11435', 10),
  modelMapping,
  defaultModel: 'deepseek-v4-flash',
});

proxy.on('log', (e) => {
  const ts = new Date(e.ts).toISOString().slice(11, 23);
  console.log(`${ts} ${String(e.level).toUpperCase().padEnd(5)} [${e.source}] ${e.message}`);
});

proxy.on('proxy-error', (info) => {
  console.error('proxy-error', info);
});

(async () => {
  const port = await proxy.start();
  console.log(`[dev-proxy] up on 127.0.0.1:${port}`);
})();

const stop = async () => {
  console.log('[dev-proxy] stopping');
  try {
    await proxy.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
