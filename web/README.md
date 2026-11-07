# Happy Victory Web

Next.js App Router + TypeScript สำหรับ Vercel ใช้ Airtable เป็นข้อมูลธุรกิจ และ PostgreSQL สำหรับ session, OAuth state, idempotency journal และการประสานคำขอ

## เริ่มพัฒนา

ใช้ Node.js 24 และรันจาก `web/`:

```powershell
npm ci
Copy-Item .env.example .env.local
# แก้ .env.local ด้วยค่าของ test Base และบัญชีทดสอบเท่านั้น
npm run db:migrate
npm run diagnose
npm run dev
```

เปิด `http://localhost:3000` ถ้ายังไม่มี credentials จะเห็นสถานะเตรียมระบบแทนการ Login จำลอง ตัวอย่าง `.env.example` เป็น placeholder และตั้ง writes / jobs เป็น false ก่อน migrate ต้องมี `APP_ENV` / test `AIRTABLE_BASE_ID` / `DATABASE_URL` จริง ส่วน diagnose และเว็บต้องตั้ง auth / Airtable configuration ครบ Google callback คือ `/api/auth/google/callback` ตาม `APP_ORIGIN`

`DATABASE_URL` ของผู้ให้บริการภายนอกต้องใช้ `sslmode=verify-full` และ certificate chain ที่ตรวจสอบได้ สำหรับ migration สามารถกำหนด `DATABASE_MIGRATION_URL` แบบ direct connection แยกจาก runtime pool ตามข้อกำหนด provider ไม่มีการ migrate ระหว่าง build หรือเริ่ม Function

Migration CLI ตรวจเฉพาะ DB / environment binding เพื่อเตรียม schema ก่อนตั้ง Google OAuth หรือ PAT ได้ ไม่ต้องใช้ credentials ปลอม runtime validation ยังคงเข้มงวดตามเดิม ดู [Neon staging](../docs/vercel-staging.md) และเก็บ direct connection เฉพาะ release runner ไม่ใส่ใน runtime variables

สำหรับ acceptance บนเครื่อง ใช้ `compose.local.yaml` กับ `LOCAL_DATABASE_PASSWORD` แบบสุ่มใน `.env.local` และ `DATABASE_URL` ที่ตรงกัน (`hvr_local`, DB `hvr_development`, `127.0.0.1:55433`) เริ่มด้วย `docker compose --project-name hvr-local --env-file .env.local -f compose.local.yaml up -d --wait` เก็บข้อมูลใน named volume แยกจาก container ทดสอบชั่วคราว หยุดด้วยคำสั่งเดียวกันเปลี่ยน `up -d --wait` เป็น `stop` และรันเว็บด้วย `npm run dev -- --hostname 127.0.0.1 --port 3000` ดู [ผลทดสอบกับบริการจริง](../docs/vercel-local-acceptance.md)

`diagnose` ต้องมี `AIRTABLE_SCHEMA_TOKEN` แยกสำหรับ CLI ใช้ PAT แบบ `schema.bases:read` เฉพาะ Base ของ environment ตาม [Get base schema API](https://airtable.com/developers/web/api/get-base-schema) ไม่เพิ่ม schema scopes ให้ runtime `AIRTABLE_TOKEN` และไม่ใส่ schema token ใน Vercel variables ไม่มี schema write หรือการสร้าง / แก้ตารางจากคำสั่งนี้

เครื่องมือตรวจชนิดฟิลด์และ primary fields ของ 5 ตาราง, select options, link targets / single-record preference, Lookup source, สูตร Record ID / Task ID และ Last Update ที่ติดตามทุกฟิลด์แก้ไขได้พร้อมเวลา จากนั้นตรวจ table access ด้วย `FALSE()` โดยไม่อ่าน record contents ผลผ่านนี้ไม่แทนการ Login และ data acceptance กับบัญชีจริง ถ้าขาด token หรือ schema ไม่ตรงจะออกด้วยสถานะล้มเหลว พร้อม error code / ชื่อฟิลด์ตาม contract โดยไม่พิมพ์ค่า metadata หรือ credentials

เปิดการเขียนของ test Base หลังตรวจพร้อมแล้ว: ตั้ง `TASK_WRITES_ENABLED=true` และรันคำสั่งด้านล่างโดยแทน Base ID ให้ตรงกับ test Base; production ต้องผ่าน [cutover runbook](../docs/vercel-deployment-plan.md) ก่อน

```powershell
npm run ops:runtime -- --environment=development --base-id=app00000000000000 --writes=on
```

`--writes=off` ปิดผ่าน DB ได้ทันทีโดยไม่ต้อง redeploy ค่าบน DB เปิดเกินเพดาน Environment Variables ไม่ได้ CLI นี้ไม่เปิด jobs หรือส่งข้อความ

## ตรวจสอบ

```powershell
npm run lint -- --diagnostic-level=warn
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

- Unit tests ใช้ service doubles; integration tests ใช้ PostgreSQL engine แบบ PGlite ในหน่วยความจำและ JWT ที่ลงลายเซ็นเพื่อทดสอบ OIDC จริง โดยไม่ติดต่อ Google / Airtable จริง
- E2E ใช้ production build, Chrome แบบ headless และ API doubles เฉพาะใน Playwright ไม่มี demo user / endpoint หรือ auth bypass ในแอป production ภาพทดสอบอยู่ใน `../artifacts/vercel/`
- Browser tests ตรวจ skip link, Tab / Shift+Tab / Escape ในเมนูมือถือ, loading / empty / maintenance, network / JSON errors และป้องกัน response เก่าทับผลล่าสุด ใช้ `@axe-core/playwright` สแกนหน้า Manager หลัก, Login / errors และเมนูมือถือ ตาม [คู่มือ Playwright](https://playwright.dev/docs/accessibility-testing) โดยไม่ปิด rules หรือยกเว้นพื้นที่หน้าเว็บ ยังต้องตรวจด้วย screen reader และ Safari บนอุปกรณ์จริงก่อนเปิดใช้
- รายงานสแกนอยู่ใน `../artifacts/vercel/accessibility/` เก็บทั้ง `violations` และ `incomplete` เพื่อให้ตรวจต่อด้วยคน ผลอัตโนมัติผ่านไม่ได้หมายถึงผ่าน WCAG ครบทุกเกณฑ์
- บน CI ติดตั้ง Chromium ด้วย `npx playwright install --with-deps chromium`; บน Windows ใช้ Chrome ที่ติดตั้งอยู่
- Biome เปิด recommended rules; ยกเว้น `noDescendingSpecificity` เพราะ responsive CSS ของแต่ละ component ตั้งใจ override ตาม breakpoint ไม่ได้ปิดกฎ security หรือ accessibility

ทดสอบหลาย connections กับ PostgreSQL จริงที่แยกทิ้งได้:

```powershell
docker compose -p hvr-tests -f compose.test.yaml up -d --wait
$env:TEST_DATABASE_URL='postgresql://hvr:hvr-local-test@127.0.0.1:55432/hvr_test'
npm run test:postgres
npm run test:api
docker compose -p hvr-tests -f compose.test.yaml stop
```

รหัสผ่านในตัวอย่างใช้เฉพาะ container ทดสอบที่ bind localhost และเก็บข้อมูลชั่วคราว ห้ามใช้กับบริการจริง คำสั่ง tests นี้จะล้มเหลวหากไม่ได้กำหนด `TEST_DATABASE_URL` ไม่ข้ามการทดสอบเงียบ ๆ และสร้าง / ลบเฉพาะ schema สุ่มในฐานข้อมูลชื่อที่มี `test`

`test:api` รัน production build ผ่าน HTTP และ browser จริง โดยสร้าง session ใน PostgreSQL ทดสอบและจำลองเฉพาะ Airtable upstream ผ่าน Node preloader ใน `tests/support/` ไม่มี application endpoint สำหรับข้าม Login และไม่มีข้อมูลจำลองใน production bundle ต้อง `npm run build` ก่อนรัน ไม่ได้พิสูจน์การเชื่อม Google / Airtable บัญชีจริง

ชุดนี้ตรวจการเปลี่ยน Active / Role / Subject / เจ้าของงานระหว่าง session, แหล่งตรวจสิทธิ์ล่ม, logout หลังเพิกถอนสิทธิ์, session หมดอายุ และ runtime kill switch ทั้ง 5 mutation routes การเปลี่ยน fixture ใช้ไฟล์ชั่วคราวเฉพาะ test runner ที่ลบเมื่อจบ ไม่เพิ่ม endpoint ควบคุมในแอปจริง

`npm run test:load -- --users=5 --tasks=250 --delay-ms=60` ใช้ `TEST_DATABASE_URL` เดียวกับ disposable tests แต่สร้าง schema `hvr_load_<uuid>` แยก เปิด production build ชั่วคราวเฉพาะ `127.0.0.1:4182` และจำลอง Airtable แบบ read-only / pagination / latency ผ่าน opt-in preloader ไม่มี Google Login หรือ PAT จริง ตรวจ context, รายการครบตามสิทธิ์, หลาย session พร้อมกัน, overload / `Retry-After` และฟื้นหลังคิวจบ เก็บรายงานใน `../artifacts/vercel/load/` แล้วหยุด server / ลบ schema ตัวเอง ต้อง build ก่อนรัน ไม่รันพร้อม benchmark อื่นหากจะเทียบเวลา รองรับ users 1–20 / tasks 1–5,000 / delay 0–500 ms ดู [ผลและข้อจำกัด](../docs/vercel-load-acceptance.md)

`npm run probe:live -- --confirm-test-base=appoQzvQwGShlq4OJ` อ่าน Users / Tasks ของ test Base จริงด้วย development config และ PostgreSQL local เท่านั้น ไม่เกิน 30 GETs / หยุดเริ่มคำขอหลัง 90 วินาที ตรวจ Users ใหม่ก่อนแต่ละ service bootstrap full / context ของ Agent / Secretary ไม่สร้าง session, ไม่เขียน records และไม่ทำ auth bypass เก็บเวลา / จำนวนรายการ / status codes ใน `../artifacts/vercel/probes/` ไม่มี identity หรือเนื้อหางานในรายงาน ไม่รันใน CI และไม่ใช้แทน Google/HTTP/load acceptance ดู [ผล probe และงบ API](../docs/vercel-load-acceptance.md#เวลาอ่าน-airtable-จริง)

## เมื่อผลการเขียนไม่แน่นอน

Browser ส่ง idempotency key เดิมเมื่อ retry payload เดิม เก็บเพียง key และ hash ของ payload ใน sessionStorage ไม่มี session token หรือรายละเอียดงานอยู่ใน storage นี้ เซิร์ฟเวอร์จอง resource และบันทึกแต่ละ step ลง DB

- `pending`: การเชื่อมต่อถูกปฏิเสธแน่นอนหรือรอ rate limit; ส่งคำขอเดิมต่อได้เมื่อถึงเวลา
- `running`: มี invocation กำลังทำงาน หรือ invocation จบก่อนบันทึกผลครบ ห้ามถือว่า TTL หมดแล้วแปลว่าเขียนไม่สำเร็จ
- `review`: อาจเขียนถึง Airtable แล้ว; ไม่ replay อัตโนมัติและคง resource ไว้
- `completed`: ยืนยันบันทึกและ journal ครบแล้ว จึงแจ้งผู้ใช้ว่าสำเร็จ

ดูเฉพาะ metadata โดยไม่พิมพ์ข้อมูลลูกค้า:

```powershell
npm run ops:inspect -- --environment=development --id=00000000-0000-4000-8000-000000000000
```

ใช้ CLI `ops:recover` ตาม [คู่มือกู้คำขอ](../docs/vercel-recovery.md) หลังปิด DB writes / jobs และยืนยันว่า invocation หยุดแล้ว เครื่องมืออ่านเทียบ Airtable กับ write intent ที่บันทึกก่อนส่งเท่านั้น ไม่เขียนหรือสร้าง records ใน Airtable ถ้ายืนยันครบจึงเปลี่ยนเป็น `pending` ให้ผู้ใช้เดิม retry key เดิม โดยยังไม่ปล่อย resource จนคำขอเสร็จ

กรณี record หาย / ซ้ำ / ข้อมูลเปลี่ยน / ไม่มี intent จะคง `review` ห้ามลบ resource หรือแก้ state เองเพื่อให้ระบบเดินต่อ งานที่สร้างผ่านเว็บและยังไม่ครบจะถูกกันการแก้ไขจากคำขอใหม่ด้วย

## ซ้อม recovery กับบริการจริงบนเครื่อง

`npm run rehearse:live -- --confirm-test-base=appoQzvQwGShlq4OJ` เป็นคำสั่ง opt-in ที่เขียนข้อมูลสมมติใน test Base นี้เท่านั้น ต้องมี PostgreSQL local, writes เปิดอยู่ และ jobs / notifications ปิด พร้อมผู้ใช้ `LOCAL-AGENT-A/B` กับ `LOCAL-SECRETARY` แบบ `.invalid` ที่เตรียมไว้ ไม่รันใน CI หรือ production

เครื่องมือใช้ Airtable จริงและ journal จริง จำลองคำตอบหายหลัง API ตอบสำเร็จทั้ง 5 actions แล้วตรวจ review / recovery / replay และใช้ child process ที่หยุดจริงหลังสร้างงาน รออายุขั้นต่ำ 120 วินาทีโดยไม่แก้ timestamp ใน SQL ก่อน mark-stopped / reconcile บันทึกหลักฐานใน `../artifacts/vercel/live-recovery-<run-id>.json` ข้อมูลสมมติคงไว้ให้ตรวจได้ ไม่ลบ records หลังจบ

ผลนี้เป็น service / recovery acceptance ด้วย actors สมมติ ไม่ใช่ Google Login หรือ HTTP acceptance ของหลายบัญชี หากมี pending / running / review ค้างจะไม่เริ่มรอบใหม่ เมื่อรอบที่เริ่มเขียนแล้วล้มเหลวจะพัก DB writes ไว้ ให้ตรวจ report และใช้ runbook กู้คำขอ ห้ามรันใหม่เพื่อข้ามรายการค้าง

HTTP acceptance กับ Google session จริงซ้อมแยกด้วย `tests/support/live-airtable-preload.mjs` บน loopback port 3001 เท่านั้น module ต้องถูกโหลดด้วย Node `--import` อย่างชัดเจน และต้องมี `APP_ORIGIN=http://localhost:3001` / `HVR_LIVE_REHEARSAL_FILE` ชี้ไฟล์ `../artifacts/vercel/live-http-<uuid>.json` ที่เตรียมไว้ ตัวควบคุมไม่ใช่ HTTP endpoint และไม่ถูก import จากแอป จำลองคำตอบหายเฉพาะ create ที่ title เริ่ม `[HTTP LIVE TEST]` หลัง Airtable ตอบสำเร็จครั้งเดียว ไม่มี session doubles หรือ auth bypass ดู [ผลซ้อมและข้อจำกัด](../docs/vercel-local-acceptance.md#http-retry-และข้อมูลถูกแก้ตรง) ก่อนรันรอบใหม่

โหมด `barrier` ของ preloader เดียวกันใช้ marker `[HTTP CONCURRENT TEST]` และรับได้ไม่เกิน 2 request keys เพื่อซ้อมสอง profiles บันทึกผล Airtable จริงแล้วรอทั้งสอง task ยืนยันก่อนปล่อย acknowledgements หลังอีก 1.5 วินาที จำกัดเวลารอ 60 วินาที การหน่วงนี้เป็นเครื่องมือสร้าง overlap บนเครื่อง ไม่ใช้วัด latency / load และไม่เปิดใช้ใน runtime ปกติ หากรอบใดล้มเหลวให้ตรวจและกู้ journal เดิมก่อนสร้าง control file รอบใหม่ ดู [หลักฐาน concurrency](../docs/vercel-local-acceptance.md#สอง-browser-profiles-พร้อมกัน)

Next dev กรอง incoming request log ของ `/api/auth/google/callback` เพื่อไม่พิมพ์ authorization code / state ตาม [Next.js logging](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging) การตั้งค่านี้ครอบคลุม development logger; ต้องตรวจ hosting / proxy logs แยกก่อน staging

## ขอบเขตการอ่านและข้อมูลผิดรูป

`GET /api/bootstrap` คืน task summaries สำหรับรายการ / Dashboard / calendar / reports รวม Description เพื่อค้นหา แต่ไม่ส่ง attachments, reference URL, version หรือรายละเอียดอื่นที่ใช้เฉพาะหน้า detail เลือกคอลัมน์ผ่าน `fields[]` ของ Airtable ตาม [รูปแบบ API ทางการ](https://support.airtable.com/articles/9428033215-url-length-limitations-for-web-api-requests) และตาม offset จนครบ ไม่ตัดข้อมูลเงียบ ๆ

ฟอร์ม `/tasks/new` และหน้า detail ใช้ `/api/bootstrap?scope=context` ซึ่งคืน `tasksIncluded=false` กับ `tasks=[]` สำหรับ context เท่านั้น ค่านี้ไม่ได้แปลว่าทีมมีงานเป็นศูนย์ UI จึงไม่แสดงตัวนับงานจาก response นี้ หน้า detail อ่านงานปัจจุบันผ่าน endpoint ที่ตรวจ ownership แยก

ชุดทดสอบจำลอง 250 tasks / 3 users ยืนยันว่า bootstrap เต็มอ่าน 3 task pages + 1 users page; context ของ Secretary อ่านเฉพาะ 1 users page และของ Agent ไม่ list ตารางใดเลย จำนวนนี้ไม่รวมการอ่าน Users เพื่อตรวจ session ซึ่งยังทำใหม่ทุก protected request ไม่มีการ cache Active / Role เพื่อแลกกับจำนวนคำขอ

รายการงานยังใช้ pagination 7 รายการฝั่ง browser โดยโหลด summaries ครบเพื่อคำนวณ counts / filters / reports ผลทดสอบ 250 records ไม่ใช่หลักฐาน load test ของบริการจริง ต้องวัดกับขนาดทีมจริงก่อนเปิดใช้

วันที่ / timestamp ผิดรูป, Status / Priority ที่ไม่รู้จัก และ links เจ้าของหลายคนคืน `AIRTABLE_DATA` แบบไม่เผย record fields แทนการเดาสถานะหรือแสดงวันที่ผิด Attachments ที่ไม่มี HTTPS URL ใช้งานได้จะไม่ถูกส่งไปหน้าเว็บ หากข้อมูลถูกแก้ตรงใน Airtable จนผิด contract ให้ผู้ดูแลหยุด writes / ตรวจ journal ก่อนแก้ตาม [คู่มือ recovery](../docs/vercel-recovery.md) ไม่แก้สถานะ SQL เพื่อข้าม validation

## ซ้อม backup ของ staging

`npm run rehearse:backup -- --confirm-test-base=appoQzvQwGShlq4OJ` ใช้ direct Neon staging และ Docker PostgreSQL 18.6 สำรองแบบเข้ารหัสและ restore ใน container ที่ไม่มี network/port ตรวจข้อมูลกับ snapshot เดียวกัน และล้าง fixture เฉพาะรอบ ไม่เรียก Airtable หรือ restore ทับฐานข้อมูลที่ระบุจากภายนอก ต้องมี backup encryption key แยกและปิด DB writes/jobs ก่อนรัน ดู [วิธีเตรียม ผลตรวจ และข้อจำกัด](../docs/vercel-backup-rehearsal.md)

## Deploy

ใช้ [แผนพัฒนา](../docs/vercel-development-plan.md), [แผน Deploy](../docs/vercel-deployment-plan.md) และ [สถานะล่าสุด](../docs/vercel-progress.md) ตั้ง Vercel Root Directory เป็น `web/` เจ้าของอนุญาตและมี [deployment แรก](../docs/vercel-first-deployment.md) แล้วที่ https://happy-victory-task-center.vercel.app หน้าเว็บออนไลน์ แต่ cloud DB / OAuth ยังไม่ตั้งค่า คำสั่ง build / tests ไม่สร้างหรือเชื่อมบริการเหล่านี้เอง
