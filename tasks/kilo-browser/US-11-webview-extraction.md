# US-11: Extract `kilo-webview` shared UI + `HostBridge`

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-01](./US-01-bridge-pairing.md) · Sau: [US-12](./US-12-browser-host.md)

| Trường | Giá trị |
|---|---|
| ID | US-11 |
| Persona | Kỹ sư frontend bảo trì webview Kilo |
| Giá trị | Một bộ chat/settings dùng chung cho VS Code và extension, không fork UI, không rò API host vào shared |
| Spec | [§22.2](../../docs/specs/kilo-browser/12-ui.md) · [§22.3](../../docs/specs/kilo-browser/12-ui.md) · [§22.10](../../docs/specs/kilo-browser/12-ui.md) · [§15](../../docs/specs/kilo-browser/10-delivery.md) · [§18 AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md) |
| Phụ thuộc | Không |
| Mốc | M1 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 6–7 ngày |
| AC | AC-28 |

> **Trạng thái (0.3.1):** partial.
>
> Đã giao **host seam** trong `packages/kilo-vscode/webview-ui`: `src/host/HostBridge.ts` (`HostBridge`/`HostCapabilities`), `src/host/HostProvider.tsx` (`HostProvider` + `useHost`), `src/context/vscode.tsx` (`useVSCode()` trở thành alias tương thích gọi `useHost()`), `src/host/capabilities.ts` (capability gate), và browser host adapter `webview-ui/browser/**`. Extension resolve UI qua alias `@kilo-webview` (tsconfig + Vite) trỏ tới `kilo-vscode/webview-ui`.
>
> **Còn lại (chưa giao):** tách vật lý `packages/kilo-webview`; move `components`/`context` portable/`hooks`/`i18n`/`styles`/`types/messages`/`utils`; codemod ~70 call site `useVSCode()`→`useHost()`; import audit tự động; baseline visual regression. Checklist dưới giữ nguyên. Xem deviation (a) tại [spec §22.12](../../docs/specs/kilo-browser/12-ui.md).

**Câu chuyện:** Là kỹ sư frontend bảo trì webview Kilo, tôi muốn tách component/context/hook/i18n/style dùng chung thành `packages/kilo-webview` với seam `HostBridge`, để VS Code và extension dùng đúng một bộ UI thay vì fork hoặc copy.

## Bối cảnh

§22.2 chọn extract `packages/kilo-webview` từ `packages/kilo-vscode/webview-ui`; extension cung cấp `BrowserHostBridge`, VS Code giữ `VSCodeProvider` ([§22.2](../../docs/specs/kilo-browser/12-ui.md)). §22.3 chốt package boundary, import rules và codemod `useVSCode()` → `useHost()` cho khoảng 70 call site đã kiểm chứng ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [Phụ lục A](../../docs/specs/kilo-browser/99-appendix.md)).

Đây là refactor được phép bởi A13, với điều kiện build/unit/visual regression của `kilo-vscode` không đổi ([§6](../../docs/specs/kilo-browser/README.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)). `kilo-vscode` là package Kilo-owned nên không cần `kilocode_change`; không sửa `packages/ui` upstream và không mở rộng sang Agent Manager/marketplace ([§4.3](../../docs/specs/kilo-browser/README.md), [§22.1](../../docs/specs/kilo-browser/12-ui.md)).

Rủi ro chính là extraction làm hỏng UI VS Code; merge extraction thành một PR riêng, chụp baseline visual trước khi đổi import ([§22.11](../../docs/specs/kilo-browser/12-ui.md), [§20](../../docs/specs/kilo-browser/11-risks-open-questions.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Tạo `packages/kilo-webview` (`@kilocode/kilo-webview`, private) và move các thư mục portable | `BrowserHostBridge`, Port, host RPC ([US-12](./US-12-browser-host.md)) |
| `HostBridge`/`HostCapabilities`, `ChatApp`/`SettingsApp`, `index.ts` | Vỏ Vite/MV3/CSP ([US-13](./US-13-extension-ui-shell.md)) |
| Codemod `useVSCode` → `useHost`, sửa import/build/knip | Parity surface và capability hiding ([US-14](./US-14-ui-parity.md)) |
| Giữ `VSCodeProvider`, `App.tsx`, entry files, DataBridge trong `kilo-vscode` | Thay đổi hành vi permission/chat ngoài codemod cơ học |

## Checklist

### Hợp đồng & dữ liệu

- [ ] Tạo `packages/kilo-webview/package.json` tên `@kilocode/kilo-webview`, `private: true`, dependency workspace `@kilocode/kilo-ui`, script `typecheck`; thêm dependency workspace này vào `packages/kilo-vscode/package.json` ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [§15](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Move `components`, `context` portable, `hooks`, `i18n`, `styles`, `types/messages`, portable `utils` sang `src/`; giữ `context/vscode.tsx`, `App.tsx`, entry files, `DataBridge`, VS Code-only utils ở `kilo-vscode` ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `context/provider-base.tsx` chỉ move sau khi bỏ import `VSCodeProvider`; nếu chưa tách được thì giữ ở `kilo-vscode` và ghi lý do ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `src/host/HostBridge.ts` khai báo đúng `HostBridge`/`HostCapability` của §22.3; `src/host/HostCapabilities.ts` export `HostCapabilities` tương ứng, không thêm capability ngoài danh sách ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `src/apps/ChatApp.tsx` và `src/apps/SettingsApp.tsx` render composition shared; `DataBridge` host-specific nằm ngoài shared, không import `vscode`/`chrome` ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `src/index.ts` export component/context/hook/i18n/types/host công khai; không export file VS Code-only ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [§15](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Import audit: `kilo-webview` không import `vscode`, `kilo-vscode`, `chrome.*`, `acquireVsCodeApi`; `kilo-vscode` chỉ import `@kilocode/kilo-webview` theo một chiều ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `WebviewMessage`/`ExtensionMessage` chỉ còn một nguồn shared trong `src/types/messages`; không duplicate union ở hai package ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)).

### Implementation

- [ ] `VSCodeProvider` implement `HostBridge` (kind `vscode`, capabilities, post/subscribe/getState/setState, clipboard, mở file/diff/url, validateFiles) mà không đổi hành vi hiện có ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Codemod cơ học `useVSCode()` → `useHost()` trên toàn shared package, khoảng 70 call site; không đổi logic trong cùng PR ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [Phụ lục A](../../docs/specs/kilo-browser/99-appendix.md)).
- [ ] Cập nhật esbuild entry/alias/worker/SVG/CSS của `kilo-vscode` để resolve package shared; entry `App.tsx` vẫn là entry của VS Code ([§15](../../docs/specs/kilo-browser/10-delivery.md), [Phụ lục A](../../docs/specs/kilo-browser/99-appendix.md)).
- [ ] Cập nhật `tsconfig` paths, `package.json` dependency, import Storybook/Vitest và `knip.json` cho package mới; `bun run knip` sạch ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `kilo-vscode` là Kilo-owned nên không thêm `kilocode_change`; không sửa `packages/ui` upstream; chỉ chạm `packages/kilo-vscode/webview-ui` trong phạm vi extraction ([§15](../../docs/specs/kilo-browser/10-delivery.md), [§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Rollback: extraction nằm một PR riêng; chụp baseline screenshot trước merge; nếu snapshot diff khác 0 thì revert PR thay vì sửa snapshot ([§22.11](../../docs/specs/kilo-browser/12-ui.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Không đổi theme, font/icon hay cấu trúc DOM của VS Code trong PR extraction; browser dùng theme `kilo` ở US-13 ([§22.8](../../docs/specs/kilo-browser/12-ui.md), [AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md)).

### Test

- [ ] Từ `packages/kilo-vscode/`: `bun run typecheck` xanh sau extraction ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Từ `packages/kilo-vscode/`: `bun run test:unit` xanh, không sửa test để che lỗi ([§22.10](../../docs/specs/kilo-browser/12-ui.md), [AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Từ `packages/kilo-vscode/`: `bun run test:visual` xanh, snapshot không đổi so với baseline ([§22.10](../../docs/specs/kilo-browser/12-ui.md), [AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `useVSCode` trong shared = 0; `useHost` thay thế đủ; kiểm bằng grep/ESLint ([AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Test import audit tự động: fail nếu `kilo-webview` import `vscode`/`chrome`/`kilo-vscode` ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Storybook render shared story không cần VS Code host; kiểm `StoryProviders` vẫn hoạt động ([Phụ lục A](../../docs/specs/kilo-browser/99-appendix.md)).
- [ ] Unit test `HostBridge` capability map và provider stack `HostProvider → ThemeProvider → I18nProvider → DataBridge` ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md)).

### Tài liệu & vận hành

- [ ] Ghi package boundary + import rules + quy ước `useHost` trong `packages/kilo-webview/README.md` ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Ghi chú migration: file nào ở shared, file nào ở host, `provider-base.tsx` xử lý thế nào ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Lưu baseline visual (ảnh/snapshot) và kết quả `knip` làm bằng chứng AC-28 ([AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Cập nhật `packages/kilo-webview/AGENTS.md` nếu có quy ước riêng; không sửa spec/plan/todo trong task docs-only này.

## Acceptance (Given/When/Then)

### AC-28
- **Given:** `kilo-vscode` baseline trước extraction
- **When:** Chạy `bun run test:visual` + `bun run test:unit` sau extraction
- **Then:** Snapshot và unit test không đổi; `useVSCode` trong shared = 0, `useHost` thay thế đủ

## Verify

```bash
# Từ packages/kilo-vscode/
bun run typecheck
bun run test:unit
bun run test:visual
bun run knip

# Từ packages/kilo-webview/
bun run typecheck
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `packages/kilo-webview/package.json` | Mới: `@kilocode/kilo-webview` private, dependency `@kilocode/kilo-ui` |
| `packages/kilo-webview/tsconfig.json` | Mới: cấu hình shared package |
| `packages/kilo-webview/src/index.ts` | Mới: export công khai |
| `packages/kilo-webview/src/host/HostBridge.ts` | Mới: interface §22.3 |
| `packages/kilo-webview/src/host/HostCapabilities.ts` | Mới: type capability map |
| `packages/kilo-webview/src/apps/ChatApp.tsx` | Mới: composition chat shared |
| `packages/kilo-webview/src/apps/SettingsApp.tsx` | Mới: composition settings shared |
| `packages/kilo-webview/src/{components,context,hooks,i18n,styles,types/messages,utils}/**` | Move từ `kilo-vscode/webview-ui` (trừ `context/vscode.tsx`) |
| `packages/kilo-vscode/webview-ui/src/context/vscode.tsx` | Giữ; `VSCodeProvider` implement `HostBridge` |
| `packages/kilo-vscode/webview-ui/src/{App.tsx,index.tsx}` | Giữ `App.tsx` (chứa `DataBridge`), sửa import sang package shared |
| `packages/kilo-vscode/esbuild.js` | Sửa: entry/alias/worker cho package shared |
| `packages/kilo-vscode/tsconfig.json` | Sửa: path tới `kilo-webview` |
| `packages/kilo-vscode/package.json` | Sửa: dependency workspace |
| `packages/kilo-vscode/knip.json` | Sửa: package/entry mới |
| `packages/kilo-vscode/webview-ui/src/stories/**` | Sửa import shared |
| `packages/kilo-webview/README.md` | Mới: boundary/import rules |

## Definition of Done

- [ ] `packages/kilo-webview` tồn tại, build/typecheck được, `@kilocode/kilo-webview` private.
- [ ] Shared package không import `vscode`, `kilo-vscode`, `chrome.*`, `acquireVsCodeApi`.
- [ ] `VSCodeProvider` implement `HostBridge`; `useVSCode` trong shared = 0.
- [ ] `bun run typecheck`, `bun run test:unit`, `bun run test:visual` của `kilo-vscode` không đổi (AC-28).
- [ ] `bun run knip` sạch; Storybook và import test chạy được.
- [ ] Có baseline visual trước merge và rollback plan một PR.

## Ghi chú & rủi ro

- `kilo-vscode` là Kilo-owned nên không cần `kilocode_change`; không sửa `packages/ui` upstream. Chỉ `packages/kilo-vscode/webview-ui` bị chạm trong phạm vi move/import ([§15](../../docs/specs/kilo-browser/10-delivery.md), [§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- Codemod phải cơ học: không đổi hành vi, không đổi message union, không đổi theme/DOM; điều kiện pass là typecheck + unit + visual của `kilo-vscode` xanh ([§22.3](../../docs/specs/kilo-browser/12-ui.md), [AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- `provider-base.tsx` là điểm rủi ro vì import `VSCodeProvider`; nếu tách chưa sạch, giữ ở `kilo-vscode` thay vì kéo `vscode` vào shared ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- Extraction và browser host adapter không cùng PR; nếu land trước host adapter, extension dùng wrapper nội bộ chứ không fork UI (OQ-7, [§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)).
- `knip` hiện chỉ quét `kilo-vscode`/`opencode`; nếu package mới ngoài phạm vi quét thì ghi rõ trong PR thay vì tuyên bố đã phủ ([§15](../../docs/specs/kilo-browser/10-delivery.md)).

---

[← Trước: US-01: Bridge và pairing](./US-01-bridge-pairing.md) · [Tiếp: US-12: Browser host](./US-12-browser-host.md)