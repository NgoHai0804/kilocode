# US-10: E2E UI + packaging + beta

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-09](./US-09-ux.md) · Sau: [README](./README.md)

| Trường | Giá trị |
|---|---|
| ID | US-10 |
| Persona | Maintainer package chuẩn bị beta |
| Giá trị | Chứng minh end-to-end UI + tool trên Chrome thật, giữ parity VS Code, đóng gói reproducible và phát hành beta sideload có runbook |
| Spec | [§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md) · [§17.5](../../docs/specs/kilo-browser/09-testing-acceptance.md) · [§19](../../docs/specs/kilo-browser/10-delivery.md) · [§22.10](../../docs/specs/kilo-browser/12-ui.md) · [§18 AC-20](../../docs/specs/kilo-browser/09-testing-acceptance.md) |
| Phụ thuộc | US-01..US-14 |
| Mốc | M5 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 4–5 ngày |
| AC | AC-20 |

**Câu chuyện:** Là maintainer package chuẩn bị beta, tôi muốn E2E UI + tool chạy trên Chrome thật, parity VS Code được gate trong CI, và packaging reproducible, để biết bản beta sideload thật sự hoạt động trước khi phát hành.

## Bối cảnh

§17.3 yêu cầu Playwright `launchPersistentContext` với `--load-extension=extension/dist` và `--disable-extensions-except=extension/dist`, fixture app thật bằng `Bun.serve`; nhánh UI mở `sidepanel.html`/`settings.html`, stream prompt, lưu model/provider, mở `PermissionDock`, kiểm 0 CSP violation và Shiki worker load ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)). §22.10 thêm gate Extension UI E2E, CSP/asset smoke, bundle budget và VS Code visual regression ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).

§19 M5 đóng gói `build.ts` + Vite, docs và beta; chưa publish store ([§19](../../docs/specs/kilo-browser/10-delivery.md)). Manual model-loop §17.5 là bằng chứng cuối: ≤ 1 intervention, < 5 phút từ prompt đến bằng chứng "đã sửa", `MEMORY.md` có bài học, log không secret ([§17.5](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§4.2](../../docs/specs/kilo-browser/README.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| E2E UI: load extension, pair, prompt→stream, settings save, approval, history, capability hiding | Publish Chrome Web Store ([§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)) |
| E2E tool cũ: 12 tool, DevTools conflict, jail matrix | Headless CI không Chrome ([§4.3](../../docs/specs/kilo-browser/README.md)) |
| `bun run build:ui`, `build.ts`, `extension/build.ts`, reproducible build | Multi-tab/Firefox ([Phụ lục C](../../docs/specs/kilo-browser/99-appendix.md)) |
| VS Code visual parity AC-28 trong CI, manual loop, changeset, beta checklist | Daemon hóa bridge ([§8.1.1](../../docs/specs/kilo-browser/02-bridge.md)) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] Harness dùng đúng `chromium.launchPersistentContext(tmpdir, {headless:false, args:["--load-extension=extension/dist","--disable-extensions-except=extension/dist"]})` ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Fixture `test/fixture/app` chạy bằng `Bun.serve` ở port ngẫu nhiên, có `/login`, nút Save lỗi cố ý, `/api/save` trả 500 lần đầu, console error ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] UI E2E load extension, mở `sidepanel.html`, pair bằng code bridge in ra, assert `Connected` ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md), [AC-01](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] UI E2E gửi prompt và nhận `message.part.delta` stream tăng dần, không reload trang ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md), [AC-22](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] UI E2E đổi model/provider, Save, mở lại `settings.html` thấy giá trị đã lưu; log không secret ([AC-23](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.6](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] UI E2E mở `PermissionDock`, bấm Allow once, permission round-trip chạy ([AC-24](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] UI E2E đóng/mở extension với >= 2 session, tabs/history còn nguyên thứ tự ([AC-25](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] UI E2E capability hiding: `agentManager=false`, `marketplace=false`, không render surface cấm, không nút chết, có log `ui.capability.hide` ([AC-26](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.1](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] CSP/asset smoke: 0 CSP violation, Shiki worker load, không request CDN ([AC-27](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] VS Code visual parity gate AC-28 trong CI: `bun run test:visual` + `bun run test:unit` từ `packages/kilo-vscode/`, snapshot không đổi ([AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] `bun run build:ui` build `sidepanel.html` + `settings.html`; budget chat ≤ 4,5 MB gzip, settings ≤ 3,0 MB gzip ([§22.10](../../docs/specs/kilo-browser/12-ui.md), [§16](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] `build.ts` build CLI + shim và `extension/build.ts` build MV3; exit nonzero khi fail, ghi version/manifest ([§15](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] AC-20 chạy lại đầy đủ ở M5: `bun run typecheck`, `bun test`, `bun run build`, `bun run build:extension`, `bun run build:ui` ([AC-20](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Không publish store; tài liệu chỉ hướng dẫn sideload; publish để Phụ lục C/OQ-4 ([§19](../../docs/specs/kilo-browser/10-delivery.md), [§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)).

### Implementation

- [ ] `test/e2e/harness.ts` tạo tmp profile, spawn bridge/fixture, chờ health, dọn process/thư mục sau mỗi test; dùng `windowsHide: true` khi spawn trên Windows ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `test/e2e/ui/**` có harness UI riêng, tái dùng bridge/fixture lifecycle; không hardcode port ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `test/e2e/pairing.spec.ts`, `tools.spec.ts`, `devtools.spec.ts` tách nhóm; `test/e2e/jail/**` do US-05 sở hữu, US-10 chỉ chạy ([plan §4](./plan.md)).
- [ ] UI spec tách `chat.spec.ts`, `settings.spec.ts`, `permission.spec.ts`, `history.spec.ts`, `capabilities.spec.ts` dưới `test/e2e/ui/` ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] CI matrix 3 OS cài Chrome 116+; artifact lưu skip reason và screenshot khi fail ([§17.4](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `build.ts`/`extension/build.ts` không phụ thuộc port cố định hoặc đường dẫn máy; output đúng `dist/` và `extension/dist` ([§15](../../docs/specs/kilo-browser/10-delivery.md), [§16](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Reproducible: build sạch 2 lần, so SHA256 `dist/*.js` và `extension/dist/*`; khác biệt phải giải thích trong runbook ([§19](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Không spawn process nào thiếu `windowsHide: true` trên Windows ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md)).

### Test

- [ ] `bun test test/e2e` xanh trên Windows, macOS, Linux với Chrome thật ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `bun run test:ui` xanh: chat stream, settings save, PermissionDock, history, capability hiding ([§22.10](../../docs/specs/kilo-browser/12-ui.md)).
- [ ] Từ `packages/kilo-vscode/`: `bun run test:visual` xanh, không snapshot diff ([AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Từ `packages/kilo-vscode/`: `bun run test:unit` xanh ([AC-28](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `bun run build`, `bun run build:extension`, `bun run build:ui` tạo artifact đúng; exit 0 ([§16](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] AC-20: toàn bộ lệnh exit 0, không test skip không lý do ([AC-20](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Jail E2E skip trên môi trường thiếu quyền phải kèm lý do trong log CI ([§17.4](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Manual loop ghi số intervention, thời gian, artifact path, kết luận; `MEMORY.md` có bài học mới, log không token/password/cookie ([§17.5](../../docs/specs/kilo-browser/09-testing-acceptance.md)).

### Tài liệu & vận hành

- [ ] Runbook start/pair/attach/rotate/export/troubleshoot, gồm `windowsHide`, Chrome 116+ và cách mở `sidepanel.html`/`settings.html` ([§16](../../docs/specs/kilo-browser/10-delivery.md), [§6](../../docs/specs/kilo-browser/README.md)).
- [ ] Trang beta ghi known limitations OQ-1..OQ-7, cách sideload, cách gửi debug export ([§14.2](../../docs/specs/kilo-browser/08-config-observability.md), [§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)).
- [ ] Beta checklist: version `0.1.0`, changeset `minor`, sample `kilo-browser.json`, hướng dẫn sideload, rollback `pair --rotate` ([§19](../../docs/specs/kilo-browser/10-delivery.md), [§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Changeset `.changeset/kilo-browser-beta.md` ghi `minor` cho `@kilocode/kilo-browser` ([§15](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Ghi rõ store publish chưa làm và điều kiện làm sau ([§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)).

## Acceptance (Given/When/Then)

### AC-20
- **Given:** Repo sạch
- **When:** Chạy `bun run typecheck`, `bun test`, `bun run build`, `bun run build:extension`, `bun run build:ui`
- **Then:** Tất cả exit 0; không có test bị skip không lý do

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test
bun run build
bun run build:extension
bun run build:ui
bun test test/e2e
bun run test:ui

# Từ packages/kilo-vscode/
bun run test:visual
bun run test:unit
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `test/e2e/harness.ts` | Mới: persistent context, bridge/fixture lifecycle, `windowsHide: true` |
| `test/e2e/pairing.spec.ts` | Mới |
| `test/e2e/tools.spec.ts` | Mới: chuỗi 12 tool, artifact |
| `test/e2e/devtools.spec.ts` | Mới: `DEVTOOLS_CONFLICT` |
| `test/e2e/manual-model-loop.md` | Mới: checklist §17.5 |
| `test/e2e/ui/harness.ts` | Mới: UI E2E lifecycle |
| `test/e2e/ui/chat.spec.ts` | Mới: prompt → stream |
| `test/e2e/ui/settings.spec.ts` | Mới: save/reopen, CSP/Shiki smoke |
| `test/e2e/ui/permission.spec.ts` | Mới: PermissionDock round-trip |
| `test/e2e/ui/history.spec.ts` | Mới: session tabs/history reopen |
| `test/e2e/ui/capabilities.spec.ts` | Mới: hidden surfaces/không nút chết |
| `test/fixture/app/**` | Hoàn thiện fixture (handoff từ US-00) |
| `build.ts` | Mới: build CLI + shim → `dist/` |
| `extension/build.ts` | Mới: build MV3 → `extension/dist` |
| `package.json` | Sửa: trỏ `build`/`build:extension`/`build:ui` (handoff từ US-01) |
| `docs/runbook.md` | Mới: vận hành và beta |
| `docs/beta-checklist.md` | Mới: sideload/known issues/rollback |
| `.changeset/kilo-browser-beta.md` | Mới: changeset `minor` |

## Definition of Done

- [ ] AC-20 xanh trên 3 OS, không skip vô lý.
- [ ] `bun test test/e2e` phủ 12 tool, DevTools conflict, jail matrix.
- [ ] `bun run test:ui` phủ chat stream, settings save, approval, history, capability hiding.
- [ ] `bun run test:visual` + `test:unit` của `kilo-vscode` xanh trong CI (AC-28).
- [ ] `bun run build`, `build:extension`, `build:ui` reproducible; sai khác được giải thích.
- [ ] Manual loop đạt ≤ 1 intervention và < 5 phút, có biên bản.
- [ ] Changeset `minor` và beta checklist đủ để người khác sideload; không publish store.

## Ghi chú & rủi ro

- UI E2E hỗ trợ AC-22/23/24/25/26 nhưng US-10 chỉ sở hữu AC-20; AC chính vẫn thuộc US-14/US-09 ([plan §6](./plan.md)).
- Output extension là `extension/dist` theo §17.3, khớp `bun run build:extension` ([§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- Build paths chốt theo §15: `build.ts` (CLI + shim → `dist/`) và `extension/build.ts` (MV3 → `extension/dist`); `build:ui` do Vite config US-13 cung cấp ([§15](../../docs/specs/kilo-browser/10-delivery.md), [§22.7](../../docs/specs/kilo-browser/12-ui.md)).
- "Reproducible" chưa có định nghĩa đo trong spec; US này so SHA256 hai lần build sạch và ghi phương pháp ([§19](../../docs/specs/kilo-browser/10-delivery.md)).
- `test/e2e/jail/**` thuộc US-05; `extension/vite.config.ts` thuộc US-13; `kilo-vscode/tests/visual-regression.spec.ts` không sửa, chỉ chạy gate ([plan §4](./plan.md)).
- Store publish bị loại khỏi M5; đây là quyết định có chủ đích, không phải thiếu sót ([§19](../../docs/specs/kilo-browser/10-delivery.md), [§21](../../docs/specs/kilo-browser/11-risks-open-questions.md)).

---

[← Trước: US-09: Pairing/approval UX](./US-09-ux.md) · [Sau: README](./README.md)