# US-13: Extension UI shell: Vite, MV3 pages, CSP, assets

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-12](./US-12-browser-host.md) · Sau: [US-14](./US-14-ui-parity.md)

| Trường | Giá trị |
|---|---|
| ID | US-13 |
| Persona | Kỹ sư build extension |
| Giá trị | Vỏ MV3 có hai page chat/settings, CSP đúng, asset local và worker chạy được, để UI shared render trong Chrome mà không vi phạm CSP |
| Spec | [§22.7](../../docs/specs/kilo-browser/12-ui.md) · [§22.8](../../docs/specs/kilo-browser/12-ui.md) · [§8.3.1](../../docs/specs/kilo-browser/04-extension.md) · [§8.3.2](../../docs/specs/kilo-browser/04-extension.md) · [§18 AC-27](../../docs/specs/kilo-browser/09-testing-acceptance.md) |
| Phụ thuộc | US-11, US-12 |
| Mốc | M3 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 3–4 ngày |
| AC | AC-27 |

**Câu chuyện:** Là kỹ sư build extension, tôi muốn Vite dựng `sidepanel.html` và `settings.html` với asset/worker/font local và CSP chính xác, để chat/settings shared chạy trong MV3 mà không có inline script, CDN hay CSP violation.

## Bối cảnh

§22.7 chốt Vite `base:"./"`, `vite-plugin-solid`, input `sidepanel`/`settings`, output hash, `worker.format:"es"`, target `chrome116` ([§22.7](../../docs/specs/kilo-browser/12-ui.md)). `bootstrap.ts` set `window.KILO_CAPABILITIES`, `window.KILO_ASSET_BASE`, `ICONS_BASE_URI` và URI worker qua `window.KILO_*` (không token, không bridge URL) rồi dynamic import; không inline script ([§22.7](../../docs/specs/kilo-browser/12-ui.md), [§8.3.2](../../docs/specs/kilo-browser/04-extension.md)).

CSP phải đúng nguyên văn §22.7 ([§22.7](../../docs/specs/kilo-browser/12-ui.md)):

```text
script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'
```

Manifest gốc thuộc US-01; US-13 chỉ thêm delta `side_panel.default_path`, `options_ui` và `web_accessible_resources` nếu thật sự cần ([§8.3.1](../../docs/specs/kilo-browser/04-extension.md)). §22.8 yêu cầu theme `kilo`, không phụ thuộc `--vscode-*`, Shiki worker + WASM, không `eval`/remote script, mọi asset qua `chrome.runtime.getURL` ([§22.8](../../docs/specs/kilo-browser/12-ui.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| `extension/vite.config.ts`, `sidepanel.html`, `settings.html`, `bootstrap.ts`, `main.tsx` | Feature chat/settings, file/diff viewer ([US-14](./US-14-ui-parity.md)) |
| CSP, manifest delta, worker/WASM/font/icon asset, bundle budget | Pairing/approval UX ([US-09](./US-09-ux.md)) |
| Entry mount `ChatApp`/`SettingsApp` (placeholder đến khi US-14/US-09 nối) | Host RPC/Port ([US-12](./US-12-browser-host.md)) |
| CSP/asset smoke AC-27; E2E file do US-10 sở hữu | Publish store ([§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] `extension/vite.config.ts` dùng `base:"./"`, `vite-plugin-solid`, `build.target:"chrome116"`, input `sidepanel: "ui/sidepanel.html"` và `settings: "ui/settings.html"`, output `assets/[name]-[hash].js`/`assets/[name]-[hash][extname]`, `worker.format:"es"` ([§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `sidepanel.html` là chat entry; `settings.html` là settings entry; cả hai load `bootstrap.ts`/`main.tsx`, không inline script, không remote script ([§22.7](../../docs/specs/kilo-browser/12-ui.md), [§8.3.2](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `bootstrap.ts` set `window.KILO_CAPABILITIES`, `window.KILO_ASSET_BASE`, `ICONS_BASE_URI` và URI worker qua `window.KILO_*` rồi `import("./main")`; không chứa token, bridge URL hay secret ([§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] CSP trong manifest đúng nguyên văn §22.7, gồm `wasm-unsafe-eval`, `worker-src 'self'`, `connect-src` loopback; không thêm origin/CDN ([§22.7](../../docs/specs/kilo-browser/12-ui.md), [§8.3.1](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Manifest delta: `side_panel.default_path:"sidepanel.html"`, `options_ui:{page:"settings.html",open_in_tab:true}`; giữ nguyên permission/host_permissions của US-01 ([§8.3.1](../../docs/specs/kilo-browser/04-extension.md), [§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `web_accessible_resources` không thêm mặc định; chỉ thêm nếu worker/WASM/font không load được bằng `chrome.runtime.getURL`, kèm lý do và test CSP ([§22.7](../../docs/specs/kilo-browser/12-ui.md), [§8.3.1](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `window.KILO_*` chỉ chứa capability/asset base/worker URI; không chứa capability suy đoán ngoài `HostCapabilities` ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Theme `kilo`, mode `light|dark|system`; không dùng `--vscode-*`, không inject biến VS Code ([§22.8](../../docs/specs/kilo-browser/12-ui.md)).

### Implementation

- [ ] `extension/ui/main.tsx` mount `ChatApp` cho `sidepanel.html` và `SettingsApp` cho `settings.html`; placeholder được phép, nhưng không fork component shared ([§8.3.2](../../docs/specs/kilo-browser/04-extension.md), [§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Emit worker asset `shiki-worker.js`, markdown worker và dotlottie WASM vào output; load bằng `chrome.runtime.getURL`, không qua CDN ([§22.8](../../docs/specs/kilo-browser/12-ui.md), [§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Font/icon bundle local; runtime path qua `chrome.runtime.getURL`; không request mạng ngoài loopback ([§22.8](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Asset URL dùng `base:"./"` và resolve đúng dưới `chrome-extension://<id>/`; không hardcode `/assets/...` ([§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Code split theo page: chat và settings dùng chung chunk shared nhưng entry riêng; không bundle toàn bộ VS Code-only code ([§22.7](../../docs/specs/kilo-browser/12-ui.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `bun run build:ui` xuất `extension/dist` với `sidepanel.html`/`settings.html` và asset hash; exit nonzero khi build fail ([§16](../../docs/specs/kilo-browser/10-delivery.md), [§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Không dùng `eval`, không inline event handler, không script remote trong HTML/TSX ([§22.8](../../docs/specs/kilo-browser/12-ui.md), [§8.3.1](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Bundle budget: chat ≤ 4,5 MB gzip, settings ≤ 3,0 MB gzip; vượt là fail CI có thông báo ([§22.10](../../docs/specs/kilo-browser/12-ui.md), [plan §8](./plan.md)).

### Test

- [ ] Unit `test/unit/ui/csp.test.ts`: đọc manifest, so CSP đúng nguyên văn §22.7; fail nếu có `unsafe-eval` ngoài `wasm-unsafe-eval` hoặc origin lạ ([§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Unit `test/unit/ui/assets.test.ts`: build output có `shiki-worker.js`, markdown worker, dotlottie WASM, font/icon; mọi URL là tương đối hoặc `chrome.runtime.getURL` ([§22.8](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `bun run build:ui` xanh và kiểm budget chat/settings ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] CSP/asset smoke AC-27: mở `sidepanel.html` có code block Shiki, 0 CSP violation, worker load, không request CDN; E2E file do US-10 sở hữu, US-13 cung cấp hook/asset ([AC-27](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Kiểm `settings.html` mở như tab và side panel; cùng shared bundle, không lỗi asset ([§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Kiểm theme light/dark/system không có `--vscode-*`; font/icon đúng ([AC-27](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.8](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Kiểm HTML không có inline `<script>` hoặc `on*=`; audit bằng test/grep ([§22.7](../../docs/specs/kilo-browser/12-ui.md)).

### Tài liệu & vận hành

- [ ] Ghi CSP delta, asset base, worker URI và bundle budget vào `packages/kilo-browser/docs/ui-build.md` ([§22.7](../../docs/specs/kilo-browser/12-ui.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Ghi lý do nếu phải thêm `web_accessible_resources`; mặc định là không ([§8.3.1](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Ghi cách chạy `bun run build:ui` và vị trí `extension/dist` trong runbook ([§16](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Ghi cảnh báo spec gap nếu Vite cần `blob:` cho worker; không tự nới CSP ngoài §22.7 ([§22.7](../../docs/specs/kilo-browser/12-ui.md)).

## Acceptance (Given/When/Then)

### AC-27
- **Given:** Theme `kilo`, dark/light/system
- **When:** Mở chat có code block Shiki
- **Then:** Font/icon/theme đúng; Shiki worker load; 0 CSP violation; không request CDN

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/unit/ui/csp.test.ts
bun test test/unit/ui/assets.test.ts
bun run build:ui
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `extension/vite.config.ts` | Mới: Vite + solid, `base:"./"`, hai entry, worker ES |
| `extension/ui/sidepanel.html` | Mới: chat entry, không inline script |
| `extension/ui/settings.html` | Mới: settings entry, không inline script |
| `extension/ui/bootstrap.ts` | Mới: set `window.KILO_*`, asset/worker URI, dynamic import |
| `extension/ui/main.tsx` | Mới: mount `ChatApp`/`SettingsApp` theo page |
| `extension/ui/workers/shiki-worker.ts` | Mới: worker Shiki, emit asset |
| `extension/ui/workers/markdown-worker.ts` | Mới: worker markdown, emit asset |
| `extension/ui/assets/**` | Mới: font/icon/WASM local |
| `extension/manifest.json` | Sửa delta `side_panel`/`options_ui`/CSP (handoff từ US-01) |
| `test/unit/ui/csp.test.ts` | Mới: CSP exact |
| `test/unit/ui/assets.test.ts` | Mới: asset/worker/URL |
| `packages/kilo-browser/docs/ui-build.md` | Mới: CSP/asset/budget |

## Definition of Done

- [ ] `bun run build:ui` tạo `sidepanel.html` và `settings.html` trong `extension/dist`, asset hash và worker đầy đủ.
- [ ] CSP đúng nguyên văn §22.7; không inline script/eval/remote script.
- [ ] Shiki worker + markdown worker + dotlottie WASM load bằng `chrome.runtime.getURL`.
- [ ] Theme `kilo` không phụ thuộc `--vscode-*`; font/icon local.
- [ ] Bundle budget chat/settings đạt; AC-27 smoke có bằng chứng (0 CSP violation).
- [ ] Manifest delta tối thiểu; `web_accessible_resources` không thêm nếu không cần.

## Ghi chú & rủi ro

- Brief có nhắc `worker-src 'self' blob:` nhưng §22.7 bản 0.3.0 chỉ có `worker-src 'self'`; US này giữ nguyên §22.7. Nếu Vite buộc dùng blob cho worker, đó là thay đổi CSP phải qua change control và cập nhật spec trước ([§22.7](../../docs/specs/kilo-browser/12-ui.md), [plan §11](./plan.md)).
- `extension/manifest.json` do US-01 tạo; US-13 chỉ sửa delta và giữ permission/host_permissions ([§8.3.1](../../docs/specs/kilo-browser/04-extension.md)).
- AC-27 cần Chrome thật; unit test chỉ phủ CSP/asset tĩnh, smoke thật chạy trong `test/e2e/ui/**` do US-10 sở hữu ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- Shiki worker/CSP là rủi ro cao trong MV3; nếu worker fail, kiểm `chrome.runtime.getURL` và `web_accessible_resources` trước khi nới CSP ([§22.11](../../docs/specs/kilo-browser/12-ui.md)).
- `extension/ui/main.tsx` chỉ là vỏ mount; feature UI thuộc US-14, pairing/approval thuộc US-09 ([plan §4](./plan.md)).

---

[← Trước: US-12: Browser host](./US-12-browser-host.md) · [Tiếp: US-14: UI parity](./US-14-ui-parity.md)