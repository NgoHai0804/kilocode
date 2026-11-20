# US-14: UI parity: chat, settings core, capability gating, file/diff

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-13](./US-13-extension-ui-shell.md) · Sau: [US-09](./US-09-ux.md)

| Trường | Giá trị |
|---|---|
| ID | US-14 |
| Persona | Người dùng debug UI trong Chrome |
| Giá trị | Chat/settings dùng đúng component shared, session/history bền, surface không hỗ trợ bị ẩn thay vì render nút chết |
| Spec | [§22.1](../../docs/specs/kilo-browser/12-ui.md) · [§22.5](../../docs/specs/kilo-browser/12-ui.md) · [§22.6](../../docs/specs/kilo-browser/12-ui.md) · [§22.9](../../docs/specs/kilo-browser/12-ui.md) · [§18](../../docs/specs/kilo-browser/09-testing-acceptance.md) |
| Phụ thuộc | US-13, US-02, US-03, US-04 |
| Mốc | M4 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 4–5 ngày |
| AC | AC-22, AC-23, AC-25, AC-26 |

> **Trạng thái (0.3.2):** complete (US-14 scope).
>
> Đã giao chat/settings lõi, session/history, pairing/connection/capability gating trong `webview-ui/browser/**` và `src/host/capabilities.ts`; browser entries `browser/index.tsx`/`browser/settings.tsx`; **file/diff viewer**: bridge `/ui/file`, `/ui/diff`, `/ui/url-guard` và trang `file.html`/`diff.html` (read-only, `kilo-ui` `File`/`Diff`) mở qua browser host adapter; E2E UI `test/e2e/ui/**`.
>
> **Bằng chứng (từ `packages/kilo-browser/`):** `bun run typecheck` exit 0; `bun test` 179 pass/1 skip/0 fail (180 test/45 file); `bun run test:e2e` 8 pass/0 fail (7 file, gồm `test/e2e/ui/{chat,settings,history,capabilities,permission,pairing,file-viewer}.spec.ts`); `bun run build:ui` pass; `bun run build:extension` pass.
>
> **Remainder `HOST_UNSUPPORTED` (deviation (d)):** login/logout, cloud, Agent Manager, marketplace, migration, worktree, terminal, PR, autocomplete, experimental runtime, export/revert/delete message, provider usage; clipboard write page-side (c); `session.diff` chưa emit vào union UI (e); message `openFile`/`openDiffVirtual`/`openWebLink`/`openExternal` trả `HOST_UNSUPPORTED` nếu tới bridge `UiHost` (adapter xử lý cục bộ). Chi tiết tại [spec §22.12](../../docs/specs/kilo-browser/12-ui.md). Ghi chú: feature matrix/hidden surfaces ghi tại spec §22.12 thay cho `packages/kilo-browser/docs/ui-parity.md`.

**Câu chuyện:** Là người dùng debug UI trong Chrome, tôi muốn chat, settings lõi, session/history và file/diff viewer hoạt động như VS Code nhưng chỉ hiện surface được hỗ trợ, để tôi debug trong trình duyệt mà không gặp nút chết hay UI fork.

## Bối cảnh

§22.1 chốt feature matrix v1: chat/new task, session tabs, local history, profile/login, settings models/providers/autoApprove/agentBehaviour/display/language/about; Agent Manager, marketplace, terminal/worktree/PR, cloud, indexing, autocomplete, speech-to-text, browser-tab, checkpoints bị ẩn ([§22.1](../../docs/specs/kilo-browser/12-ui.md)). Quy tắc cứng: surface không có trong bảng “có” phải ẩn bằng capability flag, không render nút chết, không dùng CSS che ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)).

Message/stream dùng mapping §22.5; settings ghi qua bridge theo §22.6; file/diff viewer dùng equivalent §22.9 ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§22.6](../../docs/specs/kilo-browser/12-ui.md), [§22.9](../../docs/specs/kilo-browser/12-ui.md)). UI pages `sidepanel.html`/`settings.html` đã có từ US-13; feature composition nằm trong `extension/ui/features/**` ([§8.3.8](../../docs/specs/kilo-browser/04-extension.md), [§22.7](../../docs/specs/kilo-browser/12-ui.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Chat: New task, transcript, tool cards, model picker, session tabs, local history | Pairing/connection/approval UX ([US-09](./US-09-ux.md)) |
| Settings tabs: models, providers, autoApprove, agentBehaviour (subset map được), display, language, about-browser | Host RPC/Port ([US-12](./US-12-browser-host.md)) |
| Capability-gated rendering, hidden-surface assertions | Vỏ Vite/MV3/CSP ([US-13](./US-13-extension-ui-shell.md)) |
| File viewer + diff viewer bằng `kilo-ui` `File`/`Diff`; attachment/file mention qua bridge | E2E harness `test/e2e/ui/**` ([US-10](./US-10-e2e-release.md)) |
| Profile/login cho gateway models, streaming `message.part.delta` | Agent Manager/marketplace/terminal/worktree/PR/cloud ([§22.1](../../docs/specs/kilo-browser/12-ui.md)) |

## Checklist

### Hợp đồng & dữ liệu

- [x] Feature matrix §22.1 được encode thành capability/surface list; mỗi surface có `HostCapability` tương ứng ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Chat có New task, transcript, tool cards, model picker, session tabs, local history; dùng `MessageList`/`PromptInput` shared, không fork ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§8.3.8](../../docs/specs/kilo-browser/04-extension.md)).
- [x] Settings có tab models, providers, autoApprove, agentBehaviour (chỉ mục map được), display, language, about-browser ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Capability false → không render component/nút; không dùng CSS `display:none` để che; log `ui.capability.hide` ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [AC-26](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] Surface bị ẩn gồm Agent Manager, marketplace, migration, terminal/worktree/PR, cloud session/remote/caffeination, indexing/sandboxing/autocomplete/speech-to-text, browser-tab, checkpoints ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Streaming dùng `message.part.delta`; text tăng dần, không reload trang, không render lỗi ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [AC-22](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] Settings ghi qua `ui.config.write`: project `.kilo/kilo.json` hoặc global config; browser prefs chỉ display trong `chrome.storage.local` ([§22.6](../../docs/specs/kilo-browser/12-ui.md), [§13.6](../../docs/specs/kilo-browser/08-config-observability.md)).
- [x] Không ghi secret vào log/artifact; token gateway chỉ SW memory/local có TTL ([§13.6](../../docs/specs/kilo-browser/08-config-observability.md), [§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [x] Session tabs + local history lưu `chrome.storage.local`; giữ thứ tự sau đóng/mở extension ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [AC-25](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] File viewer read-only dùng `kilo-ui` `File`; diff viewer dùng `kilo-ui` `Diff`; không renderer riêng ([§22.9](../../docs/specs/kilo-browser/12-ui.md), [§22.8](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Attachment/file mention đi qua bridge (`validateFiles`, file read trong jail); UI không đọc filesystem trực tiếp ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§7.1](../../docs/specs/kilo-browser/01-architecture.md)).
- [x] Profile/login cho gateway models hiện khi capability `profile` true; false thì ẩn profile và dùng provider local ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§22.5](../../docs/specs/kilo-browser/12-ui.md)).

### Implementation

- [x] `extension/ui/features/chat/**` compose New task, transcript, tool cards, model picker, session tabs; không copy component shared ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [x] `extension/ui/features/settings/**` render sáu tab lõi; tab nào không map được thì ẩn, không disable mờ ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [x] `extension/ui/features/history/**` và `sessions/**` đọc/ghi index local, phân trang client-side ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [x] `extension/ui/capabilities.ts` map `HostCapabilities` → surface; một nguồn duy nhất cho render gate ([§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [x] `extension/ui/file-viewer/**` mở tab read-only; `extension/ui/diff-viewer/**` mở tab diff; cả hai gọi `HostBridge.openFile/openDiff` ([§22.9](../../docs/specs/kilo-browser/12-ui.md)).
- [x] `about-browser` hiện version + capabilities, không hiện thông tin VS Code-only ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [x] i18n dùng bundle shared, fallback `en`; không hardcode chuỗi mới ngoài i18n ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§22.3](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Empty/error state cho history/session/file/diff; lỗi bridge hiện banner, không blank page ([§22.5](../../docs/specs/kilo-browser/12-ui.md), [§8.3.11](../../docs/specs/kilo-browser/04-extension.md)).

### Test

- [x] Ma trận test từng surface: chat stream, settings save, session tabs, history, file viewer, diff viewer, capability hide ([§22.10](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] AC-22: prompt → `message.part.delta` stream tăng dần, không reload; `MessageList`/`PromptInput` là component shared ([AC-22](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] AC-23: đổi model/provider, Save, bridge ghi config thật, mở lại Settings thấy giá trị; log không secret ([AC-23](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] AC-25: >= 2 session + history, đóng/mở extension, tabs/history còn nguyên thứ tự ([AC-25](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] AC-26: `agentManager=false`, `marketplace=false`, mở Chat/Settings không render surface cấm, không nút chết, có `ui.capability.hide` log ([AC-26](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [x] Hidden-surface assertions: DOM không chứa text/nút của Agent Manager, marketplace, terminal, worktree, PR ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Test file/diff viewer: mở file trong jail, diff before/after, không render HTML thô ([§22.9](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Test attachment/file mention: `validateFiles` trả denied đúng, UI hiện lỗi thay vì gửi ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- [x] E2E UI chạy qua `bun run test:ui`; file `test/e2e/ui/**` do US-10 sở hữu, US-14 cung cấp test id/hành vi ([§22.10](../../docs/specs/kilo-browser/09-testing-acceptance.md), [plan §4](./plan.md)).

### Tài liệu & vận hành

- [x] Ghi feature matrix + hidden surfaces + capability map vào `packages/kilo-browser/docs/ui-parity.md` ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Ghi settings precedence project > global > browser prefs (display) > default ([§22.6](../../docs/specs/kilo-browser/12-ui.md), [§13.4](../../docs/specs/kilo-browser/08-config-observability.md)).
- [x] Ghi screenshot/wireframe cho chat, settings, history, file/diff viewer ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [x] Ghi known gaps: surface ẩn và lý do; không hứa parity ngoài §22.1 ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)).

## Acceptance (Given/When/Then)

### AC-22
- **Given:** Extension UI mở `sidepanel.html`, bridge paired
- **When:** Gửi prompt và nhận `message.part.delta`
- **Then:** `MessageList`/`PromptInput` là component shared; text stream tăng dần, không reload trang; không có lỗi render

### AC-23
- **Given:** Settings mở tab models/providers
- **When:** Đổi model/provider và Save
- **Then:** Bridge ghi config thật; mở lại Settings thấy giá trị đã lưu; không ghi secret vào log

### AC-25
- **Given:** Có >= 2 session và history local
- **When:** Đóng/mở lại extension
- **Then:** Session tabs và history còn nguyên từ `chrome.storage.local`; không mất thứ tự

### AC-26
- **Given:** Capability `agentManager=false`, `marketplace=false`
- **When:** Mở Chat và Settings
- **Then:** Không render Agent Manager/marketplace/terminal/worktree/PR; không có nút chết; `ui.capability.hide` có log

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/unit/ui/capabilities.test.ts
bun test test/unit/ui/settings-persist.test.ts
bun run build:ui
# E2E UI do US-10 sở hữu; chạy khi harness sẵn sàng
bun run test:ui
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `extension/ui/features/chat/**` | Mới: New task, transcript, tool cards, model picker |
| `extension/ui/features/settings/**` | Mới: sáu tab settings lõi |
| `extension/ui/features/history/**` | Mới: local history list/index |
| `extension/ui/features/sessions/**` | Mới: session tabs, switch, empty state |
| `extension/ui/features/profile/**` | Mới: profile/login cho gateway models |
| `extension/ui/capabilities.ts` | Mới: map capability → surface |
| `extension/ui/file-viewer/**` | Mới: tab file read-only dùng `kilo-ui` `File` |
| `extension/ui/diff-viewer/**` | Mới: tab diff dùng `kilo-ui` `Diff` |
| `test/unit/ui/capabilities.test.ts` | Mới: capability hide/visible |
| `test/unit/ui/settings-persist.test.ts` | Mới: precedence/persist |
| `test/unit/ui/parity.test.ts` | Mới: ma trận surface, hidden assertions |
| `packages/kilo-browser/docs/ui-parity.md` | Mới: matrix, hidden surfaces, screenshots |

## Definition of Done

- [x] Chat stream dùng `message.part.delta`; không reload, không lỗi render (AC-22).
- [x] Settings models/providers Save ghi config thật, mở lại còn giá trị, không log secret (AC-23).
- [x] Session tabs + local history bền qua đóng/mở extension, giữ thứ tự (AC-25).
- [x] Capability false không render surface cấm, không nút chết, có `ui.capability.hide` log (AC-26).
- [x] File/diff viewer read-only dùng `kilo-ui`; attachment/file mention qua bridge.
- [x] Ma trận test từng surface + hidden-surface assertions xanh.

## Ghi chú & rủi ro

- Không dựng lại Agent Manager/marketplace/terminal/worktree/PR/cloud/speech-to-text; ẩn bằng capability, không CSS ([§22.1](../../docs/specs/kilo-browser/12-ui.md), [§4.3](../../docs/specs/kilo-browser/README.md)).
- `agentBehaviour` chỉ map subset (agents, MCP, rules, skills) sang config; mục không map được phải ẩn, không giả lập ([§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- `ui.question.reply`/provider route còn `(chưa xác nhận)`; nếu chưa có route thì capability false và UI ẩn, không đoán endpoint ([§22.5](../../docs/specs/kilo-browser/12-ui.md)).
- `test/e2e/ui/**` thuộc US-10; US-14 không tạo file trùng, chỉ cung cấp test id và hành vi ([plan §4](./plan.md)).
- Bundle budget do US-13 giữ; US-14 tránh import VS Code-only hoặc asset nặng vào chat entry ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).

---

[← Trước: US-13: UI shell](./US-13-extension-ui-shell.md) · [Tiếp: US-09: Pairing/approval UX](./US-09-ux.md)