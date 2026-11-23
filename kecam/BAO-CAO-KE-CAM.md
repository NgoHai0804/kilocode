# Báo cáo khảo sát – Extension "Ke Cam" (quan sát & quản lý nhóm quảng cáo)

Ngày khảo sát: 2026-11-22
Trang: Facebook Ads Manager – tab **Nhóm quảng cáo (Ad sets)**
URL: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=...`

> Trạng thái: **chỉ khảo sát (read-only)**. Đã tìm và mở các menu để xem cấu trúc.
> **Chưa hề bấm nút Tắt** và **chưa hề bấm switch** của bất kỳ dòng nào.

---

## 1. Mục tiêu & điều kiện tắt

Quan sát liên tục các nhóm quảng cáo **đang bật** (bỏ qua cái đã tắt), và tắt khi vi phạm:

1. Chi tiêu **> 7000** và **không ai nhắn** → tắt.
2. Chi tiêu **> 14000** và **không có 2 mes** → tắt.
3. Chi tiêu **> 20000** và **không có đơn** → tắt.

Cách tắt mong muốn (đã xác minh trên web):

1. Tick **checkbox** ở hàng nhóm quảng cáo đó.
2. Bấm **mũi tên** cạnh nút "Chỉnh sửa".
3. Chọn **"Chung"**.
4. Bấm **"Tắt"**.

**Cấm** dùng nút **Switch (công tắc Bật/Tắt)** ở cột "Tắt/Bật".

---

## 2. Cấu trúc bảng (DOM)

Bảng là grid ảo hóa (không phải `<table>`):

- Khung bảng: `div[role="table"]`
- Hàng header: `div[role="row"]` (chỉ có 1, là header)
- Mỗi hàng dữ liệu là 1 `<span>`:
  `[data-surface="/am/table/table_row:<ADSET_ID>unit"]`
- Mỗi ô dữ liệu là 1 `<span>`:
  `[data-surface="/am/table/table_row:<ADSET_ID>unit/table_cell:<KHÓA_CỘT>"]`

`<ADSET_ID>` chính là ID Meta của nhóm quảng cáo (vd `120252626769460072`).

---

## 3. Bản đồ cột (khóa ổn định trong `data-surface`)

| Cột hiển thị | Khóa ô dữ liệu (`table_cell:<...>`) |
|---|---|
| Ô chọn hàng (checkbox) | `row_selector` |
| Tắt/Bật (switch – KHÔNG bấm) | `forObjectType(toggle,CAMPAIGN)` |
| Nhóm quảng cáo | `forObjectType(name,CAMPAIGN)` |
| Phân phối (Đang hoạt động / Đang tắt) | `forObjectType(delivery,CAMPAIGN)` |
| Hành động | `recommendations_guidance` |
| Ngân sách | `forObjectType(budget,CAMPAIGN)` |
| Số tiền đã chi tiêu | `spend` |
| Bình luận về bài viết | `actions:comment` |
| Người liên hệ nhắn tin mới | `forAttributionWindowType(unique_actions:onsite_conversion.messaging_first_reply,default)` |
| Chi phí / người liên hệ nhắn tin mới | `forAttributionWindowType(cost_per_unique_action_type:onsite_conversion.messaging_first_reply,default)` |
| Lượt mua | `forAttributionWindowType(actions:omni_purchase,default)` (cần xác nhận khi cột render) |
| Chi phí / lượt mua | `forAttributionWindowType(cost_per_action_type:omni_purchase,default)` (cần xác nhận) |
| CTR (tất cả) | `ctr` |

Ngoài ra header có `id` ổn định dạng `#reporting_table_column_*` (vd `#reporting_table_column_spend`,
`#reporting_table_column_budget`, `#reporting_table_column_actions:comment`,
`#reporting_table_column_unique_actions:onsite_conversion.messaging_first_reply`).

Ví dụ selector đọc chi tiêu của 1 nhóm:

```js
const id = "120252626769460072";
const spend = document.querySelector(
  `[data-surface="/am/table/table_row:${id}unit/table_cell:spend"]`
)?.innerText; // "11,23 $"
```

---

## 4. Nhận biết nhóm đang bật hay đã tắt

Có 2 cách (đều **chỉ đọc**):

1. Cột "Phân phối": `table_cell:forObjectType(delivery,CAMPAIGN)`
   - Bật → text `Đang hoạt động`
   - Tắt → text `Đang tắt`
2. Switch: `input[role="switch"]` trong `table_cell:forObjectType(toggle,CAMPAIGN)`
   - `aria-checked="true"` = đang bật
   - **Chỉ đọc `aria-checked`, tuyệt đối không click.**

Hàng có checkbox chọn: `input[type=checkbox]` (aria-checked=true/false) nằm trong `table_cell:row_selector`.
Checkbox "chọn tất cả" ở header: `aria-label="Ô để đánh dấu chọn tất cả quảng cáo"`.

---

## 5. Luồng tắt (đã xác minh cấu trúc menu)

Nút "Chỉnh sửa" trên thanh công cụ là **split-button**:

- Nhóm: `span[data-surface="/am/table/tool_bar/lib:quick_edit_button"]`
- Phần chữ "Chỉnh sửa" (mở editor) và phần **mũi tên** là 2 nút riêng.
- **Mũi tên** = nút có `aria-haspopup="menu"` (bên trong nhóm trên). Bấm nó mở `div[role="menu"]`.

Menu chính gồm 6 mục (`role="button"`): **Chung**, Ngân sách và lịch chạy, Đối tượng, Tính minh bạch của quảng cáo, Tối ưu hóa và phân phối, Vị trí quảng cáo.

Bấm **"Chung"** → mở submenu (`role="menu"`, các mục `role="menuitem"`):

| Mục | `data-surface` |
|---|---|
| Bật | `.../lib:quick_edit_button/lib:bulk_edit_CAMPAIGN_ACTIVATE_ALL` |
| **Tắt** | `.../lib:quick_edit_button/lib:bulk_edit_CAMPAIGN_DEACTIVATE_*` (chứa `DEACTIVATE`) |
| Tên | (đổi tên) |
| Tìm và thay | (find & replace) |

→ Vậy thao tác tắt = **checkbox hàng → mũi tên "Chỉnh sửa" → "Chung" → "Tắt"**.

```js
// Gợi ý (pseudo):
const arrow = document.querySelector(
  '[data-surface="/am/table/tool_bar/lib:quick_edit_button"] [aria-haspopup="menu"]'
);
arrow.click();                              // mở menu nhóm
// bấm mục có text "Chung"
[...document.querySelectorAll('[role="menu"] [role="button"]')]
  .find(el => el.innerText.trim() === "Chung").click();
// bấm mục "Tắt"
document.querySelector('[role="menuitem"][data-surface*="DEACTIVATE"]').click();
```

Lưu ý: `id` của menuitem/menu (`js_*`) **đổi mỗi lần mở** → phải dùng `data-surface`/text, không dùng `id`.

---

## 6. Vấn đề quan trọng: ảo hóa theo chiều ngang

Bảng chỉ render các cột **nằm trong vùng nhìn**. Khi khảo sát:

- Cột `spend`, `actions:comment`, `messaging_first_reply` render (vì đang trong tầm nhìn).
- Cột **Lượt mua (`omni_purchase`) chỉ có header, KHÔNG có ô dữ liệu** → không đọc được giá trị.

Hệ quả: để đọc cột "Lượt mua", extension cần **tự cuộn ngang dải dữ liệu** để cột đó vào vùng
render, hoặc tạo **"chế độ xem" chỉ gồm các cột cần thiết** (Tên, Số tiền chi tiêu, Người liên hệ
nhắn tin mới, Lượt mua) để tất cả cùng hiển thị và render.

---

## 7. Định dạng số & tiền tệ

Giá trị hiển thị dạng `11,23 $`, `2,40 $`, `262,11 $` → **dấu phẩy là phân cách thập phân** (locale VN).
Khi parse: bỏ ký tự tiền tệ và khoảng trắng, xử lý dấu `.`/`,` theo locale.

Đơn vị hiển thị đang là **$ (USD)** trên tài khoản test này — cần xác nhận đơn vị thật của ngưỡng 7000/14000/20000.

---

## 8. Đề xuất kiến trúc extension (Manifest V3)

- `content_script` chạy trên `https://adsmanager.facebook.com/*` (tab Nhóm quảng cáo).
- Vòng lặp (setInterval/observer) mỗi N giây:
  1. Duyệt các hàng `[data-surface^="/am/table/table_row:"]`.
  2. Bỏ qua hàng đã tắt (Phân phối = "Đang tắt" / switch aria-checked=false).
  3. Đọc `spend`, cột liên hệ nhắn tin, `lượt mua` (đảm bảo cột được render).
  4. So ngưỡng → đánh dấu hàng vi phạm.
  5. Với hàng vi phạm: tick checkbox → mũi tên "Chỉnh sửa" → "Chung" → "Tắt".
  6. Tô màu ô theo ngưỡng để dễ quan sát.
- Không dùng switch `input[role="switch"]`.

---

## 9. Câu hỏi cần xác nhận (mới làm tiếp được)

Xin trả lời các điểm sau:

1. **Đơn vị ngưỡng 7000 / 14000 / 20000**: theo **VND** hay **USD** (hay theo đơn vị tiền tệ của tài khoản)? Trang đang hiện `$`.
2. **Cột nào ứng với "nhắn"/"mes"/"đơn"**:
   - "không ai nhắn" → cột **Người liên hệ nhắn tin mới** phải không? (hay **Bình luận về bài viết**?)
   - "không có 2 mes" → **Người liên hệ nhắn tin mới < 2**?
   - "không có đơn" → **Lượt mua = 0**?
3. **Sau khi bấm "Tắt"**: áp dụng **ngay** hay phải bấm thêm **Đăng/Áp dụng**? (tôi chưa bấm nên chưa rõ)
4. **Phạm vi tab**: chỉ tab **Nhóm quảng cáo (Ad sets)** hay cả **Quảng cáo (Ads)** / **Chiến dịch (Campaigns)**?
5. **Khoảng thời gian** lọc (đang là "30 ngày qua: 23/10–21/11") và ngưỡng tính theo tổng trong khoảng đó?
6. **Chu kỳ kiểm tra** mong muốn (vd 30s/1 phút) và có cần chạy nền khi tab không active không?
7. **Màu**: quy tắc tô màu cụ thể (xanh/vàng/đỏ theo mức, hay đỏ khi vi phạm)?
8. **Vị trí tạo project extension**: thư mục `D:\kilocode` là repo Kilo CLI — nên tạo project riêng ở đâu?
9. **Cột Lượt mua bị ảo hóa**: đồng ý cho extension **tự cuộn ngang** để đọc, hay tạo **chế độ xem cột tối giản**?

---

## 10. Việc đã làm / chưa làm

Đã làm (an toàn):
- Khảo sát DOM bảng, header, hàng, checkbox, switch.
- Mở menu "Chỉnh sửa" → "Chung" để xem submenu Bật/Tắt/Tên/Tìm và thay.
- Đóng menu (Escape). Không lưu thay đổi nào.

Chưa làm (chờ xác nhận):
- Chưa bấm "Tắt" (theo yêu cầu).
- Chưa xác minh hậu quả nút "Tắt" và cột "Lượt mua" sau khi render.
