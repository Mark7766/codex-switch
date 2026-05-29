// 简易代理冒烟测试：启动 DeepSeekProxy，curl /healthz，关闭。
import http from 'node:http';
import { DeepSeekProxy } from '../dist/electron/proxy/server.js';

const proxy = new DeepSeekProxy({ apiKey: '', port: 0, modelMapping: {} });
const port = await proxy.start();
console.log('proxy started on', port);

const body = await new Promise((resolve, reject) => {
  http
    .get(`http://127.0.0.1:${port}/healthz`, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    })
    .on('error', reject);
});
console.log('healthz:', body);

await proxy.stop();
console.log('stopped OK');
process.exit(body.status === 200 ? 0 : 1);
