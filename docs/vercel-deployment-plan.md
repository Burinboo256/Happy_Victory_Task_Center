# แผน Deploy และย้ายระบบไป Vercel

วันที่: 5 พฤศจิกายน 2026 · อัปเดต 8 พฤศจิกายน 2026: **staging เชื่อม Neon/Airtable/Google OAuth และผ่าน desktop acceptance ตามขอบเขตแล้ว ยังไม่ cutover** ดู [หลักฐาน staging และงานคงเหลือ](vercel-staging.md)

ใช้ร่วมกับ [แผนพัฒนา](vercel-development-plan.md) สำหรับ M0–M7 เว็บ Google Apps Script ปัจจุบันยังเป็น production ตาม [deployment.md](deployment.md) ดู [สถานะล่าสุด](vercel-progress.md) และ [คำสั่งที่มีจริงใน web/](../web/README.md) staging ใช้ .vercel.app และ credentials แยกแล้ว ส่วน custom domains, production DB/OAuth และ cutover configuration ยังไม่ตั้งค่า

## ตรวจความพร้อม production วันที่ 8 พฤศจิกายน 2026

ตรวจ Vercel API และ public endpoints แบบอ่านอย่างเดียว เก็บ metadata โดยไม่ส่งออกค่า secrets ใน `artifacts/vercel/production-readiness.json`:

| รายการ | ผลตรวจ / สิ่งที่ต้องทำต่อ |
|---|---|
| Project / branch | `happy-victory-task-center`, root `web`, Node `24.x`, production branch `main` |
| Production configuration | environment variables ของ production มี 0 ตัว; ต้องตั้ง 17 ตัวตามตารางด้านล่างด้วย DB/PAT/OAuth ของ production แยกจาก staging |
| Public production URL | `/login` และ `/api/health` ได้ 200; `/api/bootstrap` และ `/api/auth/google` ได้ 503 `NOT_CONFIGURED` จึงยัง Login/ใช้งานจริงไม่ได้ |
| Staging isolation | มี variables เฉพาะ Preview/branch staging 17 ตัว รวม sensitive keys 5 ตัว; ยังไม่คัดลอกค่าเหล่านี้ไป production |
| Hosting plan | team `burin` เป็น Hobby; รอสรุปงบ Pro ก่อนใช้ระบบงานของทีมจริง |
| Backup / release acceptance | ยังต้องมี offsite encrypted backup, retention/key recovery, cloud restore และ Airtable backup ที่กู้ได้ รวม cloud failure/load และผลมือถือก่อน cutover |

ข้อเสนองบ hosting เริ่มจาก [Vercel Pro](https://vercel.com/docs/plans/pro-plan): platform fee $20/เดือน รวม deploying seat 1 คนและ usage credit $20; usage ส่วนเกิน/add-ons/seats เพิ่มมีค่าใช้จ่าย ผู้ใช้งานเว็บ 5 คนไม่ใช่ deploying seats โดยอัตโนมัติ ตั้ง spending alerts/ขอบเขต usage เมื่อเจ้าของเลือกแผน ราคานี้ตรวจจากเอกสารวันที่ข้างต้น ไม่รวมภาษีหรือ conversion และไม่ใช่การซื้อหรือรับรองยอดใบแจ้งหนี้

Neon production ต้องแยก project/credentials จาก staging และกำหนด RPO/RTO/retention ก่อนสร้าง เอกสาร [Neon plans](https://neon.com/docs/introduction/plans) ระบุ Free instant restore สูงสุด 6 ชั่วโมง แต่ต้องตรวจสิทธิ์ของ Marketplace plan ที่ provision จริงด้วย ไม่ใช้ข้อมูลแผนทั่วไปแทนหลักฐาน retention ของ resource และไม่ถือว่า PITR แทน offsite backup ได้

ลำดับหลังรับรอง staging: สรุปงบ/backup → เตรียม production DB/OAuth/PAT โดย writes/jobs ปิด → ตรวจ read-only หลายบทบาท → Deploy/test maintenance guard ของ Apps Script → นัด cutover ตามข้อ 5 เจ้าของต้องรับรองผลทดสอบและเลือกแผนก่อนซื้อบริการหรือสลับผู้เขียนหลัก

## 1. Environment และทรัพยากร

| Environment | ข้อมูลและ credentials | ข้อกำหนด |
|---|---|---|
| Development | Airtable test Base + PostgreSQL ทดสอบ + OAuth สำหรับ localhost | ใช้ข้อมูลสมมติและผู้ทดสอบที่ระบุ |
| Preview / Staging | test Base / DB แยกจาก production; staging origin คงที่ | branch previews อื่นไม่ Login จริงจนตั้ง callback ถูกต้อง |
| Production | Base เดิม + PostgreSQL production + OAuth production | ใช้ URL คงที่และเปิดเขียนหลังผ่าน cutover เท่านั้น |

เลือก Vercel team / plan และงบก่อน provisioning: [Hobby จำกัดงานส่วนตัวที่ไม่ใช่เชิงพาณิชย์](https://vercel.com/docs/plans/hobby) จึงวางแผน Pro สำหรับระบบทำงานของทีม ตรวจราคาและโควตาอีกครั้งก่อนซื้อ รวมงบ PostgreSQL, Airtable, อีเมล และ LINE แยกกัน

ตั้ง Vercel Root Directory เป็น `web`, Framework เป็น Next.js, Node.js `24.x` และบันทึก region ที่เลือกให้ใกล้ PostgreSQL รองรับ Git deployment หลังสร้าง repository / remote แล้ว ตรึง dependencies ด้วย lockfile

## 2. Configuration ที่ต้องเตรียม

ค่าทุกตัวด้านล่างเป็น server-only ห้ามเติม `NEXT_PUBLIC_` ให้ secrets ห้าม commit ค่า `.env.local`, PAT, OAuth secret หรือ database URL และห้ามดึง secret เดิมมาใส่เอกสาร

| Variable เป้าหมาย | หน้าที่ / ค่าเริ่มต้น |
|---|---|
| `APP_ORIGIN` | HTTPS origin คงที่ ไม่มี path; localhost ใช้เฉพาะ development |
| `APP_ENV` | `development`, `staging`, `production`; ใช้ namespace และตรวจ environment ผิดชุด |
| `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID` | PAT เฉพาะ Base ที่ถูกต้องสำหรับ environment |
| `AIRTABLE_SCHEMA_TOKEN` | ใช้เฉพาะ release / local CLI `diagnose`; แยก PAT `schema.bases:read` เฉพาะ Base ไม่ใส่ใน Vercel runtime variables |
| `AIRTABLE_USERS_TABLE`, `AIRTABLE_TASKS_TABLE`, `AIRTABLE_UPDATES_TABLE` | Table IDs ตาม schema ของ environment |
| `AIRTABLE_FOLLOWUPS_TABLE`, `AIRTABLE_NOTIFICATIONS_TABLE` | Table IDs อีกสองตาราง |
| `DATABASE_URL` | PostgreSQL connection ตามแนวทาง pooling / TLS ของ provider |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | client ของ environment; callback คำนวณจาก origin ที่อนุญาต |
| `AUTH_SECRET` | ใช้ป้องกันข้อมูล auth ชั่วคราวตาม library ที่เลือก; session opaque token เก็บ hash ใน DB |
| `TASK_WRITES_ENABLED` | `false` ก่อน cutover; จำกัดสูงสุดว่าระบบนี้มีสิทธิ์เขียนงานหรือไม่ |
| `JOBS_ENABLED` | `false` ก่อนผ่านระยะแจ้งเตือน |
| `ENABLE_EMAIL_NOTIFICATIONS`, `ENABLE_LINE_NOTIFICATIONS` | `false` จนผ่าน acceptance ของช่องทางนั้น |
| `CRON_SECRET` | secret สำหรับ scheduler endpoint; ไม่ใส่ใน query string |
| `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | ยังไม่จำเป็นใน M0–M6; ใช้เมื่อเปิด LINE และต้องแยกจาก Google credentials |
| `EMAIL_API_KEY`, `EMAIL_FROM` | placeholder contract รอเลือก provider ใน M7 |

ตัว migration ให้ใช้ direct connection เพิ่มเฉพาะเมื่อ provider ต้องการ และจำกัดสิทธิ์แยกจาก runtime ปิดการส่งจริงใน Preview แม้มีคนส่งตัวแปรผิด environment โดยตรวจทั้ง config และ environment guard

Environment Variables มีผลกับ deployment ใหม่ ไม่แก้ instance ที่ Deploy ไปแล้ว ตาม [เอกสาร Vercel](https://vercel.com/docs/environment-variables) จึงต้องพัฒนา runtime kill switch ใน PostgreSQL สำหรับหยุด writes / jobs ทันที โดย config เป็นเพดาน: runtime เปิดเกิน config ไม่ได้ ให้ทั้ง API และ worker ตรวจ switch ทุกคำขอ

## 3. Google OAuth และลิงก์มือถือ

1. เลือก production / staging origin ก่อนตั้ง Google Cloud; ตัวอย่าง `https://tasks.example.com` เป็น placeholder เท่านั้น
2. เตรียม Web application client แยกจาก client ของ Apps Script เพื่อลดผลกระทบตอน rollback เก็บ client เดิมไว้จนพ้นช่วงสังเกตการณ์
3. ลงทะเบียน redirect URI ตรงตัว เช่น `https://tasks.example.com/api/auth/google/callback` และ `http://localhost:3000/api/auth/google/callback` เฉพาะ client development ตาม [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
4. ใช้ staging origin คงที่สำหรับทดสอบ ไม่ใช้ wildcard redirect หรือให้ deployment URL ที่ browser ส่งมากำหนด callback
5. ทบทวน Authorized domains / branding / Audience / test users ให้ตรงกับผู้ใช้จริง การย้ายโฮสต์ไม่ได้เปลี่ยน OAuth Testing เป็น Production ให้อัตโนมัติ
6. ใช้ Users และ Google Subject เดิม ผู้ใช้ต้อง Login ใหม่บนโดเมนใหม่ ไม่ย้าย session token จาก Apps Script

ลิงก์ Rich Menu เป้าหมาย:

```text
https://tasks.example.com/tasks/new?openExternalBrowser=1
```

ให้ LINE เปิดเบราว์เซอร์ภายนอกด้วย `openExternalBrowser=1` ตาม [คู่มือ LINE](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/) และทดสอบบน iOS / Android จริงก่อนเปลี่ยนเมนู ใช้ Google Login ต่อไป; LIFF / LINE Login เข้าเว็บไม่อยู่ใน scope รุ่นแรก

รับ `/?view=create` บนโดเมนใหม่เป็น alias ไป `/tasks/new` ได้ แต่ลิงก์ Apps Script เดิมไม่ได้ย้ายตาม ต้องเปลี่ยน Rich Menu หลัง acceptance ผ่าน

## 4. Build และ Deploy Staging

- [ ] M0 ตัดสินใจทรัพยากรครบ; มี Admin, Secretary และ Agent A/B ใน test Base กับ OAuth audience
- [ ] ยืนยัน branch / commit SHA, lockfile และ Root Directory `web`; ไม่ใช้ `dist/` ของ Apps Script demo
- [ ] CI ผ่าน lint, typecheck, unit, integration, browser tests และ production build ตามคำสั่งที่จะสร้างในแผนพัฒนา
- [ ] รัน PostgreSQL migrations แบบ versioned เพียงหนึ่ง release runner ไม่ให้ทุก Function instance migrate เอง และไม่ให้ branch preview migrate production
- [ ] ตั้ง environment ครบ; `TASK_WRITES_ENABLED=true` ได้เฉพาะ test Base, jobs / notification flags ยังเป็น `false`
- [ ] Deploy staging แล้วตรวจ liveness, authenticated diagnostics, HTTPS, OAuth callback และ session cookie
- [ ] ยืนยัน network requests ไม่ติดต่อ production Base, ไม่มี secret / internal notes หลุดใน client bundle, logs หรือ response
- [ ] ทดสอบทุก role, partial failure / recovery / สอง request พร้อมกัน, mobile return-to-form และซ้อม rollback บนข้อมูลทดสอบ

หากใช้ Deployment Protection กับ staging ต้องตรวจว่า Google callback และ browser ของผู้ทดสอบกลับเข้าเว็บได้จริง กำหนดวิธีเข้าถึง staging ให้เฉพาะกลุ่มทดสอบโดยไม่ปิดการตรวจตัวตนของแอป

## 5. Cutover ไป Production

**Prerequisite:** maintenance guard `ENABLE_TASK_WRITES=false` เพิ่มใน source `apps-script/Code.gs` และผ่าน regression test บนเครื่องแล้ว แต่ยังไม่ได้ Deploy ไป Apps Script จริง ต้องนำรุ่นที่มี guard ขึ้นและทดสอบก่อนวันสลับ ให้ property นี้ปฏิเสธ create / status / comment / followup / resolveFollowup ฝั่งเซิร์ฟเวอร์ เมื่อยังไม่ตั้ง property จะคงพฤติกรรมเดิม การซ่อนปุ่มหรือบอกผู้ใช้ให้หยุดอย่างเดียวไม่เพียงพอ

| ลำดับ | ผู้รับผิดชอบ | การดำเนินการ / หลักฐาน |
|---|---|---|
| 1 | ผู้พัฒนา + เจ้าของ | นัดช่วงสลับ บันทึก baseline Apps Script version 4 และรุ่นที่เพิ่ม maintenance guard แล้ว / URL เดิม, release SHA ใหม่, config ที่ไม่ใช่ secret และลิงก์ Rich Menu เดิม |
| 2 | ผู้ดูแลข้อมูล | สำรอง Airtable ทั้ง records / links / schema ตามวิธี backup ที่กู้ได้; สำรอง operational DB และทดสอบ restore แล้ว |
| 3 | ผู้พัฒนา | Deploy production ใหม่โดยปิด task writes / jobs; migrate DB แบบ additive และตรวจ schema Base เดิมแบบ read-only |
| 4 | เจ้าของ + ผู้พัฒนา | ให้บัญชีจริง Login และตรวจ read-only ทุก role; unknown user ถูกปฏิเสธ ห้ามสร้างสิทธิ์สูงเพื่อให้ทดสอบผ่าน |
| 5 | ผู้พัฒนา | เปิด maintenance ฝั่ง Apps Script, ปิด / ตรวจว่าไม่มี trigger ส่งงานเดิม; รอ in-flight requests จบ และ reconcile journals ที่ยังไม่ครบ |
| 6 | ผู้พัฒนา | ยืนยันไม่มี business mutation หรือ notification worker ของระบบเดิมค้างก่อนเปิด writes ใหม่; หากมีผล API ไม่แน่นอนให้หยุด cutover |
| 7 | ผู้พัฒนา | เปิด writes Vercel เพียงระบบเดียว; ทดสอบงานที่เจ้าของกำหนดเป็นข้อมูลทดสอบ ตรวจ owner, audit, followup และ retry key จริง |
| 8 | เจ้าของ | รับรองผลทดสอบ จากนั้นเปลี่ยน Rich Menu / bookmarks เป็นโดเมนใหม่ ทดสอบมือถืออีกครั้ง |
| 9 | ผู้พัฒนา + เจ้าของ | ติดตามอย่างน้อย 48 ชั่วโมง เก็บหลักฐานและตัดสินใจยุติระบบเดิมหลังผ่านเกณฑ์ |

ระหว่าง maintenance ห้ามแก้ Tasks / audit / followups โดยตรงใน Airtable ยกเว้นแผน recovery ที่บันทึกไว้ ไม่คัดลอก operation journal ที่ยังทำงานไปทำต่อพร้อมกันสอง runtime และไม่เปิด task writes สองระบบเพื่อเปรียบเทียบผล

## 6. Acceptance ก่อนถือว่าเปิดใช้สำเร็จ

- [ ] Admin, Secretary, Agent A/B Login / logout ได้ และจำกัด Audience พร้อมสำหรับสมาชิกที่จะใช้จริง
- [ ] Agent A สร้างงานได้ Agent B อ่าน / comment งานนั้นไม่ได้ แม้เปลี่ยน ID เอง
- [ ] Secretary ทำ status, internal note, schedule และ resolve ได้ Agent ไม่ได้รับข้อมูลภายใน
- [ ] ปิด Active / เปลี่ยน Role ใน Users แล้ว protected request ถัดไปใช้สิทธิ์ใหม่; dependency ล่มไม่ยอมให้ผ่านด้วย cache เก่า
- [ ] Double tap / retry / timeout / redeploy ไม่สร้าง task หรือ audit ซ้ำในกรณีทดสอบ; ผลไม่แน่นอนแสดง pending / review ได้
- [ ] stale version ถูกปฏิเสธ; Completed At และ Next Follow-up ถูกต้องตามเวลาไทย
- [ ] ปฏิทิน รายงาน หน้าทีม และการกลับเข้าฟอร์มจาก Rich Menu ผ่านตาม scope เดิม
- [ ] ทดสอบจอ 360 / 390 / 768 / desktop และ Safari / Chrome; keyboard, validation, scroll และปุ่มส่งยังใช้งานได้
- [ ] ไม่มี real notifications ถูกส่งก่อนเปิดช่องทางนั้น; แสดง UI ว่ายังไม่เปิดใช้แทนการรายงานสำเร็จลวง
- [ ] Apps Script business writes ยังปิดอยู่; มีผู้ดูแลและวิธี rollback พร้อม

## 7. Scheduler และแจ้งเตือนหลังย้าย

ทำใน M7 หลัง core เสถียร ใช้ worker ที่บันทึกความคืบหน้าและแบ่ง batch ภายใน Function budget ตรวจ secret ผ่าน Authorization header และป้องกันการเรียกซ้ำ / ซ้อนกันผ่านฐานข้อมูล

- สรุป 08:00 ไทย = `0 1 * * *` UTC; 18:00 ไทย = `0 11 * * *` UTC
- ใช้ชื่อ job / unique key แยก channel + ผู้รับ + วันกรุงเทพฯ + รอบ; บันทึก body / recipient snapshot และ retry key แบบถาวร
- job dispatch ตามสองเวลาข้างต้น; recovery worker เสนอ `*/5 * * * *` เพื่อทำ pending / cleanup ในช่วงที่อนุญาต ไม่ replay ข้ามรอบหรือข้ามวัน
- ตรวจ Active, Role, consent และเจ้าของงานก่อน retry ห้ามส่ง internal notes; LINE linking ต้องใช้ session และโปรไฟล์จาก LINE ฝั่งเซิร์ฟเวอร์
- เปิดช่องทางละหนึ่งช่องกับผู้รับทดสอบที่ระบุ ตรวจประวัติ Notifications แล้วจึงเปิดทั้งทีม ให้ Apps Script triggers ปิดเสมอ

ตารางนี้เสนอสำหรับ Pro: [Hobby จำกัดแต่ละ cron ให้รันรายวันและไม่รับประกันตรงนาที](https://vercel.com/docs/cron-jobs/usage-and-pricing) ส่วน retries ทุกห้านาทีต้องใช้แผนที่รองรับหรือ scheduler ภายนอกที่เลือกภายหลัง ห้ามรับประกันการส่งถึงผู้รับตรงวินาที และต้องคำนวณ Function budget / rate limit รวมก่อนเปิดจริง

## 8. Monitoring และ rollback

การตรวจ `running` ค้าง / `review` ใช้ [คู่มือกู้คำขอ](vercel-recovery.md) และซ้อมบน test Base ก่อน cutover CLI จะพิสูจน์ผล Airtable แบบอ่านอย่างเดียวและบันทึก recovery event ไม่ปล่อย resource หรือ replay ผลที่ยังไม่แน่นอน

บันทึก request / operation ID, latency, error code, queue age, Airtable 429, reconciliation ที่ค้าง และค่าใช้จ่าย ห้าม log token, OAuth code, cookie, email เต็ม หรือรายละเอียดงาน ตั้ง alert เมื่อ API ล้มเหลวต่อเนื่อง, journal ค้างเกิน recovery window, มีงานซ้ำ หรือพบข้อมูลข้าม role; ข้อมูลรั่ว / งานผิดเจ้าของต้องหยุด writes และ jobs ทันที

หากต้อง rollback:

1. ปิด runtime writes / jobs บน Vercel ก่อน รอและตรวจ in-flight operations ไม่แน่นอนให้ reconcile ห้ามเปิดระบบเดิมแข่ง
2. ปิด cron ใน Vercel ด้วย อย่าถือว่าเปลี่ยน deployment กลับแล้วตาราง cron เปลี่ยนตาม: [Instant Rollback ไม่อัปเดต active cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
3. เลือก deployment Vercel ก่อนหน้าที่ใช้ schema / config เข้ากันได้ หรือกลับ Apps Script รุ่นที่ทดสอบ maintenance guard แล้ว หาก features / schema ใหม่เข้ากับ GAS ไม่ได้ให้คง maintenance และทำ forward fix
4. ข้อมูลใหม่ยังอยู่ Airtable เดิม อย่า restore backup ทับอัตโนมัติ ตรวจ task / audit / notification keys และ journal ทั้งสองฝั่งก่อนเปิด writes ระบบที่เลือกเพียงระบบเดียว
5. คืน Rich Menu / ลิงก์ตามระบบที่เลือก ให้ผู้ใช้ Login ใหม่ แล้วตรวจสร้างงานและสิทธิ์อีกครั้ง บันทึกเหตุการณ์และรายการที่แก้ข้อมูล

ใช้ additive migrations ตลอดช่วงย้าย ไม่ drop / rename fields ที่ระบบเดิมต้องอ่าน เก็บ PAT / OAuth client เดิมสำหรับ rollback ภายใต้สิทธิ์เดิม เมื่อพ้น 48 ชั่วโมงและเจ้าของรับรองแล้วจึงวางแผนปิด deployment เก่าและถอน credentials ที่เลิกใช้ ไม่ลบทรัพยากรระหว่างเปิดใช้งานครั้งแรก
