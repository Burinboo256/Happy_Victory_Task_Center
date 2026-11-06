# Airtable ของ Happy Victory Rinlyn Task Center

สร้างโครงสร้างตาม [database-schema.md](database-schema.md) ใน Base เดิมเมื่อวันที่ 4 พฤศจิกายน 2026 และเปลี่ยนชื่อ Base เป็น **Happy Victory Rinlyn Task Center** แล้ว

[เปิด Base ใน Airtable](https://airtable.com/appDS1Ji5cqIohPq3)

## ตารางที่พร้อมเชื่อมต่อ

| ตาราง | Table ID | จำนวนฟิลด์ตาม schema |
|---|---|---|
| Users | `tblemecj9kN239Qkg` | 11 |
| Tasks | `tblD50c8x4jdMfFxL` | 19 |
| Task Updates | `tblzjket6kipuC6TO` | 12 |
| Follow-ups | `tblpbrXJdaMAbRiSB` | 9 |
| Notifications | `tblypoT8bDsAkjMCP` | 17 |

ตรวจ metadata ผ่าน Scripting แล้วครบ 68 ฟิลด์: ชื่อและชนิดข้อมูล ตัวเลือก Single select ลิงก์แบบรายการเดียวทั้ง 8 จุด และ Lookup ทั้ง 3 จุดตรงกับ schema สูตร Task ID / Record ID ใช้งานได้ และ Last Update ติดตามทุกฟิลด์ที่แก้ไขได้ รวมทั้งเปิดเวลาใน Created time / Last modified time แล้ว Airtable เพิ่มฟิลด์ลิงก์ย้อนกลับใน Users และ Tasks โดยอัตโนมัติ

ตารางเดิม **Table 1** (`tbl7udUt4XHNnozHl`, View `viwTYiz3IYyBwzgHH`) ยังคงอยู่และไม่ได้แก้ไข ห้ามใช้ Table ID เดิมเป็น `AIRTABLE_TASKS_TABLE` สำหรับโครงสร้างใหม่นี้

## Script Properties

นำค่าต่อไปนี้ไปตั้งใน Google Apps Script → Project Settings → Script Properties:

```text
AIRTABLE_BASE_ID = appDS1Ji5cqIohPq3
AIRTABLE_USERS_TABLE = tblemecj9kN239Qkg
AIRTABLE_TASKS_TABLE = tblD50c8x4jdMfFxL
AIRTABLE_UPDATES_TABLE = tblzjket6kipuC6TO
AIRTABLE_FOLLOWUPS_TABLE = tblpbrXJdaMAbRiSB
AIRTABLE_NOTIFICATIONS_TABLE = tblypoT8bDsAkjMCP
```

ตั้ง `AIRTABLE_TOKEN` ใน Script Properties ของโปรเจกต์ Apps Script แล้ว โดย PAT จำกัดเฉพาะ Base นี้และสิทธิ์อ่าน/เขียน records รัน `checkDeployment` จริงแล้วอ่านทั้ง 5 ตารางสำเร็จ ดู [สถานะติดตั้ง](deployment.md) ไม่วาง token ใน HTML เอกสาร หรือแชต

## ก่อนเปิดใช้งาน

- เพิ่ม Users ด้วยชื่อและอีเมลจริงของเลขาฯ 1 คนและ Agent 10 คน ตั้ง Role และ Active ให้ถูกต้อง ตรวจ User ID / Email / Google Subject ไม่ซ้ำ
- เพิ่ม Admin เจ้าของระบบ `ADMIN001` แล้ว ยังไม่ได้เพิ่มเลขาฯ / Agent หรือย้ายข้อมูลจาก Table 1 การสร้าง schema ไม่ได้อ่านหรือแก้ไข records เดิม
- ทุกตารางมี Grid view พื้นฐาน ยังไม่ได้เพิ่ม Views แนะนำแบบกรองรายการ
- ตั้ง Script Properties และทดสอบ Login / สิทธิ์สองบัญชีตามคู่มือติดตั้งก่อนเปิดแจ้งเตือน

## สคริปต์ตั้งโครงสร้าง

ใช้ [tools/setup-airtable.js](../tools/setup-airtable.js) ในส่วนขยาย Scripting ทางการของ Airtable สคริปต์จำกัด Base ID นี้ เพิ่มเฉพาะตารางและฟิลด์ที่ขาด และหยุดเมื่อพบชนิดข้อมูลหรือตัวเลือกที่ขัดแย้ง ไม่อ่านหรือเขียน records

หากใช้สร้างใหม่ ต้องตั้ง Formula, Autonumber, Created time, Last modified time, Lookup และปิด Allow linking to multiple records ผ่านหน้าจอตามรายการ Remaining UI configuration ด้วย ใน Base ปัจจุบันตั้งค่ารายการเหล่านี้ครบแล้ว
