# Happy Victory Rinlyn Task Center

ระบบติดตามงานสำหรับเลขาฯ และ Agent 10 คน ตาม guideline ของผู้ใช้

**Host:** Google Apps Script HTML Service · **Database:** Airtable · **Timezone:** Asia/Bangkok

## เริ่มทดลองบนเครื่อง

ต้องมี Node.js 20 ขึ้นไป ไม่ต้องติดตั้ง dependencies

```powershell
cd 'E:\Happy Victory Task Center'
npm run preview
```

เปิด http://127.0.0.1:4173/ แล้วเลือกทดลองบทบาทจากแถบสีครีมด้านบน ข้อมูลทั้งหมดเป็นข้อมูลสมมติ เก็บใน localStorage ของเบราว์เซอร์ ไม่มีการเรียก Airtable หรือส่งอีเมล การสลับบทบาทมีเฉพาะตัวทดลองเท่านั้น

หรือใช้ `npm run build` แล้วเปิด `dist/index.html` ในเบราว์เซอร์ รองรับการทดลองออฟไลน์ โดยฟอนต์ออนไลน์จะใช้ฟอนต์สำรองเมื่อโหลดไม่ได้

## ฟังก์ชันที่พัฒนาแล้ว

- Dashboard งานคงค้าง งานถึงวันติดตาม งานเกินกำหนด และงานเสร็จสิ้น
- ค้นหา กรอง Agent / ความเร่งด่วน / สถานะ แบ่งหน้า และสลับตารางกับการ์ด
- Agent ส่งงานใหม่ ดูงานและประวัติเฉพาะของตัวเอง และเพิ่มข้อความ
- ลิงก์ตรง [ส่งงานใหม่สำหรับ LINE Rich Menu](https://script.google.com/macros/s/AKfycbxyQsNe8I4psZUgv0lcIzUZKDWj8Yb_sUCcRllxGD8Hj9F3WF3iMEhgoh7P85UR2zTp/exec?view=create&openExternalBrowser=1) รองรับมือถือและกลับเข้าฟอร์มหลัง Google Login; ดูวิธีตั้งค่าใน [คู่มือ LINE OA](docs/line-oa-setup.md#ลิงก์ส่งงานใหม่สำหรับ-rich-menu)
- เลขาฯ ดูทุกงาน อัปเดตสถานะ บันทึกสรุป และดูรายงานแยก Agent
- นัดติดตามแยกจากสถานะงาน รองรับหลายนัด บันทึกผล / ข้ามนัด และคำนวณนัดถัดไป
- Timeline แยกข้อความที่ Agent เห็นออกจากบันทึกภายใน
- ปฏิทินกำหนดส่งและนัดติดตาม รายชื่อสมาชิก และประวัติงาน Agent
- Google OAuth แบบ authorization code เก็บ client secret และ Airtable PAT ฝั่งเซิร์ฟเวอร์
- ตรวจสิทธิ์และเจ้าของงานทุกคำขอ ผูกตัวตนด้วย Google Subject (`sub`) ที่ได้จาก Google UserInfo ฝั่งเซิร์ฟเวอร์
- รองรับ Airtable offset pagination, cache 30 วินาที, shared rate pacing และ retry เมื่อได้ HTTP 429
- Operation journal และ upsert keys ช่วยให้คำขอเดิมทำต่อหลังบันทึกได้บางส่วน โดยไม่สร้างงาน / ประวัติซ้ำในกรณีที่ทดสอบ
- คิวอีเมลเปลี่ยนสถานะ และสรุปประจำวันสำหรับเลขาฯ เวลา 08:00 น. เปิดใช้ภายหลังตามคู่มือ
- สรุป LINE รอบ 08:00 และ 18:00 เวลาไทย ผ่าน OA: Admin / เลขาฯ รับภาพรวม ส่วน Agent รับเฉพาะงานตัวเอง
- ปุ่มเชื่อมบัญชี LINE ผ่าน LINE Login และเปิด / หยุดรับสรุป พร้อมคิวป้องกันส่งซ้ำด้วย LINE retry key

ตั้งค่าเพิ่มเติมตาม [คู่มือ LINE OA และสรุปเช้า–เย็น](docs/line-oa-setup.md) ฟังก์ชันส่งจริงจะเริ่มหลังตั้ง credentials, ผู้รับ และติดตั้ง trigger ในบัญชีเจ้าของเท่านั้น

## ติดตั้งใช้งานจริง

เริ่มพัฒนาแอป Next.js ใน `web/` บนเครื่องแล้ว ดู [วิธีรันและทดสอบ](web/README.md), [สถานะพัฒนาล่าสุด](docs/vercel-progress.md), [แผนพัฒนา](docs/vercel-development-plan.md) และ [แผน Deploy / Cutover / Rollback](docs/vercel-deployment-plan.md) ยังไม่ได้สร้างบริการ cloud หรือ Deploy Vercel; ระบบใช้งานจริงด้านล่างยังเป็น Google Apps Script

1. สร้างตารางตาม [โครงสร้าง Airtable](docs/database-schema.md)
2. ทำตาม [คู่มือติดตั้ง Google Apps Script และ Google OAuth](docs/deployment.md)
3. ทดสอบ Google Login อย่างน้อยสองบัญชี / ต่างโดเมน และตรวจสิทธิ์ตาม [รายการทดสอบก่อนเปิดใช้](docs/security-and-testing.md)

นำเข้าเฉพาะไฟล์ใน `apps-script/` ไปยัง Google Apps Script โปรเจกต์แบบ standalone ทุกหน้าและ Backend อยู่บน Apps Script โปรเจกต์เดียวกัน

สร้าง schema จริงใน Airtable ครบ 5 ตาราง ตั้ง PAT / OAuth client และ [Deploy Web App](https://script.google.com/macros/s/AKfycbxyQsNe8I4psZUgv0lcIzUZKDWj8Yb_sUCcRllxGD8Hj9F3WF3iMEhgoh7P85UR2zTp/exec) แล้ว ทดสอบ Google Login ของ Admin, callback, Dashboard, หน้าทีม และอ่าน Airtable จริงผ่านทั้ง 5 ตาราง ดู [สถานะติดตั้งและรายการที่ยังต้องทดสอบ](docs/deployment.md) OAuth ยังเป็น External / Testing สมาชิกทีมอื่นยังต้องเพิ่มใน Users และ Test users การแจ้งเตือนยังปิดไว้

ใช้ `npm run package:apps-script` เตรียมไฟล์ production 5 ไฟล์สำหรับนำเข้าผ่าน editor ใน `artifacts/apps-script/` backend จะรวมเป็น `Code.gs` พร้อม HTML 3 ไฟล์และ manifest เลือก `initializeProject` ในเมนู Run เพื่อเติมค่าเริ่มต้นที่ขาด หรือ `checkDeployment` เพื่อตรวจค่าติดตั้งและสิทธิ์อ่าน Airtable ทั้งคู่ตรวจบัญชี Google ของผู้รันก่อนทำงานและไม่แสดง secrets หรือส่งแจ้งเตือน

## ขอบเขตรุ่นแรก

เอกสารอ้างอิงรองรับลิงก์ HTTPS และอ่านไฟล์ในฟิลด์ Attachments ของ Airtable ได้ การอัปโหลดไฟล์โดยตรงยังให้ทำผ่าน Airtable ไม่มีการลบงานถาวร ใช้สถานะยกเลิกแทน ผู้ดูแลจัดการสมาชิกจาก Users ใน Airtable ส่วนรายงานขั้นสูงอยู่นอกขอบเขตรุ่นนี้

ไม่มี Firebase Hosting, Cloud Functions หรือโฮสต์อื่นในระบบจริง

## โครงสร้าง

```text
apps-script/   Backend .gs + Index / Styles / Scripts HTML + appsscript.json
web/           Next.js + TypeScript สำหรับ Vercel; อยู่ระหว่างพัฒนาบนเครื่อง
preview/       ตัวจำลองสำหรับทดลองบนเครื่องเท่านั้น
tools/         build / preview / syntax check
tests/         ทดสอบสิทธิ์ OAuth ticket, pagination, retry และประวัติ
docs/          โครงสร้างฐานข้อมูล การติดตั้ง และการทดสอบบนบัญชีจริง
dist/          ตัวอย่างเว็บที่ประกอบแล้ว (สร้างด้วย npm run build)
```

ตรวจสอบด้วย `npm run check` และ `npm test` ทดสอบ Backend โดยจำลองบริการ Google Apps Script และ Airtable ไม่มีการส่งข้อมูลออกไปยังบัญชีจริง

## แหล่งอ้างอิง

- [Google Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [HTML Service iframe restrictions](https://developers.google.com/apps-script/guides/html/restrictions)
- [Google OAuth authorization code flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OpenID Connect และ UserInfo](https://developers.google.com/identity/openid-connect/openid-connect)
- [Airtable Web API และ pagination](https://support.airtable.com/docs/getting-started-with-airtables-web-api)
- [Airtable API rate limits](https://support.airtable.com/docs/managing-api-call-limits-in-airtable)
