# US-05: Jail đường dẫn bốn lớp

> Một phần của [Kilo Browser Agent delivery plan](./plan.md) · Trước: [US-04](./US-04-eval-gate.md) · Sau: [US-06](./US-06-memory.md)

| Trường | Giá trị |
|---|---|
| ID | US-05 |
| Persona | Solo dev |
| Giá trị | Mọi đường dẫn đọc/ghi của agent bị giới hạn trong workspace bằng bốn lớp kiểm tra, fail-closed, có log; hai workspace không lẫn artifact, memory hoặc log |
| Spec | [§8.4](../../docs/specs/kilo-browser/07-security-jail.md) · [§12](../../docs/specs/kilo-browser/07-security-jail.md) · [§13.1](../../docs/specs/kilo-browser/08-config-observability.md) · [§17.4](../../docs/specs/kilo-browser/09-testing-acceptance.md) |
| Phụ thuộc | US-01 |
| Mốc | M2 — [§19](../../docs/specs/kilo-browser/10-delivery.md) |
| Ước lượng | 3–4 ngày |
| AC | AC-13, AC-14, AC-19 |

**Câu chuyện:** Là solo dev, tôi muốn bridge và guard chặn mọi đường dẫn thoát khỏi workspace, kể cả symlink và UNC trên Windows, để agent không thể ghi artifact hay đọc file ngoài phạm vi dự án.

## Bối cảnh

Jail của Kilo Browser là kiểm soát logic, không phải sandbox OS; trên Windows không có OS-level read jail (A9, [§6](../../docs/specs/kilo-browser/README.md)). Vì vậy phải có bốn lớp ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md), [§12.1](../../docs/specs/kilo-browser/07-security-jail.md)):

1. Schema/config và origin policy từ chối giá trị nguy hiểm (`*`, scheme lạ).
2. Bridge resolve + realpath mọi đường dẫn trước khi đọc/ghi artifact.
3. Guard plugin `tool.execute.before` kiểm tra lại `output.args` trước permission check.
4. Guard quét `bash` best-effort cho redirect/ghi file, biết rõ đây không phải sandbox.

Quy tắc đường dẫn nằm ở [§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md); artifact chỉ được ghi trong `.kilo/kilo-browser/artifacts/`, tên do bridge sinh, không nhận từ model ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md), [§8.5](../../docs/specs/kilo-browser/06-workspace-memory.md)). Fail-closed: realpath lỗi thì deny, không fallback sang allow ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md), [§12.1](../../docs/specs/kilo-browser/07-security-jail.md)).

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Bốn lớp jail, realpath, Windows drive/UNC/case, artifact path, guard path rules, bash best-effort, workspace isolation | OS sandbox/ACL nâng cao, redaction nội dung (US-08), origin allowlist (US-01), eval gate (US-04) |

## Checklist

### Hợp đồng & dữ liệu

- [ ] Ghi rõ bốn lớp và thứ tự thực thi trong tài liệu package, khớp [§8.4](../../docs/specs/kilo-browser/07-security-jail.md) và [§12.1](../../docs/specs/kilo-browser/07-security-jail.md); mỗi lớp có test riêng.
- [ ] Đường dẫn tương đối resolve từ `workspace`, không từ cwd của Kilo ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] `..` được chuẩn hóa trước khi so sánh; thoát root thì deny, kể cả khi path chưa tồn tại ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Windows drive: so sánh sau `path.win32.resolve`, lowercase cả hai; `C:` và `c:` tương đương; drive-relative `C:foo` bị resolve và deny nếu ra ngoài root ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] UNC: `\\server\share\...` chỉ hợp lệ nếu root cũng là UNC cùng share; share khác hoặc host khác bị deny ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Symlink: `realpath` cả root và target; target chưa tồn tại thì `realpath` parent gần nhất; symlink loop hoặc realpath lỗi thì deny ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Case-insensitive: Windows lowercase; macOS giữ nguyên nhưng so sánh không phân biệt hoa thường theo filesystem; Linux phân biệt hoa thường ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Artifact chỉ ghi trong `.kilo/kilo-browser/artifacts/`; tên `NNN-<tool>-<8hex>.<ext>` do bridge sinh; model không được truyền path artifact ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md), [§14.2](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Artifact cap 2 MB và retention 7 ngày; dọn theo tuổi khi bridge start; không tự xóa `MEMORY.md` hoặc `sessions/` ([§13.1](../../docs/specs/kilo-browser/08-config-observability.md), [§12.6](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Fail-closed: mọi lỗi resolve/realpath/không xác định đều deny; không có nhánh "allow khi không chắc" ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md), A9).
- [ ] `jail.deny` ghi `path`, `root`, `resolved` và không ghi nội dung file ([§14.1](../../docs/specs/kilo-browser/08-config-observability.md)).

### Implementation

- [ ] `src/policy/jail.ts` export `resolve(root, target)`, `assertInside(root, resolved)` và `artifactPath(sessionID, seq, tool, hash, ext)`; tất cả trả kết quả thuần túy, không đọc file ngoài realpath.
- [ ] `src/plugin/paths.ts` export `assertOriginAllowed`, `assertNoFileUrl`, `assertArtifactPathInsideJail`; gọi `src/policy/jail.ts` thay vì tự viết lại logic ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Guard `tool.execute.before` trong `src/plugin/kilo-browser-guard.ts` (US-05 sở hữu file; handoff cho US-04 phần hook eval) gọi `src/plugin/paths.ts` cho browser tool; tool không phải browser thì bỏ qua, không ảnh hưởng bash/read/edit ([§8.4](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Từ chối `file:`, `chrome:`, `devtools:`, `edge:`, `javascript:`, `data:` (trừ `about:blank` do extension tự tạo) ([§12.3](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Bash best-effort: quét `output.args.command` cho `>`, `>>`, `tee`, `cp`, `mv`, `rm`, `curl -o`, `wget -O`, `Out-File`, `Set-Content`; deny absolute path ra ngoài jail ([§8.4.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Ghi rõ bash scan có thể bị lách bằng biến, obfuscation hoặc interpreter; không tuyên bố đây là sandbox ([§8.4.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Workspace isolation: mọi state nằm dưới `${workspace}/.kilo/kilo-browser/`; `extraRoots` chỉ nhận giá trị khai báo tường minh; schema từ chối `*` ([§13.1](../../docs/specs/kilo-browser/08-config-observability.md), [§12.3](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Không chạm file ngoài `.kilo/` khi generate config; `runtime.json` mode `0600` và bị xóa khi shutdown ([§13.5](../../docs/specs/kilo-browser/08-config-observability.md), [§12.2](../../docs/specs/kilo-browser/07-security-jail.md)).
- [ ] Artifact cleanup chỉ xóa file khớp naming và nằm trong `artifacts/`; không xóa theo prefix do model cung cấp ([§12.6](../../docs/specs/kilo-browser/07-security-jail.md)).

### Test

- [ ] AC-13: gọi tool ghi artifact với `../../etc/passwd` (hoặc `C:\Windows`) trả `jail.deny`; không file nào được ghi ngoài workspace.
- [ ] AC-14: tạo symlink trong workspace trỏ ra ngoài, ghi artifact qua symlink bị deny sau realpath; log có `resolved`.
- [ ] AC-19: chạy hai bridge/session trên hai workspace khác nhau với hai tab khác nhau; không artifact, memory hoặc log nào lẫn giữa hai workspace.
- [ ] Unit matrix [§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md): `..` thoát root, absolute ngoài root, `C:\` vs `c:\`, `C:foo`, UNC, symlink ra ngoài, symlink loop, path chưa tồn tại (realpath parent), macOS case-insensitive.
- [ ] Test fail-closed: giả lập realpath lỗi `ENOENT`/`EACCES`/loop; kết quả là deny và có `jail.deny`, không phải allow.
- [ ] Test bash scan: mỗi mẫu `>`, `tee`, `cp`, `Out-File`, `Set-Content` ra absolute path ngoài jail bị deny; mẫu obfuscation được ghi là bypass đã biết, không silent pass.
- [ ] E2E [§17.4](../../docs/specs/kilo-browser/09-testing-acceptance.md): trên Windows thử junction/UNC nếu môi trường hỗ trợ; trên macOS/Linux thử symlink; nếu không hỗ trợ thì skip kèm lý do rõ, không silent pass.

### Tài liệu & vận hành

- [ ] Viết threat model ngắn: tài sản, tác nhân, kiểm soát và điều guard không bắt được, đối chiếu [§8.4.3](../../docs/specs/kilo-browser/07-security-jail.md) và [§12.1](../../docs/specs/kilo-browser/07-security-jail.md).
- [ ] Ghi chú Windows: không có OS read jail (A9), junction/UNC/case là rủi ro cao, `windowsHide: true` chỉ liên quan spawn chứ không phải jail ([§20](../../docs/specs/kilo-browser/11-risks-open-questions.md), [§8.1.4](../../docs/specs/kilo-browser/02-bridge.md)).
- [ ] Ghi remediation khi `jail.deny`: dùng path trong workspace hoặc khai báo `extraRoots` có chủ đích ([§13.1](../../docs/specs/kilo-browser/08-config-observability.md)).
- [ ] Ghi rõ `jail.deny` thấp bất thường kèm file lạ là early-warning signal ([§20](../../docs/specs/kilo-browser/11-risks-open-questions.md)).

## Acceptance (Given/When/Then)

| ID | Given | When | Then |
|---|---|---|---|
| AC-13 | Đường dẫn `../../etc/passwd` (hoặc `C:\Windows`) | Gọi tool ghi artifact với path đó | `jail.deny`, không file nào được ghi ngoài workspace |
| AC-14 | Symlink trong workspace trỏ ra ngoài | Ghi artifact qua symlink | Bị deny sau realpath; log có `resolved` |
| AC-19 | Hai workspace khác nhau, hai tab khác nhau | Chạy hai bridge/session | Không có artifact, memory hoặc log nào lẫn giữa hai workspace |

## Verify

```bash
# Từ packages/kilo-browser/
bun run typecheck
bun test ./test/unit/jail/paths.test.ts
bun test ./test/unit/jail/guard.test.ts
bun run build
bun test ./test/e2e/jail/jail.test.ts
```

## Files dự kiến

| Đường dẫn | Thay đổi |
|---|---|
| `src/policy/jail.ts` | Resolve/realpath, assert inside, artifact path, fail-closed |
| `src/policy/origin.ts` | Allowlist origin và deny scheme [§12.3](../../docs/specs/kilo-browser/07-security-jail.md) |
| `src/plugin/paths.ts` | `assertOriginAllowed`, `assertNoFileUrl`, `assertArtifactPathInsideJail`, bash scan |
| `src/plugin/kilo-browser-guard.ts` | Entry plugin; hook gọi `src/plugin/paths.ts` (handoff cho US-04 phần eval) |
| `test/unit/jail/paths.test.ts` | Matrix [§17.1](../../docs/specs/kilo-browser/09-testing-acceptance.md): `..`, drive, UNC, symlink, case, realpath lỗi |
| `test/unit/jail/guard.test.ts` | Guard before hook, scheme deny, bash scan |
| `test/e2e/jail/jail.test.ts` | AC-13, AC-14, AC-19; Windows junction/UNC skip có lý do |

## Definition of Done

- [ ] Bốn lớp đều có test chứng minh deny; không lớp nào chỉ dựa vào lớp khác.
- [ ] AC-13, AC-14, AC-19 xanh; AC-14 có `resolved` trong log.
- [ ] Không có file nào bị ghi ngoài workspace trong toàn bộ test.
- [ ] Fail-closed khi realpath lỗi; không có nhánh allow khi không chắc.
- [ ] Unit matrix chạy trên Windows, macOS, Linux hoặc skip có lý do rõ.
- [ ] Typecheck và build sạch.

## Ghi chú & rủi ro

- [§15](../../docs/specs/kilo-browser/10-delivery.md) và plan §4 chốt `src/policy/{jail,origin}.ts`; US này theo đúng layout đó.
- macOS case-insensitive nhưng vẫn giữ nguyên chữ hoa/thường khi hiển thị; test phải so sánh theo filesystem, không chỉ lowercase chuỗi ([§8.4.1](../../docs/specs/kilo-browser/07-security-jail.md)).
- Không có OS read jail trên Windows (A9); guard chỉ giảm thiểu, không thay thế sandbox của OS ([§8.4.3](../../docs/specs/kilo-browser/07-security-jail.md)).
- `extraRoots` là mở rộng có chủ đích, không phải cách lách khi gặp `jail.deny`; mọi mở rộng phải được khai báo và review.
- Hai workspace có thể dùng chung Chrome profile; test AC-19 phải tách tab và thư mục dữ liệu, không chỉ tách tên session.

---

[← Trước: US-04](./US-04-eval-gate.md) · [Tiếp: US-06](./US-06-memory.md)
