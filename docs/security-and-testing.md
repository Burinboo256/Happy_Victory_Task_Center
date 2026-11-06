# สิทธิ์และการทดสอบก่อนเปิดใช้

## สิทธิ์ที่บังคับบนเซิร์ฟเวอร์

| ความสามารถ | Agent | Secretary / Admin |
|---|---|---|
| ดู Dashboard / รายการ / รายละเอียด | เฉพาะงานตัวเอง | ทุกงาน |
| ส่งงาน | เจ้าของคือตัวเองจาก session เท่านั้น | เลือก Agent ที่ Active |
| เพิ่มข้อความ | เฉพาะงานตัวเองและเป็นข้อความที่ Agent เห็น | ทุกงาน เลือก public / internal |
| เปลี่ยนสถานะ / สรุปผล | ไม่อนุญาต | อนุญาต |
| ตั้งนัด / บันทึกผลติดตาม | ไม่อนุญาต | อนุญาต |
| อ่านข้อความภายใน / บันทึกติดตาม | ไม่อนุญาต | อนุญาต |
| ดูสมาชิกทีม | ข้อมูลชื่อของตัวเอง | รายชื่อและ role ของสมาชิก รวมผู้ใช้ที่ปิดใช้งานเพื่ออ้างอิงงานเก่า |
| จัดการสิทธิ์บัญชี | ไม่อนุญาต | เจ้าของแก้ Users ผ่าน Airtable |

RPC functions ที่เผยให้ browser เรียกมี `startGoogleLogin`, `completeGoogleLogin`, `startLineLink`, `completeLineLink`, `logout`, `api` และ Web entry point `doGet` ฟังก์ชันอื่นลงท้าย `_` ตามกลไก private functions ของ `google.script.run`

ข้อยกเว้นคือ `initializeProject` และ `checkDeployment` ซึ่งต้องเป็นชื่อ public เพื่อให้เลือกในเมนู Run ของ editor ได้ ทั้งคู่ตรวจ Google active / effective user ให้มีอีเมลเดียวกันก่อนเข้าถึง properties หรือ API เมื่อรัน Web App แบบ Execute as Me ผู้ใช้อื่นและ anonymous จะไม่ผ่านการตรวจนี้ คำสั่งเหล่านี้ไม่ใช้ app role ยืนยันสิทธิ์และไม่ส่งแจ้งเตือน

LINE linking ต้องมี Google session ที่ตรวจแล้ว และต้องพิสูจน์ verifier จาก browser / session เดิมก่อนผูกผู้รับ LINE ID มาจากการแลก authorization code และอ่านโปรไฟล์ตรงจาก LINE ฝั่งเซิร์ฟเวอร์ ไม่รับ LINE ID ที่ browser ระบุเอง ตัวส่งตรวจ Active / consent / Role / LINE ID และ fingerprint ชุดงานใหม่ก่อน retry ไม่ส่งบันทึกภายในหรือรายละเอียดงานทั้งหมดผ่าน LINE

Base ID และ Airtable PAT, OAuth Client Secret เก็บใน Script Properties Token ที่ส่งให้ browser เป็น application session แบบ opaque เท่านั้น Session cache เก็บ hash ของ token และตรวจข้อมูล Active / Role / Google Subject จาก Users ใหม่ทุก API call ก่อนใช้ bootstrap cache

ไม่มีการแชร์ session ข้ามผู้ใช้ผ่าน cache หน้าข้อมูลใช้ DTO ที่เลือกเฉพาะฟิลด์ ไม่ส่ง User Google Subject หรือ internal messages ให้ Agent

## ผลที่ตรวจบนเครื่องได้

เรียก `npm run check` เพื่อตรวจ syntax ของ `.gs` / frontend และ manifest เรียก `npm test` เพื่อทดสอบ Backend กับ service doubles โดยไม่มีการเรียกบัญชีจริง

การทดสอบครอบคลุม authentication, exact ownership หลัง upstream filter, forged owner / role, จำกัด status / follow-up, internal notes, Active / identity revocation, stale version, operation replay / partial failure recovery, follow-up round trips, browser-bound OAuth ticket, Google Subject binding, Airtable pagination / rate-limit handling และ script-safe template JSON

การทดสอบเหล่านี้ไม่ใช่การทดสอบ Google OAuth, Apps Script runtime, MailApp หรือ Airtable API จริง จำเป็นต้องทำ acceptance test ด้านล่างบน deployment จริง

## ทดสอบกับบัญชีจริง

เริ่มจาก Base ทดสอบที่ไม่มีข้อมูลลูกค้าจริง และตั้ง ENABLE_EMAIL_NOTIFICATIONS=false

- Login เลขาฯ และ Agent สองบัญชีคนละ browser profile ให้สำเร็จ
- Login บัญชีที่ไม่อยู่ใน Users แล้วต้องถูกปฏิเสธ
- ปิด Users.Active ขณะ Agent เปิดเว็บ แล้วเรียก API ใหม่ต้องถูกปฏิเสธ แม้มี cache
- Agent A สร้างงาน ระบุ owner ถูกต้องใน Airtable และ Agent B ไม่เห็นงานนั้น
- ทดสอบส่ง payload เปลี่ยน task ID เป็นของ Agent B ผ่าน `api` ทั้ง detail และ comment ต้องถูกปฏิเสธ
- Agent เปลี่ยน status / ตั้ง follow-up / resolve follow-up ผ่าน RPC โดยตรง ต้องถูกปฏิเสธ
- เลขาฯ เพิ่มบันทึกภายใน แล้ว Agent ไม่ได้รับข้อความนั้นแม้เปิดดู response
- เลขาฯ เปลี่ยนเป็น Completed แล้วมี Completed At, timeline และ notification Pending
- เปิดรายละเอียดสองแท็บ แล้วเปลี่ยนสถานะทั้งคู่ แท็บหลังต้องพบ CONFLICT
- เพิ่มนัดติดตามสองวัน แล้วทำ Done วันแรก ต้องเลื่อนไปวันถัดไปโดยสถานะงานไม่เปลี่ยน
- ทดสอบข้ามเที่ยงคืน Bangkok: งานกำหนดวันนี้ยังไม่เกินกำหนด และเป็นเกินกำหนดในวันถัดไป
- ทดสอบ 101+ Tasks ว่าดึงครบทุกหน้าและ Agent ยังเห็นเฉพาะงานตัวเอง
- ทดสอบ network error และส่งคำขอเดิมซ้ำ ตรวจว่าไม่สร้าง task / timeline / notification ซ้ำ
- ตรวจ Login บนมือถือ / Safari และ browser policy ด้าน storage ที่ใช้งานจริง
- ทดสอบอีเมลเฉพาะผู้รับที่เจ้าของยืนยัน แล้วตรวจ Pending → Sending → Sent และไม่ส่งสรุปซ้ำวันเดียวกัน
- เปิดหน้าใช้งานจริงแล้วต้องไม่มี demo banner / role switcher / sample records

## ข้อจำกัดและการดูแล

Airtable ไม่มี transaction ครอบคลุมหลายตาราง ระบบใช้ operation journal, deterministic upsert keys และ app-level script lock เพื่อทำงานต่อเมื่อบันทึกสำเร็จบางส่วน คำขอที่ค้างจะกันคำขอแก้ไขงานเดียวกันจนกว่าจะทำต่อสำเร็จหรือเจ้าของ reconcile

กรณี API ตอบกลับไม่แน่ชัดหลัง write, Google execution ถูกตัดกลางคัน, ผู้ดูแลแก้ข้อมูลโดยตรง หรือ journal ถูกลบ อาจต้องตรวจและ reconcile เอง หลีกเลี่ยงการแก้สถานะ / key ของรายการเดียวกันจาก Airtable ขณะกำลังบันทึกจากแอป ระบบไม่ได้รับประกัน exactly-once สำหรับเครือข่ายทุกกรณี

Journal ที่สำเร็จเก็บ 7 วัน แล้วล้างใน dailyMaintenance_ ส่วน unfinished journal เก็บไว้ให้ตรวจสอบ หากไม่ใช้ email ให้ตั้ง dailyMaintenance_ trigger สำหรับ maintenance ได้โดยคง ENABLE_EMAIL_NOTIFICATIONS=false โค้ดจะทำ cleanup อย่างเดียว

Apps Script Properties มีโควตาพื้นที่ และ runtime / UrlFetch / MailApp มีโควตาตามบัญชี งานจำนวนมากควรมีนโยบาย archive และตรวจ usage ของทั้ง Google กับ Airtable การโหลด Dashboard ดึงข้อมูลที่ผู้ใช้นั้นมีสิทธิ์ทุกหน้าเพื่อให้ KPI ตรงกัน จึงเหมาะกับทีมขนาดเล็กตามโจทย์ ควรประเมินใหม่เมื่อจำนวน Tasks / Updates สูงมาก

ตัวแอปใช้ serial lock ทำให้ป้องกัน race ระหว่างแอปได้ แต่คำขอพร้อมกันอาจต้องรอ ระบบ cache 30 วินาทีและไม่มี background polling ปุ่มโหลดล่าสุดข้าม bootstrap cache ของผู้ใช้คนนั้น แต่ยังคงตรวจสิทธิ์ก่อนทุกครั้ง

ไฟล์ Attachments ใช้ URL ที่ Airtable ออกให้เมื่อผู้ใช้ผ่านสิทธิ์อ่าน task แล้ว ลิงก์อาจหมดอายุตามนโยบาย Airtable ให้เปิดรายละเอียดใหม่เพื่อรับ URL ล่าสุด ผู้ที่ได้รับ URL โดยตรงอาจเปิดไฟล์ได้จนลิงก์หมดอายุ ควรใช้เอกสารที่มีการตรวจบัญชีผู้รับเองเมื่อจำเป็น

ฟอนต์โหลดจาก Google Fonts เท่านั้น ไม่มี analytics, trackers หรือ external frontend SDK ในหน้าเว็บ โหมดทดลองเก็บข้อมูลสมมติใน localStorage และแยกออกจาก deployment จริง
