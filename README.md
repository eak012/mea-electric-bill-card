# MEA Electric Bill Card (Type 1.2) ⚡

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/default)
[![version](https://img.shields.io/badge/version-1.4.0-blue.svg)](https://github.com/eak012/mea-electric-bill-card)

Custom Lovelace Card สำหรับ **Home Assistant** ใช้คำนวณและประมาณการค่าไฟฟ้าของการฟ้านครหลวง (**MEA**) ประเภท **1.2 (อัตราปกติ ปริมาณการใช้ > 150 หน่วย/เดือน)** คำนวณแบบอัตราก้าวหน้า (Progressive Rate) พร้อมรองรับการนำหน่วยไฟฟ้าจาก **Solar Cell** มาหักลบ และกำหนดวัน-เวลาตัดรอบบิลได้ตรงตามการจดมิเตอร์จริง

---
## 🌟 ฟีเจอร์เด่น (Key Features)

* **คำนวณตามโครงสร้างราคา MEA ประเภท 1.2 สองขั้นบันได:**
  * **หน่วยที่ 1 - 150:** 3.2484 บาท/หน่วย
  * **หน่วยที่ 151 - 400:** 4.2218 บาท/หน่วย
  * **หน่วยที่ 401 เป็นต้นไป:** 4.4217 บาท/หน่วย
* **ระบบหักลบพลังงานจาก Solar Cell:** มีช่องใส่ Sensor แยกเพื่อนำหน่วยไฟที่ผลิตได้จาก Solar Cell มาลบออกจากหน่วยไฟรวมก่อนนำไปคำนวณค่าไฟ
* **กำหนดวันและเวลาตัดรอบบิล (Bill Cutoff Day & Time):** ระบุวันที่และเวลาที่เจ้าหน้าที่มาจดมิเตอร์จริงได้ (เช่น วันที่ 24 เวลา 09:00 น.)
* **ปุ่มสลับช่วงเวลาการดูยอด (Time Period Switcher):** กดดูยอดสรุปและค่าไฟได้ 4 ช่วงเวลา: `Day`, `Week`, `Month`, และ `Bill Cycle`
* **ปรับเปลี่ยนค่าบริการและค่า Ft ได้ง่าย:** สามารถระบุค่าบริการรายเดือน (ค่าเริ่มต้น 24.62 บาท) และค่า Ft ประจำงวดผ่านหน้า UI Config ได้ทันที
* **คำนวณภาษีมูลค่าเพิ่ม (VAT 7%):** คำนวณเบ็ดเสร็จรวมค่าพลังงานไฟฟ้า ค่าบริการ ค่า Ft และ VAT 7%

---

## 📸 การแสดงผลบนการ์ด (Card View)

การ์ดจะแสดงกล่องสรุปพลังงานไฟฟ้าก่อนคิดเงินอย่างชัดเจน:
* **พลังงานไฟฟ้าที่ใช้ทั้งหมด (kWh):** ดึงจาก Sensor มิเตอร์ไฟรวม
* **พลังงานจาก Solar Cell (kWh):** ดึงจาก Sensor โซลาร์เซลล์
* **หน่วยไฟฟ้าคงเหลือคิดเงิน (kWh):** ผลลัพธ์จากการนำมาลบกัน
* **รายการประมาณการค่าไฟ:** แสดงแยกรายละเอียด ค่าพลังงานไฟฟ้า, ค่าบริการรายเดือน, ค่า Ft และ VAT 7%
<img width="340" height="398" alt="Screenshot 2569-08-13 at 10 15 42" src="https://github.com/user-attachments/assets/03c4ea7d-fe87-4de8-b871-a52dc668c006" />

---

## 🛠️ วิธีการติดตั้งผ่าน HACS (Installation)

### ติดตั้งแบบ Custom Repository

1. เปิด **Home Assistant** -> ไปที่เมนู **HACS**
2. เลือกหมวด **Frontend** (หรือ Dashboards)
3. กดจุด 3 จุดมุมขวาบน (`⋮`) -> เลือก **Custom repositories**
4. ในช่อง **Repository** ให้ใส่ URL:
   ```text
   https://github.com/eak012/mea-electric-bill-card
5. ในช่อง Type เลือกเป็น Dashboard (หรือ Plugin)

6. กด ADD จากนั้นค้นหาการ์ด MEA Electric Bill Card แล้วกด INSTALL

7. ทำการ Reload หน้าเว็บเบราว์เซอร์ 1 ครั้ง (Ctrl + F5 หรือ Cmd + Shift + R)

⚙️ วิธีการตั้งค่าใช้งาน (Configuration)

คุณสามารถเพิ่มการ์ดและตั้งค่าผ่าน Visual Editor บนหน้า Dashboard ได้โดยตรง หรือตั้งค่าผ่าน YAML Code ได้ดังนี้:

## ตัวอย่างการตั้งค่าผ่าน YAML
```yaml
type: custom:mea-electric-bill-card
name: ค่าไฟฟ้า MEA (บ้าน)
cutoff_day: 24
cutoff_time: "09:00"
default_period: cycle
entity_total: sensor.grid_energy_total
entity_solar: sensor.solar_energy_total
service_charge: 24.62
ft_baht: 0.3972
vat: 7
```
<img width="1012" height="637" alt="Screenshot 2569-08-13 at 10 16 27" src="https://github.com/user-attachments/assets/27dda557-5aea-48a4-b85e-a037ef99f48d" />

| ตัวแปร | ชนิดข้อมูล | จำเป็น | ค่าเริ่มต้น | คำอธิบาย |
| :--- | :---: | :---: | :---: | :--- |
| `name` | string | ไม่บังคับ | `MEA Electric Bill` | ชื่อหัวข้อที่จะแสดงบนการ์ด |
| `entity_total` | string | **จำเป็น** | - | Entity ID ของ Sensor ที่วัดหน่วยใช้ไฟรวมสะสม (`cumulative kWh`) |
| `entity_solar` | string | ไม่บังคับ | - | Entity ID ของ Sensor ที่วัดหน่วยไฟ Solar Cell สะสม (`cumulative kWh`) |
| `cutoff_day` | number | ไม่บังคับ | `24` | วันที่ตัดรอบบิลของมิเตอร์ (1 - 31) |
| `cutoff_time` | string | ไม่บังคับ | `09:00` | เวลาตัดรอบบิล รูปแบบ `HH:MM` |
| `default_period` | string | ไม่บังคับ | `cycle` | มุมมองเริ่มต้นเมื่อเปิดการ์ด (`day`, `week`, `month`, `cycle`) |
| `service_charge` | number | ไม่บังคับ | `24.62` | ค่าบริการรายเดือน (บาท/เดือน) |
| `ft_baht` | number | ไม่บังคับ | `0.3972` | อัตราค่า Ft ประจำงวด (บาท/หน่วย) |
| `vat` | number | ไม่บังคับ | `7` | อัตราภาษีมูลค่าเพิ่ม (%) |

---

## 🙏 Credits & Acknowledgments

โปรเจกต์นี้ได้รับการพัฒนาต่อยอดและรับแรงบันดาลใจมาจาก [hass-mea-electric-bill](https://github.com/pakkardkaw/hass-mea-electric-bill) โดยคุณ [pakkardkaw](https://github.com/pakkardkaw) ขอขอบคุณแนวคิดและโครงสร้างโค้ดตั้งต้นที่นำมาพัฒนาต่อเพื่อเพิ่มระบบหักลบพลังงาน Solar Cell และการตั้งเวลาตัดรอบบิลครับ

📄 License
This project is open-source and available under the [MIT License.](https://gemini.google.com/u/3/LICENSE)
