// @ts-check
import { defineConfig } from 'astro/config';

// ------------------------------------------------------------
// GitHub Pages 部署配置
// 如果是 https://<user>.github.io/<repo>/ 形式，site + base 都要设。
// 如果是 https://<user>.github.io/ （根仓库），把 base 留空字符串。
// 这两个值由 CI 通过环境变量注入，本地跑用默认值。
// ------------------------------------------------------------
const SITE = process.env.SITE_URL || 'https://example.github.io';
const BASE = process.env.BASE_PATH || '';

export default defineConfig({
  site: SITE,
  base: BASE || undefined,
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  markdown: {
    shikiConfig: { theme: 'github-dark' },
  },
  vite: {
    server: { fs: { strict: false } },
  },
});
