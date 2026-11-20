# US-06: Workspace memory và session notes
> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-05](./US-05-jail.md) · Sau: [US-07](./US-07-resilience.md)

| Trường | Giá trị |
|---|---|
| ID | US-06 |
| Persona | Lập trình viên frontend quay lại workspace sau nhiều ngày |
| Giá trị | Agent mở session mới vẫn biết URL, selector bền và bẫy đã gặp, không phải dạy lại từ đầu |
| Spec | [§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md) · [§11.4](../../docs/specs/kilo-browser/05-tools-loop.md) · [§13.1](../../docs/specs/kilo-browser/08-config-observability.md) · [§13.2](../../docs/specs/kilo-browser/08-config-observability.md) · [§13.5](../../docs/specs/kilo-browser/08-config-observability.md) |
| Phụ thuộc | US-01 |
| Mốc | M2 ([§19](../../docs/specs/kilo-browser/10-delivery.md)) |
| Ước lượng | 2 ngày |
| AC | AC-18 |

**Câu chuyện:** Là lập trình viên frontend quay lại workspace sau nhiều ngày, tôi muốn agent tự đọc memory và ghi session note, để không phải nhắc lại URL, selector và bẫy đã gặp ở mỗi session.

## Bối cảnh

`AGENTS.md` nằm tại `.kilo/kilo-browser/AGENTS.md`, không phải project root, và chỉ được nạp khi khai báo trong `instructions` vì Kilo không auto-discover file lồng ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md), [§13.2](../../docs/specs/kilo-browser/08-config-observability.md)). Bridge sinh template khi thiếu nhưng không được ghi đè file người dùng đã sửa ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).

`MEMORY.md` giữ bài học dài hạn; `sessions/<sessionID>.md` giữ bằng chứng của từng turn. Artifact hết hạn sau 7 ngày, còn memory và session notes không tự xóa ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md), [§12.6](../../docs/specs/kilo-browser/07-security-jail.md)).

## Phạm vi
| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Seed `AGENTS.md`, `MEMORY.md`, `sessions/<id>.md`; inject qua `instructions` | Đồng bộ memory lên cloud ([§4.3](../../docs/specs/kilo-browser/README.md)) |
| Ghi session note sau turn, redact trước khi ghi | Sửa `AGENTS.md` gốc của project |
| Retention artifact 7 ngày, giữ memory/sessions | Tự commit git sau khi sửa ([§4.3](../../docs/specs/kilo-browser/README.md)) |

## Checklist

### Hợp đồng & dữ liệu
- [ ] Chốt layout `.kilo/kilo-browser/{AGENTS.md,MEMORY.md,sessions/<sessionID>.md}` đúng §8.5; unit test assert mọi đường dẫn resolve dưới `workspace` ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)).
- [ ] Template `AGENTS.md` chứa đủ 7 quy tắc của §8.5: quan sát trước khi sửa, một giả thuyết mỗi iteration, reload rồi lặp thao tác, không tuyên bố "đã sửa" khi thiếu artifact, eval phải được duyệt, không ghi secret, dừng khi `POLICY_DENIED` ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md), [§11.4](../../docs/specs/kilo-browser/05-tools-loop.md)).
- [ ] Template `MEMORY.md` có đúng 4 mục App / Selectors bền / Bẫy đã gặp / Bài học; snapshot test so từng dòng ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)).
- [ ] Template `sessions/<id>.md` có đủ Ngày, Mục tiêu, URL, Bước, Artifact, Kết luận, Trạng thái `open | fixed | blocked` ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)).
- [ ] Xác nhận `.kilo/kilo.json` do US-01 generate chứa `.kilo/kilo-browser/AGENTS.md` trong `instructions` đúng một lần và giữ nguyên entry người dùng; thêm test diff JSON ([§13.2](../../docs/specs/kilo-browser/08-config-observability.md), [§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Schema `memory` nhận `enabled`, `injectBytes`, `sessionLog` đúng §13.1; sai kiểu bị từ chối ([§13.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Retention xóa artifact cũ hơn 7 ngày tính từ mtime khi bridge start; `MEMORY.md` và `sessions/` không bị xóa ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md), [§12.6](../../docs/specs/kilo-browser/07-security-jail.md)).

### Implementation
- [ ] `src/bridge/memory.ts` export `ensureTemplates()` tạo file từ `src/templates/` chỉ khi thiếu; file đã có giữ nguyên byte-for-byte ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Bridge gọi `ensureTemplates()` trước bước generate config và trước khi spawn `kilo serve`, để turn đầu đã thấy instruction ([§8.1.3](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] `writeNote(sessionID, turn)` tạo `sessions/<sessionID>.md` sau `session.turn.close`, ghi trạng thái `open | fixed | blocked`, không ghi đè file đã có ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md), [§8.1.8](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Nội dung note lấy từ tool result/artifact của turn và chạy qua redaction trước khi ghi; không chứa token, cookie, password ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] `instructions` dùng đường dẫn tương đối `.kilo/kilo-browser/AGENTS.md` để `globUp` resolve từ project directory ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)).
- [ ] Khi `AGENTS.md` hoặc `MEMORY.md` bị người dùng sửa, lần start kế tiếp không thay đổi nội dung; so hash trước/sau ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).

### Test
- [ ] `bun test test/unit/templates/memory.test.ts` kiểm tra snapshot 3 template và tính idempotent của `ensureTemplates()`.
- [ ] `bun test test/integration/memory.test.ts` chạy bridge + `kilo serve` thật trên workspace tạm, dùng `kilo run --attach` với canary chèn trong `AGENTS.md`; response chứa canary nghĩa là instruction đã được nạp ([§17.2](../../docs/specs/kilo-browser/09-testing-acceptance.md), [§16](../../docs/specs/kilo-browser/10-delivery.md)).
- [ ] Trong cùng test, sau `session.turn.close` file `sessions/<id>.md` tồn tại và có trạng thái hợp lệ; đây là bằng chứng cho AC-18 ([§18](../../docs/specs/kilo-browser/09-testing-acceptance.md)).
- [ ] Test restart: sửa `MEMORY.md` bằng tay, start lại bridge, hash không đổi; bridge không ghi đè ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Test secret: chèn `Authorization: Bearer abc123` vào tool result, note ghi ra chỉ có `[REDACTED]`; grep `abc123` trong note không thấy ([§12.5](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Test retention: artifact 8 ngày tuổi bị xóa, `MEMORY.md` 30 ngày tuổi còn nguyên ([§12.6](../../docs/specs/kilo-browser/07-security-jail.md)).

### Tài liệu & vận hành
- [ ] Runbook mục "Memory" ghi rõ agent đọc gì trước khi sửa, ghi gì sau turn, và file nào bridge không được chạm ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)).
- [ ] Ghi rõ `MEMORY.md` và `sessions/` là dữ liệu người dùng; bridge chỉ seed template khi thiếu ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Ghi cảnh báo nội dung trang có thể đi vào memory; redaction không thay thế đánh giá untrusted ([§12.1](../../docs/specs/kilo-browser/07-security-jail.md)).

## Acceptance (Given/When/Then)

### AC-18
- **Given:** `MEMORY.md` có nội dung
- **When:** Bắt đầu session mới trong cùng workspace
- **Then:** Agent nhận memory trong ngữ cảnh; `sessions/<id>.md` được tạo sau turn

## Verify
```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test test/unit/templates/memory.test.ts
bun test test/integration/memory.test.ts
```

## Files dự kiến
| Đường dẫn | Thay đổi |
|---|---|
| `src/bridge/memory.ts` | Mới: seed template, ghi session note, hook retention |
| `src/templates/AGENTS.md` | Mới: template §8.5 |
| `src/templates/MEMORY.md` | Mới: template §8.5 |
| `src/templates/session.md` | Mới: template §8.5 |
| `test/unit/templates/memory.test.ts` | Mới |
| `test/integration/memory.test.ts` | Mới |

## Definition of Done
- [ ] AC-18 chạy xanh trên workspace tạm với `kilo serve` thật.
- [ ] Ba template khớp §8.5 và có snapshot test.
- [ ] `AGENTS.md` được inject qua `instructions`, không đặt ở project root ([§13.2](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Restart không ghi đè file người dùng; có test hash.
- [ ] Session note không chứa secret; có test redaction.
- [ ] Retention artifact 7 ngày, memory/sessions không tự xóa; có test.

## Ghi chú & rủi ro
- `AGENTS.md` lồng trong `.kilo/kilo-browser/` không được auto-discover; thiếu entry `instructions` là lỗi im lặng ([§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)).
- Spec §13.1 có `memory.injectBytes` nhưng không định nghĩa hành vi cắt; US này chỉ validate schema, không tự đặt semantics.
- US-06 chỉ sở hữu `src/bridge/memory.ts` và `src/templates/**`; `src/bridge/sse.ts` thuộc US-01. Phối hợp với US-05 (jail) và US-08 (redaction) trong W2 là coordination, không phải phụ thuộc cứng.
- Session note phụ thuộc agent gọi tool và bridge nhận `session.turn.close`; nếu thiếu event, fallback `session.status` idle sau 2 giây ([§8.1.8](../../docs/specs/kilo-browser/02-bridge.md)).

---

[← Trước: US-05: Jail](./US-05-jail.md) · [Sau: US-07: Độ bền kết nối](./US-07-resilience.md)