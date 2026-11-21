# หลาย Workspace ใน RINLYN Secretary

สถานะ: รุ่นหลาย Space บน Staging ผ่าน CI และทดสอบ Google Login/สิทธิ์ Owner, เลขา และ Agent A/B จริงแล้ว; ยังไม่เปิดใช้บน Production เจ้าของระบบเลือกทดสอบ LINE จริงเองภายหลังบน Production ดู [ผลตรวจและรายการทดสอบที่เหลือ](multi-workspace-acceptance.md) เอกสารนี้แทนแนวทาง Base ร่วมกัน: **หนึ่งเว็บไซต์, หนึ่ง Control Base, หนึ่ง Airtable Base ต่อ Space**

สำรอง Production และเตรียม Control Base แยกแล้ววันที่ 21 พฤศจิกายน 2569; ยังไม่ bootstrap/deploy ดู [ผลเตรียม Production และข้อจำกัดของ backup](multi-workspace-production-preparation.md) ก่อนเริ่ม cutover

## แหล่งข้อมูลและอำนาจการจัดการ

| ส่วน | เก็บอะไร | ผู้จัดการ |
| --- | --- | --- |
| Control Base: Users | ตัวบุคคล อีเมล Google Subject การเปิดใช้ทั้งระบบ System Role | เจ้าของระบบ |
| Control Base: Workspaces | ชื่อ Space, Workspace ID, Base ID, Active | เจ้าของระบบ |
| Control Base: Workspace Members | สมาชิก บทบาท Active และ Local User ID ของแต่ละ Space | Admin ผ่านหน้าเว็บของ Space ตน |
| Base ของ Space | Users mirror, Tasks, Task Updates, Follow-ups, Notifications | การทำงานตามสิทธิ์ของ Space |
| Neon `public` | Login, routing, PAT ที่เข้ารหัส, audit การจัดการ Space; ข้อมูลระบบของ RINLYN เดิม | เซิร์ฟเวอร์ |
| Neon `hvr_ws_<UUID ไม่มีขีด>` | journal, checklist/workflow, LINE bindings, AI memory/drafts, document metadata/favorites ของ Space ใหม่ | เซิร์ฟเวอร์ |

คนเดียวอยู่ได้หลาย Space และมีบทบาทต่างกัน เช่น Admin ของทีม A / Agent ของทีม B การปิด Users.Active ปิดทุก Space; การปิด Workspace Members.Active ปิดเฉพาะทีมนั้น ไม่มีบทบาท Admin ข้ามทีมโดยอัตโนมัติ System Role=Owner สร้าง/พัก Space ได้ แต่ต้องเป็นสมาชิกก่อนเปิดงานของทีมนั้น

Users ใน Base งานยังจำเป็นสำหรับ linked records เช่น Agent และ Updated By เนื่องจาก Airtable ไม่ได้เชื่อม linked records ข้าม Base โดยตรง การแสดงชื่อ/สิทธิ์ในเว็บอ่านจาก Users และ Workspace Members ส่วนกลาง ไม่เชื่อ Role/Active ใน mirror สามารถอ่านข้อจำกัดด้าน [Airtable Sync และ linked records](https://support.airtable.com/articles/2849803278-getting-started-with-airtable-sync)

## ตารางกลางที่ต้องเตรียม

ใช้ Control Base แยก หรือเริ่มเพิ่มสองตารางใน Base เดิมและใช้ Users เดิมเป็นทะเบียนกลางได้ ห้ามให้ Admin ทีมเป็น editor ของ Control Base; จัดการผ่านเว็บเพื่อจำกัดขอบเขต

**Users:** ใช้ schema Users ใน [database-schema.md](database-schema.md) รวม `Record ID = RECORD_ID()` เพิ่ม `System Role` single select: `Owner`, `User` ช่อง Role เดิมคงไว้เพื่อความเข้ากันได้ แต่บทบาทในแต่ละ Space อ่านจาก Workspace Members

**Workspaces:**

| Field | Airtable type / ค่า |
| --- | --- |
| Workspace ID (primary) | Single line text; UUID จากระบบ ห้ามเปลี่ยน |
| Name | Single line text |
| Base ID | Single line text; `app…` ห้ามเปลี่ยนเพื่อย้าย Base โดยตรง |
| Active | Checkbox |
| Record ID | Formula: `RECORD_ID()` |

**Workspace Members:**

| Field | Airtable type / ค่า |
| --- | --- |
| Membership Key (primary) | Single line text; `<Workspace UUID>:<central User record ID>` |
| Workspace | Link to Workspaces; จำกัดหนึ่งรายการ |
| User | Link to Users; จำกัดหนึ่งรายการ |
| Workspace Record ID | Lookup: Workspace → Record ID |
| User Record ID | Lookup: User → Record ID |
| Local User ID | Single line text; `rec…` ของ Users ใน Base ของทีม |
| Role | Single select: Admin / Secretary / Agent |
| Active | Checkbox |

ห้ามบันทึก PAT หรือ OAuth secret ในตารางกลาง `Base ID` เป็นตัวระบุเท่านั้น เซิร์ฟเวอร์เทียบกับทะเบียน Neon ก่อนใช้การเชื่อมต่อ

เมื่อ bootstrap ระบบจะผูก Base/Table IDs ของ Control Base กับ environment ใน Neon ด้วย การเปลี่ยน IDs หลังจากนั้นต้องเป็นขั้นตอนย้ายระบบโดยตั้งใจ การหมุน PAT ของ Base เดิมทำได้โดยคง IDs เดิม

## เตรียมและย้ายระบบเดิม

1. ซ้อมในฐานข้อมูล/Base ทดสอบแยก สำรอง Airtable, Neon, environment และกุญแจเข้ารหัสก่อนทำจริง ปิด writes และหยุด n8n/webhook ชั่วคราวระหว่าง bootstrap เพื่อไม่ให้เกิดการลงทะเบียนหรือคำขอค้างข้ามจุดย้าย
2. Deploy โค้ดโดยยังตั้ง `WORKSPACES_ENABLED=false` แล้วใช้ `npm run db:migrate` จาก `web/` ด้วย environment เป้าหมาย ตรวจ `DATABASE_MIGRATION_URL` หากใช้ direct Neon connection Migration 013 เป็น additive; ไม่ลบ tasks เดิม
3. เตรียมตารางกลางและกำหนด `AIRTABLE_WORKSPACES_TABLE`, `AIRTABLE_WORKSPACE_MEMBERS_TABLE` หาก Control Base แยก ต้องมี `AIRTABLE_CONTROL_BASE_ID`, `AIRTABLE_CONTROL_TOKEN`, `AIRTABLE_CONTROL_USERS_TABLE` ด้วย PAT ให้เฉพาะ records read/write ของ Control Base
4. สร้าง `WORKSPACE_ENCRYPTION_KEY` แบบสุ่ม 32 bytes (64 hex) เก็บใน private environment และสำรองแยกอย่างปลอดภัย กุญแจนี้ใช้ AES-256-GCM ผูกกับ environment + Workspace ID ห้ามเปลี่ยนโดยไม่ re-encrypt PAT ทุก Space
5. ตรวจคำสั่งก่อนรันจริง: `npm run ops:workspaces -- --owner-email OWNER_EMAIL --confirm-base LEGACY_BASE_ID` เป็น dry-run ที่ตรวจ binding; ไม่ได้ยืนยัน schema/ข้อมูลทุกตาราง เมื่อพร้อมเพิ่ม `--apply` ต้องระบุ Admin เดิมที่ Active เพียงหนึ่งบัญชี
6. Bootstrap สร้าง RINLYN mapping และสมาชิกเดิม คง linked record IDs, tasks, workflows, เอกสารและ LINE เดิม หาก Control Users อยู่ Base ใหม่ จะย้าย identity bindings ไปยัง central IDs ระบบล้าง sessions/OAuth ที่ค้างอยู่ ให้ทุกคน Login ใหม่
7. เมื่อ bootstrap สำเร็จ ตั้ง `WORKSPACES_ENABLED=true` และ Deploy ด้วย environment ชุดเดียวกัน เปิด `/spaces` ด้วย Owner แล้วตรวจสมาชิกก่อนเปิด writes และคืน webhook ระบบจะปฏิเสธการกลับไปใช้ flag=false เมื่อพบ catalog เพื่อป้องกันเสิร์ฟข้อมูลผิดขอบเขต

การแก้ `.env` บนเครื่องไม่เปลี่ยน Vercel ต้องอัปเดต environment และ Deploy ทุกครั้งตาม [vercel-production.md](vercel-production.md)

## สร้างและใช้งาน Space ใหม่

1. Owner เตรียม Base ว่างที่มี 5 ตารางตาม schema ปัจจุบัน ใช้ Table IDs ของ Base ใหม่นั้น ห้ามคัดลอกข้อมูลลูกค้า/งานจริงของทีมอื่นมาเพื่อสร้าง Space
2. เปิด `/spaces` → สร้าง Space ใหม่ ระบุชื่อ อีเมล Google ของ Admin, Base ID, Table IDs, PAT records read/write เฉพาะ Base นั้น และ PAT `schema.bases:read` ชั่วคราวสำหรับตรวจ schema
3. ระบบตรวจ schema และความว่างของตารางงาน จองคำขอใน Neon เข้ารหัส PAT สร้าง schema งานแยก และเปิด Space หลังมี Admin แล้ว PAT ตรวจ schema ไม่ถูกบันทึก
4. Admin Login → เข้า Space → จัดการสมาชิก เพิ่มอีเมล/บทบาท หรือส่งลิงก์ `/register?space=<UUID>` ผู้สมัครยืนยัน Google แล้วสร้าง membership Agent, Active=false; Admin อนุมัติทีละราย เว็บป้องกันการปิด/ลดสิทธิ์ Admin คนสุดท้าย
5. เปลี่ยนทีมที่ชื่อ Space บนแถบด้านบน การส่งข้อมูลจากแท็บเก่าจะถูกปฏิเสธเมื่อ Space เปลี่ยน จึงต้องเปิดใหม่ก่อนแก้ไขงาน

การเปิด Space ใหม่ไม่คัดลอกเอกสาร Favorites, checklist หรือ LINE bindings จากทีมอื่น เอกสารยังเก็บเฉพาะ URL/metadata; หากต้องการชุดแบบฟอร์ม Allianz ให้ import ใน schema ของ Space เป้าหมายด้วยเครื่องมือที่รองรับ Space หรือเพิ่มผ่านเว็บ ห้ามรันเครื่องมือ legacy ที่ชี้ `public` แล้วคาดว่าจะเปลี่ยนทีมตาม cookie

## LINE และ AI

- เว็บยังใช้ OA แจ้งเตือนและ OA AI คู่เดิม การเชื่อม LINE ต้องทำในแต่ละ Space ด้วยรหัสของทีมนั้น คำตอบ/แจ้งเตือนระบุชื่อ Space และลิงก์ให้เลือก Space ก่อนเปิดงาน
- การเลือก Space บนเว็บไม่เปลี่ยนทีมที่ AI ใช้อยู่ ยืนยันการเชื่อม AI หรือกด **ใช้ Space นี้ใน LINE AI** ในหน้าแจ้งเตือนเพื่อเลือกทีม
- LINE AI ใช้สิทธิ์สมาชิกของ Space ที่เลือกเท่านั้น ความจำ ร่างส่งงาน งาน และเอกสารแยกกัน คำตอบค้างและปุ่มยืนยันร่างเก่าไม่ถูกนำไปสร้างงานในอีก Space
- การ block OA ยกเลิก/ปิดการเชื่อมของ LINE นั้นทุก Space การเปิดรับแจ้งเตือนยังเป็นรายทีม
- n8n ใช้ `/api/ai/line` และ `/api/ai/reply` เดิม ไม่รับ Space ID หรือ role จากโมเดลมาตัดสินสิทธิ์ เว็บเป็นผู้หา Space จาก signed LINE event และ binding
- Cron หมุนตรวจหนึ่ง Space ต่อครั้งเพื่ออยู่ในเวลาทำงานที่กำหนด งานปกติส่งผ่าน after-response ใน Space นั้น เมื่อเพิ่มหลายทีมต้องทบทวนความถี่ Cron และปริมาณคิว retry

## ตรวจสอบก่อนเปิดจริงและการกู้คืน

รัน `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build` และ `npm run test:e2e` ทดสอบบัญชีเดียวต่างบทบาทในสอง Space, ห้ามเห็นงาน/เอกสาร/สมาชิกข้ามทีม, ปิดสมาชิก/Space, ทดสอบ LINE tickets/drafts และ notification แยกทีม รวมทั้งข้อมูลเดิมหลัง bootstrap ใช้สอง Base ทดสอบ โดยวันที่ 21 พฤศจิกายน 2569 เจ้าของระบบเลือกเลื่อนการทดสอบ LINE บนโทรศัพท์จริงไปทำเองบน Production ต้องบันทึกแยกจากผล automated tests และไม่อ้างว่าผ่านแล้ว

`WORKSPACE_SETUP_REVIEW` หมายถึงคำขออาจทำบางขั้นสำเร็จแล้ว อย่ากดสร้างด้วยรหัสใหม่หรือเปลี่ยน Base เพื่อเลี่ยง ตรวจ `hvr_workspace_setups`, `hvr_workspaces`, Control Workspaces/Members และ schema ที่เกี่ยวข้องก่อนกู้ด้วยผู้ดูแล ระบบไม่ retry external writes ที่ผลไม่แน่นอนโดยอัตโนมัติ ปุ่มเปิด Space ไม่สามารถแก้การ setup ที่ยังไม่ครบได้

หลัง bootstrap ห้าม rollback ไป release ที่ไม่รู้จัก Space หากจำเป็นให้พัก writes/webhooks และคืน **ทั้ง** Neon + Control Base + environment จาก backup ที่เข้าคู่กันก่อนคืน release เดิม รายการที่เพิ่มหลัง backup ต้อง reconcile ก่อนเปิดรับงาน

Migration ใหม่ต้องระบุว่าเป็น control-plane หรือ operational ใช้ `npm run db:bundle` เมื่อเพิ่ม operational migration และปรับ exclusion หากมี control migration เพิ่ม `db:migrate` อัปเดต public และ schema ทุก Space ภายใน transaction; integration test ตรวจ bundle เทียบไฟล์ต้นฉบับและสร้าง schema จริงด้วย PGlite

ยังไม่ครอบคลุม: สร้าง Airtable Base อัตโนมัติ, ย้าย Base ของ Space ที่มีงานแล้ว, เปลี่ยน OA แยกแต่ละ Space และ UI กู้ setup ที่ค้าง ขั้นตอนเหล่านี้ต้องมีแผนย้าย/กู้เฉพาะก่อนใช้งาน

## ผลตรวจบนเครื่อง 20 พฤศจิกายน 2569

- Lint, TypeScript และ production build ผ่าน
- Unit tests 32 และ integration tests 73 ผ่าน ใช้ข้อมูลสมมติและ PGlite ไม่เรียกบริการจริง
- Playwright เฉพาะ `spaces`, `ai-line`, `workspace` ผ่าน 12 กรณีบน desktop/mobile emulation; หลังปรับตารางสมาชิกมือถือ รัน `spaces` ซ้ำผ่าน 4 กรณี
- ตรวจภาพ `artifacts/workspaces/spaces-desktop.png` และ `spaces-mobile.png` แล้ว ภาพเป็นข้อมูลสมมติและอยู่ในไฟล์ทำงานที่ Git ignore
- ผลบนเครื่องไม่แทนการยืนยัน Google Login/หน้าจอจริงและอุปกรณ์จริงสำหรับรุ่นหลาย Space

## การตั้งค่า Staging จริง 20 พฤศจิกายน 2569

- สร้าง Control Base `appDH8CEjMef8WjJh` ชื่อ **RINLYN Control — Staging** พร้อม Users, Workspaces, Workspace Members, Record ID formulas และ member lookups แล้ว PAT จำกัด records read/write เฉพาะ Base นี้
- สคริปต์เตรียมตารางที่นำกลับใช้ได้: `tools/setup-airtable-control.js` ระบุ Base ID ก่อนรันใน Scripting; เพิ่ม computed fields และจำกัด single links ผ่าน Airtable UI ตามรายการท้ายสคริปต์
- สำรอง Neon แบบเข้ารหัสและซ้อม restore ผ่านทั้ง 27 ตาราง/constraints: run `122a7695-cfff-46f2-b252-b05a8df7c998` เก็บต้นฉบับ pg_dump ครบ; เฉพาะ local restore ตัด ALTER COLUMN `pg_attver` ของ Neon 36 บรรทัดที่ stock PostgreSQL ไม่รองรับ และเปรียบเทียบข้อมูลด้วย collation C
- สำรอง records ของ Base ทดสอบทั้ง 5 ตารางและ environment แบบเข้ารหัสก่อน bootstrap: Users 8, Tasks 15, Updates 30, Follow-ups 4, Notifications 5
- Apply migration 013 และ bootstrap RINLYN สำเร็จ สมาชิกเดิม 8 บัญชี; พัก writes ของ Staging ระหว่าง deploy และล้าง sessions ตามขั้นตอน ให้ Login ใหม่หลังเปิดใช้
- ข้อมูลการเชื่อมต่อและกุญแจอยู่ใน ignored private artifacts; ไม่ใส่ใน Git เอกสารนี้ไม่ถือเป็นการยืนยัน Production rollout
- Deploy app commit `355a9de` เป็น Preview `dpl_HfdmwSUc4YXUfa3mZLQmEJpKeygW` และผูก staging alias แล้ว `/api/health`, `/login`, `/spaces` ตอบ 200; `/api/spaces`, `/api/bootstrap` แบบไม่ Login ตอบ 401/no-store ตรวจ Production alias ยังเป็น deployment เดิม
- ตรวจหลัง bootstrap: งาน 15, updates 30, follow-ups 4 และ notifications 5 ตรงกับสำรองทุก record; roles/Active ของสมาชิก 8 บัญชีตรงเดิม และ Lookup คืน central record IDs ถูกต้อง
- ชุดทดสอบ PostgreSQL จริงผ่าน 11 กรณี หลังปรับ migration fixture ให้ใช้ฐานข้อมูลทดสอบแยก (รองรับ control tables ใน public) แทน search_path schema อย่างเดียว
- เพิ่ม **Space B — ทดสอบการแยกทีม** (`e023892a-33a9-485d-8e5a-b352eb0e480f`), Base `appv1jANFCKDkhBW8` จาก schema ของ Base ทดสอบโดยปิด Duplicate records ตรวจ 5 ตารางงานว่างก่อนสร้าง Space ผ่าน operator service ที่ตรวจ System Role=Owner; ไม่ใช่ผลทดสอบปุ่มสร้าง Space ผ่าน browser
- ทดสอบ service กับสอง Base จริง: Owner มี 2 Space, Agent A เห็นเพียง RINLYN และถูกปฏิเสธ Space B; Users mirror ใช้ record IDs ต่างกัน งาน 15/0 และเอกสาร 44/0 แยกถูกต้อง ตรวจ Neon schema ของ Space B และ PAT ที่ถอดรหัสเข้าถึง Base เป้าหมายได้ หลักฐาน `artifacts/vercel/workspaces-live-isolation.json`
- [CI ของ commit 95ffdc1 ผ่านครบ](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/44761820760): lint/typecheck, unit, integration, PostgreSQL, audit, build, E2E, API, load และ legacy checks รอบแรกของ commit นี้ล้มด้วย V8 `jit_page.has_value()` ก่อน assertions; rerun ผ่านโดยไม่เปลี่ยน source เพื่อแก้ native crash
- Staging alias ผูก release `dpl_C1MFvM6QifsJxKBRNwRsEAb1xpWe` / app commit `95ffdc1` แล้ว เปิด writes ทั้ง RINLYN และ Space B; jobs ยังปิด ตรวจ Production deployment ตรง baseline ก่อนเริ่มงาน
- ผลข้างต้นเป็นการตรวจ service ก่อนทดสอบ browser; ดูผล Google Login จริงด้านล่าง LINE OA จริงยังไม่ได้เปลี่ยนให้ใช้รุ่นหลาย Space

## ทดสอบ browser บน Staging 21 พฤศจิกายน 2569

- Owner ยืนยัน Google Login ด้วยตนเองแล้ว หน้า `/spaces` แสดง RINLYN และ Space B พร้อมเครื่องมือ Owner และจัดการสมาชิกตามสิทธิ์
- เพิ่มสมาชิกสมมติ `space-b.agent@example.invalid` ผ่านหน้าเว็บเป็น Agent รออนุมัติ แล้วอนุมัติใน Space B สำเร็จ ไม่เพิ่มสิทธิ์ให้บัญชีจริงอื่น
- ส่งงาน `[SPACE B TEST] ตรวจส่งงานแยก Workspace` พร้อมชื่อบุคคลของเคสและ Agent สมมติผ่านเว็บสำเร็จ: `recgZTvrtKAfHxjfY` บันทึก Checklist แล้วโหลดหน้าใหม่ยังอยู่ครบ
- ตรวจ Airtable/Neon: งาน RINLYN ยังคง 15 รายการ, Space B มี 1 รายการใหม่; Agent ใช้ Users mirror ของ Base B และ workflow อยู่เฉพาะ schema ของ Space B หน้าเอกสารแยกเป็น 44/0 รายการ
- พบว่าลิงก์งาน Space B เมื่อเปิดใน RINLYN ถูกปฏิเสธ แต่เดิมแสดงบริการข้อมูลขัดข้อง จึงปรับ lookup ให้ค้น `RECORD_ID()` เฉพาะ Base ที่เลือก คืน `TASK_NOT_FOUND` เมื่อไม่พบ พร้อมลิงก์กลับไปเลือก Space; upstream error จริงยังแสดงบริการไม่พร้อมใช้งาน
- หลังปรับ lookup: lint/typecheck/build, integration 73 และ Playwright `spaces` 6 กรณีผ่าน (desktop/mobile emulation) หลักฐาน browser และ read-only verification อยู่ใน ignored `artifacts/workspaces/` และ `artifacts/vercel/workspaces-browser-acceptance.json`
- Deploy commit `4899bc3` เป็น Preview `dpl_J5wYQGYuAQQVbzEtA2oFeRDSakdy` และผูก staging alias แล้ว ทดสอบ browser ซ้ำ: เลือก RINLYN เปิดลิงก์งาน Space B แล้วแสดง “ไม่พบงานใน Space นี้” พร้อมทางกลับไปเลือก Space; สลับ Space B แล้วเปิดงานเดิมและ Checklist ที่บันทึกไว้ได้
- ตรวจ Production alias ยังเป็น `dpl_EkvvhmQC8TX3dVaaVT7rFsdZjtoi` ตาม baseline ก่อนงานนี้
- [CI ของ commit 4899bc3 ผ่านครบ](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/44789096892): lint/typecheck, unit, integration, PostgreSQL, audit, build, Chromium/E2E, API, load และ legacy checks ตรวจยืนยันผล run สำเร็จวันที่ 21 พฤศจิกายน 2569
- ต่อมาทดสอบ Google Login/หน้าจอจริงครบ Owner, เลขา, Agent A และ Agent B ผ่าน รวมการส่งงาน อัปเดตสถานะ บันทึกภายใน เอกสารร่าง และปฏิเสธการเข้าถึงข้าม Space รายละเอียดใน [acceptance](multi-workspace-acceptance.md) LINE จริงเลื่อนไปให้เจ้าของระบบทดสอบเองบน Production ตามคำสั่งล่าสุด; ยังไม่มีการเปลี่ยน Production หรือ webhook จริง
