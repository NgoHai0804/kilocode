# US-04: Cổng eval (deny mặc định + approval)

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-03](./US-03-interact.md) · Sau: [US-05](./US-05-jail.md)

| Trường | Giá trị |
|---|---|
| ID | US-04 |
| Persona | Solo dev |
| Giá trị | `browser_eval` bị chặn mặc định, chỉ chạy sau khi người dùng duyệt từng call, trong isolated world và có audit; agent không có scripting console tùy ý |
| Spec | [§9](../../docs/specs/kilo-browser/05-tools-loop.md) · [§8.3.10](../../docs/specs/kilo-browser/04-extension.md) · [§8.4](../../docs/specs/kilo-browser/07-security-jail.md) · [§10.4](../../docs/specs/kilo-browser/03-protocol-mcp.md) |
| Phụ thuộc | US-01, US-02 |
| Mốc | M2 — [§19](../../docs/specs/kilo-browser/10-delivery.md) |
| Ước lượng | 2–3 ngày |
| AC | AC-10, AC-11 |

**Câu chuyện:** Là solo dev, tôi muốn `browser_eval` bị từ chối mặc định và chỉ chạy khi tôi duyệt rõ ràng, để agent có lối thoát kỹ thuật mà không biến tab của tôi thành console chạy script tùy ý.

## Bối cảnh

`browser_eval` là tool duy nhất mặc định `deny`; muốn dùng phải đặt `tools.eval: "ask"` trong `.kilo/kilo-browser.json` và người dùng duyệt từng call ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§13.1](../../docs/specs/kilo-browser/08-config-observability.md)). Eval chạy trong isolated world do extension tạo bằng `Page.createIsolatedWorld`, không có quyền truy cập `chrome.*`, không trả về function/object không serialize được; kết quả cắt ở 64 KB và ghi artifact nếu vượt ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).

Guard plugin chạy trong tiến trình Kilo, trước permission check của tool; nó ép `ask` và chặn sớm bằng `permission.ask` và `tool.execute.before` ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md)). Approval modal có `Allow once` và `Allow for tab` 15 phút, timeout 60 giây thì deny ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)). Đây là defense-in-depth: bridge policy, guard plugin và approval của extension cùng kiểm tra.

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Deny mặc định, nhánh `ask`, approval, isolated world, cap 64 KB, audit, guard eval | Console/scripting tổng quát, AST allowlist, chặn network trong eval, các tool khác, jail đường dẫn (US-05) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] `tools.eval` mặc định `deny`; `ask` là opt-in duy nhất trong config; không có default `allow` ở bất kỳ file sinh ra nào ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§13.2](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Nhánh deny trả `-32006` kind `POLICY_DENIED` trước khi gửi bất kỳ frame `browser.eval` nào; không có `Runtime.evaluate` chạy ([§18](../../docs/specs/kilo-browser/09-testing-acceptance.md) AC-10, [§10.4](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Nhánh `ask` mở approval với method, origin, preview tham số tối đa 500 ký tự đã redact và thời gian hết hạn ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `Allow once` chỉ áp dụng một call; `Allow for tab` áp dụng đến khi đổi tab hoặc 15 phút; hết hạn thì phải duyệt lại ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Timeout approval 60 giây trả `-32001` kind `APPROVAL_TIMEOUT`, không retry tự động ([§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Audit ghi `permission.asked`/`permission.replied` và `tool.start`/`tool.end` cho `browser_eval`; không ghi nội dung `expression` thô ([Phụ lục D](../../docs/specs/kilo-browser/99-appendix.md), [§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Guard `permission.ask` đặt `browser_eval` thành `ask` khi policy là `ask`; `tool.execute.before` deny khi policy là `deny`; `tool.execute.after` redact output ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Guard dùng tên đã namespace `browser_eval`, không dùng tên trần `eval` ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md), [Phụ lục A](../../docs/specs/kilo-browser/99-appendix.md)).
- [ ] Kết quả eval chỉ chứa value serialize được; function/symbol/cyclic object trả `-32602 INVALID_PARAMS`, không treo call ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] Kết quả > 64 KB bị cắt, có `truncated:true` và artifact JSON kèm `expressionHash` ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§14.2](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Timeout tool là 10000 ms; timeout approval 60 giây là timeout riêng, không cộng dồn thành một ngưỡng ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§8.3.10](../../docs/specs/kilo-browser/04-extension.md)).

### Implementation

- [ ] `src/plugin/eval.ts` export hàm quyết định thuần túy `decideEval(config, approval)` trả `deny`/`ask`/`allow`, fail-closed với config hoặc approval không hợp lệ.
- [ ] Bridge gọi `decideEval` trước khi forward `browser.eval`; chỉ forward khi kết quả là `allow` sau approval, không dựa vào việc extension tự chặn.
- [ ] Extension chỉ chạy eval sau khi có approval token hợp lệ cho call hoặc tab; token hết hạn/không khớp thì trả `-32001`.
- [ ] Eval chạy trong `Page.createIsolatedWorld`; không inject vào main world, không expose `chrome.*`, không đọc biến toàn cục của extension ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] `extension/src/approval/**` cung cấp approval path tối thiểu cho AC-11 ở M2: token theo call/tab, `Allow once`/`Allow for tab`, hết hạn 60 giây; panel đầy đủ là US-09 ở M3.
- [ ] Hỗ trợ `awaitPromise` và `returnByValue` đúng [§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md); promise reject hoặc exception trả `-32602 INVALID_PARAMS` có message đã redact.
- [ ] Approval preview dùng `src/policy/redact.ts` của US-02; không hiển thị token/cookie/header nhạy cảm ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Origin ngoài allowlist vẫn phải qua approval và vẫn bị chặn bởi policy origin; eval không mở đường vòng qua allowlist ([§12.3](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Ghi artifact eval dưới `.kilo/kilo-browser/artifacts/<sessionID>/` với `expressionHash`, không ghi expression thô nếu chứa secret ([§14.2](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Không thêm endpoint, event hay config key mới; mọi thứ dùng [§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md), [§14.1](../../docs/specs/kilo-browser/08-config-observability.md) và [§13.1](../../docs/specs/kilo-browser/08-config-observability.md).

### Test

- [ ] AC-10: với `tools.eval` là `deny`, gọi `browser_eval` trả `-32006 kind:POLICY_DENIED`; fake extension ghi nhận 0 frame `browser.eval` và 0 `Runtime.evaluate`.
- [ ] AC-11: với `tools.eval` là `ask` và người dùng duyệt, `browser_eval {expression:"document.title"}` trả `value:"Login"`; log có bản ghi approval.
- [ ] Test timeout: không duyệt trong 60 giây trả `-32001` kind `APPROVAL_TIMEOUT`; không có eval chạy và không retry.
- [ ] Test `Allow once`: call thứ hai không có approval mới bị deny; `Allow for tab` cho phép trong 15 phút rồi hết hạn.
- [ ] Test isolated world: expression cố đọc `chrome` hoặc biến của extension trả lỗi/undefined, không lộ object của extension.
- [ ] Test cap: kết quả > 64 KB bị cắt, có `truncated:true` và artifact tồn tại; expression ném lỗi trả `-32602 INVALID_PARAMS`.
- [ ] Unit truth table cho `decideEval`: deny + mọi approval, ask + chưa duyệt, ask + đã duyệt, config lạ, approval hết hạn.

### Tài liệu & vận hành

- [ ] Ghi rõ non-goal: đây không phải console scripting tổng quát; không có REPL, không giữ context giữa các call, không chạy nhiều expression trong một call ([§4.3](../../docs/specs/kilo-browser/README.md), [§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] Ghi audit trail: ai duyệt, thời điểm, `Allow once` hay `Allow for tab`, callID; không ghi expression thô hoặc token.
- [ ] Ghi remediation khi gặp `POLICY_DENIED`/`APPROVAL_TIMEOUT` theo [§8.2.4](../../docs/specs/kilo-browser/03-protocol-mcp.md).
- [ ] Ghi cảnh báo rằng eval vẫn có thể gây side effect trong trang; approval chỉ giảm thiểu, không sandbox OS ([§8.4.3](../../docs/specs/kilo-browser/07-security-jail.md)).

## Acceptance (Given/When/Then)

| ID | Given | When | Then |
|---|---|---|---|
| AC-10 | `tools.eval` là `deny` | Gọi `browser_eval` | Trả `-32006 kind:POLICY_DENIED`, không có CDP eval nào chạy |
| AC-11 | `tools.eval` là `ask`, người dùng duyệt | Gọi `browser_eval {expression:"document.title"}` | Trả `value:"Login"`, có bản ghi approval trong log |

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test ./test/unit/guard-eval.test.ts
bun test ./test/integration/eval-gate.test.ts
bun run build
bun run build:extension
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `src/plugin/eval.ts` | Quyết định deny/ask/allow, fail-closed |
| `extension/src/tools/eval.ts` | Isolated world, serialize, cap 64 KB |
| `extension/src/approval/**` | Approval path tối thiểu cho AC-11 ở M2 (handoff cho US-09 ở W4) |
| `src/config/schema.ts` | Thêm/khóa eval key (handoff từ US-01) |
| `src/plugin/kilo-browser-guard.ts` | Nối hook eval vào plugin (handoff từ US-05) |
| `test/unit/guard-eval.test.ts` | Truth table policy/approval |
| `test/integration/eval-gate.test.ts` | AC-10, AC-11, timeout, không frame khi deny |

## Definition of Done

- [ ] `browser_eval` mặc định deny và không có frame CDP eval nào khi deny.
- [ ] AC-10 và AC-11 xanh; log có bản ghi approval cho AC-11.
- [ ] Approval timeout 60 giây trả `-32001` và không retry.
- [ ] Eval chỉ chạy trong isolated world; kết quả không serialize được trả `-32602 INVALID_PARAMS`.
- [ ] Cap 64 KB có truncate + artifact; không lộ secret trong preview/log.
- [ ] Typecheck, build CLI và build extension sạch.

## Ghi chú & rủi ro

- [§10.4](../../docs/specs/kilo-browser/03-protocol-mcp.md) đặt `APPROVAL_TIMEOUT` dưới `-32001` cùng `UNAUTHORIZED`; US này theo taxonomy đã chuẩn hóa ở spec 0.2.1.
- [§19](../../docs/specs/kilo-browser/10-delivery.md) đưa AC-11 vào gate M2 (minimal approval path). US này sở hữu `extension/src/approval/**` tối thiểu cho AC-11; panel/approval đầy đủ là US-09 ở M3.
- `src/plugin/kilo-browser-guard.ts` do US-05 sở hữu (handoff cho US-04 để nối hook eval); `src/plugin/eval.ts` do US này sở hữu. Không sửa hai file cùng lúc ngoài phần hook eval.
- Eval không có OS sandbox; đây là công cụ thoát hiểm có duyệt, không phải môi trường an toàn cho code lạ ([§8.4.3](../../docs/specs/kilo-browser/07-security-jail.md)).
- Approval UI thuộc US-09/US-10; US này xác nhận gate + approval contract bằng unit/integration, không sở hữu side panel.

---

[← Trước: US-03](./US-03-interact.md) · [Tiếp: US-05](./US-05-jail.md)
