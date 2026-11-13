# โครงสร้าง Airtable

ทะเบียน **เอกสารและแบบฟอร์ม** รุ่น Vercel อยู่ใน Neon แยกจาก schema Airtable นี้: `hvr_documents`, `hvr_document_versions`, `hvr_document_favorites`, `hvr_document_events` ใช้ migrations 010–011 เก็บเฉพาะ metadata/URL ไม่มีไฟล์ PDF หรือ Google Drive ในฐานข้อมูล ดู [คู่มือคลังเอกสาร](forms-library.md) และ [สถานะเปิดใช้งาน](forms-production-progress.md)

ตั้งชื่อ Base เป็น **Happy Victory Rinlyn Task Center** ใช้ Base เดิมได้ โดยสำรองข้อมูลและเพิ่มฟิลด์ตามคู่มือนี้ก่อน ตั้งชื่อฟิลด์ให้ตรงทุกตัวอักษร หรือปรับ mapping ในโค้ดก่อนใช้งาน อย่าเปลี่ยนชื่อฟิลด์เดิมที่ระบบอื่นใช้อยู่โดยไม่ตรวจผลกระทบ

PAT ใช้ scopes `data.records:read` และ `data.records:write` เฉพาะ Base นี้ ไม่ต้องให้ schema write เพื่อรันแอป ตารางและ select options ต้องมีอยู่ก่อน ตัวแอปไม่สร้าง schema อัตโนมัติ

สำหรับระบบ Vercel ใหม่ CLI `web/tools/diagnose.ts` ใช้ `AIRTABLE_SCHEMA_TOKEN` แยกที่มีเพียง `schema.bases:read` เฉพาะ Base เพื่อตรวจโครงสร้างแบบอ่านอย่างเดียว ไม่ต้องเพิ่ม schema scope ให้ PAT ที่รันแอป ไม่ใส่ token นี้ใน runtime และไม่สร้าง token จริงจากการรันชุดทดสอบ ดู [คู่มือเว็บ](../web/README.md)

## 1. Users

| Field | Type | ข้อกำหนด |
|---|---|---|
| User ID | Single line text, Primary | รหัสไม่ซ้ำ เช่น SEC001, AG001 |
| Full Name | Single line text | ชื่อแสดงในเว็บ |
| Agent Code | Single line text | รหัสตัวแทนจากฟอร์มลงทะเบียน ให้ผู้ดูแลตรวจสอบก่อนอนุมัติ |
| Phone | Phone number | เบอร์โทรที่ผู้สมัครกรอก ไม่ได้ยืนยันด้วย SMS |
| Email | Email | อีเมลบัญชี Google ที่ได้รับอนุญาต ห้ามซ้ำ |
| Google Subject | Single line text | Google `sub` ไม่ซ้ำ; Gmail / Workspace ผูกครั้งแรกได้อัตโนมัติ |
| Role | Single select | `Agent`, `Secretary`, `Admin` |
| Active | Checkbox | ต้องเปิดสำหรับผู้มีสิทธิ์ใช้งาน |
| Record ID | Formula | `RECORD_ID()` |
| Created At | Created time | วันที่สร้าง |
| Last Login | Date with time | เวลาเข้าใช้ล่าสุด |
| LINE User ID | Single line text | ระบบเติมจาก LINE Login; ไม่ซ้ำและอยู่ Provider เดียวกับ OA |
| LINE Notifications | Checkbox | เปิดรับสรุปเช้า–เย็น เริ่มต้นเป็นปิด |

เพิ่มเลขาฯ 1 คนและ Agent 10 คนด้วยอีเมลจริงก่อนใช้งาน ไม่ต้องสร้างรหัสผ่านใน Airtable ข้อมูล Google Subject ให้ผู้ดูแลแก้ไขเท่านั้น Airtable ไม่บังคับ unique field ให้เอง ต้องตรวจ User ID / Email / Google Subject ไม่ให้ซ้ำ

## 2. Tasks

| Field | Type | ข้อกำหนด |
|---|---|---|
| Task ID | Formula, Primary | `"HVR-" & RIGHT("00000" & {Sequence}, 5)` |
| Sequence | Autonumber | สำหรับสร้างรหัสแสดงผล |
| Task Title | Single line text | จำเป็น สูงสุด 180 ตัวอักษร |
| Description | Long text | จำเป็น สูงสุด 5,000 ตัวอักษร |
| Agent | Link to Users | **ปิด Allow linking to multiple records** |
| Agent Record ID | Lookup | จาก Agent → Record ID; ใช้ filter ฝั่ง API |
| Assigned Secretary | Link to Users | ปิด multiple records |
| Category | Single select | ตัวแทนใหม่, ตัวแทนเก่า, ลูกค้าใหม่, ลูกค้าเก่า; งานเดิมที่นำประเภทออกแสดงเป็น ไม่ระบุประเภท |
| Status | Single select | `New`, `In Progress`, `Waiting`, `On Hold`, `Completed`, `Cancelled` |
| Priority | Single select | `Low`, `Normal`, `High`, `Urgent` |
| Due Date | Date, ไม่มีเวลา | กำหนดส่ง |
| Next Follow-up | Date, ไม่มีเวลา | ระบบคำนวณนัด Pending ที่เร็วที่สุด |
| Created At | Created time | วันที่ส่งงาน |
| Last Update | Last modified time | ติดตาม **ทุกฟิลด์ที่แก้ไขได้** ใน Tasks; ใช้ตรวจ conflict |
| Completed At | Date with time | ตั้งเมื่อ Completed; ล้างเมื่อเปิดงานใหม่ |
| Attachments | Attachment | อ่านและเปิดจากเว็บ; อัปโหลดผ่าน Airtable |
| Reference URL | URL | ลิงก์ HTTPS เอกสารอ้างอิง |
| Request Key | Single line text | key สำหรับ upsert; ให้ระบบจัดการ ห้ามแก้ไขเอง |
| Record ID | Formula | `RECORD_ID()` |

ในฐานข้อมูลเดิมที่ใช้ `Waiting External` ให้เปลี่ยน mapping เป็น `Waiting` หรือปรับ enum ทั้ง Frontend / Backend ให้ตรงกันก่อนใช้ รหัส Autonumber อาจมีช่องว่างเมื่อมีการลบรายการ ไม่ใช่ข้อผิดพลาด

## 3. Task Updates

| Field | Type | ข้อกำหนด |
|---|---|---|
| Update ID | Autonumber, Primary | รหัสประวัติ |
| Task | Link to Tasks | ปิด multiple records |
| Task Record ID | Lookup | จาก Task → Record ID |
| Updated By | Link to Users | ปิด multiple records |
| Actor Name | Single line text | ชื่อผู้ดำเนินการ ณ เวลาเพิ่มประวัติ |
| Update Type | Single select | `Created`, `Comment`, `Status`, `Follow-up` |
| Old Status | Single line text | สถานะเดิม |
| New Status | Single line text | สถานะใหม่ |
| Message | Long text | ข้อความบันทึก |
| Updated At | Created time | วันเวลาเพิ่มบันทึก |
| Visible to Agent | Checkbox | เปิดเมื่อข้อความให้ Agent เห็น |
| Operation Key | Single line text | key สำหรับ upsert ห้ามแก้ไขเอง |

ประวัติเดิมที่ไม่ได้เปิด Visible to Agent จะถือเป็นข้อมูลภายในโดยอัตโนมัติ

## 4. Follow-ups

| Field | Type | ข้อกำหนด |
|---|---|---|
| Follow-up ID | Autonumber, Primary | รหัสนัด |
| Task | Link to Tasks | ปิด multiple records |
| Task Record ID | Lookup | จาก Task → Record ID |
| Follow-up Date | Date, ไม่มีเวลา | รุ่นแรกติดตามระดับวัน ตามเวลา Bangkok |
| Assigned To | Link to Users | เลขาฯ ผู้ตั้งนัด; ปิด multiple records |
| Follow-up Status | Single select | `Pending`, `Done`, `Skipped` |
| Result / Notes | Long text | รายละเอียดและผลติดตาม; ภายในเลขาฯ |
| Completed At | Date with time | วันที่บันทึกผล |
| Operation Key | Single line text | key สำหรับ upsert |

เลขาฯ สร้างหลายนัดล่วงหน้าได้ การทำ Done / Skipped จะคำนวณ Next Follow-up ใหม่ งาน Completed / Cancelled จะไม่ปรากฏรายการนัดที่ต้องติดตาม แม้มีนัด Pending เก็บไว้ในประวัติ

## 5. Notifications

| Field | Type | ข้อกำหนด |
|---|---|---|
| Notification ID | Autonumber, Primary | รหัสแจ้งเตือน |
| Task | Link to Tasks | ปิด multiple records; เว้นว่างได้สำหรับสรุปประจำวัน |
| Recipient | Link to Users | ปิด multiple records |
| Channel | Single select | `Email`, `LINE` |
| Event Type | Single select | `Status Changed`, `Daily Summary` |
| Message | Long text | เนื้อหาแจ้งเตือน |
| Delivery Status | Single select | `Pending`, `Sending`, `Sent`, `Failed` |
| Sent At | Date with time | วันที่ส่งสำเร็จ |
| Operation Key | Single line text | key ป้องกันคิวซ้ำ |
| Digest Date | Date ไม่มีเวลา | วันที่ไทยสำหรับรายงาน LINE |
| Digest Round | Single select | `Morning`, `Evening` |
| LINE User ID | Single line text | สำเนาผู้รับสำหรับรายงาน LINE |
| LINE Role | Single line text | สำเนาสิทธิ์ผู้รับ |
| LINE Retry Key | Single line text | UUID ป้องกันส่งซ้ำ |
| Scope Fingerprint | Single line text | fingerprint ชุดงานที่มีสิทธิ์ |
| Delivery Started At | Date with time | เวลาเริ่มส่งครั้งแรก |
| Last Error | Long text | สาเหตุส่งไม่สำเร็จ / รอ retry |

`Sending` เป็นสถานะที่ต้องมี เพื่อให้กรณีส่งสำเร็จแต่เขียนผลกลับไม่ได้หยุดรอตรวจสอบ แทนการส่งอีเมลซ้ำอัตโนมัติ

สำหรับ LINE ระบบ retry Sending / Pending ด้วย key และ payload เดิมภายในรอบที่กำหนด รายละเอียดอยู่ใน [คู่มือ LINE OA](line-oa-setup.md)

## Views ที่แนะนำใน Airtable

- Tasks: งานเข้าใหม่ (`Status=New`), งานคงค้าง (ไม่ใช่ Completed/Cancelled), งานเกินกำหนด, นัดติดตามวันนี้
- Task Updates: ตรวจบันทึกภายใน, ประวัติแยก Task
- Follow-ups: Pending เรียงวันนัด
- Notifications: Pending / Sending / Failed สำหรับตรวจคิว

ฐานนี้มีข้อมูลของ Agent ทุกคน อย่าให้ Agent เข้าถึง Base โดยตรง หากต้องการบังคับให้เห็นเฉพาะงานตัวเอง ให้ Agent ใช้ Web App เท่านั้น
