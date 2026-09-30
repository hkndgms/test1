# Notlarım

Obsidian vault. Notlar `content/` klasöründe; Quartz ile Cloudflare Pages'te yayınlanır ve Cloudflare Access ile korunur.

## Cloudflare Pages build ayarları

- **Build command:**
  ```
  git clone --depth 1 -b v4 https://github.com/jackyzha0/quartz.git q && rm -rf q/content && cp -r content q/content && cd q && npm ci && npx quartz build
  ```
- **Build output directory:** `q/public`
- **Environment variable:** `NODE_VERSION` = `22`
