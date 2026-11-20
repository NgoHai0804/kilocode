# US-03: Tool tương tác (interact)

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-02](./US-02-observe.md) · Sau: [US-04](./US-04-eval-gate.md)

| Trường | Giá trị |
|---|---|
| ID | US-03 |
| Persona | Solo dev |
| Giá trị | Agent bấm, gõ, nhấn phím, reload và chờ trạng thái trên tab thật, để chuỗi debug "quan sát → sửa → reload → xác minh" chạy được |
| Spec | [§9](../../docs/specs/kilo-browser/05-tools-loop.md) · [§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md) · [§8.3.4](../../docs/specs/kilo-browser/04-extension.md) · [§10.5–10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md) |
| Phụ thuộc | US-02 |
| Mốc | M2 — [§19](../../docs/specs/kilo-browser/10-delivery.md) |
| Ước lượng | 3–4 ngày |
| AC | AC-09, AC-12 |

**Câu chuyện:** Là solo dev, tôi muốn agent thao tác được trên tab đang mở bằng ref ổn định và hành vi tuần tự, để nó tái hiện đúng thao tác gây lỗi và xác minh sau khi sửa.

## Bối cảnh

Năm tool tương tác của M2 là `click`, `type`, `press`, `reload`, `wait_for`, dùng method bridge `browser.click`, `browser.type`, `browser.press`, `browser.reload`, `browser.wait_for` ([§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md)). Chúng nhận `ref` hoặc `selector`; nếu cả hai có thì `ref` thắng ([§8.3.4](../../docs/specs/kilo-browser/04-extension.md)). Ref chỉ sống trong `snapshotId` hiện tại; snapshot mới tăng generation và ref cũ trả `-32004 STALE_REF` ([§8.3.4](../../docs/specs/kilo-browser/04-extension.md), [§5](../../docs/specs/kilo-browser/README.md)).

Mọi tool chạy tuần tự trên một tab, không song song; call thứ hai xếp hàng tối đa 5 giây rồi trả `-32005` kind `BUSY` ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§10.5](../../docs/specs/kilo-browser/03-protocol-mcp.md)). Các tool có side effect không bao giờ retry tự động ([§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Năm tool tương tác, `Input` domain, ref TTL, focus, tọa độ, hàng đợi tuần tự, idempotency cache | Sáu tool đọc (US-02), eval/approval (US-04), jail (US-05), memory (US-06), multi-tab (non-goal [§4.3](../../docs/specs/kilo-browser/README.md)) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] Năm tool đăng ký đúng tên trần và method [§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md): `click` → `browser.click`, `type` → `browser.type`, `press` → `browser.press`, `reload` → `browser.reload`, `wait_for` → `browser.wait_for`.
- [ ] Validate params theo schema [§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md); thiếu field hoặc sai kiểu trả `-32602 INVALID_PARAMS` với tên field, không chạy CDP.
- [ ] Không retry tự động cho cả năm tool; `requestId` được cache 60 giây và request trùng `requestId` trả kết quả cũ thay vì chạy lại ([§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Hàng đợi tuần tự: một tool tại một thời điểm; call thứ hai chờ tối đa 5 giây rồi `-32005` kind `BUSY` ([§10.5](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Ref cũ sau snapshot mới trả `-32004 STALE_REF` kèm `snapshotId`, `retryable`, `remediation`; không gửi input event ([§8.3.4](../../docs/specs/kilo-browser/04-extension.md), [§10.3](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] `click` nhận `ref` hoặc `selector`; nếu cả hai có, `ref` thắng và `selector` bị bỏ qua; chỉ một ref hoặc một selector mỗi call ([§8.3.4](../../docs/specs/kilo-browser/04-extension.md), [§9](../../docs/specs/kilo-browser/05-tools-loop.md)).

### Implementation

- [ ] `click`: resolve ref/selector, `DOM.getBoxModel`, cuộn vào viewport, lấy tâm box, `Input.dispatchMouseEvent` `mousePressed` rồi `mouseReleased` với `button`/`clickCount`; trả `{clicked, ref?, url}` ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `type`: focus element, `clear` bằng chọn toàn bộ rồi Backspace, gõ bằng `Input.dispatchKeyEvent`, `submit` nhấn Enter; trả `{typed, submitted}` ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `type` từ chối text > 4000 ký tự bằng `-32602` trước khi gửi CDP ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] `press`: validate key/hợp lệ, focus `ref` nếu có, gửi `keyDown`/`keyUp`; không có focus thì `-32003 NO_TARGET`, trả `{pressed, url}` ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] `reload`: gọi `Page.reload` với `ignoreCache`, chờ `waitUntil`, trả `{url, status, durationMs}`; navigation bị chặn là `-32006 POLICY_DENIED` ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] `wait_for`: hỗ trợ `text`, `selector`, `urlIncludes`, `state`, `timeoutMs`; poll trong timeout, trả `{matched, elapsedMs, url}`; không có điều kiện là `-32602` ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§10.2](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Focus handling: xác định `document.activeElement` sau click/focus; phần tử readonly/disabled trả `-32003 NO_TARGET`; không gửi nửa chuỗi sự kiện rồi báo thành công ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] Tọa độ lấy theo viewport, tính device pixel ratio; phần tử ngoài viewport được cuộn vào trước khi click; phần tử bị che trả `-32003 NO_TARGET` chứ không click mù ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Element detached giữa call trả `-32003 NO_TARGET`; không tự retry và không báo `clicked:true` khi CDP lỗi ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Kiểm tra origin/scheme trước `click`/`type`/`press`/`reload`; `file:`, `chrome:`, `devtools:`, `javascript:`, `data:` bị deny theo [§12.3](../../docs/specs/kilo-browser/07-security-jail.md).
- [ ] Mỗi kết quả mutation cung cấp đủ dữ liệu cho progress hash: `url`, trạng thái phần tử, thời điểm; không thêm hash vào result nếu spec không yêu cầu ([§11.2](../../docs/specs/kilo-browser/05-tools-loop.md)).

### Test

- [ ] AC-09: từ ref `e7`, chạy lần lượt `browser_click`, `browser_type`, `browser_press`, `browser_reload`, `browser_wait_for`; mỗi call trả đúng schema và chuỗi xong trong <= 30 giây.
- [ ] AC-12: snapshot cũ, tạo snapshot mới, dùng ref cũ cho `browser_click`; trả `-32004 STALE_REF` và không có click nào chạy.
- [ ] Unit cho từng tool: schema, cap 4000 ký tự, key không hợp lệ, `wait_for` thiếu điều kiện, `click` có cả ref và selector.
- [ ] Integration fake extension: call thứ hai trong lúc call đầu chạy bị xếp hàng; quá 5 giây trả `-32005` kind `BUSY`; request trùng `requestId` không tạo CDP event thứ hai.
- [ ] Test không retry: giả lập CDP lỗi cho `click`/`type`/`press`/`reload`; số lần gửi lại là 0 ([§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] E2E với extension thật: chuỗi AC-09 trên fixture trong <= 30 giây; AC-12 không làm thay đổi DOM sau khi báo stale.

### Tài liệu & vận hành

- [ ] Ghi JSONL `tool.start`/`tool.end` cho năm tool với `tool`, `paramsHash`, `ok`, `durationMs`; không ghi text nhập hoặc nội dung nhạy cảm ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md), [§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Ghi `loop.stop` kind `REPEATED_ACTION`/`NO_PROGRESS` khi action hash lặp hoặc progress hash không đổi, dùng tín hiệu từ tool mutation ([§11.3](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] Viết bảng params/return/failure mode cho năm tool, đối chiếu [§9](../../docs/specs/kilo-browser/05-tools-loop.md); nêu rõ `ref` thắng `selector`.
- [ ] Ghi hành vi `BUSY`, `STALE_REF`, `NO_TARGET` vào troubleshooting của package, kèm remediation đã có trong [§8.2.4](../../docs/specs/kilo-browser/03-protocol-mcp.md).

## Acceptance (Given/When/Then)

| ID | Given | When | Then |
|---|---|---|---|
| AC-09 | Có ref `e7` từ snapshot | Gọi lần lượt `browser_click`, `browser_type`, `browser_press`, `browser_reload`, `browser_wait_for` | Mỗi call trả result đúng schema; chuỗi hoàn tất trong <= 30 giây |
| AC-12 | Snapshot cũ, sau đó có snapshot mới | Dùng ref cũ cho `browser_click` | Trả `-32004 STALE_REF`, không click |

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test ./test/unit/tools-interact.test.ts
bun test ./test/integration/interact.test.ts
bun run build:extension
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `extension/src/tools/click.ts` | `browser.click`: ref/selector, box model, chuột |
| `extension/src/tools/type.ts` | `browser.type`: focus, clear, submit, cap 4000 |
| `extension/src/tools/press.ts` | `browser.press`: validate key, keyDown/keyUp |
| `extension/src/tools/reload.ts` | `browser.reload`: `Page.reload`, `waitUntil` |
| `extension/src/tools/wait_for.ts` | `browser.wait_for`: text/selector/url/state |
| `extension/src/cdp/domains/input.ts` | `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, tọa độ |
| `extension/src/rpc/queue.ts` | Hàng đợi một tool, timeout 5 giây, `BUSY` |
| `test/unit/tools-interact.test.ts` | Schema, cap, key, wait condition, stale ref |
| `test/integration/interact.test.ts` | Queue, idempotency, không retry |

## Definition of Done

- [ ] Năm tool tương tác chạy qua shim → bridge → extension → CDP trên fixture.
- [ ] AC-09 xanh trong <= 30 giây; AC-12 trả `-32004` và không click.
- [ ] Không tool nào retry tự động; `requestId` trùng trả kết quả cũ trong 60 giây.
- [ ] Call thứ hai không chạy song song; quá 5 giây trả `BUSY`.
- [ ] Typecheck, build extension và test unit/integration sạch.

## Ghi chú & rủi ro

- Tọa độ và device pixel ratio là nguồn lỗi phổ biến trên Windows scale 125%/150%; test phải chạy ở ít nhất hai tỉ lệ.
- `type` dùng sự kiện bàn phím nên có thể khác `Input.insertText` ở trình soạn thảo phức tạp; nếu phát hiện, ghi failure mode thay vì thêm retry.
- `wait_for` là tool idempotent duy nhất trong nhóm và được retry tự động tối đa 1 lần ([§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)); bốn tool còn lại thì không.
- Approval cho password-field và origin lạ thuộc [§8.3.10](../../docs/specs/kilo-browser/04-extension.md); US này không tự thêm modal.
- `extension/src/refs/registry.ts` handoff từ US-02; US này dùng lại, không sở hữu file.

- E2E Chrome thật thuộc US-10/M3; US này xác nhận AC-09/AC-12 bằng integration + unit.

---

[← Trước: US-02](./US-02-observe.md) · [Tiếp: US-04](./US-04-eval-gate.md)
