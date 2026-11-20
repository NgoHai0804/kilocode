# Guard plugin và bảo mật

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §8.4 và §12.

### 8.4 Guard plugin (Kilo)

Plugin được sinh tại `.kilo/plugins/kilo-browser-guard.ts` và nạp qua `plugin` config. Nó chạy trong tiến trình Kilo, trước permission check của tool, nên có thể ép `ask` và chặn sớm.

```ts
// pseudocode, không phải implementation
// permission key và input.tool đều là tên đã namespace: "browser_eval", "browser_click", ...
"permission.ask": (input, output) => {
  if (input.permission === "browser_eval" && policy.eval === "ask") output.status = "ask"
  if (input.permission === "browser_navigate" && !allowedOrigin(input.patterns)) output.status = "deny"
}
"tool.execute.before": (input, output) => {
  // input.tool là tên MCP đã namespace, ví dụ "browser_click" (session/tools.ts:492-496)
  if (!isBrowserTool(input.tool)) return
  assertOriginAllowed(output.args)      // navigate/type/click target
  assertNoFileUrl(output.args)          // file://, chrome://, devtools://
  assertArtifactPathInsideJail(output.args)
}
"tool.execute.after": (input, output) => {
  if (isBrowserTool(input.tool)) output.output = redact(output.output)
}
```

`input.tool` của `"tool.execute.before"`/`"tool.execute.after"` và `input.permission` của `"permission.ask"` đều là tên đã namespace; guard không dùng tên trần.

#### 8.4.1 Quy tắc đường dẫn

| Trường hợp | Quy tắc |
|---|---|
| Tương đối | Resolve từ `workspace`, không từ cwd của Kilo |
| `..` | Chuẩn hóa trước khi so sánh; thoát root → deny |
| Windows drive | So sánh sau `path.win32.resolve`, lowercase cả hai; `C:` và `c:` tương đương |
| UNC | `\\server\share\...` chỉ hợp lệ nếu root cũng là UNC cùng share |
| Symlink | `realpath` cả root và target; nếu realpath lỗi (file chưa tồn tại) thì realpath parent gần nhất |
| Case-insensitive | Windows: lowercase; macOS: giữ nguyên nhưng so sánh case-insensitive theo filesystem; Linux: case-sensitive |
| Artifact | Chỉ ghi trong `.kilo/kilo-browser/artifacts/`; tên do bridge sinh, không nhận từ model |

#### 8.4.2 Bash best-effort

Guard quét `output.args.command` và deny nếu thấy redirect/ghi ra absolute path ngoài jail (`>`, `>>`, `tee`, `cp`, `mv`, `rm`, `curl -o`, `wget -O`, `Out-File`, `Set-Content`). Đây là best-effort: shell có thể obfuscate, dùng biến, hoặc gọi interpreter. Không thay thế OS sandbox (vốn chỉ write-only và không có trên Windows).

#### 8.4.3 Điều guard không bắt được

- Tool call đi thẳng tới bridge HTTP, bỏ qua Kilo (người dùng tự gọi hoặc MCP khác).
- Đọc secret bằng `read`/`bash` ngoài phạm vi browser (Kilo `read` không có OS jail).
- Trang web tự gửi dữ liệu ra ngoài bằng fetch của chính nó.
- Extension bị compromise hoặc người dùng cấp `<all_urls>` rồi duyệt origin độc hại.
- Model bị prompt injection và gọi `browser_type` vào form không mong muốn; approval + origin allowlist chỉ giảm thiểu.

## 12. Bảo mật

### 12.1 Tài sản, tác nhân, mối đe dọa

| Tài sản | Tác nhân | Mối đe dọa | Kiểm soát |
|---|---|---|---|
| Bridge token | Trang web độc hại | Đọc token từ DOM/localStorage | Token không bao giờ vào page context; extension isolated world; eval tắt mặc định |
| Workspace files | Workspace độc hại | Config bật `eval:allow`, `allowedOrigins:*` | Schema chặn `*`; cảnh báo config thay đổi; bridge không tin config từ git mà không xác nhận lần đầu |
| Session dữ liệu | Extension bị compromise | Gửi dữ liệu ra ngoài | Origin WS cố định; token TTL theo bridge; không có endpoint ra internet |
| Local process khác | Process cùng user | Gọi HTTP/WS trái phép | Bearer token 32 byte; loopback; file `runtime.json` 0600; WS origin |
| File ngoài workspace | Model/prompt injection | `read`/`write` path escape | Jail resolve + realpath; guard plugin; artifact path do bridge sinh |
| Secret trong log/artifact | Model | Exfiltrate qua tool result | Redaction trước khi trả và trước khi ghi; cap; allowlist header |
| Nội dung trang | Trang độc hại | Prompt injection trong text DOM | Đánh dấu nội dung trang là untrusted trong prompt; không thực thi chỉ dẫn từ trang; approval cho eval, origin lạ và password-field warning |

### 12.2 Token lifecycle

- Sinh mỗi lần bridge start: `bridgeToken` 32 byte hex, `pairSecret` 32 byte, `pairCode` 6 chữ số.
- `pairCode` TTL 120 giây, tối đa 5 lần sai, lockout 60 giây.
- Token gắn với `extensionId`; bridge restart làm token cũ vô hiệu.
- Revoke: `kilo-browser pair --rotate` sinh token mới, đóng WS hiện tại.
- Token không xuất hiện trong log; nếu cần debug, log `sha256(token)[0..8]`.
- Token trong `runtime.json` bị xóa khi shutdown; file có mode `0600` (POSIX) và ACL user-only best effort (Windows).

### 12.3 Origin policy

- WS `Origin` phải khớp `chrome-extension://<allowedExtensionId>`; bridge lưu ID từ lần pair đầu tiên và từ chối ID khác cho đến khi rotate.
- HTTP không kiểm tra `Origin` (dành cho shim/test), nhưng bắt buộc Bearer và chỉ bind loopback.
- `allowedOrigins` cho navigation mặc định `http://localhost:*`, `http://127.0.0.1:*`; origin khác phải thêm thủ công hoặc dùng `optional_host_permissions`.
- Từ chối scheme `file:`, `chrome:`, `chrome-extension:`, `devtools:`, `edge:`, `javascript:`, `data:`, `blob:`, `filesystem:` (trừ `about:blank` do extension tự tạo).
- Allowlist origin rỗng nghĩa là từ chối tất cả (fail closed), không phải cho phép tất cả.
- Không dùng `*` trong `allowedOrigins`; schema từ chối.

### 12.4 CSP và quyền tối thiểu

- `extension_pages` (đúng theo `extension/manifest.json`): `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'`.
- CSP chuẩn ở §22.7; §12.4 ghi cùng giá trị.
- `'wasm-unsafe-eval'` là bắt buộc cho Shiki (tô sáng cú pháp dùng WebAssembly) trong UI đóng gói; không cấp `'unsafe-eval'` và không nạp script từ xa.
- `worker-src 'self'` giới hạn worker trong extension; `connect-src` chỉ cho phép loopback; `img-src`/`font-src` chỉ thêm `data:`/`blob:` cục bộ cho icon và font đóng gói.
- Host permissions mặc định chỉ localhost; staging phải xin qua optional permission.
- Không yêu cầu `webRequest`, `cookies`, `history`, `downloads`, `clipboardRead`.
- `chrome.debugger` hiển thị infobar; người dùng luôn biết tab đang bị điều khiển.

### 12.5 Redaction

Redact trước khi trả model và trước khi ghi artifact/log:

- Header: `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, `x-auth-token`; giữ tên header, thay value bằng `[REDACTED]`.
- Query param: `token`, `access_token`, `key`, `secret`, `password`; giữ tên param, thay value bằng `[REDACTED]`.
- Giá trị: `Bearer <token>`, `Basic <token>`, JWT ba phần, `sk-[A-Za-z0-9]{20,}`, `ghp_`, `gho_`, `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`.
- JSON field cùng tên: giữ key, thay value bằng `[REDACTED]`.
- Cookie trong network: giữ tên, thay value bằng `[REDACTED]`.
- Không redact URL path (có thể là bằng chứng), nhưng redact query value theo danh sách trên.
- Redaction sai (false negative) được ghi `redact.miss` nếu người dùng báo; không tuyên bố bảo vệ tuyệt đối.

### 12.6 Data retention

| Dữ liệu | Nơi lưu | Retention |
|---|---|---|
| Artifact | `.kilo/kilo-browser/artifacts/<sessionID>/` | 7 ngày, xóa khi start |
| Log JSONL | `.kilo/kilo-browser/logs/` | 10 MB x 3 file |
| Session notes | `.kilo/kilo-browser/sessions/` | Không tự xóa |
| Memory | `.kilo/kilo-browser/MEMORY.md` | Không tự xóa |
| Runtime token | `runtime.json` | Xóa khi shutdown |
| Console/network buffer | RAM extension | Xóa khi đổi tab hoặc đóng trình duyệt |

---

[← Previous: Workspace và memory](./06-workspace-memory.md) · [Next: Config và observability](./08-config-observability.md)
