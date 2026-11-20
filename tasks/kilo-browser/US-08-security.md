# US-08: Bảo mật token, origin và redaction
> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-07](./US-07-resilience.md) · Sau: [US-09](./US-09-ux.md)

| Trường | Giá trị |
|---|---|
| ID | US-08 |
| Persona | Người dùng debug ứng dụng có dữ liệu đăng nhập thật |
| Giá trị | Token và secret không rò vào model, log hay artifact; quyền bị thu hồi nhanh khi cần |
| Spec | [§8.1.5](../../docs/specs/kilo-browser/02-bridge.md) · [§8.3.6](../../docs/specs/kilo-browser/04-extension.md) · [§12](../../docs/specs/kilo-browser/07-security-jail.md) · [§12.5](../../docs/specs/kilo-browser/07-security-jail.md) · [§14.1](../../docs/specs/kilo-browser/08-config-observability.md) |
| Phụ thuộc | US-01 |
| Mốc | M2–M3; pairing/token từ M1 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 2 ngày |
| AC | AC-17 |

**Câu chuyện:** Là người dùng debug ứng dụng có dữ liệu đăng nhập thật, tôi muốn token và secret được cô lập, redact trước khi ra khỏi bridge, và thu hồi được ngay, để bằng chứng debug không trở thành đường rò rỉ.

## Bối cảnh

Mọi thứ chạy trên loopback, nhưng loopback không thay thế auth: HTTP cần Bearer token, WS cần đúng `Origin: chrome-extension://<id>`, và `--host` khác loopback bị từ chối ở preflight ([§8.1.1](../../docs/specs/kilo-browser/02-bridge.md), [§8.1.5](../../docs/specs/kilo-browser/02-bridge.md), [§12.3](../../docs/specs/kilo-browser/07-security-jail.md)). Bridge giữ Basic credential của `kilo serve`; extension và shim không bao giờ thấy credential đó ([§8.1.7](../../docs/specs/kilo-browser/02-bridge.md)).

Redaction là defense-in-depth: phải chạy trước khi trả model, trước khi ghi artifact và trước khi ghi log ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)). Token trong extension được chấp nhận là plaintext trong `chrome.storage.local`, giảm thiểu bằng vòng đời theo phiên bridge và revoke ([§8.3.6](../../docs/specs/kilo-browser/04-extension.md)).

## Phạm vi
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Pair code, token, TTL, rotate/revoke, lockout | Lưu token trong secure enclave (không có cho extension) |
| Loopback-only, WS origin, origin allowlist, scheme deny | Multi-user hay remote bridge ([§6](../../docs/specs/kilo-browser/README.md)) |
| Redaction header/query/JSON/cookie trước model, log, artifact | Chống prompt injection tuyệt đối ([§12.1](../../docs/specs/kilo-browser/07-security-jail.md)) |
| Threat-model checklist, log field, retention | OS sandbox hay read jail ([§12.1](../../docs/specs/kilo-browser/07-security-jail.md)) |

## Checklist

### Hợp đồng & dữ liệu
- [ ] `pairCode` 6 chữ số sinh từ `pairSecret`, TTL 120 giây, tối đa 5 lần sai trong 120 giây thì đóng `4004`, khóa pairing 60 giây và ghi `pair.lockout` ([§8.1.5](../../docs/specs/kilo-browser/02-bridge.md), [§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Token là 32 byte hex (64 ký tự), gắn với `extensionId`; bridge restart làm token cũ vô hiệu; cùng extension + token còn hạn thì không cấp token mới ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md), [§10.6](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Rotate/revoke bằng `kilo-browser pair --rotate`: sinh token mới, đóng WS hiện tại, token cũ bị từ chối ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md), [§8.3.9](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Không log token hay password; nếu cần debug chỉ log `sha256(token)` 8 hex đầu ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] `runtime.json` mode `0600` trên POSIX, ACL user-only best effort trên Windows, và bị xóa khi shutdown ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md), [§8.1.9](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] `--host` khác loopback bị từ chối ở preflight; HTTP chỉ bind loopback; shim từ chối `httpUrl` không phải `127.0.0.1`, `localhost`, `::1` ([§8.1.1](../../docs/specs/kilo-browser/02-bridge.md), [§8.2.3](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] WS `Origin` phải đúng `chrome-extension://<allowedExtensionId>`; ID khác bị đóng `4004`; HTTP bắt Bearer cho mọi route trừ `GET /health` ([§8.1.5](../../docs/specs/kilo-browser/02-bridge.md), [§8.1.6](../../docs/specs/kilo-browser/02-bridge.md), [§12.3](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Navigation mặc định chỉ `http://localhost:*` và `http://127.0.0.1:*`; từ chối `file:`, `chrome:`, `devtools:`, `edge:`, `javascript:`, `data:`; schema từ chối `*` ([§12.3](../../docs/specs/kilo-browser/07-security-jail.md), [§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `chrome.storage.local` không chứa password Kilo, cookie, hay Basic credential; chỉ chứa các key của schema §8.3.6 ([§8.3.6](../../docs/specs/kilo-browser/04-extension.md), [§12.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Redaction che đúng 6 header canonical `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, `x-auth-token`; giá trị `Bearer`, JWT ba phần, `sk-`, `ghp_`, `gho_`, `AKIA`, `AIza` ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Redaction che đúng 5 query param `token`, `access_token`, `key`, `secret`, `password`; JSON field cùng tên; cookie chỉ giữ tên; URL path được giữ nguyên ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Xác minh redact trước khi trả model (guard `tool.execute.after` do US-05 sở hữu), trước khi ghi artifact/log, và trong preview UI khi `redactInUi` bật ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md), [§12.5](../../docs/specs/kilo-browser/07-security-jail.md), [§8.3.6](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `redact.hit` ghi `location`, `pattern`, `count`; không ghi giá trị gốc ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Retention: log `10 MB x 3` file, artifact 7 ngày, runtime token xóa khi shutdown, buffer console/network xóa khi đổi tab hoặc đóng trình duyệt ([§12.6](../../docs/specs/kilo-browser/07-security-jail.md)).

### Implementation
- [ ] Xác minh token issue/verify/rotate theo state machine pairing §8.3.9 trong `src/bridge/lifecycle.ts` (US-01; handoff US-07) bằng test; US-08 không sở hữu file và không lưu token dạng thô trong log ([§8.3.9](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] `src/policy/redact.ts` là hàm thuần, thay bằng `[REDACTED]`, giữ tối đa 8 ký tự, không phá text không nhạy cảm ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Dùng matcher `src/policy/origin.ts` của US-05; thêm test cho allowlist, scheme deny và wildcard ([§12.3](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Xác minh middleware Bearer trong `src/bridge/http.ts` (US-01): mọi route trừ `/health` trả `-32001` khi thiếu/sai token ([§8.1.6](../../docs/specs/kilo-browser/02-bridge.md), [§10.4](../../docs/specs/kilo-browser/03-protocol-mcp.md)).
- [ ] Xác minh artifact writer (US-02) gọi `redact()` của US-08 trước khi ghi; tên do bridge sinh `NNN-<tool>-<8hex>.<ext>`, không nhận từ model ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md), [§14.2](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Xác minh `kilo-browser export` (US-01, `src/cli.ts`) tạo `runtime.redacted.json` không token; zip không chứa password hay cookie value ([§14.2](../../docs/specs/kilo-browser/08-config-observability.md)).

### Test
- [ ] `bun test test/unit/redact/redact.test.ts` phủ 8 vùng của §17.1: header, Bearer/JWT/`sk-`/`ghp_`/`AKIA`, query, JSON field, cookie chỉ tên, false positive ([§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] `bun test test/unit/redact/token.test.ts` phủ TTL, 5 lần sai, lockout 60 giây, rotate, restart invalidates token ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] `bun test test/integration/secret-scan.test.ts`: fake response chứa `Authorization: Bearer abc123` và cookie; kết quả chỉ có `[REDACTED]`, log/artifact không chứa `abc123`; đây là AC-17 ([§17.2](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Test storage: serialize `chrome.storage.local` sau pair và grep không thấy `password`, `cookie`, hay Basic credential ([§8.3.6](../../docs/specs/kilo-browser/04-extension.md)).
- [ ] Test origin: `chrome-extension://kilotest` chỉ được thêm khi chạy test; ID khác bị từ chối; `file://` và `chrome://` bị deny ([§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Quét artifact/log sinh bởi manual loop: không token, password, cookie value ([§17.5](../../docs/specs/kilo-browser/09-testing-acceptance.md)).

### Tài liệu & vận hành
- [ ] Threat-model checklist 7 dòng của §12.1, mỗi dòng ghi control và test tương ứng ([§12.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Runbook rotate/revoke, cách đọc `redact.hit`, và retention của log/artifact ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md), [§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Ghi schema log §14.1 và quy ước log token hash 8 hex ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md), [§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).

## Acceptance (Given/When/Then)

### AC-17
- **Given:** Console/network chứa `Bearer abc123` và cookie
- **When:** Gọi tool tương ứng
- **Then:** Kết quả và artifact chỉ có `[REDACTED]`, log không chứa `abc123`

## Verify
```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/unit/redact/redact.test.ts
bun test test/unit/redact/token.test.ts
bun test test/integration/secret-scan.test.ts
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `src/policy/redact.ts` | Mới: header/query/JSON/cookie redaction |
| `src/log/jsonl.ts` | Mới: JSONL writer + rotation 10 MB x 3 |
| `test/unit/redact/redact.test.ts` | Mới |
| `test/unit/redact/token.test.ts` | Mới |
| `test/integration/secret-scan.test.ts` | Mới: AC-17 |

## Definition of Done
- [ ] AC-17 xanh, gồm cả quét log và artifact.
- [ ] Token không xuất hiện trong log; chỉ hash 8 hex khi cần debug.
- [ ] Pair code TTL/lockout/rotate có test.
- [ ] Loopback, WS origin, navigation origin/scheme có test.
- [ ] Storage extension không chứa password/cookie; có test.
- [ ] Threat-model checklist đủ 7 dòng của §12.1.
- [ ] Retention log/artifact/runtime khớp §12.6.

## Ghi chú & rủi ro
- Spec §12.2 quy định `pairCode` TTL **120 giây** và lockout **60 giây**; US này theo spec, không dùng TTL 60 giây cho pairing.
- Spec không định nghĩa TTL riêng cho token; token sống theo phiên bridge và chết khi restart ([§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- Token nằm plaintext trong `chrome.storage.local` là rủi ro được chấp nhận, giảm thiểu bằng revoke và vòng đời bridge ([§8.3.6](../../docs/specs/kilo-browser/04-extension.md)).
- `src/policy/redact.ts` và `test/unit/redact/**` thuộc US-08 theo §15 và plan §4; US-02/US-04 chỉ gọi lại, không sở hữu file.
- Token lifecycle nằm trong `src/bridge/lifecycle.ts` (US-01, handoff US-07); US-08 chỉ test/harden qua test, không nhận ownership file. Phối hợp US-02 (artifact/log) và US-05 (jail) là coordination, không phải phụ thuộc cứng.

---

[← Trước: US-07: Độ bền kết nối](./US-07-resilience.md) · [Sau: US-09: UX](./US-09-ux.md)