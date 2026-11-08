# เตรียม production

8 พฤศจิกายน 2026: เจ้าของยืนยันว่าทดสอบมือถือเรียบร้อยและอนุญาตดำเนินการ production แล้ว Deployment แบบอ่านอย่างเดียว READY และ Admin Google Login จริงผ่าน ยังไม่สลับผู้เขียนหลักจาก Apps Script เจ้าของเลือกคง Vercel Hobby สำหรับ Hobby project ไม่อัปเกรดแผนเสียเงิน

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
| Writes / jobs / notifications | config และ DB writes/jobs ปิด; notifications ปิด |
| Deployment | `dpl_2Jq4hETvwmRCyriWLm6dpf3Pb74j` / `9d55de8` / main / Production READY; production alias ตรง |
| Google Login จริง | เจ้าของ Login ด้วยตนเองแล้ว ตรวจ Role Admin / Active / Subject binding / live session ตรงกัน ไม่มี unfinished operations หรือ reservations |
| สมาชิก | เจ้าของอนุญาตเพิ่ม Secretary และ Agent A/B ตามบัญชีเดิมแล้ว สร้าง Active=true ครบ 3 บัญชี ไม่เพิ่ม Admin และไม่เปลี่ยนผู้ใช้เดิม รอแต่ละบัญชี Login เพื่อผูก Subject |

ส่งออก connection ผ่านการเชื่อม integration เฉพาะ Production ชั่วคราวแล้วถอดออกก่อน pin runtime credentials ตรวจว่า resource ไม่มี auto-connected projects คงเหลือ Credentials และรายงานอยู่ใน ignored `artifacts/vercel/production-*`; ไม่เก็บค่า secret หรือข้อมูลบุคคลในเอกสารนี้

หลักฐาน: `production-db-ready.json`, `production-env-partial-ready.json` (สถานะก่อนเพิ่ม PAT), `production-pat-ready.json`, `production-deployment-ready.json`, `production-users-ready.json` และ `production-admin-login.json` Source ของ release ตรงกับ `f2eb6a3`; [CI main 9d55de8](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42450661743) ผ่านแล้ว

ตรวจ public Login HTML และ linked JS/CSS 10 resources: body 16px, ไม่พบ production secrets ที่ตั้งจริง 6 ค่าใน samples; health 200, anonymous bootstrap 401/no-store, Google initiation 303 กับ production client/callback และ PKCE S256 / Secure HttpOnly cookie ผลตรวจ bundle เฉพาะ samples ไม่ครอบคลุม server artifacts/logs ทุกจุด

Apps Script เดิม Deploy maintenance guard เป็น **เวอร์ชัน 5** เมื่อ 8 พฤศจิกายน 2026 แล้ว โดยคง deployment URL และสิทธิ์เดิม สำเนา source ที่คัดลอกกลับจาก Editor ตรงกับไฟล์ที่ตรวจไว้ (`SHA-256 4d534e387f994eba8c9862a9e5e2c1ff75df9290fa0c4a5a219c10fa2fb123c2`) คำสั่ง `checkLegacyCutover` รายงาน pending/malformed operations และ trigger เป็น 0, email/LINE ปิด แต่ **task writes เดิมยังเปิด** จึงยังไม่ผ่าน `readyToCutover` และยังไม่เปิด Vercel writes

## สำรองก่อน cutover — 9 พฤศจิกายน 2026

- Neon: เก็บ `operational.dump.enc` ด้วย AES-256-GCM และทดสอบกู้คืนใน PostgreSQL 18.6 แยกด้วย Docker `--network=none` ไม่มี published ports ตรวจ hash ข้อมูลครบ 10 ตารางและ constraints ตรง snapshot; ไฟล์ที่แก้ไขเสียหายถูกปฏิเสธ ลบเฉพาะ container ทดสอบที่ตรวจ ownership แล้ว หลักฐาน `production-backup-latest.json`, run `f315014d-44dc-441a-bb31-ae21cc968842` ผลนี้เป็น local restore ไม่ใช่ cloud restore
- Airtable: ทำสำเนา native ใน Workspace เดิมชื่อ **Happy Victory — Pre-cutover Backup 2026-11-09**, Base `appyQGrRz0AOhAxAH` โดยเปิด Duplicate records/comments สำเนามีครบ 6 ตารางและ Users 4 รายการ ไม่รวม revision history
- ส่งออก records/linked record IDs ทั้ง 6 ตารางจาก Base จริงเป็น `records.json.enc` ใช้ AES-256-GCM ตรวจถอดรหัสกลับและปฏิเสธไฟล์เสียหายผ่าน จำนวน records: Users 4; ตารางอื่น 0 หลักฐาน `production-airtable-backup.json` โครงสร้างอยู่ใน native duplicate; JSON นี้เพียงอย่างเดียวไม่ใช่ schema backup
- กุญแจอยู่แยกในไฟล์ส่วนตัวที่ Git ignore ยังไม่ได้อัปโหลดสำเนาหรือกุญแจออกนอกเครื่อง รอเจ้าของเลือกที่เก็บนอกเครื่องและการเก็บกุญแจสำรอง
- สำเนาเหล่านี้สร้างขณะที่ระบบเดิมยังเขียนได้ จึงต้องตรวจการเปลี่ยนแปลงอีกครั้งหลังพักระบบเดิม ก่อนใช้เป็น baseline สุดท้าย ห้าม restore ทับ Base จริงหรือเปลี่ยน Base ID runtime อัตโนมัติ ต้องตรวจ link IDs, Users/Google bindings และ schema ก่อนเสมอ

ลำดับต่อไป: สำเนานอกเครื่องและแผนกู้กุญแจ → หยุดผู้เขียนเดิมด้วย guard ที่ Deploy แล้ว → ตรวจ baseline สุดท้ายและเปิด writes ระบบใหม่เพียงระบบเดียวตาม [runbook](vercel-deployment-plan.md#5-cutover-ไป-production) คง Hobby ตามที่เจ้าของเลือก การแจ้งเตือน M7 ยังปิด ยังไม่เปลี่ยน Rich Menu และไม่รับรอง cutover สำเร็จจากผล Login เพียงอย่างเดียว
