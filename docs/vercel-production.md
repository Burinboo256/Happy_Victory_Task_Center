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

ลำดับต่อไป: backup และ restore evidence → Deploy maintenance guard/หยุดผู้เขียนเดิม → เปิด writes ระบบใหม่เพียงระบบเดียวตาม [runbook](vercel-deployment-plan.md#5-cutover-ไป-production) คง Hobby ตามที่เจ้าของเลือก การแจ้งเตือน M7 ยังปิด ยังไม่เปลี่ยน Rich Menu และไม่รับรอง cutover สำเร็จจากผล Login เพียงอย่างเดียว
