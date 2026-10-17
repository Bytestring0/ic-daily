// @ts-check
import { defineConfig } from 'astro/config';

// ------------------------------------------------------------
// GitHub Pages 部署配置
// 仓库名是 <user>.github.io → 部署在根路径，base 留空
// 其他仓库 → 部署在 /<repo>/ 子路径，base 由 CI 注入
// ------------------------------------------------------------
const SITE = process.env.SITE_URL || 'https://example.github.io';
const BASE = process.env.BASE_PATH || '';

export default defineConfig({
  site: SITE,
  base: BASE || undefined,
  output: 'static',
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  build: {
    format: 'directory',
  },
  markdown: {
    shikiConfig: { theme: 'github-dark' },
  },
});
