# ลงทะเบียนตัวแทน

## ระบบหลาย Space: ลิงก์ปัจจุบัน

ใช้ `/{space-slug}/register` เช่น `/rinlyn/register` คัดลอกจาก **ลิงก์ลงทะเบียนของ Space นี้** ในหน้า `/spaces` ฟอร์มแสดงชื่อ Space และส่ง Workspace ID ที่เซิร์ฟเวอร์ตรวจจาก slug ไม่อ่าน Space ล่าสุดหรือ cookie แทนทีมในลิงก์

หลัง Google ยืนยัน จะกลับ `/{space-slug}/register?status=pending` (หรือ existing/review) หาก Google ปฏิเสธคำขอที่ยังมี state ถูกต้อง จะกลับหน้าสมัครของทีมเดิมพร้อมข้อความผิดพลาด ลิงก์ Login บนหน้าผลสมัครกลับเข้าทีมเดิม และลิงก์สมัครจาก Login ที่มีปลายทางแบบระบุ Space ใช้ทีมเดียวกัน

ลิงก์เก่า `/register?space=<UUID>` ยังใช้ได้และ redirect ไปชื่อ URL ของทีมนั้น รวม status/error ที่ระบบรองรับ ส่วน `/register` ที่ไม่ระบุทีมใช้ Space เริ่มต้น จึงควรแจกเฉพาะลิงก์ระบุทีม สมัครแล้วต้องผ่านการอนุมัติสมาชิกใน Space และ Active ส่วนกลางก่อนใช้งานจริง Space ที่พักหรือไม่พบจะไม่แสดงฟอร์มและไม่สลับไปทีมอื่น

ไม่ต้องเพิ่ม Google OAuth callback หรือ migration ใหม่ รุ่นหลาย Space ใช้ Control Base จัดการสิทธิ์สมาชิก รายละเอียดด้านล่างอธิบายกลไกการสมัครเดิมและฐานข้อมูล ไม่ใช้ Active ของ Users ใน Base งานแทนสิทธิ์ส่วนกลาง

หน้า `/register` ใช้ชื่อ–นามสกุล รหัสตัวแทน และเบอร์โทร แล้วให้ผู้สมัครยืนยันบัญชี Google อีเมลและ Google Subject มาจาก Google เท่านั้น ไม่รับ Role, Active หรืออีเมลจากฟอร์ม

## อนุมัติจากหน้าเว็บ

1. เปิด `/spaces` แล้วเลือก **จัดการ Admin / สมาชิก** ของทีม (Space Admin เห็น **จัดการสมาชิก**)
2. รายชื่อเรียงตามวันที่สมัคร/เพิ่มสมาชิกใน Space ล่าสุดก่อน แสดงเวลาไทยใต้ชื่อ วันที่นี้มาจากเวลาสร้าง record ใน Workspace Members ไม่ใช่วันสร้างบัญชี Google หรือวันสมัคร Space อื่น สมาชิกเก่าที่นำเข้าจะแสดงวันเพิ่มเข้าระบบหลาย Space; หากไม่มีวันที่จะแสดงท้ายรายการ
3. ตรวจผู้สมัครและทีมให้ถูกต้อง แล้วกด **อนุมัติ** เพื่อเปิดเฉพาะ Space นี้ การเปลี่ยนบทบาทใช้ **แก้ไขบทบาท**
4. หากแสดง **บัญชี: ปิดทั้งระบบ** ให้ Owner กด **เปิดบัญชีทั้งระบบ** ที่แถวเดียวกันและยืนยัน จากนั้นอนุมัติ Space ที่ต้องการ การเปิดบัญชีไม่อนุมัติ Space ที่ยังรออยู่ ส่วนสมาชิกที่อนุมัติไว้ก่อนจะกลับเข้าได้
5. **ปิดสมาชิก** มีผลเฉพาะทีมนี้ ส่วน **ปิดบัญชีทั้งระบบ** (Owner เท่านั้น) มีผลทุก Space โดยเก็บข้อมูลและ membership เดิมไว้ ระบบป้องกันการเปิด–ปิด Owner และการปิด Admin คนสุดท้ายของทีมใดก็ตาม ตรวจสิทธิ์ใหม่ทุก protected request

ในระบบหลาย Space บัญชีใหม่ใช้ User ID `REG-…`, Role=Agent, **Users.Active=true** ส่วน **Workspace Members.Active=false** รออนุมัติ และ LINE Notifications=false การสมัครไม่สร้าง app session บัญชีซ้ำไม่เปลี่ยนชื่อ/รหัส/โทร/Role/Active เดิม รุ่นเก่าที่ปิดระบบหลาย Space เท่านั้นที่สร้าง Users.Active=false

Control Base ยังเป็นแหล่งสิทธิ์จริง ปุ่มบัญชีทั้งระบบเขียนเฉพาะ `Users.Active`; ปุ่มสมาชิกเขียน `Workspace Members` ไม่มีการเปิด Active ใน Users ของ Base งานตามไปด้วย หากต้องตรวจรหัสตัวแทน/โทรศัพท์ ให้ตรวจข้อมูลที่ผู้สมัครกรอกใน Control Users กับข้อมูลที่คุณรู้จัก ข้อมูลเหล่านี้ไม่ได้ยืนยันด้วย SMS หรือทะเบียนตัวแทน อย่าล้าง Google Subject เพื่อย้ายบัญชี

## หมายเหตุสำหรับผู้ดูแลระบบ

`POST /api/spaces` action `user-status` ต้องผ่าน session, CSRF และ Owner ปัจจุบันบนเซิร์ฟเวอร์ ตรวจผู้ใช้เป้าหมายใน Space ที่เปิดอยู่ ป้องกันบัญชี Owner และตรวจ Admin ที่ยัง Active ในทุก Space ของผู้ใช้ก่อนปิดบัญชี การเปลี่ยน global Active และบทบาทสมาชิกผ่านเว็บใช้ transaction lock ร่วมกัน บันทึกผู้ดำเนินการ/ผู้ใช้เป้าหมายใน `hvr_workspace_events` ไม่เปลี่ยน schema ของ Airtable หรือเพิ่ม migration

การแก้ Airtable โดยตรงยังทำได้และมีผลต่อสิทธิ์ แต่จะไม่ผ่านเงื่อนไขป้องกัน Admin คนสุดท้ายของหน้าเว็บ หากมีการแก้พร้อมกันจาก Airtable ผู้ดูแลต้องตรวจสถานะล่าสุดประกอบ ไม่ควรถือ transaction lock ของเว็บเป็น lock ครอบคลุม Airtable editors

## ติดตั้งและทดสอบ

- เพิ่ม `Agent Code` แบบ Single line text และ `Phone` แบบ Phone number ใน Users ทั้ง test และ production
- รัน migration `003_agent_registration.sql` ก่อน deploy รุ่นนี้ เป็นการเพิ่มข้อมูลโดยไม่ลบตารางเดิม รองรับโค้ด Login รุ่นก่อน
- OAuth ใช้ client/callback และ scopes `openid email profile` เดิม ไม่ต้องสร้าง credential ใหม่ [Google ระบุข้อยกเว้นของ basic identity scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) สำหรับรายชื่อ test users; นโยบาย Workspace อาจจำกัดได้
- การพัก writes ใน config/DB จะพักการสมัครด้วย ไม่เปิด jobs หรือส่งข้อความแจ้งเตือนอัตโนมัติ
- ทดสอบ OAuth/approval/duplicate/concurrency ด้วย `npm run test:integration`; ฟอร์มและ API origin/privilege validation อยู่ใน `npm run test:api` บนฐานข้อมูลทดสอบแยก

## คำขอที่ต้องตรวจสอบ

`hvr_registrations` จอง Google Subject และอีเมลแบบ unique ก่อนเขียน Airtable หากการตอบกลับสูญหายหรือ Function หยุด จะไม่ส่ง write ซ้ำอัตโนมัติ หน้าสมัครจะแนะนำติดต่อผู้ดูแล อ่าน Users และ reservation ด้วยผู้ดูแลเพื่อเทียบ verified identity ก่อนดำเนินการ ห้ามล้าง reservation หรือสร้าง User ซ้ำโดยไม่ตรวจว่า write เดิมจบแล้ว ถ้าพบ User ที่ถูกต้องแต่ Active=false สามารถตรวจและอนุมัติตามปกติได้

ข้อมูลฟอร์มอยู่ชั่วคราวใน `hvr_oauth.registration` และใน registration journal เพื่อช่วยตรวจคำขอ ไม่ส่งลง URL หรือ public user directory สำรองฐานข้อมูลต้องรวมตารางใหม่ `hvr_registrations`; ยังไม่มีงานล้างข้อมูลหมดอายุอัตโนมัติ
