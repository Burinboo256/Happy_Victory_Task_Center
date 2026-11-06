# สถานะทดสอบ localhost กับบริการจริง

อัปเดต 6 พฤศจิกายน 2026: เจ้าของอนุญาต **เตรียม Base ทดสอบและ OAuth สำหรับ localhost** ไม่ได้อนุญาต Deploy / cutover จากขั้นตอนนี้

## ทรัพยากรทดสอบ

| รายการ | สถานะ |
|---|---|
| Airtable test Base | สร้างและตั้งชื่อ **Happy Victory Task Center — Local Test** ใน My First Workspace แล้ว |
| Base ID / ลิงก์ | [`appoQzvQwGShlq4OJ`](https://airtable.com/appoQzvQwGShlq4OJ) |
| 5 business tables | สร้าง Users, Tasks, Task Updates, Follow-ups, Notifications และ writable fields / links ด้วย Scripting สำเร็จแล้ว |
| Formulas / Lookups / single-link preferences | ตั้งผ่าน UI ครบ 22 รายการ และ schema diagnostics ผ่านแล้ว |
| Runtime PAT | สร้างใหม่ data.records:read / write เฉพาะ test Base; เก็บใน ignored `web/.env.local` |
| Schema-read PAT | สร้างใหม่ schema.bases:read เฉพาะ test Base ใช้ CLI เท่านั้น; เก็บใน ignored `web/.env.local` |
| Google OAuth client | สร้าง **Happy Victory Task Center — Local Development** แยกใน project เดิม; origin `http://localhost:3000`; secret อยู่เฉพาะ `.env.local` |
| Callback ที่ต้องลงทะเบียน | `http://localhost:3000/api/auth/google/callback` |
| `.env.local` / operational DB สำหรับ acceptance | ตั้งแล้ว; PostgreSQL 17 ใน `hvr-local-postgres-1`, loopback port 55433, persistent volume; migrations 001 / 002 ผ่าน แยกจาก test runner |

ไม่มี records หรือ credentials จาก production ถูกคัดลอกมายัง Base นี้ การนำทางผ่านหน้า production ที่เปิดอยู่ใช้เพียงกลับ Home แล้วสร้าง Base ใหม่

Google Login ของเจ้าของสำเร็จจริงหลังเจ้าของเลือกบัญชี / ยืนยันเอง และ Dashboard อ่านงานจาก test Base ได้ ผู้ใช้ `LOCAL-ADMIN` ใช้ email ของเจ้าของที่ได้รับอนุญาต ส่วน `LOCAL-AGENT-A/B` และ `LOCAL-SECRETARY` เป็นข้อมูลสมมติชื่อ `[LOCAL TEST]` ใช้ email `.invalid` สำหรับซ้อม service / recovery

ภายหลังเจ้าของระบุบัญชีจริงสำหรับ Secretary, Agent A และ Agent B จึงเพิ่ม `TEST-SECRETARY`, `TEST-AGENT-A` และ `TEST-AGENT-B` แยกจาก actors สมมติ พร้อมเพิ่มใน Google OAuth Testing audience ของ project เดิม (รวมเจ้าของเป็น 4 test users) เจ้าของทำ authentication เองครบทั้งสี่บัญชี ตรวจ role, session และ Subject binding ผ่านจริง หลักฐาน `artifacts/vercel/live-account-TEST-SECRETARY.json`, `live-account-TEST-AGENT-A.json` และ `live-account-TEST-AGENT-B.json` ไม่เก็บอีเมลจริงในเอกสารนี้

Admin และ Secretary logout ผ่านหน้าเว็บแล้ว active sessions ใน PostgreSQL ลดเป็น 0 ก่อนสลับบัญชี Secretary สร้าง `HVR-00005` ส่งให้ Agent A จริงและบันทึกข้อความ / นัดภายใน Agent A Login จาก `/tasks/new` กลับฟอร์มเดิมได้ ไม่มีตัวเลือกเจ้าของอื่น รายการแสดงเฉพาะงานที่มอบหมาย และ detail ไม่แสดงข้อความภายใน / นัดภายใน / controls ของ Secretary

Agent A ส่ง comment ผ่าน session จริงแล้วประวัติเป็น Visible to Agent ตรวจ GET detail API ด้วย browser session นี้ได้ updates 2 รายการ / followups 0 และไม่มีข้อความภายใน ลองเปิด API ของงานเจ้าของอื่นได้ FORBIDDEN ทดสอบปิด Active ของ `TEST-AGENT-A` ชั่วคราวแล้ว session เดิมอ่านงานไม่ได้ คืน Active เดิมแล้วอ่านได้อีกครั้ง จากนั้น logout และตรวจ active sessions เป็น 0

Agent B Login จริงแล้วไม่เห็นงาน Agent A ในรายการ เปิด detail API ของงาน Agent A ได้ FORBIDDEN และสร้าง `HVR-00007` ของตนเองได้ ตรวจ Airtable Agent link และ journal creator ตรงกับบัญชีจริง หลักฐาน `artifacts/vercel/live-role-ui.json` และ `real-role-writes.json` มี identity bindings 4 บัญชี, ไม่มี pending / running / review หรือ reservation ค้าง และ notification records ยังไม่ส่ง รอบแรกนี้สลับ Login ตามลำดับ; การทดสอบสอง profiles พร้อมกันแยกไว้ด้านล่าง

## สอง browser profiles พร้อมกัน

เจ้าของ Login Agent A ใน Chrome ไม่ระบุตัวตนด้วยตัวเอง ขณะที่ Agent B อยู่ใน Chrome ปกติ ตรวจ PostgreSQL ได้ active sessions สองบัญชีพร้อมกัน ทั้งสองเปิด detail API ของงานอีกเจ้าของแล้วได้ FORBIDDEN ไม่มีข้อมูล task กลับมา

ซ้อมสร้างงานผ่าน HTTP บนพอร์ต 3001 ด้วย session จริงทั้งคู่ ใช้ preloader โหมด `barrier` หน่วง acknowledgement ของ task ที่ Airtable ยืนยันแล้วเฉพาะ marker `[HTTP CONCURRENT TEST]` ให้เกิดช่วงคำขอซ้อนกัน ไม่มีการสร้าง session จำลอง ผู้สังเกต PostgreSQL แยก process พบ journals สถานะ running พร้อมกัน 2 รายการ จาก 2 ผู้ใช้ที่ยังมี active session งาน `HVR-00010` / `HVR-00011` จบ completed มี task / audit อย่างละ 1 และคำขอเขียนอย่างละ 1 ต่อ operation เจ้าของตรงบัญชี ไม่มี reservation ค้าง

รอบแรก barrier 20 วินาทีหมดก่อนส่งฟอร์มที่สอง จึงไม่ผ่าน concurrency และเก็บรายงานล้มเหลวไว้ ปิด writes / หยุด invocation แล้วใช้ CLI ตรวจ task ที่รับสำเร็จ คืน pending และ retry ฟอร์มเดิมจน completed โดยไม่สร้างซ้ำ จากนั้นขยายขอบเขตรอเฉพาะเครื่องมือทดสอบเป็น 60 วินาทีและซ้อมรอบใหม่จนผ่าน ผลนี้พิสูจน์คำขอจากต่างเจ้าของซ้อนกันได้ภายใต้การหน่วงที่ควบคุมไว้ ไม่ใช่ผลวัด latency / load จริง หรือ live HTTP contention บนงานเดียวกัน

หลังซ้อม Agent A logout แล้ว DB เหลือ active session ของ Agent B เพียงบัญชีเดียว Agent B โหลดงานของตนเองใหม่บนพอร์ต 3000 สำเร็จ เซิร์ฟเวอร์ซ้อม 3001 หยุดแล้ว หลักฐานอยู่ใน ignored artifacts:

- `artifacts/vercel/concurrency-afbd30d8-6e6e-4868-a771-7a4d9e68e72a.json` — ผล overlap และ task / audit counts
- `artifacts/vercel/live-http-519a701a-163e-4a6c-91d7-9d82407182c3-observer-failed.json` — รอบแรกที่ไม่ผ่าน
- `artifacts/vercel/multi-profile-ui.json` และ `profile-sessions-before-logout.json` / `profile-sessions-after-logout.json` — ownership และ session isolation

## HTTP retry และข้อมูลถูกแก้ตรง

เปิด production build ชั่วคราวเฉพาะ `127.0.0.1:3001` โดยใช้ session Google ของ Agent A จริง, PostgreSQL และ Airtable เดิมของ development; ไม่สร้าง session จำลองหรือเพิ่ม auth bypass ใช้ Node preloader ใน `web/tests/support/live-airtable-preload.mjs` ที่จำกัด test Base / origin / marker `[HTTP LIVE TEST]` จำลองคำตอบหายครั้งเดียวหลัง Airtable ตอบสำเร็จ control file อยู่ใน ignored artifacts ไม่มี application control endpoint

คำขอสร้าง `HVR-00006` เข้า review โดย task upsert 1 ครั้ง / audit 0 ฟอร์มคง payload และ key เดิมไว้ ปิด DB writes และเปลี่ยนชื่อ task สมมตินี้โดยตรง CLI `ops:recover` คง review กับ unresolved task และ reservation เดิม หลังคืนชื่อเดิม CLI ยืนยัน task และเปลี่ยน pending เปิด writes แล้วส่งฟอร์มเดิมผ่าน browser จบ completed มี task 1 / audit 1, task upsert รวม 1 ครั้ง, audit upsert 1 ครั้ง, เจ้าของและผู้สร้างเป็น Agent A จริง และไม่มี reservation ค้าง

หลักฐาน `artifacts/vercel/live-http-result-a62025c4.json` เก็บ recovery states review / pending และผลตรวจ negative drift เซิร์ฟเวอร์พอร์ต 3001 หยุดแล้ว เว็บหลัก `localhost:3000` ทำงานตามปกติ preloader นี้ไม่ใช้ใน runtime ปกติหรือ Deploy

เปิดเว็บบนเครื่องที่ `http://localhost:3000` (Next dev bind `127.0.0.1:3000`) เปิด writes เฉพาะ development ทั้ง env / DB แล้ว; jobs, email และ LINE ปิดอยู่ OAuth client ของ Apps Script และ Base production ไม่ถูกแก้ไข

ทดสอบผ่านเว็บหลัง Login จริง: สร้าง `HVR-00002`, เปลี่ยน New → In Progress, เพิ่มข้อความภายใน, เพิ่มนัดและปิดนัดเป็น Done ตรวจ Airtable ได้ประวัติ 5 รายการ / internal comment ไม่ Visible to Agent / Completed At ของนัดมีค่า / Next Follow-up ว่าง ตรวจ PostgreSQL ได้ operations ทั้ง 5 actions เป็น completed อย่างละ 1, ไม่มี resource reservation ค้าง, active session และ identity binding อย่างละ 1 หลักฐาน `artifacts/vercel/local-live-acceptance.json` ไม่เก็บ secret หรือเนื้อหางาน

มีงาน canary สำหรับทดสอบ Last Update: เปลี่ยน Description และ Priority แล้ว timestamp ขยับทั้งสองครั้ง (`artifacts/vercel/last-update-live.json`) การตั้ง “All editable fields” คืน `referencedFieldIds: []` ผ่าน API จึงเพิ่ม regression case ให้ validator รองรับทั้ง `null`, empty array และรายการครบทุก editable field; รายการบางส่วนยังไม่ผ่าน

สคริปต์ที่รันจำกัด Base ID เป็น `appoQzvQwGShlq4OJ` และรายงานจบว่าไม่ได้อ่านหรือเขียน records ยังเก็บ Table 1 / แถวว่างเริ่มต้นของ Airtable ไว้ ไม่ใช่ตารางที่แอปจะเชื่อมต่อ

| Mapping | Table ID ที่ได้จาก Scripting |
|---|---|
| Users | `tblJu8i8zWNwgPC41` |
| Tasks | `tblSLk6qE9inJLEIL` |
| Task Updates | `tbl47H6HQQHJimVfR` |
| Follow-ups | `tblcJXLWWJvJLqDeX` |
| Notifications | `tblnoRTXd96Rk5YWW` |

## หลักฐานที่ยังต้องเก็บ

- [x] ตรวจ schema / table IDs ด้วย `npm run diagnose` ผ่านทั้ง 5 ตาราง โดยไม่แสดง credentials หรือ record contents
- [x] Google consent / callback ของเจ้าของบน localhost และอ่าน Dashboard จาก Airtable จริง
- [x] Create / status / internal comment / followup / resolve ผ่าน session จริง พร้อมเทียบ Airtable กับ durable journal
- [x] Logout ของ Admin, Secretary และ Agent A ผ่าน session จริง และตรวจ DB session ถูกเพิกถอน
- [x] ซ้อม lost acknowledgement / review / recovery / replay ทั้ง 5 actions กับ Airtable จริง รวม process ที่หยุดจริงและรออายุขั้นต่ำ โดยใช้ service actors สมมติ
- [x] Admin, Secretary, Agent A/B Login จริงแยกบัญชี ตรวจ return-to-form และการแสดงข้อมูลตาม role
- [x] Replay ผ่าน HTTP session จริง และ negative recovery ที่มีข้อมูลถูกแก้โดยตรงใน test Base
- [x] ปิด / คืน Active ระหว่าง session จริง และตรวจสิทธิ์ใหม่ผ่าน HTTP
- [x] ทดสอบสอง browser profiles พร้อมกัน ตรวจข้ามเจ้าของทั้งสองทิศทาง และ logout ไม่กระทบอีกบัญชี
- [x] สร้างงานต่างเจ้าของผ่าน HTTP พร้อมกัน โดยควบคุมช่วงรอ acknowledgement; task / audit ไม่ซ้ำ
- [x] Local HTTP load rehearsal ตามขนาดที่เจ้าของระบุ 5 session / 250 งาน ใช้ Airtable สมมติและ PostgreSQL จริง; [ผลและข้อจำกัด](vercel-load-acceptance.md)
- [ ] ทดสอบมือถือ / screen reader และวัดปริมาณงานใกล้ทีมจริงก่อน release acceptance

คืนข้อมูลประเภทงาน / วันที่ส่งงานใน detail ให้ครบ และแสดงปีในวันกำหนดส่ง / นัด พร้อมวันที่และเวลา Bangkok ใน timeline ตรวจข้ามเที่ยงคืนด้วย E2E ของ Secretary และสแกน axe หน้าหลักบน desktop / mobile รวม 4 cases ผ่าน; TypeScript, Biome และ production build ผ่าน ไม่ได้รันชุด browser / API จำลองทั้งหมดซ้ำ ผล unit 25 / integration 15 เป็นรอบก่อนแก้ UI นี้ สแกน production server / static output ล่าสุด 350 ไฟล์ ไม่พบค่า secrets ทั้ง 6 รายการที่ตั้งในเครื่อง (`artifacts/vercel/build-secret-check.json`)

Next dev กรอง OAuth callback request logs แล้ว ตรวจ canary code / state ไม่ถูกพิมพ์ และ health request ยังถูก log ตามปกติ ต้องตรวจ platform / proxy logs เพิ่มก่อน Deploy

ช่องทางอีเมล / LINE, jobs และ production writes ยังคงอยู่นอกการเปิดใช้รอบนี้ ตาม [แผน Deploy](vercel-deployment-plan.md)
