# Repo layout, commands, milestones

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §15, §16 và §19.

## 15. Repo layout và build

```text
packages/kilo-webview/
  package.json
  tsconfig.json
  src/components/...
  src/context/...                 # trừ vscode.tsx + VS Code-only providers
  src/hooks/...
  src/i18n/...
  src/styles/...
  src/types/messages/...
  src/utils/...
  src/host/HostBridge.ts
  src/apps/{ChatApp,SettingsApp}.tsx
  src/index.ts

packages/kilo-browser/
  package.json
  tsconfig.json
  build.ts
  src/cli.ts
  src/index.ts
  src/mcp.ts
  src/bridge/{server,http,ws,kilo,lifecycle,supervisor,sse,memory}.ts
  src/protocol/{version,rpc}.ts
  src/config/{schema,load,generate}.ts
  src/policy/{jail,origin,redact}.ts
  src/artifacts/{store,naming}.ts
  src/plugin/{kilo-browser-guard,paths,eval}.ts
  src/log/jsonl.ts
  src/templates/{AGENTS.md,MEMORY.md,session.md}
  extension/manifest.json
  extension/build.ts
  extension/vite.config.ts
  extension/ui/{sidepanel.html,settings.html,bootstrap.ts,main.tsx,host.ts,sidepanel.tsx,settings.tsx}
  extension/src/{background,transport,rpc,cdp,refs,buffers,tools,storage,approval}/...
  test/{unit,integration,e2e,fixture/app}/...
  test/e2e/ui/...
```

`package.json` sketch:

```json
{
  "name": "@kilocode/kilo-browser",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {"kilo-browser": "./dist/cli.js", "kilo-browser-mcp": "./dist/mcp.js"},
  "exports": {".": "./dist/index.js"},
  "dependencies": {"@kilocode/kilo-webview": "workspace:*"},
  "scripts": {
    "dev": "bun run --watch src/cli.ts",
    "typecheck": "tsgo --noEmit",
    "test": "bun test",
    "build": "bun run build.ts",
    "build:extension": "bun run extension/build.ts",
    "build:ui": "vite build --config extension/vite.config.ts",
    "test:e2e": "bun test test/e2e",
    "test:ui": "bun test test/e2e/ui"
  },
  "devDependencies": {"@tsconfig/bun": "catalog:", "typescript": "catalog:"}
}
```

Dev chạy trực tiếp `bun src/cli.ts`/`bun src/mcp.ts`; `bun run build` xuất `dist/*.js` khớp `bin`. Ghi chú build: dùng `@tsconfig/bun`, `semi:false`, `printWidth:120`; turbo chạy `typecheck`/`build` như các package khác. Package mới publishable cần changeset `minor`; nếu giữ `private:true` trong v1 thì changeset chỉ cần khi publish. Vì toàn bộ nằm trong các package có `kilo` trong tên (`packages/kilo-browser/`, `packages/kilo-webview/`), không cần `kilocode_change`; không sửa file shared opencode. `knip` và `source-links` hiện chỉ quét kilo-vscode/opencode nên các package này nằm ngoài trừ khi được thêm vào script.

## 16. Commands

| Lệnh | Việc |
|---|---|
| `bun run dev -- start --workspace .` | Chạy bridge ở dev mode |
| `bun test` | Unit + integration trong package |
| `bun run typecheck` | `tsgo --noEmit` |
| `bun run build` | Build CLI + shim |
| `bun run build:extension` | Build MV3 vào `extension/dist` |
| `bun run build:ui` | Build Vite UI (sidepanel + settings) |
| `bun run test:ui` | E2E UI trong extension |
| `bun run test:visual` | Visual regression của `kilo-vscode` (chạy từ package đó) |
| `bun test test/e2e` | Playwright + Chrome persistent context |
| `bun run demo` | Chạy fixture app + in hướng dẫn pair |
| `kilo-browser start --workspace .` | Production start (sau build) |
| `kilo attach <url> --password <pw>` | Client CLI (đã xác nhận trong repo) |

Tất cả lệnh chạy từ `packages/kilo-browser/` (trừ `test:visual` chạy từ `packages/kilo-vscode/`); không chạy `bun test` từ root.

## 19. Milestones

| Mốc | Deliverable | Verification gate | Song song |
|---|---|---|---|
| M0 (1–2 ngày) | Spike `chrome-devtools-mcp` + `kilo serve` trên fixture; chứng minh CDP + localhost + snapshot/click | Demo navigate → snapshot → click trên fixture; ghi lại protocol notes | Không |
| M1 (6–7 ngày) | Bridge preflight/spawn/health, WS server, shim 6 tool đọc (`status`, `navigate`, `snapshot`, `screenshot`, `console`, `network`), config generate, pairing | Integration test với real `kilo serve` + fake WS client; AC-01..AC-08 | Extraction US-11 (`kilo-webview`) chạy song song; visual regression baseline |
| M2 (6–7 ngày) | 6 tool còn lại, guard plugin, jail, redaction, artifact, memory/session templates, browser host adapter | AC-09..AC-14, AC-17..AC-19; host RPC test; unit jail trên 3 OS | Guard/jail và host adapter có thể tách sau M1 |
| M3 (3–4 ngày) | Interact/eval/resilience, extension UI shell (`sidepanel.html`, settings entry) | AC-15, AC-16, AC-21; CSP/asset smoke | E2E và observability song song |
| M4 (4–5 ngày) | UI parity chat/settings, session tabs/history, pairing gate, PermissionDock/approval UX | AC-22..AC-26; `bun run test:ui` xanh | Settings tabs và chat parity song song |
| M5 (4–5 ngày) | E2E đầy đủ, packaging (`build.ts` + Vite), docs, beta; chưa publish store | AC-20, AC-27, AC-28; `bun run build:ui` + `build:extension` reproducible; `bun run test:visual` xanh | Store publish để [Phụ lục C](./99-appendix.md) |

Thời lượng derive từ `tasks/kilo-browser/plan.md`; tổng elapsed ≈27 ngày midpoint, tổng tuần tự ≈54 ngày.

Điều kiện qua mốc: không nợ test bị skip, không tăng timeout để che lỗi, typecheck sạch.

---

[← Previous: Testing và acceptance criteria](./09-testing-acceptance.md) · [Next: Risks và open questions](./11-risks-open-questions.md)
