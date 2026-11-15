# RINLYN Secretary

ระบบติดตามงานสำหรับ Admin เลขา และ Agent ใช้งานจริงบน **Next.js / Vercel** โดย Airtable เก็บบัญชีและข้อมูลงาน ส่วน Neon PostgreSQL เก็บ session, OAuth state, operation journal, workflow, LINE bindings, AI memory และทะเบียนเอกสาร ใช้เวลา `Asia/Bangkok`

## ระบบที่ใช้งานปัจจุบัน

สถานะตรวจล่าสุด 15 พฤศจิกายน 2569:

- [Production](https://happy-victory-task-center.vercel.app) ใช้ branch `main`; [Staging](https://happy-victory-task-center-git-staging-burin.vercel.app) ใช้ branch `staging` แยกฐานข้อมูลและ credentials
- [ส่งงานใหม่สำหรับ LINE Rich Menu](https://happy-victory-task-center.vercel.app/tasks/new?openExternalBrowser=1) และ [สมัครตัวแทน](https://happy-victory-task-center.vercel.app/register) ผ่าน Google Login ผู้สมัครใหม่รอ Admin เปิด Active ใน Airtable
- งานมีประเภท ตัวแทนใหม่ / ตัวแทนเก่า / ลูกค้าใหม่ / ลูกค้าเก่า พร้อม checklist ตามประเภทและเงื่อนไขก่อนปิดงาน Agent เห็นงานตามสิทธิ์เจ้าของ
- [เอกสารและแบบฟอร์ม](https://happy-victory-task-center.vercel.app/forms) เผยแพร่ 44 รายการ: Allianz 43 และ Google Drive “แบบประกัน” 1 รายการ ทั้ง Production และ Staging เก็บเฉพาะ metadata/URL ไม่มีไฟล์เอกสารในระบบ
- OA `@672vhuss` ใช้ส่งร่างงานและยืนยันสร้างงาน ค้น/สรุปงาน และค้นแบบฟอร์ม ส่วน OA `@688rmrty` ใช้แจ้งเตือนงาน การเชื่อมบัญชีของสอง OA แยกกัน
- เจ้าของยืนยันใช้งานคลังเอกสารผ่าน LINE บน iPhone รวมเปิด Drive และรายการโปรดแล้ว Android/iPad, การตรวจข้ามบัญชีบางกรณี และ OA ทดสอบแยกยังมีรายการตรวจรับค้าง ดู [สถานะคลังเอกสาร](docs/forms-production-progress.md)

Apps Script เป็นระบบเดิมที่พักการเขียนหลัง cutover แล้ว ห้ามเปิดให้เขียนงานคู่กับ Vercel โดยไม่มีแผนย้ายระบบ ดู [สถานะ Production](docs/vercel-production.md) และ [การกู้คืน](docs/vercel-recovery.md)

## พัฒนาและทดสอบเว็บ

ใช้ Node.js 24 รันคำสั่งใน `web/`:

```powershell
cd web
npm ci
# เตรียม .env.local จาก .env.example เมื่อยังไม่มีไฟล์ ใช้ค่าทดสอบแยกจาก Production
npm run db:migrate
npm run dev
```

เปิด `http://localhost:3000` รายละเอียดการตั้งค่าอยู่ใน [web/README.md](web/README.md) โค้ดปัจจุบันมี migrations ถึง `012_ai_task_search.sql` ตรวจ environment/Base ก่อนใช้คำสั่งฐานข้อมูล เก็บ secrets ในไฟล์ที่ Git ignore หรือ Vercel Environment Variables เท่านั้น

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

การทดสอบ PostgreSQL, API และโหลดมีขั้นตอนเตรียมเฉพาะใน `web/README.md` ผล viewport จำลองไม่ใช่หลักฐานการทดสอบอุปกรณ์จริง

## โครงสร้าง repository

| ที่อยู่ | หน้าที่ |
| --- | --- |
| `web/src/app/`, `web/src/components/` | Routes และหน้าจอเว็บ |
| `web/src/domain/`, `web/src/server/` | กฎ workflow, สิทธิ์, services และ integrations |
| `web/db/migrations/`, `web/tests/`, `web/tools/` | Schema, tests และเครื่องมือปฏิบัติงาน |
| `integrations/n8n/` | Workflow LINE AI; เก็บเฉพาะไฟล์ที่ไม่มี credentials |
| `docs/` | แผน สถานะ schema และ runbooks |
| `apps-script/`, `preview/`, root `tools/` และ `tests/` | ระบบเดิมและตัวอย่างออฟไลน์ |
| `artifacts/`, `output/`, `pic/` | ไฟล์ทำงานส่วนตัว สื่อคู่มือที่ส่งมอบ และภาพอ้างอิง |

## เอกสารที่ควรอ่าน

- [แนวทาง contributor](AGENTS.md) และ [การรันเว็บ](web/README.md)
- [Production และประวัติ cutover](docs/vercel-production.md), [Recovery](docs/vercel-recovery.md)
- [Schema Airtable และข้อมูลใน Neon](docs/database-schema.md), [ลงทะเบียนและอนุมัติ Agent](docs/agent-registration.md)
- [แผนคลังเอกสาร](docs/forms-production-plan.md), [ผลตรวจรับล่าสุด](docs/forms-production-progress.md), [การจัดการเอกสาร](docs/forms-library.md)
- [ค้นงานด้วย AI](docs/ai-task-search.md), [LINE แจ้งงานเข้าใหม่](docs/line-new-task-notifications.md)

## ตัวอย่างและระบบเดิม

คำสั่งจาก root `npm run preview`, `npm run build`, `npm run check` และ `npm test` ใช้กับ legacy demo/Apps Script ไม่ใช่เว็บ Vercel ตัวอย่างเปิดที่ `http://127.0.0.1:4173/` ใช้ข้อมูลสมมติและ localStorage

[ขั้นตอนติดตั้ง Apps Script](docs/deployment.md) และ [LINE รุ่นเดิม](docs/line-oa-setup.md) เก็บไว้สำหรับอ้างอิงประวัติ ไม่ใช้สถานะในเอกสารเก่าแทนผลตรวจ Production ปัจจุบัน
