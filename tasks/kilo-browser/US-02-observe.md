# US-02: Tool quan sát (observe)

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-01](./US-01-bridge-pairing.md) · Sau: [US-03](./US-03-interact.md)

| Trường | Giá trị |
|---|---|
| ID | US-02 |
| Persona | Solo dev |
| Giá trị | Agent thấy được DOM, console, network, screenshot và trạng thái tab của chính mình mà người dùng không phải copy dữ liệu vào chat |
| Spec | [§9](../../docs/specs/kilo-browser/05-tools-loop.md) · [§8.2](../../docs/specs/kilo-browser/03-protocol-mcp.md) · [§8.3.3–8.3.5](../../docs/specs/kilo-browser/04-extension.md) · [§12.5](../../docs/specs/kilo-browser/07-security-jail.md) |
| Phụ thuộc | US-01 |
| Mốc | M1 — [§19](../../docs/specs/kilo-browser/10-delivery.md) |
| Ước lượng | 3–4 ngày |
| AC | AC-04, AC-05, AC-06, AC-07, AC-08 |

**Câu chuyện:** Là solo dev, tôi muốn agent gọi sáu tool đọc để lấy snapshot, console, network, screenshot và trạng thái tab, để nó khoanh vùng lỗi bằng bằng chứng thay vì đoán từ source.

## Bối cảnh

Sáu tool đọc của M1 là `status`, `navigate`, `snapshot`, `screenshot`, `console`, `network` ([§19](../../docs/specs/kilo-browser/10-delivery.md)); gate M1 gồm AC-01..AC-08 ([§18](../../docs/specs/kilo-browser/09-testing-acceptance.md)). Shim đăng ký tên trần, Kilo thêm tiền tố server `browser_`, bridge nhận method `browser.*`; đăng ký `browser_status` trong shim sẽ tạo tiền tố đôi và sai ([§8.2.1](../../docs/specs/kilo-browser/03-protocol-mcp.md)).

Dữ liệu quan sát đi qua ba lớp: CDP trong extension ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)), bridge policy/redaction/artifact ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md), [§14.2](../../docs/specs/kilo-browser/08-config-observability.md)), và shim render text cho model ([§8.2.5](../../docs/specs/kilo-browser/03-protocol-mcp.md)). Ref là định danh ngắn `e1`, `e2` chỉ sống trong một `snapshotId` ([§5](../../docs/specs/kilo-browser/README.md), [§8.3.4](../../docs/specs/kilo-browser/04-extension.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Sáu tool đọc qua MCP shim (US-01 sở hữu), attach lifecycle, CDP domain đọc, ref, ring buffer, artifact writer, output cap, redaction hook (US-08) | Năm tool tương tác (US-03), eval (US-04), jail đường dẫn (US-05), memory/session template (US-06), approval modal đầy đủ (M3) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] Xác nhận shim (US-01 sở hữu `src/mcp.ts`) phục vụ đúng sáu tên trần `status`, `navigate`, `snapshot`, `screenshot`, `console`, `network`; tool list của Kilo hiển thị `browser_*` và không có tên tiền tố đôi ([§8.2.1](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Xác nhận shim (US-01, `src/mcp.ts`) đọc `runtime.json` lazy theo `mtime`, từ chối `httpUrl` không loopback, gọi `POST /tool` với Bearer, timeout tool + 2000 ms, đọc lại runtime một lần khi `401`, không retry `navigate` ([§8.2.3](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Map đủ tám lỗi [§8.2.4](../../docs/specs/kilo-browser/03-protocol-mcp.md) thành text bắt đầu bằng `[browser:<kind>]`, nêu retryable và không chứa token/password.
- [ ] Content format đúng [§8.2.5](../../docs/specs/kilo-browser/03-protocol-mcp.md): `text/plain`, JSON gọn không quá 2 cấp; screenshot trả `text` + `image` chỉ khi <= 2 MB; snapshot không trả HTML thô.
- [ ] Snapshot trả cây `role "name" [ref=eN]` kèm dòng `snapshotId=<hash>`; khi cắt thêm dòng cuối `truncated=true; X-Y/Z` ([§8.2.5](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Cap từng tool đúng [§9](../../docs/specs/kilo-browser/05-tools-loop.md): snapshot 2000 node/256 KB, console 500 entry/128 KB, network 200 request/256 KB, screenshot 2 MB sau encode.
- [ ] `browser_console` và `browser_network` hỗ trợ `level`, `filter`, `sinceSeq`, `includeBodies`, `limit`; kết quả có `dropped`, `oldestSeq` hoặc `bodyDropped` ([§8.3.5](../../docs/specs/kilo-browser/04-extension.md)).

### Implementation

- [ ] Attach lifecycle đúng [§8.3.3](../../docs/specs/kilo-browser/04-extension.md): `chrome.debugger.attach({tabId}, "1.3")`, bật domain sau attach, đăng ký `onDetach`, tab đóng thì xóa ref và trả `-32003` cho call kế tiếp.
- [ ] Lỗi `Another debugger is already attached` trả `-32006` kind `DEVTOOLS_CONFLICT` kèm text "Đóng DevTools của tab này rồi thử lại" ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Bật `Page`, `Runtime`, `Network`, `Log`, `DOM`, `Accessibility`; dùng `DOM.getDocument({depth:-1,pierce:true})` và `Accessibility.getFullAXTree` ([§8.3.3](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Sinh ref theo [§8.3.4](../../docs/specs/kilo-browser/04-extension.md): chỉ node có role/name hoặc input/button/link có `backendNodeId`, chuẩn hóa tên, hash sha256 8 hex, map `eN` sang `{backendNodeId, frameId, hash, snapshotId}`.
- [ ] Snapshot mới tăng generation; ref cũ trả `-32004 STALE_REF`; iframe cross-origin không truy cập được thì bỏ qua và ghi `skippedFrames` ([§8.3.4](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Ring buffer đúng [§8.3.5](../../docs/specs/kilo-browser/04-extension.md): console 500 x 8 KB/4 MB, network 200 x 32 KB body/6 MB, CDP event 1000 x 2 KB/2 MB, artifact metadata 200 x 1 KB/200 KB; `seq` tăng đơn điệu.
- [ ] `browser_navigate` kiểm tra origin allowlist trước khi gửi CDP, hỗ trợ `waitUntil`/`timeoutMs`, trả `{url,title,status}` và map `net::ERR_CONNECTION_REFUSED` thành `NETWORK_REFUSED` kèm remediation ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§8.1.6](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] `browser_screenshot` lưu artifact PNG/JPEG, trả `artifactId`, `width`, `height`, `bytes`; file tồn tại và mở được; vượt 2 MB thì chỉ trả text + path ([§9](../../docs/specs/kilo-browser/05-tools-loop.md), [§8.2.5](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] `browser_console` lọc theo `level`/`sinceSeq`; `browser_network` lọc theo `filter`, validate regex, trả body đã redact khi `includeBodies:true` ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] Redact trước khi trả model và trước khi ghi artifact/log: header nhạy cảm, Bearer/JWT/`sk-`/`ghp_`/`AKIA`/`AIza`, query param và JSON field theo tên, cookie chỉ giữ tên ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Ghi event `redact.hit` với `location`, `pattern`, `count`; không ghi giá trị bị redact ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Artifact naming `NNN-<tool>-<8hex>.<ext>`, `8hex` là hash params đã redact; screenshot PNG/JPEG, snapshot/console/network JSON; retention 7 ngày và dọn khi start ([§14.2](../../docs/specs/kilo-browser/08-config-observability.md), [§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)).
- [ ] Kết quả text > 256 KB bị truncate, thêm `truncated=true` và artifact path; không streaming kết quả ([§10.5](../../docs/specs/kilo-browser/03-protocol-mcp.md)).

### Test

- [ ] AC-04: từ `about:blank`, `browser_navigate` tới fixture `/login` trả `status:200`, `title:"Login"`, URL khớp.
- [ ] AC-05: `browser_snapshot` trả `snapshotId`, >= 3 refs, text chứa `button "Save"`, không có HTML thô.
- [ ] AC-06: `browser_screenshot` tạo PNG <= 2 MB, trả `artifactId`; test mở file và kiểm tra magic bytes PNG.
- [ ] AC-07: fixture phát console error; `browser_console {level:"error"}` trả entry có `seq`, `text` chứa lỗi, `dropped` là số.
- [ ] AC-08: fixture trả 500 cho `/api/save`; `browser_network {filter:"/api/save"}` trả `status:500`, `durationMs` là số, body đã redact.
- [ ] Unit refs: ref ổn định trong một snapshot, stale sau snapshot mới, node biến mất, iframe cross-origin bị skip ([§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Unit buffers: ghi đè đúng, `dropped`/`bodyDropped` tăng, body truncate, `sinceSeq` lọc đúng ([§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Unit redaction: header, Bearer/JWT/`sk-`/`ghp_`/`AKIA`, query param, JSON field, cookie chỉ giữ tên; false positive không phá text ([§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Integration fake extension: sáu method forward đúng params/result và giữ `id`; `browser_navigate` không bị retry tự động ([§8.2.3](../../docs/specs/kilo-browser/03-protocol-mcp.md), [§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).

### Tài liệu & vận hành

- [ ] Ghi JSONL `tool.start`/`tool.end` với `tool`, `paramsHash`, `ok`, `truncated`; `rpc.request`/`rpc.response`/`rpc.error`; `redact.hit` ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Ghi `metrics.snapshot` mỗi 60 giây khi `log.level=debug` với `tool.p50Ms`, `tool.p95Ms`, `snapshot.nodes`, `screenshot.bytes` ([§14.3](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Viết bảng params/return/cap/failure mode cho sáu tool, đối chiếu [§9](../../docs/specs/kilo-browser/05-tools-loop.md); không thêm tool thứ bảy.

## Acceptance (Given/When/Then)

| ID | Given | When | Then |
|---|---|---|---|
| AC-04 | Tab ở `about:blank` | Gọi `browser_navigate` tới fixture `/login` | Trả `status:200`, `title:"Login"`, URL khớp |
| AC-05 | Trang `/login` đã load | Gọi `browser_snapshot` | Trả `snapshotId`, >= 3 refs, text chứa `button "Save"`, không có HTML thô |
| AC-06 | Trang `/login` | Gọi `browser_screenshot` | Tạo artifact PNG <= 2 MB, trả `artifactId`, file tồn tại và mở được |
| AC-07 | Fixture phát console error | Gọi `browser_console {level:"error"}` | Trả entry có `seq`, `text` chứa lỗi, `dropped` là số |
| AC-08 | Fixture trả 500 cho `/api/save` | Gọi `browser_network {filter:"/api/save"}` | Trả request `status:500`, `durationMs` là số, body đã redact |

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test ./test/unit/refs.test.ts
bun test ./test/unit/buffers.test.ts
bun test ./test/integration/observe.test.ts
bun run build
bun run build:extension
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `src/artifacts/store.ts` | Ghi artifact, cap, retention, path từ bridge |
| `src/artifacts/naming.ts` | `NNN-<tool>-<8hex>.<ext>` + params hash đã redact |
| `extension/src/cdp/session.ts` | Attach/detach, `onDetach`, map tab (handoff cho US-07) |
| `extension/src/cdp/domains/page.ts` | `Page.navigate`, `Page.reload`, `Page.getFrameTree` |
| `extension/src/cdp/domains/runtime.ts` | `Runtime.evaluate`, console, exception |
| `extension/src/cdp/domains/network.ts` | Request/response/failure, body 32 KB |
| `extension/src/cdp/domains/dom.ts` | `DOM.getDocument`, `DOM.resolveNode`, AX tree |
| `extension/src/cdp/domains/log.ts` | `Log.entryAdded` |
| `extension/src/tools/status.ts` | `browser.status` |
| `extension/src/tools/navigate.ts` | `browser.navigate` |
| `extension/src/tools/snapshot.ts` | `browser.snapshot` |
| `extension/src/tools/screenshot.ts` | `browser.screenshot` |
| `extension/src/tools/console.ts` | `browser.console` |
| `extension/src/tools/network.ts` | `browser.network` |
| `extension/src/refs/registry.ts` | Sinh ref, map backendNodeId, generation, TTL (handoff cho US-03) |
| `extension/src/buffers/ring.ts` | Ring buffer console/network/event |
| `test/unit/refs.test.ts` | Ref ổn định/stale/iframe skip |
| `test/unit/buffers.test.ts` | Overwrite, dropped, `sinceSeq` |
| `test/integration/observe.test.ts` | AC-04..AC-08 với fake extension |

## Definition of Done

- [ ] Sáu tool đọc chạy end-to-end qua shim → bridge → extension → CDP trên fixture.
- [ ] AC-04, AC-05, AC-06, AC-07, AC-08 xanh bằng test tự động.
- [ ] Snapshot không trả HTML thô; screenshot > 2 MB chỉ trả text + artifact path.
- [ ] Không có secret trong output trả model, artifact hoặc JSONL; `redact.hit` xuất hiện khi có mẫu secret.
- [ ] Cap/truncate được kiểm chứng bằng test với dữ liệu vượt ngưỡng.
- [ ] Typecheck, build CLI và build extension sạch.

## Ghi chú & rủi ro

- `browser_navigate` nằm trong nhóm "6 tool đọc" của M1 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) dù nó thay đổi URL; test vẫn phải tuân [§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md): không retry tự động.
- Redaction là defense-in-depth, không tuyệt đối; false negative phải ghi `redact.miss` khi người dùng báo ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- Screenshot của tab background có thể lỗi render; trả `-32003 NO_TARGET` thay vì ảnh rỗng ([§9](../../docs/specs/kilo-browser/05-tools-loop.md)).
- Jail thuộc US-05 tại `src/policy/jail.ts`; redaction thuộc US-08 tại `src/policy/redact.ts`. US này chỉ gọi lại, không sở hữu hai file đó.
- `src/policy/origin.ts` thuộc US-05; US này chỉ gọi lại, không sửa.

- E2E Chrome thật thuộc US-10/M3; US này xác nhận AC-04..AC-08 bằng integration với fixture và artifact unit.

---

[← Trước: US-01](./US-01-bridge-pairing.md) · [Tiếp: US-03](./US-03-interact.md)
