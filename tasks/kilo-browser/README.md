# Kilo Browser Agent — Delivery Plan

> Kế hoạch giao hàng cho `packages/kilo-browser` (`@kilocode/kilo-browser`) và package UI dùng chung `packages/kilo-webview`, bám theo [spec](../../docs/specs/kilo-browser/README.md) phiên bản 0.3.3 (draft, §1). Triển khai 0.3.1 dùng **host seam** trong `kilo-vscode/webview-ui` (chưa tách vật lý `packages/kilo-webview`).

## Mục đích

Chia spec thành 15 user story giao được, có thứ tự phụ thuộc, cổng chất lượng và bằng chứng AC rõ ràng. Tài liệu này là bản đồ điều phối; nguồn sự thật vẫn là spec.

| Tài liệu | Dùng để |
|---|---|
| [plan.md](./plan.md) | Mục tiêu, dependency graph, wave, cổng mốc, AC matrix, rủi ro, change control, release |
| [todo.md](./todo.md) | Roll-up 5 ô mỗi US, cập nhật theo wave và mốc |
| [Spec index](../../docs/specs/kilo-browser/README.md) | §1–§6: mục tiêu, success metrics, non-goals, thuật ngữ, giả định |
| [§17–§18 Testing & AC](../../docs/specs/kilo-browser/09-testing-acceptance.md) | Test matrix và AC-01..AC-28 |
| [§19 Milestones](../../docs/specs/kilo-browser/10-delivery.md) | M0–M5 và điều kiện qua mốc |
| [§22 UI reuse](../../docs/specs/kilo-browser/12-ui.md) | `kilo-webview`, HostBridge, capability, build/CSP, parity gate |

## Trạng thái

| Trường | Giá trị |
|---|---|
| Kế hoạch | draft, đồng bộ spec 0.3.3 |
| Phạm vi | 15 US (US-00..US-14), M0–M5 |
| Ước lượng tuần tự | 48–60 ngày (midpoint 54) |
| Ước lượng song song | 24–30 ngày elapsed (midpoint 27) |
| Critical path | US-00 → US-01 → US-12 → US-13 → US-14 → US-10 = 25 ngày; elapsed 27 |
| US đang mở | US-11 (tách vật lý `packages/kilo-webview`, deviation (a)) |
| Trạng thái triển khai | US-00..US-10, US-12, US-13, US-14 complete; US-11 partial — xem [plan §13](./plan.md) và deviation (a)–(e) |

## Way of working

- **1 US = 1 file** `US-xx-*.md`, chứa contract, AC, test command và bằng chứng.
- **US file = checklist chi tiết theo giai đoạn** (contract / implementation / tests / docs / AC) và là nơi lưu bằng chứng.
- [todo.md](./todo.md) = **master roll-up 5 ô mỗi US**, dùng để theo dõi tiến độ; tick roll-up chỉ sau khi mục chi tiết tương ứng trong US file đã pass và có bằng chứng.
- **Shared UI**: chat/settings tái dùng qua `packages/kilo-webview`; extension chỉ cung cấp host adapter + vỏ MV3. Mọi surface không có trong feature matrix §22.1 bị ẩn bằng capability flag, không render nút chết.
- Không mở rộng scope ngoài spec; thay đổi spec đi qua change control ở [plan.md §11](./plan.md).
- Protocol freeze 1.0 sau US-01; sau đó chỉ sửa protocol qua change control.

## Danh sách user story

| File | Title | Mốc | Ước lượng | Phụ thuộc | AC chính |
|---|---|---|---|---|---|
| [US-00-spike.md](./US-00-spike.md) | Spike CDP end-to-end | M0 | 1–2 ngày | — | none |
| [US-01-bridge-pairing.md](./US-01-bridge-pairing.md) | Bridge + pairing | M1 | 4–5 ngày | US-00 | AC-01..AC-03 |
| [US-02-observe.md](./US-02-observe.md) | Observe tab | M1 | 3–4 ngày | US-01 | AC-04..AC-08 |
| [US-03-interact.md](./US-03-interact.md) | Interact + verify | M2 | 3–4 ngày | US-02 | AC-09, AC-12 |
| [US-04-eval-gate.md](./US-04-eval-gate.md) | Eval gate | M2 | 2–3 ngày | US-01, US-02 | AC-10, AC-11 |
| [US-05-jail.md](./US-05-jail.md) | Jail | M2 | 3–4 ngày | US-01 | AC-13, AC-14, AC-19 |
| [US-06-memory.md](./US-06-memory.md) | Memory | M2 | 2 ngày | US-01 | AC-18 |
| [US-07-resilience.md](./US-07-resilience.md) | Resilience | M3 | 3 ngày | US-01, US-02 | AC-15, AC-16 |
| [US-08-security.md](./US-08-security.md) | Security/redaction | M2–M3 | 2 ngày | US-01 | AC-17 |
| [US-09-ux.md](./US-09-ux.md) | Pairing/connection/approval UX in reused UI | M4 | 2–3 ngày | US-13, US-04 | AC-24 (+01/11/16/21 secondary) |
| [US-10-e2e-release.md](./US-10-e2e-release.md) | E2E UI + packaging + beta | M5 | 4–5 ngày | all | AC-20 |
| [US-11-webview-extraction.md](./US-11-webview-extraction.md) | Extract `kilo-webview` + HostBridge | M1 | 6–7 ngày | — | AC-28 |
| [US-12-browser-host.md](./US-12-browser-host.md) | Browser host adapter + bridge host RPC | M2 | 6–7 ngày | US-01, US-11 | supports 22/23/24 |
| [US-13-extension-ui-shell.md](./US-13-extension-ui-shell.md) | Extension UI shell (Vite/MV3/CSP) | M3 | 3–4 ngày | US-11, US-12 | AC-27 |
| [US-14-ui-parity.md](./US-14-ui-parity.md) | UI parity chat/settings/capabilities/file-diff | M4 | 4–5 ngày | US-13, US-02, US-03, US-04 | AC-22, AC-23, AC-25, AC-26 |

Tổng tuần tự: **48–60 ngày, midpoint 54**. Elapsed theo wave: **24–30 ngày, midpoint 27**. Chi tiết dependency, wave và critical path ở [plan.md §3–§5](./plan.md).

## Bắt đầu từ đâu

1. **US-00** — spike `chrome-devtools-mcp` + `kilo serve` trên fixture, demo navigate → snapshot → click (§19 M0); đây là cổng duy nhất không có AC.
2. **US-01 + US-11** — W1: bridge preflight/spawn/health + WS + pairing, song song với extraction `kilo-webview` + HostBridge; kết thúc US-01 là **protocol freeze 1.0**.
3. **W2** — US-02, US-05, US-06, US-08, US-12 (observe/jail/memory/redaction song song browser host adapter).
4. **W3** — US-03, US-04, US-07, US-13 (interact, eval gate, resilience, UI shell).
5. **W4** — US-09 + US-14 (pairing/approval UX và UI parity chat/settings); **W5** — US-10 (E2E UI, packaging, beta).