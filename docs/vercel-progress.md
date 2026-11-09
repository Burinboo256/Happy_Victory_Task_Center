# สถานะพัฒนา Vercel

อัปเดต: 9 พฤศจิกายน 2026 · [Vercel Production](https://happy-victory-task-center.vercel.app) เปิดรับงานแล้ว หลังพัก Apps Script เดิม ตรวจ baseline และทดสอบ Admin สร้างงานจริงสำเร็จ พร้อม task/audit อย่างละหนึ่งและไม่มี operation ค้าง คง Hobby / Neon Free และปิด jobs/notifications ดู [สถานะ production และขอบเขตการตรวจ](vercel-production.md) รายละเอียดด้านล่างเป็นผลพัฒนาและ staging ซึ่งบางหัวข้อยังรอตรวจเพิ่มเติม

## สิ่งที่มีใน source แล้ว

- `web/`: Next.js 16.4.5, React 19.3.1, TypeScript 6.0.3, Node.js 24; มี lockfile และ Biome recommended lint rules
- หน้า Login, Dashboard, รายการ / การ์ด / ค้นหา / filters / pagination, ฟอร์ม `/tasks/new`, รายละเอียด, comments / internal notes, status, followups, calendar, reports และ team
- Detail แสดงประเภทงาน / วันที่ส่งงาน, วันกำหนดส่ง / นัดมีปี และ timeline แสดงวันที่พร้อมเวลา Bangkok; มี regression ข้ามเที่ยงคืน
- Google OIDC authorization code + PKCE, nonce และการตรวจ JWT signature; session แบบ HttpOnly cookie อายุ 6 ชั่วโมง, CSRF และการตรวจ Users ใหม่ทุก protected request
- Airtable adapter ฝั่ง server รองรับ pagination, shared rate slots ใน PostgreSQL, cooldown เมื่อ 429 และแยกผลการเขียนที่ไม่แน่นอนออกจากการปฏิเสธที่ยืนยันได้
- Rate admission ตรวจคิวเต็มแบบ atomic ก่อนจอง slot; rejected requests ไม่เลื่อนคิว / cooldown และตอบ Retry-After จากเวลารอปัจจุบัน คำขอที่รอ slot ตรวจ cooldown ใหม่ก่อน dispatch เพื่อไม่ส่ง mutation ระหว่างพักหลัง 429 ของอีก instance
- PostgreSQL migrations, environment binding, runtime write switch และ durable operation journal; ไม่คืนสิทธิ์เก่าจาก snapshot เมื่อ role เปลี่ยนระหว่างคำขอค้าง
- CLI `db:migrate`, `diagnose`, `ops:runtime`, `ops:inspect`, `ops:recover`; [วิธีใช้](../web/README.md)
- Recovery เก็บ write intent ก่อนเรียก Airtable, เทียบผลแบบอ่านอย่างเดียวก่อนคืนคำขอเป็น pending และบันทึก operator / evidence reference แบบ atomic; คง resource จนคำขอเสร็จ และกันการแก้ไขงานที่ create ยังไม่ครบ
- Browser แยก retry key ตาม payload เพื่อไม่ทำ key ของคำขอที่ยังค้างหายเมื่อผู้ใช้แก้ฟอร์ม
- เมนูมือถือปิดแล้วรับ focus ไม่ได้ เปิดแล้วใช้ Tab / Shift+Tab วนในเมนูและ Escape ปิดได้; skip link ไปเนื้อหา และ progress indicators มีชื่อให้อ่าน
- Network / JSON errors แสดงภาษาไทย, โหลดล้มเหลวล้างข้อมูลหน้าจอ และไม่ให้ response เก่าคืนข้อมูลทับผลล่าสุด
- ฟอร์ม / detail โหลด bootstrap แบบ context โดยไม่ list Tasks; หน้ารวมอ่านเฉพาะ summary fields รวม Description สำหรับค้นหา และยังตาม pagination ครบทุกหน้าโดยไม่ cache สิทธิ์
- ตรวจ record envelopes, dates / timestamps, Status / Priority และ single-owner links; ข้อมูลผิดรูปคืน error ที่ไม่เผย field values และไม่เดาสถานะเป็น New ส่วน attachment URLs ที่ใช้ไม่ได้จะไม่ส่งไป client
- `diagnose` ตรวจ schema contract ของ 5 ตารางด้วย schema-read token แยกสำหรับ CLI พร้อมทดสอบคำสั่งจริงกับ upstream จำลอง ไม่เพิ่ม schema scopes ให้ runtime PAT
- ปรับ contrast ข้อความ / badges, ชื่อ landmarks และ dialog semantics; เพิ่ม axe scans แบบไม่ exclude / disable rules พร้อมรายงาน `artifacts/vercel/accessibility/` รวมรายการที่ต้องให้คนตรวจต่อ
- Push initial commit `ec44e92` ขึ้น GitHub / main แล้ว `.github/workflows/verify.yml` รวม load rehearsal 5 คน / 250 งานผ่านบน GitHub Actions; Vercel เชื่อม repo / root web / Node 24 และ deployment แรก READY
- เพิ่ม maintenance guard ของ Apps Script ใน source พร้อม test; ยังไม่ได้ Deploy guard หรือปิดการเขียนบนเว็บเดิม

## หลักฐานตรวจสอบบนเครื่อง

| ชุดตรวจ | ผลล่าสุด | ขอบเขตหลักฐาน |
|---|---|---|
| TypeScript + Biome | ผ่าน | ตรวจโค้ดเว็บ / tools / tests ไม่ใช่ live service readiness |
| Production build | ผ่าน | routes ใหม่ compile และเป็น dynamic; ไม่มี test preloader / test token ใน server หรือ client bundle |
| Unit tests เว็บ | 25 ผ่าน | ownership / security, invalid data / dates, 250-task pagination / projection, rate limit / uncertain writes และ schema contract / metadata token isolation |
| Integration บน PGlite | 15 ผ่าน | SQL จริงใน embedded engine, signed OIDC doubles, sessions / role changes, journal replay, lost response, recovery ของ status / followup และ maintenance race |
| PostgreSQL จริงใน Docker | 8 ผ่าน | หลาย connections, คำขอซ้ำ / resource conflict, recovery สองผู้ดูแลพร้อมกัน, shared slots / overload ไม่ต่อคิว rejected requests, queued mutation เคารพ cooldown ที่เกิดใหม่ และ migration CLI idempotency / rollback |
| Browser E2E | 24 ผ่าน | production build + Chrome desktop / mobile viewport, keyboard / focus / error states และ axe scans ของ 8 หน้าหลัก + Login / errors / mobile menu; ใช้ API doubles เฉพาะ tests |
| HTTP / Browser ต่อ API จริง | 14 ผ่าน | PostgreSQL จริง, revocation / expiry / kill switch, context / invalid data, diagnostics CLI และ axe บน configured Login; เพิ่ม same-task status contention / stale retry / completed replay; จำลองเฉพาะ Airtable upstream |
| Apps Script regression | 61 ผ่าน | รวม guard หยุด business mutations และยังอ่านข้อมูลได้ |
| npm dependency audit | ไม่พบช่องโหว่หลังติดตั้ง | เปลี่ยนจากชุด ESLint ที่มี advisory เป็น Biome; ไม่มี runtime dependency advisory ค้าง ณ รอบตรวจ |

รวม tests ของเว็บใหม่ **85 รายการผ่านตามรอบตรวจที่ระบุ** แยกจาก Apps Script 61 รายการ ภาพ UI ที่ใช้ข้อมูลสมมติอยู่ใน `artifacts/vercel/` ภายหลังเจ้าของอนุญาตทดสอบบริการจริง จึงสร้าง credentials ใหม่เฉพาะ test Base / localhost เก็บใน ignored `web/.env.local`; ไม่มี production credentials ใน workspace การตรวจ bundle รอบ automated tests ใช้ค้นหา marker ของ test preloader / synthetic token / fixture controls / schema-only token variable แล้วไม่พบ

CI ของ initial commit รันครบใน [run 42172256512](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42172256512): unit 25 / integration 15 / PostgreSQL 8 / browser E2E 24 / HTTP API 13 และ Apps Script 61 ผ่านทั้งหมด รวม lint / typecheck / audit / build / synthetic load ตัวเลข partial reruns ด้านล่างเป็นประวัติการตรวจ local ก่อน push

หลังแก้ detail metadata / เวลา รัน TypeScript, Biome, production build และ E2E เฉพาะ Secretary / axe หน้าหลัก desktop + mobile รวม 4 cases ผ่าน ไม่ได้รันทั้ง 83 ซ้ำ สแกน output ล่าสุด 350 ไฟล์ไม่พบค่า secret ทั้ง 6 รายการที่ตั้งจริงในเครื่อง

หลังแก้ rate admission รัน unit 25 / integration 15 / PostgreSQL 7 / HTTP-browser API 13 พร้อม lint / typecheck / build ผ่าน Browser E2E 24 และ Apps Script 61 เป็นผลรอบก่อน ไม่ได้รันซ้ำในรอบแก้ rate limiter เพิ่ม `test:load` ตามขนาดที่เจ้าของระบุ 5 คน / 250 งาน: normal burst สำเร็จ 5/5, overload 20 คำขอตอบ busy 14 และฟื้นหลังคิวจบ ตรวจ HTTP / DB จริงแต่ใช้ sessions และ Airtable สมมติ รายงานและข้อจำกัดใน [ผลโหลดบนเครื่อง](vercel-load-acceptance.md)

เพิ่ม `probe:live` แบบ opt-in จำกัด GET 30 คำขอเฉพาะ test Base: รันจริงสำเร็จ 25 calls, mutation 0; Agent full 4 งานใช้ 657–698 ms / Secretary full 11 งานใช้ 996–1,057 ms รวม Users GET ใหม่ ก่อน service bootstrap นำ upstream latency ราว 330 ms ไปซ้อม synthetic 250 งาน: 5 sessions พร้อมกันผ่าน 5/5 สูงสุด 2,448 ms ผลนี้ไม่ใช่ Google / browser / live 250-task load acceptance และยังไม่ยืนยัน quota workspace ดู [หลักฐานและขอบเขต](vercel-load-acceptance.md#เวลาอ่าน-airtable-จริง)

กรณีจำลอง 250 tasks / 3 users: bootstrap เต็มอ่าน Tasks 3 หน้า + Users 1 หน้า; context ของ Secretary อ่าน Users 1 หน้า และของ Agent ไม่ list ตารางใด ตัวเลขนี้ไม่รวม GET Users ที่ตรวจ session ทุก protected request ยังคงอ่าน summaries ครบเพื่อคำนวณรายงานและแบ่งหน้าใน browser จึงยังต้องวัด load กับปริมาณงานจริง ดู [ขอบเขตการอ่าน](../web/README.md#ขอบเขตการอ่านและข้อมูลผิดรูป)

## เทียบ milestone กับแผน

| Milestone | สถานะ / งานคงเหลือ |
|---|---|
| M0 | GitHub / CI / Vercel / test Base / localhost OAuth พร้อม; เจ้าของเลือก Neon Free staging และมี DB Singapore แล้ว ซ้อม encrypted backup/restore แยกผ่าน; production plan / backup retention / offsite และ cutover ยังต้องสรุป |
| M1 | โครงแอป, DB และ adapter ผ่าน tests; schema diagnostics / table access กับ Airtable test Base จริงผ่านครบ 5 ตาราง |
| M2 | Google Login จริงครบ Admin, Secretary, Agent A/B; return-to-form และ Active revocation / restore ผ่าน; สอง Chrome profiles มี session พร้อมกัน ตรวจ cross-owner ทั้งสองทิศทาง และ Agent A logout ไม่กระทบ Agent B ผ่าน |
| M3 | 5 mutations และ recovery ผ่านตามขอบเขตเดิม; HTTP lost ACK / negative drift / same-key retry ไม่ซ้ำ; สอง profiles สร้างงานต่างเจ้าของซ้อนกันได้ภายใต้ test acknowledgement barrier มี running journals ต่างผู้ใช้ 2 รายการและ task / audit อย่างละ 1 ต่อคำขอ; live HTTP contention บนงานเดียวกันยังไม่ได้ซ้อม |
| M4 | หน้าหลัก / keyboard / errors และ automated axe scans ผ่านบน Chrome desktop / mobile viewport แล้ว; รายงานเก็บ incomplete results ไว้ ยังต้องตรวจ screen reader และ Safari / Rich Menu บนอุปกรณ์จริง |
| M5–M6 | Preview staging READY, Neon / migrations / variables 17 ตัวพร้อม PAT/OAuth แยก; Google Login จริงครบ 4 บัญชี, Admin create และ Secretary status/followup/resolve ผ่าน; Agent A/B อ่านงานตนเองและถูกปฏิเสธงานข้ามเจ้าของ, private followup audits ถูกซ่อนจาก Agent A; Active revocation/restore และ UI write switch ผ่าน ต้องซ้อม cloud retry/recovery/load และมือถือให้ครบก่อน acceptance ระบบเดิมยังเป็น production และยังไม่ cutover |
| M7 | LINE linking / delivery worker / scheduler และผู้ให้บริการอีเมลของระบบใหม่ยังไม่พัฒนา ช่องทางส่งจริงปิดไว้ |

## งานถัดไปบนเครื่อง

เจ้าของตรวจมือถือหลังขยายตัวหนังสือแล้วและอนุญาตดำเนินการ production เตรียม Neon Free แยกใน `sin1`, migrations/TLS, OAuth/PAT ใหม่ และ Production variables 17 ตัวแล้ว วันที่ 9 พฤศจิกายนเปิด writes และทดสอบบันทึกผ่านเว็บสำเร็จ ส่วน jobs/notifications ยังปิด ดู [สถานะ production](vercel-production.md) สำหรับสถานะล่าสุด; ตาราง milestone ข้างต้นเป็นผลก่อน cutover และไม่แทนขอบเขตการตรวจ production

ซ้อม stable staging alias ย้อน `f2eb6a3` → `bd7e5f7` → รุ่นเดิมสำเร็จแล้ว โดยปิด writes ระหว่างสลับ ตรวจว่าไม่มีคำขอค้าง, health/Login/OAuth initiation/anonymous 401 ผ่านทั้งสองรุ่น และ production alias ไม่เปลี่ยน คืน writes=true/jobs=false แล้ว ไม่ใช้ Airtable API หรือทำ business mutations รอบนี้ ดู [ขอบเขตหลักฐาน](vercel-staging.md#ซ้อมย้อน-deployment-บน-staging); ไม่แทนการซ้อมกลับ Apps Script หรือ authenticated workflow หลัง rollback

ทดสอบ create ด้วย key เดียวซ้อนกันบน Vercel/Neon/Airtable staging จริงแล้ว: เห็น running ใน Neon ก่อนส่งคำขอที่สอง ได้ 202/running ระหว่างคำขอแรก, replay หลังเสร็จได้ผลเดิม, payload เปลี่ยนได้ 409 และตรวจ task/audit อย่างละหนึ่ง ไม่มี reservation ค้าง ใช้ session ทดสอบ Agent ที่ผูก Google เดิม อายุ 5 นาทีและเพิกถอนเมื่อจบ ดู [ขอบเขตและงบ](vercel-staging.md#คำขอ-key-ซ้ำบน-staging-จริง); ยังไม่ใช่ cloud failure/recovery หรือ load acceptance

ซ้อม client disconnect บน staging จริงเพิ่มเติม: abort HTTP หลังเห็น Neon running, invocation จบ completed แล้ว retry key เดิมได้ผลเดิม ตรวจ task/audit อย่างละหนึ่ง ไม่มี reservation ค้าง และเพิกถอน session ทดสอบแล้ว ดู [หลักฐานและข้อจำกัด](vercel-staging.md#การเชื่อมต่อผู้ส่งขาดบน-staging) ยังไม่ใช่ upstream acknowledgement loss หรือ operator recovery ของ Function ที่หยุด

1. วัด load / latency กับ Airtable จริงและ staging ต่อจาก local rehearsal 5 คน / 250 งาน; กำหนดเกณฑ์รับรองและ API usage budget ก่อน release
2. เจ้าของมี iPhone / Android พร้อมแล้ว; ตรวจ screen reader / Safari / LINE Rich Menu ตาม [คู่มืออุปกรณ์จริง](vercel-device-acceptance.md) หลังมี HTTPS origin ที่เข้าถึงจากมือถือ
3. รับรอง retry/recovery/load และมือถือของ staging ต่อจาก desktop acceptance ก่อน cutover ตาม [งานที่เหลือ](vercel-staging.md#งานที่เหลือก่อนรับรอง-staging)

ผล build และ tests ที่ใช้ข้อมูลจำลองไม่ยืนยันว่าพร้อมใช้กับบัญชีจริง ยังไม่ผ่าน release gates ทั้งหมดใน [แผนพัฒนา](vercel-development-plan.md) และ [แผน Deploy](vercel-deployment-plan.md)
