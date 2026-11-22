# ลงทะเบียนตัวแทน

## ระบบหลาย Space: ลิงก์ปัจจุบัน

ใช้ `/{space-slug}/register` เช่น `/rinlyn/register` คัดลอกจาก **ลิงก์ลงทะเบียนของ Space นี้** ในหน้า `/spaces` ฟอร์มแสดงชื่อ Space และส่ง Workspace ID ที่เซิร์ฟเวอร์ตรวจจาก slug ไม่อ่าน Space ล่าสุดหรือ cookie แทนทีมในลิงก์

หลัง Google ยืนยัน จะกลับ `/{space-slug}/register?status=pending` (หรือ existing/review) หาก Google ปฏิเสธคำขอที่ยังมี state ถูกต้อง จะกลับหน้าสมัครของทีมเดิมพร้อมข้อความผิดพลาด ลิงก์ Login บนหน้าผลสมัครกลับเข้าทีมเดิม และลิงก์สมัครจาก Login ที่มีปลายทางแบบระบุ Space ใช้ทีมเดียวกัน

ลิงก์เก่า `/register?space=<UUID>` ยังใช้ได้และ redirect ไปชื่อ URL ของทีมนั้น รวม status/error ที่ระบบรองรับ ส่วน `/register` ที่ไม่ระบุทีมใช้ Space เริ่มต้น จึงควรแจกเฉพาะลิงก์ระบุทีม สมัครแล้วต้องผ่านการอนุมัติสมาชิกใน Space และ Active ส่วนกลางก่อนใช้งานจริง Space ที่พักหรือไม่พบจะไม่แสดงฟอร์มและไม่สลับไปทีมอื่น

ไม่ต้องเพิ่ม Google OAuth callback หรือ migration ใหม่ รุ่นหลาย Space ใช้ Control Base จัดการสิทธิ์สมาชิก รายละเอียดด้านล่างอธิบายกลไกการสมัครเดิมและฐานข้อมูล ไม่ใช้ Active ของ Users ใน Base งานแทนสิทธิ์ส่วนกลาง

หน้า `/register` ใช้ชื่อ–นามสกุล รหัสตัวแทน และเบอร์โทร แล้วให้ผู้สมัครยืนยันบัญชี Google อีเมลและ Google Subject มาจาก Google เท่านั้น ไม่รับ Role, Active หรืออีเมลจากฟอร์ม

## อนุมัติใน Airtable

1. เปิด Base production → Users แล้วกรอง `Role=Agent` และ `Active` ไม่ถูกเลือก
2. ตรวจ Full Name, Email, Agent Code และ Phone กับข้อมูลตัวแทนที่คุณรู้จัก รหัสและโทรศัพท์เป็นข้อมูลที่ผู้สมัครกรอกเอง ไม่ได้ยืนยันด้วย SMS หรือทะเบียนตัวแทน
3. เลือก `Active` เฉพาะบัญชีที่อนุมัติ ผู้สมัครจึง Login ด้วย Google เดิมและใช้งานได้ ไม่ต้อง deploy ใหม่
4. หากต้องระงับบัญชี ให้เอา `Active` ออก ระบบตรวจใหม่ทุก protected request

บัญชีใหม่ใช้ User ID รูปแบบ `REG-…`, Role=Agent, Active=false และ LINE Notifications=false การสมัครไม่สร้าง app session บัญชีซ้ำไม่เปลี่ยนชื่อ/รหัส/โทร/Role/Active ของผู้ใช้เดิม หากต้องแก้ข้อมูล ให้ผู้ดูแลแก้ใน Airtable อย่าล้าง Google Subject เพื่อย้ายบัญชี

## ติดตั้งและทดสอบ

- เพิ่ม `Agent Code` แบบ Single line text และ `Phone` แบบ Phone number ใน Users ทั้ง test และ production
- รัน migration `003_agent_registration.sql` ก่อน deploy รุ่นนี้ เป็นการเพิ่มข้อมูลโดยไม่ลบตารางเดิม รองรับโค้ด Login รุ่นก่อน
- OAuth ใช้ client/callback และ scopes `openid email profile` เดิม ไม่ต้องสร้าง credential ใหม่ [Google ระบุข้อยกเว้นของ basic identity scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) สำหรับรายชื่อ test users; นโยบาย Workspace อาจจำกัดได้
- การพัก writes ใน config/DB จะพักการสมัครด้วย ไม่เปิด jobs หรือส่งข้อความแจ้งเตือนอัตโนมัติ
- ทดสอบ OAuth/approval/duplicate/concurrency ด้วย `npm run test:integration`; ฟอร์มและ API origin/privilege validation อยู่ใน `npm run test:api` บนฐานข้อมูลทดสอบแยก

## คำขอที่ต้องตรวจสอบ

`hvr_registrations` จอง Google Subject และอีเมลแบบ unique ก่อนเขียน Airtable หากการตอบกลับสูญหายหรือ Function หยุด จะไม่ส่ง write ซ้ำอัตโนมัติ หน้าสมัครจะแนะนำติดต่อผู้ดูแล อ่าน Users และ reservation ด้วยผู้ดูแลเพื่อเทียบ verified identity ก่อนดำเนินการ ห้ามล้าง reservation หรือสร้าง User ซ้ำโดยไม่ตรวจว่า write เดิมจบแล้ว ถ้าพบ User ที่ถูกต้องแต่ Active=false สามารถตรวจและอนุมัติตามปกติได้

ข้อมูลฟอร์มอยู่ชั่วคราวใน `hvr_oauth.registration` และใน registration journal เพื่อช่วยตรวจคำขอ ไม่ส่งลง URL หรือ public user directory สำรองฐานข้อมูลต้องรวมตารางใหม่ `hvr_registrations`; ยังไม่มีงานล้างข้อมูลหมดอายุอัตโนมัติ
