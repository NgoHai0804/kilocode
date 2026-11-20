# US-00: Spike CDP end-to-end (M0)

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: — (bắt đầu) · Sau: [US-01](./US-01-bridge-pairing.md)

| Trường | Giá trị |
|---|---|
| ID | US-00 |
| Persona | Solo dev (kỹ sư triển khai Kilo Browser) |
| Giá trị | Chứng minh CDP + localhost + snapshot/click trước khi đầu tư bridge/extension, và chốt protocol 1.0 bằng bằng chứng đo được |
| Spec | [§19](../../docs/specs/kilo-browser/10-delivery.md) · [§7.4](../../docs/specs/kilo-browser/01-architecture.md) · [§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md) · [§10.1](../../docs/specs/kilo-browser/03-protocol-mcp.md) |
| Phụ thuộc | Không |
| Mốc | M0 (1–2 ngày) — [§19](../../docs/specs/kilo-browser/10-delivery.md) |
| Ước lượng | 1–2 ngày |
| AC | Không sở hữu AC-xx trong §18; gate là demo M0 ở §19 |

**Câu chuyện:** Là solo dev, tôi muốn chạy một vòng CDP thật với `chrome-devtools-mcp` + `kilo serve` trên fixture có lỗi cố ý, để biết dự án go hay no-go trước khi viết sản phẩm.

## Bối cảnh

[§7.4](../../docs/specs/kilo-browser/01-architecture.md) chốt `chrome-devtools-mcp` chỉ dùng cho M0: nó không có jail, không có redaction theo policy của Kilo, không kiểm soát origin, không ghép được permission/ask. [§19](../../docs/specs/kilo-browser/10-delivery.md) đặt M0 là 1–2 ngày, với gate "Demo navigate → snapshot → click trên fixture; ghi lại protocol notes". [§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md) mô tả fixture app có form login, nút Save lỗi cố ý, API 500 lần đầu và console error.

Spike phải trả lời bốn câu trước M1: (1) CDP có chạy ổn trên Chrome/Edge >= 116 không (A1, [§6](../../docs/specs/kilo-browser/README.md)); (2) snapshot/click có đủ cho debug loop không ([§11](../../docs/specs/kilo-browser/05-tools-loop.md)); (3) chi phí token/latency so với success metrics thế nào ([§4.2](../../docs/specs/kilo-browser/README.md)); (4) ý tưởng permission/jail có khả thi không ([§8.1.2](../../docs/specs/kilo-browser/02-bridge.md), [§8.4](../../docs/specs/kilo-browser/07-security-jail.md)).

Không viết code sản phẩm trong US này. Fixture notes thuộc US-00; code fixture hoàn thiện ở US-10 sau handoff.

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Fixture notes, cấu hình MCP cho spike, đo token/latency, protocol decisions, go/no-go | Bridge, extension, shim, guard, jail implementation, CI/E2E harness, sửa spec |

## Checklist

### Hợp đồng & dữ liệu

- [ ] Ghi `test/fixture/app/NOTES.md` mô tả `/login`, nút Save lỗi cố ý, `/api/save` trả 500 lần đầu và console error, khớp [§17.3](../../docs/specs/kilo-browser/09-testing-acceptance.md); không viết code sản phẩm.
- [ ] Chốt kịch bản spike thành một dãy có thể lặp lại: navigate → snapshot → console → network → click → reload, đúng gate [§19](../../docs/specs/kilo-browser/10-delivery.md).
- [ ] Ghi protocol decisions cho WS framing: JSON-RPC 2.0 text frame, một message mỗi frame, không batch, `id` giữ nguyên khi response ([§10.1](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Ghi protocol decisions cho ref scheme: `eN` theo thứ tự snapshot, gắn `snapshotId`/generation, ref cũ trả `-32004 STALE_REF` ([§8.3.4](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Ghi protocol decisions cho attach lifetime: `chrome.debugger.attach({tabId}, "1.3")`, detach khi tab đóng/`onDetach`, xóa ref và trả `-32003` cho call kế tiếp ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Ghi protocol decisions cho token/pairing: token 32 byte hex, `pairCode` 6 số TTL 120 giây, 5 lần sai lockout 60 giây ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Liệt kê từng khoảng trống của `chrome-devtools-mcp` so với bridge planned: jail, redaction, origin allowlist, permission/ask, artifact ([§7.4](../../docs/specs/kilo-browser/01-architecture.md)).

### Implementation

- [ ] Cấu hình MCP `chrome-devtools-mcp` trong `.kilo/kilo.json` của workspace spike (không commit secret) và chạy `kilo serve`; xác nhận tool list xuất hiện trong session.
- [ ] Navigate fixture `/login`; lưu snapshot text, console, network; ghi số byte và thời gian mỗi call vào biên bản.
- [ ] Click nút Save bằng ref; xác nhận bug tái hiện; reload và lặp lại đúng thao tác để chứng minh tính lặp lại.
- [ ] Đo token/latency: snapshot bytes, screenshot bytes, p50 mỗi tool; so trực tiếp với ngưỡng success metrics [§4.2](../../docs/specs/kilo-browser/README.md).
- [ ] Thử ý tưởng jail: đặt `permission.external_directory: "deny"` và chạy `git rev-parse --is-inside-work-tree`; ghi kết quả trong repo git và ngoài git ([§8.1.2](../../docs/specs/kilo-browser/02-bridge.md) mục 10).
- [ ] Mở DevTools trên tab rồi thử attach; ghi nhận hành vi xung đột và thông báo cần thiết ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md), A8).
- [ ] Chạy lại kịch bản trên Chrome/Edge >= 116 (A1) và trên Windows cộng một OS khác nếu có; ghi khác biệt.

### Test

- [ ] Demo 5 phút có bằng chứng: screenshot/artifact + console/network + trạng thái sau click, khớp success metric [§4.2](../../docs/specs/kilo-browser/README.md).
- [ ] Ghi pass/fail cho từng tiêu chí go/no-go; không đánh giá bằng cảm tính và không đổi tiêu chí giữa chừng.

### Tài liệu & vận hành

- [ ] Viết `test/fixture/app/SPIKE.md` gồm setup, lệnh đã chạy, kết quả, token/latency, protocol decisions.
- [ ] Ghi no-go criteria rõ: snapshot quá lớn/không ổn định, click không tái lập, attach fail, latency vượt ngưỡng, hoặc không chứng minh được localhost.
- [ ] Ghi quyết định go/no-go và việc cần đổi ở spec trước M1; không sửa spec trong US này.

## Acceptance (Given/When/Then)

US-00 không sở hữu AC nào trong [§18](../../docs/specs/kilo-browser/09-testing-acceptance.md). Gate M0 lấy nguyên văn từ [§19](../../docs/specs/kilo-browser/10-delivery.md):

| Mốc | Deliverable | Verification gate |
|---|---|---|
| M0 | Spike `chrome-devtools-mcp` + `kilo serve` trên fixture; chứng minh CDP + localhost + snapshot/click | Demo navigate → snapshot → click trên fixture; ghi lại protocol notes |

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/e2e   # chỉ khi harness §17.3 đã có; nếu chưa, dùng demo tay theo §19
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `test/fixture/app/NOTES.md` | Ghi chú fixture: route `/login`, bug Save, `/api/save` 500, console error; không code |
| `test/fixture/app/SPIKE.md` | Biên bản spike: lệnh, kết quả, token/latency, protocol decisions, go/no-go |

`test/fixture/app/**` thuộc US-00 và handoff cho US-10 ở W5.

## Definition of Done

- [ ] Biên bản có bằng chứng navigate/snapshot/console/network/click trên fixture.
- [ ] Có số đo token/latency và so sánh với [§4.2](../../docs/specs/kilo-browser/README.md).
- [ ] Có kết luận cho bốn protocol decisions: WS framing, ref scheme, attach lifetime, token TTL.
- [ ] Có kết quả thử `external_directory: deny` + git preflight, kèm giới hạn đã biết.
- [ ] Go/no-go được ghi rõ; không thêm code sản phẩm và không sửa spec.

## Ghi chú & rủi ro

- `chrome-devtools-mcp` thiếu jail/redaction/origin/permission ([§7.4](../../docs/specs/kilo-browser/01-architecture.md)); chỉ dùng để học CDP, không sao chép protocol của nó.
- Workspace không phải git làm `external_directory` yếu hơn vì worktree = `/` ([§8.1.2](../../docs/specs/kilo-browser/02-bridge.md) mục 10); biên bản phải nêu rõ.
- DevTools đang mở làm attach thất bại (A8, [§8.3.3](../../docs/specs/kilo-browser/04-extension.md)); đây là failure mode phải thấy trong spike.
- Số đo token/latency có thể đề xuất đổi cap, nhưng không chốt cap mới khi chưa có dữ liệu từ ít nhất hai lần chạy.

---

[← Trước: —](./plan.md) · [Tiếp: US-01](./US-01-bridge-pairing.md)
