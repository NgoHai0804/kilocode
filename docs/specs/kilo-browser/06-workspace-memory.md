# Workspace và memory

> Thuộc [Kilo Browser Agent spec](./README.md) · Phần này chứa §8.5.

### 8.5 Workspace và memory

```text
<workspace>/
  .kilo/
    kilo.json                     # generated: permission, plugin, mcp
    kilo-browser.json             # user config (mục 13)
    plugins/
      kilo-browser-guard.ts
    kilo-browser/
      AGENTS.md                 # injected via instructions
      MEMORY.md
      sessions/
        <sessionID>.md
      artifacts/
        <sessionID>/
          <seq>-<tool>-<hash>.png
          <seq>-<tool>-<hash>.json
      logs/
        bridge.jsonl
        shim.jsonl
      runtime.json                # 0600, gitignored
      bridge.lock
```

`AGENTS.md` nằm tại `.kilo/kilo-browser/AGENTS.md` và được inject qua key `instructions` trong `.kilo/kilo.json`; không đặt ở project root và không ghi đè root `AGENTS.md` của người dùng. Kilo chỉ auto-discover các file tên `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` đi ngược từ project directory lên worktree, nên file lồng trong `.kilo/kilo-browser/` không được nạp nếu không khai báo; entry trong `config.instructions` được resolve tương đối bằng `globUp` (`packages/opencode/src/session/instruction.ts:74-78,165-180`).

`AGENTS.md` tại `.kilo/kilo-browser/AGENTS.md` (template, tiếng Việt ngắn gọn):

```markdown
# Browser workflow
- Quan sát trước khi sửa: browser_status, browser_console, browser_network, browser_snapshot.
- Mỗi iteration chỉ một giả thuyết; ghi rõ bằng chứng.
- Sau khi sửa: browser_reload + lặp lại thao tác + snapshot/console để xác minh.
- Không tuyên bố "đã sửa" nếu không có artifact mới chứng minh.
- Không dùng browser_eval khi snapshot đủ; eval phải được người dùng duyệt.
- Ghi bài học vào MEMORY.md; không ghi secret, cookie, token.
- Dừng và hỏi khi gặp POLICY_DENIED hoặc 2 lần tool lỗi liên tiếp.
```

`MEMORY.md` (template):

```markdown
# Memory
## App
- URL local: http://localhost:3000
- URL staging: https://staging.example.com (cần đăng nhập, không lưu mật khẩu)
## Selectors bền
- Login form: form[data-testid="login"]
## Bẫy đã gặp
- 2026-11-19: nút Save disable 300ms sau submit; phải wait_for text "Saved".
## Bài học
- Console error "hydration mismatch" xuất hiện khi SSR và client lệch locale.
```

`sessions/<sessionID>.md` (template):

```markdown
# Session <sessionID>
- Ngày: 2026-11-19
- Mục tiêu: <triệu chứng người dùng mô tả>
- URL: <url bắt đầu>
- Bước: <tool + kết quả chính>
- Artifact: <đường dẫn tương đối>
- Kết luận: <nguyên nhân, cách sửa, bằng chứng>
- Trạng thái: open | fixed | blocked
```

Artifact naming `NNN-<tool>-<8hex>.<ext>`, retention mặc định 7 ngày, xóa theo tuổi khi bridge start; `MEMORY.md` và `sessions/` không tự xóa.

---

[← Previous: Tool reference và debug loop](./05-tools-loop.md) · [Next: Guard plugin và bảo mật](./07-security-jail.md)
