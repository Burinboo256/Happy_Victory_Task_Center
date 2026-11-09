# สถานะ production

9 พฤศจิกายน 2026: เปิดรับงานบน Vercel Production แล้ว หลังพักการเขียนงานของ Apps Script เดิม ตรวจ baseline และทดสอบสร้างงานผ่าน Admin Google session จริงสำเร็จ คง Vercel Hobby / Neon Free ตามที่เจ้าของเลือก โดย jobs และการแจ้งเตือนยังปิด

| รายการ | ผลตรวจ |
|---|---|
| URL | `https://happy-victory-task-center.vercel.app` |
| Project / branch | `happy-victory-task-center` / `main`, root `web`, Node `24.x` |
| Neon resource | `happy-victory-production` / `store_t0dsjnqmTcsDWv5f` |
| Neon project / plan / region | `morning-dust-88866872` / `free_v3` / Singapore `sin1`; แยกจาก staging |
| Database | PostgreSQL `180006`; migrations 001/002 ผ่าน ผูก `production` กับ Base `appDS1Ji5cqIohPq3` |
| TLS | direct/pooled ใช้ `verify-full`; ตรวจ certificate และ hostname ผ่านทั้งคู่ |
| OAuth | client ใหม่ “Happy Victory Task Center — Vercel Production”; callback `/api/auth/google/callback` ตรง production origin |
| Airtable PAT | token ใหม่ เฉพาะ Base production, records read/write ไม่มี schema scope; GET `FALSE()` ทั้ง 5 ตารางผ่าน โดยไม่อ่านเนื้อหา records |
| Vercel variables | ครบ 17 ตัว เฉพาะ Production; sensitive 5 ตัว, ไม่มี direct migration URL; Preview/staging metadata ไม่เปลี่ยน |
| Writes / jobs / notifications | config และ DB writes เปิด; jobs และ notifications ปิด |
| Deployment | `dpl_2CbaD1TiVqMyCz4QanDorWxUAJGv` / `9d55de8` / main / Production READY; production alias ตรง |
| Google Login จริง | เจ้าของ Login ด้วยตนเองแล้ว ตรวจ Role Admin / Active / Subject binding / live session ตรงกัน ไม่มี unfinished operations หรือ reservations |
| สมาชิก | เจ้าของอนุญาตเพิ่ม Secretary และ Agent A/B ตามบัญชีเดิมแล้ว สร้าง Active=true ครบ 3 บัญชี ไม่เพิ่ม Admin และไม่เปลี่ยนผู้ใช้เดิม รอแต่ละบัญชี Login เพื่อผูก Subject |

ส่งออก connection ผ่านการเชื่อม integration เฉพาะ Production ชั่วคราวแล้วถอดออกก่อน pin runtime credentials ตรวจว่า resource ไม่มี auto-connected projects คงเหลือ Credentials และรายงานอยู่ใน ignored `artifacts/vercel/production-*`; ไม่เก็บค่า secret หรือข้อมูลบุคคลในเอกสารนี้

หลักฐาน: `production-db-ready.json`, `production-env-partial-ready.json` (สถานะก่อนเพิ่ม PAT), `production-pat-ready.json`, `production-deployment-ready.json`, `production-users-ready.json` และ `production-admin-login.json` Source ของ release ตรงกับ `f2eb6a3`; [CI main 9d55de8](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42450661743) ผ่านแล้ว

ตรวจ public Login HTML และ linked JS/CSS 10 resources: body 16px, ไม่พบ production secrets ที่ตั้งจริง 6 ค่าใน samples; health 200, anonymous bootstrap 401/no-store, Google initiation 303 กับ production client/callback และ PKCE S256 / Secure HttpOnly cookie ผลตรวจ bundle เฉพาะ samples ไม่ครอบคลุม server artifacts/logs ทุกจุด

Apps Script เดิม Deploy maintenance guard เป็น **เวอร์ชัน 5** เมื่อ 8 พฤศจิกายน 2026 แล้ว โดยคง deployment URL และสิทธิ์เดิม สำเนา source ที่คัดลอกกลับจาก Editor ตรงกับไฟล์ที่ตรวจไว้ (`SHA-256 4d534e387f994eba8c9862a9e5e2c1ff75df9290fa0c4a5a219c10fa2fb123c2`) วันที่ 9 พฤศจิกายน รัน `pauseLegacyWritesForVercel` และตรวจ execution log: `taskWritesPaused=true`, pending/malformed operations และ trigger เป็น 0, email/LINE ปิด และ `readyToCutover=true` ก่อนเปิด Vercel

## สำรองก่อน cutover — 9 พฤศจิกายน 2026

- Neon: เก็บ `operational.dump.enc` ด้วย AES-256-GCM และทดสอบกู้คืนใน PostgreSQL 18.6 แยกด้วย Docker `--network=none` ไม่มี published ports ตรวจ hash ข้อมูลครบ 10 ตารางและ constraints ตรง snapshot; ไฟล์ที่แก้ไขเสียหายถูกปฏิเสธ ลบเฉพาะ container ทดสอบที่ตรวจ ownership แล้ว หลักฐาน `production-backup-latest.json`, run `f315014d-44dc-441a-bb31-ae21cc968842` ผลนี้เป็น local restore ไม่ใช่ cloud restore
- Airtable: ทำสำเนา native ใน Workspace เดิมชื่อ **Happy Victory — Pre-cutover Backup 2026-11-09**, Base `appyQGrRz0AOhAxAH` โดยเปิด Duplicate records/comments สำเนามีครบ 6 ตารางและ Users 4 รายการ ไม่รวม revision history
- ส่งออก records/linked record IDs ทั้ง 6 ตารางจาก Base จริงเป็น `records.json.enc` ใช้ AES-256-GCM ตรวจถอดรหัสกลับและปฏิเสธไฟล์เสียหายผ่าน จำนวน records: Users 4; ตารางอื่น 0 หลักฐาน `production-airtable-backup.json` โครงสร้างอยู่ใน native duplicate; JSON นี้เพียงอย่างเดียวไม่ใช่ schema backup
- เจ้าของยืนยันอัปโหลด `production-backup-2026-11-09.zip` ไป Google Drive อีกบัญชีแล้ว เป็นคำยืนยันของเจ้าของ ไม่ใช่ผลตรวจ cloud โดยเครื่องมือ กุญแจถอดรหัสแยกจาก ZIP ในไฟล์ส่วนตัวที่ Git ignore; ยังไม่มีคำยืนยันการเก็บกุญแจนอกเครื่อง และยังไม่ได้ตั้งสำรองอัตโนมัติ
- หลังพักระบบเดิม อ่านทั้ง 6 ตารางแล้วเทียบ records กับสำรองตรงกันทั้งหมดก่อนเปิด writes หลักฐาน `production-cutover-baseline.json` ห้าม restore ทับ Base จริงหรือเปลี่ยน Base ID runtime อัตโนมัติ ต้องตรวจ link IDs, Users/Google bindings และ schema ก่อนเสมอ

## ผลเปิดรับงานและการพักระบบ

อัปเดต `TASK_WRITES_ENABLED=true` เฉพาะ Production แล้ว redeploy รอ READY และตรวจ alias ก่อนเปิด `hvr_runtime.task_writes` ไม่เปลี่ยน Preview/staging หรือ flags อื่น ทดสอบผ่าน Chrome Admin session ของเจ้าของ: สร้างงาน `[PRODUCTION SMOKE]` หมายเลข `HVR-00001` ให้ Agent A แล้วเปิดรายละเอียดได้ ตรวจ Airtable พบ task และ Created audit อย่างละ 1 รายการ ผู้สร้าง/เจ้าของตรงกัน; Neon journal เป็น completed ไม่มี unfinished operations หรือ reservations หลักฐาน `production-smoke-result.json` งานทดสอบยังเก็บไว้โดยไม่มีข้อมูลลูกค้า

ลิงก์ส่งงานสำหรับ LINE Rich Menu: `https://happy-victory-task-center.vercel.app/tasks/new?openExternalBrowser=1` ยังไม่ได้แก้ Rich Menu ใน LINE OA บัญชี Secretary และ Agent A/B ผ่าน staging แล้ว แต่ยังไม่ได้ทดสอบ Login/workflow ครบทุกบัญชีบน production การทดสอบนี้ไม่แทน load test หรือการแจ้งเตือน M7

เมื่อต้องพักรับงาน ใช้ `node artifacts/runtime-production.mjs off` จาก checkout เครื่องผู้ดูแลที่มี helper และ credentials ส่วนตัว หรือใช้ `web/tools/runtime.ts --environment=production --base-id=appDS1Ji5cqIohPq3 --writes=off` ภายใต้ production environment ที่ตรวจแล้ว จากนั้นตรวจ DB flag และหน้าเว็บ ห้ามเปิด Apps Script กลับก่อนหยุด Vercel และจัดการ operations/reservations ค้างตาม [runbook](vercel-deployment-plan.md#5-cutover-ไป-production) สำรองก่อนเปิดระบบเป็น baseline เก่า ไม่ครอบคลุมงานใหม่หลัง cutover
