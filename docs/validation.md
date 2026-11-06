# ผลตรวจรุ่นแรก — 3 พฤศจิกายน 2026

## ลิงก์ส่งงานใหม่สำหรับมือถือ — 5 พฤศจิกายน 2026

- เพิ่ม boot `view=create` แบบ whitelist; ฟอร์มเปิดหลัง bootstrap ตรวจสิทธิ์สำเร็จ และจำจุดหมายข้าม Google OAuth ใน sessionStorage
- ทดสอบ signed-in / signed-out / callback / session หมดอายุ / ค่า view ที่ไม่รองรับ / OAuth error ครบ รวม 60 tests ผ่าน และตรวจ syntax ผ่าน
- Deploy เวอร์ชัน 4 บน URL เดิมแล้ว response ของ `?view=create&openExternalBrowser=1` มี boot ถูกต้อง, inline scripts 2 ชุด parse ผ่าน (65,906 ตัวอักษร) และ frontend ตรงกับ source ทุกบรรทัดเมื่อ trim ช่องว่าง
- ตรวจเว็บจริงพบ session เดิมหมดอายุและแสดง Login ถูกต้อง; การกลับเข้าฟอร์มหลัง Login และการเปิดผ่าน Rich Menu บนโทรศัพท์ยังรอตรวจด้วยบัญชี / อุปกรณ์จริง

## เตรียม Deploy และ credentials — 5 พฤศจิกายน 2026

- เพิ่ม `userinfo.email` ใน manifest ตามสิทธิ์ที่ Session.getActiveUser / getEffectiveUser ต้องใช้ ตรวจ JSON จาก editor จริงแล้วถูกต้อง และ `node tools/check.mjs` ผ่าน
- สร้าง PAT สำหรับ Base `appDS1Ji5cqIohPq3` เท่านั้น ด้วย scopes `data.records:read` / `data.records:write` และบันทึกใน Script Properties โดยตรง ไม่ได้บันทึก token ลง workspace หรือรายงาน
- สร้าง Cloud project `happy-victory-task-center`, OAuth branding / External audience และ Web application client แล้ว ตั้ง credentials ทั้งหมดใน Script Properties และเพิ่มบัญชีเจ้าของใน Test users
- สร้าง Admin คนแรกตามที่เจ้าของอนุญาตแล้ว และรัน `checkDeployment` ผ่านบน Apps Script จริง อ่าน Airtable ได้ครบทั้ง 5 ตาราง
- Deploy เวอร์ชัน 2 ด้วย URL เดิมแล้ว แก้หน้าโหลดค้างจาก HTML Service ตัด JavaScript ตรง slash คู่ของ URL ภายใน template literal โดยใช้ regex character classes / HTML entity แทน
- ดาวน์โหลด response สาธารณะของเวอร์ชัน 2 แล้ว `node tools/check-deployment.mjs artifacts/deployed-response.html` ผ่าน inline scripts ทั้ง 2 ชุด รวม 65,318 ตัวอักษร
- `node tools/check.mjs` และ unit tests 54 รายการผ่าน เพิ่ม regression checks สำหรับ Apps Script HTML transport และ JavaScript ที่ถูกตัดระหว่าง render
- ทดสอบหน้า Login, เริ่ม OAuth, ให้เจ้าของยืนยันกับ Google, callback, session, Dashboard และหน้าทีมสำเร็จบนเว็บจริง execution ของ `doGet`, `completeGoogleLogin` และ `api` แสดงเสร็จสมบูรณ์
- Login ผูก Google Subject และเขียน Last Login ให้ Users จริงแล้ว ยังไม่ทดสอบสร้างงาน / ข้ามสิทธิ์สองบัญชี เนื่องจากยังไม่มีเลขาฯ หรือ Agent จริง และยังไม่ส่งแจ้งเตือน

## เตรียมโปรเจกต์ Apps Script — 5 พฤศจิกายน 2026

- สร้างโปรเจกต์ Google Apps Script ใหม่และนำเข้า production แบบ backend รวมเป็น `Code.gs` พร้อม HTML 3 ไฟล์และ manifest
- ตรวจจำนวนตัวอักษรและ fingerprint หลังคัดลอก source กลับจาก editor ตรงกับต้นฉบับทั้ง 5 ไฟล์ ตั้ง V8 / Asia/Bangkok และบันทึก Script Properties สำหรับ Base/Table ID กับ flags ปิดแจ้งเตือนแล้ว
- เพิ่ม `Setup.gs`: เติม Base/Table ID ที่ขาดโดยไม่ทับ credentials และตรวจค่าติดตั้ง / สิทธิ์อ่านทั้ง 5 ตารางจาก editor เท่านั้น
- `node tools/check.mjs` ผ่าน; `node --test --test-isolation=none tests/*.test.mjs` ผ่าน 51 tests รวมการปฏิเสธ identity ที่ไม่ตรงกัน, public entry points สำหรับเมนู Run, การตั้งค่าซ้ำ, Base/Table ID ขัดแย้ง, การไม่เขียน records และการไม่เปิดเผย secrets ใน log
- `npm run package:apps-script` สร้างไฟล์ production 5 ไฟล์พร้อม SHA256SUMS และตรวจ syntax ของ backend หลังรวมไฟล์แล้ว
- ยังไม่ได้ทดสอบ OAuth / API บนบัญชีจริงหรือเผยแพร่ Web App เนื่องจากยังต้องตั้ง PAT, OAuth Client และอนุญาตสิทธิ์ในบัญชีเจ้าของ

## เพิ่มสรุป LINE — 4 พฤศจิกายน 2026

- `npm run check` ผ่าน; `npm test` ผ่าน 41 tests รวม 17 tests สำหรับ LINE และ regression ที่ยืนยันว่าบันทึก Completed ซ้ำไม่เปลี่ยนวันเสร็จเดิม
- ตรวจปุ่ม LINE ใน browser ทั้ง Secretary และ Agent ข้อความขอบเขตรับสรุปตรงตามบทบาท โหมดทดลองไม่ส่งข้อความจริง
- ตรวจการแบ่ง scope Admin / Secretary / Agent, ขอบเขตวัน Completed At ที่เที่ยงคืนไทย, กำหนดส่ง / นัดค้าง / งานคงค้าง, จำกัดความยาวข้อความ
- ตรวจสองรอบต่อวัน ไม่มีส่งซ้ำจาก tick / local marker หาย, retry ด้วย payload/key เดิม, LINE 409 ที่มี accepted request ID, network / 5xx / 401 / quota 429
- ตรวจ Active / opt-out / role / ผู้รับ / task ownership เปลี่ยนก่อน retry และไม่ส่งรายงานเก่าข้ามรอบ
- ตรวจ LINE link แบบ browser/session-bound, ID ซ้ำและ ticket replay รวมถึงการติดตั้ง trigger ซ้ำได้โดยไม่เพิ่มรายการ
- ยังไม่ได้ทดสอบ LINE Login, Messaging API หรือ trigger บนบัญชีจริง เนื่องจากไม่มี credentials / deployment ของเจ้าของ

## ตรวจบนเครื่อง

- `npm run check`: ผ่าน syntax ของ Apps Script / Frontend / Demo และ manifest
- `npm test`: ผ่าน 23 tests, 0 failures
- Local preview ตอบ HTTP 200
- การ build ประกอบ template, Styles, Scripts และตัวจำลองครบ โดยตัวจำลองถูกโหลดก่อนเริ่มแอป

## ตรวจในเบราว์เซอร์ด้วยข้อมูลสมมติ

- Dashboard แสดง 16 งาน แยก 12 งานคงค้าง / 4 ต้องติดตาม / 3 เกินกำหนด / 3 เสร็จสิ้น
- เปิดรายละเอียด เปลี่ยนสถานะ และเห็นบันทึกใหม่ใน Timeline
- บันทึกผลนัดติดตาม แล้วนัดถัดไปและจำนวนที่ต้องติดตามเปลี่ยนตามข้อมูล
- สลับ Agent เห็นเฉพาะงานตัวเอง ไม่มีช่องเปลี่ยนสถานะ และไม่เห็นข้อความภายใน
- Agent ส่งงานใหม่ได้ เจ้าของมาจากบัญชีที่เลือกในโหมดทดลอง
- ข้อความที่มี `<ตัวอย่าง> &` แสดงเป็นข้อความตามปกติ
- ค้นหารหัสงานได้ 1 รายการ คำค้นที่ไม่พบแสดง empty state และแบ่งหน้า 1–7 → 8–14 ได้
- เปิดปฏิทินและรายงานงานแยก Agent ได้
- ตรวจ viewport มือถือกว้าง 390px แก้ grid ที่ดันเนื้อหาเกินขอบ และคงการเลื่อนตารางภายใน
- รีโหลดหน้าหลัง build เพื่อยืนยันว่า demo adapter ทำงานได้กับไฟล์ CRLF บน Windows

## ยังต้องตรวจบนบัญชีจริง

Google OAuth / browser storage หลัง redirect, Apps Script deployment, PAT / Base / schema, การรับส่งข้อมูล Airtable จริง และ MailApp / triggers ยังไม่ได้ตรวจ เนื่องจากยังไม่มีการตั้งค่าบัญชีของเจ้าของระบบ

หน้านี้เป็นผลตรวจโค้ดและตัวทดลอง ไม่ใช่รายงานผลติดตั้งระบบ production ดู [รายการทดสอบก่อนเปิดใช้](security-and-testing.md) และ [วิธีติดตั้ง](deployment.md)
