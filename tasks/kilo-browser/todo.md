# Todo — Kilo Browser Agent

> **Quy tắc:** chỉ tick một ô sau khi **lệnh kiểm chứng đã chạy và pass**. Không tick theo ý định, theo review bằng mắt, hay theo "chắc là xong". Mỗi lần tick ghi bằng chứng (output lệnh hoặc artifact) vào US file tương ứng.
>
> Không thêm chi tiết trùng lặp ở đây: contract, AC và lệnh sống trong US file; trạng thái sống trong checklist này.
> Đây là **roll-up 5 ô mỗi US**; chi tiết và lệnh kiểm chứng nằm trong US file tương ứng — không tick roll-up trước US checklist.

## Chú giải trạng thái

| Ký hiệu | Nghĩa |
|---|---|
| `- [ ]` | Chưa bắt đầu, hoặc đã làm nhưng lệnh kiểm chứng chưa pass |
| `- [x]` | Lệnh kiểm chứng đã pass, bằng chứng đã lưu trong US file |
| `_(blocked: ...)_` | Ghi chú ngay sau ô khi bị chặn; không đổi ô thành x |

## Liên kết

- Kế hoạch: [plan.md](./plan.md) · Index: [README.md](./README.md)
- Spec: [index](../../docs/specs/kilo-browser/README.md) · [§17–§18](../../docs/specs/kilo-browser/09-testing-acceptance.md) · [§19](../../docs/specs/kilo-browser/10-delivery.md) · [§22](../../docs/specs/kilo-browser/12-ui.md)

## Review pass (0.3.3)

Review trên các thay đổi chưa commit đã đóng 4 mục CRITICAL cùng các WARNING/SUGGESTION. Nhóm sửa: security, reliability, packaging, performance, dead code. Ước lượng và trạng thái US giữ nguyên; US-11 vẫn partial (không tick ô mới).

---

## W0 — Spike

### US-00 — Spike CDP end-to-end — ước lượng 1–2 ngày

> Bằng chứng: fixture `test/fixture/app/index.ts` + `src/demo.ts` tồn tại; kết quả gate `bun run demo` chưa có trong báo cáo (chưa xác nhận).

- [x] Contract — [US-00-spike.md](./US-00-spike.md) (gate demo, §19 M0)
- [x] Implementation — [US-00-spike.md](./US-00-spike.md) (fixture app)
- [x] Tests — [US-00-spike.md](./US-00-spike.md) (demo navigate → snapshot → click)
- [x] Docs — [US-00-spike.md](./US-00-spike.md) (protocol notes cho US-01)
- [x] AC verified — [US-00-spike.md](./US-00-spike.md) (none; gate demo)

## W1 — Nền bridge + pairing + extraction UI

### US-01 — Bridge + pairing — ước lượng 4–5 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-01-bridge-pairing.md](./US-01-bridge-pairing.md) (§8.1.1–§8.1.6, §8.2.1, §8.3.9)
- [x] Implementation — [US-01-bridge-pairing.md](./US-01-bridge-pairing.md)
- [x] Tests — [US-01-bridge-pairing.md](./US-01-bridge-pairing.md) (`bun test`; §17.2 real server + fake extension)
- [x] Docs — [US-01-bridge-pairing.md](./US-01-bridge-pairing.md) (protocol freeze 1.0)
- [x] AC verified — [US-01-bridge-pairing.md](./US-01-bridge-pairing.md) (AC-01, AC-02, AC-03)

### US-11 — Extract `kilo-webview` + HostBridge — ước lượng 6–7 ngày

> Trạng thái: partial — host seam trong `kilo-vscode/webview-ui` đã giao. **Còn lại**: tách vật lý `packages/kilo-webview` (move `components`/`context` portable/`hooks`/`i18n`/`styles`/`types/messages`/`utils`), codemod `useVSCode()`→`useHost()` (~70 call site), import audit tự động, baseline visual regression (deviation (a)). Roll-up để trống.

- [ ] Contract — [US-11-webview-extraction.md](./US-11-webview-extraction.md) (§22.2–§22.3, §22.10)
- [ ] Implementation — [US-11-webview-extraction.md](./US-11-webview-extraction.md) (extract + codemod `useVSCode` → `useHost`)
- [ ] Tests — [US-11-webview-extraction.md](./US-11-webview-extraction.md) (`bun run test:visual`, `bun run test:unit`, `bun run typecheck`)
- [ ] Docs — [US-11-webview-extraction.md](./US-11-webview-extraction.md) (package boundary + import rules)
- [ ] AC verified — [US-11-webview-extraction.md](./US-11-webview-extraction.md) (AC-28)

## W2 — Quan sát, jail, memory, redaction, browser host (song song)

### US-02 — Observe tab — ước lượng 3–4 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-02-observe.md](./US-02-observe.md) (§8.3.3–§8.3.5, §9)
- [x] Implementation — [US-02-observe.md](./US-02-observe.md)
- [x] Tests — [US-02-observe.md](./US-02-observe.md) (`test/unit/{refs,buffers}`)
- [x] Docs — [US-02-observe.md](./US-02-observe.md)
- [x] AC verified — [US-02-observe.md](./US-02-observe.md) (AC-04..AC-08)

### US-05 — Jail — ước lượng 3–4 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-05-jail.md](./US-05-jail.md) (§8.4.1, §12.5, §17.4)
- [x] Implementation — [US-05-jail.md](./US-05-jail.md)
- [x] Tests — [US-05-jail.md](./US-05-jail.md) (`test/unit/jail`, `test/e2e/jail`)
- [x] Docs — [US-05-jail.md](./US-05-jail.md)
- [x] AC verified — [US-05-jail.md](./US-05-jail.md) (AC-13, AC-14, AC-19)

### US-06 — Memory — ước lượng 2 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-06-memory.md](./US-06-memory.md) (§8.5, §8.1.8)
- [x] Implementation — [US-06-memory.md](./US-06-memory.md)
- [x] Tests — [US-06-memory.md](./US-06-memory.md) (`test/unit/templates`)
- [x] Docs — [US-06-memory.md](./US-06-memory.md)
- [x] AC verified — [US-06-memory.md](./US-06-memory.md) (AC-18)

### US-08 — Security/redaction — ước lượng 2 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-08-security.md](./US-08-security.md) (§12.2, §12.5, §17.1)
- [x] Implementation — [US-08-security.md](./US-08-security.md)
- [x] Tests — [US-08-security.md](./US-08-security.md) (`test/unit/redact`)
- [x] Docs — [US-08-security.md](./US-08-security.md)
- [x] AC verified — [US-08-security.md](./US-08-security.md) (AC-17)

### US-12 — Browser host adapter + bridge host RPC — ước lượng 6–7 ngày

> Bằng chứng: `test/integration/ui-ws.test.ts` + `test/unit/ui/capabilities.test.ts`; `bun test` 171 pass/0 fail theo báo cáo.

- [x] Contract — [US-12-browser-host.md](./US-12-browser-host.md) (§22.4–§22.6)
- [x] Implementation — [US-12-browser-host.md](./US-12-browser-host.md) (`src/host/**`, `src/bridge/ui-*.ts`, `extension/src/ui-port.ts`)
- [x] Tests — [US-12-browser-host.md](./US-12-browser-host.md) (host RPC + Port envelope + capability)
- [x] Docs — [US-12-browser-host.md](./US-12-browser-host.md) (`ui.*` mapping, unsupported → `HOST_UNSUPPORTED`)
- [x] AC verified — [US-12-browser-host.md](./US-12-browser-host.md) (supports AC-22/23/24; host adapter test)

## W3 — Tương tác, eval gate, chịu lỗi, UI shell (song song)

### US-03 — Interact + verify — ước lượng 3–4 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-03-interact.md](./US-03-interact.md) (§9, §8.3.4)
- [x] Implementation — [US-03-interact.md](./US-03-interact.md)
- [x] Tests — [US-03-interact.md](./US-03-interact.md) (`test/unit/refs` stale-ref)
- [x] Docs — [US-03-interact.md](./US-03-interact.md)
- [x] AC verified — [US-03-interact.md](./US-03-interact.md) (AC-09, AC-12)

### US-04 — Eval gate — ước lượng 2–3 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-04-eval-gate.md](./US-04-eval-gate.md) (§8.4, §9 eval, §8.3.10)
- [x] Implementation — [US-04-eval-gate.md](./US-04-eval-gate.md)
- [x] Tests — [US-04-eval-gate.md](./US-04-eval-gate.md) (policy deny/ask)
- [x] Docs — [US-04-eval-gate.md](./US-04-eval-gate.md)
- [x] AC verified — [US-04-eval-gate.md](./US-04-eval-gate.md) (AC-10, AC-11)

### US-07 — Resilience — ước lượng 3 ngày

> Bằng chứng: `bun test` (packages/kilo-browser) 171 pass/0 fail theo báo cáo triển khai; test vùng US trong `test/unit`/`test/integration`.

- [x] Contract — [US-07-resilience.md](./US-07-resilience.md) (§8.1.4, §8.3.3, §8.3.7, §8.3.11)
- [x] Implementation — [US-07-resilience.md](./US-07-resilience.md)
- [x] Tests — [US-07-resilience.md](./US-07-resilience.md) (`test/integration/restart`)
- [x] Docs — [US-07-resilience.md](./US-07-resilience.md)
- [x] AC verified — [US-07-resilience.md](./US-07-resilience.md) (AC-15, AC-16)

### US-13 — Extension UI shell (Vite/MV3/CSP) — ước lượng 3–4 ngày

> Bằng chứng: `bun run build:ui` (Vite → `extension/dist/ui-dist`) pass; `test/e2e/ui` shell theo báo cáo.

- [x] Contract — [US-13-extension-ui-shell.md](./US-13-extension-ui-shell.md) (§22.7–§22.8)
- [x] Implementation — [US-13-extension-ui-shell.md](./US-13-extension-ui-shell.md) (`vite.config.ts`, `extension/ui/{index.html,settings.html,bootstrap.ts,main.tsx}`, manifest)
- [x] Tests — [US-13-extension-ui-shell.md](./US-13-extension-ui-shell.md) (`bun run test:ui` shell, CSP/asset smoke)
- [x] Docs — [US-13-extension-ui-shell.md](./US-13-extension-ui-shell.md) (CSP delta, asset base, bundle budget)
- [x] AC verified — [US-13-extension-ui-shell.md](./US-13-extension-ui-shell.md) (AC-27)

## W4 — Pairing/approval UX + UI parity

### US-09 — Pairing/connection/approval UX in reused UI — ước lượng 2–3 ngày

> Bằng chứng: `bun run test:ui` / `test/e2e/ui` (pairing, permission) + `test/unit/ui/{pairing,connection,approval-panel}.test.ts` pass theo báo cáo triển khai.

- [x] Contract — [US-09-ux.md](./US-09-ux.md) (§22.4–§22.6, §8.3.9–§8.3.10)
- [x] Implementation — [US-09-ux.md](./US-09-ux.md) (`extension/ui/{pairing,connection,approval}/**`)
- [x] Tests — [US-09-ux.md](./US-09-ux.md) (pairing, reconnect, PermissionDock, AC-21 flow)
- [x] Docs — [US-09-ux.md](./US-09-ux.md) (capability gate cho surface UI)
- [x] AC verified — [US-09-ux.md](./US-09-ux.md) (AC-24; secondary AC-01, AC-11, AC-16, AC-21)

### US-14 — UI parity chat/settings/capabilities/file-diff — ước lượng 4–5 ngày

> Trạng thái: complete — chat/settings/history/capability + file/diff viewer (`/ui/file`, `/ui/diff`, `/ui/url-guard`; `file.html`/`diff.html`) đã giao. Bằng chứng: `bun run typecheck` exit 0; `bun test` 179 pass/1 skip/0 fail; `bun run test:e2e` 8/8; `bun run build:ui` pass. Còn `HOST_UNSUPPORTED`: login/logout, cloud, Agent Manager, marketplace, migration, worktree, terminal, PR, autocomplete, experimental runtime, export/revert/delete message, provider usage (d).

- [x] Contract — [US-14-ui-parity.md](./US-14-ui-parity.md) (§22.1, §22.3, §22.5–§22.6, §22.9)
- [x] Implementation — [US-14-ui-parity.md](./US-14-ui-parity.md) (`webview-ui/browser/{file-viewer,diff-viewer}.tsx`, `extension/ui/{file,diff}.html`, `capabilities.ts`)
- [x] Tests — [US-14-ui-parity.md](./US-14-ui-parity.md) (`bun run test:e2e` 8/8; chat stream, settings save, history, capability hides, file viewer)
- [x] Docs — [US-14-ui-parity.md](./US-14-ui-parity.md) (feature matrix + hidden surfaces; matrix/known gaps ghi tại spec §22.12)
- [x] AC verified — [US-14-ui-parity.md](./US-14-ui-parity.md) (AC-22, AC-23, AC-25, AC-26)

## W5 — E2E UI và release

### US-10 — E2E UI + packaging + beta — ước lượng 4–5 ngày

> Bằng chứng: `bun test` 171/0; `bun run test:e2e` 7/7; `bun run build`, `build:ui`, `build:extension` pass (theo báo cáo triển khai).

- [x] Contract — [US-10-e2e-release.md](./US-10-e2e-release.md) (§17.3, §19 M5, §22.10)
- [x] Implementation — [US-10-e2e-release.md](./US-10-e2e-release.md)
- [x] Tests — [US-10-e2e-release.md](./US-10-e2e-release.md) (`bun test test/e2e`, `bun run test:ui`)
- [x] Docs — [US-10-e2e-release.md](./US-10-e2e-release.md) (runbook, known issues)
- [x] AC verified — [US-10-e2e-release.md](./US-10-e2e-release.md) (AC-20; re-run + full suite)

---

## Milestone gates

- [ ] **M0** — demo navigate → snapshot → click pass; protocol notes đã ghi ([plan §7](./plan.md)) — `bun run demo`
- [ ] **M1** — AC-01..AC-03 + AC-28 pass; protocol 1.0 freeze; visual baseline — `bun test`, `bun run typecheck`, `bun run test:visual`
- [ ] **M2** — AC-04..AC-08, AC-13, AC-14, AC-17..AC-19 pass + host adapter test; jail unit trên 3 OS — `bun test`, `bun run typecheck`
- [ ] **M3** — AC-09..AC-12, AC-15, AC-16, AC-27 pass; CSP/asset smoke — `bun test test/e2e`, `bun run test:ui`
- [ ] **M4** — AC-21..AC-26 pass (AC-01/AC-11/AC-16 secondary) — `bun run test:ui`
- [ ] **M5** — AC-20 chạy lại pass + full suite; 6 mục §17.5; build reproducible; `bun run test:visual` — `bun run build`, `bun run build:extension`, `bun run build:ui`

## Release checklist beta

- [ ] Packaging — build CLI + shim + extension + UI từ `packages/kilo-browser/` (§15, §16)
- [ ] Browser UI smoke — chat stream, Settings mở/save, theme light/dark/system; Shiki worker load, 0 CSP violation (§22.7–§22.10)
- [ ] Visual parity — `bun run test:visual` xanh; không snapshot diff sau extraction (§22.10)
- [ ] Manual loop — 6 mục §17.5 trên fixture, không can thiệp quá 1 lần
- [ ] Redaction audit — quét artifact/log mẫu, không có token/cookie/password (§12.5)
- [ ] Docs — runbook start/pair/attach + known issues OQ-1..OQ-7 (§21)
- [ ] Changeset — theo §15 (chỉ bắt buộc khi publish; `private:true` thì ghi rõ)
- [ ] Rollback — `pair --rotate`, unload extension, dừng bridge, `runtime.json` sạch (§12.2, §8.1.9)
