# แผนพัฒนา Web App บน Vercel

วันที่: 5 พฤศจิกายน 2026 · อัปเดต 6 พฤศจิกายน 2026: พัฒนาและทดสอบบนเครื่องแล้ว เจ้าของอนุญาต GitHub / Vercel และมี [deployment แรก](vercel-first-deployment.md) ออนไลน์ แต่ยังไม่ตั้ง backend cloud หรือสลับ production ดู [หลักฐานและงานคงเหลือ](vercel-progress.md)

## 1. เป้าหมายและขอบเขต

ย้าย Happy Victory Rinlyn Task Center จาก Google Apps Script เป็น Next.js บน Vercel โดยใช้ Airtable เดิม รักษา UI ภาษาไทย สิทธิ์ Agent / Secretary / Admin และเวลา `Asia/Bangkok` เริ่มจากทำระบบใหม่คู่กับระบบเดิม แล้วสลับเมื่อผ่านเกณฑ์ใน [แผน Deploy](vercel-deployment-plan.md)

รุ่นที่จะเปิดใช้งานต้องมี Google Login, Dashboard, รายการและรายละเอียดงาน, ส่งงาน, ความคืบหน้า, บันทึกภายใน, นัดติดตาม, ปฏิทิน, รายงาน และหน้าทีมตามระบบเดิม ลิงก์มือถือใช้ `/tasks/new` และกลับมาที่ฟอร์มหลัง Login ได้

การส่ง LINE / อีเมลเป็นระยะถัดไปและเริ่มด้วย flags ปิดเหมือนระบบปัจจุบัน การอัปโหลดไฟล์ยังจัดการผ่าน Airtable ไม่มีการเพิ่มระบบรหัสผ่าน การลบงานถาวร หรือย้ายข้อมูลธุรกิจออกจาก Airtable ในงานนี้

## 2. สถานะตั้งต้น

- โค้ด production อยู่ใน `apps-script/`; เว็บเดิม Deploy เวอร์ชัน 4 รายละเอียดอยู่ใน [deployment.md](deployment.md)
- Airtable มี Users, Tasks, Task Updates, Follow-ups และ Notifications ใช้ [schema เดิม](database-schema.md) และ [Base/Table mappings](airtable-connection.md)
- มี Admin เจ้าของระบบแล้ว ยังไม่มี Agent / Secretary จริงครบสำหรับทดสอบหลายบัญชี Google OAuth ยังเป็น External / Testing
- มีชุดทดสอบเดิม 60 รายการ แต่ยังไม่ได้ยืนยันทุก flow กับหลายบัญชีและ LINE บนมือถือจริง ดู [validation.md](validation.md)
- ตอนเริ่มแผน checkout ไม่มี Git; ปัจจุบัน push initial commit ขึ้น GitHub / main, CI ผ่าน และเชื่อม Vercel กับ repo แล้ว

## 3. สถาปัตยกรรมที่เสนอ

| ส่วน | แนวทาง |
|---|---|
| เว็บและ API | Next.js App Router + TypeScript; Route Handlers ใช้ Node.js runtime |
| ข้อมูลธุรกิจ | Airtable เดิมเป็นแหล่งข้อมูลหลักของทั้ง 5 ตาราง |
| สถานะระบบ | PostgreSQL สำหรับ session, OAuth state, operation journal, coordination และ runtime switches |
| Google Login | OIDC authorization code + PKCE ผ่าน library ที่ดูแลต่อเนื่อง; ผูกกับ Users เดิม |
| Deploy | Vercel; แยก Development / Preview / Production และใช้ staging origin คงที่สำหรับ OAuth |
| แจ้งเตือน | คง Notifications เป็นประวัติธุรกิจ; PostgreSQL เก็บสถานะ worker และการจองงาน ไม่สร้างคิวส่งซ้ำอีกชุด |

เลือก Node.js `24.x` ซึ่ง [Vercel รองรับ](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) ตรึง Next.js / React / OIDC library รุ่น stable ที่เข้ากันและไม่มี advisory ค้างใน milestone M0 พร้อม lockfile ไม่กำหนดเลขรุ่นจากความจำ

ผู้ให้บริการ PostgreSQL, region, backup retention และงบประมาณต้องสรุปใน M0 ก่อนสร้างทรัพยากร ไม่ใช้ memory หรือไฟล์ภายใน Vercel Function เป็นแหล่งข้อมูลถาวร ไม่จำเป็นต้องเพิ่ม Redis ในรุ่นแรก

### แปลงบริการที่ผูกกับ Apps Script

| ปัจจุบัน | สิ่งที่ต้องพัฒนา |
|---|---|
| `doGet`, HTML include, `google.script.run` | หน้า Next.js, components และ HTTP API |
| `PropertiesService` สำหรับ secrets | Environment Variables ฝั่งเซิร์ฟเวอร์ |
| `PropertiesService` สำหรับ operation / flags / DATA_VERSION | ตาราง PostgreSQL และ version สำหรับ invalidation |
| `CacheService` สำหรับ OAuth / session | สถานะอายุจำกัดใน PostgreSQL; session เก็บ hash ของ token |
| `LockService` | การประสานงานผ่านฐานข้อมูลที่ใช้ร่วมกันทุก Function instance |
| `UrlFetchApp`, `Utilities` | Server-side fetch, Node crypto และฟังก์ชันวันที่ไทย |
| `ScriptApp` triggers, `MailApp` | Scheduler / worker และผู้ให้บริการอีเมลในระยะแจ้งเตือน |

## 4. โครงสร้างและ API เป้าหมาย

เพิ่มแอปใหม่ใน `web/` เพื่อให้คำสั่งและแอปเดิมทำงานต่อได้:

```text
web/
  src/app/                 หน้าเว็บและ api/**/route.ts
  src/components/          UI และฟอร์มภาษาไทย
  src/server/auth/         Google identity, session และ authorization
  src/server/airtable/     repository, pagination, rate limiter และ DTO
  src/server/services/     tasks, followups, notifications
  src/server/operations/   journal, recovery และ coordination
  db/migrations/          schema สถานะระบบ; ไม่มีข้อมูลลูกค้า
  tests/                   unit / integration / browser tests
  .env.example             เฉพาะชื่อและค่า placeholder
```

| Endpoint เป้าหมาย | หน้าที่ |
|---|---|
| `GET /api/auth/google`, `GET /api/auth/google/callback` | เริ่มและรับ Google Login |
| `POST /api/auth/logout` | เพิกถอน session ฝั่งเซิร์ฟเวอร์ |
| `GET /api/bootstrap`, `GET /api/tasks/:id` | อ่านข้อมูลที่กรองตามสิทธิ์แล้ว |
| `POST /api/tasks` | สร้างงานด้วย idempotency key |
| `POST /api/tasks/:id/status`, `/comments`, `/followups` | เปลี่ยนสถานะ เพิ่มข้อความ หรือนัดติดตาม |
| `POST /api/tasks/:id/followups/:followupId/resolve` | บันทึกผลนัดที่เป็นของงานนั้น |
| `GET /api/operations/:id` | ติดตามผลคำขอ เฉพาะผู้ใช้ที่มีสิทธิ์ |
| `POST /api/line/link`, `GET /api/line/callback`, `PATCH /api/line/preferences` | เชื่อมและตั้งค่า LINE ใน M7 หลัง Google session ผ่านแล้ว |
| `GET /api/cron/dispatch`, `GET /api/cron/recover` | dispatch / recovery ใน M7; ตรวจ scheduler secret ไม่ใช้ session ผู้ใช้ |
| `GET /api/health` | liveness เท่านั้น; diagnostics ที่อ่านบริการจริงต้องจำกัดผู้ดูแล |

ใช้ validation ฝั่งเซิร์ฟเวอร์และ error codes สม่ำเสมอ: 401 ไม่มี session, 403 ไม่มีสิทธิ์, 409 version / operation ขัดแย้ง และ 422 ข้อมูลไม่ถูกต้อง งานที่ยังไม่เสร็จคืน 202 พร้อม operation ID ฟอร์มต้องรอผลสำเร็จก่อนแจ้งว่า “ส่งงานแล้ว”

## 5. เงื่อนไขที่ต้องรักษา

### Identity และข้อมูลส่วนตัว

- ใช้ scopes `openid email profile`; ตรวจ issuer, audience, expiry, state, nonce, PKCE และ verified identity ผ่าน library ตาม [Google OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- รับสมาชิกจาก Users ที่ Active เท่านั้น ผูก Google Subject เดิม ห้ามสร้าง Admin หรือยกระดับ role จาก browser ตรวจบัญชีซ้ำและ Subject ที่ไม่ตรงให้ปฏิเสธ
- session อายุเริ่มต้น 6 ชั่วโมง เก็บ opaque token ใน cookie `HttpOnly`, `Secure` บน HTTPS, `SameSite=Lax`, `Path=/`; hash อยู่ PostgreSQL ไม่มี app token ใน localStorage / sessionStorage รุ่นใหม่ ผู้ใช้ต้อง Login ใหม่หลังย้าย
- ตรวจ Active, Role และ Subject จาก Users ทุก protected request ก่อนใช้ข้อมูล cache เมื่อ dependency ตรวจสิทธิ์ล่มให้ปฏิเสธไว้ก่อน
- ตรวจสิทธิ์ใน service / API ทุกทางเข้า ไม่พึ่งการซ่อนปุ่มหรือ route guard อย่างเดียว ตาม [แนวทาง Next.js authentication](https://nextjs.org/docs/app/guides/authentication)
- mutation ตรวจ Origin และ CSRF token; return URL รับเฉพาะ path ภายในที่อนุญาต เช่น `/tasks/new` ป้องกัน open redirect
- หน้าข้อมูลและ API ตั้ง `Cache-Control: private, no-store` ไม่ทำ static generation / CDN cache ข้อมูลผู้ใช้ ห้ามส่ง internal notes, Google Subject หรือ secrets ไป Agent

### การเขียนข้อมูลและ recovery

- รักษากฎ [security-and-testing.md](security-and-testing.md): Agent ส่งเฉพาะงานตนเอง; Secretary / Admin เลือก Agent ที่ Active; นัดติดตามและบันทึกภายในจำกัดสิทธิ์
- Journal มี unique `(environment, userId, requestId)` และ payload fingerprint; step ที่สำเร็จแล้วต้องไม่ทำซ้ำ ใช้ Request Key / Operation Key เดิมใน Airtable
- PostgreSQL ประสานการเขียนและ rate limit รวมต่อ Base ข้าม Function instances; ทดสอบสองคำขอพร้อมกันจริง ไม่ใช้ตัวแปร global แทน lock
- ตรวจ Last Update ก่อนเปลี่ยนสถานะ รักษา Completed At เดิมเมื่อบันทึก Completed ซ้ำ และคำนวณ Next Follow-up จาก Pending ที่เร็วที่สุด
- PostgreSQL และ Airtable ไม่มี transaction ร่วมกัน หาก timeout ไม่ทราบผล ให้คง journal และกันคำขอขัดแย้งจน reconcile ด้วย operation key; ห้ามปล่อย lock ตาม TTL แล้วเขียนซ้ำโดยไม่ตรวจ ไม่อ้างว่ามี exactly-once หรือ atomic compare-and-set ใน Airtable
- การแก้ Airtable โดยตรงข้าม application lock ได้ ต้องมีขั้นตอนหยุดเขียนก่อนซ่อมข้อมูล การสลับระบบต้องมีผู้เขียนหลักเพียงระบบเดียว
- รองรับ pagination, shared backoff และ 429; [Airtable จำกัด 5 requests/วินาทีต่อ Base และให้รอ 30 วินาทีหลังเกิน rate](https://support.airtable.com/docs/managing-api-call-limits-in-airtable) เลื่อน retry ผ่าน durable journal แทนรอวนจน Function หมดเวลา

## 6. ลำดับพัฒนาและเกณฑ์จบ

| Milestone | งาน | เกณฑ์ผ่าน |
|---|---|---|
| M0 — เตรียม | สรุป provider / งบ / domains / versions, Git, test Base และบัญชี Admin + Secretary + Agent A/B | มี configuration matrix, backup และเจ้าของทรัพยากร; ไม่ใช้ production PAT ใน Preview |
| M1 — พื้นฐาน | scaffold `web/`, config validation, PostgreSQL migrations, Airtable adapter และคำสั่ง CI | build / typecheck ผ่าน; diagnostics อ่าน schema ทดสอบ 5 ตารางโดยไม่เผย secrets |
| M2 — Login | OIDC, sessions, Users mapping, authorization, CSRF และ `/tasks/new` | Login / logout / หมดอายุ / ปิด Active / forged role / return URL ผ่าน |
| M3 — งานหลัก | Dashboard, รายการ, detail, create, comments, status, followups และ operation recovery | Agent A/B ไม่เห็นข้ามเจ้าของ; retry / คำขอพร้อมกัน / partial failure ไม่ทำงานซ้ำในกรณีทดสอบ |
| M4 — ความครบถ้วน | calendar, reports, team, mobile, loading / errors / accessibility | เทียบฟังก์ชันเดิมครบ; ทดสอบ Chrome, Safari และ Rich Menu จริงทั้ง iOS / Android |
| M5 — ทดลองใช้ | Deploy staging, หลายบัญชี, network failure และ rehearsal สลับกลับ | acceptance evidence ครบ ไม่มีข้อผิดพลาดร้ายแรงหรือสูงค้าง; owner รับรองผล |
| M6 — เปิดใช้ | ทำ cutover ตาม deployment runbook | Vercel เป็นผู้เขียนหลัก, Rich Menu ใช้ URL ใหม่, มีผู้ดูแลติดตามผล |
| M7 — แจ้งเตือน | LINE linking, summary 08:00 / 18:00 และอีเมล | ตั้ง credentials / ผู้รับจริงและทดสอบกับผู้รับที่ระบุ ก่อนเปิด flags |

ดำเนิน M0 → M6 ตามลำดับ; ประเมินระยะเวลาหลังเลือกบริการและทดลอง port auth / journal ใน M1–M2 ไม่กำหนดวันเปิดใช้ก่อนผ่าน gate ไม่ถือว่าชุดทดสอบ Apps Script เดิมผ่านแล้วเท่ากับ backend ใหม่ผ่าน

## 7. แผนตรวจสอบและ Definition of Done

ปรับ regression cases จาก `tests/backend.test.mjs`, `line.test.mjs` และ `navigation.test.mjs` ให้ทดสอบ service ใหม่ เพิ่ม integration tests กับ PostgreSQL ทดสอบจริงและ Airtable test Base; browser tests ใช้ Playwright ทดสอบผู้ใช้หลาย profile และ return-to-form

ใช้ OAuth doubles ใน browser CI; การเลือกบัญชี / ยืนยันสิทธิ์ Google จริงให้เจ้าของบัญชีทำใน acceptance test ไม่เก็บรหัสผ่านหรือพยายาม automate หน้ายืนยันตัวตนของ Google

คำสั่งใน `web/` คือ `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run build` — **สร้างและตรวจบนเครื่องแล้ว** พร้อม `npm run test:postgres` และ `npm run test:api` ที่ต้องใช้ PostgreSQL ทดสอบแยก ดู [ผลตรวจและข้อจำกัด](vercel-progress.md) ครอบคลุม timeout หลัง Airtable เขียนสำเร็จ, idempotency replay, stale version, duplicate OAuth callback, invalid CSRF และเวลาเที่ยงคืนกรุงเทพฯ

เกณฑ์เปิดใช้: M0–M5 ผ่าน, มี screenshots มือถือและผลทดสอบแยก role, ไม่มี secret ใน client bundle / logs, ผู้ใช้จริงที่จำเป็น Login ได้, สคริปต์ maintenance และ rollback ซ้อมแล้ว และ notifications ยังปิดจนผ่าน M7

## 8. สิ่งที่ต้องสรุปก่อนเริ่ม implementation

- เจ้าของ Git / Vercel team, แผนค่าใช้จ่ายและ spending alerts
- Production domain, staging domain และผู้ดูแล DNS
- PostgreSQL provider / region / backups และขอบเขตข้อมูล operational ที่เก็บได้
- OAuth client แยก staging / production, รายชื่อบัญชีทดสอบ และสถานะ Audience ที่จะใช้กับทีมจริง
- ผู้ให้บริการอีเมลและ LINE OA credentials เฉพาะเมื่อทำ M7

เอกสารนี้อนุมัติแนวทางการเตรียมงาน ไม่ได้สร้างบัญชี ซื้อแผน เพิ่มสิทธิ์ credentials หรือสลับผู้ใช้งานจริง
